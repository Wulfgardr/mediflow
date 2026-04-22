#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_PATH="$ROOT_DIR/native/MediFlowMac/.swiftpm/xcode/package.xcworkspace"
SCHEME="${MEDIFLOW_IOS_SCHEME:-MediFlowMobile}"
DESTINATION="${MEDIFLOW_IOS_DESTINATION:-platform=iOS Simulator,name=iPad Pro 11-inch (M5)}"
DERIVED_DATA_DIR="${MEDIFLOW_IOS_DERIVED_DATA_DIR:-$ROOT_DIR/tmp-ios-derived-data}"
BUILD_CONFIGURATION="${MEDIFLOW_IOS_CONFIGURATION:-Debug}"
EXECUTABLE_NAME="${MEDIFLOW_IOS_EXECUTABLE_NAME:-MediFlowMobile}"
APP_DIR="${MEDIFLOW_IOS_APP_DIR:-$ROOT_DIR/native/MediFlowMac/Build/iOS-Simulator/MediFlowMobile.app}"
BUNDLE_ID="${MEDIFLOW_IOS_BUNDLE_ID:-com.mediflow.mobile}"
DISPLAY_NAME="${MEDIFLOW_IOS_DISPLAY_NAME:-MediFlow}"
SHORT_VERSION="${MEDIFLOW_IOS_SHORT_VERSION:-0.1.0}"
BUILD_VERSION="${MEDIFLOW_IOS_BUILD_VERSION:-1}"
SIMULATOR_ID="${MEDIFLOW_IOS_SIMULATOR_ID:-}"
LOCAL_NETWORK_USAGE_DESCRIPTION="${MEDIFLOW_IOS_LOCAL_NETWORK_USAGE_DESCRIPTION:-MediFlow cerca il tuo home-base sulla rete locale per collegarsi in modo paired e cifrato.}"
BONJOUR_SERVICE_TYPE="${MEDIFLOW_IOS_BONJOUR_SERVICE_TYPE:-_mediflow-homebase._tcp}"

PRODUCTS_DIR="$DERIVED_DATA_DIR/Build/Products/${BUILD_CONFIGURATION}-iphonesimulator"
EXECUTABLE_PATH="$PRODUCTS_DIR/$EXECUTABLE_NAME"
PACKAGE_FRAMEWORKS_DIR="$PRODUCTS_DIR/PackageFrameworks"

echo "Building $SCHEME for iOS Simulator..."
xcodebuild \
  -workspace "$WORKSPACE_PATH" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_DIR" \
  build

if [[ ! -f "$EXECUTABLE_PATH" ]]; then
  echo "Build failed: executable not found at $EXECUTABLE_PATH"
  exit 1
fi

if [[ -d "$PACKAGE_FRAMEWORKS_DIR" ]] && find "$PACKAGE_FRAMEWORKS_DIR" -mindepth 1 -print -quit | grep -q .; then
  echo "Packaging aborted: dynamic frameworks found in $PACKAGE_FRAMEWORKS_DIR."
  echo "This script currently supports simulator bundles without external package frameworks."
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
cp "$EXECUTABLE_PATH" "$APP_DIR/$EXECUTABLE_NAME"
chmod +x "$APP_DIR/$EXECUTABLE_NAME"

cat > "$APP_DIR/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${DISPLAY_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>${EXECUTABLE_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${DISPLAY_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${SHORT_VERSION}</string>
  <key>CFBundleSupportedPlatforms</key>
  <array>
    <string>iPhoneSimulator</string>
  </array>
  <key>CFBundleVersion</key>
  <string>${BUILD_VERSION}</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.medical</string>
  <key>LSRequiresIPhoneOS</key>
  <true/>
  <key>MinimumOSVersion</key>
  <string>17.0</string>
  <key>NSBonjourServices</key>
  <array>
    <string>${BONJOUR_SERVICE_TYPE}</string>
  </array>
  <key>NSLocalNetworkUsageDescription</key>
  <string>${LOCAL_NETWORK_USAGE_DESCRIPTION}</string>
  <key>UIApplicationSupportsIndirectInputEvents</key>
  <true/>
  <key>UIDeviceFamily</key>
  <array>
    <integer>1</integer>
    <integer>2</integer>
  </array>
</dict>
</plist>
PLIST

cat > "$APP_DIR/PkgInfo" <<PKG
APPL????
PKG

plutil -lint "$APP_DIR/Info.plist" >/dev/null

echo "Simulator app bundle created at $APP_DIR"

if [[ -n "$SIMULATOR_ID" ]]; then
  echo "Installing $BUNDLE_ID on simulator $SIMULATOR_ID ..."
  xcrun simctl uninstall "$SIMULATOR_ID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$SIMULATOR_ID" "$APP_DIR"
  echo "Installed on simulator $SIMULATOR_ID"
fi
