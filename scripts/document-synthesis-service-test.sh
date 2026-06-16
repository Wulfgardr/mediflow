#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-document-synthesis-test"

trap 'node -e "require('\''fs'\'').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"' EXIT
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.document-synthesis-test.json"
node --test \
    "$OUT_DIR/document-synthesis-service.test.js" \
    "$OUT_DIR/document-evidence-pack.test.js" \
    "$OUT_DIR/document-evidence-backfill.test.js" \
    "$OUT_DIR/document-source-provenance-audit.test.js"
