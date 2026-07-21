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

if ! APPLE_TEST_OUTPUT="$(swift test --package-path "$ROOT_DIR/native/MediFlowMac" --filter Terminology 2>&1)"; then
  printf '%s\n' "$APPLE_TEST_OUTPUT" >&2
  exit 1
fi
printf '%s\n' "$APPLE_TEST_OUTPUT"
for expected in \
  "HomeBasePatientsClientTests/testFetchTerminologySystemsUsesNetworkRouteAndTolerantDateDecode" \
  "HomeBasePatientsClientTests/testResolveTerminologyUsesNetworkRouteAndDecodesOpenAPIShape" \
  "HomeBasePatientsClientTests/testSearchTerminologyUsesNetworkRouteQueryAndDecodesOpenAPIShape" \
  "TerminologyParityContractTests/testSharedFixtureDecodesCanonicalTerminologyContract"; do
  test_case="${expected%%/*} ${expected#*/}]' passed"
  if ! grep -Fq "$test_case" <<<"$APPLE_TEST_OUTPUT"; then
    printf 'Required Apple terminology test did not pass: %s\n' "$expected" >&2
    exit 1
  fi
done
