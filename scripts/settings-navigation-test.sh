#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node "$ROOT_DIR/scripts/run-strip-types.mjs" --test \
  "$ROOT_DIR/lib/settings-navigation.test.ts"
