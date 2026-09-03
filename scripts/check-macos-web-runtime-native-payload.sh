#!/bin/bash
# @Codex
# Relocate and validate the six WebRuntime Mach-O dependencies in MediFlow.app.
set -euo pipefail

fail() {
  echo "macOS WebRuntime native payload: $*" >&2
  exit 1
}

usage() {
  echo "Usage: $0 [--normalize] --web-runtime <path> [--frameworks <path>] | --binding <path> | --self-test" >&2
  exit 2
}

script_path="$0"
normalize=0
web_runtime=""
frameworks=""
binding=""
self_test=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --normalize) normalize=1 ;;
    --web-runtime) shift; [[ $# -gt 0 ]] || usage; web_runtime="$1" ;;
    --frameworks) shift; [[ $# -gt 0 ]] || usage; frameworks="$1" ;;
    --binding) shift; [[ $# -gt 0 ]] || usage; binding="$1" ;;
    --self-test) self_test=1 ;;
    *) usage ;;
  esac
  shift
done

is_listed_path() {
  local candidate="$1" listed
  shift
  for listed in "$@"; do
    [[ "$candidate" == "$listed" ]] && return 0
  done
  return 1
}

macho_references() {
  otool -l "$1" | awk '
    /^[[:space:]]*cmd (LC_ID_DYLIB|LC_LOAD_DYLIB|LC_LOAD_WEAK_DYLIB|LC_REEXPORT_DYLIB|LC_LOAD_UPWARD_DYLIB|LC_LAZY_LOAD_DYLIB)/ { command=$2; capture="name"; next }
    /^[[:space:]]*cmd LC_RPATH/ { command=$2; capture="path"; next }
    capture == "name" && /^[[:space:]]*name / { print command "\t" $2; capture=0 }
    capture == "path" && /^[[:space:]]*path / { print command "\t" $2; capture=0 }
  '
}

macho_id() {
  macho_references "$1" | awk -F '\t' '$1 == "LC_ID_DYLIB" { print $2; exit }'
}

real_path() {
  node -e 'const fs = require("node:fs"); process.stdout.write(fs.realpathSync(process.argv[1]))' "$1"
}

first_physical_macho() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const magics = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
      0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);
    let found = "";
    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (found) return;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(candidate);
        else if (entry.isFile()) {
          const descriptor = fs.openSync(candidate, "r");
          try {
            const prefix = Buffer.alloc(4);
            if (fs.readSync(descriptor, prefix, 0, 4, 0) === 4 && magics.has(prefix.readUInt32BE(0))) {
              found = candidate;
            }
          } finally { fs.closeSync(descriptor); }
        }
      }
    }
    walk(process.argv[1]);
    process.stdout.write(found);
  ' "$1"
}

validate_resource_symlinks() {
  local resources_root="$1" link resolved canonical_resources
  canonical_resources="$(real_path "$resources_root")"
  while IFS= read -r -d '' link; do
    [[ -e "$link" ]] || fail "broken symlink below Contents/Resources: $link"
    [[ "$(readlink "$link")" != /* ]] || fail "absolute symlink below Contents/Resources: $link"
    resolved="$(real_path "$link")"
    [[ "$resolved" == "$canonical_resources/"* ]] || fail "symlink escapes Contents/Resources: $link -> $resolved"
    file -L "$link" | grep -q 'Mach-O' && fail "native symlink remains below Contents/Resources: $link"
  done < <(find "$resources_root" -type l -print0)
  return 0
}

validate_contained_file() {
  local candidate="$1" root="$2" label="$3" resolved canonical_root
  [[ -f "$candidate" && ! -L "$candidate" ]] || fail "$label is missing or not physical: $candidate"
  resolved="$(real_path "$candidate")"
  canonical_root="$(real_path "$root")"
  [[ "$resolved" == "$canonical_root/"* ]] || fail "$label escapes its owned root: $candidate -> $resolved"
}

literal_count() {
  node -e '
    const fs = require("node:fs");
    const source = fs.readFileSync(process.argv[1], "utf8");
    const pattern = process.argv[2];
    let count = 0;
    let offset = 0;
    while ((offset = source.indexOf(pattern, offset)) !== -1) {
      count += 1;
      offset += pattern.length;
    }
    process.stdout.write(String(count));
  ' "$1" "$2"
}

rewrite_literal_once() {
  local loader="$1" before="$2" after="$3" count
  count="$(literal_count "$loader" "$before")"
  [[ "$count" == "1" ]] || fail "loader pattern must occur exactly once before rewrite: $loader (found $count)"
  [[ "$(literal_count "$loader" "$after")" == "0" ]] || fail "loader already contains packaged target before rewrite: $loader"
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const before = process.argv[2];
    const after = process.argv[3];
    const source = fs.readFileSync(file, "utf8");
    const parts = source.split(before);
    if (parts.length !== 2) throw new Error(`expected one loader pattern in ${file}`);
    fs.writeFileSync(file, parts[0] + after + parts[1]);
  ' "$loader" "$before" "$after"
}

validate_framework_macho() {
  local artifact="$1" references command reference embedded resolved
  file "$artifact" | grep -q 'Mach-O' || fail "native target is not Mach-O: $artifact"
  references="$(macho_references "$artifact")"
  [[ -n "$references" ]] || fail "native target has no Mach-O dylib metadata: $artifact"
  while IFS=$'\t' read -r command reference; do
    [[ "$reference" != *'/../'* && "$reference" != '../'* && "$reference" != */.. ]] || \
      fail "$command contains path traversal: $artifact -> $reference"
    [[ "$command" != "LC_RPATH" ]] || fail "LC_RPATH remains in native target: $artifact -> $reference"
    case "$reference" in
      /System/Library/*|/usr/lib/*) ;;
      /*) fail "$command uses a non-system absolute path: $artifact -> $reference" ;;
      @loader_path/*)
        embedded="$frameworks/${reference#@loader_path/}"
        [[ -f "$embedded" && ! -L "$embedded" ]] || fail "$command references a missing framework target: $artifact -> $reference"
        resolved="$(real_path "$embedded")"
        [[ "$resolved" == "$(real_path "$frameworks")/"* ]] || fail "$command escapes Contents/Frameworks: $artifact -> $reference"
        ;;
      @rpath/*) fail "$command uses unresolved @rpath linkage: $artifact -> $reference" ;;
      *) fail "$command uses unsupported Mach-O linkage: $artifact -> $reference" ;;
    esac
  done <<< "$references"
}

package_web_runtime_machos() {
  local node_arch resources contents expected_frameworks native source target resolved link loader
  local physical_count=0 framework_count=0 old_vips_ref old_vips_count=0 rpath index
  local sharp_candidates=() libvips_candidates=() sources=() targets=() loaders=() before=() after=()

  node_arch="$(node -p 'process.arch')"
  [[ "$node_arch" == "arm64" || "$node_arch" == "x64" ]] || fail "unsupported Node architecture: $node_arch"
  [[ -d "$web_runtime" && ! -L "$web_runtime" && "$(basename "$web_runtime")" == "WebRuntime" ]] || \
    fail "WebRuntime must be a physical Contents/Resources/WebRuntime directory"
  resources="$(dirname "$web_runtime")"
  contents="$(dirname "$resources")"
  [[ "$(basename "$resources")" == "Resources" && "$(basename "$contents")" == "Contents" ]] || \
    fail "WebRuntime is outside a macOS app Contents/Resources directory"
  [[ ! -L "$resources" && ! -L "$contents" && "$(basename "$(dirname "$contents")")" == *.app ]] || \
    fail "WebRuntime must be rooted in a physical .app bundle"
  expected_frameworks="$contents/Frameworks"
  [[ "$frameworks" == "$expected_frameworks" ]] || fail "Frameworks must be the sibling Contents/Frameworks directory"
  if [[ "$normalize" == "1" ]]; then
    mkdir -p "$frameworks"
  fi
  [[ -d "$frameworks" && ! -L "$frameworks" ]] || fail "Contents/Frameworks is missing or is a symlink"
  [[ "$(real_path "$frameworks")" == "$(real_path "$contents")/Frameworks" ]] || \
    fail "Contents/Frameworks resolves outside the app bundle"
  # @Codex: reject escaping or native symlinks before moving or rewriting any
  # file through the copied dependency tree.
  validate_resource_symlinks "$resources"

  for required_path in \
    "$web_runtime/scripts/anydoc-pdf-page-worker.mjs" "$web_runtime/node_modules/pdf-lib/package.json" \
    "$web_runtime/node_modules/pdfjs-dist/package.json" "$web_runtime/node_modules/pdfjs-dist/legacy/build/pdf.mjs" \
    "$web_runtime/node_modules/@napi-rs/canvas/package.json" \
    "$web_runtime/node_modules/@napi-rs/canvas-darwin-$node_arch/package.json" \
    "$web_runtime/node_modules/@firecrawl/anydoc/index.js" \
    "$web_runtime/node_modules/@napi-rs/canvas/js-binding.js" \
    "$web_runtime/node_modules/@img/sharp-darwin-$node_arch/index.cjs" \
    "$web_runtime/node_modules/better-sqlite3/lib/database.js" \
    "$web_runtime/node_modules/fsevents/fsevents.js"; do
    validate_contained_file "$required_path" "$web_runtime" "isolated PDF worker dependency"
  done
  targets=(
    "$frameworks/mediflow-web-anydoc.node" "$frameworks/mediflow-web-sharp.node"
    "$frameworks/mediflow-web-libvips.dylib" "$frameworks/mediflow-web-canvas.node"
    "$frameworks/mediflow-web-better-sqlite3.node" "$frameworks/mediflow-web-fsevents.node"
  )
  if [[ "$normalize" == "1" ]]; then
    # @Codex: Xcode may preserve Frameworks across an incremental build. The
    # root is canonical above, so removing only these exact owned paths cannot
    # escape the app bundle.
    for target in "${targets[@]}"; do
      if [[ -e "$target" || -L "$target" ]]; then
        [[ -f "$target" || -L "$target" ]] || fail "owned native target is not a file or symlink: $target"
        rm -f -- "$target"
      fi
    done
  fi
  loaders=(
    "$web_runtime/node_modules/@firecrawl/anydoc/index.js"
    "$web_runtime/node_modules/@napi-rs/canvas/js-binding.js"
    "$web_runtime/node_modules/@img/sharp-darwin-$node_arch/index.cjs"
    "$web_runtime/node_modules/@img/sharp-darwin-$node_arch/index.cjs"
    "$web_runtime/node_modules/better-sqlite3/lib/database.js"
    "$web_runtime/node_modules/fsevents/fsevents.js"
  )
  after=(
    "require('../../../../../Frameworks/mediflow-web-anydoc.node')"
    "require('../../../../../Frameworks/mediflow-web-canvas.node')"
    "require('../../../../../Frameworks/mediflow-web-sharp.node')"
    "require.resolve('../../../../../Frameworks/mediflow-web-libvips.dylib')"
    "require('../../../../../Frameworks/mediflow-web-better-sqlite3.node')"
    'require("../../../../Frameworks/mediflow-web-fsevents.node")'
  )

  if [[ "$normalize" == "1" ]]; then
    shopt -s nullglob
    sharp_candidates=( "$web_runtime/node_modules/@img/sharp-darwin-$node_arch/lib/"sharp-darwin-"$node_arch"-*.node )
    libvips_candidates=( "$web_runtime/node_modules/@img/sharp-libvips-darwin-$node_arch/lib/"libvips-cpp.*.dylib )
    shopt -u nullglob
    [[ "${#sharp_candidates[@]}" == "1" ]] || fail "expected exactly one Sharp native addon, found ${#sharp_candidates[@]}"
    [[ "${#libvips_candidates[@]}" == "1" ]] || fail "expected exactly one Sharp libvips dylib, found ${#libvips_candidates[@]}"
    sources=(
      "$web_runtime/node_modules/@firecrawl/anydoc-darwin-$node_arch/anydoc.darwin-$node_arch.node" "${sharp_candidates[0]}"
      "${libvips_candidates[0]}" "$web_runtime/node_modules/@napi-rs/canvas-darwin-$node_arch/skia.darwin-$node_arch.node"
      "$web_runtime/node_modules/better-sqlite3/build/Release/better_sqlite3.node" "$web_runtime/node_modules/fsevents/fsevents.node"
    )
    before=(
      "require('@firecrawl/anydoc-darwin-$node_arch')"
      "require('@napi-rs/canvas-darwin-$node_arch')"
      "require('./lib/$(basename "${sharp_candidates[0]}")')"
      "require.resolve('@img/sharp-libvips-darwin-$node_arch/binary')"
      "require('bindings')('better_sqlite3.node')"
      'require("./fsevents.node")'
    )
    for source in "${sources[@]}"; do
      validate_contained_file "$source" "$web_runtime" "native source"
    done
    for loader in "${loaders[@]}"; do
      validate_contained_file "$loader" "$web_runtime" "package loader"
    done
    while IFS= read -r -d '' native; do
      is_listed_path "$native" "${sources[@]}" || fail "unexpected native artifact in WebRuntime: $native"
      physical_count=$((physical_count + 1))
    done < <(find "$web_runtime" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)
    [[ "$physical_count" == "6" ]] || fail "expected exactly six physical WebRuntime Mach-O artifacts, found $physical_count"
    # @Codex: preflight every package loader before moving any native payload.
    for index in 0 1 2 3 4 5; do
      [[ "$(literal_count "${loaders[$index]}" "${before[$index]}")" == "1" ]] || \
        fail "loader pattern must occur exactly once before relocation: ${loaders[$index]}"
      [[ "$(literal_count "${loaders[$index]}" "${after[$index]}")" == "0" ]] || \
        fail "loader already contains packaged target before relocation: ${loaders[$index]}"
    done
    for index in 0 1 2 3 4 5; do
      source="${sources[$index]}"
      target="${targets[$index]}"
      [[ -f "$source" && ! -L "$source" ]] || fail "native source is missing or is a symlink: $source"
      file "$source" | grep -q 'Mach-O' || fail "native source is not Mach-O: $source"
      mv "$source" "$target"
      codesign --remove-signature "$target"
    done
    for index in 0 1 2 3 4 5; do
      rewrite_literal_once "${loaders[$index]}" "${before[$index]}" "${after[$index]}"
    done

    install_name_tool -id '@loader_path/mediflow-web-anydoc.node' "${targets[0]}"
    install_name_tool -id '@loader_path/mediflow-web-libvips.dylib' "${targets[2]}"
    install_name_tool -id '@loader_path/mediflow-web-canvas.node' "${targets[3]}"
    while IFS=$'\t' read -r command reference; do
      if [[ "$command" == "LC_LOAD_DYLIB" && "$reference" == @rpath/libvips-cpp.*.dylib ]]; then
        old_vips_ref="$reference"
        old_vips_count=$((old_vips_count + 1))
      fi
    done < <(macho_references "${targets[1]}")
    [[ "$old_vips_count" == "1" ]] || fail "Sharp must have exactly one @rpath libvips dependency before normalization"
    install_name_tool -change "$old_vips_ref" '@loader_path/mediflow-web-libvips.dylib' "${targets[1]}"
    while IFS= read -r rpath; do
      [[ -n "$rpath" ]] && install_name_tool -delete_rpath "$rpath" "${targets[1]}"
    done < <(macho_references "${targets[1]}" | awk -F '\t' '$1 == "LC_RPATH" { print $2 }')
    # @Codex: Apple Silicon needs ad-hoc signatures here; the outer app stays unsigned unless opted in.
    for index in 2 0 1 3 4 5; do
      codesign --force --sign - "${targets[$index]}"
      codesign --verify --strict "${targets[$index]}"
    done
  fi

  for index in 0 1 2 3 4 5; do
    target="${targets[$index]}"
    [[ -f "$target" && ! -L "$target" ]] || fail "framework native target is missing or is a symlink: $target"
    validate_framework_macho "$target"
    [[ "$(literal_count "${loaders[$index]}" "${after[$index]}")" == "1" ]] || \
      fail "packaged loader target must occur exactly once: ${loaders[$index]}"
  done
  [[ "$(macho_id "${targets[0]}")" == '@loader_path/mediflow-web-anydoc.node' ]] || fail "AnyDoc LC_ID_DYLIB is not normalized"
  [[ "$(macho_id "${targets[2]}")" == '@loader_path/mediflow-web-libvips.dylib' ]] || fail "libvips LC_ID_DYLIB is not normalized"
  [[ "$(macho_id "${targets[3]}")" == '@loader_path/mediflow-web-canvas.node' ]] || fail "canvas LC_ID_DYLIB is not normalized"

  native="$(first_physical_macho "$resources")"
  [[ -z "$native" ]] || fail "physical Mach-O remains below Contents/Resources: $native"
  validate_resource_symlinks "$resources"
  while IFS= read -r -d '' native; do
    is_listed_path "$native" "${targets[@]}" || fail "unexpected MediFlow Web native target: $native"
    framework_count=$((framework_count + 1))
  done < <(find "$frameworks" -maxdepth 1 \( -type f -o -type l \) -name 'mediflow-web-*' -print0)
  [[ "$framework_count" == "6" ]] || fail "expected exactly six MediFlow Web targets in Contents/Frameworks, found $framework_count"
  echo "macOS WebRuntime native payload guard passed: six physical Frameworks targets and no native payload below Resources"
}

run_self_test() {
  local temp_dir fake_bin fixture valid_web worker_path binding_path event_log state_file events
  local layout_bin layout_state layout_log layout_web layout_frameworks bad_app bad_web bad_frameworks path
  local bad_pattern_app bad_pattern_web extensionless_app extensionless_web
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

  layout_bin="$temp_dir/layout-bin"
  layout_state="$temp_dir/layout-state"
  layout_log="$temp_dir/layout-events"
  layout_web="$temp_dir/layout/MediFlow.app/Contents/Resources/WebRuntime"
  layout_frameworks="$temp_dir/layout/MediFlow.app/Contents/Frameworks"
  mkdir -p "$layout_bin" "$layout_state" \
    "$layout_web/scripts" "$layout_web/node_modules/pdf-lib" \
    "$layout_web/node_modules/pdfjs-dist/legacy/build" "$layout_web/node_modules/@napi-rs/canvas" \
    "$layout_web/node_modules/@napi-rs/canvas-darwin-arm64" "$layout_web/node_modules/@firecrawl/anydoc-darwin-arm64" \
    "$layout_web/node_modules/@firecrawl/anydoc" \
    "$layout_web/node_modules/@img/sharp-darwin-arm64/lib" "$layout_web/node_modules/@img/sharp-libvips-darwin-arm64/lib" \
    "$layout_web/node_modules/better-sqlite3/build/Release" "$layout_web/node_modules/better-sqlite3/lib" \
    "$layout_web/node_modules/fsevents" "$layout_web/node_modules/sharp/node_modules/.bin" \
    "$layout_web/node_modules/sharp/node_modules/semver/bin"
  for path in \
    "$layout_web/scripts/anydoc-pdf-page-worker.mjs" "$layout_web/node_modules/pdf-lib/package.json" \
    "$layout_web/node_modules/pdfjs-dist/package.json" "$layout_web/node_modules/pdfjs-dist/legacy/build/pdf.mjs" \
    "$layout_web/node_modules/@napi-rs/canvas/package.json" "$layout_web/node_modules/@napi-rs/canvas-darwin-arm64/package.json" \
    "$layout_web/node_modules/@firecrawl/anydoc-darwin-arm64/anydoc.darwin-arm64.node" "$layout_web/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-1.0.0.node" \
    "$layout_web/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.1.0.0.dylib" "$layout_web/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node" \
    "$layout_web/node_modules/better-sqlite3/build/Release/better_sqlite3.node" \
    "$layout_web/node_modules/fsevents/fsevents.node"; do
    : > "$path"
  done
  printf '%s\n' "const binding = require('@firecrawl/anydoc-darwin-arm64')" > \
    "$layout_web/node_modules/@firecrawl/anydoc/index.js"
  printf '%s\n' "return require('@napi-rs/canvas-darwin-arm64')" > \
    "$layout_web/node_modules/@napi-rs/canvas/js-binding.js"
  printf '%s\n' \
    "try { require.resolve('@img/sharp-libvips-darwin-arm64/binary'); } catch {}" \
    "module.exports = require('./lib/sharp-darwin-arm64-1.0.0.node');" > \
    "$layout_web/node_modules/@img/sharp-darwin-arm64/index.cjs"
  printf '%s\n' "addon = require('bindings')('better_sqlite3.node');" > \
    "$layout_web/node_modules/better-sqlite3/lib/database.js"
  printf '%s\n' 'const Native = require("./fsevents.node");' > \
    "$layout_web/node_modules/fsevents/fsevents.js"
  : > "$layout_web/node_modules/sharp/node_modules/semver/bin/semver.js"
  ln -s ../semver/bin/semver.js "$layout_web/node_modules/sharp/node_modules/.bin/semver"
  printf '%s\n' \
    '#!/bin/bash' \
    'artifact="${!#}"; base="$(basename "$artifact")"; state="${MEDIFLOW_LAYOUT_STATE_DIR:?}"' \
    'emit_system() { printf "%s\n" "Load command 9" "          cmd LC_LOAD_DYLIB" "         name /usr/lib/libSystem.B.dylib (offset 24)"; }' \
    'case "$base" in' \
    '  mediflow-web-anydoc.node|mediflow-web-libvips.dylib|mediflow-web-canvas.node)' \
    '    printf "%s\n" "Load command 0" "          cmd LC_ID_DYLIB" "         name @loader_path/$base (offset 24)"; emit_system ;;' \
    '  mediflow-web-sharp.node)' \
    '    if [[ -f "$state/sharp-linked" ]]; then ref="@loader_path/mediflow-web-libvips.dylib"; else ref="@rpath/libvips-cpp.1.0.0.dylib"; fi' \
    '    printf "%s\n" "Load command 0" "          cmd LC_LOAD_DYLIB" "         name $ref (offset 24)"' \
    '    [[ -f "$state/sharp-rpath-removed" ]] || printf "%s\n" "Load command 1" "          cmd LC_RPATH" "         path @loader_path/../../sharp-libvips-darwin-arm64/lib (offset 12)"' \
    '    emit_system ;;' \
    '  mediflow-web-better-sqlite3.node|mediflow-web-fsevents.node) emit_system ;;' \
    '  *) exit 97 ;;' \
    'esac' > "$layout_bin/otool"
  printf '%s\n' \
    '#!/bin/bash' \
    'artifact="${!#}"; base="$(basename "$artifact")"; state="${MEDIFLOW_LAYOUT_STATE_DIR:?}"' \
    'printf "%s\n" "$*" >> "${MEDIFLOW_LAYOUT_EVENT_LOG:?}"' \
    'case "$1:$base" in' \
    '  -id:mediflow-web-anydoc.node|-id:mediflow-web-libvips.dylib|-id:mediflow-web-canvas.node) ;;' \
    '  -change:mediflow-web-sharp.node) touch "$state/sharp-linked" ;;' \
    '  -delete_rpath:mediflow-web-sharp.node) touch "$state/sharp-rpath-removed" ;;' \
    '  *) exit 98 ;;' \
    'esac' > "$layout_bin/install_name_tool"
  printf '%s\n' \
    '#!/bin/bash' \
    'case "$1:$#" in' \
    '  --remove-signature:2) event="strip $(basename "$2")" ;;' \
    '  --force:4) [[ "$2" == "--sign" && "$3" == "-" ]] || exit 99; event="sign $(basename "$4")" ;;' \
    '  --verify:3) [[ "$2" == "--strict" ]] || exit 99; event="verify $(basename "$3")" ;;' \
    '  *) exit 99 ;;' \
    'esac' \
    'printf "%s\n" "$event" >> "${MEDIFLOW_LAYOUT_EVENT_LOG:?}"' > "$layout_bin/codesign"
  printf '%s\n' \
    '#!/bin/bash' \
    'if [[ "${!#}" == */.bin/semver ]]; then' \
    '  printf "%s: JavaScript source, ASCII text\n" "${!#}"' \
    'else' \
    '  printf "%s: Mach-O 64-bit bundle arm64\n" "${!#}"' \
    'fi' > "$layout_bin/file"
  chmod 755 "$layout_bin/otool" "$layout_bin/install_name_tool" "$layout_bin/codesign" "$layout_bin/file"
  : > "$layout_log"
  bad_pattern_app="$temp_dir/bad-pattern/MediFlow.app"
  mkdir -p "$(dirname "$bad_pattern_app")"
  cp -R "$temp_dir/layout/MediFlow.app" "$bad_pattern_app"
  bad_pattern_web="$bad_pattern_app/Contents/Resources/WebRuntime"
  printf '%s\n' "const duplicate = require('@firecrawl/anydoc-darwin-arm64')" >> \
    "$bad_pattern_web/node_modules/@firecrawl/anydoc/index.js"
  if MEDIFLOW_LAYOUT_STATE_DIR="$layout_state" MEDIFLOW_LAYOUT_EVENT_LOG="$layout_log" \
      PATH="$layout_bin:$PATH" "$script_path" --normalize --web-runtime "$bad_pattern_web" \
      --frameworks "$bad_pattern_app/Contents/Frameworks" >/dev/null 2>&1; then
    fail "self-test accepted a loader pattern that occurred twice"
  fi
  MEDIFLOW_LAYOUT_STATE_DIR="$layout_state" MEDIFLOW_LAYOUT_EVENT_LOG="$layout_log" \
    PATH="$layout_bin:$PATH" "$script_path" --normalize --web-runtime "$layout_web" --frameworks "$layout_frameworks" >/dev/null
  MEDIFLOW_LAYOUT_STATE_DIR="$layout_state" MEDIFLOW_LAYOUT_EVENT_LOG="$layout_log" \
    PATH="$layout_bin:$PATH" "$script_path" --web-runtime "$layout_web" --frameworks "$layout_frameworks" >/dev/null
  [[ "$(grep -c '^strip ' "$layout_log")" == "6" ]] || fail "self-test did not strip exactly six copied native signatures"
  [[ "$(grep -c '^sign ' "$layout_log")" == "6" && "$(grep -c '^verify ' "$layout_log")" == "6" ]] || \
    fail "self-test did not ad-hoc sign and verify exactly six relocated native targets"
  grep -Fq -- '-change @rpath/libvips-cpp.1.0.0.dylib @loader_path/mediflow-web-libvips.dylib' "$layout_log" || \
    fail "self-test did not normalize Sharp to its Frameworks libvips target"
  [[ -L "$layout_web/node_modules/sharp/node_modules/.bin/semver" ]] || \
    fail "self-test removed the safe non-native semver symlink"
  [[ -z "$(find "$(dirname "$layout_web")" -type f \( -name '*.node' -o -name '*.dylib' \) -print -quit)" ]] || \
    fail "self-test left a native payload below Contents/Resources"

  bad_app="$temp_dir/bad-link/MediFlow.app"
  mkdir -p "$(dirname "$bad_app")"
  cp -R "$temp_dir/layout/MediFlow.app" "$bad_app"
  bad_web="$bad_app/Contents/Resources/WebRuntime"
  bad_frameworks="$bad_app/Contents/Frameworks"
  printf '\xfe\xed\xfa\xcf' > "$bad_web/node_modules/unexpected.node"
  if MEDIFLOW_LAYOUT_STATE_DIR="$layout_state" MEDIFLOW_LAYOUT_EVENT_LOG="$layout_log" \
      PATH="$layout_bin:$PATH" "$script_path" --web-runtime "$bad_web" --frameworks "$bad_frameworks" >/dev/null 2>&1; then
    fail "self-test accepted an unexpected seventh native artifact"
  fi
  mv "$bad_web/node_modules/unexpected.node" "$bad_web/node_modules/unexpected.disabled"
  ln -s ../../../Frameworks/mediflow-web-anydoc.node "$bad_web/node_modules/native-alias"
  if MEDIFLOW_LAYOUT_STATE_DIR="$layout_state" MEDIFLOW_LAYOUT_EVENT_LOG="$layout_log" \
      PATH="$layout_bin:$PATH" "$script_path" --web-runtime "$bad_web" --frameworks "$bad_frameworks" >/dev/null 2>&1; then
    fail "self-test accepted a native symlink below Contents/Resources"
  fi
  extensionless_app="$temp_dir/extensionless/MediFlow.app"
  mkdir -p "$(dirname "$extensionless_app")"
  cp -R "$temp_dir/layout/MediFlow.app" "$extensionless_app"
  extensionless_web="$extensionless_app/Contents/Resources/WebRuntime"
  printf '\xfe\xed\xfa\xcf' > "$extensionless_web/node_modules/extensionless-native"
  if MEDIFLOW_LAYOUT_STATE_DIR="$layout_state" MEDIFLOW_LAYOUT_EVENT_LOG="$layout_log" \
      PATH="$layout_bin:$PATH" "$script_path" --web-runtime "$extensionless_web" \
      --frameworks "$extensionless_app/Contents/Frameworks" >/dev/null 2>&1; then
    fail "self-test accepted an extensionless Mach-O below Contents/Resources"
  fi
  echo "macOS WebRuntime native payload guard self-test passed"
}

if [[ "$self_test" == "1" ]]; then
  [[ -z "$web_runtime" && -z "$frameworks" && -z "$binding" && "$normalize" == "0" ]] || usage
  run_self_test
  exit 0
fi

if [[ -n "$frameworks" ]]; then
  [[ -n "$web_runtime" && -z "$binding" ]] || usage
  package_web_runtime_machos
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
