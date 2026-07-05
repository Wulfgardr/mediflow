#!/usr/bin/env bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node "$ROOT_DIR/scripts/run-strip-types.mjs" --test \
  "$ROOT_DIR/lib/terminology-registry.test.ts"
