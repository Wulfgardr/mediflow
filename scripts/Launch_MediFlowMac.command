#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${MEDIFLOW_MAC_CONFIG:-Debug}"
DERIVED="${MEDIFLOW_MAC_DERIVED_DATA:-$ROOT_DIR/tmp-mac-derived-data}"
APP="$DERIVED/Build/Products/$CONFIG/MediFlow.app"

"$ROOT_DIR/scripts/native-setup.sh"
"$ROOT_DIR/scripts/build-apple-macos-app.sh"

# @Codex: the universal Xcode target is the only supported macOS entrypoint.
if [[ ! -d "$APP" ]]; then
  echo "Bundle macOS non trovato: $APP" >&2
  exit 1
fi

open -n "$APP"
