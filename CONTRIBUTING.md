# Contribuire a MediFlow

Grazie per l'interesse in MediFlow.
Qui si lavora su **dati sanitari**: privacy e sicurezza non sono opzionali.

---

## Regole base (non negoziabili)

- **Nessun PHI/PII nel repository.**
  Non committare dati reali di pazienti, screenshot, log, database esportati o campioni "anonimizzati ma reversibili".
- **Local-first di default.**
  Non introdurre egress cloud (telemetria, chiamate AI remote, sync) se non richiesto esplicitamente e documentato.
- Preferisci **diff piccoli e revisionabili**. Evita refactor ampi "per pulizia".

Se vuoi cambiare confini di sicurezza, scrivi prima un ADR (vedi sotto).

---

## Prerequisiti

- Node.js **v20+** consigliato
- npm (incluso con Node)
- Docker Desktop (opzionale, per API ICD-11)
- Ollama (opzionale, per AI/OCR locale)

---

## Getting started

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow
npm install
```

### Avvio (stack locale completo consigliato)

```bash
./Start_MediFlow.command
```

Poi apri: `http://localhost:3000`

### Avvio (solo web)

```bash
npm run dev
```

### Lint / Build

```bash
npm run lint
npm run build
```

Per visualizzare anche warning non bloccanti:

```bash
npm run lint:full
```

### Type checking (consigliato)

Questo repository non espone ancora uno script dedicato; puoi eseguire:

```bash
npx tsc --noEmit
```

### Contract guard OpenAPI

Per verificare drift e breaking change non autorizzati sulla superficie `/api/v1`:

```bash
npm run check:openapi:drift
```

### Test concorrenza pazienti

Per verificare i conflitti cross-client su `patients.version`:

```bash
npm run test:concurrency:patients
```

Runbook: [docs/patient-concurrency-tests.md](./docs/patient-concurrency-tests.md)

---

## Mappa progetto

- Web app: `app/`, `components/`
- API locali (web): `app/api/*`
- Native API (versionata): `app/api/v1/*`
- Facade dati/cifratura (client-side): `lib/db.ts`, `lib/security.ts`
- Layer DB server (SQLite + Drizzle): `lib/db-server.ts`, `lib/schema.ts`
- Migrazioni: `drizzle/`
- Client nativo macOS: `native/`
- Script: `scripts/`

Documentazione tecnica:
- [docs/README.md](./docs/README.md) (mappa canonica documentazione)
- [docs/markdown-index.md](./docs/markdown-index.md) (inventario completo markdown)
- [docs/walkthrough.md](./docs/walkthrough.md)
- [docs/system_architecture.md](./docs/system_architecture.md)
- [docs/ARCHITETTURA.md](./docs/ARCHITETTURA.md)

---

## Modifiche database (Drizzle / SQLite)

Fonti autorevoli:
- Schema: `lib/schema.ts`
- Migrazioni: `drizzle/`

Linee guida:
- Preferisci **migrazioni esplicite** invece di patch schema runtime.
- Se aggiungi/rinomini colonne, verifica sempre:
  - coerenza schema + migrazione
  - route API in lettura/scrittura sui nuovi campi
  - interfacce client (`lib/db.ts`) allineate

> Nota: la repo usa `drizzle.config.ts` (SQLite file nella directory dati di MediFlow).
> Se hai dubbi sui comandi drizzle-kit, consulta la documentazione Drizzle ORM.

---

## Modifiche API

### Regole di autenticazione

- Endpoint web (`/api/*`) devono richiedere sessione valida.
- Endpoint native (`/api/v1/*`) devono richiedere token API locale e restare versionati.

Se aggiungi un nuovo endpoint:
- documentalo (almeno nella descrizione PR)
- evita leakage di campi cifrati nei log
- mantieni contratti stabili per i client native

Per `/api/v1/*` vale ADR 0010 (`spec-first` OpenAPI):
- ogni PR con impatto contrattuale deve aggiornare la spec OpenAPI nello stesso diff
  oppure dichiarare esplicitamente `no contract impact`
- cambi breaking o deprecazioni richiedono ADR/update ADR prima del merge e non
  vanno introdotti come modifica silenziosa a `v1`
- il guard automatico usa `docs/openapi/contract-policy.json` per distinguere
  endpoint gia documentati, endpoint implementati ma fuori slice stabile e
  override breaking tracciati

Se cambi la concorrenza ottimistica dei pazienti (`patients.version`, compare-on-write,
payload `409 VERSION_CONFLICT`), esegui anche:

```bash
npm run test:concurrency:patients
```

---

## Processo ADR (obbligatorio per cambi non banali)

Gli ADR stanno in: `docs/adr/`

Scrivi un ADR quando cambi:
- modello di cifratura / key derivation / flow PIN
- confini auth/session
- contratti native API
- discovery locale / networking
- qualsiasi aspetto con impatto architetturale di lungo periodo

Template: `docs/adr/0000-template.md`

---

## Definition of Done (per PR)

Una PR è considerata conclusa quando:

- `npm run lint` passa
- `npm run build` passa
- (consigliato) `npx tsc --noEmit` passa
- se cambi `/api/v1/*`, `npm run check:openapi:drift` passa
- se cambi la concorrenza pazienti o i write path `/api/patients/*` / `/api/v1/patients/*`, `npm run test:concurrency:patients` passa
- Nessun PHI/PII introdotto in repo, fixture, log o screenshot
- Se una feature è user-facing e interagibile, deve avere una UI/UX esplicita e coerente
  (CTA/pulsante, label comprensibile, percorso utente verificabile).
- Se cambia `/api/v1/*`, la documentazione contrattuale (spec OpenAPI o nota esplicita
  `no contract impact`) deve stare nello stesso diff.
- Se cambiano comportamenti/contratti, documentazione aggiornata:
  - README / ARCHITECTURE / ADR (quando appropriato)
- Se aggiungi/rimuovi/rinomini `.md`, aggiorna anche:
  - `docs/README.md` (se cambia ownership o priorità)
  - `docs/markdown-index.md` (lista + sintesi file)

---

## Attribution (Codex / agent)

Questo progetto traccia il codice generato da agent.

Se il codice è scritto principalmente da Codex, marcature richieste:

- Blocco: `/* @Codex */`
- Riga: `// @Codex`

Per aggiunte non banali, aggiungi una entry in `docs/agent-attribution.md`.

---

## Come contribuire (workflow)

- Apri una issue (bug / feature / discussione).
- Proponi un piano piccolo (cosa cambia, file toccati, come verificare).
- Invia una PR con:
  - diff piccolo
  - descrizione chiara
  - note di verifica (comandi eseguiti)

Se qualcosa non è chiaro, leggi prima la documentazione e poi fai **una domanda mirata**.

---

## Export OSS (repo pubblica)

Per preparare la versione pubblica filtrata:

```bash
npm run prepare:oss
```

Note operative:
- lo script copia la repo privata verso la destinazione OSS (`medical-record-app-oss` di default)
- esclude file/cartelle interni (es. orchestrazione agentica)
- declassa i link markdown verso file non presenti in OSS con suffix ` (private)` per evitare reference rotte

Destinazione custom (utile per dry-run):

```bash
MEDIFLOW_OSS_TARGET_DIR=/tmp/medical-record-app-oss-test npm run prepare:oss
```
