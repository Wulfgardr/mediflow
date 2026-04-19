#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-fse-validation-test"

trap 'node -e "require('\''fs'\'').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"' EXIT
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.fse-validation-test.json"
mkdir -p "$OUT_DIR/node_modules/server-only"
printf 'module.exports = {};\n' > "$OUT_DIR/node_modules/server-only/index.js"
node --test "$OUT_DIR/fse-validation.test.js"
