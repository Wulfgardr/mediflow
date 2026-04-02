#!/bin/bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# @Codex
E2E_DATA_DIR="${MEDIFLOW_E2E_DATA_DIR:-$ROOT_DIR/tmp-e2e-data}"
LOG_DIR="$E2E_DATA_DIR/logs"
DEV_LOG="$LOG_DIR/next-dev.log"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3100}"
HOST="$(node -e "const u=new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:3100'); console.log(u.hostname)")"
PORT="$(node -e "const u=new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:3100'); console.log(u.port || (u.protocol === 'https:' ? '443' : '80'))")"

mkdir -p "$E2E_DATA_DIR" "$LOG_DIR"
export MEDIFLOW_DATA_DIR="$E2E_DATA_DIR"
export E2E_BASE_URL="$BASE_URL"
export MEDIFLOW_NEXT_DIST_DIR="${MEDIFLOW_NEXT_DIST_DIR:-.next-e2e}"
E2E_SPECS="${E2E_SPECS:-e2e/web-smoke.spec.ts e2e/document-import.spec.ts}"

if ! node -e "require.resolve('@playwright/test/package.json')" >/dev/null 2>&1; then
  echo "Missing dependency: @playwright/test"
  echo "Install when network is available:"
  echo "  npm install -D @playwright/test"
  echo "  npx playwright install chromium"
  exit 1
fi

rm -f "$E2E_DATA_DIR/medical.db"
if [[ "$MEDIFLOW_NEXT_DIST_DIR" == ".next-e2e" ]]; then
  rm -rf "$ROOT_DIR/$MEDIFLOW_NEXT_DIST_DIR"
fi

echo "Preparing deterministic auth state in $E2E_DATA_DIR ..."
node "$ROOT_DIR/scripts/prepare-e2e-db.mjs"

DEV_PID=""

cleanup() {
  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
    wait "$DEV_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$MEDIFLOW_NEXT_DIST_DIR" == ".next-e2e" ]]; then
    rm -rf "$ROOT_DIR/$MEDIFLOW_NEXT_DIST_DIR"
  fi
}

trap cleanup EXIT

echo "Starting Next.js dev server on $BASE_URL ..."
npx next dev --turbopack --hostname "$HOST" --port "$PORT" >"$DEV_LOG" 2>&1 &
DEV_PID=$!

echo "Waiting for $BASE_URL ..."
for _ in {1..90}; do
  if ! kill -0 "$DEV_PID" >/dev/null 2>&1; then
    echo "Dev server exited before readiness."
    echo "Check log: $DEV_LOG"
    sed -n '1,120p' "$DEV_LOG"
    exit 1
  fi

  if curl -fsS "$BASE_URL/api/auth/check" >/dev/null 2>&1; then
    echo "Server is ready."
    break
  fi
  sleep 1
done

if ! curl -fsS "$BASE_URL/api/auth/check" >/dev/null 2>&1; then
  echo "Server did not become ready in time."
  echo "Check log: $DEV_LOG"
  exit 1
fi

echo "Running web smoke test..."
read -r -a PLAYWRIGHT_SPECS <<< "$E2E_SPECS"
npx playwright test "${PLAYWRIGHT_SPECS[@]}" --workers=1

echo "Smoke run completed."
echo "Data dir: $E2E_DATA_DIR"
