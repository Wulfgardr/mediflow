#!/bin/bash
set -euo pipefail
# DEPRECATED (Fase 0): this built the retired SPM MediFlowMac executable. The
# runnable macOS app (Xcode MediFlowMacApp scheme + bundled Next.js WebRuntime)
# is now produced by:
#   scripts/build-apple-macos-app.sh
# See native/README.md and docs/analysis/2026-06-28-fase0-decisioni-apple-universale.md
echo "DEPRECATED: build-native-app.sh is retired. Use scripts/build-apple-macos-app.sh." >&2
exit 2
