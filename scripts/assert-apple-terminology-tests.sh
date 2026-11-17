#!/usr/bin/env bash
set -euo pipefail


if [[ $# -ne 1 ]]; then
  printf 'uso: %s <file-con-l-output-di-swift-test>\n' "${0##*/}" >&2
  exit 2
fi

OUTPUT_FILE="$1"

if [[ ! -f "$OUTPUT_FILE" ]]; then
  printf 'Output di swift test non trovato: %s\n' "$OUTPUT_FILE" >&2
  exit 1
fi

REQUIRED_TESTS=(
  "HomeBasePatientsClientTests/testFetchTerminologySystemsUsesNetworkRouteAndTolerantDateDecode"
  "HomeBasePatientsClientTests/testResolveTerminologyUsesNetworkRouteAndDecodesOpenAPIShape"
  "HomeBasePatientsClientTests/testSearchTerminologyUsesNetworkRouteQueryAndDecodesOpenAPIShape"
  "TerminologyParityContractTests/testSharedFixtureDecodesCanonicalTerminologyContract"
)

missing=0
for expected in "${REQUIRED_TESTS[@]}"; do
  test_case="${expected%%/*} ${expected#*/}]' passed"
  if grep -Fq "$test_case" "$OUTPUT_FILE"; then
    printf 'ok   %s\n' "$expected"
  else
    printf 'MANCA  test Apple di terminologia non passato: %s\n' "$expected" >&2
    missing=$((missing + 1))
  fi
done

if [[ "$missing" -gt 0 ]]; then
  printf '\n%d test richiesti su %d non risultano passati.\n' "$missing" "${#REQUIRED_TESTS[@]}" >&2
  exit 1
fi

printf '\nParità terminologica Apple: %d/%d test richiesti passati per nome.\n' \
  "${#REQUIRED_TESTS[@]}" "${#REQUIRED_TESTS[@]}"
