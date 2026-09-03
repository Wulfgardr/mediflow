# Contribuire a MediFlow

Grazie per l'interesse in MediFlow.
Qui si lavora su **dati sanitari**: privacy e sicurezza non sono opzionali.

---

## ⚠️ Regole base (non negoziabili)

- **Nessun PHI/PII nel repository.**
  Non committare dati reali di pazienti, screenshot, log, database esportati o campioni "anonimizzati ma reversibili".
- **Local-first di default.**
  Non introdurre egress cloud (telemetria, chiamate AI remote, sync) se non richiesto esplicitamente e documentato.
- Preferisci **diff piccoli e revisionabili**. Evita refactor ampi "per pulizia".

> [!IMPORTANT]
> Se vuoi cambiare confini di sicurezza, scrivi prima un ADR (vedi sotto).

## Repository e consegna

La repository pubblica
[`Wulfgardr/mediflow`](https://github.com/Wulfgardr/mediflow) è l'unica fonte
operativa. Issue, branch, pull request, tag e release devono nascere qui; la
precedente repository privata è archiviata e non va usata come mirror o
destinazione di export. Dati e artifact sensibili restano fuori da Git secondo
[`SECURITY.md`](./SECURITY.md) e
[`docs/repository-topology.md`](./docs/repository-topology.md).

---

## ⚙️ Prerequisiti

- Node.js **24.x**, come fissato da `.nvmrc` e `package.json`
- npm (incluso con Node)
- Ollama (opzionale, per Patient Insight, Smart Import e Document Synthesis)
- Apple Silicon, artifact locale ATHENA e toolchain MLX (opzionali, solo per
  Treatment Reasoning)

Nota documentale 0.8.5: AnyDoc resta il primo passaggio automatico locale. Il
tree include routing, manifest, materializzazione e rendering delle sole pagine
`needsOcr`, quindi usa Apple Vision localmente sul Mac e ricompone il risultato
sotto currentness host-owned. DeepSeek-OCR 2/CUDA è
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`; il tree ne conserva soltanto contratto e
seam sintetiche. Le route OCR legacy rispondono `410` dopo l'autenticazione.

Nota ATHENA 0.8.5: Treatment Reasoning è incluso solo con artifact del modello
e runner MLX locali configurati. L'override host-owned
`MEDIFLOW_ATHENA_MLX_GENERATE_BIN` accetta soltanto il percorso assoluto di un
eseguibile `mlx_lm.generate`, senza argomenti o shell. Senza override, `uvx`
resta offline e fallisce chiuso quando la cache richiesta non è già presente.
La disponibilità del runner non prova readiness universale.

---

## 🧑‍💻 Getting started

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow
nvm use
npm ci
```

### Avvio (stack web locale consigliato)

```bash
./Start_MediFlow.command
```

Poi apri: `http://localhost:3000`

`Start_MediFlow.command` avvia la web app e i servizi locali opzionali; il client macOS resta su launcher separato (`./scripts/Launch_MediFlowMac.command`).

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

Questo repository espone uno script dedicato:

```bash
npm run typecheck
```

### Contract guard OpenAPI

Per verificare drift e breaking change non autorizzati sulla superficie `/api/v1`:

```bash
npm run check:openapi:drift
```

### Never-regress guard

Per bloccare regressioni sui guardrail minimi di sicurezza:

```bash
npm run check:never-regress
```

Il guard fallisce se trova:
- credenziali di default hardcoded nel runtime
- endpoint runtime non locali o attivazione implicita della telemetria
- rotture delle invarianti zero-knowledge minime

### Claims guard

Per bloccare claim di prodotto fuori scope (autonomia clinica AI, auto-apply
senza review, integrazione regionale SISS/FSE, cloud di default, cifratura
whole-database, claim FHIR non qualificati, garanzie GDPR, topologia single-device e
codifica ICD obbligatoria), ancorati all'ADR 0065:

```bash
npm run check:claims
```

### Monitor del workflow

Il monitor valuta i metadati Git e le verifiche dichiarate per la branch corrente.

```bash
npm run workflow-monitor -- --check=focused=pass --persist-checks
npm run workflow-monitor
npm run workflow-monitor -- clear-checks
```

Il primo comando salva le verifiche per la branch e lo SHA esatti. Il sidecar resta fuori da Git in `~/.codex/state/mediflow-workflow-monitor/checks.json`.

Il monitor riusa il sidecar solo con worktree pulito, branch invariata e SHA invariato. Usa `--no-persisted-checks` per ignorare il sidecar.

Il monitor registra gli esiti dichiarati, ma non esegue i check. Conserva gli output dei check come prova separata.

Il monitor non stampa il diff o i percorsi modificati. Restituisce `blocked` quando il diff contiene un percorso protetto.

Il monitor non esegue `git fetch`. Aggiorna `origin/main` prima di usare il conteggio `behind` come evidenza corrente.

La CI e il controller restano le autorita per il merge.

### Test concorrenza pazienti

Per verificare i conflitti cross-client su `patients.version`:

```bash
npm run test:concurrency:patients
```

### Test import documentale nuova anagrafica

Per verificare la lane di review documentale nel create-flow paziente:

```bash
npm run test:patient-document-import
```

Usalo quando tocchi:
- `components/pdf-importer.tsx`
- `components/patient-document-import-review.tsx`
- `lib/patient-document-import-service.ts`
- `lib/patient-document-review.ts`
- la persistenza prudente delle terapie nel create-flow

### Test document intelligence / parse-evidence

Per verificare la first slice runtime del `document evidence ledger`:

```bash
npm run test:document-synthesis
npm run test:ai-context
npm run test:pdf-service
npm run check:anydoc-local-only
npm run test:anydoc-local-only
```

Usalo quando tocchi:
- `lib/domain/documents/document-synthesis-service.ts`
- `lib/domain/documents/document-parse-evidence-artifact.ts`
- `lib/ai-context.ts`
- `lib/domain/documents/anydoc-*`
- `lib/domain/documents/ocr-service.ts` e le route OCR legacy fail-closed
- `components/document-upload.tsx`
- `app/api/attachments/route.ts`
- la persistenza/lettura di `summarySnapshot` o `parseEvidenceArtifactSnapshot`

Se tocchi il confine OCR della 0.8.5, preserva AnyDoc come primo passaggio e
ammetti alla lane successiva soltanto pagine `needsOcr`. Routing, manifest,
materializzazione, rendering e preflight devono restare bounded e fail-closed;
le route legacy autenticate restano `410`. AnyDoc non è un provider o una venue
Fabric.

Il preflight DeepSeek-OCR 2 usa un fake seam. Non presentarlo come runtime
adapter, esecuzione live o readiness. Una promozione futura richiede adapter,
benchmark sintetico italiano, soglie dichiarate ed E2E, con provenienza, hash e
qualità per pagina e nessun egress implicito.

### Verifica del crosswalk Fabric 0.8.5

Se tocchi uno dei quattro smart path, il production root, il wire contract o la
UI che mostra receipt e provenienza, esegui:

```bash
npm run check:fabric-generative-runtime-crosswalk
npm run test:fabric-generative-runtime-crosswalk
```

I quattro path sono Patient Insight, Smart Import, Document Synthesis e
Treatment Reasoning. Il caller non deve scegliere provider, modello, endpoint,
venue, prompt, fallback o apply. I production root host-owned devono mantenere
lo stadio massimo `proposal_only`.

### Gate del modello provider F7

Il modello provider v2, il secret broker e gli adapter HTTPS ufficiali OpenAI
e Anthropic sono integrati. I probe Document Synthesis restano review-only e
`default OFF`. Il contratto separa tipo e istanza del provider,
autenticazione, modello, capability, gruppi, binding e allowlist delle funzioni.
Le classi di credenziale sono:

- `local_model`;
- `api_key`;
- `provider_oauth`, soltanto tramite flusso ufficiale del provider;
- `host_subscription`, come classe distinta e non come accesso API implicito.

Un login consumer, un abbonamento ChatGPT/Claude o una subscription dell'host
non autorizzano inferenza API. La composizione production richiede lifecycle
attivo, opt-in host, egress/retention espliciti e secret reference. I test usano
transport fake: non dichiarare credenziali, rete live o readiness cloud. Non
copiare codice GPL né implementare OAuth privati, reverse-engineered o
dipendenti da sessioni consumer.

Mantieni inoltre separate le due modalità architetturali: un provider eseguito
dentro MediFlow e MediFlow invocato come servizio governato da un host
intelligente. Il Supervisor Node locale avvia Web standalone e MCP `stdio` come
figli distinti su IPC ereditato. MCP usa soltanto RPC AIP e Application Services
nominate, senza listener proprio o accesso diretto a SQLite. Mini condivide il
catalogo e la foundation CLI ma, senza un callsite production del Supervisor,
deve fallire chiuso in assenza del parent AIP. Mantieni
fuori dal claim installer, onboarding e compatibilità con host MCP esterni; non
introdurre broker residente o UDS nella `0.8.5`.

Per F10, MCP può creare soltanto la preview della transizione checkup. Mantieni
proof e commit nella UI Web trusted, con rilettura, ruolo medico attivo, step-up,
gesto operation-specific, currentness, CAS, idempotenza, audit e receipt. Non
concedere all'agente il proof o l'autorità di commit.

---

## 📚 Mappa progetto

- Web app: `app/`, `components/`
- API locali (web): `app/api/*`
- Native API (versionata): `app/api/v1/*`
- Facade dati/cifratura (client-side): `lib/db.ts`, `lib/security.ts`
- Layer DB server (SQLite + Drizzle): `lib/db-server.ts`, `lib/schema.ts`
- Migrazioni: `drizzle/`
- Client nativo macOS: `native/`
- Script: `scripts/`
- Guard revisione shell locale: `lib/app-revision.ts`, `app/api/system/revision/route.ts`, `components/app-revision-guard.tsx`, `Start_MediFlow.command`

Documentazione tecnica:
- [docs/STATE_OF_THE_SYSTEM.md](./docs/STATE_OF_THE_SYSTEM.md) (lettura completa dello stato corrente)
- [docs/README.md](./docs/README.md) (mappa canonica documentazione)
- [docs/markdown-index.md](./docs/markdown-index.md) (inventario completo markdown)
- [docs/walkthrough.md](./docs/walkthrough.md)
- [docs/system_architecture.md](./docs/system_architecture.md)
- [docs/ARCHITETTURA.md](./docs/ARCHITETTURA.md)

---

## 🗄️ Modifiche database (Drizzle / SQLite)

Le schema guard additive di `lib/db-server.ts` sono serializzate con una
transazione SQLite `IMMEDIATE` nel runtime dev/server. Durante la sola fase
`NEXT_PHASE=phase-production-build`, la raccolta dei metadati Next usa invece
SQLite in-memory e non apre, copia, recupera o migra il database clinico
persistente. Non introdurre side effect persistenti durante la build, né guard
runtime che aprono una seconda connessione o aggirano la transazione. Le
regressioni dedicate sono
`lib/db-server-attachment-currentness-bootstrap.test.ts` e
`npm run test:db-bootstrap-concurrency`; usano soltanto database temporanei
sintetici.

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

## 🔌 Modifiche API

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

Se cambi `/api/v1/network/*`, `lib/network-*` o il boundary pairing/sessione
home-base, esegui anche:

```bash
npm run test:network:home-base-readonly
npm run test:network:home-base-write
npm run test:network:home-base-diary-write
```

---

## 🧱 Processo ADR (obbligatorio per cambi non banali)

Gli ADR stanno in: `docs/adr/`

Scrivi un ADR quando cambi:
- modello di cifratura / key derivation / flow PIN
- confini auth/session
- contratti native API
- discovery locale / networking
- qualsiasi aspetto con impatto architetturale di lungo periodo

Template: `docs/adr/0000-template.md`

---

## ✅ Definition of Done (per PR)

Una PR è considerata conclusa quando:

- `npm run lint` passa
- `npm run build` passa
- (consigliato) `npm run typecheck` passa
- `npm run check:never-regress` passa
- `npm run check:claims` passa
- se cambi `/api/v1/*`, `npm run check:openapi:drift` passa
- se cambi la concorrenza pazienti o i write path `/api/patients/*` / `/api/v1/patients/*`, `npm run test:concurrency:patients` passa
- se cambi il create-flow da documento della nuova anagrafica, `npm run test:patient-document-import` passa
- se cambi un path Fabric 0.8.5, il check e il test del crosswalk generativo
  passano
- se cambi l'estrazione degli allegati, i check AnyDoc local-only passano,
  Apple Vision riceve soltanto le pagine PDF `needsOcr`, gli input non
  supportati falliscono chiusi e le route OCR legacy autenticate restano `410`
- se cambi Headless, AIP, MCP o Mini, esegui
  `npm run check:headless-portable-imports`,
  `npm run test:headless-portable`,
  `npm run test:mcp:intelligent-host` e `npm run test:mini-cli`
- se cambi un provider cloud, tipo, istanza, auth, modello, capability, gruppi,
  binding, allowlist e classi di credenziale restano separati; il default resta
  OFF e i test non richiedono credenziali live
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

## 🧭 Come contribuire (workflow)

- Apri una issue (bug / feature / discussione).
- Proponi un piano piccolo (cosa cambia, file toccati, come verificare).
- Invia una PR con:
  - diff piccolo
  - descrizione chiara
  - note di verifica (comandi eseguiti)

Se qualcosa non è chiaro, leggi prima la documentazione e poi fai **una domanda mirata**.

---
