#!/usr/bin/env bash
set -euo pipefail

# WUL-306 / WUL-322 (ADR 0066): patient soft-delete lifecycle tests.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-patient-soft-delete-test"

trap 'node -e "require('\''fs'\'').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"' EXIT
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.patient-soft-delete-test.json"
node --test "$OUT_DIR/patient-lifecycle.test.js" "$OUT_DIR/patient-cascade.test.js" "$OUT_DIR/test-container-clear.test.js"
node --test "$ROOT_DIR/scripts/patient-soft-delete.test.mjs" "$ROOT_DIR/scripts/patient-cascade.test.mjs"
