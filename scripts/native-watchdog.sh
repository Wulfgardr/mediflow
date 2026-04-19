#!/bin/bash
# @Codex
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="MediFlowMac"
APP_PATH="$ROOT_DIR/native/MediFlowMac/Build/MediFlowMac.app"
POLL_SECONDS="${1:-4}"

if ! command -v osascript >/dev/null 2>&1; then
    echo "native-watchdog: osascript non disponibile, watchdog disabilitato."
    exit 0
fi

saw_running=0

while true; do
    if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
        saw_running=1
    else
        if [ "$saw_running" -eq 1 ]; then
            # @Codex
            response=$(osascript -e "button returned of (display dialog \"L'app nativa MediFlow si e chiusa. Vuoi riaprirla?\" buttons {\"Non ora\", \"Riapri\"} default button \"Riapri\" with icon note)")
            if [ "$response" = "Riapri" ]; then
                if [ -d "$APP_PATH" ]; then
                    open "$APP_PATH"
                else
                    open -a "$APP_NAME" || true
                fi
            fi
            saw_running=0
        fi
    fi
    sleep "$POLL_SECONDS"
done
