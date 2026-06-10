#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-ocr-service-date-test"

trap 'node -e "require('\''fs'\'').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"' EXIT
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.ocr-service-date-test.json"
# @Codex
node - "$OUT_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const outDir = process.argv[2];
const aliasLibDir = path.join(outDir, 'node_modules', '@', 'lib');
fs.mkdirSync(aliasLibDir, { recursive: true });
fs.writeFileSync(path.join(aliasLibDir, 'db.js'), 'exports.db = { settings: { get: async () => undefined } };\n');
fs.writeFileSync(path.join(aliasLibDir, 'ai-models.js'), [
  'exports.DEFAULT_OCR_MODEL = "test-ocr";',
  'exports.ensureTextModelDefaultsUpgraded = async () => undefined;',
  'exports.resolveTextModel = (selected, fallback) => selected || fallback || "test-model";',
  '',
].join('\n'));
NODE
node --test "$OUT_DIR/ocr-service-date.test.js"
