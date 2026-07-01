<!-- Claude: filone app universale Apple (ADR 0071). Living tracker. -->
# Filone: app universale Apple (macOS + iOS)

Part of the [tri-OS filoni](README.md). ADR: [0071](../../adr/0071-tri-os-reversed-flow-shared-core.md).
Deep operational detail + commit list: [handover](../2026-06-30-handover-tri-os-reversed-flow.md).

## Status: ~75-80%

The most advanced filone by far. This is the reference implementation the other two
copy the product shape from (spine usage, KeyStore protocol, data-source seam).

### What exists

- One universal Xcode artifact (`MediFlowAppleApp.xcodeproj`, XcodeGen from
  `project.yml`), two app targets: `MediFlowMacApp` (macOS 14) + `MediFlowMobileApp`
  (iOS 17), same bundle id for a single universal-purchase record. Shared schemes are
  now committed (build-from-clone works).
- `MediFlowAppleShared`: URLSession client, Keychain (`KeyStore` backend), Bonjour
  home-base discovery, runtime supervisor, cache, SwiftUI + Liquid Glass (VetroClinico),
  and the `LocalPatientsDataSource` adapter.
- Reversed-flow authority WIRED behind `MEDIFLOW_LOCAL_AUTHORITY`: with the flag set,
  the app READS and WRITES patients AND all 4 clinical sub-resources
  (entry/therapy/checkup/observation) in-process against the local `medical.db` via
  `MediFlowCore`, zero-knowledge, no localhost round-trip. Only login, ambulatories,
  and patient create/soft-delete still traverse HTTP (the latter two have no wire peer,
  so nothing to wire).
- Verified this session: `MediFlowMacApp` scheme builds (BUILD SUCCEEDED, Xcode-beta,
  macOS). Core + shared test suites green (see handover for current counts).

### Shell / KeyStore / bridge (this filone's own build)

- UI shell: SwiftUI + Liquid Glass, kept as-is, re-pointed from the HTTP client to the
  in-process core. No WebView.
- `KeyStore` backend: Keychain. Master key derived from the operator PIN, RAM-only.
- Bridge boundary: none (core runs in-process). This is why Apple is the low-risk leg.
- Packaging/signing: Xcode + notarization (existing Apple pipeline).
- CI: local macOS app build is green; add it to hosted CI once push is unblocked.

## Dependencies

Spine only. Does NOT depend on the Linux or Windows filoni. It can proceed
independently, but per the [sequencing rule](README.md#sequencing-codex-2026-07-01) it
should PAUSE after the small parity follow-ups so Windows/Linux can be de-risked before
more depth is built on the portability assumption.

## Next steps (2-3, low-risk first)

1. Slice-6 small parity follow-ups: entry `metadata` UPDATE (encrypted), enum REJECTION
   on write (store canonicalizes but never 400s an invalid enum today), then the
   schema-fingerprint test (hash `drizzle/meta/0000_snapshot.json` + expected columns
   so a stale Swift row mapping fails fast).
2. Harden login/PIN unlock so local authority can become the DEFAULT and the
   `MEDIFLOW_LOCAL_AUTHORITY` flag can retire (only once key-unlock UX + fallback are
   solid).
3. Explicit single-writer transition mode (native writes, web read-only for the locally
   authoritative tables), the prerequisite for the deeper device-owned-DB + signed-ingest
   + ciphertext-sync work. Deep steps stay behind the Windows/Linux de-risk gate.

## Shared invariants

Must hold byte-identical here and on the other two filoni. See the
[invariants ledger](README.md#shared-invariants-ledger-must-hold-byte-identical-on-all-three).
