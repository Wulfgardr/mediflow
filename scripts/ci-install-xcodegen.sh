#!/bin/bash
set -euo pipefail

version=2.47.0
digest=6ef12a3ef5327c2c713397f46d9160550f8b1cdc5c925cd884d65c77c9f696cd
staging=$(mktemp -d "${RUNNER_TEMP:?}/xcodegen.XXXXXXXX")
cd "$staging"
curl --proto '=https' --fail --location --silent --show-error --retry 3 \
  "https://github.com/yonaskolb/XcodeGen/releases/download/$version/xcodegen.zip" --output xcodegen.zip
printf '%s  %s\n' "$digest" xcodegen.zip | shasum -a 256 --check --status
unzip -q xcodegen.zip
test "$(xcodegen/bin/xcodegen --version)" = "Version: $version"
printf '%s\n' "$staging/xcodegen/bin" >> "${GITHUB_PATH:?}"
