#!/bin/bash
# Packaging guard: fails if the shippable Apple target Info.plist is missing the
# local-network discovery keys. Without these, Bonjour discovery and home-base
# pairing are dead on a real device (the central feature). Run after xcodegen.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BONJOUR_SERVICE_TYPE="${MEDIFLOW_IOS_BONJOUR_SERVICE_TYPE:-_mediflow-homebase._tcp}"

# Info.plist files that MUST carry the local-network keys (one per shippable target).
PLISTS=(
  "$ROOT_DIR/native/MediFlowAppleApp/Sources/MediFlowMobileApp/Info.plist"
)
# macOS plist is optional until the native macOS target lands; check it if present.
MAC_PLIST="$ROOT_DIR/native/MediFlowAppleApp/Sources/MediFlowMacApp/Info.plist"
[[ -f "$MAC_PLIST" ]] && PLISTS+=("$MAC_PLIST")

fail() { echo "ENTITLEMENT GUARD FAILED: $1" >&2; exit 1; }

require_key() {
  local plist="$1" key="$2"
  /usr/libexec/PlistBuddy -c "Print :$key" "$plist" >/dev/null 2>&1 \
    || fail "$plist is missing required key '$key'"
}

for plist in "${PLISTS[@]}"; do
  [[ -f "$plist" ]] || fail "expected Info.plist not found at $plist (run scripts/generate-apple-xcodeproj.sh)"
  plutil -lint "$plist" >/dev/null || fail "$plist is not a valid plist"
  require_key "$plist" "NSLocalNetworkUsageDescription"
  require_key "$plist" "NSBonjourServices"
  if ! /usr/libexec/PlistBuddy -c "Print :NSBonjourServices" "$plist" | grep -q "$BONJOUR_SERVICE_TYPE"; then
    fail "$plist NSBonjourServices does not advertise '$BONJOUR_SERVICE_TYPE'"
  fi
  echo "OK: $plist carries NSLocalNetworkUsageDescription + NSBonjourServices ($BONJOUR_SERVICE_TYPE)"
done

echo "Apple network entitlement guard passed."
