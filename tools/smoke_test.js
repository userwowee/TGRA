// Headless smoke test for index.html. Needs Playwright on the machine running it:
//   npm run www && node tools/smoke_test.js
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.WWW_DIR || path.join(__dirname, '..', 'www');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|fonts.googleapis|gstatic/.test(m.text())) errors.push(m.text()); });

  await page.goto('http://127.0.0.1:8099/', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  check('page loads without JS errors', errors.length === 0, errors.join(' | '));
  check('queue starts empty', (await page.textContent('#queueCount')).trim() === '0');
  check('empty-state card shown', (await page.locator('.queue-empty').count()) === 1);

  // Guard: a time button without an action selected must refuse
  await page.click('.time-btn[data-mins="15"]');
  await page.waitForTimeout(150);
  check('refuses reminder with no action', (await page.textContent('#toastMsg')).includes('Select an activity'));
  check('nothing queued by the refusal', (await page.textContent('#queueCount')).trim() === '0');

  // Happy path with hostile input
  await page.click('.action-btn[data-action="Call"]');
  check('action highlights', (await page.locator('.action-btn[data-action="Call"].action-selected').count()) === 1);
  await page.fill('#taskInput', '<img src=x onerror="window.__xss=1">Mum');
  await page.click('.time-btn[data-mins="15"]');
  await page.waitForTimeout(400);

  check('reminder queued', (await page.textContent('#queueCount')).trim() === '1');
  check('card title escaped, not parsed', (await page.locator('.task-card img').count()) === 0);
  check('no XSS executed', (await page.evaluate(() => window.__xss === undefined)));
  check('card shows the typed text', (await page.textContent('.task-meta-title')).includes('<img src=x onerror="window.__xss=1">Mum'));
  check('action selection cleared after save', (await page.locator('.action-selected').count()) === 0);
  check('input cleared after save', (await page.inputValue('#taskInput')) === '');
  check('success toast shown', (await page.textContent('#toastMsg')).includes('set for 15 Mins'));

  const dueBefore = await page.evaluate(() => document.querySelector('.task-meta-sub').innerText.trim());

  // Procrastinator reveals +1 Hr
  check('+1 Hr hidden by default', (await page.locator('.btn-extend-hour.hidden').count()) === 1);
  await page.click('#procrastinatorBtn');
  await page.waitForTimeout(300);
  check('+1 Hr revealed', (await page.locator('.btn-extend-hour:not(.hidden)').count()) === 1);
  await page.click('.btn-extend-hour');
  await page.waitForTimeout(400);
  const dueAfter = await page.evaluate(() => document.querySelector('.task-meta-sub').innerText.trim());
  check('+1 Hr moves the due time', dueBefore !== dueAfter, `${dueBefore} -> ${dueAfter}`);
  check('+1 Hr toast shown', (await page.textContent('#toastMsg')).includes('Extended +1 Hour'));

  // Bell toggle
  await page.click('#bellBtn');
  await page.waitForTimeout(150);
  check('bell switches to quiet', (await page.textContent('#bellIcon')).trim() === 'notifications_off');

  // Persistence across reload
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  check('queue persisted', (await page.textContent('#queueCount')).trim() === '1');
  check('quiet pref persisted', (await page.textContent('#bellIcon')).trim() === 'notifications_off');
  check('procrastinator pref persisted', (await page.locator('#procrastinatorBtn.active').count()) === 1);

  // Time maths
  const times = await page.evaluate(() => {
    const now = Date.now();
    return {
      eodFuture: calculateTimestamp('eod') > now,
      m15: Math.round((calculateTimestamp('15') - now) / 60000),
      nextDayFuture: calculateTimestamp('next_day') > now,
      nextNoonFuture: calculateTimestamp('next_noon') > now,
      nextNightFuture: calculateTimestamp('next_night') > now,
      threeWeeks: Math.round((calculateTimestamp('30240') - now) / 86400000)
    };
  });
  check('end-of-day is always in the future', times.eodFuture);
  check('15 min interval is 15 min', times.m15 === 15, String(times.m15));
  check('next day/noon/night in future', times.nextDayFuture && times.nextNoonFuture && times.nextNightFuture);
  check('3 weeks = 21 days', times.threeWeeks === 21, String(times.threeWeeks));

  // Overdue path: an item due in the past alerts once, then stays flagged
  await page.evaluate(async () => {
    const database = await getDB();
    await runWrite(database, (store) => store.add({
      id: 1, action: 'Pray', title: 'Overdue item', due: Date.now() - 60000, alerted: false, created: Date.now()
    }));
    loadQueue();
  });
  await page.waitForTimeout(300);
  check('overdue card flagged', (await page.locator('.task-meta-sub.overdue').count()) === 1);
  check('queue count 2', (await page.textContent('#queueCount')).trim() === '2');

  // Done removes it
  await page.locator('.card-act-btn.done').first().click();
  await page.waitForTimeout(400);
  check('done removes the card', (await page.textContent('#queueCount')).trim() === '1');

  await page.locator('.card-act-btn.cancel').first().click();
  await page.waitForTimeout(400);
  check('cancel removes the card', (await page.textContent('#queueCount')).trim() === '0');
  check('empty state returns', (await page.locator('.queue-empty').count()) === 1);

  // Native wiring: with a stub plugin in place, scheduling must reach it.
  // Regression guard for the bug where Capacitor.Plugins was empty and every
  // native call was silently skipped.
  const STUB_NATIVE = `
    const calls = { schedule: [], channels: [], cancel: [], listeners: [] };
    window.__calls = calls;
    window.EWalnutNative = {
      isNative: true,
      LocalNotifications: {
        checkPermissions: async () => ({ display: 'granted' }),
        requestPermissions: async () => ({ display: 'granted' }),
        createChannel: async (c) => { calls.channels.push(c.id); },
        addListener: (name) => { calls.listeners.push(name); return { remove() {} }; },
        schedule: async (opts) => { calls.schedule.push(opts.notifications[0]); return {}; },
        cancel: async (opts) => { calls.cancel.push(opts.notifications[0].id); }
      }
    };
  `;

  const nativePage = await browser.newPage({ viewport: { width: 412, height: 915 } });
  // Serve a recording stub in place of the real bundle: this exercises the page's
  // wiring to window.EWalnutNative, which is where the bug was.
  await nativePage.route('**/native.js', route =>
    route.fulfill({ body: STUB_NATIVE, contentType: 'application/javascript' }));
  await nativePage.goto('http://127.0.0.1:8099/', { waitUntil: 'load' });
  await nativePage.waitForTimeout(500);

  const channels = await nativePage.evaluate(() => window.__calls.channels);
  check('both notification channels created', channels.includes('ewalnut_alerts') && channels.includes('ewalnut_quiet'), channels.join(','));
  check('notification listeners registered', (await nativePage.evaluate(() => window.__calls.listeners.length)) === 2);
  check('status bar reports alarms on', (await nativePage.textContent('#nativeStatusText')).includes('Background alarms are on'));
  check('test button offered on device', (await nativePage.locator('#testBtn:not(.hidden)').count()) === 1);

  await nativePage.click('.action-btn[data-action="Health"]');
  await nativePage.fill('#taskInput', 'Pills');
  await nativePage.click('.time-btn[data-mins="60"]');
  await nativePage.waitForTimeout(500);

  const scheduled = await nativePage.evaluate(() => window.__calls.schedule[0]);
  check('reminder reached the OS scheduler', !!scheduled, JSON.stringify(scheduled || null));
  check('scheduled on the loud channel', scheduled && scheduled.channelId === 'ewalnut_alerts', scheduled && scheduled.channelId);
  check('scheduled an hour out', scheduled && Math.abs(new Date(scheduled.schedule.at).getTime() - Date.now() - 3600000) < 20000);
  check('scheduled with the task text', scheduled && scheduled.body === 'Pills', scheduled && scheduled.body);
  check('exact alarm requested', scheduled && scheduled.schedule.allowWhileIdle === true);

  await nativePage.click('#testBtn');
  await nativePage.waitForTimeout(400);
  const testCall = await nativePage.evaluate(() => window.__calls.schedule[1]);
  check('test button fires a real notification', !!testCall && Math.abs(new Date(testCall.schedule.at).getTime() - Date.now() - 15000) < 10000);

  // Quiet mode routes to the silent channel
  await nativePage.click('#bellBtn');
  await nativePage.click('.action-btn[data-action="Pray"]');
  await nativePage.click('.time-btn[data-mins="30"]');
  await nativePage.waitForTimeout(500);
  const quiet = await nativePage.evaluate(() => window.__calls.schedule.at(-1));
  check('quiet mode uses the quiet channel', quiet && quiet.channelId === 'ewalnut_quiet', quiet && quiet.channelId);

  await nativePage.locator('.card-act-btn.done').first().click();
  await nativePage.waitForTimeout(400);
  check('done cancels the OS alarm', (await nativePage.evaluate(() => window.__calls.cancel.length)) >= 1);
  await nativePage.close();

  check('browser build shows preview notice', (await page.textContent('#nativeStatusText')).includes('Browser preview'));
  check('test button hidden in browser', (await page.locator('#testBtn.hidden').count()) === 1);

  // Layout sanity
  const layout = await page.evaluate(() => {
    const el = document.querySelector('.screen-container');
    return { width: el.getBoundingClientRect().width, scrollX: document.documentElement.scrollWidth, inner: window.innerWidth };
  });
  check('full-bleed width', Math.abs(layout.width - layout.inner) < 2, JSON.stringify(layout));
  check('no horizontal overflow', layout.scrollX <= layout.inner + 1, JSON.stringify(layout));
  check('still no JS errors at end', errors.length === 0, errors.join(' | '));

  await page.screenshot({ path: process.env.SHOT || 'app-shot.png', fullPage: true });
  await browser.close();
  server.close();

  const failed = checks.filter(c => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
