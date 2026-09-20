#!/usr/bin/env bash
# @Codex: temporary synthetic CI diagnosis; not a release fix.
# One canonical synthetic execution. No rerun loop, install, provider or fallback.
set -euo pipefail
if [[ $# != 2 ]]; then echo 'Usage: NODE24=/absolute/node24 bash run-capture.sh /absolute/repo /absolute/fresh-output-directory' >&2; exit 2; fi
repo=$1
out=$2
node=${NODE24:-node}
[[ $repo == /* && $out == /* ]] || { echo 'Absolute paths required' >&2; exit 2; }
[[ -d $repo && ! -e $out ]] || { echo 'Existing repository and NEW output directory required' >&2; exit 2; }
"$node" -e 'if(process.versions.node.split(".")[0]!=="24")process.exit(2)'
tools=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo=$(cd -- "$repo" && pwd -P)
parent=$(cd -- "$(dirname -- "$out")" && pwd -P)
out="$parent/$(basename -- "$out")"
case "$out/" in "$repo/"*) echo 'Output must be outside repository' >&2; exit 2;; esac
umask 077
mkdir -- "$out"
mkdir -- "$out/synthetic-data"
# Canonical runner creates/verifies the marker itself in this fresh empty path.
cd -- "$repo"
set +e
env -u DEBUG_FILE DEBUG=pw:protocol DEBUG_COLORS=0 FORCE_COLOR=0 NEXT_TELEMETRY_DISABLED=1 MEDIFLOW_DATA_DIR="$out/synthetic-data" \
  "$node" scripts/chatgpt-product-focused-tests.mjs --browser-only 2>&1 \
  | "$node" "$tools/cdp-metadata-filter.mjs" > "$out/metadata.jsonl"
status=("${PIPESTATUS[@]}")
set -e
printf '{"canonicalExit":%d,"filterExit":%d,"attempts":1,"syntheticOnly":true}\n' "${status[0]}" "${status[1]}" > "$out/status.json"
cat -- "$out/status.json"
# A test failure stays a failure even if metadata capture succeeded.
if (( status[0] != 0 )); then exit "${status[0]}"; fi
exit "${status[1]}"
