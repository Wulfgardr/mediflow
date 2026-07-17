#!/bin/bash
# @Codex
# Entrypoint del bundle proof: avvia il server locale e apre la UI nel browser.
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BINARY="$BUNDLE_DIR/Resources/Node/bin/node"
WEB_RUNTIME="$BUNDLE_DIR/Resources/WebRuntime"
SERVER="$WEB_RUNTIME/server.js"
IDENTITY_FILE="$WEB_RUNTIME/mediflow-installability-v0-identity.json"
HOST="127.0.0.1"
PORT="${MEDIFLOW_INSTALL_PORT:-3000}"
DATA_DIR="${MEDIFLOW_DATA_DIR:-$HOME/Library/Application Support/MediFlow}"
RUNTIME_DIR="$DATA_DIR/runtime"
LOG_DIR="${MEDIFLOW_INSTALL_LOG_DIR:-$HOME/Library/Logs/MediFlow}"
PID_FILE="$RUNTIME_DIR/installability-v0.pid"
LOG_FILE="$LOG_DIR/installability-v0.log"
URL="http://$HOST:$PORT/"
REVISION_URL="${URL}api/system/revision"
PROBE_FILE="$RUNTIME_DIR/installability-v0-revision-probe.json"

fail() {
  echo "[installabilita-v0] ERRORE: $*" >&2
  exit 1
}

[[ -x "$NODE_BINARY" ]] || fail "runtime Node incorporato mancante"
[[ -f "$SERVER" ]] || fail "server Next standalone mancante"
[[ -f "$IDENTITY_FILE" ]] || fail "identita bundle mancante"
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1024 && PORT <= 65535)) || fail "porta non valida: $PORT"

umask 077
mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$DATA_DIR"
trap 'rm -f "$PROBE_FILE"' EXIT

EXPECTED_REVISION="$($NODE_BINARY -p 'require(process.argv[1]).revision' "$IDENTITY_FILE")"
EXPECTED_SOURCE_FINGERPRINT="$($NODE_BINARY -p 'require(process.argv[1]).sourceFingerprint' "$IDENTITY_FILE")"
[[ -n "$EXPECTED_REVISION" && -n "$EXPECTED_SOURCE_FINGERPRINT" ]] || fail "identita bundle incompleta"

http_status() {
  /usr/bin/curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$1" 2>/dev/null || true
}

mediflow_server_ready() {
  [[ "$(http_status "$URL")" == "200" ]] || return 1

  local revision_status
  revision_status="$(/usr/bin/curl --silent --output "$PROBE_FILE" --write-out '%{http_code}' --max-time 2 "$REVISION_URL" 2>/dev/null || true)"
  [[ "$revision_status" == "200" ]] || return 1

  "$NODE_BINARY" - "$PROBE_FILE" "$EXPECTED_REVISION" "$EXPECTED_SOURCE_FINGERPRINT" <<'NODE' >/dev/null 2>&1
const fs = require('node:fs');

const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (payload.revision !== process.argv[3] ||
    payload.sourceFingerprint !== process.argv[4] ||
    payload.fingerprint !== process.argv[4]) {
  process.exit(1);
}
NODE
}

open_interface() {
  if [[ "${MEDIFLOW_INSTALL_SKIP_OPEN:-0}" != "1" ]]; then
    /usr/bin/open "$URL"
  fi
}

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(tr -dc '0-9' < "$PID_FILE")"
  if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    if mediflow_server_ready; then
      echo "[installabilita-v0] server MediFlow gia attivo: $URL (200)"
      open_interface
      exit 0
    fi
    fail "processo registrato attivo ma identita MediFlow non valida; vedere $LOG_FILE"
  fi
  rm -f "$PID_FILE"
fi

STATUS="$(http_status "$URL")"
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
  MEDIFLOW_APP_REVISION="$EXPECTED_REVISION" \
  MEDIFLOW_APP_SOURCE_FINGERPRINT="$EXPECTED_SOURCE_FINGERPRINT" \
  MEDIFLOW_APP_FINGERPRINT="$EXPECTED_SOURCE_FINGERPRINT" \
  nohup "$NODE_BINARY" "$SERVER" >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
)

SERVER_PID="$(tr -dc '0-9' < "$PID_FILE")"
for _ in {1..60}; do
  STATUS="$(http_status "$URL")"
  if mediflow_server_ready; then
    echo "[installabilita-v0] server MediFlow pronto: $URL (200)"
    open_interface
    exit 0
  fi
  if [[ "$STATUS" != "000" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    rm -f "$PID_FILE"
    fail "il server risponde ma identita o stato MediFlow non sono validi; vedere $LOG_FILE"
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "il server si e terminato durante l'avvio; vedere $LOG_FILE"
  fi
  sleep 0.5
done

kill "$SERVER_PID" 2>/dev/null || true
rm -f "$PID_FILE"
fail "timeout in attesa del server; vedere $LOG_FILE"
