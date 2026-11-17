#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT_DIR/native/MediFlowMac"

fail() { echo "STRUCTURE GUARD FAILED: $1" >&2; exit 1; }

for dead in Sources/MediFlowMac Sources/MediFlowMobile Tests/MediFlowMacTests; do
  if [[ -e "$PKG/$dead" ]]; then
    fail "retired path reappeared: native/MediFlowMac/$dead (it was removed in Fase 0)"
  fi
done

if grep -qE '\.executable(Target)?\(' "$PKG/Package.swift"; then
  fail "Package.swift declares an SPM executable; the Xcode project is the only app artifact"
fi

echo "Apple structure guard passed (library + tests only; no SPM app executables)."
