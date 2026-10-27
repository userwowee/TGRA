#!/usr/bin/env python3
"""Download the web fonts used by index.html into www/fonts so the APK renders
offline. Emits www/fonts/fonts.css with local src() paths. Best effort: the
Google Fonts <link> tags in index.html remain as an online fallback."""
import os
import re
import sys
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

SHEETS = [
    "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap",
    "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,600,0..1,0",
]

OUT_DIR = os.path.join("www", "fonts")
LATIN_MARKER = "U+0000-00FF"


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    return data if binary else data.decode("utf-8")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    blocks_out = []
    downloaded = {}

    for sheet_url in SHEETS:
        css = fetch(sheet_url)
        for block in re.findall(r"@font-face\s*\{[^}]*\}", css):
            # Keep only latin (and range-less icon fonts) to stay small.
            ranges = re.search(r"unicode-range:\s*([^;]+);", block)
            if ranges and LATIN_MARKER not in ranges.group(1):
                continue

            def localize(match):
                url = match.group(1)
                name = downloaded.get(url)
                if not name:
                    name = "%s.woff2" % re.sub(r"[^A-Za-z0-9]+", "-",
                                               url.rsplit("/", 2)[-2] + "-" +
                                               str(len(downloaded)))
                    with open(os.path.join(OUT_DIR, name), "wb") as fh:
                        fh.write(fetch(url, binary=True))
                    downloaded[url] = name
                return "url(%s)" % name

            blocks_out.append(re.sub(r"url\((https://fonts\.gstatic\.com[^)]+)\)",
                                     localize, block))

    if not blocks_out:
        raise RuntimeError("no @font-face blocks matched")

    with open(os.path.join(OUT_DIR, "fonts.css"), "w") as fh:
        fh.write("/* Generated at build time - offline copies of the web fonts. */\n")
        fh.write("\n".join(blocks_out))
        fh.write("\n")

    print("bundled %d font files into %s" % (len(downloaded), OUT_DIR))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - build must not fail on font CDN issues
        print("WARNING: font bundling skipped: %s" % exc, file=sys.stderr)
