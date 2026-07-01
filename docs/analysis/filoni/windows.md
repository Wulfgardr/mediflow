<!-- Claude: filone app universale Windows (ADR 0071). Living tracker. -->
# Filone: app universale Windows

Part of the [tri-OS filoni](README.md). ADR: [0071](../../adr/0071-tri-os-reversed-flow-shared-core.md).

## Status: ~10% (highest risk of the three)

Greenfield except for the shared spine, and the riskiest leg: it carries both unproven
assumptions of ADR 0071 at once, Swift-on-Windows (MSVC toolchain maturity for
swift-crypto/BoringSSL) and WebView2 packaging. ADR 0071's "punto di non ritorno" is
exactly here: if the Swift toolchain on Windows ever fails the byte-exact golden-vector
gate, the whole Swift-core direction is reconsidered in favor of a Rust core (the golden
vectors are language-neutral and already in hand).

### What exists

- `MediFlowCore` is designed to compile on Windows (same `Package.swift` off-Apple guard
  as Linux).
- `core-tri-os.yml` `windows` job: `windows-latest`, `swift-actions/setup-swift@v2`
  (Swift 6.0), builds `MediFlowCore` and runs `CryptoGoldenVectorsTests`.

### Does NOT exist yet

- No app shell, no `KeyStore` backend, no loopback bridge, no WebView2 host, no packaging.
- The Windows gate has NEVER run (billing block; no local Windows runner on the dev Mac).
  This is the single biggest unknown in the whole tri-OS plan.

## Shell / KeyStore / bridge (this filone's own build, planned)

- UI shell: React UI reused in a WebView2 host served by a loopback bridge inside the
  native binary (backend = `MediFlowCore`, not Node). Native Fluent is a later, optional
  tone-parity move.
- `KeyStore` backend: DPAPI / Windows Credential Manager. Rule inherited from the spine:
  the master key never crosses the loopback boundary.
- Bridge boundary: 127.0.0.1 + per-launch token.
- Packaging/signing: MSIX + Authenticode (to be decided).

## Dependencies

Depends on the spine being green on Windows (the golden-vector gate) above everything
else, that gate is the gate for the entire direction, not just this filone. Product
shape (KeyStore protocol, loopback bridge) is copied from Apple's reference.

## Next steps (2-3)

1. HIGHEST PRIORITY across all filoni: actually run `swift build MediFlowCore` +
   `CryptoGoldenVectorsTests` on Windows. There is no local Docker path on macOS for
   this, so it needs a real `windows-latest` runner (unblock push so `core-tri-os.yml`
   runs) or a Windows VM with the Swift 6 toolchain. Record pass/fail here, it either
   confirms or refutes ADR 0071.
2. Spike the `KeyStore` DPAPI / Credential Manager backend against the `KeyStore`
   protocol, master key never leaving the native process.
3. Minimal WebView2 shell + loopback bridge + per-launch token, then a packaging/signing
   smoke test.

## Shared invariants

Must hold byte-identical here and on the other two filoni. See the
[invariants ledger](README.md#shared-invariants-ledger-must-hold-byte-identical-on-all-three).
On Windows the golden-vector gate is not just a regression guard, it is the ADR 0071
kill-switch.
