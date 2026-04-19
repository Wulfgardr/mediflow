#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${MEDIFLOW_OPENMED_BASE_URL:-http://127.0.0.1:8080}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to probe the OpenMed sidecar." >&2
  exit 1
fi

HEALTH_PAYLOAD="$(curl --silent --show-error --fail "${BASE_URL%/}/health")"

if ! printf '%s' "$HEALTH_PAYLOAD" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
  echo "OpenMed healthcheck did not return status=ok: $HEALTH_PAYLOAD" >&2
  exit 1
fi

cd "$ROOT_DIR"
exec npm run benchmark:redaction:openmed -- "$@"
