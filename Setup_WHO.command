#!/bin/bash
# @Codex: fixed ordinary WHO setup entrypoint, no DB or VM probing.
set -e
WHO_SETUP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WHO_SETUP_PATH_NODE="$(command -v node 2>/dev/null || true)"
for WHO_SETUP_NODE in "$WHO_SETUP_PATH_NODE" \
    "$HOME"/.nvm/versions/node/v24.*/bin/node \
    "$HOME"/.local/share/fnm/node-versions/v24.*/installation/bin/node \
    /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node; do
    [ -x "$WHO_SETUP_NODE" ] || continue
    if "$WHO_SETUP_NODE" -e 'process.exit(process.versions.node.split(".")[0] === "24" ? 0 : 1)' >/dev/null 2>&1; then
        export PATH="$(dirname "$WHO_SETUP_NODE"):$PATH"
        exec "$WHO_SETUP_NODE" "$WHO_SETUP_ROOT/scripts/who-local-onboarding.mjs" "$@"
    fi
done
echo "MediFlow richiede Node.js 24. Installa il runtime previsto e riapri Setup_WHO.command." >&2
exit 1
