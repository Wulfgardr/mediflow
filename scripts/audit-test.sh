#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-audit-test"
REPORT_RELATIVE="tmp/g3b-r1-audit-test.json"

rm -rf "$OUT_DIR"
rm -f "$ROOT_DIR/$REPORT_RELATIVE"
trap 'rm -f "$ROOT_DIR/$REPORT_RELATIVE"' EXIT
npx tsc -p "$ROOT_DIR/tsconfig.audit-test.json"
mkdir -p "$OUT_DIR/node_modules/server-only"
cat <<'EOF' > "$OUT_DIR/node_modules/server-only/index.js"
module.exports = {};
EOF
node --test "$OUT_DIR/security/audit.test.js"
(
    cd "$ROOT_DIR"
    node scripts/audit-quality-gate.mjs --out "$REPORT_RELATIVE"
)
test -f "$ROOT_DIR/$REPORT_RELATIVE"
