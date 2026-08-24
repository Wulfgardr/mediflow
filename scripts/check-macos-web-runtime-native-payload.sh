#!/bin/bash
# @Codex
# Validate the macOS-only PDF inspector Mach-O after it is copied into a
# MediFlow.app payload. The package's .node file is itself a Mach-O dylib.
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
  local temp_dir fake_bin fixture x64_web arm64_web
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mediflow-macho-guard.XXXXXX")"
  trap "rm -rf '$temp_dir'" EXIT
  fake_bin="$temp_dir/bin"
  fixture="$temp_dir/pdf-inspector.darwin-arm64.node"
  x64_web="$temp_dir/x64-web-runtime"
  arm64_web="$temp_dir/arm64-web-runtime"
  mkdir -p "$fake_bin"
  : > "$fixture"
  : > "$temp_dir/libpdf_inspector_napi.dylib"
  mkdir -p "$x64_web/node_modules/pdfjs-dist/legacy/build" "$x64_web/scripts" "$arm64_web"
  : > "$x64_web/node_modules/pdfjs-dist/legacy/build/pdf.mjs"
  : > "$x64_web/scripts/pdf-inspector-worker.mjs"

  printf '%s\n' \
    '#!/bin/bash' \
    'case "${MEDIFLOW_MACHO_GUARD_FIXTURE:?}" in' \
    '  pass) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name @loader_path/pdf-inspector.darwin-arm64.node (offset 24)' \
    'Load command 1' \
    '          cmd LC_LOAD_DYLIB' \
    '         name @loader_path/libpdf_inspector_napi.dylib (offset 24)' \
    'Load command 2' \
    '          cmd LC_LOAD_DYLIB' \
    '         name /usr/lib/libSystem.B.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  absolute) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name /Users/runner/work/pdf-inspector/libpdf_inspector_napi.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  missing) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name @loader_path/pdf-inspector.darwin-arm64.node (offset 24)' \
    'Load command 1' \
    '          cmd LC_LOAD_DYLIB' \
    '         name @loader_path/missing.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  traversal) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name @loader_path/pdf-inspector.darwin-arm64.node (offset 24)' \
    'Load command 1' \
    '          cmd LC_LOAD_DYLIB' \
    '         name /System/Library/../../Users/runner/work/libpdf_inspector_napi.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  rpath) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_ID_DYLIB' \
    '         name @loader_path/pdf-inspector.darwin-arm64.node (offset 24)' \
    'Load command 1' \
    '          cmd LC_RPATH' \
    '         path /Users/runner/work/pdf-inspector (offset 12)' \
    'EOF' \
    '    ;;' \
    '  weak) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_LOAD_WEAK_DYLIB' \
    '         name /Users/runner/work/pdf-inspector/libpdf_inspector_napi.dylib (offset 24)' \
    'EOF' \
    '    ;;' \
    '  reexport) cat <<"EOF"' \
    'Load command 0' \
    '          cmd LC_REEXPORT_DYLIB' \
    '         name @rpath/libpdf_inspector_napi.dylib (offset 24)' \
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
    'if [[ "$1" == "-p" ]]; then' \
    '  printf "%s\\n" "${MEDIFLOW_MACHO_GUARD_NODE_ARCH:?}"' \
    '  exit 0' \
    'fi' \
    'exit 91' > "$fake_bin/node"
  chmod 755 "$fake_bin/otool" "$fake_bin/node"

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
  MEDIFLOW_MACHO_GUARD_NODE_ARCH=x64 PATH="$fake_bin:$PATH" "$script_path" --web-runtime "$x64_web" >/dev/null
  if MEDIFLOW_MACHO_GUARD_NODE_ARCH=arm64 PATH="$fake_bin:$PATH" "$script_path" --web-runtime "$arm64_web" >/dev/null 2>&1; then
    fail "self-test accepted a missing arm64 PDF inspector binding"
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
  binding="$web_runtime/node_modules/@firecrawl/pdf-inspector-darwin-$node_arch/pdf-inspector.darwin-$node_arch.node"
  if [[ ! -f "$binding" && "$node_arch" == "x64" ]]; then
    [[ -f "$web_runtime/scripts/pdf-inspector-worker.mjs" ]] || fail "Intel macOS fallback is missing the PDF inspector worker"
    [[ -f "$web_runtime/node_modules/pdfjs-dist/legacy/build/pdf.mjs" ]] || fail "Intel macOS fallback is missing pdfjs-dist"
    echo "macOS WebRuntime native payload guard passed: Intel macOS PDF.js fallback"
    exit 0
  fi
fi
[[ -n "$binding" && -f "$binding" ]] || fail "PDF inspector native binding is missing from the WebRuntime payload"

if [[ "$normalize" == "1" ]]; then
  current_id="$(otool -l "$binding" | awk '
    /^[[:space:]]*cmd LC_ID_DYLIB/ { capture=1; next }
    capture && /^[[:space:]]*name / { print $2; exit }
  ')"
  [[ -n "$current_id" ]] || fail "PDF inspector native binding has no LC_ID_DYLIB"
  [[ "$current_id" != *'/../'* && "$current_id" != '../'* && "$current_id" != */.. ]] || fail "LC_ID_DYLIB contains path traversal: $current_id"
  if [[ "$current_id" == /* && "$current_id" != /System/Library/* && "$current_id" != /usr/lib/* ]]; then
    install_name_tool -id "@loader_path/$(basename "$binding")" "$binding"
  fi
fi

references="$(otool -l "$binding" | awk '
  /^[[:space:]]*cmd (LC_ID_DYLIB|LC_LOAD_DYLIB|LC_LOAD_WEAK_DYLIB|LC_REEXPORT_DYLIB|LC_LOAD_UPWARD_DYLIB|LC_LAZY_LOAD_DYLIB)/ { command=$2; capture="name"; next }
  /^[[:space:]]*cmd LC_RPATH/ { command=$2; capture="path"; next }
  capture && /^[[:space:]]*name / { print command "\t" $2; capture=0 }
  capture == "path" && /^[[:space:]]*path / { print command "\t" $2; capture=0 }
')"
[[ -n "$references" ]] || fail "PDF inspector native binding has no Mach-O dylib references"

while IFS=$'\t' read -r command reference; do
  [[ "$reference" != *'/../'* && "$reference" != '../'* && "$reference" != */.. ]] || fail "$command contains path traversal: $reference"
  [[ "$command" != "LC_RPATH" ]] || fail "LC_RPATH is unsupported in the PDF inspector payload: $reference"
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
