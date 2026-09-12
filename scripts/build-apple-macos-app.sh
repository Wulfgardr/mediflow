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
STAGE_EXECUTION_MAC_ASSETS="$ROOT_DIR/scripts/stage-chatgpt-execution-mac-assets.ts"
PROJECT="$ROOT_DIR/native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj"
SCHEME="MediFlowMacApp"
CONFIG="${MEDIFLOW_MAC_CONFIG:-Debug}"
DERIVED="${MEDIFLOW_MAC_DERIVED_DATA:-$ROOT_DIR/tmp-mac-derived-data}"

# xcodebuild needs a full Xcode (the Liquid Glass code needs the 26 SDK).
# @Codex: an explicit per-command toolchain must win over global selection.
if [[ -z "${DEVELOPER_DIR:-}" ]] && { [[ "$(xcode-select -p 2>/dev/null)" == *CommandLineTools* ]] || ! command -v xcodebuild >/dev/null 2>&1; }; then
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

# @Codex: a caller must provide every public staging input explicitly. Without
# them an already-staged standalone payload is reused unchanged, if present.
EXECUTION_MAC_STAGE_VARS=(
  MEDIFLOW_CHATGPT_EXECUTION_BINARY
  MEDIFLOW_CHATGPT_EXECUTION_NATIVE_SOURCE
  MEDIFLOW_CHATGPT_EXECUTION_SCHEMA_DIRECTORY
  MEDIFLOW_CHATGPT_EXECUTION_C1_RECEIPT
)
EXECUTION_MAC_STAGE_COUNT=0
for variable in "${EXECUTION_MAC_STAGE_VARS[@]}"; do [[ -n "${!variable:-}" ]] && ((EXECUTION_MAC_STAGE_COUNT+=1)); done
if (( EXECUTION_MAC_STAGE_COUNT != 0 && EXECUTION_MAC_STAGE_COUNT != ${#EXECUTION_MAC_STAGE_VARS[@]} )); then
  echo "Incomplete explicit ChatGPT execution Mac asset staging inputs." >&2
  exit 1
fi
if (( EXECUTION_MAC_STAGE_COUNT == ${#EXECUTION_MAC_STAGE_VARS[@]} )); then
  node "$ROOT_DIR/scripts/run-strip-types.mjs" "$STAGE_EXECUTION_MAC_ASSETS" \
    --installation-root "$STANDALONE_DIR" \
    --binary "$MEDIFLOW_CHATGPT_EXECUTION_BINARY" \
    --native-source "$MEDIFLOW_CHATGPT_EXECUTION_NATIVE_SOURCE" \
    --schema-directory "$MEDIFLOW_CHATGPT_EXECUTION_SCHEMA_DIRECTORY" \
    --c1-receipt "$MEDIFLOW_CHATGPT_EXECUTION_C1_RECEIPT"
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
  -jobs 2 build CODE_SIGNING_ALLOWED=NO ARCHS="$XCODE_ARCH" ONLY_ACTIVE_ARCH=YES \
  'OTHER_SWIFT_FLAGS=$(inherited) -j2'

APP="$DERIVED/Build/Products/$CONFIG/MediFlow.app"
[[ -d "$APP" ]] || { echo "Build failed: $APP not found" >&2; exit 1; }

# 3. Inject the WebRuntime + the TLS proxy script into the bundle
RES="$APP/Contents/Resources"
WEB="$RES/WebRuntime"
FRAMEWORKS="$APP/Contents/Frameworks"
WEB_NATIVE_TARGETS=(
  "$FRAMEWORKS/mediflow-web-libvips.dylib"
  "$FRAMEWORKS/mediflow-web-anydoc.node"
  "$FRAMEWORKS/mediflow-web-sharp.node"
  "$FRAMEWORKS/mediflow-web-canvas.node"
  "$FRAMEWORKS/mediflow-web-better-sqlite3.node"
  "$FRAMEWORKS/mediflow-web-fsevents.node"
)
echo "Injecting WebRuntime into the app bundle..."
rm -rf "$WEB"
mkdir -p "$WEB/.next"
cp -R "$STANDALONE_DIR/." "$WEB/"
# @Codex: merge contents when a reused standalone already includes these assets.
mkdir -p "$WEB/.next/static"
cp -R "$ROOT_DIR/$NEXT_DIST_DIR/static/." "$WEB/.next/static/"
if [[ -d "$ROOT_DIR/public" ]]; then
  mkdir -p "$WEB/public"
  cp -R "$ROOT_DIR/public/." "$WEB/public/"
fi
cp "$ROOT_DIR/scripts/local-api-tls-proxy.mjs" "$RES/local-api-tls-proxy.mjs"
"$ROOT_DIR/scripts/check-macos-web-runtime-native-payload.sh" --normalize --web-runtime "$WEB" --frameworks "$FRAMEWORKS"

# 4. Optional codesign (so the injected runtime is covered for distribution)
if [[ -n "${MEDIFLOW_CODESIGN_IDENTITY:-}" ]]; then
  echo "Codesigning ($MEDIFLOW_CODESIGN_IDENTITY)..."
  if [[ "$MEDIFLOW_CODESIGN_IDENTITY" == "-" ]]; then
    SIGN_ARGS=(--force --sign -)
  else
    SIGN_ARGS=(--force --options runtime --timestamp --sign "$MEDIFLOW_CODESIGN_IDENTITY")
  fi
  # @Codex: sign nested code inside-out; --deep is verification-only here.
  for native_code in "${WEB_NATIVE_TARGETS[@]}"; do
    codesign "${SIGN_ARGS[@]}" "$native_code"
    codesign --verify --strict "$native_code"
  done
  codesign "${SIGN_ARGS[@]}" "$APP"
  codesign --verify --deep --strict "$APP"
fi

echo "Runnable macOS app: $APP"
echo "WebRuntime: $WEB/server.js"
