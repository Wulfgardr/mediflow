#!/bin/bash
# @Codex
# Costruisce una proof macOS autosufficiente con Next standalone e Node 24.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${MEDIFLOW_INSTALL_OUTPUT_DIR:-$ROOT_DIR/tmp-installability-v0}"
NEXT_DIST_DIR="${MEDIFLOW_NEXT_DIST_DIR:-.next}"
STANDALONE_DIR="$ROOT_DIR/$NEXT_DIST_DIR/standalone"
NODE_BINARY="${MEDIFLOW_NODE_BINARY:-$(command -v node || true)}"
LAUNCHER_SOURCE="$ROOT_DIR/scripts/installability-v0-macos-launcher.sh"

fail() {
  echo "[installabilita-v0] ERRORE: $*" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "questa proof produce solo un bundle macOS"
[[ -n "$NODE_BINARY" && -x "$NODE_BINARY" ]] || fail "Node non trovato o non eseguibile"
[[ -x "$LAUNCHER_SOURCE" ]] || fail "launcher sorgente non eseguibile: $LAUNCHER_SOURCE"

NODE_MAJOR="$($NODE_BINARY -p 'process.versions.node.split(".")[0]')"
NODE_PLATFORM="$($NODE_BINARY -p 'process.platform')"
NODE_ARCH="$($NODE_BINARY -p 'process.arch')"
[[ "$NODE_MAJOR" == "24" ]] || fail "serve Node 24, trovato $($NODE_BINARY --version)"
[[ "$NODE_PLATFORM" == "darwin" ]] || fail "il runtime Node deve essere per macOS"

case "$NODE_ARCH" in
  arm64|x64) ;;
  *) fail "architettura Node non supportata: $NODE_ARCH" ;;
esac

canonicalize_path() {
  "$NODE_BINARY" - "$1" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

let cursor = path.resolve(process.argv[2]);
const suffix = [];
while (!fs.existsSync(cursor)) {
  const parent = path.dirname(cursor);
  if (parent === cursor) throw new Error(`nessun antenato esistente per ${process.argv[2]}`);
  suffix.unshift(path.basename(cursor));
  cursor = parent;
}
console.log(path.join(fs.realpathSync.native(cursor), ...suffix));
NODE
}

ROOT_DIR="$(canonicalize_path "$ROOT_DIR")"
OUTPUT_DIR="$(canonicalize_path "$OUTPUT_DIR")"
OUTPUT_PARENT="$(dirname "$OUTPUT_DIR")"
OUTPUT_NAME="$(basename "$OUTPUT_DIR")"
SYSTEM_TMP_DIR="$(canonicalize_path "${TMPDIR:-/tmp}")"

if [[ "$OUTPUT_PARENT" == "$ROOT_DIR" && "$OUTPUT_NAME" == tmp-* ]]; then
  :
elif [[ "$OUTPUT_PARENT" == "$SYSTEM_TMP_DIR" && "$OUTPUT_NAME" == mediflow-installability-v0-* ]]; then
  :
else
  fail "output non sicuro: usare ROOT/tmp-* o TMPDIR/mediflow-installability-v0-*"
fi

APP="$OUTPUT_DIR/MediFlow.app"
[[ "$(dirname "$APP")" == "$OUTPUT_DIR" && "$(basename "$APP")" == "MediFlow.app" ]] || \
  fail "bundle output non sicuro: $APP"

if [[ "${MEDIFLOW_INSTALL_VALIDATE_OUTPUT_ONLY:-0}" == "1" ]]; then
  echo "[installabilita-v0] output sicuro: $APP"
  exit 0
fi

# @Codex: il bundle precedente contiene file TypeScript tracciati da Next. Va
# rimosso prima della nuova build, altrimenti entra nel perimetro del typecheck.
rm -rf "$APP"

echo "[installabilita-v0] Verifica contratto Node e better-sqlite3"
(cd "$ROOT_DIR" && "$NODE_BINARY" scripts/node-runtime-contract.mjs verify)

if [[ "${MEDIFLOW_INSTALL_SKIP_WEB_BUILD:-0}" != "1" ]]; then
  echo "[installabilita-v0] Build Next standalone"
  (cd "$ROOT_DIR" && npm run build -- --webpack)
fi

[[ -f "$STANDALONE_DIR/server.js" ]] || fail "standalone mancante: eseguire senza MEDIFLOW_INSTALL_SKIP_WEB_BUILD"
(cd "$ROOT_DIR" && "$NODE_BINARY" scripts/check-standalone-runtime-bundle.mjs)

echo "[installabilita-v0] Assemblaggio $APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Node/bin" "$APP/Contents/Resources/WebRuntime/.next"

cp "$LAUNCHER_SOURCE" "$APP/Contents/MacOS/MediFlow"
chmod 755 "$APP/Contents/MacOS/MediFlow"
cp -L "$NODE_BINARY" "$APP/Contents/Resources/Node/bin/node"
chmod 755 "$APP/Contents/Resources/Node/bin/node"

NODE_ROOT="$(cd "$(dirname "$NODE_BINARY")/.." && pwd)"
if [[ -f "$NODE_ROOT/LICENSE" ]]; then
  cp "$NODE_ROOT/LICENSE" "$APP/Contents/Resources/Node/LICENSE"
fi

cp -R "$STANDALONE_DIR/." "$APP/Contents/Resources/WebRuntime/"
cp -R "$ROOT_DIR/$NEXT_DIST_DIR/static" "$APP/Contents/Resources/WebRuntime/.next/static"
if [[ -d "$ROOT_DIR/public" ]]; then
  cp -R "$ROOT_DIR/public" "$APP/Contents/Resources/WebRuntime/public"
fi

REVISION="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
BRANCH="$(git -C "$ROOT_DIR" branch --show-current)"
WORKTREE_HASH="$($NODE_BINARY - "$ROOT_DIR" <<'NODE'
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = process.argv[2];
const status = execFileSync('git', ['-C', root, 'status', '--porcelain=v1'], { encoding: 'utf8' }).trim();
console.log(status ? createHash('sha1').update(status).digest('hex').slice(0, 12) : 'clean');
NODE
)"
SOURCE_FINGERPRINT="$BRANCH@$REVISION:$WORKTREE_HASH"
IDENTITY="$APP/Contents/Resources/WebRuntime/mediflow-installability-v0-identity.json"
"$NODE_BINARY" - "$IDENTITY" "$REVISION" "$SOURCE_FINGERPRINT" <<'NODE'
const fs = require('node:fs');

fs.writeFileSync(process.argv[2], `${JSON.stringify({
  schemaVersion: 1,
  bundleIdentifier: 'org.wulfgardr.mediflow.installability-v0',
  revision: process.argv[3],
  sourceFingerprint: process.argv[4],
}, null, 2)}\n`);
NODE

VERSION="$($NODE_BINARY -p "require('$ROOT_DIR/package.json').version")"
PLIST="$APP/Contents/Info.plist"
plutil -create xml1 "$PLIST"
plutil -insert CFBundleDevelopmentRegion -string it "$PLIST"
plutil -insert CFBundleDisplayName -string MediFlow "$PLIST"
plutil -insert CFBundleExecutable -string MediFlow "$PLIST"
plutil -insert CFBundleIdentifier -string org.wulfgardr.mediflow.installability-v0 "$PLIST"
plutil -insert CFBundleInfoDictionaryVersion -string 6.0 "$PLIST"
plutil -insert CFBundleName -string MediFlow "$PLIST"
plutil -insert CFBundlePackageType -string APPL "$PLIST"
plutil -insert CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -insert CFBundleVersion -string 1 "$PLIST"
plutil -insert NSHighResolutionCapable -bool true "$PLIST"

CONTRACT="$APP/Contents/Resources/WebRuntime/mediflow-runtime-contract.json"
[[ -f "$CONTRACT" ]] || fail "contratto runtime non incluso"

"$APP/Contents/Resources/Node/bin/node" -e '
  const fs = require("node:fs");
  const contract = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const actual = {
    major: Number(process.versions.node.split(".")[0]),
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
  };
  if (actual.major !== contract.node.major || actual.abi !== contract.node.moduleVersion ||
      actual.platform !== contract.platform || actual.arch !== contract.arch) {
    console.error("Runtime incorporato non compatibile", { actual, contract });
    process.exit(1);
  }
' "$CONTRACT"

echo "[installabilita-v0] COMPLETATO"
echo "Artefatto: $APP"
echo "Runtime: $($APP/Contents/Resources/Node/bin/node --version), $NODE_PLATFORM/$NODE_ARCH"
du -sh "$APP"
