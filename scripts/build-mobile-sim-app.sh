#!/bin/bash
set -euo pipefail

# @Codex
# Build the tracked Xcode project without regenerating it or booting a device.
# Stdout is the absolute app path on success; build/install diagnostics go to stderr.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PROJECT="$ROOT_DIR/native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj"
DERIVED="${MEDIFLOW_IOS_DERIVED_DATA:-$ROOT_DIR/tmp-ios-sim-dd}"
SIMULATOR_ID="${MEDIFLOW_IOS_SIMULATOR_ID:-}"
BUNDLE_ID="${MEDIFLOW_IOS_BUNDLE_ID:-com.mediflow.mobile}"
INSTALL=0

fail() { echo "Simulator build: $1" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: bash scripts/build-mobile-sim-app.sh [--install]

Builds MediFlowMobileApp (Debug, iOS Simulator) with the selected Xcode SDK's
default simulator signing. This ad-hoc simulator signature is not distribution signing.
--install also installs onto MEDIFLOW_IOS_SIMULATOR_ID, an already-booted iOS
simulator UDID. Never boots or launches a simulator/app. Installation needs Node 24.
DEVELOPER_DIR selects Xcode; an explicit value is never replaced.
MEDIFLOW_IOS_DERIVED_DATA overrides tmp-ios-sim-dd (relative to the repository).
MEDIFLOW_IOS_BUNDLE_ID is an expected bundle identifier, not a build override.
On success stdout contains only the absolute app path.
EOF
}
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --install) INSTALL=1; shift ;;
esac
[[ "$#" -eq 0 ]] || { usage >&2; exit 2; }
[[ -f "$PROJECT/project.pbxproj" ]] || fail "Missing tracked Xcode project: $PROJECT"
if [[ "$INSTALL" -eq 1 ]]; then
  [[ "$SIMULATOR_ID" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] \
    || fail "--install requires an explicit MEDIFLOW_IOS_SIMULATOR_ID UDID."
  command -v node >/dev/null 2>&1 || fail "--install requires Node 24 on PATH."
fi

# Use the same selected toolchain as the caller's simctl. Never change xcode-select.
SDK_VERSION="$(xcrun --sdk iphonesimulator --show-sdk-version 2>/dev/null)" \
  || fail "Full Xcode with iOS Simulator SDK 26+ is required; set DEVELOPER_DIR to its Contents/Developer directory."
SDK_MAJOR="${SDK_VERSION%%.*}"
[[ "$SDK_MAJOR" =~ ^[0-9]+$ ]] && [[ "$SDK_MAJOR" -ge 26 ]] \
  || fail "iOS Simulator SDK 26+ is required (found $SDK_VERSION)."

if [[ "$INSTALL" -eq 1 ]]; then
  xcrun simctl list devices available -j | node -e '
    const fs = require("fs");
    const runtimes = JSON.parse(fs.readFileSync(0, "utf8")).devices || {};
    const devices = Object.entries(runtimes)
      .filter(([runtime]) => runtime.includes(".SimRuntime.iOS-"))
      .flatMap(([, items]) => items);
    process.exit(devices.some((item) => item.udid === process.argv[1]
      && item.isAvailable === true && item.state === "Booted") ? 0 : 1);
  ' "$SIMULATOR_ID" || fail "Requested simulator must be available, iOS and already booted; no device was booted."
fi

mkdir -p "$DERIVED"
DERIVED="$(cd "$DERIVED" && pwd)"
echo "Building MediFlowMobileApp (Debug, iOS Simulator SDK $SDK_VERSION)..." >&2
xcodebuild -project "$PROJECT" -scheme MediFlowMobileApp -configuration Debug \
  -derivedDataPath "$DERIVED" -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build >&2

APP="$DERIVED/Build/Products/Debug-iphonesimulator/MediFlow.app"
PLIST="$APP/Info.plist"
[[ -f "$PLIST" ]] || fail "Build did not produce $PLIST"
ACTUAL_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")"
[[ "$ACTUAL_BUNDLE_ID" == "$BUNDLE_ID" ]] || fail "Bundle identifier mismatch: expected $BUNDLE_ID, found $ACTUAL_BUNDLE_ID."
PLATFORM="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$PLIST")"
[[ "$PLATFORM" == iPhoneSimulator ]] || fail "Expected an iPhoneSimulator app, found $PLATFORM."
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PLIST")"
[[ -n "$EXECUTABLE" && -x "$APP/$EXECUTABLE" ]] || fail "Missing app executable."

if [[ "$INSTALL" -eq 1 ]]; then
  echo "Installing $BUNDLE_ID on $SIMULATOR_ID..." >&2
  xcrun simctl install "$SIMULATOR_ID" "$APP" >&2
fi
printf '%s\n' "$APP"
