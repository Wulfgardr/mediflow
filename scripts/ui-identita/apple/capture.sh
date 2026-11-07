#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
scratch=/Volumes/Vision/mf-ui-identita-20261107-scratch/apple
mkdir -p "$scratch"
finish() {
  result=$?
  xcrun simctl shutdown all > "$scratch/shutdown.log" 2>&1 || true
  echo "$result" > "$scratch/capture-exit-code.txt"
}
trap finish EXIT
test -f /Users/leonardopegollo/Antigravity/mf-ui-identita-20261107/BANCO.md
xcodebuild -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj -scheme MediFlowMobileApp -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$scratch/DerivedData" -clonedSourcePackagesDirPath "$scratch/packages" CODE_SIGNING_ALLOWED=NO build > "$scratch/build-ios.log" 2>&1
status=0
for spec in 'ios-iphone:39C682EE-A9B7-4AE2-AF1F-840D44658BB6' 'ios-ipad:FB0654D2-8CC3-49F3-9406-903F2BD54241'; do
  device=${spec%%:*}; udid=${spec#*:}
  platform=ios; [ "$device" != ios-ipad ] || platform=ipados
  python3 scripts/ui-identita/apple/configure.py "$platform"
  python3 scripts/ui-identita/apple/prepare.py
  xcrun simctl boot "$udid" || true
  perl -e 'alarm 180; exec @ARGV' xcrun simctl bootstatus "$udid" -b
  sleep 5
  python3 scripts/ui-identita/apple/run-capture.py "$device" "$udid" || status=1
  python3 scripts/ui-identita/apple/export.py "$device" || status=1
  xcrun simctl shutdown "$udid" || true
done
exit "$status"
