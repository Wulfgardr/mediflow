#!/bin/bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DATA_DIR="${MEDIFLOW_NETWORK_SMOKE_DATA_DIR:-$ROOT_DIR/tmp-network-home-base-readonly}"
LOG_DIR="$DATA_DIR/logs"
DEV_LOG="$LOG_DIR/next-dev.log"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3200}"
REPORT_PATH="$DATA_DIR/reports/network-home-base-readonly-report.json"
HOST="$(node -e "const u=new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:3200'); console.log(u.hostname)")"
PORT="$(node -e "const u=new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:3200'); console.log(u.port || (u.protocol === 'https:' ? '443' : '80'))")"
WORKSPACE_DIR="$DATA_DIR/next-workspace"

mkdir -p "$DATA_DIR" "$LOG_DIR"

export MEDIFLOW_DATA_DIR="$DATA_DIR"
export E2E_BASE_URL="$BASE_URL"
export MEDIFLOW_LOCAL_API_TOKEN="${MEDIFLOW_LOCAL_API_TOKEN:-mediflow-network-smoke-local-token}"
export E2E_PIN="${E2E_PIN:-1234}"
export E2E_USERNAME="${E2E_USERNAME:-admin}"

prepare_workspace() {
  rm -rf "$WORKSPACE_DIR"
  mkdir -p "$WORKSPACE_DIR"

  for entry in app components lib public drizzle; do
    if [[ -e "$ROOT_DIR/$entry" ]]; then
      cp -R "$ROOT_DIR/$entry" "$WORKSPACE_DIR/$entry"
    fi
  done

  for entry in package.json package-lock.json tsconfig.json next-env.d.ts postcss.config.mjs; do
    if [[ -e "$ROOT_DIR/$entry" ]]; then
      cp "$ROOT_DIR/$entry" "$WORKSPACE_DIR/$entry"
    fi
  done

  if [[ -d "$ROOT_DIR/node_modules" ]]; then
    ln -s "$ROOT_DIR/node_modules" "$WORKSPACE_DIR/node_modules"
  fi

  cat >"$WORKSPACE_DIR/next.config.ts" <<'EOF'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: ".next-network-smoke",
  turbopack: {},
  serverExternalPackages: ['pdfjs-dist', 'pm2'],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
EOF
}

prepare_workspace

(
  cd "$WORKSPACE_DIR"
  node "$ROOT_DIR/scripts/prepare-e2e-db.mjs"
)

DEV_PID=""

cleanup() {
  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
    wait "$DEV_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKSPACE_DIR" >/dev/null 2>&1 || {
    sleep 1
    rm -rf "$WORKSPACE_DIR" >/dev/null 2>&1 || true
  }
}

trap cleanup EXIT

echo "Starting Next.js dev server for network home-base smoke..."
(
  cd "$WORKSPACE_DIR"
  npx next dev --webpack --hostname "$HOST" --port "$PORT"
) >"$DEV_LOG" 2>&1 &
DEV_PID=$!

echo "Waiting for $BASE_URL/api/v1/ambulatories ..."
for _ in {1..120}; do
  if curl -fsS -H "Authorization: Bearer $MEDIFLOW_LOCAL_API_TOKEN" "$BASE_URL/api/v1/ambulatories" >/dev/null 2>&1; then
    echo "Server is ready."
    break
  fi
  sleep 1
done

if ! curl -fsS -H "Authorization: Bearer $MEDIFLOW_LOCAL_API_TOKEN" "$BASE_URL/api/v1/ambulatories" >/dev/null 2>&1; then
  echo "Server did not become ready in time."
  echo "Check log: $DEV_LOG"
  exit 1
fi

echo "Running network home-base read-only smoke..."
node --test --test-concurrency=1 scripts/network-home-base-readonly.test.mjs

echo "Network home-base read-only smoke completed."
echo "Data dir: $DATA_DIR"
echo "Report: $REPORT_PATH"
