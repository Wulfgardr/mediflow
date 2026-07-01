<!-- Claude: filone app universale Linux (ADR 0071). Living tracker. -->
# Filone: app universale Linux

Part of the [tri-OS filoni](README.md). ADR: [0071](../../adr/0071-tri-os-reversed-flow-shared-core.md).

## Status: ~15% (spine PROVEN on Linux)

Greenfield except for the shared spine. Only the platform-free `MediFlowCore` is
designed to compile here, plus the Linux job in `core-tri-os.yml`. The GitHub job had
never run (push is billing-blocked), so "compiles on Linux" was a design claim, not an
observed fact. On 2026-07-01 the gate was run LOCALLY via Docker and PASSED (see test
evidence below), turning the claim into an observed fact for Linux.

### Test evidence (2026-07-01, local Docker `swift:6.0-noble`)

- Swift 6.0.3, target `aarch64-unknown-linux-gnu`.
- `MediFlowCore` built to completion on Linux: swift-crypto/BoringSSL compiled from
  source, the vendored SQLite (`MediFlowSQLiteC`) compiled, all `MediFlowCore` sources
  compiled. "Build of target: 'MediFlowCore' complete!"
- Golden-vector gate `CryptoGoldenVectorsTests`: 3 tests, 0 failures
  (`testFieldDecryptMatchesOracle`, `testKEKFromPinMatchesOracle`,
  `testUnwrapMasterKeyMatchesOracle`). The zero-knowledge crypto contract holds
  byte-identical on Linux under swift-crypto/BoringSSL.
- This is the first real confirmation of the ADR 0071 Swift-core direction on a
  non-Apple OS. Re-run recipe: [index](README.md#local-gate-recipe-bypasses-the-billingpush-block).

### What exists

- `MediFlowCore` targets Linux by construction (the `Package.swift` `#if os(macOS) ||
  os(iOS)` guard excludes the SwiftUI/AppleShared targets off-Apple, so only the core +
  its tests build on Linux).
- `core-tri-os.yml` `linux` job: `swift:6.0-noble` container, builds `MediFlowCore` and
  runs `CryptoGoldenVectorsTests`.

### Does NOT exist yet

- No app shell, no `KeyStore` backend, no loopback bridge, no WebView host, no packaging.

## Shell / KeyStore / bridge (this filone's own build, planned)

- UI shell: React UI reused in a WebKitGTK WebView served by a loopback bridge inside
  the native binary (backend = `MediFlowCore`, not Node). Native GTK4/libadwaita is a
  later, optional tone-parity move (not a port of Liquid Glass).
- `KeyStore` backend: libsecret / kwallet. Rule inherited from the spine: the master key
  never crosses the loopback boundary; the WebView receives only decrypted view-data.
- Bridge boundary: 127.0.0.1 + per-launch token (same model as today's paired headers).
- Packaging: .deb / .rpm / AppImage (to be decided).

## Dependencies

Depends on the spine being green on Linux (the golden-vector gate) and on nothing from
the Apple/Windows filoni beyond the reference product shape. The KeyStore + bridge
patterns are copied from Apple's, re-backed for Linux.

## Next steps (2-3)

1. DONE (2026-07-01): ran `swift build` + `CryptoGoldenVectorsTests` on Linux via
   Docker, outside GitHub, while push is blocked. PASSED (see test evidence above).
   Still pending on hosted CI: run the same job on `core-tri-os.yml` once push is
   unblocked, to prove it on x86_64 too (the local run was aarch64).
2. Spike the `KeyStore` libsecret/kwallet backend against the `KeyStore` protocol, with
   the master key never leaving the native process.
3. Minimal WebKitGTK shell + loopback bridge + per-launch token, then a packaging smoke
   test (one artifact that launches and reaches the core).

## Shared invariants

Must hold byte-identical here and on the other two filoni. See the
[invariants ledger](README.md#shared-invariants-ledger-must-hold-byte-identical-on-all-three).
The golden-vector gate on Linux is the concrete proof that the crypto contract did not
drift under swift-crypto/BoringSSL on this OS.
