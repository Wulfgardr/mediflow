#!/usr/bin/env bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node "$ROOT_DIR/scripts/run-strip-types.mjs" --test \
  "$ROOT_DIR/lib/siss-adapter.test.ts" \
  "$ROOT_DIR/lib/siss.test.ts" \
  "$ROOT_DIR/lib/siss-patient-context.test.ts" \
  "$ROOT_DIR/lib/siss-prescriptive-context-projection.test.ts" \
  "$ROOT_DIR/lib/siss-prescription.test.ts" \
  "$ROOT_DIR/lib/siss-session-observer.test.ts"
