<!-- Claude: indice dei tre filoni tri-OS (direttiva utente 2026-07-01). -->
# Filoni tri-OS: app universale Apple / Linux / Windows

Living index for the three OS work streams of the ADR 0071 reversed-flow pivot.
Authoritative decision: [ADR 0071](../../adr/0071-tri-os-reversed-flow-shared-core.md).
Operational running tracker: [handover](../2026-06-30-handover-tri-os-reversed-flow.md).
This index + the three per-filone files were framed with Codex (architecture
authority) on 2026-07-01.

The goal is ONE product shipped as THREE native binaries, each the on-device
authority for its OS, with "localhost"/Next.js demoted to a ciphertext-only
sync/archive peer.

**Goal-based plan + honest baseline: [piano-a-goal.md](piano-a-goal.md)** (defines the
100% = full macOS parity + adequate Linux/Windows, measures where we are today
(~24% weighted macOS parity), and gives the ordered goals G1-G6).

**Multi-entity charter: [carta-multi-entita.md](carta-multi-entita.md)** (how Claude Code,
Codex.app, and Gemini share the repo without collisions: worktree perimeters, the shared
constitution, and the parliamentary decision process. Provisional: 2 of 3 entity voices in).

## The one shared spine (identical on every filone)

`MediFlowCore` (Swift Package, platform-free: Foundation + swift-crypto + vendored
SQLite only) is the single authority reused UNCHANGED by all three filoni. It owns:

- zero-knowledge field crypto (`ENC:iv:data`), KEK derivation, master-key wrap/unwrap
- `ENCRYPTED_FIELDS` per table, the SQLite schema, the local stores
  (`SQLitePatientStore` + `SQLiteClinicalStore`: patient + 4 clinical sub-resources,
  full CRUD, decrypt in-core)
- the data model, codecs (`DiagnosesCodec`, `ExemptionCodesCodec`), clinical modules
  (`ClinicalScales`, `ICDCatalog`, `ObservationTrend`)
- the write authority (`NetworkWriteBoundary`, `PatientConcurrency`,
  `ClinicalConcurrency`), the 409 conflict-payload encode
- the golden-vector + parity test suite (also the tri-OS CI gate)

Nothing OS-specific lives in the spine. If a change is needed in the spine to serve
one filone, it must serve all three identically, or it does not belong there.

## What each filone builds itself

| Concern | Apple | Linux | Windows |
| --- | --- | --- | --- |
| UI shell | SwiftUI + Liquid Glass (VetroClinico) | React UI in WebKitGTK WebView (loopback bridge), native GTK4 later | React UI in WebView2 (loopback bridge), native Fluent later |
| `KeyStore` backend | Keychain (built) | libsecret / kwallet (spike) | DPAPI / Credential Manager (spike) |
| Bridge boundary | none (in-process core) | loopback 127.0.0.1 + per-launch token; only decrypted view-data crosses, never the key | same |
| Packaging / signing | Xcode / notarization | .deb/.rpm/AppImage (TBD) | MSIX / Authenticode (TBD) |
| App-level CI | macOS app build (local, green) | not yet | not yet |

## The three filoni at a glance

| Filone | Status | Depends on | Doc |
| --- | --- | --- | --- |
| Apple | ~75-80% | spine only | [apple.md](apple.md) |
| Linux | ~15% (spine PROVEN, gate passed locally 2026-07-01) | spine green on Linux + golden vectors | [linux.md](linux.md) |
| Windows | ~10% (spine UNPROVEN, gate never run) | spine green on Windows + golden vectors (highest risk) | [windows.md](windows.md) |

Percentages are Codex's 2026-07-01 read. "Spine green" = the `core-tri-os.yml`
gate (build `MediFlowCore` + `CryptoGoldenVectorsTests`) actually passing on that OS.
Linux is now green LOCALLY (Docker `swift:6.0-noble`, aarch64); still to prove on
hosted x86_64 CI once push is unblocked. Windows has no local path and remains the one
un-proven leg (it also carries ADR 0071's kill-switch).

## Sequencing (Codex 2026-07-01)

Do NOT finish the entire Apple slice-6 demotion roadmap before touching Windows/Linux.
Correct order:

1. Close only the SMALL, low-risk Apple parity follow-ups (slice-6 steps 2-3:
   entry metadata UPDATE, enum rejection, schema-fingerprint test).
2. Immediately DE-RISK the core on Windows/Linux. The single highest-value
   cross-filone action is to actually run the tri-OS gate, especially on Windows
   (build `MediFlowCore` + golden vectors). The billing block stops GitHub CI, so
   run it locally instead (Docker for Linux; a Windows runner/VM for Windows).
3. Only then continue the deeper Apple demotion (single-writer, device-owned DB,
   signed ingest, ciphertext sync).

Rationale: everything built on top of the "Swift core is truly portable" assumption
is wasted if that assumption is false. Prove it early and cheaply.

### Local gate recipe (bypasses the billing/push block)

Linux (validated 2026-07-01, Docker daemon on the dev Mac):

```bash
docker run --rm -v "$PWD":/work -w /work swift:6.0-noble bash -lc \
  "swift build --package-path native/MediFlowMac --scratch-path /tmp/mfbuild --target MediFlowCore && \
   swift test  --package-path native/MediFlowMac --scratch-path /tmp/mfbuild --filter CryptoGoldenVectorsTests"
```

Windows has no local container path on this Mac; it needs a real windows-latest
runner or a Windows VM with the Swift 6 toolchain. Until push is unblocked or such a
runner exists, Windows stays the one un-proven leg.

## Shared invariants ledger (must hold BYTE-IDENTICAL on all three)

Every filone doc repeats this. Drift on any of these across OSes is a release blocker:

1. `ENC:base64(iv12):base64(ct+tag)`, plaintext = `JSON.stringify(value)`, AES-256-GCM.
2. Master key wrap = `base64(iv12 || GCM(rawKey, KEK))`; KEK = PBKDF2-HMAC-SHA256(PIN,
   salt, 100000). Master key is RAM-only, never persisted in clear, never crosses an
   FFI/loopback boundary.
3. `ENCRYPTED_FIELDS` per table (string vs structured crypto convention), exactly as
   the web (`lib/db.ts`).
4. SQLite schema (medical.db) unchanged; a schema-fingerprint test guards it.
5. Optimistic concurrency: version-guarded UPDATE, 409 `VersionConflictPayload`
   (entity-specific snapshot, explicit nulls), tombstone/soft-delete semantics.
6. The golden-vector gate passes on that OS.
7. After demotion, Next.js archives ciphertext/version/tombstone ONLY; it never
   re-validates plaintext clinical semantics again.

## Refactor posture

No blocking structural refactor is needed before starting the Linux/Windows filoni;
`MediFlowCore` is ready as-is. The `MediFlowAppleSync` / `MediFlowAppleUI` split is an
Apple-internal, post-stabilization move (it touches the highest-risk 1,831-LOC
`PairedPatientsWorkspaceModel`), not a prerequisite for the other filoni.
