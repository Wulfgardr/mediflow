<!-- Codex: WUL-406 -->
# ADR 0069: Loop Orchestrator baseline

Date: 2026-06-18
Status: Proposed

Status note: `Proposed` while `WUL-406` validates the first internal loop
orchestrator structure. It supersedes no existing ADR and extends ADR 0067.

Related: [docs/agentic-development-operating-loop.md](../agentic-development-operating-loop.md),
[docs/linear-codex-playbook.md](../linear-codex-playbook.md),
[docs/codex-workflow-monitor.md](../codex-workflow-monitor.md),
[docs/adr/0067-agentic-development-operating-loop.md](./0067-agentic-development-operating-loop.md),
[docs/adr/0065-intended-purpose-and-claims-guard.md](./0065-intended-purpose-and-claims-guard.md),
[SECURITY.md](../../SECURITY.md),
[AGENTS.md](../../AGENTS.md)

## Problem

ADR 0067 defines the agentic operating loop, but it still leaves cadence and
autonomy as prose. MediFlow now needs a concrete baseline that can run as a
maintainer without becoming a high-token background process or an unsafe
clinical automation layer.

The desired shape is hierarchical:

- an orchestrator coordinates loop outputs and side-effect authority;
- core loops maintain branches, PRs, docs, claims, risk, and future direction;
- meta loops audit and evolve the loops themselves;
- guarded PR creation and automerge are allowed only inside strict hard stops.

## Context

MediFlow is a clinical, local-first project. The loop system must therefore
preserve the existing boundaries:

- no PHI/PII in prompts, logs, GitHub, Linear, delegate packets, or artifacts;
- no read access to live SQLite, mail, Downloads, clinical vaults, or private
  evidence packs unless a task explicitly authorizes that boundary;
- no cloud dependency by default;
- Codex remains controller-of-record;
- Claude, Gemini, Oracle, RepoPrompt agents, and web research are bounded
  reviewers or planners, not authorities;
- local deterministic checks run before expensive reasoning.

## Options

1. Keep the operating loop as prose and run it manually from chat.
2. Build a continuously running autonomous agent with direct model calls and
   broad write access.
3. Add a machine-readable manifest plus a deterministic validator, and let the
   orchestrator schedule low-cost metadata loops while reserving expensive
   reasoning for bounded strategic reviews.

## Trade-offs

- Option 1 keeps overhead near zero, but does not solve branch/PR hygiene or
  cadence drift.
- Option 2 maximizes autonomy, but it is too expensive and too risky for a
  clinical local-first repository.
- Option 3 creates a small amount of process/tooling overhead, but gives the
  loops a reviewable contract and keeps model spend under explicit cadence.

## Decision

Adopt option 3.

The baseline is stored in `docs/loop-orchestrator.config.json` and validated by
`npm run loop-orchestrator -- validate` plus
`npm run test:loop-orchestrator`.

`WUL-407` makes the baseline live through a local macOS LaunchAgent. The live
runner wakes frequently, writes state under
`~/Library/Application Support/MediFlow/loop-orchestrator/`, and executes only
loops that are due according to the manifest. It is still deterministic-first:
no continuous model calls, no clinical database reads, no mail/calendar reads,
and no sensitive external side effects.

Initial loops:

- `orchestrator`: event-driven coordinator. It does not poll models
  continuously; it routes scheduled loop outputs, Goals, PR state, and user
  commands.
- `maintainer`: daily/nightly at 03:30 Europe/Rome. It scans branch/PR/CI
  metadata, runs declared local checks, creates or updates PRs, and may perform
  guarded automerge only when every guard is satisfied.
- `forward-thinker`: weekly. It looks ahead from repo/docs/Linear context and
  may use RepoPrompt, Oracle, Claude, Gemini, or web research on curated
  redacted packets. It drafts candidate issues or ADR notes; it does not code
  directly unless the orchestrator promotes a thin slice.
- `docs-claims`: weekly or post-merge. It keeps docs and claim posture aligned
  with ADR 0065 and `check:claims`.
- `risk-compliance`: fortnightly or trigger-based. It focuses on security,
  SISS/FSE, AI runtime, data egress, auth, encryption, audit, and network write
  boundaries.
- `loop-auditor`: weekly. It reviews whether loops add value, waste tokens,
  create noise, or need cadence changes.
- `loop-gardener`: weekly after the auditor. It proposes spawning, modifying,
  or retiring loops via issue/PR; it cannot enable loops for other projects
  without explicit opt-in.

Guarded automerge is allowed only for single-theme PRs with linked work,
declared green checks, GitHub checks when available, no unresolved review
comments, no sensitive hard-stop paths, and explicit `No PHI/PII used`
evidence. Sensitive changes always become PR + human review, not automerge.

## First thin slice

1. Add the manifest and validator.
2. Document cadence and side-effect boundaries in the internal operating loop.
3. Add focused tests that fail if required loops or safety guards disappear.
4. Keep all new loop tooling excluded from OSS export.
5. Add the local scheduled runner and install it as a user LaunchAgent.

## Consequences

The loop system becomes concrete enough to run and audit, while remaining
cheap: deterministic scans first, scheduled high-reasoning work only weekly or
fortnightly, and no continuous model polling.

Future projects can reuse the same pattern, but must be explicitly enabled by
the orchestrator with a project-specific manifest and privacy boundary.
