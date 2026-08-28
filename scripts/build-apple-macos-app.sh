#!/bin/bash
# Build a runnable macOS MediFlow.app: the Xcode MediFlowMacApp scheme plus the
# bundled Next.js WebRuntime (home-base server) the supervisor launches at
# runtime. Kept separate from the plain xcodebuild / CI path so CI stays fast and
# npm-free; this is the "make a runnable / release app" step.
#
# Node is NOT bundled: the supervisor resolves system node (or MEDIFLOW_NODE_BINARY).
#
# Env:
#   MEDIFLOW_SKIP_WEB_BUILD=1     reuse an existing .next/standalone (fast iteration)
#   MEDIFLOW_MAC_CONFIG=Release   build configuration (default Debug)
#   MEDIFLOW_CODESIGN_IDENTITY    sign the bundle (incl. the injected runtime);
#                                 "-" for ad-hoc, or a Developer ID. Unset = no sign
#                                 (fine for a local run of a locally built app).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXT_DIST_DIR="${MEDIFLOW_NEXT_DIST_DIR:-.next}"
STANDALONE_DIR="$ROOT_DIR/$NEXT_DIST_DIR/standalone"
PROJECT="$ROOT_DIR/native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj"
SCHEME="MediFlowMacApp"
CONFIG="${MEDIFLOW_MAC_CONFIG:-Debug}"
DERIVED="${MEDIFLOW_MAC_DERIVED_DATA:-$ROOT_DIR/tmp-mac-derived-data}"

# xcodebuild needs a full Xcode (the Liquid Glass code needs the 26 SDK).
if [[ "$(xcode-select -p 2>/dev/null)" == *CommandLineTools* ]] || ! command -v xcodebuild >/dev/null 2>&1; then
  for dev in /Applications/Xcode.app/Contents/Developer /Applications/Xcode-beta.app/Contents/Developer; do
    [[ -d "$dev" ]] && export DEVELOPER_DIR="$dev" && break
  done
fi

# 1. Web runtime (Next.js standalone)
if [[ "${MEDIFLOW_SKIP_WEB_BUILD:-0}" != "1" ]]; then
  echo "Building web runtime (next build, standalone)..."
  # @Codex: webpack supports the repository's sibling-worktree node_modules
  # layout; Turbopack rejects dependencies resolved outside the worktree root.
  ( cd "$ROOT_DIR" && npm run build -- --webpack )
fi
( cd "$ROOT_DIR" && npm run check:standalone-runtime-bundle )
if [[ ! -f "$STANDALONE_DIR/server.js" ]]; then
  echo "Missing $NEXT_DIST_DIR/standalone/server.js. Run 'npm run build' first (or unset MEDIFLOW_SKIP_WEB_BUILD)." >&2
  exit 1
fi

# @Codex: better-sqlite3 is architecture-specific, so the app executable must
# match the WebRuntime built by the active Node process.
case "$(node -p 'process.arch')" in
  arm64) XCODE_ARCH="arm64" ;;
  x64) XCODE_ARCH="x86_64" ;;
  *) echo "Unsupported Node architecture for MediFlowMac bundle." >&2; exit 1 ;;
esac

# 2. Regenerate the project (+ guards) and build the macOS app
"$ROOT_DIR/scripts/generate-apple-xcodeproj.sh"
echo "Building $SCHEME ($CONFIG)..."
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration "$CONFIG" \
  -derivedDataPath "$DERIVED" -destination "platform=macOS,arch=$XCODE_ARCH" \
  build CODE_SIGNING_ALLOWED=NO ARCHS="$XCODE_ARCH" ONLY_ACTIVE_ARCH=YES

APP="$DERIVED/Build/Products/$CONFIG/MediFlow.app"
[[ -d "$APP" ]] || { echo "Build failed: $APP not found" >&2; exit 1; }

# 3. Inject the WebRuntime + the TLS proxy script into the bundle
RES="$APP/Contents/Resources"
WEB="$RES/WebRuntime"
echo "Injecting WebRuntime into the app bundle..."
rm -rf "$WEB"
mkdir -p "$WEB/.next"
cp -R "$STANDALONE_DIR/." "$WEB/"
cp -R "$ROOT_DIR/$NEXT_DIST_DIR/static" "$WEB/.next/static"
[[ -d "$ROOT_DIR/public" ]] && cp -R "$ROOT_DIR/public" "$WEB/public"
cp "$ROOT_DIR/scripts/local-api-tls-proxy.mjs" "$RES/local-api-tls-proxy.mjs"
"$ROOT_DIR/scripts/check-macos-web-runtime-native-payload.sh" --normalize --web-runtime "$WEB"

# 4. Optional codesign (so the injected runtime is covered for distribution)
if [[ -n "${MEDIFLOW_CODESIGN_IDENTITY:-}" ]]; then
  echo "Codesigning ($MEDIFLOW_CODESIGN_IDENTITY)..."
  if [[ "$MEDIFLOW_CODESIGN_IDENTITY" == "-" ]]; then
    codesign --force --deep --sign - "$APP"
  else
    codesign --force --deep --options runtime --timestamp --sign "$MEDIFLOW_CODESIGN_IDENTITY" "$APP"
  fi
fi

echo "Runnable macOS app: $APP"
echo "WebRuntime: $WEB/server.js"
