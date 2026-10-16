#!/bin/bash
set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for candidate in "${MEDIFLOW_NODE_BINARY:-}" "$(command -v node 2>/dev/null || true)" \
  "${NVM_DIR:-$HOME/.nvm}"/versions/node/v24.*/bin/node \
  "${FNM_DIR:-$HOME/.local/share/fnm}"/node-versions/v24.*/installation/bin/node \
  "$HOME/Library/Application Support/fnm"/node-versions/v24.*/installation/bin/node \
  /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node \
  /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  [ -x "$candidate" ] || continue
  if "$candidate" "$ROOT/scripts/launcher-helpers.mjs" check-node >/dev/null 2>&1; then
    export PATH="$(dirname "$candidate"):$PATH"
    exec "$candidate" "$ROOT/scripts/mediflow.mjs" "$@"
  fi
done
echo "MediFlow richiede Node 24.x. Installa o attiva Node 24 e riapri questo file." >&2
if [ -t 0 ]; then read -r -p "Premi Invio per chiudere. " _; fi
exit 1
