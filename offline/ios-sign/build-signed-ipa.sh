#!/usr/bin/env bash
set -euo pipefail
# GitHub Secrets required; never commit credentials or profiles.
: "$APPLE_TEAM_ID" "$IOS_DISTRIBUTION_P12_BASE64" "$IOS_DISTRIBUTION_P12_PASSWORD" "$IOS_ADHOC_MOBILEPROVISION_BASE64"
APP_ID="io.github.nkfff.gomoku.offline"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
KEYCHAIN="$WORK/signing.keychain-db"
KEYCHAIN_PASSWORD="$(uuidgen)"
cleanup() {
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
printf %s "$IOS_DISTRIBUTION_P12_BASE64" | base64 -D > "$WORK/certificate.p12"
printf %s "$IOS_ADHOC_MOBILEPROVISION_BASE64" | base64 -D > "$WORK/profile.mobileprovision"
security cms -D -i "$WORK/profile.mobileprovision" > "$WORK/profile.plist"

PROFILE_NAME="$(python3 - "$WORK/profile.plist" "$WORK/ExportOptions.plist" "$APPLE_TEAM_ID" "$APP_ID" <<'PY'
import plistlib, sys
src,dst,team,bundle=sys.argv[1:]
with open(src,"rb") as f: profile=plistlib.load(f)
teams=profile.get("TeamIdentifier",[])
appid=profile.get("Entitlements",{}).get("application-identifier","")
devices=profile.get("ProvisionedDevices",[])
if team not in teams: raise SystemExit("Profile Team ID mismatch")
if appid != team+"."+bundle: raise SystemExit("Profile Bundle ID mismatch")
if not devices: raise SystemExit("Ad Hoc profile must register target iPhone UDIDs")
name=profile.get("Name")
if not name: raise SystemExit("Profile has no name")
opts={"method":"release-testing","teamID":team,"signingStyle":"manual",
      "signingCertificate":"Apple Distribution","provisioningProfiles":{bundle:name},
      "destination":"export","manageAppVersionAndBuildNumber":False}
with open(dst,"wb") as f: plistlib.dump(opts,f)
print(name)
print("Valid profile. Number of registered devices:",len(devices),file=sys.stderr)
PY
)"
mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
UUID="$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$WORK/profile.plist")"
cp "$WORK/profile.mobileprovision" "$HOME/Library/MobileDevice/Provisioning Profiles/$UUID.mobileprovision"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security list-keychains -d user -s "$KEYCHAIN"
security default-keychain -s "$KEYCHAIN"
security import "$WORK/certificate.p12" -k "$KEYCHAIN" -P "$IOS_DISTRIBUTION_P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security find-identity -v -p codesigning "$KEYCHAIN" | grep -q 'Apple Distribution' || {
  echo "No Apple Distribution identity in imported P12" >&2; exit 1;
}
cd "$ROOT"
npm run native:ios
xcodebuild archive \
  -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$WORK/GomokuOffline.xcarchive" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="Apple Distribution" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" PROVISIONING_PROFILE_SPECIFIER="$PROFILE_NAME" \
  PRODUCT_BUNDLE_IDENTIFIER="$APP_ID" archive
xcodebuild -exportArchive -archivePath "$WORK/GomokuOffline.xcarchive" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" -exportPath "$WORK/export"
IPA="$(find "$WORK/export" -maxdepth 1 -name '*.ipa' -type f -print -quit)"
test -n "$IPA" && test -s "$IPA" || { echo "Signed IPA was not produced" >&2; exit 1; }
mkdir -p "$WORK/check"
unzip -q "$IPA" 'Payload/*' -d "$WORK/check"
APP="$(find "$WORK/check/Payload" -mindepth 1 -maxdepth 1 -type d -name '*.app' -print -quit)"
test -n "$APP" || { echo "IPA does not contain an .app" >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$APP"
test -s "$APP/embedded.mobileprovision" || { echo "Missing embedded profile" >&2; exit 1; }
OUTPUT="$GITHUB_WORKSPACE/release-assets"
mkdir -p "$OUTPUT"
cp "$IPA" "$OUTPUT/Gomoku_Offline_iPhone_AdHoc_$RELEASE_TAG.ipa"
shasum -a 256 "$OUTPUT/Gomoku_Offline_iPhone_AdHoc_$RELEASE_TAG.ipa" > "$OUTPUT/SHA256-iPhone.txt"
echo "Verified signed Ad Hoc IPA for registered iPhone devices."
