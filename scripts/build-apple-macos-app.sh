#!/bin/bash
# Build a runnable macOS MediFlow.app: the Xcode MediFlowMacApp scheme plus the
# bundled Next.js WebRuntime (home-base server) the supervisor launches at
# runtime. Kept separate from the plain xcodebuild / CI path so CI stays fast and
# npm-free; this is the "make a runnable / release app" step.
#
# Node is NOT bundled: the supervisor resolves system node (or MEDIFLOW_NODE_BINARY).
#
# Env:
#   MEDIFLOW_SKIP_WEB_BUILD=1     reuse a matching payload with recorded build identity
#   MEDIFLOW_MAC_CONFIG=Release   build configuration (default Debug)
#   MEDIFLOW_CODESIGN_IDENTITY    sign the bundle (incl. the injected runtime);
#                                 "-" for ad-hoc, or a Developer ID. Unset = no sign
#                                 (fine for a local run of a locally built app).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
NEXT_DIST_DIR="${MEDIFLOW_NEXT_DIST_DIR:-.next}"
STANDALONE_DIR="$ROOT_DIR/$NEXT_DIST_DIR/standalone"
STAGE_EXECUTION_MAC_ASSETS="$ROOT_DIR/scripts/stage-chatgpt-execution-mac-assets.ts"
PROJECT="$ROOT_DIR/native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj"
SCHEME="MediFlowMacApp"
CONFIG="${MEDIFLOW_MAC_CONFIG:-Debug}"
DERIVED="${MEDIFLOW_MAC_DERIVED_DATA:-$ROOT_DIR/tmp-mac-derived-data}"
APP="$DERIVED/Build/Products/$CONFIG/MediFlow.app"
IDENTITY_HELPER="$ROOT_DIR/scripts/launcher-helpers.mjs"
BUILD_IDENTITY_FILE="$STANDALONE_DIR/mediflow-build-identity.json"

# @Codex: use the shared launcher identity rather than a packaging-specific Git
# formula, then make the exact source visible to the bundled standalone server.
CURRENT_APP_REVISION=""
CURRENT_APP_BRANCH=""
CURRENT_APP_WORKTREE_HASH=""
CURRENT_APP_SOURCE_FINGERPRINT=""
read_checkout_identity() {
  if ! CURRENT_APP_REVISION="$(node "$IDENTITY_HELPER" identity-field revision)" \
    || ! CURRENT_APP_BRANCH="$(node "$IDENTITY_HELPER" identity-field branch)" \
    || ! CURRENT_APP_WORKTREE_HASH="$(node "$IDENTITY_HELPER" identity-field worktreeHash)" \
    || ! CURRENT_APP_SOURCE_FINGERPRINT="$(node "$IDENTITY_HELPER" identity-field sourceFingerprint)" \
    || [[ -z "$CURRENT_APP_REVISION" || -z "$CURRENT_APP_BRANCH" || -z "$CURRENT_APP_WORKTREE_HASH" || -z "$CURRENT_APP_SOURCE_FINGERPRINT" ]] \
    || [[ "$CURRENT_APP_REVISION" == "unknown" || "$CURRENT_APP_BRANCH" == "unknown" ]] \
    || [[ "$CURRENT_APP_SOURCE_FINGERPRINT" != "$CURRENT_APP_BRANCH@$CURRENT_APP_REVISION:$CURRENT_APP_WORKTREE_HASH" ]]; then
    echo "Impossibile determinare un'identita completa del checkout per il bundle macOS." >&2
    return 1
  fi
}

read_checkout_identity
INITIAL_APP_REVISION="$CURRENT_APP_REVISION"
INITIAL_APP_BRANCH="$CURRENT_APP_BRANCH"
INITIAL_APP_WORKTREE_HASH="$CURRENT_APP_WORKTREE_HASH"
INITIAL_APP_SOURCE_FINGERPRINT="$CURRENT_APP_SOURCE_FINGERPRINT"

# @Codex: skipped Web builds may reuse only a payload sealed by this script's
# full-build path. This is provenance for local packaging, not a content digest.
write_build_identity() {
node - "$BUILD_IDENTITY_FILE" "$ROOT_DIR/$NEXT_DIST_DIR/BUILD_ID" "$STANDALONE_DIR/.next/BUILD_ID" \
  "$INITIAL_APP_REVISION" "$INITIAL_APP_BRANCH" "$INITIAL_APP_WORKTREE_HASH" "$INITIAL_APP_SOURCE_FINGERPRINT" <<'NODE'
const fs = require('node:fs');
const [identityFile, rootBuildId, standaloneBuildId, revision, branch, worktreeHash, sourceFingerprint] = process.argv.slice(2);
function physicalFile(file, label) {
  const status = fs.lstatSync(file);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`${label} is not a physical regular file`);
  return fs.readFileSync(file, 'utf8').trim();
}
try {
  const buildId = physicalFile(rootBuildId, 'Root BUILD_ID');
  if (!buildId || buildId !== physicalFile(standaloneBuildId, 'Standalone BUILD_ID')) throw new Error('Web BUILD_ID files differ');
  try {
    const status = fs.lstatSync(identityFile);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error('Build identity destination is not a physical regular file');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${identityFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, revision, branch, worktreeHash, sourceFingerprint, buildId })}\n`, { flag: 'wx' });
  fs.renameSync(temporary, identityFile);
} catch (error) {
  console.error(`Cannot record Web build identity: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
NODE
}

assert_build_identity() {
node - "$BUILD_IDENTITY_FILE" "$ROOT_DIR/$NEXT_DIST_DIR/BUILD_ID" "$STANDALONE_DIR/.next/BUILD_ID" \
  "$INITIAL_APP_REVISION" "$INITIAL_APP_BRANCH" "$INITIAL_APP_WORKTREE_HASH" "$INITIAL_APP_SOURCE_FINGERPRINT" <<'NODE'
const fs = require('node:fs');
const [identityFile, rootBuildId, standaloneBuildId, revision, branch, worktreeHash, sourceFingerprint] = process.argv.slice(2);
function physicalFile(file, label) {
  const status = fs.lstatSync(file);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`${label} is not a physical regular file`);
  return fs.readFileSync(file, 'utf8').trim();
}
try {
  const buildId = physicalFile(rootBuildId, 'Root BUILD_ID');
  if (!buildId || buildId !== physicalFile(standaloneBuildId, 'Standalone BUILD_ID')) throw new Error('Web BUILD_ID files differ');
  const status = fs.lstatSync(identityFile);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error('Build identity is not a physical regular file');
  const value = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
  const expected = { schemaVersion: 1, revision, branch, worktreeHash, sourceFingerprint, buildId };
  if (Object.keys(value).sort().join(',') !== Object.keys(expected).sort().join(',')
      || Object.entries(expected).some(([key, item]) => value[key] !== item)) throw new Error('Build identity does not match this checkout and Web BUILD_ID');
} catch (error) {
  console.error(`Cannot reuse Web runtime: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
NODE
}

assert_checkout_unchanged() {
  read_checkout_identity
  if [[ "$CURRENT_APP_REVISION" != "$INITIAL_APP_REVISION" || "$CURRENT_APP_BRANCH" != "$INITIAL_APP_BRANCH" \
    || "$CURRENT_APP_WORKTREE_HASH" != "$INITIAL_APP_WORKTREE_HASH" || "$CURRENT_APP_SOURCE_FINGERPRINT" != "$INITIAL_APP_SOURCE_FINGERPRINT" ]]; then
    echo "Il checkout e cambiato durante la creazione del bundle macOS; il bundle non viene sigillato." >&2
    exit 1
  fi
}

# @Codex: reject path aliases and a sealed previous output before Xcode or rm/cp.
preflight_app_destination() {
node - "$APP" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const app = process.argv[2];
function physical(directory, optional = false) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory || /[\x00-\x1f\x7f]/u.test(directory)) throw new Error('Noncanonical app directory');
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    let status;
    try { status = fs.lstatSync(current); }
    catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
    if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('Nonphysical app directory');
  }
  if (fs.realpathSync(directory) !== directory) throw new Error('Aliased app directory');
}
physical(app, true);
physical(path.join(app, 'Contents'), true);
for (const name of ['_CodeSignature', 'CodeResources']) {
  try { fs.lstatSync(path.join(app, 'Contents', name)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  throw new Error('Refusing to mutate a sealed app. Build in fresh, unsigned DerivedData.');
}
for (const name of ['Resources', 'Resources/WebRuntime', 'Resources/WebRuntime/.next',
  'Resources/WebRuntime/.next/static', 'Resources/WebRuntime/public', 'Resources/WebRuntime/HeadlessRuntime', 'Frameworks', 'Helpers']) physical(path.join(app, 'Contents', name), true);
for (const [relative, message] of [
  ['Resources/local-api-tls-proxy.mjs', 'Nonphysical proxy destination'],
  ['Resources/mediflow-headless-supervisor.mjs', 'Nonphysical Headless launcher destination'],
  ['Resources/WebRuntime/native-first-install.mjs', 'Nonphysical native first-install destination'],
]) {
  const destination = path.join(app, 'Contents', relative);
  try {
    const status = fs.lstatSync(destination);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error(message);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
NODE
}
preflight_app_destination

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
  ( cd "$ROOT_DIR" && MEDIFLOW_APP_REVISION="$INITIAL_APP_REVISION" MEDIFLOW_APP_BRANCH="$INITIAL_APP_BRANCH" \
    MEDIFLOW_APP_WORKTREE_HASH="$INITIAL_APP_WORKTREE_HASH" MEDIFLOW_APP_SOURCE_FINGERPRINT="$INITIAL_APP_SOURCE_FINGERPRINT" \
    MEDIFLOW_APP_FINGERPRINT="$INITIAL_APP_SOURCE_FINGERPRINT" npm run build -- --webpack )
  write_build_identity
fi
assert_build_identity
( cd "$ROOT_DIR" && npm run check:standalone-runtime-bundle )
if [[ ! -f "$STANDALONE_DIR/server.js" ]]; then
  echo "Missing $NEXT_DIST_DIR/standalone/server.js. Run 'npm run build' first (or unset MEDIFLOW_SKIP_WEB_BUILD)." >&2
  exit 1
fi

# @Codex: a caller must provide every public staging input explicitly. Without
# them an already-staged standalone payload must be complete and is reused unchanged.
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
# @Codex: absence is a packaging error, not a successful app with a HELD helper.
node "$ROOT_DIR/scripts/run-strip-types.mjs" "$STAGE_EXECUTION_MAC_ASSETS" \
  --check --installation-root "$STANDALONE_DIR"

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

[[ -d "$APP" ]] || { echo "Build failed: $APP not found" >&2; exit 1; }

# @Codex: do not place the initial identity in an app whose checkout changed
# while Web/Xcode build was running.
assert_checkout_unchanged

# @Codex: preserve any Xcode-provided launch variables while placing the
# canonical build identity in the app process environment before signing.
PLIST="$APP/Contents/Info.plist"
[[ -f "$PLIST" && ! -L "$PLIST" ]] || { echo "Info.plist del bundle mancante o non fisico." >&2; exit 1; }
if ! plutil -extract LSEnvironment raw "$PLIST" >/dev/null 2>&1; then
  plutil -insert LSEnvironment -dictionary "$PLIST"
fi
for identity_key in MEDIFLOW_APP_REVISION MEDIFLOW_APP_BRANCH MEDIFLOW_APP_WORKTREE_HASH MEDIFLOW_APP_SOURCE_FINGERPRINT MEDIFLOW_APP_FINGERPRINT; do
  case "$identity_key" in
    MEDIFLOW_APP_REVISION) identity_value="$CURRENT_APP_REVISION" ;;
    MEDIFLOW_APP_BRANCH) identity_value="$CURRENT_APP_BRANCH" ;;
    MEDIFLOW_APP_WORKTREE_HASH) identity_value="$CURRENT_APP_WORKTREE_HASH" ;;
    MEDIFLOW_APP_SOURCE_FINGERPRINT|MEDIFLOW_APP_FINGERPRINT) identity_value="$CURRENT_APP_SOURCE_FINGERPRINT" ;;
  esac
  plutil -replace "LSEnvironment.$identity_key" -string "$identity_value" "$PLIST" 2>/dev/null \
    || plutil -insert "LSEnvironment.$identity_key" -string "$identity_value" "$PLIST"
done

# 3. Inject the WebRuntime + the TLS proxy script into the bundle
RES="$APP/Contents/Resources"
WEB="$RES/WebRuntime"
FRAMEWORKS="$APP/Contents/Frameworks"
EXECUTION_MAC_HELPER="$APP/Contents/Helpers/mediflow-chatgpt-codex"
preflight_app_destination
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
mkdir -p "$WEB"
cp -R "$STANDALONE_DIR/." "$WEB/"
# @Codex: native startup reserves a fresh database before it creates log/PID files.
# The helper has a direct-Node packaged mode, so no source tree or TS loader ships.
# `preflight_app_destination` above and here reject a pre-existing symlink before this copy.
preflight_app_destination
cp "$ROOT_DIR/scripts/native-first-install.mjs" "$WEB/native-first-install.mjs"
cmp -s "$ROOT_DIR/scripts/native-first-install.mjs" "$WEB/native-first-install.mjs" || {
  echo "Native first-install helper was not copied intact into WebRuntime." >&2; exit 1;
}
# @Codex: copied overlay roots must be physical before mkdir/cp can write through them.
preflight_app_destination
# @Codex: merge contents when a reused standalone already includes these assets.
mkdir -p "$WEB/.next/static"
cp -R "$ROOT_DIR/$NEXT_DIST_DIR/static/." "$WEB/.next/static/"
if [[ -d "$ROOT_DIR/public" ]]; then
  mkdir -p "$WEB/public"
  cp -R "$ROOT_DIR/public/." "$WEB/public/"
fi
cp "$ROOT_DIR/scripts/local-api-tls-proxy.mjs" "$RES/local-api-tls-proxy.mjs"
# @Codex: split the copied standalone payload before the strict Resources guard.
# The original standalone stays usable. No symlink and no native bytes change.
node "$ROOT_DIR/scripts/run-strip-types.mjs" "$STAGE_EXECUTION_MAC_ASSETS" \
  --relocate-bundle --installation-root "$WEB"
# Verify the pre-existing signature; re-signing codex would invalidate its pin.
if ! codesign --verify --strict "$EXECUTION_MAC_HELPER"; then
  echo "Pinned Codex signature is invalid; no re-signing is allowed. A different binary requires a new qualification." >&2
  exit 1
fi
lipo "$EXECUTION_MAC_HELPER" -verify_arch "$XCODE_ARCH"
"$ROOT_DIR/scripts/check-macos-web-runtime-native-payload.sh" --normalize --web-runtime "$WEB" --frameworks "$FRAMEWORKS"
node "$ROOT_DIR/scripts/run-strip-types.mjs" "$STAGE_EXECUTION_MAC_ASSETS" \
  --check --installation-root "$WEB"

# @Codex: staging must not hide a checkout change before the outer seal.
assert_checkout_unchanged

# 4. Optional codesign (so the injected runtime is covered for distribution)
if [[ -n "${MEDIFLOW_CODESIGN_IDENTITY:-}" ]]; then
  echo "Codesigning ($MEDIFLOW_CODESIGN_IDENTITY)..."
  if [[ "$MEDIFLOW_CODESIGN_IDENTITY" == "-" ]]; then
    SIGN_ARGS=(--force --sign -)
  else
    SIGN_ARGS=(--force --options runtime --timestamp --sign "$MEDIFLOW_CODESIGN_IDENTITY")
  fi
  # @Codex: sign only the six rewritten Web dependencies. The independently
  # signed, pinned Codex helper is already verified and MUST NOT be re-signed.
  # --deep is verification-only. No mutation follows the OUTER app seal below.
  for native_code in "${WEB_NATIVE_TARGETS[@]}"; do
    codesign "${SIGN_ARGS[@]}" "$native_code"
    codesign --verify --strict "$native_code"
  done
fi

# @Codex WUL-697: exact file closure only; consume final inner-signature bytes.
# The roster/launcher are committed before the outer seal and never repaired after it.
node "$ROOT_DIR/scripts/stage-headless-runtime.mjs" --stage --app "$APP"
assert_checkout_unchanged
if [[ -n "${MEDIFLOW_CODESIGN_IDENTITY:-}" ]]; then
  codesign "${SIGN_ARGS[@]}" "$APP"
  codesign --verify --deep --strict "$APP"
fi

# @Codex: read-only final acceptance, including AFTER optional outer signing.
# These checks do not write Resources/Helpers or assert runtime qualification.
node "$ROOT_DIR/scripts/run-strip-types.mjs" "$STAGE_EXECUTION_MAC_ASSETS" \
  --check --installation-root "$WEB"
codesign --verify --strict "$EXECUTION_MAC_HELPER"
"$ROOT_DIR/scripts/check-macos-web-runtime-native-payload.sh" --web-runtime "$WEB" --frameworks "$FRAMEWORKS"
node "$ROOT_DIR/scripts/stage-headless-runtime.mjs" --check --app "$APP"
echo "Runnable macOS app candidate (runtime smoke still required): $APP"
echo "WebRuntime: $WEB/server.js"
echo "Headless MCP (explicit Node 24 required): $RES/mediflow-headless-supervisor.mjs"
