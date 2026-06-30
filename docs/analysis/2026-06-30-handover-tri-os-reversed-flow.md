# Handover: tri-OS reversed-flow pivot (MediFlowCore)

Date: 2026-06-30. Branch: `feat/apple-universal-fase0`. Nothing pushed (billing
block on the account; commits are local). This doc is self-contained: a fresh
session can continue from it. Authoritative decision = `docs/adr/0071-tri-os-reversed-flow-shared-core.md`.

## TL;DR / current status

- Goal: turn the Apple-only paired client into a **universal native app, three
  binaries (macOS/Windows/Linux)**, where the **native app is the on-device
  authority** and "localhost"/Next.js demotes to a **ciphertext-only sync/archive
  peer** (the data flow reverses).
- Done: ADR + **Fase 0** (crypto golden-vector gate) -> **Fase 1**
  (the entire platform-free surface extracted into a `MediFlowCore` Swift package)
  -> **tri-OS CI gate** -> **Fase 2 authority logic** (write-boundary +
  optimistic-concurrency, ported 1:1 from the web and adversarially parity-audited)
  -> **vendored SQLite** -> **read-only `SQLitePatientStore`** (the reversed-flow
  READ path is alive: the core opens a real `medical.db` and decrypts in-process).
- Done (continuation, commits `8b4ac6949` + `73ac01e43`): the reversed-flow
  **patient WRITE path** is alive. `SQLitePatientStore.updatePatient` runs the pure
  authority fns inside a `BEGIN IMMEDIATE` transaction, seals the ENCRYPTED_FIELDS
  in-core (string vs structured crypto convention respected), applies a
  version-guarded UPDATE, and returns 1:1-with-web outcomes (400/403/404/409/200).
  The **409 conflict-payload encode parity** (old watch-item) is closed: custom
  `Encodable` with explicit nulls + entity-specific snapshot. 8 write tests + 4
  encode tests added.
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
5d6e2fcb1   native: local patient WRITE authority via strict seal-or-passthrough (Fase 3 slice 3)
8933fa8d1   native(apple): local patient READ authority behind a flag (Fase 3 slice 2)
847dbff56   native(apple): introduce HomeBasePatientsDataSource seam (Fase 3 slice 1)
61b2de22f   native(core): sub-resource CREATE for entry/therapy/checkup/observation
a0af0ae1f   docs: handover - clinical update/soft-delete done; only sub-resource CREATE remains
a20f5b49c   native(core): SQLiteClinicalStore update + soft-delete for the 4 sub-resources
a1f118728   native(core): extract shared SQLiteConnection from SQLitePatientStore
25845720f   docs: handover - patient authority complete + audited; sub-resource specs captured
088ba3c7d   native(core): close patient-write parity gaps from the adversarial audit
63bcdf6a9   native(core): patient create + soft-delete write paths
9a7243ca1   native(core): generic ClinicalConcurrency for the 4 sub-resources
32200f939   docs: handover - patient write path + 409 encode parity done
73ac01e43   native(core): 409 conflict-payload encode parity (ADR 0071 Fase 2 watch-item)
8b4ac6949   native(core): port the patient write path to SQLitePatientStore (ADR 0071 Fase 2)
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

The reversed-flow WRITE AUTHORITY IS COMPLETE (all commits above adversarially
parity-audited by multi-lens workflows, every finding fixed): patient CRUD
(create/update/soft-delete) + clinical CRUD for all 4 sub-resources
(entry/therapy/checkup/observation: create/update/soft-delete, soft-delete = update
carrying deletedAt+deletionReason), the 409 encode parity, the generic
`ClinicalConcurrency`, the shared `SQLiteConnection`, and `ClinicalStatusNormalization`
(status alias/casing canonicalization). Two clinical audit passes found ZERO
concurrency/transaction drift; the field-map fixes (per-entity deletion_reason crypto,
full field coverage, status canonicalization, observation trim/LOINC-UCUM canonical,
entry setting '' -> NULL) are all applied + tested (74 core tests). The READ + WRITE
reversed-flow core is done. Remaining:

1. **Fase 3 wiring (PATIENT entity DONE, flag-gated).** Slices 1-3 complete + verified;
   with `MEDIFLOW_LOCAL_AUTHORITY` set, the app READS and WRITES patients via the
   on-device core (zero-knowledge, no localhost), everything else still HTTP:
   - Slice 1 (`847dbff56`): `HomeBasePatientsDataSource` seam (model depends on the
     existential; HTTP actor conforms; `makeClient()` returns it).
   - Slice 2 (`8933fa8d1`): `LocalPatientsDataSource` serves patient list/detail locally.
   - Slice 3 (`5d6e2fcb1`): local patient UPDATE via STRICT seal-or-passthrough
     (`CryptoService.sealOrPassthrough`/`encryptOrPassthrough`: verbatim ONLY for
     authenticated ciphertext under the key, else seal; fail-closed). Resolves the
     double-encryption landmine without touching the model. Codex-confirmed.
   - **Slice 4 (next): local CLINICAL reads.** Add read/list methods to
     `SQLiteClinicalStore` (create/update only today): `listEntries/Therapies/Checkups/
     Observations(patientId:scope:masterKey:)` reading raw rows -> Summary ->
     `ClinicalFieldCrypto.decrypt*` (reuse the model's decrypt). Then point the adapter's
     fetchEntries/etc. local. Mirrors SQLitePatientStore.loadPatientDetail per entity.
   - **Slice 5: local clinical/patient CREATE + soft-delete** through the adapter (the
     stores already support them; just route + map outcomes; create/soft-delete were held
     back from slice 3 per Codex - more parity surface).
   - **Slice 6: demote Next.js** to a signed-write ingest + ciphertext-delta pull (the true
     reversed flow). Needs a device-owned db + sync (conflict/delta/tombstone) - the big one.
2. **Membership-scope parity (watch-item, see below).** Replace the denormalized
   `patients.ambulatory_id` scope check (used by every store write) with the
   `patients_to_ambulatories` join + port `upsertPrimaryAmbulatoryMembership`;
   regenerate the fixture to model that table. Until then out-of-scope 404 diverges
   for multi-membership patients, and patient create/update can't set the primary
   ambulatory. Also unblocks setting ambulatoryId on patient update (deferred).
3. **Small parity follow-ups (low-risk, optional):** entry `metadata` UPDATE (encrypted,
   needs the plaintext-vs-pre-encrypted decision - create already handles both via
   seal-or-passthrough); clinical clear-to-null on update (the typed *UpdatePayload use
   nil=omit, so a field can't be cleared / a tombstone restored); enum REJECTION on
   write (the store canonicalizes but never 400s an invalid enum, since the typed
   payloads are trusted producers).
4. **Formal target split** (`MediFlowAppleSync` = client/Keychain/Bonjour/cache +
   `MediFlowAppleUI` = SwiftUI). Deferred deliberately: it touches the 1,831-LOC
   `PairedPatientsWorkspaceModel` (Codex: leave it; highest-risk move). The core is
   already cleanly isolated, so this is reorganization, not blocking.
5. **Schema-fingerprint test** (Codex): hash `drizzle/meta/0000_snapshot.json` +
   expected columns so a stale Swift row mapping fails fast.

## OPEN ITEMS / watch-list

- **Membership-scope divergence (PARITY NOTE, NEW):** `updatePatient` scopes the
  out-of-scope 404 via the denormalized `patients.ambulatory_id` (the only model the
  local store / fixture carries), NOT the web's `patients_to_ambulatories` join.
  Equivalent for single-membership patients; diverges for multi-membership. Tracked
  as NEXT STEP 3. The web's UPDATE itself is unscoped (id+version+active), already
  matched.
- **Encode-parity watch-item: RESOLVED** (commit `73ac01e43`). The 409
  `VersionConflictPayload` now has a custom `Encodable` (explicit nulls +
  entity-specific snapshot); decode unchanged.
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

## Appendix: sub-resource parity specs (extracted, for NEXT STEP 1)

Extracted by a 5-agent understand workflow from `lib/network-{e}-write.ts`,
`lib/{e}-concurrency.ts`, `lib/api-v1-clinical-write-normalization.ts`, `lib/db.ts`,
`lib/schema.ts`. All four share: version-guarded UPDATE (`WHERE id=? AND patientId=?
AND version=expected`), `changes==0` -> 409 via `ClinicalConcurrency` (clinical
snapshot `{id,patientId,version,updatedAt,deletedAt}`), create boundary forbids AI
fields (403 "Network {label} write boundary excludes AI/document-derived fields") +
client-controlled fields (400), patient-in-scope else 404, soft-delete = update with
deletedAt+deletionReason. Timestamps = unixepoch SECONDS. Boundary label: entry -> "diary".

- **entry** (`entries`): cols id, patient_id, type(notNull), title(notNull, default
  "Voce clinica"), date(notNull), content(notNull), setting, metadata, attachments,
  deleted_at, deletion_reason, version, created_at, updated_at. ENCRYPTED: title
  (string), content (string), metadata (STRUCTURED), attachments (STRUCTURED),
  deletion_reason (string). Create required: type, date, content; title defaults; id
  client-or-uuid. **Idempotency**: if id exists + payload matches (deletedAt null) ->
  200 {id, version, idempotent:true}; if exists + content differs -> 409 "Network
  diary create id already exists with different content". Create forbids non-empty
  attachments (403). Swift: HomeBaseEntryCreatePayload {id,type,title?,date,content,
  metadata?}, HomeBaseEntryUpdatePayload {version,type?,title?,content?,deletedAt?,
  deletionReason?}.
- **therapy** (`therapies`): cols id, patient_id, drug_name(notNull), aic, atc,
  active_principle, dosage(notNull), motivation, diagnosis_code, diagnosis_name,
  status(notNull, default "active", enum active|suspended|completed), start_date(notNull),
  end_date, version, created_at, updated_at, deleted_at, deletion_reason. ENCRYPTED:
  motivation (string), deletion_reason (string). Create required: drugName, dosage,
  startDate. Swift payloads OMIT aic/atc/diagnosisCode/diagnosisName (add if needed);
  UpdatePayload uses shouldEncodeEndDate for omit-vs-null endDate.
- **checkup** (`checkups`): cols id, patient_id, date(notNull), title(notNull), notes,
  status(default "pending", enum pending|completed|cancelled), source(enum
  manual|ai_suggestion, default manual), version, created_at, updated_at, deleted_at,
  deletion_reason. ENCRYPTED: notes (string) ONLY. Swift UpdatePayload omits source.
- **observation** (`observations`): cols id, patient_id, code_system(notNull, literal
  "LOINC"), code(notNull), display(notNull), unit_system(notNull, literal "UCUM"),
  unit_code(notNull), value(notNull, string), notes, observed_at(notNull),
  source(default manual), version, created_at, updated_at, deleted_at, deletion_reason.
  ENCRYPTED: notes (string) ONLY. value is string (web coerces number->string).
  code_system/unit_system/source immutable on update (absent from UpdatePayload).
  Conflict snapshot deliberately omits PHI (only id/patientId/version/updatedAt/deletedAt).
