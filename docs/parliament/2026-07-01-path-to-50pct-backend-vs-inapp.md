<!-- Claude: first parliament note, per carta-multi-entita.md. -->
# Parliament note: path to 50% macOS parity - in-app vs backend

Date: 2026-07-01. Proposer: Claude Code (Entity A). Process: [charter](../analysis/filoni/carta-multi-entita.md) section 3.
Status: OPEN (awaiting Codex + Gemini voices + human ratification).

## Problem

macOS weighted parity is ~40% (from 24%). Core-clinical UI polish plateaus at ~45%
because several remaining gaps are NOT UI work: they need advanced-tier features or
BACKEND changes that touch shared contracts / the ADR 0071 demotion boundary (Next.js),
i.e. outside Entity A's Apple perimeter. The user's target is 50% (and beyond, toward
full parity). We must decide WHAT to take on, and WHO owns it, without violating
perimeters or the constitution.

## Key finding (the math)

Weights: core 0.55, advanced 0.25, platform 0.20. Reaching 50% does NOT strictly need
backend. An IN-APP path (all inside Entity A's perimeter, in-house-first, no shared-contract
change) gets there:
- core UI polish -> ~70 (observations chart, patient-list context-menu + lead-diagnosis,
  edit birthDate/gender). Note: detail-overview is capped ~40 without AI/documents.
- advanced -> ~19 via export FHIR/PDF ported 1:1 from the web (in-app), AIFA catalog
  bundled in-house (lifts therapies to ~90, a core gain too).
- platform -> ~26 via auth in-session lock (PIN-change may need backend; lock does not).
- Result: 0.55*72 + 0.25*19 + 0.20*26 ~= 49-50% weighted, with ZERO backend changes.

## Options

- **A - In-app first (proposer's recommendation).** Stay in Entity A's perimeter: core UI
  polish + export FHIR/PDF (port lib logic to Swift) + AIFA catalog in-house (ADR 0070) +
  auth in-session lock. Reaches ~49-50% weighted. No shared-contract/Next.js change, no
  cross-entity coordination, no new PHI surface. Fastest + lowest-risk to 50%.
- **B - Backend enablers.** Add small Next.js read params/endpoints: diary `includeDeleted`
  (enables diary restore), and later documents/OCR ingest. Unlocks diary restore + the
  documents subsystem (which also uncaps detail-overview's review-queue summary). BUT this
  is Entity B's (Codex / Next.js) perimeter or a coordinated cross-perimeter change, and
  touches the demotion boundary (must stay ciphertext-only, no plaintext clinical validation).
- **C - Redefine 50%.** Treat the weighted matrix as the yardstick and accept that some
  advanced/AI areas are legitimately out of v1 (per the charter), so "50%" is measured on
  the in-scope surface. Pair with A.

## Recommendation

**A + C.** Pursue the in-app path (A); it reaches ~50% weighted with no perimeter breach
and no backend risk. Formally scope 50% on the v1 in-scope surface (C): AI parliament /
smart-import / analytics stay OUT of v1 (charter). Defer B (backend enablers) to a SEPARATE
cross-perimeter parliament item, owned jointly with Codex, because it changes shared
Next.js contracts and must be checked against the ADR 0071 demotion boundary. Documents/OCR
is the highest-value B item (it uncaps detail-overview) but is XL and cross-perimeter.

## Affected invariants

- ADR 0071 demotion: any B-path Next.js change must keep it ciphertext-only, no plaintext
  clinical validation, no authoritative id/version/tombstone assignment.
- Zero-knowledge crypto: export (FHIR/PDF) decrypts in-app only; no PHI leaves the device
  except as the operator-initiated export file. No PHI in repo/logs.
- In-house-first (ADR 0070): AIFA catalog is a bundled in-app table, not an external dep.
- Perimeters: A stays in `-apple-wt`; B is Codex/Next.js or a coordinated change.

## First thin slice (if A ratified)

observations chart (Swift Charts sparkline per LOINC code) - pure UI, Entity A perimeter,
reversible, ~+3-4 weighted. Then export FHIR (JSON) as the first advanced lever.

## Voices

- **Claude Code (proposer):** A + C. Reach ~50% in-app; defer backend (B) to a joint item.
- **Codex:** _(pending consult 2026-07-01)_
- **Gemini:** _(pending: human runs the Antigravity prompt)_
- **Human ratification:** _(pending)_

## Dissent / minority report

_(none yet)_
