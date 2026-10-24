# Windows launcher bootstrap

This package belongs only to the ordinary launcher. It is not part of the
native-free AIP/MCP/Mini delivery closure. Node 24 and trusted Windows are
prerequisites; no report, environment-derived system root, FFI, runtime build
or runtime download is used.

`system-directory.c` exports exactly two C Node-API v1 functions: getSystemDirectory using
[GetSystemDirectoryW](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemdirectoryw).
getProcessCreationTimeTicks(pid) opens one non-inheritable process handle
with QUERY_LIMITED_INFORMATION, reads GetProcessTimes and closes it once on
every successful open. Every error denies identity. FILETIME is converted
through FileTimeToSystemTime, integer Gregorian calendar arithmetic and its
sub-millisecond 100 ns fraction to an ASCII .NET tick string. No floating
point timestamp, pseudo-handle, wait, privilege elevation or subprocess is
used. The same function serves own PID and previous owner PID.
Node-API version 1 uses the stable C ABI. The MSVC recipe links only Node and
Kernel32, without a dynamic CRT dependency or DLL entry point. The producer
checks the actual dependency list with dumpbin, the PE architecture, exact
exports, native API, canonical taskkill path and source-first startup.

Development/CI commands on **native Windows x64 or ARM64**, with matching Node 24:

```powershell
node scripts/prepare-windows-launcher-bootstrap.mjs build
node scripts/prepare-windows-launcher-bootstrap.mjs verify
node scripts/prepare-windows-launcher-bootstrap.mjs verify-shadow
node scripts/prepare-windows-launcher-bootstrap.mjs source-first
```

Only `build` downloads pinned Node 24.22.0 development headers and import
library and invokes the runner's installed MSVC/SDK. Their SHA-256 values are
pinned in the development script from the official Node release checksums.
No compiler, Python or npm dependency is required at user startup. Native
architecture and installed compiler version are recorded; x64 emulation is
not used to produce an ARM64 artifact. A source-first test runs before npm ci,
observes the ordinary dependency-confirmation request, and expects the
non-TTY installation refusal, original exit and stderr close. It does not
install dependencies or prove a GUI interaction.

Output is exactly `prebuilds/win32-<arch>/{system-directory.node,manifest.json}`.
Manifest schema 2 lists the exact ordered exports
`getProcessCreationTimeTicks,getSystemDirectory` and identifies binary bytes, PE architecture, source/recipe/builder
digests, SDK and compiler provenance. Hashes attest identity/integrity, not
source-to-binary equivalence. Review and commit both files for each admitted
architecture before distributing source. The cross-platform workflow uploads
these two files, and consumer jobs download them only when absent, then verify
them without building at product startup. Missing/unreviewed artifacts do not
qualify distribution. The original x64 and ARM64 binary/manifest pairs are
admitted and versioned in this checkout. With both pairs present, the workflow
skips the development build and consumer download; native jobs verify the
checkout files with `verify`, `verify-shadow` and `source-first`. Versioning
these artifacts does not qualify the final Windows candidate; its CI and
application gates remain required. Before admission, downloaded untracked
artifacts change Git source identity: the production build/start gate may deny
that checkout. It must not be bypassed with automatic staging, commits,
exclusions or an identity override. The initial artifact-production run is not
final source-package qualification.

`verify-shadow` initializes the real binding with an owned cwd/PATH shadow and
false inherited roots. The separate transaction-tree gate stops its original
owned tree with those hostile process-local settings and restores them in
`finally`. No user or global environment configuration is modified.

The supported loader candidates are x64 and ARM64; a missing artifact denies
that candidate. ia32/WOW64 is denied. ARM64 is a bootstrap candidate, not a
claim of complete application support. Windows ARM with Node x64 uses the x64
artifact and still needs its application gate. The R31 Windows gate remains
two distinct paths: Web + committed archive + stop/restart, and a synthetic
Windows tree with an open transaction + forced stop/rollback. This is not a
Web transaction interrupted in-flight. Neither Windows gate ran on macOS.

`observe-command.mjs` is a CI preload, never imported by the product. It
records only the actual admitted stop executable, architecture, owned PID and
command result. It preserves the original spawn function and return value.

`verify` additionally holds a real owned child alive and compares repeated
native identities for own PID and child PID. A gate-only PowerShell oracle
uses the exact legacy expression, bounded to 30000 ms per call without retry
or warm-up: tick strings must match before SHA-256 comparison. A legacy
receipt for that live child must deny the new claim without changing bytes.
A separate isolated-child loop performs 4096 native queries; external
HandleCount observations must remain equal. Child exit and stderr-close
are observed during attributed cleanup. An oracle timeout means missing
proof, never demonstrated incompatibility or a pass. These oracle processes
are outside the product.

`source-first` separately preloads a private guard that denies PowerShell
execution, requires a zero-call terminal marker and checks that process
identity source has no environment-root lookup. The original no-node_modules,
dependency-confirmation and non-TTY refusal assertions remain mandatory.
It runs no legacy oracle. The retired R37 identity diagnostic is not used;
the admitted taskkill observation and guard remain unchanged.

The old native schema 1 artifacts are not admitted by this loader. Newly
built x64/ARM64 artifacts require exact legacy compatibility on Windows
before admission/distribution. macOS stubs and source checks cannot qualify
Win32 conversion, handle lifetime, or source-first Windows. Native mutation
recipes (raw FILETIME, floating-point rounding, omitted CloseHandle) belong
to the development evidence, not the distributed addon or portable closure.
