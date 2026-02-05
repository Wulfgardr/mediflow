#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# @Codex
DATA_DIR="${MEDIFLOW_DATA_DIR:-$HOME/Library/Application Support/MediFlow}"
CERT_DIR="${MEDIFLOW_TLS_CERT_DIR:-$DATA_DIR/certs}"
CERT_PATH="${MEDIFLOW_TLS_CERT_PATH:-$CERT_DIR/local-api.crt}"
KEY_PATH="${MEDIFLOW_TLS_KEY_PATH:-$CERT_DIR/local-api.key}"
PORT="${MEDIFLOW_TLS_PORT:-3443}"
HTTP_TARGET="${MEDIFLOW_HTTP_TARGET:-http://127.0.0.1:3000}"

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

cat > "$CONFIG_PATH" <<JSON
{
  "baseURL": "https://localhost:${PORT}/api/v1",
  "tlsPin": "${PIN}",
  "token": "${TOKEN_VALUE}"
}
JSON

if lsof -n -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "TLS proxy already running on port ${PORT}."
else
  echo "Starting TLS proxy on https://localhost:${PORT} ..."
  MEDIFLOW_TLS_CERT_PATH="$CERT_PATH" \
  MEDIFLOW_TLS_KEY_PATH="$KEY_PATH" \
  MEDIFLOW_TLS_PORT="$PORT" \
  MEDIFLOW_HTTP_TARGET="$HTTP_TARGET" \
  node "$ROOT_DIR/scripts/local-api-tls-proxy.mjs" &
  echo $! > "$CONFIG_DIR/local-api-tls-proxy.pid"
fi

echo "\nSetup complete."
echo "Config: $CONFIG_PATH"
echo "TLS pin: $PIN"
