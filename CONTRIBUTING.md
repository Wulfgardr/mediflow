# Contribuire a MediFlow

Contribuire a MediFlow significa lavorare su un gestionale che tratta
**dati sanitari**. Privacy e sicurezza non sono quindi aspetti da aggiungere
alla fine: orientano il cambiamento, i materiali usati per provarlo e il modo
in cui lo si consegna.

---

## ⚠️ Regole base (non negoziabili)

- **Nessun PHI/PII nel repository.**
  Non committare dati reali di pazienti, screenshot, log, database esportati
  o campioni "anonimizzati ma reversibili".
- **Local-first di default.**
  Non introdurre invii al cloud — telemetria, chiamate AI remote o sincronizzazione —
  se non siano richiesti esplicitamente e documentati.
- Preferisci **diff piccoli e revisionabili**, nei quali sia riconoscibile
  lo scopo del cambiamento. Evita refactor ampi "per pulizia".

> [!IMPORTANT]
> Per cambiare i confini di sicurezza, scrivi prima un ADR (vedi sotto).

## Repository e consegna

Il lavoro confluisce nella repository pubblica
[`Wulfgardr/mediflow`](https://github.com/Wulfgardr/mediflow), unica sede
operativa: issue, branch, pull request, tag e release devono nascere qui.
La precedente repository privata è archiviata e non va usata come mirror o
destinazione di export. Questo non cambia il confine dei dati: dati e artefatti
sensibili restano fuori da Git, secondo
[`SECURITY.md`](./SECURITY.md) e
[`docs/repository-topology.md`](./docs/repository-topology.md).

---

## ⚙️ Prerequisiti

- Node.js **24.x**, come fissato da `.nvmrc` e `package.json`
- npm (incluso con Node)
- Ollama (opzionale, per Patient Insight, Smart Import e Document Synthesis)
- Apple Silicon, artifact locale ATHENA e toolchain MLX (opzionali, solo per
  Treatment Reasoning)

Per eseguire `scripts/run-strip-types.mjs --test`, anche tramite npm,
impostare `MEDIFLOW_DATA_DIR` su una directory sintetica posseduta dal run;
pulirla solo dopo la fine dei processi figli. Se il valore è assente o vuoto,
il launcher termina prima del target con `MEDIFLOW_TEST_DATA_DIR_REQUIRED`
(ADR 0130). Non usare la directory dati reale dell'applicazione: un import
statico può aprire il DB prima che intervengano gli hook della fixture.
Il launcher conserva il percorso esplicito, ma non ne gestisce la pulizia.

Nel perimetro documentato per la 0.8.5, AnyDoc è il primo passaggio automatico
locale. Il codice comprende instradamento, manifest, materializzazione e
rendering delle sole pagine `needsOcr`, che vengono elaborate con Apple Vision
sul Mac; il risultato è poi ricomposto sotto il controllo dell'host sulla
validità corrente delle fonti. DeepSeek-OCR 2/CUDA resta
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`: ne sono presenti soltanto il contratto
e i punti di raccordo sintetici. Le route OCR legacy rispondono `410` dopo
l'autenticazione.

Per ATHENA, il perimetro 0.8.5 include Treatment Reasoning solo quando siano
configurati localmente sia l'artefatto del modello sia il runner MLX.
L'override controllato dall'host `MEDIFLOW_ATHENA_MLX_GENERATE_BIN` accetta
soltanto il percorso assoluto di un eseguibile `mlx_lm.generate`, senza
argomenti o shell. In assenza di override, `uvx` resta offline e si arresta
se la cache richiesta non è già presente, senza cercare alternative.
La disponibilità del runner non dimostra che ogni configurazione sia pronta
all'uso.

---

<a id="-getting-started"></a>

## 🧑‍💻 Primi passi

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

`Start_MediFlow.command` avvia la web app con gli eventuali servizi locali
opzionali. Per avviare invece il client macOS si usa il launcher separato
`./scripts/Launch_MediFlowMac.command`: i due percorsi non coincidono.

### Avvio (solo web)

```bash
npm run dev
```

### Lint / Build

```bash
npm run lint
npm run build
```

Per includere nell'output anche gli avvisi non bloccanti:

```bash
npm run lint:full
```

<a id="type-checking-consigliato"></a>

### Controllo dei tipi (consigliato)

Per controllare i tipi senza confondere questo passaggio con la build,
usa lo script dedicato:

```bash
npm run typecheck
```

### Contract guard OpenAPI

Per rilevare divergenze dal contratto e modifiche incompatibili non
autorizzate sulla superficie `/api/v1`:

```bash
npm run check:openapi:drift
```

### Never-regress guard

Per impedire regressioni sui vincoli minimi di sicurezza:

```bash
npm run check:never-regress
```

Il controllo fallisce se trova:
- credenziali predefinite scritte direttamente nel runtime;
- endpoint runtime non locali o telemetria attivata implicitamente;
- violazioni delle invarianti zero-knowledge minime.

### Claims guard

Il controllo delle affermazioni di prodotto applica i limiti dell'ADR 0065:
blocca autonomia clinica AI, applicazione automatica senza revisione,
integrazione regionale SISS/FSE, cloud predefinito, cifratura dell'intero
database, affermazioni FHIR non qualificate, garanzie GDPR, topologia limitata
a un solo dispositivo e codifica ICD obbligatoria. Per eseguirlo:

```bash
npm run check:claims
```

### Monitor del workflow

Il monitor legge i metadati Git e le verifiche dichiarate per il branch
corrente, così che gli esiti restino associati al lavoro cui si riferiscono.

```bash
npm run workflow-monitor -- --check=focused=pass --persist-checks
npm run workflow-monitor
npm run workflow-monitor -- clear-checks
```

Il primo comando salva le verifiche per il branch e lo SHA esatti in un
file di supporto esterno a Git:
`~/.codex/state/mediflow-workflow-monitor/checks.json`.

Il file viene riusato solo con worktree pulito e branch e SHA invariati.
Per ignorare gli esiti salvati, usa `--no-persisted-checks`.

Poiché registra gli esiti dichiarati senza eseguire i controlli, il monitor
non sostituisce la prova: conserva separatamente gli output dei controlli.

Il monitor non stampa il diff né i percorsi modificati; quando il diff
contiene un percorso protetto, restituisce `blocked`.

Il conteggio di arretramento dipende dai riferimenti locali, perché il
monitor non esegue `git fetch`. Aggiorna quindi `origin/main` prima di usare
`behind` come evidenza corrente.

L'autorità sul merge resta alla CI e al controller.

### Test concorrenza pazienti

Per verificare come vengono gestiti i conflitti fra client su
`patients.version`:

```bash
npm run test:concurrency:patients
```

### Test import documentale nuova anagrafica

Per verificare la revisione dei dati estratti da un documento durante
la creazione dell'anagrafica paziente:

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

Per verificare la prima parte implementata del registro delle evidenze
documentali, il `document evidence ledger`:

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

Se modifichi il confine OCR della 0.8.5, conserva AnyDoc come primo passaggio:
solo le pagine `needsOcr` possono accedere all'elaborazione successiva.
Instradamento, manifest, materializzazione, rendering e controllo preliminare
devono rispettare i limiti previsti e arrestarsi quando i requisiti mancano,
senza percorsi alternativi impliciti; le route legacy autenticate restano
`410`. AnyDoc non è un provider né una sede di esecuzione Fabric.

Il controllo preliminare DeepSeek-OCR 2 usa un raccordo simulato e non va
presentato come adapter runtime, esecuzione reale o prova di disponibilità.
Per una futura promozione servono adapter, benchmark sintetico italiano,
soglie dichiarate ed E2E, con provenienza, hash e qualità per pagina,
senza alcun invio implicito all'esterno.

### Verifica del crosswalk Fabric 0.8.5

Esegui i controlli seguenti quando modifichi uno dei quattro percorsi
intelligenti, il punto di composizione production, il contratto di scambio
o la UI che mostra ricevute e provenienza:

```bash
npm run check:fabric-generative-runtime-crosswalk
npm run test:fabric-generative-runtime-crosswalk
```

Patient Insight, Smart Import, Document Synthesis e Treatment Reasoning
sono i quattro percorsi interessati. La scelta resta governata dall'host:
il chiamante non deve scegliere provider, modello libero, endpoint, sede di
esecuzione, prompt, ripiego o applicazione del risultato. ADR 0129 ammette
soltanto un `modelOptionId` opaco del catalogo host, accompagnato da
`expectedCatalogRevision` e risolto nel servizio nominato
`FunctionModelDispatch`. Preferenze e preset non ammettono provider; per questo
confine esegui anche `npm run test:function-models`. I punti di composizione
production controllati dall'host devono mantenere lo stadio massimo
`proposal_only`: il risultato rimane una proposta.

### Gate del modello provider F7

Sono integrati il modello provider v2, il secret broker e gli adapter HTTPS
ufficiali OpenAI e Anthropic, ma le prove amministrative Document Synthesis
restano soggette a revisione e `default OFF`. Il contratto tiene distinti tipo
e istanza del provider, autenticazione, modello, capability, gruppi, binding
e allowlist delle funzioni, perché la presenza di un componente non gli
attribuisca automaticamente ogni possibilità di accesso. Le classi di
credenziale sono:

- `local_model`;
- `api_key`;
- `provider_oauth`, soltanto tramite flusso ufficiale del provider;
- `host_subscription`, come classe distinta e non come accesso API implicito.

Un login consumer, un abbonamento ChatGPT/Claude o una subscription dell'host
non autorizzano inferenza API. La composizione production richiede invece
ciclo di vita attivo, adesione esplicita dell'host, condizioni esplicite di
invio e conservazione dei dati e riferimento al segreto. I test usano un
trasporto simulato: non dichiarare credenziali, rete reale o disponibilità
cloud verificata. Non copiare codice GPL né implementare OAuth privati,
ricostruiti tramite reverse engineering o dipendenti da sessioni consumer.

Mantieni distinta l'esecuzione di un provider dentro MediFlow dall'invocazione
di MediFlow come servizio governato da un host intelligente. Nel secondo caso,
il Supervisor Node locale avvia Web standalone e MCP `stdio` come processi
figli distinti su IPC ereditato; MCP usa soltanto RPC AIP e Application Services
nominate, senza listener proprio né accesso diretto a SQLite. La lane Mini
WUL-696 aggiunge `mini:production`, con Web e Mini figli, sessione NDJSON che
espone gli stessi comandi della CLI e attivazione Web obbligatoria. Mini deve
arrestarsi se manca il parent AIP. Non dichiarare installer, onboarding o
compatibilità con host MCP esterni e non introdurre broker residente o UDS
nella `0.8.5`.

Per F10, MCP può creare soltanto l'anteprima della transizione checkup.
La proof e il commit devono restare nella UI Web trusted: richiedono
rilettura, ruolo medico attivo, step-up, gesto specifico per l'operazione,
validità corrente dei dati, CAS, idempotenza, audit e ricevuta. Non concedere
all'agente la proof o l'autorità di commit.

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

Nel runtime dev/server, i controlli che aggiungono elementi allo schema di
`lib/db-server.ts` sono serializzati in una transazione SQLite `IMMEDIATE`.
La raccolta dei metadati Next durante la sola fase
`NEXT_PHASE=phase-production-build` usa invece SQLite in memoria: non apre,
copia, recupera o migra il database clinico persistente. Questa separazione
va conservata: non introdurre effetti persistenti durante la build né
controlli runtime che aprano una seconda connessione o aggirino la transazione.
Le regressioni dedicate,
`lib/db-server-attachment-currentness-bootstrap.test.ts` e
`npm run test:db-bootstrap-concurrency`, usano soltanto database temporanei
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
- documentalo, almeno nella descrizione della PR;
- evita che i campi cifrati finiscano nei log;
- conserva contratti stabili per i client nativi.

Per `/api/v1/*` vale ADR 0010 (`spec-first` OpenAPI):
- ogni PR con impatto contrattuale deve aggiornare la specifica OpenAPI nello
  stesso diff oppure dichiarare esplicitamente `no contract impact`;
- modifiche incompatibili e deprecazioni richiedono un ADR nuovo o aggiornato
  prima del merge e non vanno introdotte silenziosamente in `v1`;
- il controllo automatico usa `docs/openapi/contract-policy.json` per
  distinguere endpoint già documentati, endpoint implementati ma fuori dalla
  parte stabile e deroghe tracciate per modifiche incompatibili.

Se cambi la concorrenza ottimistica dei pazienti (`patients.version`, compare-on-write,
payload `409 VERSION_CONFLICT`), esegui anche:

```bash
npm run test:concurrency:patients
```

Se modifichi `/api/v1/network/*`, `lib/network-*` o il confine di pairing
e sessione della home-base, esegui anche:

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
- Per ogni modifica all'interfaccia, verificare sul percorso interessato che
  etichette, descrizioni, azioni e stati siano comprensibili a un medico senza
  conoscenze tecniche, secondo [DESIGN.md](./DESIGN.md#plain-language-for-physicians).
  Il medico deve capire significato, scelta richiesta e conseguenze senza una
  spiegazione dello sviluppatore; gergo non spiegato o azioni ambigue impediscono
  l'accettazione anche con test verdi.
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

Quando resta un dubbio, consulta prima la documentazione: formula poi
**una domanda mirata** sul punto che non chiarisce.

---
