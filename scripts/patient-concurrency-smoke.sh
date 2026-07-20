#!/bin/bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DATA_DIR="${MEDIFLOW_CONCURRENCY_DATA_DIR:-$ROOT_DIR/tmp-concurrency-data}"
LOG_DIR="$DATA_DIR/logs"
DEV_LOG="$LOG_DIR/next-dev.log"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3100}"
REPORT_PATH="$DATA_DIR/reports/patient-concurrency-report.json"
HOST="$(node -e "const u=new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:3100'); console.log(u.hostname)")"
PORT="$(node -e "const u=new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:3100'); console.log(u.port || (u.protocol === 'https:' ? '443' : '80'))")"
DIST_DIR="$ROOT_DIR/.next-patient-concurrency"

mkdir -p "$DATA_DIR" "$LOG_DIR"
rm -f "$DATA_DIR/medical.db"
rm -rf "$DIST_DIR"

export MEDIFLOW_DATA_DIR="$DATA_DIR"
export E2E_BASE_URL="$BASE_URL"
export MEDIFLOW_LOCAL_API_TOKEN="${MEDIFLOW_LOCAL_API_TOKEN:-mediflow-e2e-local-token}"
export MEDIFLOW_NEXT_DIST_DIR=".next-patient-concurrency"
export E2E_PIN="${E2E_PIN:-1234}"
export E2E_USERNAME="${E2E_USERNAME:-admin}"

node "$ROOT_DIR/scripts/prepare-e2e-db.mjs"

DEV_PID=""

cleanup() {
  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
    wait "$DEV_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$DIST_DIR"
}

trap cleanup EXIT

echo "Starting Next.js dev server..."
npx next dev --webpack --hostname "$HOST" --port "$PORT" >"$DEV_LOG" 2>&1 &
DEV_PID=$!

echo "Waiting for $BASE_URL/api/v1/patients ..."
for _ in {1..90}; do
  if ! kill -0 "$DEV_PID" >/dev/null 2>&1; then
    echo "Dev server exited before readiness."
    echo "Check log: $DEV_LOG"
    sed -n '1,120p' "$DEV_LOG"
    exit 1
  fi

  if curl -fsS -H "Authorization: Bearer $MEDIFLOW_LOCAL_API_TOKEN" "$BASE_URL/api/v1/patients" >/dev/null 2>&1; then
    echo "Server is ready."
    break
  fi
  sleep 1
done

if ! curl -fsS -H "Authorization: Bearer $MEDIFLOW_LOCAL_API_TOKEN" "$BASE_URL/api/v1/patients" >/dev/null 2>&1; then
  echo "Server did not become ready in time."
  echo "Check log: $DEV_LOG"
  exit 1
fi

echo "Running patient concurrency suite..."
node --test --test-concurrency=1 scripts/patient-concurrency.test.mjs

echo "Concurrency run completed."
echo "Data dir: $DATA_DIR"
echo "Report: $REPORT_PATH"
