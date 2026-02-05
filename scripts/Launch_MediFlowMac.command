#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/native-setup.sh"
"$ROOT_DIR/scripts/build-native-app.sh"

open "$ROOT_DIR/native/MediFlowMac/Build/MediFlowMac.app"
