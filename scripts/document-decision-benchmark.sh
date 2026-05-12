#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-document-decision-benchmark"
VALIDATE=0

for arg in "$@"; do
  if [[ "$arg" == "--validate" ]]; then
    VALIDATE=1
  fi
done

trap 'node -e "require('\''fs'\'').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"' EXIT
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.document-decision-benchmark-test.json" --outDir "$OUT_DIR"

REPORT="$(node -e "const benchmark = require(process.argv[1]); process.stdout.write(JSON.stringify(benchmark.runDocumentDecisionFailureCounterBenchmark(), null, 2));" "$OUT_DIR/document-decision-benchmark.js")"
printf '%s\n' "$REPORT"

if [[ "$VALIDATE" == "1" ]]; then
  node -e "const report = JSON.parse(process.argv[1]); process.exit(report.totalFailureCount === 0 ? 0 : 1);" "$REPORT"
fi
