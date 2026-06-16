#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-document-evidence-backfill-cli"

npx tsc -p "$ROOT_DIR/tsconfig.document-evidence-backfill-cli.json"
node "$OUT_DIR/scripts/document-source-provenance-audit.js" "$@"
