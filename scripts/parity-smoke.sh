#!/bin/bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# @Codex
RUN_ID="$(date '+%Y%m%d-%H%M%S')"
ARTIFACT_DIR="${MEDIFLOW_PARITY_ARTIFACT_DIR:-$ROOT_DIR/tmp-parity-smoke/$RUN_ID}"
WEB_LOG="$ARTIFACT_DIR/web-smoke.log"
NATIVE_LOG="$ARTIFACT_DIR/native-smoke.log"
SUMMARY_FILE="$ARTIFACT_DIR/summary.md"

# @Codex
RUN_WEB="${MEDIFLOW_PARITY_RUN_WEB:-1}"
RUN_NATIVE="${MEDIFLOW_PARITY_RUN_NATIVE:-1}"
REQUIRE_WEB="${MEDIFLOW_PARITY_REQUIRE_WEB:-0}"
REQUIRE_NATIVE="${MEDIFLOW_PARITY_REQUIRE_NATIVE:-1}"
NATIVE_RUNNER="${MEDIFLOW_PARITY_NATIVE_RUNNER:-xcode}"

mkdir -p "$ARTIFACT_DIR"

WEB_STATUS="SKIPPED"
NATIVE_STATUS="SKIPPED"
EXIT_CODE=0

has_playwright_test() {
  node -e "require.resolve('@playwright/test/package.json')" >/dev/null 2>&1
}

run_web_lane() {
  if [[ "$RUN_WEB" != "1" ]]; then
    WEB_STATUS="SKIPPED"
    return 0
  fi

  if ! has_playwright_test; then
    mkdir -p "$(dirname "$WEB_LOG")"
    cat >"$WEB_LOG" <<EOF
Missing dependency: @playwright/test
Install when network is available:
  npm install -D @playwright/test
  npx playwright install chromium
EOF

    if [[ "$REQUIRE_WEB" == "1" ]]; then
      WEB_STATUS="FAIL"
      EXIT_CODE=1
    else
      WEB_STATUS="SKIPPED"
      echo "Web lane skipped: @playwright/test not available (REQUIRE_WEB=0)."
    fi
    return 0
  fi

  echo "Running web smoke lane..."
  if bash "$ROOT_DIR/scripts/e2e-smoke.sh" >"$WEB_LOG" 2>&1; then
    WEB_STATUS="PASS"
    return 0
  fi

  WEB_STATUS="FAIL"
  if [[ "$REQUIRE_WEB" == "1" ]]; then
    EXIT_CODE=1
  fi
  return 0
}

run_native_lane() {
  if [[ "$RUN_NATIVE" != "1" ]]; then
    NATIVE_STATUS="SKIPPED"
    return 0
  fi

  echo "Running native smoke lane ($NATIVE_RUNNER)..."
  if MEDIFLOW_NATIVE_TEST_RUNNER="$NATIVE_RUNNER" bash "$ROOT_DIR/scripts/native-test.sh" >"$NATIVE_LOG" 2>&1; then
    NATIVE_STATUS="PASS"
    return 0
  fi

  NATIVE_STATUS="FAIL"
  if [[ "$REQUIRE_NATIVE" == "1" ]]; then
    EXIT_CODE=1
  fi
  return 0
}

run_web_lane
run_native_lane

cat >"$SUMMARY_FILE" <<EOF
# Parity Smoke Summary

- Run ID: \`$RUN_ID\`
- Timestamp: \`$(date -u '+%Y-%m-%dT%H:%M:%SZ')\`
- Web lane: \`$WEB_STATUS\`
- Native lane: \`$NATIVE_STATUS\`

## Artifacts

- Web log: \`$WEB_LOG\`
- Native log: \`$NATIVE_LOG\`

## Manual checklist reference

- \`docs/parity-click-map-macos.md\`
- \`docs/parity-matrix.md\`
EOF

echo "Parity smoke summary: $SUMMARY_FILE"
if [[ "$WEB_STATUS" == "FAIL" ]]; then
  echo "Web lane failed. Check: $WEB_LOG"
fi
if [[ "$NATIVE_STATUS" == "FAIL" ]]; then
  echo "Native lane failed. Check: $NATIVE_LOG"
fi

exit "$EXIT_CODE"
