#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf -- "$test_dir"' EXIT
compiler=(swiftc -target "$(uname -m)"-apple-macos13.0 -warnings-as-errors -parse-as-library)
"${compiler[@]}" "$source_dir"/{Authentication,Protocol,Panel,Helper}.swift -o "$test_dir/helper"
"${compiler[@]}" "$source_dir"/{Authentication,Protocol,AuthenticationTests,ProtocolTests}.swift -o "$test_dir/tests"
"$test_dir/tests"
