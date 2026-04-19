#!/bin/bash
set -euo pipefail

# @Codex
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/native/MediFlowMac"

# @Codex
RUNNER="${MEDIFLOW_NATIVE_TEST_RUNNER:-swift}" # swift | xcode | both
DERIVED_DATA_DIR="${MEDIFLOW_DERIVED_DATA_DIR:-$ROOT_DIR/tmp-native-derived-data}"
XCODE_SCHEME="${MEDIFLOW_XCODE_SCHEME:-MediFlowMac}"
XCODE_DESTINATION="${MEDIFLOW_XCODE_DESTINATION:-platform=macOS,arch=arm64}"

run_swift_tests() {
  echo "Running SwiftPM tests..."
  swift test --package-path "$PACKAGE_DIR"
}

run_xcode_tests() {
  if ! command -v xcodebuild >/dev/null 2>&1; then
    echo "xcodebuild not found. Install Xcode Command Line Tools."
    exit 1
  fi

  mkdir -p "$DERIVED_DATA_DIR"
  echo "Running Xcode tests (scheme: $XCODE_SCHEME)..."
  (
    cd "$PACKAGE_DIR"
    xcodebuild \
      -scheme "$XCODE_SCHEME" \
      -destination "$XCODE_DESTINATION" \
      -derivedDataPath "$DERIVED_DATA_DIR" \
      test
  )
}

case "$RUNNER" in
  swift)
    run_swift_tests
    ;;
  xcode)
    run_xcode_tests
    ;;
  both)
    run_swift_tests
    run_xcode_tests
    ;;
  *)
    echo "Invalid MEDIFLOW_NATIVE_TEST_RUNNER: $RUNNER (expected: swift, xcode, both)"
    exit 1
    ;;
esac
