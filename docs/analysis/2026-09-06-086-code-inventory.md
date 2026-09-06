# MediFlow 0.8.6 WUL-683: first-party code inventory

Snapshot date: 2026-09-06
Baseline: `c160bdce250c0120682f45e3dd1a9d587f7b9935`
Branch: `codex/WUL-683-086-deslop`
Worktree: `/Users/leonardopegollo/.codex/worktrees/mediflow-086-deslop`

This is a bounded inventory and evidence-backed debt classification for the
deslop section of [`docs/roadmap-086-consolidamento.md`](../roadmap-086-consolidamento.md#6-deslop-globale-del-codice--essenziale).
It does not implement a refactor, delete a file, or claim that every line was
manually audited.

## Method and boundaries

The reproducible command is:

```bash
node scripts/inventory-first-party-code.mjs
node scripts/inventory-first-party-code.mjs --json
```

The script enumerates tracked Git paths from the checkout and counts source,
configuration, and SQL migration files under these first-party roots:
`app/`, `components/`, `hooks/`, `lib/`, `packages/`, `native/`, `scripts/`,
`tools/`, `e2e/`, `test/`, `tests/`, `.github/`, `contracts/`, and `drizzle/`.
Root tooling entrypoints and configuration files are included explicitly. Test
paths and `*.test.*`/`*.spec.*` files are classified as `tests`, even when they
live under `lib/`, `components/`, `packages/`, `native/`, or `scripts/`.

The filter excludes `node_modules`, Next/build outputs, generated metadata,
vendor code, runtime/tmp outputs, screenshots/evidence archives, fixtures, and
package artifacts. At this snapshot the 34 excluded tracked candidates are:

| Exclusion | Count | Representative paths |
| --- | ---: | --- |
| Fixtures / synthetic corpora | 20 | `scripts/fixtures/*` |
| Package artifacts | 7 | `packages/web-auth-lifecycle-owner/artifacts/*` |
| Vendored SQLite | 3 | `native/MediFlowMac/Sources/MediFlowSQLiteC/*` |
| Generated metadata | 2 | `drizzle/meta/*` |
| Generated app-icon metadata | 2 | `native/MediFlowAppleApp/Assets.xcassets/*/Contents.json` |

The input is Git-tracked source, so ignored local `node_modules`, databases,
runtime directories, temporary files, and evidence outputs do not become
inventory candidates. The script also rejects those path classes if they are
tracked. This is a source-tree inventory, not a filesystem or build-artifact
inventory.

## Coverage snapshot

| Category | Files | Lines | Bytes |
| --- | ---: | ---: | ---: |
| Web (`app/`, `components/`, `hooks/`) | 292 | 41,790 | 1,960,906 |
| Libraries (`lib/`) | 517 | 92,433 | 4,479,205 |
| Packages (`packages/`) | 37 | 7,907 | 417,095 |
| Native (`native/`) | 123 | 35,881 | 1,513,626 |
| Tooling, migrations, contracts, CI and root configs | 206 | 36,207 | 1,561,823 |
| Tests (`e2e/`, test paths and test files) | 645 | 121,070 | 6,220,128 |
| **Total included** | **1,820** | **335,288** | **16,152,783** |

The included language/configuration counts are: TypeScript 1,241, TSX 131,
Swift 198, MJS 131, shell/command/PowerShell 53, SQL 32, CJS 9, JSON 12,
YAML 7, Python 3, JavaScript 2, and one extensionless `Dockerfile`.

The script found zero byte-identical duplicate groups among included files. That
result does not rule out semantic duplication, wrapper drift, or dead entrypoints;
those require source and consumer evidence.

## Prioritized findings

### F1 — RESOLVED: retired macOS builder removed

At the inventory baseline, `scripts/build-native-app.sh` was a nine-line
retirement stub that always exited `2`. Commit `1b55676b1e55f956ab42f309e38182e954b231d5`
removed it after checking repository-local callers. The maintained entrypoint is
[`scripts/build-apple-macos-app.sh`](../../scripts/build-apple-macos-app.sh).
The historical inventory counts above have not been recomputed for this update.

### F2 — RESOLVED tooling; interoperability verification remains separate

The same commit replaced the retired simulator builder with the tracked Xcode
project build in
[`scripts/build-mobile-sim-app.sh`](../../scripts/build-mobile-sim-app.sh).
The wrapper validates the SDK, bundle and executable; installation is explicit
and targets an already booted simulator. The original delivery recorded 21
synthetic tooling tests, Bash syntax and Apple structure/network guards. It did
not claim a real build when the simulator SDK was unavailable.

The legacy `mobile-home-base-paired-smoke.sh` now reaches that builder, but its
SQLite settings snapshot/restore, setup TLS bypass and injected app login make
it unsuitable as evidence of an ordinary mobile workflow. It was not run or
promoted for the 0.8.6 interoperability matrix.

The dedicated `scripts/mobile-home-base-interop*` harness instead consumes a
private synthetic host descriptor, validates HTTPS/SAN/pin, separates Web and
native operator sessions and drives login through the app UI. API receipts,
fixture UI tests and real app/host runs remain distinct. See
[the native testing runbook](../native-testing.md#interoperabilita-mobile-con-host-reali).

### F3 — DEFER, then REMOVE if the contract is closed: orphan patient clipboard

Evidence:

- [`hooks/use-patient-clipboard.ts:14-76`](../../hooks/use-patient-clipboard.ts)
  exports the React hook, but a first-party search found no runtime component
  importing `usePatientClipboard`.
- [`lib/patient-clipboard.ts:21-70`](../../lib/patient-clipboard.ts) contains
  the corresponding copy/cut/paste transport and calls the bulk patient routes.
  Its observed consumers are its unit test and source-shape assertions in
  [`lib/live-query-scoped-invalidation.test.ts:72-80`](../../lib/live-query-scoped-invalidation.test.ts).
- The parity source explicitly records that the web consumer is an orphan hook
  not wired to UI and that move has no consumer:
  [`docs/apple-parity-matrix.json:59-64`](../apple-parity-matrix.json).

Impact: approximately 146 lines of client/helper code plus isolated tests carry
clipboard behavior that is not reachable from a first-party web surface. The
bulk API routes remain separate possible contract surfaces.

Proposal: first decide whether the bulk routes are an intended external or
future web contract. If the answer is no, remove the orphan hook/helper and
their isolated tests in one small tranche; preserve the routes until that
contract decision is made. If the answer is yes, wire the hook through an
explicit UI owner instead of treating tests as a consumer.

Risk: medium. Repository search cannot rule out an undocumented external caller
or future product intent, so this is not an immediate deletion recommendation.

Verification: repeat the first-party import search, review the `/api/patients/{assign,duplicate,move,unassign}` contract and route tests, then run
`npm run test:patient-clipboard` plus the affected patient/API checks before
removing anything.

Classification: `DEFER` pending contract ownership; candidate follow-up is
`REMOVE` or `KEEP` after that decision.

### F4 — CONSOLIDATE: repeated paired-network audit envelope

Evidence:

- The same audit envelope is repeated in nine network write modules:
  `lib/network-ambulatory-write.ts:7-36`,
  `lib/network-attachment-write.ts:120-148`,
  `lib/network-checkup-write.ts:149-178`,
  `lib/network-entry-write.ts:183-211`,
  `lib/network-observation-write.ts:149-178`,
  `lib/network-patient-write.ts:132-160`,
  `lib/network-therapy-write.ts:149-178`,
  `lib/prosthetic-prescription-write.ts:178-207`, and
  `lib/service-prescription-write.ts:338-366`.
- Each block independently sets `outcome: 'success'`, `actorType: 'user'`,
  `sourceSurface: 'native'`, request ID, `auth:paired-client`, the paired
  client ID, and `scope:ambulatory`, while swallowing audit-write failures.
- [`lib/security/audit.ts:248-279`](../../lib/security/audit.ts) already owns a
  generic request-to-audit builder and safe writer, showing an existing
  consolidation seam. The paired-client metadata still needs an explicit
  network helper; it must not be inferred away.

Impact: repeated security-sensitive boilerplate increases drift risk. A future
change to paired provenance or error handling must currently be kept in nine
places.

Proposal: add one network-scoped audit helper parameterized by subject type,
event type, subject reference, and redacted metadata. Preserve the current
paired-client and ambulatory-scope flags, domain event types, and failure
behavior; do not merge the domain mutation functions themselves.

Risk: medium/high because audit provenance is a security and evidence boundary.
This is a refactor candidate, not a license to weaken or normalize audit fields.

Verification: targeted network write tests, audit tests, and a before/after
comparison of emitted event fields for patient, clinical, document, and
prescription writes.

Classification: `CONSOLIDATE`, after a focused contract-preserving design.

## Verification run

- `node --check scripts/inventory-first-party-code.mjs`: PASS.
- `node scripts/inventory-first-party-code.mjs`: PASS; output matches the
  coverage snapshot above.
- Two consecutive `--json` runs compared with `diff`: PASS; no output
  difference.
- `git diff --cached --check`: PASS for the two owned files.
- Targeted ESLint was not run because the worktree has no local
  `node_modules/.bin/eslint`; no package installation or network access was
  attempted.

## Held classifications and limits

Retired OCR/PDF/Smart Import routes that return guarded `410` responses are
`KEEP` candidates for compatibility evidence, not dead code to delete. The
vendored SQLite amalgamation, fixture corpora, package archives, generated
metadata, and screenshots were excluded from debt scoring. Repeated benchmark
argument parsing and repeated API route scaffolding were observed but remain
`DEFER`: their options and trust boundaries differ enough that a mechanical
consolidation would be speculative at this stage.

This leaf did not change runtime code, routes, migrations, package artifacts,
fixtures, or documentation indexes. It did not inspect real databases or local
runtime configuration, use the network, push, open a PR, or update a tracker.
