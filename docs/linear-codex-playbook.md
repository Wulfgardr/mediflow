# Playbook Operativo Linear + Codex (MediFlow)

Stato documento: `CANONICAL` (workflow operativo planning -> coding -> audit trail)  
Ultimo aggiornamento: 2026-03-03

---

## Obiettivo

Usare:

- **Linear** come sistema operativo del lavoro (idee, priorita, execution, stato)
- **Codex** come agente di implementazione
- **GitHub** come evidenza di delivery (branch/PR/merge)
- **Repo docs (ADR/PLANS)** come memoria decisionale persistente

Questo elimina il problema "l'ho scritto in una chat diversa" e rende ricostruibile ogni fase.

## Principio guida

Una modifica e completa solo se esistono tutti questi riferimenti:

1. Issue Linear (perche + scope + acceptance criteria)
2. Branch/PR collegata all'issue
3. Decisione architetturale persistita (ADR) quando richiesta
4. Verifica esplicita (cosa testato/non testato)

---

## Setup iniziale (una tantum)

## 1) Configura Linear workspace/team (solo te)

1. Crea Team `MediFlow`.
2. Imposta workflow semplice:
   - `Triage`
   - `Backlog`
   - `Planned`
   - `In Progress`
   - `In Review`
   - `Done`
   - `Canceled`
3. Attiva cicli settimanali (o 2 settimane se preferisci batch piu lunghi).

## 2) Connetti GitHub a Linear

1. Linear -> `Settings` -> `Integrations` -> `GitHub`.
2. Collega l'account GitHub.
3. Seleziona repository `medical-record-app`.
4. Abilita automazioni status (almeno `In Progress` su PR aperta, `Done` su merge) secondo preferenza team.

## 3) Connetti Codex a Linear (MCP)

Comandi:

```bash
codex mcp add linear --url https://mcp.linear.app/mcp
codex mcp login linear
```

Se la connessione MCP non parte al primo colpo, aggiungi in `~/.codex/config.toml`:

```toml
[features]
experimental_use_rmcp_client = true
```

Verifica:

```bash
codex mcp get linear
codex mcp list
```

---

## Import iniziale con `@linear/import`

Per importare il backlog corrente nel formato atteso dal package Linear:

1. Genera i CSV compatibili:

```bash
npm run linear:prepare-import
```

Output:
- `docs/linear-import-open.linear.csv` (tutto insieme)
- `docs/linear-import-open.mf-core-q2.linear.csv`
- `docs/linear-import-open.mf-parity-q2.linear.csv`
- `docs/linear-import-open.mf-fse-q2.linear.csv`

2. Avvia importer:

```bash
npx -y @linear/import
```

Alternativa automatizzata (import dei 3 stream in sequenza):

```bash
export LINEAR_API_KEY='<api_key>'
npm run linear:import:all
```

Variabili opzionali:
- `LINEAR_TEAM_NAME` (default: `MediFlow`)
- `LINEAR_PROJECT_NAME` (default: `MediFlow`)

Alternativa robusta non-interattiva (consigliata in ambienti headless):

```bash
export LINEAR_API_KEY='<api_key>'
export LINEAR_TEAM_NAME='Wulfgardr'
export LINEAR_PROJECT_SLUG_ID='4523b0329edb'
npm run linear:import:api
```

Questa via usa GraphQL diretto su Linear e crea issue + label mancanti dal CSV `docs/linear-import-open.linear.csv`.

3. Nei prompt:
- `Linear API key`: usa la tua API key personale (`Settings -> Account -> Security`)
- `Service`: scegli `Linear (CSV export)`
- `CSV file`: scegli uno dei file `docs/linear-import-open.*.linear.csv`
- `Create new team`: `No` (se il team MediFlow esiste gia)
- `Import into team`: `MediFlow`
- `Import to a specific project`: `Yes`
- `Import into project`: seleziona il project coerente col file (es. `MF-CORE-Q2`)

4. Ripeti il punto 2 per ciascun file progetto.

Nota:
- Il package crea issue, stati, label e (se presenti) assignee.
- L'import e pensato per issue aperte (`Status: Backlog` nel seed corrente).

---

## Struttura consigliata su Linear

## Initiatives (macro)

- `MediFlow v0.4 Hardening`
- `Parity Web <-> macOS`
- `Terminology + FSE 2.0`

## Projects (execution)

- `MF-CORE-Q2` (guardrail, auth, audit, integrita)
- `MF-PARITY-Q2` (P0b->P6 da PLANS/parity-matrix)
- `MF-FSE-Q2` (terminologie + validazioni documentali)

## Label groups

- `Area`: `security`, `api-v1`, `native`, `parity`, `terminology`, `backup`, `ai-insight`
- `Type`: `feature`, `bug`, `adr`, `docs`, `tech-debt`
- `Track`: `v0.4`, `parity-sweep`, `fse`

---

## Convenzioni obbligatorie (Linear <-> GitHub <-> Codex)

## Branch naming

Formato:

```text
codex/<issue-id>-<slug>
```

Esempio:

```text
codex/mf-123-ai-insight-source-hierarchy
```

## Commit naming

Includi sempre issue ID:

```text
feat(ai): enforce source hierarchy for insight generation [MF-123]
```

## PR title/body

Titolo:

```text
[MF-123] Enforce AI insight source hierarchy
```

Body:

```text
Fixes MF-123
Refs MF-120
```

Questo collega automaticamente PR e issue, e puo aggiornare lo stato in Linear.

---

## Template Issue (copia/incolla)

```md
## Context
Perche questa attivita e necessaria adesso.

## Problem
Comportamento attuale vs comportamento atteso.

## Scope
- In scope:
- Out of scope:

## Acceptance Criteria
1. ...
2. ...
3. ...

## Verification
- Manuale:
- Test automatici:
- Non verificato:

## Docs/Decisioni coinvolte
- ARCHITECTURE.md / SECURITY.md / PLANS.md / ADR ...
```

## Regola ADR

Se la issue cambia architettura, sicurezza, contratti `/api/v1`, cifratura o networking locale:
- apri o aggiorna ADR prima dell'implementazione.

---

## Routine operativa (solo)

## Triage giornaliero (10-15 min)

1. Tutte le idee nuove entrano in `Triage`.
2. Trasforma in issue piccole con acceptance criteria.
3. Sposta in `Backlog` o `Planned`.

## Planning ciclo (30 min/settimana)

1. Seleziona max 3-5 issue prioritarie.
2. Assegna `priority`, `labels`, `project`, `cycle`.
3. Definisci WIP limit personale: max 2 issue `In Progress`.

## Esecuzione con Codex

Per ogni issue:

1. Apri task Codex citando issue ID e file canonici.
2. Codex lavora su branch dedicato.
3. PR con `Fixes <ISSUE-ID>`.
4. Merge -> verifica stato Linear -> commento finale con esito test.

---

## Tracciabilita e audit trail

Per ricostruire una decisione in 60 secondi:

1. Apri issue Linear.
2. Segui link a PR/commit.
3. Apri file ADR/PLANS toccati nel merge.
4. Leggi sezione verification nel commento finale.

Se manca uno di questi 4 link, il lavoro non e completamente auditabile.

---

## Bootstrapping immediato MediFlow (da fare ora)

1. Crea su Linear le 3 initiatives sopra.
2. Crea i 3 projects (`MF-CORE-Q2`, `MF-PARITY-Q2`, `MF-FSE-Q2`).
3. Genera e importa i CSV compatibili (`npm run linear:prepare-import` + `npx -y @linear/import`).
4. Parti dalla prima wave:
   - `P0b.c` parity strict run in VM
   - `P2` esenzioni native
   - `P3` osservazioni native
5. Ogni issue nuova deve avere acceptance criteria prima di passare a `In Progress`.
