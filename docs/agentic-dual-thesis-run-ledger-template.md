---
summary: "Reusable internal template for MediFlow dual-thesis agentic run ledgers, evidence packs, and issue decision records."
read_when:
  - "Starting a MediFlow workstream that uses Claude plus an independent Codex/ChatGPT thesis and Gemini cross-exam."
  - "Recording isolation, artifact provenance, conflict matrix, Codex decision and verification evidence for a multi-agent run."
private: true
---

<!-- Codex: WUL-296 -->
# Dual-Thesis Agentic Run Ledger / Evidence Pack Template

Stato documento: `INTERNAL / SECONDARY`<br>
ADR: [ADR 0067](./adr/0067-agentic-development-operating-loop.md)<br>
Runbook: [Agentic Development Operating Loop](./agentic-development-operating-loop.md)<br>
Linear: `WUL-296`

Questo template rende ripetibile la dinamica `Claude thesis + Codex/ChatGPT
independent thesis + Gemini cross-exam` senza trasformarla in un runtime
clinico. Serve anche come **Evidence Pack / Issue Decision Record**: il luogo
in cui registrare gli artefatti che hanno inciso sulla decisione, la loro
provenienza, il loro hash e la disposizione finale di Codex. Usalo solo per
workstream di sviluppo MediFlow che hanno bisogno di una traccia multi-agent
verificabile, inclusi gli slot di delega implementativa che fanno lavorare
Claude/Gemini senza togliere a Codex l'autorita finale.

## Privacy Rule

Non incollare output raw, prompt completi, transcript integrali, dati clinici,
SQLite, mail, calendar, `docs/private`, PHI o PII nel ledger. Registra solo
sintesi redatte, path locali ai transcript/scratch e hash/provenienza quando
servono audit.

## When To Use

Usa questo template quando un workstream:

- ha un issue/branch dedicato;
- usa almeno due tesi indipendenti prima della decisione Codex;
- passa il confronto a Gemini o a un equivalente cross-exam;
- produce una decisione o un artifact che influenza implementazione, PR,
  Linear, ADR, runbook o roadmap.
- usa output decision-shaping da ChatGPT Deep Research, Extended Pro,
  RepoPrompt, Claude, Gemini, Linear, PR o check locali.

Per task brevi, single-agent o puramente meccanici, usa il normale evidence
comment del runbook.

## Operational Order

1. Prepara un packet redatto e bounded.
2. Scrivi o salva la tesi Codex/ChatGPT prima di leggere una tesi Claude
   sostanziale; se non e possibile, registra il motivo.
3. Salva i transcript delegate come path locali, non come contenuto inline.
4. Registra ogni artefatto decision-shaping nell'artifact registry con source,
   path, hash, privacy boundary, verifica e disposizione Codex.
5. Compila la matrice di conflitto prima della decisione finale.
6. Passa a Gemini il packet piu le due tesi per disagreement e risk check.
7. Assegna gli implementation slots solo dopo la decisione provvisoria Codex:
   Claude puo produrre candidate plan/moduli, Gemini resta scout adversarial con
   smaller-slice/test/failure-mode candidate.
8. Applica solo cio che Codex verifica localmente.

## Copyable Template

```md
# <WUL-XXX> Dual-Thesis Agentic Run Ledger

Run date:
Issue:
Branch:
Goal:
Prepared by:

## 1. Workstream Contract

- Desired end state:
- Verification surface:
- Allowed tools/data:
- Explicitly out of scope:
- Stop condition:
- Issue decision record status: <draft / in-review / final / superseded>
- Decision question:
- Decision summary:
- Options considered:
- Selected option:
- Rejected options:
- Evidence artifact IDs used:
- Decision owner: Codex/controller-of-record
- Review destination: <Linear comment / PR / docs update / no external summary>

## 2. Privacy Boundary And Packet Manifest

- Packet path:
- Packet status: <redacted / bounded / synthetic-only / other>
- Included evidence:
- Omitted evidence:
- External model calls:
- Forbidden surfaces confirmed absent:
  - clinical runtime data:
  - SQLite contents:
  - mail/calendar:
  - `docs/private`:
  - PHI/PII:

## 3. Evidence Artifact Registry

| Artifact ID | Type | Source | Raw local path | Committed digest path | Timestamp | SHA-256 / hash | Privacy boundary | Role in decision | Verification status | Codex disposition | Linear/PR safe summary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | <deep-research / extended-pro / repoprompt-export / claude / gemini / local-check / linear / pr / repo-doc / other> | <model/tool/local> | <path or n/a> | <path or n/a> | <ISO or n/a> | <hash or n/a> | <private/internal/synthetic/public> | <why it mattered> | <verified-local / digest-only / path-recorded / not-verified / not-applicable> | <adopt / adapt / reject / hold / research-needed> | <yes/no> |

Registry rules:

- Raw transcripts, prompt exports, browser captures and delegate logs stay local
  unless a redacted digest is explicitly created.
- Use `prompt-exports/` or delegate scratch paths for raw private artifacts;
  commit only redacted digests under `docs/analysis/` when they materially
  shape repo decisions.
- Every artifact that influences Linear, PR, ADR, runbook, implementation scope
  or no-action rationale must appear here.
- `Linear/PR safe summary` is `yes` only when the row contains no raw
  transcript, PHI/PII, clinical data, sensitive private path or operational
  detail that should remain local.
- If no external/web/delegate artifacts were used, record one row with
  `Type=other`, `Source=none`, `Verification status=not-applicable` and
  `Codex disposition=hold`.

## 4. Isolation Ledger

- Codex/ChatGPT thesis path:
- Claude transcript path:
- Gemini transcript path:
- Was Codex/ChatGPT thesis created before reading a substantive Claude thesis?
- If no, reason and contamination risk:
- Remaining contamination risk:

## 5. Claude Initiative Thesis

- Transcript path:
- Ambitious proposal:
- Prudent slice:
- Risk not to ignore:
- Gemini challenge prompt:
- Codex verification needed:

## 6. Codex/ChatGPT Independent Thesis

- Scratch path:
- Original thesis:
- Autonomous evaluation:
- Provisional decision before synthesis:
- Local verification requested:

## 7. Conflict Matrix

| Decision point | Claude thesis | Codex/ChatGPT thesis | Conflict | Codex resolution |
| --- | --- | --- | --- | --- |
| <topic> | <summary> | <summary> | <agree/diverge/reframe> | <resolution> |

## 8. Gemini Cross-Exam

- Transcript path:
- Agreement:
- Disagreement:
- Hidden assumptions:
- Risks:
- Smaller alternative:
- Verification proposed:
- Codex response:

## 9. Implementation Delegation Slots

- Delegate mode: <read-only / isolated patch artifact explicitly authorized / not run>
- Claude candidate transcript/path:
- Claude candidate deliverable:
  - product or UX plan:
  - candidate module or patch plan:
  - Codex decision: <adopt / adapt / reject>
- Gemini adversarial candidate transcript/path:
- Gemini candidate deliverable:
  - fragile assumption:
  - smaller slice:
  - test or failure-mode candidate:
  - Codex decision: <adopt / adapt / reject>
- Work explicitly rejected:
- Rule confirmed: no delegate output was automatically applied to the primary branch.

## 10. Codex Decision And Implementation Scope

- Verdict: <promote / revise / hold / reject / research-needed>
- Adopted:
- Rejected:
- Files allowed:
- Files changed:
- Scope check:

## 11. Verification Evidence

| Check | Result | Evidence |
| --- | --- | --- |
| `git diff --check` | <pass/fail/skip> | <summary> |
| `npm run check:claims` | <pass/fail/skip> | <summary> |
| `npm run workflow-monitor -- --once --json --expected-issue WUL-XXX` | <pass/fail/skip> | <summary> |
| OSS/privacy gate | <pass/fail/skip> | <summary> |

## 12. Non-Actions, Follow-Ups And Handoff

- Intentionally not done:
- Follow-up candidates:
- Linear update:
- PR:
- Not verified:
- Final handoff summary:
```

## Minimum Completion Bar

Un ledger e completo solo se registra:

- packet e privacy boundary;
- issue decision record summary;
- artifact registry, oppure una riga esplicita `not-applicable`;
- path di scratch/transcript o motivo della loro assenza;
- disposizione Codex per ogni artefatto decision-shaping;
- evidenza di isolamento tra tesi Claude e Codex/ChatGPT;
- matrice di conflitto;
- cross-exam Gemini;
- implementation delegation slots, anche quando un delegate non e stato usato;
- decisione Codex;
- checks eseguiti e non eseguiti;
- non-actions e handoff.

## Implementation Delegation Rules

- Claude puo proporre una candidate implementation sotto forma di piano, modulo
  o diff artifact, ma resta read-only per default.
- Gemini non e un secondo patcher simmetrico: il suo slot produce dissenso,
  alternativa piu piccola, test candidate o failure-mode da verificare.
- Patch artifact, worktree isolati o branch delegate sono ammessi solo con
  autorizzazione esplicita e non possono essere applicati automaticamente al
  branch primario.
- Codex deve registrare per ogni candidate: `adopt`, `adapt` o `reject`, piu
  verifica locale richiesta o ragione del rifiuto.
