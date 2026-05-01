---
round: 1
date: 2026-04-24
initiator: codex
reviewer: opus
topic: ai-intelligence-stack
status: ledger-slice-implemented
linear: WUL-202
---
<!-- Codex: created 2026-04-24 -->

# AI Intelligence Stack Optimization

## Codex Context

Current `main` baseline is clean and local-first.

Verified before this round:

- `npm run lint`
- `npm run typecheck`
- `npm run check:never-regress`
- `npm run test:ai-task-contracts`
- `npm run test:patient-smart-import`
- `npm run test:document-synthesis`
- `npm run test:ai-context`
- `npm run test:patient-insight`
- `npm run test:document-input-normalization`
- `npm run test:document-insight-context`
- `npm run test:ai-rollout-readiness`
- `npm run benchmark:redaction`
- `npm run benchmark:clinical-entities`

Known failure before this round:

- `npm run test:pdf-service` failed because `tsconfig.pdf-service-test.json`
  omitted the existing `lib/pdfjs-worker.d.ts` declaration.

Relevant constraints:

- `ollama` remains the local generative runtime.
- `qwen3.5:35b-a3b` remains the protected baseline until a challenger beats it
  on lane-specific benchmarks.
- `mediflow.ai.extract.v1` remains the shared extraction envelope.
- Smart Import stays reviewable.
- Patient Insight stays locally rendered.
- OpenMed, MLX, TurboQuant, and NER lanes remain benchmark-only unless
  explicitly promoted through governance.

## Question For Opus

Given the current MediFlow stack, what are the highest-leverage design-time
improvements that could make document intelligence, Patient Insight, Smart
Import, model evaluation, and distillation more reliable without changing the
runtime safety posture?

## Opus Response

Opus identified three near-term opportunities:

1. Close the document evidence-ledger spine by making source priority,
   freshness, status, and negative assertions more explicit in document
   evidence projections.
2. Add a distillation protocol for cloud/comparator findings so they become
   synthetic benchmark gaps or local heuristics, not one-off prompt edits.
3. Keep redaction as a separate fail-closed lane and move it only through
   benchmark and rollout-readiness gates.

Opus also suggested challenger families, all benchmark-only:

- generative: smaller Qwen/Gemma/Phi variants only if they beat the protected
  baseline on `patient_insight` and `smart_import` metrics
- extraction/NER: span-first candidates such as HUMADEX only if they improve
  resolver recall, not just entity F1
- redaction: OpenMed and GLiNER-style PII candidates only with zero forbidden
  leak rate on synthetic corpora
- runtime/KV-cache: MLX/TurboQuant or llama.cpp-style experiments only in
  isolated harnesses, with contract-validity parity

## Codex Decision

Accepted:

- Persist the Codex / Opus dialogue as a design-time protocol.
- Treat Opus output as advisory, not authoritative.
- Fix the current PDF test configuration gap first.
- Keep document-ledger field expansion as the next implementation slice, not
  part of this first patch.

Modified:

- Do not add new `document_evidence_pack.v2` fields in this round. That touches
  the document intelligence contract and should remain a separate, benchmarked
  slice under WUL-202 or a child issue.

Deferred:

- Any new model candidate benchmark.
- Any OpenMed, HUMADEX, GLiNER, MLX, or TurboQuant runtime promotion.
- Any comparator workflow that could persist private-case content.

## Verification Contract

This round closes only if:

- the PDF service test config is fixed
- the dialogue protocol is documented
- markdown indices are updated
- no runtime AI behavior changes
- existing targeted AI/document tests still pass

## Follow-Up Slice

Recommended next slice:

1. Extend document intelligence fixtures with a synthetic case where an older
   stale document competes with a newer source in the same clinical domain.
2. Add optional ledger/projection fields for source priority, freshness, and
   negative assertions.
3. Prove the behavior with `test:document-synthesis`,
   `test:document-insight-context`, and `test:ai-context`.

## Round 2: Ledger Slice Review

Codex asked Opus to review the smallest safe implementation for the document
evidence ledger before changing code.

Opus called out four contract risks: preserve artifact schema parsing, keep
suppressed material out of Patient Insight render paths, avoid calendar-based
freshness drift, and avoid an unconstrained source-priority score.

Codex accepted the narrower version: optional `sourceGovernance` metadata on
the document evidence pack and parse artifact memory, excluded material named
`suppressedCandidates`, fact-only render/projection paths, deterministic `0-100`
source priority, and semantic `recent | stale | undated` freshness.

Non-goals remain unchanged: no new model candidate, no LLM/classifier call for
suppression, no cross-document conflict resolver, and no promotion of
Claude/Opus into runtime behavior.

## Round 3: Backfill Planner Slice

Codex rechecked the high-yield shadow comparison against the WUL-202 stop rule:
the useful gap was not model quality, but missing parse/evidence artifacts for
attachments and summaries that already exist.

Codex accepted the next reviewable slice:

- build a pure planner that can classify existing attachments as create,
  rebuild, skip-existing, or skip-no-text
- use source text first and summary snapshots only as fallback input
- keep generated parse/evidence candidates in memory for review and tests
- expose only redacted JSON/Markdown reports from the CLI by default
- do not write structured clinical chart fields
- do not apply DB updates automatically

This keeps the lane bounded to document-intelligence artifact recovery. A later
apply command would need a separate review gate, backup-first live-DB handling,
and explicit confirmation before writing encrypted artifact snapshots.

## Round 4: Live DB Dry-Run Export

Codex continued the backfill lane with a read-only live database dry-run.

Accepted:

- unlock the selected MediFlow SQLite database only in local process memory
- read existing attachment names, summaries, quality metadata, and
  parse/evidence artifact snapshots
- feed decrypted values into the existing pure planner
- emit only redacted aggregate JSON/Markdown reports outside the repository
- keep raw clinical text, filenames, candidate artifacts, PINs, and DB paths out
  of logs and Git

Still deferred:

- decrypting or parsing attachment binary payloads as source PDF text
- writing `parseEvidenceArtifactSnapshot` back to the live database
- changing Patient Insight, Smart Import, diagnoses, therapies, notes, or other
  structured clinical data

## Round 5: Saved PDF Text-Layer Recovery

Codex extended the live dry-run with an optional `--recover-pdf-text` mode.

The mode still stays read-only: it decrypts saved PDF payloads in memory, reads
only their embedded text layer, and feeds that text to the same planner as
`rawMarkdown`. It does not OCR, does not emit text, and does not write back to
the database.

The first local dry-run showed that DB-stored PDF payloads improve evidence
density more than broad coverage: candidates moved from summary-heavy to
source-backed where PDF data exists, candidate facts increased, but most
`skip_no_usable_text` rows remained because their attachment binary is not
stored in the live DB.

This makes the next fork explicit:

- use an apply gate only for the already reviewable candidates; or
- add a separate archive-relink/source-file recovery lane for attachments whose
  DB row has no saved binary or useful summary.

## Round 6: Archive Relink Dry Run

Codex added an optional archive relink mode for the live dry-run. It indexes the
local `01_Sanita_Personale/Pazienti_per_codice_fiscale` archive by patient tax
code, then accepts only non-ambiguous PDF matches inside the matching patient
folder. The initial match criteria are deliberately conservative: normalized
filename match first, then exact byte-size match.

The first local run indexed the archive successfully but found no safe relink
matches. This is useful negative evidence: the remaining `skip_no_usable_text`
set cannot be recovered by a naive filename or size match. A broader source-file
recovery lane would need stronger provenance rules before it should feed the
artifact planner.

The apply boundary remains unchanged: no artifact writes, no structured clinical
writes, no raw text emitted, and no automatic promotion of archive-derived
content.

## Round 7: Artifact Apply Gate Scaffold

Codex added the first explicit apply gate for the reviewable artifact backfill
lane. The live CLI remains dry-run by default and now reports how many candidate
artifacts would be eligible for an apply pass.

Apply mode is intentionally narrow:

- it requires `--apply`;
- it requires the exact confirmation token
  `--confirm-apply DOCUMENT_EVIDENCE_ARTIFACTS_ONLY`;
- it requires a `--backup-out` SQLite copy before the DB is opened in write
  mode;
- it writes only `attachments.parse_evidence_artifact_snapshot`;
- it does not write diagnoses, therapies, observations, diary entries, patient
  summaries, or other structured clinical fields.

The first local run of this scaffold stayed in dry-run mode. It confirmed 52
eligible candidate artifacts, 0 attempted writes, and 0 written rows. The next
human decision is whether to run the explicit apply path for those artifact
snapshots after reviewing the redacted coverage reports and keeping the DB
backup as the rollback boundary.
