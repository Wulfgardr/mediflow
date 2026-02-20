#!/bin/bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# @Codex
E2E_DATA_DIR="${MEDIFLOW_E2E_DATA_DIR:-$ROOT_DIR/tmp-e2e-data}"
LOG_DIR="$E2E_DATA_DIR/logs"
DEV_LOG="$LOG_DIR/next-dev.log"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3000}"

mkdir -p "$E2E_DATA_DIR" "$LOG_DIR"
export MEDIFLOW_DATA_DIR="$E2E_DATA_DIR"
export E2E_BASE_URL="$BASE_URL"

if ! node -e "require.resolve('@playwright/test/package.json')" >/dev/null 2>&1; then
  echo "Missing dependency: @playwright/test"
  echo "Install when network is available:"
  echo "  npm install -D @playwright/test"
  echo "  npx playwright install chromium"
  exit 1
fi

DEV_PID=""

cleanup() {
  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
    wait "$DEV_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "Starting Next.js dev server..."
npm run dev >"$DEV_LOG" 2>&1 &
DEV_PID=$!

echo "Waiting for $BASE_URL ..."
for _ in {1..90}; do
  if curl -fsS "$BASE_URL" >/dev/null 2>&1; then
    echo "Server is ready."
    break
  fi
  sleep 1
done

if ! curl -fsS "$BASE_URL" >/dev/null 2>&1; then
  echo "Server did not become ready in time."
  echo "Check log: $DEV_LOG"
  exit 1
fi

echo "Running web smoke test..."
npx playwright test e2e/web-smoke.spec.ts

echo "Smoke run completed."
echo "Data dir: $E2E_DATA_DIR"
