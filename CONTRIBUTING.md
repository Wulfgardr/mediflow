# Contribuire a MediFlow

Grazie per l'interesse in MediFlow. Questo progetto gestisce **dati sanitari**, quindi
ogni contributo deve rispettare vincoli rigorosi di privacy e sicurezza.

---

## Regole base (non negoziabili)

- **Nessun PHI/PII nel repository.**
  Non committare dati reali di pazienti, screenshot, log, database esportati o campioni "anonimizzati ma reversibili".
- **Local-first di default.**
  Non introdurre egress cloud (telemetria, chiamate AI remote, sync) se non richiesto esplicitamente e documentato.
- Preferisci **diff piccoli e revisionabili**. Evita grandi refactor "per pulizia".

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

### Type checking (consigliato)

Questo repository non espone ancora uno script dedicato; puoi eseguire:

```bash
npx tsc --noEmit
```

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

Documentazione tecnica approfondita:
- `docs/walkthrough.md`
- `docs/system_architecture.md`
- `docs/ARCHITETTURA.md`

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

> Tip: la repo usa `drizzle.config.ts` (SQLite file nella directory dati di MediFlow).
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
- Nessun PHI/PII introdotto in repo, fixture, log o screenshot
- Se cambiano comportamenti/contratti, documentazione aggiornata:
  - README / ARCHITECTURE / ADR (quando appropriato)

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
