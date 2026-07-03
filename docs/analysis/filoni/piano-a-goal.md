<!-- Claude: piano a goal verso full parity macOS (direttiva utente 2026-07-01). Living. -->
# Piano a goal: full parity macOS (100%) + Linux/Windows adeguati

Part of the [tri-OS filoni](README.md). Baseline measured 2026-07-01 (adversarially
verified). This defines what "100%" means and where we are against it, then the
ordered goals to get there.

## Progress log (G1/G2 push toward 50%)

Started 2026-07-01 from a measured ~24% weighted. Slices landed (each build + test verified):

- `608ae8cb5` patient-list rows: age, ADI/Archiviato chips, last-touched (list 30 -> ~50)
- `fdded9c5c` quadro clinical-signals strip (detail-overview 12 -> ~40)
- `bcdde92de` full clinical-scales library Tinetti/IADL/MMSE/GDS, byte-exact + Picker form (scales 20 -> ~90)
- `c35249298` ADI flag + exemptions editable in patient edit (edit-lifecycle 42 -> ~65)
- `7666cfffc` link a diagnosis to therapies (create + edit) (therapies 55 -> ~70)
- `453024356` + `17b13cc51` **patient-create** through the data-source seam + form/CTA
  (0 -> ~75; local-authority only, HTTP peer returns 405; first user-visible write only the
  on-device authority can serve)

Estimated weighted parity now ~40% (core-clinical ~62%). Work moved to the dedicated worktree
`medical-record-app-apple-wt` after a second worktree hijack; see [[workflow-agents-git-hazard]]
and the [charter](carta-multi-entita.md). To reach 50% the remaining core levers are
detail-overview (review-queue summary), observations chart, diary rich-text/restore,
patient-list context-menu + lead-diagnosis, plus auth in-session-lock/PIN-change (platform).

Incident (recovered, 0 loss): a `git checkout` hijacked the MAIN worktree twice (once ->main,
once ->codex/wul-423); commits recovered onto feat; now isolated in a dedicated worktree.

## The 100% (user directive, 2026-07-01)

"Full parity macOS is the primary objective, with an adequate level of Linux and
Windows. This is what I would call the 100%." So 100% = the macOS native app does
what the web app does (feature parity), plus Linux and Windows at an adequate level.

## Two axes that must not be conflated

- **Axis X: reversed-flow authority/sync plumbing** (ADR 0071). Deep, and mostly done
  for the core entities: `MediFlowCore` is the on-device authority for patient + all 4
  clinical sub-resources (read+write, zero-knowledge) behind `MEDIFLOW_LOCAL_AUTHORITY`.
  Slice-6 (Next.js demotion) is designed, not started.
- **Axis Y: product feature parity of the macOS UI**. Shallow. This is what the user's
  "100%" mostly measures, and where the gap is.

The reversed-flow % (~75-80% of the plumbing) is NOT the parity %. They are different
axes. The honest product-parity number is below.

## Where we are today: ~24% macOS parity (weighted)

Measured by mapping the full web feature surface (the 100% reference) against what the
native macOS SwiftUI actually exposes, per area, then adversarially verified (3 areas
were corrected downward; "the core can do it" was not credited unless the UI exposes it).

| Tier (weight) | Parity today |
| --- | --- |
| Core clinical (0.55) | 33% |
| Advanced clinical (0.25) | 7% |
| Platform / config (0.20) | 19% |
| **Weighted overall** | **24%** (unweighted 22%) |

### Per-area matrix (adversarially verified)

| Area | Tier | Parity | Status |
| --- | --- | --- | --- |
| patient-create | core | 0% | absent |
| patient-detail-overview (quadro) | core | 12% | partial |
| clinical-scales | core | 20% | partial (only ADL of Tinetti/MMSE/ADL/GDS) |
| patient-list | core | 30% | partial (rows lack age/lead-dx/status/last-touched) |
| patient-edit-lifecycle | core | 42% | partial (exemptions+ADI read-only; no hard-delete/duplicate/move) |
| diary-entries | core | 48% | partial (no rich-text, no attachments, no restore) |
| therapies | core | 55% | partial (no AIFA autocomplete/AIC/ATC, no dx link) |
| observations | core | 55% | partial (trend arrows only; no chart/interpretation/batch import) |
| service+prosthetic rx | advanced | 0% | absent |
| documents / import / OCR | advanced | 2% | absent |
| ai-features (insight/synthesis/smart-import) | advanced | 8% | absent |
| export / reporting (FHIR + PDF) | advanced | 10% | absent |
| SISS-FSE + network multi-clinic | advanced | 15% | partial |
| terminology / reference (AIFA/exemption import) | platform | 12% | partial |
| ambulatory-management | platform | 13% | partial (scope picker only, no CRUD) |
| cockpit-shell / 8-area rail | platform | 15% | partial |
| settings / config | platform | 18% | partial |
| auth / session | platform | 35% | partial (no PIN-change, no in-session lock, no operator profile) |

Also structural: the native app is **online-only** today (no offline write queue),
which is at odds with the ADR 0071 local-first target. Closing that is Axis X work that
also lifts the "feel" of parity.

### The other two filoni (from the [index](README.md))

- **Linux**: spine PROVEN locally (golden gate 3/3 via Docker); ~15% filone. No shell yet.
- **Windows**: spine UNPROVEN (no local runner); ~10%; carries the ADR 0071 kill-switch.

## Operative definition of 100% (Codex, 2026-07-01)

macOS 100% = the native app can REPLACE the web app for all in-scope local clinical
work, without opening the browser, with equivalent data integrity, validation,
navigation, persistence and export. Measured on the same weighted matrix (core .55 /
advanced .25 / platform .20). A row counts complete only end-to-end: empty/error states,
create/edit/delete semantics, persistence, and migration/sync safety, not just a form.

- IN-SCOPE for v1 full parity: all core-clinical areas; the platform pieces needed for
  real use (8-area shell, settings, auth/session, operator profile, in-session lock, PIN
  change, terminology/reference imports, ambulatory CRUD); local advanced-clinical
  (documents/import/OCR, attachments, restore, service/prosthetic prescriptions,
  PDF/reporting, local structured export).
- OUT of v1 (v1.x / v2 lanes, do NOT block "100%"): SISS/FSE live network integration,
  AI parliament / generative synthesis / smart import, analytics/BI, cloud sync or
  institutional external submission.

Adequate Linux/Windows means something DIFFERENT: shared-spine proof, not UI parity.
Adequate = MediFlowCore runs, the `KeyStore`/storage abstraction works, golden tests
pass, local-authority CRUD works for patient + 4 clinical sub-resources, a minimal shell
launches, health/settings are visible, packaging is documented, and the kill-switch path
is verified.

## Goals (ordered)

Rough parity targets are estimates for direction, not commitments.

- **G1 - Apple parity follow-ups + contract freeze** (S). Small obvious gaps first:
  patient-list row metadata (age/lead-dx/status/last-touched) + create CTA + context menu,
  patient-detail/quadro holes (clinical signals strip), auth/session annoyances (in-session
  lock, PIN change, operator profile). Output: stable workflow inventory, no more scoring
  ambiguity. Also folds in slice-6 step 2-3 (entry metadata UPDATE, enum rejection,
  schema-fingerprint test). Target ~24% -> ~28%.
- **G2 - Patient spine parity** (M/L). patient CREATE, richer list, detail/quadro,
  lifecycle edit (exemptions + ADI writable, duplicate/move/delete policy), operator/session
  behavior. First real climb. Target ~28% -> ~40-45%.
- **G3 - Daily clinical workspace** (L). Diary rich-text + attachments + restore; therapies
  with diagnosis links; observations charts + interpretation + import; full clinical scales
  (Tinetti/MMSE/GDS beyond ADL). Highest clinical value after patient identity. Target ~60-65%.
- **G4 - Reference + practice-admin substrate** (M/L). AIFA drug DB (AIC/ATC autocomplete),
  exemptions, terminology import, ambulatory CRUD, settings. DEPENDENCY: parts of this feed
  G3/G5 (therapies need AIFA autocomplete; prescriptions need catalogs), so the AIFA/
  terminology pieces should land alongside or just before finishing therapies/prescriptions.
  Target ~68-72%.
- **G5 - Documents, prescriptions, reporting** (XL). documents/import/OCR + attachments,
  service/prosthetic prescriptions, PDF/reporting + practical export. Large; only after the
  core data model is stable. Target ~85-90%.
- **G6 - Native authority completion** (XL, INTERLEAVED, not "after parity"). The ADR 0071
  slice-6 reversed-flow demotion: freeze contracts after G2, land single-writer +
  device-owned DB before expanding multi-surface write workflows, finish signed ingest +
  ciphertext sync before declaring macOS 100%. This is Axis X and it gates the true 100%
  (a parity UI on an un-demoted dual-writer DB is not "done").

## Cross-filone sequencing

User order respected: Apple parity follow-ups -> Windows -> Linux KeyStore.

- **Windows STARTS after G1 + the contract part of G2**, NOT after macOS 100%. The trigger
  is shared-spine stability, not UI parity: patient + 4 clinical sub-resource CRUD contract
  stable, MediFlowCore local-authority green on macOS, no expected schema churn from patient
  lifecycle basics, kill-switch behavior defined. Then Windows proves the spine + a minimal
  shell (this is also the single highest cross-filone de-risk, since Windows is the one
  un-proven leg + the ADR 0071 kill-switch). See [windows.md](windows.md).
- **Linux KeyStore follows Windows** (Linux spine already proven locally; remaining value is
  hardening platform storage, not discovering the architecture). See [linux.md](linux.md).

## Traps to avoid (Codex)

1. Counting reversed-flow plumbing as product parity. Apple is ~75-80% through the authority
   plumbing but only ~24% of macOS clinical parity. Keep the two axes separate.
2. Waiting for macOS 100% before starting Windows. That delays platform-risk discovery and
   overfits the shared spine to Apple.
3. Building advanced features (therapies detail, prescriptions, reports, imports) before the
   reference/admin substrate (AIFA, exemptions, terminology, settings, lifecycle semantics)
   is settled. They will churn otherwise.
