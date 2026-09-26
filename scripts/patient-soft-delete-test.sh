#!/usr/bin/env bash
set -euo pipefail

# WUL-306 / WUL-322 (ADR 0066): patient soft-delete lifecycle tests.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT_DIR/scripts/run-patient-soft-delete-suite.mjs"
