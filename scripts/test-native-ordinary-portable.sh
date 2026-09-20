#!/usr/bin/env bash
# @Codex — portable Foundation DTO tests only; never substitutes for a Mac build.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '%s\n' 'import XCTest' 'XCTMain([testCase(NativeOrdinaryDTOTests.portableTests)])' > "$work/main.swift"
swiftc "$root/native/MediFlowMac/Sources/MediFlowAppleShared/NativeOrdinaryDTO.swift"   "$root/native/MediFlowMac/Tests/MediFlowAppleSharedTests/NativeOrdinaryDTOTests.swift" "$work/main.swift" -o "$work/native-ordinary-dto-tests"
"$work/native-ordinary-dto-tests"
