#!/bin/bash
# @Codex
# Validate the macOS-only canvas Mach-O used by the isolated AnyDoc PDF page
# worker after the standalone runtime is copied into a MediFlow.app payload.
set -euo pipefail

fail() {
  echo "macOS WebRuntime native payload: $*" >&2
  exit 1
}

usage() {
  echo "Usage: $0 [--normalize] --web-runtime <path> | --binding <path> | --self-test" >&2
  exit 2
}

script_path="$0"
normalize=0
web_runtime=""
binding=""
self_test=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --normalize) normalize=1 ;;
    --web-runtime) shift; [[ $# -gt 0 ]] || usage; web_runtime="$1" ;;
    --binding) shift; [[ $# -gt 0 ]] || usage; binding="$1" ;;
    --self-test) self_test=1 ;;
    *) usage ;;
  esac
  shift
done

run_self_test() {
  local temp_dir fake_bin fixture valid_web worker_path binding_path event_log state_file events
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mediflow-macho-guard.XXXXXX")"
  trap "rm -rf '$temp_dir'" EXIT
  fake_bin="$temp_dir/bin"
  fixture="$temp_dir/skia.darwin-arm64.node"
  valid_web="$temp_dir/web-runtime"
  worker_path="$valid_web/scripts/anydoc-pdf-page-worker.mjs"
  binding_path="$valid_web/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node"
  event_log="$temp_dir/native-tool-events"
  state_file="$temp_dir/native-tool-state"
  mkdir -p "$fake_bin" "$valid_web/scripts" \
    "$valid_web/node_modules/pdf-lib" \
    "$valid_web/node_modules/pdfjs-dist/legacy/build" \
    "$valid_web/node_modules/@napi-rs/canvas" \
    "$valid_web/node_modules/@napi-rs/canvas-darwin-arm64"
  : > "$fixture"
  : > "$worker_path"
  : > "$valid_web/node_modules/pdf-lib/package.json"
  : > "$valid_web/node_modules/pdfjs-dist/package.json"
  : > "$valid_web/node_modules/pdfjs-dist/legacy/build/pdf.mjs"
  : > "$valid_web/node_modules/@napi-rs/canvas/package.json"
  : > "$valid_web/node_modules/@napi-rs/canvas-darwin-arm64/package.json"
  : > "$binding_path"

  printf '%s\n' \
    '#!/bin/bash' \
    'fixture="${MEDIFLOW_MACHO_GUARD_FIXTURE:?}"' \
    'state_file="${MEDIFLOW_MACHO_GUARD_STATE_FILE:-}"' \
    'if [[ "$fixture" == "absolute" && -n "$state_file" && -s "$state_file" ]]; then fixture=pass; fi' \
    'case "$fixture" in' \
    '  pass) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name @loader_path/skia.darwin-arm64.node (offset 24)' \
    'Load command 1' \
    '          cmd LC_LOAD_DYLIB' \
    '         name /usr/lib/libSystem.B.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  absolute) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name /Users/runner/work/canvas/skia.darwin-arm64.node (offset 24)' \
    'EOF' \
    '    ;;' \
    '  missing) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name @loader_path/skia.darwin-arm64.node (offset 24)' \
    'Load command 1' \
    '          cmd LC_LOAD_DYLIB' \
    '         name @loader_path/missing.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  traversal) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name @loader_path/skia.darwin-arm64.node (offset 24)' \
    'Load command 1' \
    '          cmd LC_LOAD_DYLIB' \
    '         name /System/Library/../../Users/runner/work/canvas.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  rpath) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name @loader_path/skia.darwin-arm64.node (offset 24)' \
    'Load command 1' \
    '          cmd LC_RPATH' \
    '         path /Users/runner/work/canvas (offset 12)' \
    'EOF' \
    '    ;;' \
    '  weak) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_LOAD_WEAK_DYLIB' \
    '         name /Users/runner/work/canvas/canvas.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  reexport) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_REEXPORT_DYLIB' \
    '         name @rpath/canvas.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  upward) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_LOAD_UPWARD_DYLIB' \
    '         name @loader_path/missing.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    'esac' > "$fake_bin/otool"
  printf '%s\n' \
    '#!/bin/bash' \
    '[[ "$#" == "3" && "$1" == "-id" && "$2" == "@loader_path/skia.darwin-arm64.node" ]] || exit 92' \
    'printf "%s\n" install-name-tool >> "${MEDIFLOW_MACHO_GUARD_EVENT_LOG:?}"' \
    'printf "%s\n" normalized > "${MEDIFLOW_MACHO_GUARD_STATE_FILE:?}"' > "$fake_bin/install_name_tool"
  printf '%s\n' \
    '#!/bin/bash' \
    'if [[ "$#" == "4" && "$1" == "--force" && "$2" == "--sign" && "$3" == "-" ]]; then' \
    '  printf "%s\n" codesign-sign >> "${MEDIFLOW_MACHO_GUARD_EVENT_LOG:?}"' \
    'elif [[ "$#" == "3" && "$1" == "--verify" && "$2" == "--strict" ]]; then' \
    '  printf "%s\n" codesign-verify >> "${MEDIFLOW_MACHO_GUARD_EVENT_LOG:?}"' \
    'else' \
    '  exit 93' \
    'fi' > "$fake_bin/codesign"
  printf '%s\n' \
    '#!/bin/bash' \
    'if [[ "$1" == "-p" ]]; then' \
    '  printf "%s\\n" "${MEDIFLOW_MACHO_GUARD_NODE_ARCH:?}"' \
    '  exit 0' \
    'fi' \
    'exit 91' > "$fake_bin/node"
  chmod 755 "$fake_bin/otool" "$fake_bin/install_name_tool" "$fake_bin/codesign" "$fake_bin/node"

  MEDIFLOW_MACHO_GUARD_FIXTURE=pass PATH="$fake_bin:$PATH" "$script_path" --binding "$fixture" >/dev/null
  if MEDIFLOW_MACHO_GUARD_FIXTURE=absolute PATH="$fake_bin:$PATH" "$script_path" --binding "$fixture" >/dev/null 2>&1; then
    fail "self-test accepted an absolute developer/CI Mach-O path"
  fi
  if MEDIFLOW_MACHO_GUARD_FIXTURE=missing PATH="$fake_bin:$PATH" "$script_path" --binding "$fixture" >/dev/null 2>&1; then
    fail "self-test accepted a missing @loader_path dylib"
  fi
  for rejected_fixture in traversal rpath weak reexport upward; do
    if MEDIFLOW_MACHO_GUARD_FIXTURE="$rejected_fixture" PATH="$fake_bin:$PATH" "$script_path" --binding "$fixture" >/dev/null 2>&1; then
      fail "self-test accepted unsafe $rejected_fixture Mach-O metadata"
    fi
  done
  : > "$event_log"
  : > "$state_file"
  MEDIFLOW_MACHO_GUARD_FIXTURE=pass \
    MEDIFLOW_MACHO_GUARD_EVENT_LOG="$event_log" \
    MEDIFLOW_MACHO_GUARD_STATE_FILE="$state_file" \
    PATH="$fake_bin:$PATH" "$script_path" --normalize --binding "$fixture" >/dev/null
  [[ ! -s "$event_log" ]] || fail "self-test signed a binding whose LC_ID_DYLIB was already normalized"
  : > "$event_log"
  : > "$state_file"
  MEDIFLOW_MACHO_GUARD_FIXTURE=absolute \
    MEDIFLOW_MACHO_GUARD_EVENT_LOG="$event_log" \
    MEDIFLOW_MACHO_GUARD_STATE_FILE="$state_file" \
    PATH="$fake_bin:$PATH" "$script_path" --normalize --binding "$fixture" >/dev/null
  events="$(cat "$event_log")"
  [[ "$events" == $'install-name-tool\ncodesign-sign\ncodesign-verify' ]] || \
    fail "self-test did not sign and verify immediately after LC_ID_DYLIB normalization"
  MEDIFLOW_MACHO_GUARD_FIXTURE=pass MEDIFLOW_MACHO_GUARD_NODE_ARCH=arm64 \
    PATH="$fake_bin:$PATH" "$script_path" --web-runtime "$valid_web" >/dev/null
  mv "$worker_path" "$worker_path.missing"
  if MEDIFLOW_MACHO_GUARD_FIXTURE=pass MEDIFLOW_MACHO_GUARD_NODE_ARCH=arm64 \
      PATH="$fake_bin:$PATH" "$script_path" --web-runtime "$valid_web" >/dev/null 2>&1; then
    fail "self-test accepted a missing isolated PDF page worker"
  fi
  mv "$worker_path.missing" "$worker_path"
  mv "$binding_path" "$binding_path.missing"
  if MEDIFLOW_MACHO_GUARD_FIXTURE=pass MEDIFLOW_MACHO_GUARD_NODE_ARCH=arm64 \
      PATH="$fake_bin:$PATH" "$script_path" --web-runtime "$valid_web" >/dev/null 2>&1; then
    fail "self-test accepted a missing canvas binding"
  fi
  echo "macOS WebRuntime native payload guard self-test passed"
}

if [[ "$self_test" == "1" ]]; then
  [[ -z "$web_runtime" && -z "$binding" && "$normalize" == "0" ]] || usage
  run_self_test
  exit 0
fi

if [[ -n "$web_runtime" ]]; then
  [[ -z "$binding" ]] || usage
  node_arch="$(node -p 'process.arch')"
  for required_path in \
    "$web_runtime/scripts/anydoc-pdf-page-worker.mjs" \
    "$web_runtime/node_modules/pdf-lib/package.json" \
    "$web_runtime/node_modules/pdfjs-dist/package.json" \
    "$web_runtime/node_modules/pdfjs-dist/legacy/build/pdf.mjs" \
    "$web_runtime/node_modules/@napi-rs/canvas/package.json" \
    "$web_runtime/node_modules/@napi-rs/canvas-darwin-$node_arch/package.json"; do
    [[ -f "$required_path" && ! -L "$required_path" ]] || \
      fail "isolated PDF worker dependency is missing or not a physical file: $required_path"
  done
  binding="$web_runtime/node_modules/@napi-rs/canvas-darwin-$node_arch/skia.darwin-$node_arch.node"
fi
[[ -n "$binding" && -f "$binding" && ! -L "$binding" ]] || \
  fail "isolated PDF worker canvas binding is missing from the WebRuntime payload"

if [[ "$normalize" == "1" ]]; then
  current_id="$(otool -l "$binding" | awk '
    /^[[:space:]]*cmd LC_ID_DYLIB/ { capture=1; next }
    capture && /^[[:space:]]*name / { print $2; exit }
  ')"
  [[ -n "$current_id" ]] || fail "isolated PDF worker canvas binding has no LC_ID_DYLIB"
  [[ "$current_id" != *'/../'* && "$current_id" != '../'* && "$current_id" != */.. ]] || fail "LC_ID_DYLIB contains path traversal: $current_id"
  if [[ "$current_id" == /* && "$current_id" != /System/Library/* && "$current_id" != /usr/lib/* ]]; then
    normalized_id="@loader_path/$(basename "$binding")"
    install_name_tool -id "$normalized_id" "$binding"
    updated_id="$(otool -l "$binding" | awk '
      /^[[:space:]]*cmd LC_ID_DYLIB/ { capture=1; next }
      capture && /^[[:space:]]*name / { print $2; exit }
    ')"
    [[ "$updated_id" == "$normalized_id" ]] || fail "LC_ID_DYLIB normalization did not produce the expected loader-relative identity"
    codesign --force --sign - "$binding"
    codesign --verify --strict "$binding"
  fi
fi

references="$(otool -l "$binding" | awk '
  /^[[:space:]]*cmd (LC_ID_DYLIB|LC_LOAD_DYLIB|LC_LOAD_WEAK_DYLIB|LC_REEXPORT_DYLIB|LC_LOAD_UPWARD_DYLIB|LC_LAZY_LOAD_DYLIB)/ { command=$2; capture="name"; next }
  /^[[:space:]]*cmd LC_RPATH/ { command=$2; capture="path"; next }
  capture && /^[[:space:]]*name / { print command "\t" $2; capture=0 }
  capture == "path" && /^[[:space:]]*path / { print command "\t" $2; capture=0 }
')"
[[ -n "$references" ]] || fail "isolated PDF worker canvas binding has no Mach-O dylib references"

while IFS=$'\t' read -r command reference; do
  [[ "$reference" != *'/../'* && "$reference" != '../'* && "$reference" != */.. ]] || fail "$command contains path traversal: $reference"
  [[ "$command" != "LC_RPATH" ]] || fail "LC_RPATH is unsupported in the isolated PDF worker canvas payload: $reference"
  case "$reference" in
    /System/Library/*|/usr/lib/*) ;;
    /*) fail "$command uses a non-system absolute path: $reference" ;;
    @loader_path/*)
      embedded_path="$(dirname "$binding")/${reference#@loader_path/}"
      [[ -f "$embedded_path" ]] || fail "$command references a missing embedded dylib: $reference"
      ;;
    @rpath/*) fail "$command uses unsupported @rpath resolution: $reference" ;;
    *) fail "$command uses an unsupported Mach-O path: $reference" ;;
  esac
done <<< "$references"

echo "macOS WebRuntime native payload guard passed: $(basename "$binding")"
