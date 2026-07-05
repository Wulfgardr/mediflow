#!/bin/bash
set -euo pipefail
# DEPRECATED (Fase 0): this built the retired SPM MediFlowMobile executable, which
# no longer exists. Build the iOS app from the Xcode project instead:
#   scripts/generate-apple-xcodeproj.sh
#   DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild \
#     -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj \
#     -scheme MediFlowMobileApp -destination 'generic/platform=iOS Simulator' build
# The old hand-assembled simulator-bundle logic is preserved in git history.
# See docs/analysis/2026-06-28-fase0-decisioni-apple-universale.md
echo "DEPRECATED: build-mobile-sim-app.sh is retired. Use the Xcode MediFlowMobileApp scheme (see header)." >&2
exit 2
