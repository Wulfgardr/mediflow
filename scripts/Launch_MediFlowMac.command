#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${MEDIFLOW_MAC_CONFIG:-Debug}"
DERIVED="${MEDIFLOW_MAC_DERIVED_DATA:-$ROOT_DIR/tmp-mac-derived-data}"
APP="$DERIVED/Build/Products/$CONFIG/MediFlow.app"

# @Codex: build and setup must use a Node that satisfies the project contract,
# including the installed better-sqlite3 native binding.
REQUIRED_NODE_MAJOR="$(tr -dc '0-9' < "$ROOT_DIR/.nvmrc")"
select_mediflow_node() {
  local candidate=""
  local path_node="$(command -v node 2>/dev/null || true)"
  for candidate in "${MEDIFLOW_NODE_BINARY:-}" "$path_node" \
    "$HOME"/.nvm/versions/node/v"$REQUIRED_NODE_MAJOR".*/bin/node \
    "$HOME"/.local/share/fnm/node-versions/v"$REQUIRED_NODE_MAJOR".*/installation/bin/node \
    /opt/homebrew/opt/node@"$REQUIRED_NODE_MAJOR"/bin/node \
    /usr/local/opt/node@"$REQUIRED_NODE_MAJOR"/bin/node \
    /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [[ -x "$candidate" ]] || continue
    if "$candidate" "$ROOT_DIR/scripts/launcher-helpers.mjs" check-runtime >/dev/null 2>&1; then
      export PATH="$(dirname "$candidate"):$PATH"
      export MEDIFLOW_NODE_BINARY="$candidate"
      return 0
    fi
  done
  return 1
}

if ! select_mediflow_node; then
  echo "MediFlow per macOS richiede Node ${REQUIRED_NODE_MAJOR}.x con dipendenze installate dalla stessa versione." >&2
  echo "Attiva Node ${REQUIRED_NODE_MAJOR}, esegui npm ci nella cartella MediFlow e rilancia." >&2
  exit 1
fi

# @Codex: expose the exact product and source before any native build work.
"$MEDIFLOW_NODE_BINARY" "$ROOT_DIR/scripts/launcher-helpers.mjs" identity-summary

"$ROOT_DIR/scripts/native-setup.sh"
"$ROOT_DIR/scripts/build-apple-macos-app.sh"

# @Codex: the universal Xcode target is the only supported macOS entrypoint.
if [[ ! -d "$APP" ]]; then
  echo "Bundle macOS non trovato: $APP" >&2
  exit 1
fi

open -n "$APP"
