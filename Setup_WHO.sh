#!/bin/sh
# @Codex: thin local WHO entrypoint. Operator chooses Node 24 and Docker.
set -eu
WHO_SETUP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WHO_SETUP_NODE=$(command -v node 2>/dev/null || true)
if [ -z "$WHO_SETUP_NODE" ] || ! "$WHO_SETUP_NODE" -e 'process.exit(process.versions.node.split(".")[0] === "24" ? 0 : 1)'; then
    echo 'Serve Node.js 24 nel PATH. Seleziona il runtime previsto e ripeti bash ./Setup_WHO.sh.' >&2
    exit 1
fi
exec "$WHO_SETUP_NODE" "$WHO_SETUP_ROOT/scripts/who-local-onboarding.mjs" "$@"
