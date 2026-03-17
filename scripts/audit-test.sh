#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-audit-test"

rm -rf "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.audit-test.json"
node --test "$OUT_DIR/audit.test.js"
