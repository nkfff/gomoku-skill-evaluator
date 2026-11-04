#!/usr/bin/env bash
set -euo pipefail
DMG="$1"
EXPECTED="$2"
case "$EXPECTED" in arm64|x86_64) ;; *) echo "Expected arm64 or x86_64" >&2; exit 2;; esac
hdiutil verify "$DMG"
MOUNT="$(mktemp -d)"
cleanup() {
  hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  rmdir "$MOUNT" >/dev/null 2>&1 || true
}
trap cleanup EXIT
hdiutil attach "$DMG" -readonly -nobrowse -mountpoint "$MOUNT" -quiet
APP="$(find "$MOUNT" -maxdepth 1 -type d -name '*.app' -print -quit)"
if [ -z "$APP" ]; then echo "No .app inside DMG" >&2; exit 1; fi
INFO="$APP/Contents/Info.plist"
EXE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$INFO")"
BIN="$APP/Contents/MacOS/$EXE"
test -f "$APP/Contents/_CodeSignature/CodeResources" || { echo "Missing CodeResources signature seal" >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$APP"
ARCHS="$(lipo -archs "$BIN")"
echo "macOS binary architectures: $ARCHS"
case " $ARCHS " in *" $EXPECTED "*) ;; *) echo "Missing expected architecture $EXPECTED" >&2; exit 1;; esac
if spctl --assess --type execute -vv "$APP"; then
  echo "Gatekeeper trusted the package"
else
  echo "::warning::Code signature is structurally valid, but Gatekeeper does not trust this unsigned/ad-hoc build."
fi
