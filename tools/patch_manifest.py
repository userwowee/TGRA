#!/usr/bin/env python3
"""Add the permissions e-Walnut needs on top of the ones @capacitor/local-notifications
already contributes (RECEIVE_BOOT_COMPLETED, WAKE_LOCK, POST_NOTIFICATIONS,
SCHEDULE_EXACT_ALARM). Idempotent, so re-running `cap add android` is safe."""
import io
import sys

MANIFEST = "android/app/src/main/AndroidManifest.xml"

PERMISSIONS = [
    # navigator.vibrate() and the notification channel's vibration pattern
    "android.permission.VIBRATE",
    # API 33+: an alarm/reminder app gets exact alarms without the user having to
    # grant SCHEDULE_EXACT_ALARM in system settings
    "android.permission.USE_EXACT_ALARM",
]


def main():
    with io.open(MANIFEST, encoding="utf-8") as fh:
        xml = fh.read()

    added = []
    for permission in PERMISSIONS:
        if permission in xml:
            continue
        line = '    <uses-permission android:name="%s" />\n' % permission
        xml = xml.replace("</manifest>", line + "</manifest>")
        added.append(permission)

    with io.open(MANIFEST, "w", encoding="utf-8") as fh:
        fh.write(xml)

    print("added: %s" % (", ".join(added) if added else "nothing (already present)"))


if __name__ == "__main__":
    try:
        main()
    except IOError as exc:
        sys.exit("cannot patch %s: %s" % (MANIFEST, exc))
