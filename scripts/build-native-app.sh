#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/native/MediFlowMac"
BUILD_DIR="$PACKAGE_DIR/Build"
APP_DIR="$BUILD_DIR/MediFlowMac.app"
APP_CONTENTS="$APP_DIR/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"

cd "$PACKAGE_DIR"

echo "Building MediFlowMac (release)..."
swift build -c release

BIN_PATH="$PACKAGE_DIR/.build/release/MediFlowMac"
if [[ ! -f "$BIN_PATH" ]]; then
  echo "Build failed: binary not found at $BIN_PATH"
  exit 1
fi

mkdir -p "$APP_MACOS" "$APP_RESOURCES"

cat > "$APP_CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>MediFlow</string>
  <key>CFBundleDisplayName</key>
  <string>MediFlow</string>
  <key>CFBundleIdentifier</key>
  <string>com.mediflow.mac</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleExecutable</key>
  <string>MediFlowMac</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "$APP_CONTENTS/PkgInfo" <<PKG
APPL????
PKG

cp "$BIN_PATH" "$APP_MACOS/MediFlowMac"
chmod +x "$APP_MACOS/MediFlowMac"
cp "$ROOT_DIR/scripts/local-api-tls-proxy.mjs" "$APP_RESOURCES/local-api-tls-proxy.mjs"

echo "App bundle created at $APP_DIR"
