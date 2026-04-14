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

### Charter operativo: chi decide cosa

Leonardo mantiene ownership su priorita, direzione architetturale e approvazione finale.
Codex, salvo override esplicito dell'utente, gestisce invece la meccanica operativa
del delivery:

- apertura/switch branch
- cadenza e taglio dei commit
- timing dei push
- apertura e manutenzione della PR
- riallineamento Linear su stato, link e verifica

Obiettivo: togliere micro-decisioni ripetitive dal loop quotidiano e far si che
ogni workstream abbia in automatico un audit trail coerente.

### Rails di progettazione del workflow

Queste regole prendono spunto anche dalle linee guida OpenAI sugli agent:
modular ownership, tool boundaries chiare, guardrail prima dei side effect e
tracciabilita by default.

Riferimenti utili:

- [Agents SDK: choose your starting point](https://developers.openai.com/api/docs/guides/agents#choose-your-starting-point)
- [Orchestration and handoffs](https://developers.openai.com/api/docs/guides/agents/orchestration)
- [Guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
- [Using tools in the Agents SDK](https://developers.openai.com/api/docs/guides/tools#usage-in-the-agents-sdk)
- [Tracing](https://developers.openai.com/api/docs/guides/agents/integrations-observability#tracing)
- [Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)

Traduzione pratica per MediFlow:

1. **Ownership modulare**
   Un issue = un obiettivo operativo chiaro. Un branch = un issue o un solo
   slice davvero coeso.
2. **Non splittare troppo presto**
   Nuovi branch / nuove issue solo quando cambiano davvero contratto, policy,
   rischio o ownership del lavoro. Se il lavoro resta un unico racconto
   reviewable, rimane nello stesso branch.
3. **Guardrail prima dei side effect**
   Merge, azioni distruttive Git, update di stato finali su Linear e operazioni
   che chiudono un capitolo richiedono prima scope check, verifica e contesto
   scritto.
4. **Trace before optimize**
   Prima si rende il lavoro ricostruibile (issue, branch, PR, verifica), poi si
   ottimizza la velocita del loop.

### Branch naming

Formato:

```text
codex/<issue-id>-<slug>
```

Esempio:

```text
codex/mf-123-ai-insight-source-hierarchy
```

### Commit naming

Includi sempre issue ID:

```text
feat(ai): enforce source hierarchy for insight generation [MF-123]
```

### PR title/body

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

### Politica operativa workstream -> branch -> PR

#### 1) Unita minima di lavoro

Default:

- ogni lavoro non banale parte da una issue Linear
- ogni issue attiva ha il suo branch dedicato
- ogni branch punta a una sola PR

Eccezioni ammesse:

- typo minori
- micro-fix documentali non decisionali
- housekeeping locale senza impatto su comportamento, contratto o processo

Se la modifica tocca behavior, API, sicurezza, docs canoniche, UX, ADR o tooling,
non trattarla come eccezione: crea o identifica una issue.

#### 2) Lifecycle del branch

Appena l'issue e pronta per execution:

1. sposta la issue in `In Progress`
2. crea branch `codex/<issue-id>-<slug>`
3. verifica che il working tree sia pulito o compatibile con il tema
4. lavora solo su quel perimetro

Stop immediato e split se:

- compaiono file non correlati al tema
- il diff supera ~300 LOC con piu preoccupazioni insieme
- emergono due acceptance criteria indipendenti
- serve una ADR separata per una sola parte del lavoro
- il branch non e piu riassumibile in un unico titolo di PR

#### 3) Politica commit

Regole:

- un commit = un passo logico leggibile
- ogni commit deve poter essere spiegato in 1-3 frasi
- ogni commit deve includere l'issue ID
- niente commit miscuglio codice + refactor + docs non necessari
- niente messaggi `wip`, `fix stuff`, `misc`, `temp`

Buona euristica:

- commit quando il slice e coerente e auto-rivedibile
- non aspettare per forza la fine di tutto il branch
- ma non committare stati rotti solo per ansia di checkpoint

Checkpoint locali:

- se serve un paracadute durante una modifica rischiosa, e accettabile creare
  un commit temporaneo locale
- prima della PR, quei commit vanno ripuliti con squash/reword se degradano la
  leggibilita della storia

#### 4) Politica push

Push non significa "ho finito"; significa "esiste un checkpoint recuperabile".

Codex deve fare push:

- dopo il primo checkpoint stabile della branch
- prima di un cambio di contesto o fine sessione
- prima di aprire o aggiornare una PR per review
- prima di interventi rischiosi che sarebbe costoso ricostruire

Codex non deve accumulare lavoro locale non pushato per troppo tempo.
Regola pratica: niente branch viva per piu di una sessione seria senza almeno un
push coerente.

Se il branch e volutamente incompleto:

- push ammesso, ma la PR deve essere `Draft`
- Linear o la PR devono rendere esplicito che il lavoro non e ancora review-ready

#### 5) Politica PR

Apri una PR `Draft` quando vale almeno una di queste condizioni:

- il branch vivra per piu di una sessione
- ci sono gia piu commit utili da leggere
- il lavoro tocca aree rischiose o canoniche
- vuoi visibilita precoce su scope, docs o ADR

Promuovi la PR a review-ready solo quando:

- il branch ha uno scope coerente e difendibile
- i check minimi pertinenti sono stati eseguiti
- la body documenta:
  - `Fixes <ISSUE-ID>`
  - contesto e scope
  - verifica eseguita / non eseguita
  - eventuale ADR o `no contract impact`

#### 6) Politica merge e chiusura

Default consigliato: **squash merge** per mantenere `main` pulita e leggibile.

Eccezione:

- mantieni commit multipli solo se la struttura dei commit aggiunge reale valore
  di archeologia tecnica o decisionale

Prima di chiudere il workstream:

1. esegui scope check: `git diff --name-only main..HEAD`
2. verifica che i file tocchino un solo tema dichiarato
3. riallinea docs/ADR/OpenAPI se richiesto
4. aggiorna PR e Linear con cosa e stato verificato
5. solo dopo merge, porta la issue a `Done`

#### 7) Politica di tracciabilita minima su Linear

Ogni issue attiva dovrebbe rendere ricostruibili almeno questi punti:

- perche esiste il lavoro
- qual e lo scope
- qual e il branch o la PR associata
- cosa e stato verificato
- cosa non e stato verificato
- quale follow-up resta aperto, se esiste

Stati consigliati:

- `Triage`: idea ancora grezza
- `Backlog`: valida ma non attiva
- `Planned`: candidata al ciclo corrente
- `In Progress`: branch aperto e lavoro in corso
- `In Review`: PR aperta e scope stabilizzato
- `Done`: merge completato e verifica riportata
- `Canceled`: lavoro esplicitamente abbandonato

#### 8) Regola d'oro per Codex

Non aprire nuovi capitoli dentro un capitolo gia aperto.

Se cambia davvero il lavoro, si cambia anche contenitore:

- nuova issue
- nuovo branch
- nuova PR
- spesso nuova conversazione Codex

Questo e il modo piu semplice per tenere il repo igienico senza rallentare il
delivery.

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
