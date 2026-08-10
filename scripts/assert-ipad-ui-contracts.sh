#!/usr/bin/env bash
# @Codex
set -euo pipefail

# xcodebuild prints a final `passed` line even when XCTest recorded XCTSkip.
# Require that each iPad-only contract appears as passed and never as skipped.

if [[ $# -ne 1 ]]; then
  printf 'uso: %s <file-con-l-output-di-xcodebuild-test>\n' "${0##*/}" >&2
  exit 2
fi

OUTPUT_FILE="$1"

if [[ ! -r "$OUTPUT_FILE" ]]; then
  printf 'Output di xcodebuild test non trovato: %s\n' "$OUTPUT_FILE" >&2
  exit 1
fi

OUTPUT=$(<"$OUTPUT_FILE")

REQUIRED_TESTS=(
  "testProjectSidebarPreservesPatientWorkspaceWidthOnIPad"
  "testAccessibilityDynamicTypeUsesSinglePatientColumnOnIPad"
  "testIPadListColumnFollowsTheContainerAcrossRotation"
  "testIPadKeepsTheOpenChartAcrossRotation"
)

suite="MediFlowMobileAppUITests.MediFlowMobileAppUITests"
missing=0
for expected in "${REQUIRED_TESTS[@]}"; do
  test_case="-[$suite $expected]"
  passed="Test Case '$test_case' passed"
  skipped="$test_case : Test skipped"

  if grep -Fq -- "$skipped" <<<"$OUTPUT"; then
    printf 'SKIP   contratto iPad non eseguito: %s\n' "$expected" >&2
    missing=$((missing + 1))
  elif grep -Fq -- "$passed" <<<"$OUTPUT"; then
    printf 'ok     %s\n' "$expected"
  else
    printf 'MANCA  contratto iPad non passato: %s\n' "$expected" >&2
    missing=$((missing + 1))
  fi
done

if [[ "$missing" -gt 0 ]]; then
  printf '\n%d/%d contratti iPad non risultano eseguiti e passati.\n' \
    "$missing" "${#REQUIRED_TESTS[@]}" >&2
  exit 1
fi

printf '\nContratti iPad: %d/%d eseguiti e passati senza skip.\n' \
  "${#REQUIRED_TESTS[@]}" "${#REQUIRED_TESTS[@]}"
