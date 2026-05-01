<!-- Codex: created 2026-04-24 -->
# Codex / Opus Dialogue Protocol

Status: Working protocol  
Owner: Codex, with Leonardo as final approver  
Linear: WUL-202

## Scope

This protocol defines how MediFlow can use Opus/Claude as a design-time reviewer
for the intelligence stack without turning Claude into a product runtime
dependency.

The goal is to improve:

- document intelligence and evidence-ledger design
- Patient Insight source governance
- Smart Import extraction and review safety
- model challenger selection
- benchmark and rollout readiness discipline

## Hard Boundaries

- No PHI/PII in prompts, repo artifacts, logs, screenshots, or dialogue files.
- No runtime dependency on Claude, Opus, cloud models, or external reviewers.
- No automatic promotion from dialogue output to product behavior.
- Smart Import remains reviewable and never performs silent structured writes.
- Patient Insight remains locally rendered and source-grounded.
- Every promoted lane still requires corpus, benchmark, fallback, stop-rules,
  and a rollout-readiness verdict.

## Roles

Codex is the controller:

- selects the question
- constrains scope
- verifies repo evidence
- filters the response
- decides whether a patch is small enough to implement
- owns tests, docs, Linear, Git, and final delivery

Opus/Claude is a design-time reviewer:

- proposes options
- identifies blind spots
- suggests benchmarks, challenger models, or distillation paths
- must not edit files in this workflow
- must not receive private clinical text

## Round Format

Each round is recorded as a Markdown file under `docs/dialogue/`.

Required front matter:

```yaml
round: 1
date: 2026-04-24
initiator: codex
reviewer: opus
topic: ai-intelligence-stack
status: open
linear: WUL-202
```

Required sections:

1. `Codex Context`
2. `Question For Opus`
3. `Opus Response`
4. `Codex Decision`
5. `Verification Contract`
6. `Follow-Up Slice`

## Acceptance Rules

A recommendation can be accepted only if it has:

- a named lane or component
- files likely to change
- tests or benchmarks to run
- a failure mode or safety risk
- a clear non-goal

Opinions without a benchmark path stay as notes, not implementation work.

## Recommended Use

Use this protocol for:

- new benchmark lanes
- model challenger evaluation
- comparator distillation
- document evidence-ledger evolution
- AI rollout governance changes

Do not use it for:

- routine bug fixes
- direct processing of real patient material
- UI copy polish
- runtime model selection by preference alone

