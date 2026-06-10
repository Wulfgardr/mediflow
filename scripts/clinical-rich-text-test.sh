#!/usr/bin/env bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-clinical-rich-text-test"
SRC_DIR="$OUT_DIR/src"
DIST_DIR="$OUT_DIR/dist"

cleanup() {
    rm -rf "$OUT_DIR"
}
trap cleanup EXIT

cleanup
mkdir -p "$SRC_DIR"

cp "$ROOT_DIR/lib/clinical-rich-text.ts" "$SRC_DIR/clinical-rich-text.ts"
node - "$ROOT_DIR/lib/clinical-rich-text.test.ts" "$SRC_DIR/clinical-rich-text.test.ts" <<'NODE'
const fs = require('fs');
const [inputPath, outputPath] = process.argv.slice(2);
const source = fs.readFileSync(inputPath, 'utf8')
  .replace("from './clinical-rich-text.ts';", "from './clinical-rich-text';");
fs.writeFileSync(outputPath, source);
NODE

npx tsc \
    --module commonjs \
    --moduleResolution node \
    --target ES2020 \
    --esModuleInterop \
    --skipLibCheck \
    --outDir "$DIST_DIR" \
    "$SRC_DIR/clinical-rich-text.ts" \
    "$SRC_DIR/clinical-rich-text.test.ts"

node --test "$DIST_DIR/clinical-rich-text.test.js"
