# Windows launcher bootstrap

This package belongs only to the ordinary launcher. It is not part of the
native-free AIP/MCP/Mini delivery closure. Node 24 and trusted Windows are
prerequisites; no report, environment-derived system root, FFI, runtime build
or runtime download is used.

`system-directory.c` exports one C Node-API function using
[GetSystemDirectoryW](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemdirectoryw).
Node-API version 1 uses the stable C ABI. The MSVC recipe links only Node and
Kernel32, without a dynamic CRT dependency or DLL entry point. The producer
checks the actual dependency list with dumpbin, the PE architecture, exact
export, native API, canonical taskkill path and source-first startup.

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
The manifest identifies binary bytes, PE architecture, source/recipe/builder
digests, SDK and compiler provenance. Hashes attest identity/integrity, not
source-to-binary equivalence. Review and commit both files for each admitted
architecture before distributing source. The cross-platform workflow uploads
these two files, and consumer jobs download and verify them without building
at product startup. Missing/unreviewed artifacts do not qualify distribution.
No artifacts have yet been produced or admitted in this checkout. Before
admission, downloaded untracked artifacts change Git source identity: the
production build/start gate may deny that checkout. It must not be bypassed
with automatic staging, commits, exclusions or an identity override. The
initial artifact-production run is not final source-package qualification.

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
