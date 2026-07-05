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
WORKSPACE_DIR="$DATA_DIR/next-workspace"

mkdir -p "$DATA_DIR" "$LOG_DIR"

export MEDIFLOW_DATA_DIR="$DATA_DIR"
export E2E_BASE_URL="$BASE_URL"
export MEDIFLOW_LOCAL_API_TOKEN="${MEDIFLOW_LOCAL_API_TOKEN:-mediflow-e2e-local-token}"

prepare_workspace() {
  rm -rf "$WORKSPACE_DIR"
  mkdir -p "$WORKSPACE_DIR"

  for entry in app components lib public; do
    if [[ -e "$ROOT_DIR/$entry" ]]; then
      cp -R "$ROOT_DIR/$entry" "$WORKSPACE_DIR/$entry"
    fi
  done

  for entry in package.json package-lock.json tsconfig.json next-env.d.ts postcss.config.mjs; do
    if [[ -e "$ROOT_DIR/$entry" ]]; then
      cp "$ROOT_DIR/$entry" "$WORKSPACE_DIR/$entry"
    fi
  done

  cat >"$WORKSPACE_DIR/next.config.ts" <<'EOF'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: ".next-concurrency",
  turbopack: {},
  serverExternalPackages: ['pdfjs-dist', 'pm2'],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
EOF

  WORKSPACE_DIR_ENV="$WORKSPACE_DIR" node <<'NODE'
const fs = require('fs');
const path = require('path');

for (const relativePath of ['app/api/patients/route.ts', 'app/api/patients/[id]/route.ts']) {
  const filePath = path.join(process.env.WORKSPACE_DIR_ENV, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  if (relativePath === 'app/api/patients/route.ts') {
    source = source.replace(
      'export async function GET() {',
      'export async function GET(request: Request) {'
    );
  }
  source = source.replace(
    "import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';",
    "import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';"
  );
  source = source.replaceAll(
    "const session = await requireSession();",
    "const session = await requireSessionOrLocalToken(request);"
  );
  fs.writeFileSync(filePath, source);
}
NODE
}

prepare_workspace

DEV_PID=""

cleanup() {
  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
    wait "$DEV_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKSPACE_DIR"
}

trap cleanup EXIT

echo "Starting Next.js dev server..."
npx next dev "$WORKSPACE_DIR" --webpack --hostname "$HOST" --port "$PORT" >"$DEV_LOG" 2>&1 &
DEV_PID=$!

echo "Waiting for $BASE_URL/api/v1/patients ..."
for _ in {1..90}; do
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
