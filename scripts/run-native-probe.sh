#!/usr/bin/env bash
# @Codex

set -euo pipefail

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-beta.app/Contents/Developer}"

readonly DEFAULT_APP_PATH="/Users/leonardopegollo/Library/Developer/Xcode/DerivedData/MediFlowAppleApp-edpphlcvfcupapayqnhdhkuegdnn/Build/Products/Debug/MediFlow.app"
APP_PATH="$DEFAULT_APP_PATH"

usage() {
    printf 'Usage: %s [--app-path /path/to/MediFlow.app]\n' "$(basename "$0")"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --app-path)
            if [[ $# -lt 2 ]]; then
                printf 'Missing value for --app-path.\n' >&2
                usage >&2
                exit 2
            fi
            APP_PATH="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown argument: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROBE_PATH="$SCRIPT_DIR/native-click-map-probe.swift"
readonly APP_EXECUTABLE="$APP_PATH/Contents/MacOS/MediFlow"

if [[ ! -x "$APP_EXECUTABLE" ]]; then
    printf 'MediFlow executable not found: %s\n' "$APP_EXECUTABLE" >&2
    exit 2
fi

if [[ ! -f "$PROBE_PATH" ]]; then
    printf 'Native probe not found: %s\n' "$PROBE_PATH" >&2
    exit 2
fi

/usr/bin/pkill -x MediFlow >/dev/null 2>&1 || true
for _ in {1..50}; do
    if ! /usr/bin/pgrep -x MediFlow >/dev/null 2>&1; then
        break
    fi
    sleep 0.1
done

if /usr/bin/pgrep -x MediFlow >/dev/null 2>&1; then
    printf 'Unable to stop the previous MediFlow process.\n' >&2
    exit 1
fi

MEDIFLOW_APPLE_UITEST_PATIENTS=1 \
    "$APP_EXECUTABLE" -ApplePersistenceIgnoreState YES >/dev/null 2>&1 &
readonly APP_PID=$!

cleanup() {
    local status=$?
    trap - EXIT INT TERM
    if kill -0 "$APP_PID" >/dev/null 2>&1; then
        kill "$APP_PID" >/dev/null 2>&1 || true
        wait "$APP_PID" >/dev/null 2>&1 || true
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Waiting for MediFlow AX readiness...\n'
xcrun swift -e '
import AppKit
import ApplicationServices
import Foundation

guard AXIsProcessTrusted() else {
    fputs("Accessibility access is not enabled for the current process.\n", stderr)
    exit(1)
}

guard let rawPID = CommandLine.arguments.dropFirst().first,
      let pid = pid_t(rawPID),
      let app = NSRunningApplication(processIdentifier: pid) else {
    fputs("Unable to resolve the launched MediFlow process.\n", stderr)
    exit(1)
}

let deadline = Date().addingTimeInterval(15)
repeat {
    if app.isTerminated {
        fputs("MediFlow terminated before AX readiness.\n", stderr)
        exit(1)
    }

    let appElement = AXUIElementCreateApplication(pid)
    var value: CFTypeRef?
    if AXUIElementCopyAttributeValue(
        appElement,
        kAXWindowsAttribute as CFString,
        &value
    ) == .success,
       let windows = value as? [AXUIElement],
       !windows.isEmpty {
        guard app.activate(options: [.activateAllWindows]) else {
            fputs("Unable to activate the MediFlow window.\n", stderr)
            exit(1)
        }
        print("MediFlow AX window ready.")
        exit(0)
    }
    RunLoop.current.run(until: Date().addingTimeInterval(0.2))
} while Date() < deadline

fputs("Timed out waiting for the MediFlow AX window.\n", stderr)
exit(1)
' "$APP_PID"

printf 'Running native click-map probe...\n'
xcrun swift "$PROBE_PATH" --app-path "$APP_PATH"
