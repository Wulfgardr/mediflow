#!/bin/bash
# @Codex
# Entrypoint del bundle proof: avvia il server locale e apre la UI nel browser.
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BINARY="$BUNDLE_DIR/Resources/Node/bin/node"
WEB_RUNTIME="$BUNDLE_DIR/Resources/WebRuntime"
SERVER="$WEB_RUNTIME/server.js"
HOST="127.0.0.1"
PORT="${MEDIFLOW_INSTALL_PORT:-3000}"
DATA_DIR="${MEDIFLOW_DATA_DIR:-$HOME/Library/Application Support/MediFlow}"
RUNTIME_DIR="$DATA_DIR/runtime"
LOG_DIR="${MEDIFLOW_INSTALL_LOG_DIR:-$HOME/Library/Logs/MediFlow}"
PID_FILE="$RUNTIME_DIR/installability-v0.pid"
LOG_FILE="$LOG_DIR/installability-v0.log"
URL="http://$HOST:$PORT/"

fail() {
  echo "[installabilita-v0] ERRORE: $*" >&2
  exit 1
}

[[ -x "$NODE_BINARY" ]] || fail "runtime Node incorporato mancante"
[[ -f "$SERVER" ]] || fail "server Next standalone mancante"
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1024 && PORT <= 65535)) || fail "porta non valida: $PORT"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$DATA_DIR"

http_status() {
  /usr/bin/curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$URL" 2>/dev/null || true
}

open_interface() {
  if [[ "${MEDIFLOW_INSTALL_SKIP_OPEN:-0}" != "1" ]]; then
    /usr/bin/open "$URL"
  fi
}

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(tr -dc '0-9' < "$PID_FILE")"
  if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    STATUS="$(http_status)"
    if [[ "$STATUS" != "000" ]]; then
      echo "[installabilita-v0] server gia attivo: $URL ($STATUS)"
      open_interface
      exit 0
    fi
    fail "processo registrato attivo ma server non raggiungibile; vedere $LOG_FILE"
  fi
  rm -f "$PID_FILE"
fi

STATUS="$(http_status)"
if [[ "$STATUS" != "000" ]]; then
  fail "la porta $PORT risponde gia senza un processo MediFlow registrato"
fi

echo "[installabilita-v0] avvio server su $URL" >> "$LOG_FILE"
(
  cd "$WEB_RUNTIME"
  HOSTNAME="$HOST" \
  PORT="$PORT" \
  NODE_ENV=production \
  MEDIFLOW_DATA_DIR="$DATA_DIR" \
  nohup "$NODE_BINARY" "$SERVER" >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
)

SERVER_PID="$(tr -dc '0-9' < "$PID_FILE")"
for _ in {1..60}; do
  STATUS="$(http_status)"
  if [[ "$STATUS" != "000" ]]; then
    echo "[installabilita-v0] server pronto: $URL ($STATUS)"
    open_interface
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "il server si e terminato durante l'avvio; vedere $LOG_FILE"
  fi
  sleep 0.5
done

kill "$SERVER_PID" 2>/dev/null || true
rm -f "$PID_FILE"
fail "timeout in attesa del server; vedere $LOG_FILE"

