#!/usr/bin/env bash
#
# release-ios.sh — Build, archive, and upload Ottie iOS to TestFlight.
#
# Prerequisites (one-time):
#   1. Apple Developer Program enrollment ($99/yr).
#   2. App entry in App Store Connect (https://appstoreconnect.apple.com/apps)
#      with bundle identifier = com.ottie.
#   3. App-specific password generated at https://appleid.apple.com/account/manage
#      and stored in macOS keychain:
#
#        xcrun altool --store-password-in-keychain-item AC_PASSWORD \
#                     -u "your-apple-id@example.com" \
#                     -p "abcd-efgh-ijkl-mnop"
#
#      (the script reads it back via @keychain:AC_PASSWORD)
#   4. Xcode + command-line tools installed and selected:
#        sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
#
# Usage:
#   APPLE_ID="you@example.com" scripts/release-ios.sh
#
#   # Override build number (useful when uploading 1.2.0 a second time):
#   APPLE_ID=... IOS_BUILD_NUMBER=2 scripts/release-ios.sh
#
# Output:
#   /tmp/ottie-ios-export/Ottie.ipa   (also uploaded to App Store Connect)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
APP_DIR="$REPO_ROOT/packages/app"
EXPORT_OPTIONS="$APP_DIR/ios-export-options/AppStore.plist"

# Default APPLE_ID can be overridden via env. We don't put a value here —
# the user has to supply it so the upload step doesn't break silently.
: "${APPLE_ID:?Set APPLE_ID env var to your Apple Developer account email}"

# CFBundleVersion. Fall back to a UTC timestamp so re-runs always produce
# a fresh upload that App Store Connect won't reject as a duplicate.
: "${IOS_BUILD_NUMBER:=$(date -u +%Y%m%d%H%M)}"
export IOS_BUILD_NUMBER
echo "==> CFBundleVersion (IOS_BUILD_NUMBER) = $IOS_BUILD_NUMBER"

VERSION=$(node -p "require('$APP_DIR/package.json').version")
echo "==> Marketing version = $VERSION"

ARCHIVE_PATH="/tmp/Ottie-$VERSION-$IOS_BUILD_NUMBER.xcarchive"
EXPORT_DIR="/tmp/ottie-ios-export"

cd "$APP_DIR"

echo
echo "==> 1. expo prebuild (regenerates ios/ from app.config.js)"
APP_VARIANT=production npx expo prebuild --platform ios --clean

echo
echo "==> 2. pod install"
cd "$APP_DIR/ios"
pod install

echo
echo "==> 3. xcodebuild archive (generic iOS device)"
xcodebuild -workspace Ottie.xcworkspace \
  -scheme Ottie \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=iOS" \
  -allowProvisioningUpdates \
  archive

echo
echo "==> 4. Export .ipa with method=app-store-connect"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates

IPA_PATH="$EXPORT_DIR/Ottie.ipa"
if [ ! -f "$IPA_PATH" ]; then
  echo "error: expected $IPA_PATH but it was not produced"
  exit 1
fi

echo
echo "==> 5. Upload to App Store Connect (this is what flips into TestFlight)"
xcrun altool --upload-app \
  --type ios \
  --file "$IPA_PATH" \
  --username "$APPLE_ID" \
  --password "@keychain:AC_PASSWORD"

echo
echo "==> done"
echo "IPA:    $IPA_PATH"
echo "Upload: ~10–20 min for App Store Connect to finish processing."
echo "Then go to https://appstoreconnect.apple.com → Apps → Ottie → TestFlight"
echo "to add testers and ship the build."
