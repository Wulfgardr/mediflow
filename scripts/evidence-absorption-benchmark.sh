#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-evidence-absorption-benchmark"

trap 'node -e "require('\''fs'\'').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"' EXIT
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.evidence-absorption-benchmark.json"
node "$OUT_DIR/scripts/benchmark-evidence-absorption.js" "$@"
