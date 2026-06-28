#!/bin/bash
set -euo pipefail
# DEPRECATED (Fase 0): this built the retired SPM MediFlowMac executable, which no
# longer exists. Build the macOS app from the Xcode project instead:
#   scripts/generate-apple-xcodeproj.sh
#   DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild \
#     -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj \
#     -scheme MediFlowMacApp -destination 'platform=macOS' build
# The WebRuntime bundling logic this script used to contain is preserved in git
# history and is the reference for migrating bundling into the MediFlowMacApp
# build phases (macOS packaging phase, still pending).
# See docs/analysis/2026-06-28-fase0-decisioni-apple-universale.md
echo "DEPRECATED: build-native-app.sh is retired. Use the Xcode MediFlowMacApp scheme (see header)." >&2
exit 2
