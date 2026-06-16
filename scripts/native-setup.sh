#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# @Codex
DATA_DIR="${MEDIFLOW_DATA_DIR:-$HOME/Library/Application Support/MediFlow}"
DB_PATH="${MEDIFLOW_DB_PATH:-$DATA_DIR/medical.db}"
CERT_DIR="${MEDIFLOW_TLS_CERT_DIR:-$DATA_DIR/certs}"
CERT_PATH="${MEDIFLOW_TLS_CERT_PATH:-$CERT_DIR/local-api.crt}"
KEY_PATH="${MEDIFLOW_TLS_KEY_PATH:-$CERT_DIR/local-api.key}"
PORT="${MEDIFLOW_TLS_PORT:-3443}"
HTTP_TARGET="${MEDIFLOW_HTTP_TARGET:-http://127.0.0.1:3000}"
BIND_HOST="${MEDIFLOW_TLS_BIND_HOST:-127.0.0.1}"

is_loopback_host() {
  case "$1" in
    127.0.0.1|localhost|::1|'[::1]') return 0 ;;
    *) return 1 ;;
  esac
}

mkdir -p "$CERT_DIR"

if [[ ! -f "$CERT_PATH" || ! -f "$KEY_PATH" ]]; then
  echo "Generating self-signed certificate..."
  openssl req -x509 -newkey rsa:2048 \
    -keyout "$KEY_PATH" \
    -out "$CERT_PATH" \
    -days 365 -nodes -subj "/CN=localhost" >/dev/null 2>&1
fi

PIN=$(openssl x509 -in "$CERT_PATH" -outform der | shasum -a 256 | awk '{print $1}')

CONFIG_DIR="$DATA_DIR"
CONFIG_PATH="$CONFIG_DIR/native-config.json"
RUNTIME_STATUS_PATH="$CONFIG_DIR/runtime-status.json"

mkdir -p "$CONFIG_DIR"

# @Codex
TOKEN_FILE="$DATA_DIR/local-api-token"
if [[ -n "${MEDIFLOW_LOCAL_API_TOKEN:-}" ]]; then
  TOKEN_VALUE="$MEDIFLOW_LOCAL_API_TOKEN"
elif [[ -f "$TOKEN_FILE" ]]; then
  TOKEN_VALUE="$(cat "$TOKEN_FILE")"
else
  TOKEN_VALUE="$(openssl rand -hex 32)"
  umask 077
  echo "$TOKEN_VALUE" > "$TOKEN_FILE"
fi

NETWORK_MODE="local-only"
if [[ -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
  DB_NETWORK_MODE="$(sqlite3 "$DB_PATH" "select value from settings where key = 'network.mode' limit 1;" 2>/dev/null || true)"
  if [[ "$DB_NETWORK_MODE" == "network-home-base" ]]; then
    NETWORK_MODE="network-home-base"
  fi
fi

if ! is_loopback_host "$BIND_HOST" && [[ "$NETWORK_MODE" != "network-home-base" ]]; then
  echo "Refusing TLS bind on ${BIND_HOST}: network.mode is ${NETWORK_MODE}. Enable network-home-base first."
  exit 1
fi

cat > "$CONFIG_PATH" <<JSON
{
  "baseURL": "https://localhost:${PORT}/api/v1",
  "tlsPin": "${PIN}",
  "token": "${TOKEN_VALUE}"
}
JSON

write_runtime_status() {
  MEDIFLOW_RUNTIME_STATUS_PATH="$RUNTIME_STATUS_PATH" \
  MEDIFLOW_RUNTIME_BASE_URL="https://localhost:${PORT}/api/v1" \
  MEDIFLOW_RUNTIME_TLS_PIN="$PIN" \
  MEDIFLOW_RUNTIME_NETWORK_MODE="$NETWORK_MODE" \
  MEDIFLOW_RUNTIME_PORT="$PORT" \
  MEDIFLOW_RUNTIME_BIND_HOST="$BIND_HOST" \
  MEDIFLOW_RUNTIME_HTTP_TARGET="$HTTP_TARGET" \
  MEDIFLOW_RUNTIME_CERT_PATH="$CERT_PATH" \
  MEDIFLOW_RUNTIME_KEY_PATH="$KEY_PATH" \
  MEDIFLOW_RUNTIME_PROXY_PID_PATH="$CONFIG_DIR/local-api-tls-proxy.pid" \
  node <<'NODE'
const fs = require('fs');

const status = {
  generatedAt: new Date().toISOString(),
  baseURL: process.env.MEDIFLOW_RUNTIME_BASE_URL,
  tlsPin: process.env.MEDIFLOW_RUNTIME_TLS_PIN,
  networkMode: process.env.MEDIFLOW_RUNTIME_NETWORK_MODE,
  port: Number(process.env.MEDIFLOW_RUNTIME_PORT),
  bindHost: process.env.MEDIFLOW_RUNTIME_BIND_HOST,
  httpTarget: process.env.MEDIFLOW_RUNTIME_HTTP_TARGET,
  certPath: process.env.MEDIFLOW_RUNTIME_CERT_PATH,
  keyPath: process.env.MEDIFLOW_RUNTIME_KEY_PATH,
  proxyPidPath: process.env.MEDIFLOW_RUNTIME_PROXY_PID_PATH
};

fs.writeFileSync(process.env.MEDIFLOW_RUNTIME_STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
NODE
}

if lsof -n -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "TLS proxy already running on port ${PORT}."
  write_runtime_status
else
  echo "Starting TLS proxy on https://${BIND_HOST}:${PORT} ..."
  MEDIFLOW_TLS_CERT_PATH="$CERT_PATH" \
  MEDIFLOW_TLS_KEY_PATH="$KEY_PATH" \
  MEDIFLOW_TLS_PORT="$PORT" \
  MEDIFLOW_HTTP_TARGET="$HTTP_TARGET" \
  MEDIFLOW_TLS_BIND_HOST="$BIND_HOST" \
  MEDIFLOW_TLS_NETWORK_MODE="$NETWORK_MODE" \
  node "$ROOT_DIR/scripts/local-api-tls-proxy.mjs" &
  echo $! > "$CONFIG_DIR/local-api-tls-proxy.pid"
  write_runtime_status
fi

echo "\nSetup complete."
echo "Config: $CONFIG_PATH"
echo "Runtime status: $RUNTIME_STATUS_PATH"
echo "TLS pin: $PIN"
