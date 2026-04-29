#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-siss-prescription-test"

trap 'node -e "require('\''fs'\'').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"' EXIT
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.siss-prescription-test.json"
mkdir -p "$OUT_DIR/node_modules/server-only"
printf '%s\n' "module.exports = {};" > "$OUT_DIR/node_modules/server-only/index.js"
node --test \
  "$OUT_DIR/siss.test.js" \
  "$OUT_DIR/siss-patient-context.test.js" \
  "$OUT_DIR/siss-prescription.test.js" \
  "$OUT_DIR/siss-session-observer.test.js"
