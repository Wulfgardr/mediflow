#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-audit-test"

rm -rf "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.audit-test.json"
mkdir -p "$OUT_DIR/node_modules/server-only"
cat <<'EOF' > "$OUT_DIR/node_modules/server-only/index.js"
module.exports = {};
EOF
node --test "$OUT_DIR/audit.test.js"
node "$ROOT_DIR/scripts/audit-quality-gate.mjs"
