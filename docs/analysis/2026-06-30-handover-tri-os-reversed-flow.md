# Handover: tri-OS reversed-flow pivot (MediFlowCore)

Date: 2026-06-30. Branch: `feat/apple-universal-fase0`. Nothing pushed (billing
block on the account; commits are local). This doc is self-contained: a fresh
session can continue from it. Authoritative decision = `docs/adr/0071-tri-os-reversed-flow-shared-core.md`.

## TL;DR / current status

- Goal: turn the Apple-only paired client into a **universal native app, three
  binaries (macOS/Windows/Linux)**, where the **native app is the on-device
  authority** and "localhost"/Next.js demotes to a **ciphertext-only sync/archive
  peer** (the data flow reverses).
- Done this session: ADR + **Fase 0** (crypto golden-vector gate) -> **Fase 1**
  (the entire platform-free surface extracted into a `MediFlowCore` Swift package)
  -> **tri-OS CI gate** -> **Fase 2 authority logic** (write-boundary +
  optimistic-concurrency, ported 1:1 from the web and adversarially parity-audited)
  -> **vendored SQLite** -> **read-only `SQLitePatientStore`** (the reversed-flow
  READ path is alive: the core opens a real `medical.db` and decrypts in-process).
- `MediFlowCore` imports only `Foundation` + `Crypto` (swift-crypto) +
  `MediFlowSQLiteC` (vendored SQLite); it builds in isolation and is tri-OS ready.
- Everything is build + test + Xcode-app verified at each step.

## Build / test / verify (run these to confirm state)

```bash
export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer   # REQUIRED
# Core + all tests (golden vectors, codecs, authority logic, SQLite store):
swift test --package-path native/MediFlowMac
# The platform-free core in isolation (proxy for the Linux/Windows build):
swift build --package-path native/MediFlowMac --target MediFlowCore
# The universal macOS app (verifies the @_exported shim + transitive linking):
xcodebuild build -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj \
  -scheme MediFlowMacApp -destination 'platform=macOS,arch=arm64' \
  CODE_SIGNING_ALLOWED=NO
```

## Environment / toolchain gotchas (important)

- **`DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer` is required**
  for every `swift`/`xcodebuild` (the default `xcode-select` points at CLT, which
  lacks XCTest). This Xcode-beta is a **build-only slice (~3.5 GB): it has NO
  `Simulator.app`**, so the iOS Simulator GUI can't be opened. For hands-on, build
  the **macOS app** (it runs natively); headless iOS screenshots use
  `xcrun simctl io <UDID> screenshot` (full framebuffer), not `app.screenshot()`.
- The **dev backend needs Node 20** (`~/.nvm/versions/node/v20.20.2/bin/node`): the
  project's `better-sqlite3` native module is built for Node 20 (MODULE_VERSION
  115); the shell default Node 24 throws an ABI error on every DB route. Same Node
  20 + better-sqlite3 is used by `Fixtures/generate-fixture.mjs`.
- Real-data home-base recipe (validated this session): `network.mode` =
  `network-home-base` (currently LEFT ENABLED in `~/Library/Application Support/
  MediFlow/medical.db`); backend `npm run dev` on `127.0.0.1:3000`; TLS proxy
  `scripts/local-api-tls-proxy.mjs` loopback `127.0.0.1:3443`; pairing via
  `/api/v1/network/pairing-intents` + `/confirm` (Bearer = `~/Library/Application
  Support/MediFlow/local-api-token`); the Mac app's `MEDIFLOW_HOMEBASE_*` launch
  env prefills server/pin/clientId/token/username, the operator PIN is typed by the
  user (it derives the field master key). TLS pin = SHA256(DER cert) lowercase hex.

## Working conventions (carry these forward)

- **Codex is the architecture authority ("il capo")** — run `codex exec
  --skip-git-repo-check "<prompt>"` IN THE BACKGROUND (it takes minutes; the 10-min
  foreground cap kills it). Bound the prompt ("read ONLY these files, answer under
  N words") or it auto-explores the whole repo. It has been consulted + followed at
  every architectural fork this session.
- **Gemini CLI is dead** (`IneligibleTierError: UNSUPPORTED_CLIENT`, migrate to
  Antigravity) — only the user can run it inside Antigravity and paste results back.
- **No em dash** in docs OR UI strings (project rule). In-house-first (ADR 0070):
  buildable logic lives in-app, 1:1 with the web, not behind external deps.
- **Rhythm**: small commit -> build + `swift test` + xcodebuild macOS app, all
  green, then commit. **Exclude the `project.pbxproj`** from every commit (see Open
  items). End commit messages with the Co-Authored-By line.
- **Parity is byte-for-byte**: ported authority logic must match the web's status
  codes + copy exactly ("rejected here = rejected there"); back every port with
  parity tests, and the swift-crypto/MediFlowCore tests also gate Linux/Windows CI.

## ADR 0071 decision (the direction)

Shared platform-free **`MediFlowCore`** is the on-device authority on every OS.
Core language = **Swift** (NOT Rust), because the zero-knowledge crypto is already
in Swift and byte-verified, and `swift-crypto` (BoringSSL) compiles byte-identical
AES-GCM/PBKDF2 on Windows/Linux — so crypto is a recompile + CI-gate, not a 3rd
reimplementation. **This is GATED by the tri-OS golden-vector CI** (`.github/
workflows/core-tri-os.yml`): if Swift-on-Windows ever drifts, pivot to a Rust core
(the golden vectors are language-neutral and already in hand). UI: keep SwiftUI +
Liquid Glass on Apple; Windows/Linux reuse the React UI in a WebView via a loopback
bridge first, swappable for native Fluent/GTK later.

## What `MediFlowCore` now contains (~1,900 LOC, Foundation + Crypto + vendored SQLite)

crypto (`CryptoService`, `PatientFieldCrypto`, `ClinicalFieldCrypto`), full data
model (`HomeBaseModels`), codecs (`DiagnosesCodec`, `ExemptionCodesCodec`), clinical
modules (`ClinicalScales` ADL, `ICDCatalog`, `ObservationTrend`), status enums
(`ClinicalStatusTypes`, domain only), filtering (`*Filtering`), API types
(`APIPatchValue`, `APIVersionConflict`), `StringUtilities`, the **authority logic**
(`NetworkWriteBoundary`, `PatientConcurrency`), the vendored SQLite (`MediFlowSQLiteC`
+ `SQLite.swift`), and the read-only store (`SQLitePatientStore`).
`MediFlowAppleShared` (~6.8k LOC) keeps only Apple-specific code (URLSession client,
Keychain, Bonjour, cache, runtime supervisor, SwiftUI/VetroClinico) and re-exports
the core via `@_exported import MediFlowCore` (a temporary shim — new files should
import `MediFlowCore` explicitly).

Key mechanic learned: `@_exported import MediFlowCore` makes the core's **public**
symbols visible module-wide in `MediFlowAppleShared` (no per-file import churn);
the extraction work is mostly **raising access levels to `public`** + adding
**public memberwise inits** to DTOs that are reconstructed cross-module.

## Commits this session (branch feat/apple-universal-fase0, none pushed)

```
62bd1390f   native(core): make the *Filtering enums + apply() public (fixup for fb9ea8ad0)
6b36cdef4   native(core): read-only SQLitePatientStore over the vendored SQLite
b50ab746c   native(core): vendor SQLite C amalgamation for the local store
9da6b480c   native(core): document the conflict-payload encode-parity requirement
796614eed   native(core): port optimistic-concurrency authority logic
645b03365   native(core): port network write-boundary authority logic
fb9ea8ad0   native(core): split clinical status enums + move *Filtering into MediFlowCore
82439febb   native(core): move field-crypto decorators + ObservationTrend into MediFlowCore
cf5cc82c1   native(core): extract HomeBase* API model into MediFlowCore
6c7743e92   ci(native): tri-OS gate for MediFlowCore (ADR 0071 kill-switch)
bfbaec7f2   native(core): move pure logic/codecs into MediFlowCore
db1d316da   native: introduce MediFlowCore crypto target (swift-crypto)
e4b9a633f   feat(native): ADR 0071 + Fase 0 crypto golden-vector gate
4b4e001b0   test(apple): DEBUG deep-link affordances for headless screenshots
```

## NEXT STEPS (in order)

1. **Write path (Fase 2, the immediate next slice).** Add the transactional write
   to `SQLitePatientStore`: `BEGIN -> read snapshot -> call the pure authority fns
   (NetworkWriteBoundary.validate* + PatientConcurrency.evaluate) -> apply the SQL
   update/insert/soft-delete -> bump version -> COMMIT`. The conflict policy stays
   in the pure functions (Codex: never bury it in SQL). Reuse `CryptoService.seal`
   to encrypt ENCRYPTED_FIELDS before writing. Port the remaining 4 sub-resource
   concurrency builders (entry/therapy/checkup/observation) like `PatientConcurrency`.
2. **Conflict-payload encode parity (watch-item, blocks the 409 serialization).**
   The Fase 2 parity audit found ONE real (latent) drift, documented on
   `VersionConflictPayload` in `APIVersionConflict.swift`: when the native authority
   PRODUCES a 409, it must serialize like the web's `JSON.stringify` (Swift omits
   nil optionals; the web includes explicit nulls in the "missing" state, and the
   snapshot fields are entity-specific). Implement the custom `Encodable` then.
3. **Fase 3 wiring.** Re-point the macOS app from the HTTP `HomeBasePatientsClient`
   to the in-process `SQLitePatientStore`; demote the Next.js data-plane to a
   signed-write ingest + ciphertext-delta pull.
4. **Formal target split** (`MediFlowAppleSync` = client/Keychain/Bonjour/cache +
   `MediFlowAppleUI` = SwiftUI). Deferred deliberately: it touches the 1,831-LOC
   `PairedPatientsWorkspaceModel` (Codex: leave it; highest-risk move). The core is
   already cleanly isolated, so this is reorganization, not blocking.
5. **Schema-fingerprint test** (Codex): hash `drizzle/meta/0000_snapshot.json` +
   expected columns so a stale Swift row mapping fails fast.

## OPEN ITEMS / watch-list

- **`project.pbxproj` anomaly (USER decision):** the Xcode project has an EXTERNAL,
  not-mine modification adding `MediFlowDemoTour.swift` to the UITests target, but
  that file does not exist on disk -> the UITests target would fail to build. I left
  it unstaged/untouched. Decide: remove the dangling reference, or create the file.
- **Push held (billing):** when the GitHub billing block is cleared, push the branch;
  the tri-OS CI (`core-tri-os.yml`) then actually runs on Linux + Windows and
  confirms/refutes the Swift-core direction.
- **Left running:** the dev backend (`:3000`), the loopback TLS proxy (`:3443`), and
  a wired Mac app instance are still up; `network.mode` is `network-home-base`. To
  reset: kill those processes and set `network.mode` back to `local-only` if desired.
- **Lesson (avoid the bug I just fixed):** after `git mv` + editing the moved file,
  the staged rename holds the OLD content — re-`git add` the new path, and verify a
  commit compiles from its committed state (not just the working tree).
- Tooling notes also persist in the session memory: `tri-os-reversed-flow-vision`,
  `native-apple-toolchain`, `apple-paired-crypto`, `in-house-first-principle`.
