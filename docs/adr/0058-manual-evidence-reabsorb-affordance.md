<!-- Codex: created 2026-05-03 -->
# ADR 0058: Manual evidence reabsorb affordance

Date: 2026-05-03  
Status: Proposed  
Related: WUL-220, WUL-216, WUL-219, ADR 0040, ADR 0057

## Problem

The evidence queue can now mark sources as `invalidated`, `superseded` or
`suppressed_stale`, but the operator still needs an explicit and reviewable way
to request reabsorption for a single source after an attachment is replaced,
reimported, deleted, or a diary entry changes.

This must not become an opaque background job. Reabsorb is a controlled
operator action for one attachment, one diary entry, or a very small selected
group.

## Decision

Add a future manual reabsorb affordance as a queue-backed workflow, not as a
parallel clinical write path.

The first executable slice must use this state machine:

- `queued`: operator requested reabsorb for a bounded target.
- `running`: local parser/projection is executing.
- `succeeded`: a derived artifact or queue projection was refreshed.
- `failed`: refresh failed for a PHI-safe technical reason.
- `skipped`: target is not eligible, already current, deleted, or blocked by
  policy.

The reabsorb request target must be one of:

- `attachment:<id>`
- `diary:<entry_id>`
- a short explicit list of those targets

The workflow may update only derived evidence artifacts or projection metadata
already governed by the WUL-216/WUL-219 contracts. It must not write diagnoses,
therapies, problems, observations, diary content, or other clinical structured
tables.

## PHI-Safe Audit Metadata

Each request should record only redacted operational metadata:

- request id
- operator/session id or local actor label
- target type
- target id hash or local id
- current source version
- previous derived artifact version, if present
- requested reason enum
- status
- started/completed timestamps
- PHI-safe failure code and reason

It must not record source text, snippets, extracted facts, patient names, tax
codes, file contents, OCR text, model prompts or model output.

## Options Considered

1. Automatic reabsorb for all invalidated sources.
   - Rejected: too broad, hard to review, and can hide expensive OCR/model work.

2. Manual single-source queue with visible status.
   - Accepted: matches local-first reviewability and keeps blast radius small.

3. Full mass-reprocess workbench.
   - Deferred: may be useful later, but only after the single-source contract
     proves safe.

## First Thin Slice

1. Add a non-clinical queue/status model for a single target.
2. Add a dry-run planner that returns `queued` or `skipped` with PHI-safe
   reasons.
3. Add tests for:
   - replaced attachment target
   - updated diary target
   - soft-deleted diary target skipped
   - failed parser path with redacted reason
4. Only after that, add UI affordance and the apply path for derived artifacts.

## Stop Rules

- Stop if the flow needs raw PHI in logs, prompts, PR text or benchmark
  fixtures.
- Stop if it writes clinical structured tables.
- Stop if it bypasses the WUL-202 artifact/backfill gate for document-derived
  writes.
- Stop if the target set expands beyond one source or a small explicit list in
  the first executable slice.
- Stop if failure reasons expose clinical text.
- Stop if it introduces a cloud runtime dependency or changes the default AI
  model.

## Consequences

Positive:

- Invalidated evidence has a clear operator-facing next action.
- Reabsorb remains reviewable and auditable.
- Future UI/API slices can be tested against a small state machine.

Negative:

- This ADR does not refresh artifacts by itself.
- Additional UI/API work is required before operators can trigger reabsorb from
  the product.

## References

- [ADR 0040: document intelligence evidence ledger and decision layers](./0040-document-intelligence-evidence-ledger-and-decision-layers.md)
- [ADR 0057: local evidence absorption layer](./0057-local-evidence-absorption-layer.md)
- [Patient Insight benchmark](../patient-insight-benchmark.md)
