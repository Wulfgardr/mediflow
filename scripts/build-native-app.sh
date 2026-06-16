#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/native/MediFlowMac"
BUILD_DIR="$PACKAGE_DIR/Build"
APP_DIR="$BUILD_DIR/MediFlowMac.app"
APP_CONTENTS="$APP_DIR/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
WEB_RUNTIME_DIR="$APP_RESOURCES/WebRuntime"

echo "Building MediFlow web runtime (standalone)..."
rm -rf "$WEB_RUNTIME_DIR"
cd "$ROOT_DIR"
npm run build
npm run check:standalone-runtime-bundle

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
rm -rf "$WEB_RUNTIME_DIR"
mkdir -p "$WEB_RUNTIME_DIR"
cp -R "$ROOT_DIR/.next/standalone/." "$WEB_RUNTIME_DIR/"
mkdir -p "$WEB_RUNTIME_DIR/.next"
cp -R "$ROOT_DIR/.next/static" "$WEB_RUNTIME_DIR/.next/static"
if [[ -d "$ROOT_DIR/public" ]]; then
  cp -R "$ROOT_DIR/public" "$WEB_RUNTIME_DIR/public"
fi

if [[ -n "${MEDIFLOW_CODESIGN_IDENTITY:-}" ]]; then
  echo "Signing app bundle with MEDIFLOW_CODESIGN_IDENTITY..."
  if [[ "$MEDIFLOW_CODESIGN_IDENTITY" == "-" ]]; then
    codesign --force --deep --sign - "$APP_DIR"
  else
    codesign --force --deep --options runtime --timestamp --sign "$MEDIFLOW_CODESIGN_IDENTITY" "$APP_DIR"
  fi
fi

if [[ -n "${MEDIFLOW_NOTARY_PROFILE:-}" ]]; then
  if [[ -z "${MEDIFLOW_CODESIGN_IDENTITY:-}" || "${MEDIFLOW_CODESIGN_IDENTITY:-}" == "-" ]]; then
    echo "Notarization requires a Developer ID MEDIFLOW_CODESIGN_IDENTITY, not ad-hoc signing."
    exit 1
  fi
  NOTARY_ZIP="$BUILD_DIR/MediFlowMac-notary.zip"
  rm -f "$NOTARY_ZIP"
  ditto -c -k --keepParent "$APP_DIR" "$NOTARY_ZIP"
  xcrun notarytool submit "$NOTARY_ZIP" --keychain-profile "$MEDIFLOW_NOTARY_PROFILE" --wait || {
    echo "Notarization failed."
    exit 1
  }
  xcrun stapler staple "$APP_DIR"
fi

echo "App bundle created at $APP_DIR"
echo "Web runtime copied to $WEB_RUNTIME_DIR"
