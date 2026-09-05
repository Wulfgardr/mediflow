# ADR 0118 — Source-bound POMA-28 and complete clinical-scale submissions

- Status: Proposed
- Qualification: implementation candidate, not clinical validation or release approval
- Date: 2026-09-05
- Run: mf085-fix-b-scales-20260904
- Frozen base: 517304cdd07e5e4845dce300ae7754e4add28c73
- Findings: MF085-002, MF085-003

<!-- @Codex: instrument contract recorded before implementation. -->

## Context and evidence

The frozen Web and Swift instrument named `tinetti` has 17 scored components,
whose maxima sum to 24, while the Web description claims 28. The old turn item
combines continuity and stability; bilateral foot clearance is absent; trunk
scoring stops at 1. Historical values and answer meanings must remain intact.

The selected source is Shropshire Community Health NHS Trust, **FPS 006 Physio
Tinetti Form V1, July 2012**, pages 1–2:
https://www.shropscommunityhealth.nhs.uk/content/doclib/10756.pdf
Both pages were inspected, including the printed score tables. SRAlab's
Tinetti Performance Oriented Mobility Assessment overview (updated 2014-01-31)
confirms multiple versions and the 28-point balance/gait target:
https://www.sralab.org/rehabilitation-measures/tinetti-performance-oriented-mobility-assessment
Neither source constitutes validation of this implementation or of its Italian
interface. The NHS risk panel leaves 18 and 24 unclassified (<18, 19–23, >24).
No universal categorical threshold is inferred or repaired.

## Decision

1. Publish a new instrument ID `tinetti-poma28-v1`, with new answer IDs under
   `poma28v1.`. It has ten scored balance components (maximum 16) and ten scored
   gait components (maximum 12). These are software score components, not a claim
   that the source contains twenty independent clinical macro-items.
2. Keep the frozen `tinetti` definition identifiable as retired and non-submittable.
   Do not alias its URL or answers to the new instrument. No migration, rescore,
   overwrite, or enrichment of historical records is performed.
3. Persist a fixed, identical Web/Swift `instrument` metadata object containing
   instrument/version, source identity, URL/document revision, local language,
   unvalidated translation status, and `not-classified` risk policy. Existing
   entry schema and field encryption remain unchanged. Provenance is descriptive
   technical metadata, not a signature or a clinical-validation assertion.
4. The corrected result reports its total and an explicit request for clinical
   interpretation, never an automated fall-risk category. Scores 18 and 24 have
   the same nonclassification policy as every other valid score.
5. Scoring requires explicit answers to all required scored questions, rejects
   unknown IDs and values outside each question's domain, and never coerces empty,
   missing, or nonnumeric values into zero. Explicit zero is valid. The native
   catalog has only required numeric-option questions; no text questions are
   retyped. The Web validator preserves optional/text semantics where declared.
6. Validate again at each production writer seam, resolve a canonical active
   definition, recompute totals/metadata, and only then invoke the existing
   write callback. Native form state starts empty. No new persistence/API route
   or automatic clinical write is introduced.
7. History renders stored content/score/interpretation without recalculation.
   Legacy or unbound Tinetti metadata is visibly marked; no `/28` denominator is
   inferred for it. Corrected provenance is displayed only when the expected bound
   fields match. Missing or conflicting provenance never gains a validation
   label. Original interpretations may remain visible as recorded history.

## Source mapping (NHS pages 1–2)

| New suffix after `poma28v1.` | Allowed scores | Source observation |
| --- | --- | --- |
| balance.sitting | 0,1 | Lean/slide versus steady/safe seated |
| balance.rise | 0,1,2 | Unable without help / arms / no arms |
| balance.attempts | 0,1,2 | Unable without help / multiple / one attempt |
| balance.immediate | 0,1,2 | First 5 s: unsteady / support / no support |
| balance.standing | 0,1,2 | Unsteady / wide stance AND support / narrow without support |
| balance.nudge | 0,1,2 | Falling / staggers-grabs-catches / steady; three light sternum pushes |
| balance.eyesClosed | 0,1 | Unsteady / steady with feet close |
| balance.turnContinuity | 0,1 | Discontinuous / continuous 360° turn |
| balance.turnStability | 0,1 | Unsteady-grabs-staggers / steady 360° turn |
| balance.sitDown | 0,1,2 | Unsafe / arms or not smooth / safe and smooth |
| gait.initiation | 0,1 | Hesitation or repeated attempts / none after go |
| gait.rightLength | 0,1 | Right swing foot does not / does pass left stance foot |
| gait.rightClearance | 0,1 | Right foot does not / does clear floor completely |
| gait.leftLength | 0,1 | Left swing foot does not / does pass right stance foot |
| gait.leftClearance | 0,1 | Left foot does not / does clear floor completely |
| gait.symmetry | 0,1 | Unequal / equal step lengths |
| gait.continuity | 0,1 | Stops-discontinuity / continuous |
| gait.path | 0,1,2 | Marked deviation / mild-moderate or aid / straight without aid |
| gait.trunk | 0,1,2 | Marked sway or aid / no sway but flexion or arms / none of these |
| gait.heelSpacing | 0,1 | Heels wide for stability / almost touching |

The last source row is titled “Walking Time” but its scoring descriptions concern
heel spacing; the new name records those actual observations, not elapsed time.
For path, the 10-foot observation distance is retained; the ambiguous printed
tile-width notation is not silently converted into a normative metric.
Instructions retain seated armless-chair start, usual walking aid, usual outbound
pace and rapid-but-safe return. Italian labels are a local, unvalidated rendering.

## Compatibility, consequences and acceptance

No historic JSON is rewritten. The old URL is retired explicitly rather than
redirected. Other active scales retain their existing score functions and
interpretations for complete valid answers; direct invalid scoring now throws.
This deliberately changes invalid-input behavior, not historical score semantics.
Existing tests that injected impossible/partial answers must use complete valid
vectors; old historical values are tested as persisted literals, not recomputed.

Shared synthetic vectors bind Web and Swift domains, item maxima, total 28,
nonclassification, partial/out-of-domain rejection and unchanged legacy history.
Tests must exercise production validators and the production write boundary.
Official integration additionally requires Node 24 gates, Apple-native tests and
UI tests; supplemental Linux tests do not substitute for those checks. Review of
clinical wording/licensing and institutional adoption remains a human governance
step; no clinical validation, validated Italian translation, or regulatory
conformity is claimed.

## Provenance-only URL guard (combined review followup 2)

The two `sourceUrl` literals are unchanged metadata, not network destinations.
The never-regress exceptions match only their exact source paths and complete
property lines (including the full PDF literal); they do not allow an NHS domain,
a different URL, another property, or a fetch call. This follows the existing
file/literal FHIR identifier convention, with stricter line anchoring.
Web submission copies the instrument into JSON and history compares the bound
values; native submission encodes the same String and history compares it.
No URL opening, download, egress permission or source revalidation is introduced.
The post-fix provenance guard tests keep the exception narrow; the Web runtime
check denies any fetch and verifies metadata through submission and history.
