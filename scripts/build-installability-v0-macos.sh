#!/bin/bash
# @Codex
# Costruisce una proof macOS autosufficiente con Next standalone e Node 24.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${MEDIFLOW_INSTALL_OUTPUT_DIR:-$ROOT_DIR/tmp-installability-v0}"
APP="$OUTPUT_DIR/MediFlow.app"
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

case "$APP" in
  "$ROOT_DIR"/tmp-*/*.app|/tmp/*/*.app) ;;
  *) fail "output non sicuro: $APP" ;;
esac

echo "[installabilita-v0] Verifica contratto Node e better-sqlite3"
(cd "$ROOT_DIR" && "$NODE_BINARY" scripts/node-runtime-contract.mjs verify)

if [[ "${MEDIFLOW_INSTALL_SKIP_WEB_BUILD:-0}" != "1" ]]; then
  echo "[installabilita-v0] Build Next standalone"
  (cd "$ROOT_DIR" && npm run build -- --webpack)
fi

[[ -f "$STANDALONE_DIR/server.js" ]] || fail "standalone mancante: eseguire senza MEDIFLOW_INSTALL_SKIP_WEB_BUILD"
(cd "$ROOT_DIR" && "$NODE_BINARY" scripts/check-standalone-runtime-bundle.mjs)

echo "[installabilita-v0] Assemblaggio $APP"
rm -rf "$APP"
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

