# The Great Reminder App (e-Walnut)

A single-file, two-tap reminder capture app for Android. Pick an activity, type an
optional detail, pick an interval — the reminder is stored locally and registered
with the Android alarm scheduler so it fires even when the app is closed.

* UI: one HTML file (`index.html`), Material 3 tokens, no build step, no framework.
* Storage: IndexedDB on the device. Nothing leaves the phone; there is no backend.
* Alerts: `@capacitor/local-notifications` exact alarms in the background, Web Audio
  beep + vibration while the app is in the foreground.
* Packaging: Capacitor wraps the page into a debug APK in GitHub Actions.

## Using it

1. Tap an activity (Think, Call, Buy, Health, …).
2. Optionally type a person, task or item.
3. Tap an interval (15 Mins … 3 Weeks, End of Day, Next Noon, …). The reminder is queued.
4. In the queue, **Done** or **Cancel** removes a reminder. **Procrastinator** reveals a
   **+1 Hr** button on every card.
5. The bell in the app bar switches between sound+vibrate and quiet. It applies to
   reminders created after the switch, because an Android notification channel's sound
   cannot be changed once the channel exists — the two modes are two channels.

## Build

CI does this on every push to `main` (`.github/workflows/build.yml`) and publishes the
APK to the `latest` release. Locally you need a JDK 21 and an Android SDK with
`platforms;android-36`:

```bash
npm ci
npm run www          # copies index.html into www/ and bundles the fonts offline
npm run android:add  # generates android/ and patches the manifest
npm run apk          # android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run sync` re-copies the web assets into an existing `android/` directory.

### What the build does to the Android project

`android/` and `www/` are generated, never committed.

* `tools/bundle_fonts.py` downloads Roboto and Material Symbols Rounded into
  `www/fonts/` so icons render with no network. The Google Fonts `<link>` tags stay in
  `index.html` as the online fallback. Font-CDN failures do not fail the build.
* `tools/patch_manifest.py` adds `VIBRATE` and `USE_EXACT_ALARM`. The other permissions
  (`POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`)
  come from the local-notifications plugin's own manifest.
* The app icon is drawn at build time with Pillow into every mipmap density.

## Tests

`tools/smoke_test.js` drives the page in headless Chromium: capture, escaping of typed
text, queue persistence, +1 Hr, Done/Cancel, interval maths, layout. It needs Playwright
available to Node on the machine running it.

```bash
npm run www && node tools/smoke_test.js
```

## Known limits

* The APK is a **debug** build (debug-signed). It installs by sideloading; it is not
  Play-Store-ready.
* Android only. The web page itself runs anywhere, but without Capacitor there are no
  background alarms — only the in-app alert loop while the page is open.
* Reminders live in the browser storage of the app. Clearing the app's data clears them.
