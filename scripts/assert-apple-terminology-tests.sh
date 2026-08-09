#!/usr/bin/env bash
set -euo pipefail

# Asserisce che i quattro test Apple di parità terminologica risultino 'passed'
# per NOME nell'output di `swift test`, invece di fidarsi del suo exit code.
#
# È l'unica parte del gate di parità che una run full-suite non fa: un verde
# complessivo dice che nessun test è fallito, non che questi quattro siano
# girati. Se uno viene rinominato o cancellato, `swift test` resta verde e solo
# questa asserzione se ne accorge.
#
# Uso: assert-apple-terminology-tests.sh <file-con-l-output-di-swift-test>
#
# Estratto da check-terminology-parity.sh perché la CI ha già l'output di una
# run completa (apple-native.yml) e rieseguire `swift test --filter` su un
# runner macOS fatturato 10x sarebbe una duplicazione da due minuti.

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
