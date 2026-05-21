# MediFlow Linear Legacy Snapshot

Snapshot date: 2026-05-20.

Purpose: preserve the older Linear work ledger locally before freeing the Linear
workspace for new issues. This is a compact operational archive, not a full
replacement for Linear history.

## Why This Exists

The Linear workspace rejected creation of a new SISS live-inspection issue with:

```text
Usage limit exceeded - You've exceeded the free issue limit for this workspace.
```

The immediate operating model is therefore:

1. snapshot older completed/canceled/backlog work locally;
2. keep only current/near-term issues active in Linear;
3. archive older Linear issues through UI/API once an archive-capable path is
   available;
4. resume normal one-issue/one-branch delivery for new SISS work.

## Tool Limitation

The available Linear connector exposes issue read, update, comment, document and
attachment operations, but no issue archive/delete mutation. State changes alone
do not free the free-plan issue count if Linear still counts non-archived issues.

## Candidate Archive Policy

Archive candidates:

- `Done` or `Canceled` issues with shipped/closed work;
- weekly tracker issues already absorbed into docs/PLANS/memory;
- old macro/track issues whose decisions now live in canonical docs;
- implementation issues whose PRs are merged and whose docs are aligned.

Keep active in Linear:

- current workstream parents used for ongoing planning;
- open backlog issues that still need triage;
- current SISS/webapp-assisted evidence and publication work;
- anything with unresolved PRs, failing checks, or unclear delivery status.

## Candidate Snapshot From Linear Search

The following candidates came from a Linear search for older non-archived MediFlow
issues. They should be reviewed before bulk archiving.

### SISS / Regional Integrations

- `WUL-178` - Prototype Prescrittivo backend-first: primo flusso MediFlow utilizzabile con fallback esplicito
- `WUL-183` - SGDT PAI per MMG/SSI: verifica del perimetro cooperativo realmente utile a MediFlow
- `WUL-172` - SGDT / COT: chiarire scope operativo e boundary di integrazione per MediFlow
- `WUL-204` - Protesica-RL: handoff paziente e diario prescrizioni protesiche document-backed
- `WUL-41` - MACRO: FSE 2.0 e terminologie

### Documentation / Release / Planning

- `WUL-203` - Docs sweep: update reference/support docs to current app state
- `WUL-211` - Release v0.6.0 documentation and OSS publication sweep
- `WUL-161` - Weekly betterments 2026-04-14: tracker e piano operativo
- `WUL-153` - Weekly betterments 2026-04-07: tracker e review
- `WUL-63` - Weekly betterments 2026-03-09: tracker e review
- `WUL-233` - Post-v0.6 objective map: filoni concreti di evoluzione MediFlow
- `WUL-35` - MACRO: Governance operativa e toolchain

### UI / Kree8 / Workbench

- `WUL-197` - Craft-inspired clinical workspace shell redesign preview for MediFlow
- `WUL-229` - UI revamp web: Claude-driven dummy replacement and Assistant retirement
- `WUL-230` - UI revamp phase 2: migrate real workbench surfaces to approved Liquid Glass language
- `WUL-261` - Clinical Workbench first-fold density and operational focus
- `WUL-271` - Kree8-inspired full-surface MediFlow interface mockup
- `WUL-273` - Kree8 app-wide migration: real data surfaces and route consolidation
- `WUL-275` - Kree8 clinical agenda bridge: Zimbra/iCloud candidates

### AI / Document Intelligence

- `WUL-96` - OpenMed sidecar locale: benchmark PII/redaction e adapter redaction.v1
- `WUL-110` - Input normalization AI: parser tollerante PDF/CDA/CCD prima delle lane semantiche
- `WUL-114` - TurboQuant feasibility per serving locale e benchmark runtime
- `WUL-115` - Benchmark dei distillati Jackrong Qwen3.5 via MLX
- `WUL-150` - Home-base read-only: pairing esplicito e lista/dettaglio pazienti dal nodo paired
- `WUL-152` - Canonical document parse/evidence artifact v1: first consumer Patient Insight
- `WUL-158` - Real-case PDF import hardening: create-flow documentale, OCR server-side e review terapie
- `WUL-167` - Formalize document import decision contract from operator import workflow
- `WUL-212` - Document intelligence vNext: assorbimento locale di diario e allegati senza training
- `WUL-231` - Smart Import: distinguere prestazioni prescritte da farmaci prescritti
- `WUL-235` - Document intelligence: introdurre document_decision.v1 come artifact di regia
- `WUL-263` - Management-system heading heuristic guard for Smart Import
- `WUL-264` - Clinical safety case and hazard log for AI/import surfaces
- `WUL-265` - CIF-lite usability harness for core clinical workflows
- `WUL-266` - Source card 'why shown' for review queue and document intelligence
- `WUL-267` - Clinical alert budget and severity ladder for failure counters
- `WUL-268` - Document intelligence artifact lineage ledger for reviewed facts
- `WUL-269` - Local AI no-egress boundary tests for clinical surfaces

### Native / Apple / Home Base

- `WUL-188` - ADR: architettura shared Apple client, shell per piattaforma e design system clinical-first
- `WUL-191` - Foundation Apple targets: package condivisi + shell macOS, iOS e iPadOS
- `WUL-192` - macOS home-base packaged: app eseguibile che avvia backend, TLS, Ollama e ICD senza terminale
- `WUL-198` - Decouple Start_MediFlow from native Apple launcher and frozen macOS prototype
- `WUL-74` - TRACK: Verifica e chiusura parity web <-> macOS
- `WUL-75` - TRACK: Parity moduli core web <-> macOS

### Runtime / API / Operations

- `WUL-37` - MACRO: Sicurezza applicativa e continuita operativa
- `WUL-39` - MACRO: Audit trail e attribuzione attore
- `WUL-147` - Linear hygiene: issue piu snelle sopra, dettagli tecnici sotto
- `WUL-154` - API v1 migration rehearsal: ledger compatibilita e prova no-breaking
- `WUL-259` - AIFA catalog refresh metadata and format-safe dry-run
- `WUL-270` - AIFA lookup ambiguity and active-ingredient guardrail

### External / Adjacent Work

- `WUL-240` - Unicum Work Harness: control center locale cross-agente per MediFlow, Zimbra e work-memory
- `WUL-247` - Refresh visual design for leonardopegollo.dev
- `WUL-248` - Tracker: stato corrente, ricerca e pacchetto startup OncoBackboneMac
- `WUL-4` - Import your data

## Next Archive Pass

Recommended first pass:

1. Archive completed weekly trackers and superseded macro/track issues.
2. Archive completed UI exploration issues already represented in PRs/docs.
3. Archive completed implementation issues older than the current active cycle.
4. Re-attempt creation of the new SISS live-inspection issue.

Archive action still needs one of:

- Linear UI bulk archive;
- a Linear API token and direct GraphQL `issueArchive` mutation;
- connector support for issue archiving.
