#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_RELATIVE="tmp/g3b-r1-audit-test.json"

rm -f "$ROOT_DIR/$REPORT_RELATIVE"
trap 'rm -f "$ROOT_DIR/$REPORT_RELATIVE"' EXIT
node "$ROOT_DIR/scripts/run-strip-types.mjs" --test "$ROOT_DIR/lib/security/audit.test.ts"
(
    cd "$ROOT_DIR"
    node scripts/audit-quality-gate.mjs --out "$REPORT_RELATIVE"
)
test -f "$ROOT_DIR/$REPORT_RELATIVE"
