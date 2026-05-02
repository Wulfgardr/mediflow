#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-patient-document-import-test"

trap 'node -e "require('\''fs'\'').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"' EXIT
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.patient-document-import-test.json"
node --test \
  "$OUT_DIR/patient-import-decision.test.js" \
  "$OUT_DIR/patient-document-import-service.test.js" \
  "$OUT_DIR/patient-document-review.test.js"
