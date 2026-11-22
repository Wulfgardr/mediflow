#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mediflow-patient-ambulatory-membership.XXXXXX")"
trap 'rm -rf -- "$DATA_DIR"' EXIT

MEDIFLOW_DATA_DIR="${MEDIFLOW_DATA_DIR:-$DATA_DIR}" \
MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1 \
  node "$ROOT_DIR/scripts/run-strip-types.mjs" --test "$ROOT_DIR/lib/patient-ambulatory-membership.test.ts"
