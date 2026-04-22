#!/bin/bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DATA_DIR="${MEDIFLOW_DATA_DIR:-$HOME/Library/Application Support/MediFlow}"
DB_PATH="${MEDIFLOW_DB_PATH:-$DATA_DIR/medical.db}"
TOKEN_FILE="${MEDIFLOW_LOCAL_API_TOKEN_FILE:-$DATA_DIR/local-api-token}"
CERT_PATH="${MEDIFLOW_TLS_CERT_PATH:-$DATA_DIR/certs/local-api.crt}"
HTTP_URL="${MEDIFLOW_MOBILE_SMOKE_HTTP_URL:-http://127.0.0.1:3000}"
HTTPS_URL="${MEDIFLOW_MOBILE_SMOKE_HTTPS_URL:-https://127.0.0.1:3443}"
TLS_BIND_HOST="${MEDIFLOW_MOBILE_SMOKE_TLS_BIND_HOST:-127.0.0.1}"
TLS_PROXY_PID_FILE="${MEDIFLOW_MOBILE_SMOKE_TLS_PROXY_PID_FILE:-$DATA_DIR/local-api-tls-proxy.pid}"
RESTART_TLS_PROXY="${MEDIFLOW_MOBILE_SMOKE_RESTART_TLS_PROXY:-0}"
TLS_PROXY_PORT="${MEDIFLOW_MOBILE_SMOKE_TLS_PROXY_PORT:-3443}"
RESTORE_TLS_BIND_HOST="${MEDIFLOW_MOBILE_SMOKE_RESTORE_TLS_BIND_HOST:-127.0.0.1}"
USERNAME="${MEDIFLOW_MOBILE_SMOKE_USERNAME:-admin}"
OPERATOR_PIN="${MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN:-}"
INITIAL_SECTION="${MEDIFLOW_MOBILE_SMOKE_INITIAL_SECTION:-modules}"
AUTOLOAD_PATIENTS="${MEDIFLOW_MOBILE_SMOKE_AUTOLOAD_PATIENTS:-0}"
USE_BONJOUR="${MEDIFLOW_MOBILE_SMOKE_USE_BONJOUR:-0}"
WAIT_SECONDS="${MEDIFLOW_MOBILE_SMOKE_WAIT_SECONDS:-4}"
ARTIFACT_DIR="${MEDIFLOW_MOBILE_SMOKE_ARTIFACT_DIR:-$ROOT_DIR/tmp-mobile-home-base-paired-smoke/$(date +%Y%m%d-%H%M%S)}"
ENV_FILE="$ARTIFACT_DIR/launch.env"
SCREENSHOT_PATH="$ARTIFACT_DIR/mobile-home-base-launch.png"
SETTINGS_SNAPSHOT_PATH="$ARTIFACT_DIR/network-settings.snapshot"
BONJOUR_LOG_PATH="$ARTIFACT_DIR/bonjour.log"
BUNDLE_ID="${MEDIFLOW_IOS_BUNDLE_ID:-com.mediflow.mobile}"
SIMULATOR_ID="${MEDIFLOW_IOS_SIMULATOR_ID:-}"
SIMULATOR_NAME="${MEDIFLOW_MOBILE_SMOKE_SIMULATOR_NAME:-}"
BONJOUR_PID=""
TLS_PROXY_WAS_RUNNING=0

mkdir -p "$ARTIFACT_DIR"
[[ -n "$OPERATOR_PIN" ]] || { echo "Missing MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN."; exit 1; }
[[ -f "$DB_PATH" ]] || { echo "Database not found at $DB_PATH"; exit 1; }
[[ -f "$TOKEN_FILE" ]] || { echo "Local API token not found at $TOKEN_FILE"; exit 1; }

SIM_INFO="$(
  xcrun simctl list devices -j | node -e '
    const fs = require("fs");
    const target = process.argv[1];
    const devices = Object.values(JSON.parse(fs.readFileSync(0, "utf8")).devices || {}).flat();
    const match = target
      ? devices.find((item) => item.udid === target)
      : devices.filter((item) => item.state === "Booted").find((item) => item.name.includes("iPad"))
        ?? devices.find((item) => item.state === "Booted");
    if (!match) process.exit(1);
    process.stdout.write(`${match.udid}\t${match.name}`);
  ' "$SIMULATOR_ID"
)" || { echo "No matching booted iOS simulator found."; exit 1; }

SIMULATOR_ID="${SIM_INFO%%$'\t'*}"
SIMULATOR_NAME="${SIMULATOR_NAME:-${SIM_INFO#*$'\t'}}"

restore_network_settings() {
  [[ -f "$SETTINGS_SNAPSHOT_PATH" ]] || return
  sqlite3 "$DB_PATH" "delete from settings where key in ('network.mode','network.nodeId','network.pairing.state');"
  while IFS=$'\t' read -r key hex_value; do
    [[ -n "$key" && -n "$hex_value" ]] || continue
    sqlite3 "$DB_PATH" "insert into settings(key, value) values ('$key', CAST(x'$hex_value' AS TEXT));"
  done < "$SETTINGS_SNAPSHOT_PATH"
}

is_truthy() {
  [[ "$1" =~ ^(1|true|yes|on)$ ]]
}

is_loopback_host() {
  case "$1" in
    127.0.0.1|localhost|::1|'[::1]') return 0 ;;
    *) return 1 ;;
  esac
}

stop_tls_proxy() {
  local candidate_pids=()

  if [[ -f "$TLS_PROXY_PID_FILE" ]]; then
    local pid_from_file
    pid_from_file="$(cat "$TLS_PROXY_PID_FILE" 2>/dev/null || true)"
    if [[ "$pid_from_file" =~ ^[0-9]+$ ]]; then
      candidate_pids+=("$pid_from_file")
    fi
  fi

  while IFS= read -r pid_from_port; do
    [[ "$pid_from_port" =~ ^[0-9]+$ ]] || continue
    candidate_pids+=("$pid_from_port")
  done < <(lsof -t -iTCP:"$TLS_PROXY_PORT" -sTCP:LISTEN 2>/dev/null || true)

  local pid
  for pid in "${candidate_pids[@]}"; do
    local command
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"scripts/local-api-tls-proxy.mjs"* ]]; then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
    fi
  done

  rm -f "$TLS_PROXY_PID_FILE"
}

cleanup() {
  set +e
  xcrun simctl terminate "$SIMULATOR_ID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  if [[ -n "$BONJOUR_PID" ]]; then
    kill "$BONJOUR_PID" >/dev/null 2>&1 || true
    wait "$BONJOUR_PID" >/dev/null 2>&1 || true
  fi
  restore_network_settings
  if is_truthy "$RESTART_TLS_PROXY" && ! is_loopback_host "$TLS_BIND_HOST"; then
    stop_tls_proxy
    if [[ "$TLS_PROXY_WAS_RUNNING" -eq 1 && -n "$RESTORE_TLS_BIND_HOST" ]]; then
      MEDIFLOW_DATA_DIR="$DATA_DIR" MEDIFLOW_TLS_BIND_HOST="$RESTORE_TLS_BIND_HOST" bash scripts/native-setup.sh >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$ENV_FILE"
}

trap cleanup EXIT

sqlite3 "$DB_PATH" "select key || char(9) || hex(value) from settings where key in ('network.mode','network.nodeId','network.pairing.state') order by key;" > "$SETTINGS_SNAPSHOT_PATH"

echo "Checking local backend on $HTTP_URL ..."
curl -fsS "$HTTP_URL/api/auth/check" >/dev/null || { echo "Local backend is not reachable on $HTTP_URL. Start MediFlow first."; exit 1; }
if curl -kfsS "$HTTPS_URL/api/auth/check" >/dev/null 2>&1; then
  TLS_PROXY_WAS_RUNNING=1
fi
if is_truthy "$RESTART_TLS_PROXY"; then
  stop_tls_proxy
fi

if ! curl -kfsS "$HTTPS_URL/api/auth/check" >/dev/null 2>&1 || is_truthy "$RESTART_TLS_PROXY"; then
  if ! is_loopback_host "$TLS_BIND_HOST"; then
    local_api_token="$(cat "$TOKEN_FILE")"
    curl -fsS -X PUT "$HTTP_URL/api/settings/network.mode" \
      -H "Authorization: Bearer $local_api_token" \
      -H 'Content-Type: application/json' \
      -d '{"value":"network-home-base"}' >/dev/null
  fi

  echo "HTTPS proxy not ready on $HTTPS_URL. Running scripts/native-setup.sh ..."
  MEDIFLOW_DATA_DIR="$DATA_DIR" MEDIFLOW_TLS_BIND_HOST="$TLS_BIND_HOST" bash scripts/native-setup.sh >/dev/null
fi

https_proxy_ready=0
for _ in {1..10}; do
  if curl -kfsS "$HTTPS_URL/api/auth/check" >/dev/null 2>&1; then
    https_proxy_ready=1
    break
  fi
  sleep 1
done
[[ "$https_proxy_ready" -eq 1 ]] || { echo "HTTPS proxy is still not reachable on $HTTPS_URL."; exit 1; }
[[ -f "$CERT_PATH" ]] || { echo "TLS certificate not found at $CERT_PATH"; exit 1; }

TLS_PIN="$(openssl x509 -in "$CERT_PATH" -outform der | shasum -a 256 | awk '{print $1}')"
CLIENT_PLATFORM="${MEDIFLOW_MOBILE_SMOKE_CLIENT_PLATFORM:-ios}"
[[ "$SIMULATOR_NAME" == *"iPad"* ]] && CLIENT_PLATFORM="${MEDIFLOW_MOBILE_SMOKE_CLIENT_PLATFORM:-ipados}"

echo "Building simulator app for $SIMULATOR_NAME ..."
MEDIFLOW_IOS_SIMULATOR_ID="$SIMULATOR_ID" bash scripts/build-mobile-sim-app.sh >/dev/null

echo "Minting temporary paired credentials ..."
MEDIFLOW_MOBILE_SMOKE_ENV_FILE="$ENV_FILE" \
MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN="$OPERATOR_PIN" \
MEDIFLOW_MOBILE_SMOKE_USERNAME="$USERNAME" \
MEDIFLOW_MOBILE_SMOKE_HTTP_URL="$HTTP_URL" \
MEDIFLOW_MOBILE_SMOKE_HTTPS_URL="$HTTPS_URL" \
MEDIFLOW_MOBILE_SMOKE_TOKEN_FILE="$TOKEN_FILE" \
MEDIFLOW_MOBILE_SMOKE_TLS_PIN="$TLS_PIN" \
MEDIFLOW_MOBILE_SMOKE_INITIAL_SECTION="$INITIAL_SECTION" \
MEDIFLOW_MOBILE_SMOKE_AUTOLOAD_PATIENTS="$AUTOLOAD_PATIENTS" \
MEDIFLOW_MOBILE_SMOKE_USE_BONJOUR="$USE_BONJOUR" \
MEDIFLOW_MOBILE_SMOKE_CLIENT_PLATFORM="$CLIENT_PLATFORM" \
MEDIFLOW_MOBILE_SMOKE_SIMULATOR_NAME="$SIMULATOR_NAME" \
node --input-type=module <<'EOF'
import fs from 'node:fs';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const envFile = process.env.MEDIFLOW_MOBILE_SMOKE_ENV_FILE;
const httpUrl = process.env.MEDIFLOW_MOBILE_SMOKE_HTTP_URL;
const httpsUrl = process.env.MEDIFLOW_MOBILE_SMOKE_HTTPS_URL;
const tlsPin = process.env.MEDIFLOW_MOBILE_SMOKE_TLS_PIN;
const username = process.env.MEDIFLOW_MOBILE_SMOKE_USERNAME || '';
const operatorPin = process.env.MEDIFLOW_MOBILE_SMOKE_OPERATOR_PIN || '';
const initialSection = process.env.MEDIFLOW_MOBILE_SMOKE_INITIAL_SECTION || 'modules';
const autoLoadPatients = /^(1|true|yes|on)$/i.test(process.env.MEDIFLOW_MOBILE_SMOKE_AUTOLOAD_PATIENTS || '');
const useBonjour = /^(1|true|yes|on)$/i.test(process.env.MEDIFLOW_MOBILE_SMOKE_USE_BONJOUR || '');
const clientPlatform = process.env.MEDIFLOW_MOBILE_SMOKE_CLIENT_PLATFORM || 'ios';
const simulatorName = process.env.MEDIFLOW_MOBILE_SMOKE_SIMULATOR_NAME || 'Booted Simulator';
const localApiToken = fs.readFileSync(process.env.MEDIFLOW_MOBILE_SMOKE_TOKEN_FILE, 'utf8').trim();

const shellEscape = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const assertStatus = (result, status, message) => {
  if (result.response.status !== status) throw new Error(`${message}: ${result.response.status} ${result.text}`);
};
const extractCookie = (response) => {
  const match = (response.headers.get('set-cookie') || '').match(/mediflow_session=[^;]+/);
  if (!match) throw new Error('mediflow_session cookie was not returned by /api/auth/login');
  return match[0];
};
const request = async (baseUrl, method, pathname, { headers = {}, body } = {}) => {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { response, json, text };
};

const ambulatories = await request(httpUrl, 'GET', '/api/v1/ambulatories', {
  headers: { Authorization: `Bearer ${localApiToken}`, 'Cache-Control': 'no-store' },
});
assertStatus(ambulatories, 200, 'Failed to load ambulatories');
if (!Array.isArray(ambulatories.json) || ambulatories.json.length === 0) throw new Error('No ambulatories available in local database');
const ambulatoryId = (ambulatories.json.find((item) => item.isDefault) ?? ambulatories.json[0]).id;

const authHeaders = { Authorization: `Bearer ${localApiToken}`, 'Cache-Control': 'no-store' };
assertStatus(await request(httpUrl, 'PUT', '/api/settings/network.mode', { headers: authHeaders, body: { value: 'network-home-base' } }), 200, 'Failed to enable network-home-base mode');
const nodeSummary = await request(httpUrl, 'GET', '/api/v1/network/node', { headers: authHeaders });
assertStatus(nodeSummary, 200, 'Failed to load network node summary');
const pairingIntent = await request(httpsUrl, 'POST', '/api/v1/network/pairing-intents', {
  body: { deviceName: `${simulatorName} smoke`, clientPlatform, appVersion: '0.5.0-smoke', requestedCapabilities: ['network.replica.readonly-patients'] },
});
assertStatus(pairingIntent, 201, 'Failed to create pairing intent');
const intentId = pairingIntent.json?.intentId;
if (typeof intentId !== 'string' || !intentId) throw new Error('Pairing intent did not return an intentId');

const confirmed = await request(httpUrl, 'POST', `/api/v1/network/pairing-intents/${intentId}/confirm`, { headers: authHeaders });
assertStatus(confirmed, 201, 'Failed to confirm pairing intent');
const pairedClientId = confirmed.json?.pairedClient?.clientId;
const pairedClientToken = confirmed.json?.pairedClientToken;
if (typeof pairedClientId !== 'string' || !pairedClientId || typeof pairedClientToken !== 'string' || !pairedClientToken) {
  throw new Error('Pairing confirmation did not return client credentials');
}

const login = await request(httpsUrl, 'POST', '/api/auth/login', {
  body: { username: username || undefined, password: operatorPin },
});
assertStatus(login, 200, 'Operator login failed');
const setCookie = login.response.headers.get('set-cookie') || '';
if (!/;\s*Secure\b/i.test(setCookie)) {
  throw new Error(`HTTPS operator login did not return a Secure session cookie: ${setCookie || '<empty>'}`);
}
const cookie = extractCookie(login.response);
assertStatus(await request(httpsUrl, 'GET', '/api/v1/network/patients', {
  headers: {
    Cookie: `${cookie}; ambulatory_id=${ambulatoryId}`,
    'x-mediflow-paired-client-id': pairedClientId,
    'x-mediflow-paired-client-token': pairedClientToken,
  },
}), 200, 'Network patient read failed');

const httpsPort = Number(new URL(httpsUrl).port || '443');
const bonjourName = nodeSummary.json?.displayName || 'MediFlow Home Base';
const bonjourNodeId = nodeSummary.json?.nodeId || '';
const bonjourProtocolVersion = nodeSummary.json?.protocolVersion || '';

const envLines = [
  `export SIMCTL_CHILD_MEDIFLOW_APPLE_INITIAL_SECTION=${shellEscape(initialSection)}`,
  `export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_PAIRED_CLIENT_ID=${shellEscape(pairedClientId)}`,
  `export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_PAIRED_CLIENT_TOKEN=${shellEscape(pairedClientToken)}`,
  `export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_USERNAME=${shellEscape(username)}`,
  `export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_OPERATOR_PIN=${shellEscape(operatorPin)}`,
  `export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_AMBULATORY_ID=${shellEscape(ambulatoryId)}`,
  `export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_AUTOLOGIN='true'`,
  `export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_AUTOLOAD_PATIENTS=${autoLoadPatients ? "'true'" : "'false'"}`,
  `export MEDIFLOW_MOBILE_SMOKE_USE_BONJOUR=${useBonjour ? "'true'" : "'false'"}`,
  `export MEDIFLOW_MOBILE_SMOKE_BONJOUR_SERVICE_NAME=${shellEscape(bonjourName)}`,
  `export MEDIFLOW_MOBILE_SMOKE_BONJOUR_NODE_ID=${shellEscape(bonjourNodeId)}`,
  `export MEDIFLOW_MOBILE_SMOKE_BONJOUR_PROTOCOL_VERSION=${shellEscape(bonjourProtocolVersion)}`,
  `export MEDIFLOW_MOBILE_SMOKE_BONJOUR_TLS_PORT='${httpsPort}'`,
  `export MEDIFLOW_MOBILE_SMOKE_BONJOUR_TLS_PIN=${shellEscape(tlsPin)}`,
];
if (useBonjour) {
  envLines.push(`export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_AUTODISCOVER='true'`);
} else {
  envLines.push(`export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_SERVER_URL=${shellEscape(httpsUrl)}`);
  envLines.push(`export SIMCTL_CHILD_MEDIFLOW_HOMEBASE_TLS_PIN=${shellEscape(tlsPin)}`);
}
fs.writeFileSync(envFile, `${envLines.join('\n')}\n`, { mode: 0o600 });
EOF

echo "Launching $BUNDLE_ID on $SIMULATOR_NAME ..."
# shellcheck disable=SC1090
source "$ENV_FILE"
if [[ "$MEDIFLOW_MOBILE_SMOKE_USE_BONJOUR" =~ ^(1|true|yes|on)$ ]]; then
  TXT_RECORDS=("mode=network-home-base" "pin=${MEDIFLOW_MOBILE_SMOKE_BONJOUR_TLS_PIN:-$TLS_PIN}")
  [[ -n "${MEDIFLOW_MOBILE_SMOKE_BONJOUR_NODE_ID:-}" ]] && TXT_RECORDS+=("node=${MEDIFLOW_MOBILE_SMOKE_BONJOUR_NODE_ID}")
  [[ -n "${MEDIFLOW_MOBILE_SMOKE_BONJOUR_PROTOCOL_VERSION:-}" ]] && TXT_RECORDS+=("proto=${MEDIFLOW_MOBILE_SMOKE_BONJOUR_PROTOCOL_VERSION}")
  dns-sd -R "${MEDIFLOW_MOBILE_SMOKE_BONJOUR_SERVICE_NAME:-MediFlow Home Base}" "_mediflow-homebase._tcp" "local." "${MEDIFLOW_MOBILE_SMOKE_BONJOUR_TLS_PORT:-3443}" "${TXT_RECORDS[@]}" >"$BONJOUR_LOG_PATH" 2>&1 &
  BONJOUR_PID=$!
  sleep 2
  kill -0 "$BONJOUR_PID" >/dev/null 2>&1 || { echo "Bonjour advertiser failed to start."; exit 1; }
fi
xcrun simctl launch --terminate-running-process "$SIMULATOR_ID" "$BUNDLE_ID" >/dev/null
sleep "$WAIT_SECONDS"
xcrun simctl io "$SIMULATOR_ID" screenshot "$SCREENSHOT_PATH" >/dev/null

echo
echo "Mobile home-base paired smoke completed."
echo "Simulator: $SIMULATOR_NAME ($SIMULATOR_ID)"
echo "Artifacts: $ARTIFACT_DIR"
echo "Screenshot: $SCREENSHOT_PATH"
if [[ "$USE_BONJOUR" =~ ^(1|true|yes|on)$ ]]; then
  echo "Bonjour: advertised temporary _mediflow-homebase._tcp service"
  echo "Bonjour log: $BONJOUR_LOG_PATH"
fi
if [[ "$AUTOLOAD_PATIENTS" =~ ^(1|true|yes|on)$ ]]; then
  echo "Note: screenshot may contain PHI because auto-load was enabled."
else
  echo "Note: auto-load disabled; screenshot should stay free of patient names."
fi
