#!/usr/bin/env bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(xcode-select -p 2>/dev/null)" == *CommandLineTools* ]] || ! xcrun --sdk macosx --find xctest >/dev/null 2>&1; then
  for dev in /Applications/Xcode.app/Contents/Developer /Applications/Xcode-beta.app/Contents/Developer; do
    if [[ -d "$dev" ]]; then export DEVELOPER_DIR="$dev"; break; fi
  done
fi

node "$ROOT_DIR/scripts/run-strip-types.mjs" --test \
  "$ROOT_DIR/lib/terminology-registry.test.ts" \
  "$ROOT_DIR/lib/drug-autocomplete-search.test.ts"
bash "$ROOT_DIR/scripts/network-home-base-catalog-read-smoke.sh"

APPLE_TEST_LOG="$(mktemp -t mediflow-terminology-parity)"
trap 'rm -f "$APPLE_TEST_LOG"' EXIT

if ! swift test --package-path "$ROOT_DIR/native/MediFlowMac" --filter Terminology >"$APPLE_TEST_LOG" 2>&1; then
  cat "$APPLE_TEST_LOG" >&2
  exit 1
fi
cat "$APPLE_TEST_LOG"

# L'elenco dei quattro test vive in un solo posto: la CI riusa lo stesso script
# sull'output della run completa, invece di rieseguire `swift test --filter`.
bash "$ROOT_DIR/scripts/assert-apple-terminology-tests.sh" "$APPLE_TEST_LOG"
