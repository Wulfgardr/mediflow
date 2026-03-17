#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/tmp-auth-lockout-test"

rm -rf "$OUT_DIR"
npx tsc -p "$ROOT_DIR/tsconfig.auth-lockout-test.json"
node --test "$OUT_DIR/auth-lockout.test.js"
