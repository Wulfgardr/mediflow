---
summary: "Canonical broad snapshot of current MediFlow product state, runtime boundaries, data model, AI lanes, and integration limits."
read_when:
  - "Needing a single current-state overview before planning or implementation."
  - "Checking whether a feature, integration, or claim is shipped, directional, or out of bounds."
---

# Stato del Sistema MediFlow

> [!IMPORTANT]
> **Stato documento: CANONICAL (lettura completa dello stato corrente).**
> Questo documento e il punto di lettura piu ampio per capire cosa esiste oggi,
> cosa e solo direzione dichiarata e quali boundary non vanno superati.
>
> Per i principi stabili prevalgono sempre [ARCHITECTURE.md](../ARCHITECTURE.md)
> e [SECURITY.md](../SECURITY.md). Per il flusso operativo end-to-end prevale
> [docs/walkthrough.md](./walkthrough.md). Per la governance della repository
> prevalgono [AGENTS.md](../AGENTS.md) e
> [docs/repository-topology.md](./repository-topology.md).

Ultimo aggiornamento: 2026-09-02 (candidato sorgente locale v0.8.5)

> [!NOTE]
> Questo documento descrive il tree del candidato sorgente locale `0.8.5`.
> Non prova CI remota, tag, GitHub Release, distribuzione o release readiness.
> La release sorgente `0.8.2` resta l'ultimo checkpoint pubblicato descritto
> nello storico del [CHANGELOG](../CHANGELOG.md).

---

## 🧭 1. Lettura rapida

MediFlow e una cartella clinica local-first per il lavoro territoriale quotidiano.
Lo stato corrente non va letto come una semplice web app con AI aggiunta: e un
sistema locale ibrido in cui il Mac resta il nodo autorevole, il database e
SQLite locale con campi clinici sensibili cifrati lato client, la web app e la
superficie primaria, la family Apple/native cresce sopra contratti locali
versionati e ogni integrazione esterna resta dentro boundary documentati.

La fotografia corrente e questa:

- **Superficie primaria**: web app Next.js locale, avviata sul Mac.
- **Principio prodotto**: serve l'informazione giusta nel momento giusto.
  MediFlow è information-first, question-first e convenience-first, non
  AI-first. Resta utile quando ogni provider AI è disabilitato.
- **Shell ufficiale**: il cockpit resta la root web live, senza selector o
  preview profiles persistiti. Lume e il suo contratto DTCG sono attivi nel
  tree della release; Vetro Clinico resta la baseline storica e transitoria.
  La parity estetica completa non è dichiarata.
- **Storage autorevole**: un solo file SQLite locale (`medical.db`), con accesso
  server via Drizzle e cifratura client-side dei campi clinici sensibili.
- **Sicurezza di default**: local-only, campi clinici sensibili cifrati lato
  client, nessun cloud o telemetry default-on. Il claim pubblico non deve
  descrivere l'intero file SQLite come completamente zero-knowledge finché
  identificativi, metadati e backup non sono coperti dallo stesso perimetro
  verificato.
- **Repository operativa**: `Wulfgardr/mediflow` pubblica e l'unica fonte per
  sviluppo e release; la precedente repository privata e archiviata e gli
  artefatti sensibili restano fuori da Git.
- **Contratto condiviso**: `/api/v1/*` per client native/locali; OpenAPI come
  riferimento anti-drift per la parte stabile.
- **Home-base**: modalita opt-in in cui il Mac espone `/api/v1/network/*`
  verso client paired su rete fidata: lettura pazienti e write versionati
  limitati a profilo/status, diario, terapie, checkup e osservazioni. Quando la
  modalita e disattivata i pairing restano salvati ma i token dei client paired
  diventano inerti: il data plane risponde `403 NETWORK_MODE_DISABLED` finche
  la modalita non viene riattivata.
- **Apple/native**: macOS e il fronte nativo piu maturo. Il bundle Apple/home-base
  apre la shell condivisa, mostra readiness runtime locale e puo gestire
  esplicitamente backend web production e proxy TLS con stop bounded/escalation.
  `MediFlowCore` concentra logica portabile, cifratura, contratti, filtri,
  clinical scales e store SQLite locale; Linux e Windows oggi verificano la
  portabilita del core in CI, non una parity applicativa completa.
- **Parity UI 0.8**: iPhone 2/2, iPad 7/7, build/probe macOS e localhost 82/82
  sono PASS della baseline storica `0843726fe`, non del candidato exact-tree
  `0.8.5`. Il volume Xcode non è montato e non esiste una nuova prova nativa
  sullo SHA corrente. La parity resta clinico-semantica, non pixel. VoiceOver
  reale mobile non è provato e la deroga storica non autorizza claim di
  conformità.
- **Checkpoint pubblicato 0.8.2**: le PR 163-176 sono su `main`. I commit finali hanno
  review DeepSeek e Sol pulite. Sul push a `main`, Apple Native ha superato
  build, suite iPhone e 4/4 contratti iPad senza skip.
- **Candidato sorgente locale 0.8.5**: il tree integra i contratti e i percorsi
  locali della patch. Non e una release, non e release-ready e non dispone di
  una prova CI remota sulla stessa SHA.
- **Document intelligence**: AnyDoc resta il primo passaggio automatico locale
  e non usa servizi hosted. Il tree include routing, manifest,
  materializzazione e rendering delle pagine `needsOcr`, oltre al preflight
  DeepSeek-OCR 2 con fake seam. Runtime adapter, prova live, benchmark E2E e
  readiness OCR restano assenti; le route legacy rispondono `410`.
- **Evidence absorption**: il layer locale di assorbimento evidenza e ora
  misurato con corpus sintetico multi-fonte, recall di fonte, disciplina di
  citazione, recupero di fonti superate e leakage da fonti stale.
- **Prescrizioni di prestazione**: visite, esami, imaging, riabilitazione e
  screening sono separati dalle terapie farmacologiche; gli item figli e il
  catalog matching restano reviewable e non generano invii regionali.
- **Intelligence Fabric**: `AI Patient Insight`, Smart Import, Document
  Synthesis e Treatment Reasoning attraversano ingressi applicativi distinti
  e producono soltanto proposte da rivedere. Ogni preview mostra receipt,
  provenienza e currentness; nessun percorso applica dati clinici. Ollama e
  ATHENA/MLX restano provider locali capability-specific, senza fallback
  silenzioso o grant riutilizzabile.
- **ATHENA locale**: Treatment Reasoning richiede un runner MLX offline
  pre-provisioned indicato come percorso eseguibile assoluto host-owned da
  `MEDIFLOW_ATHENA_MLX_GENERATE_BIN` e il modello locale. Uno smoke sintetico
  sul percorso di produzione ha completato in
  10,6 secondi con 64 token e 211 caratteri, senza registrare il raw output.
  Questa singola osservazione non prova readiness universale o qualità clinica.
- **Gate F6/F7**: F6 integra il core selettivo e il preflight con fake seam, ma
  non un runtime adapter DeepSeek. F7 integra provider v2, secret broker,
  adapter ufficiali e probe OpenAI/Anthropic `default OFF`. Non esistono
  credenziali, rete live o runtime readiness cloud nel candidato.
- **Fabric capability-first**: il selector guidato copre cinque capability,
  filtra profili compatibili, esegue smoke sintetici e attiva binding host-owned
  in modo atomico con CAS e rollback. Non persiste segreti e non qualifica il
  runtime.
- **Headless**: MCP `stdio` e Mini raggiungono catalogo, terminology search,
  Open Loops patient-scoped, proposta follow-up e query semantica bounded
  read-only tramite un processo figlio autenticato e RPC AIP ereditato.
  Launcher e quickstart production restano
  `PRODUCTION_BRIDGE_BLOCKER`. La topologia Supervisor portabile come trusted
  parent su IPC ereditato è `DECIDED`; l'implementazione è `SPLIT_REQUIRED`.
  Restano aperti late-bind trusted-UI, owner sincrono di `readHostContext`,
  lifecycle e revoca production e audit terminale sincrono. Broker residente e
  UDS sono esclusi dalla `0.8.5`.
- **Write F10**: la transizione stato checkup ha core e composizione SQLite
  verificati come candidato interno. Non è collegata a launcher, MCP, Mini o
  UI; il binding trusted-UI resta
  `AUTHORITY_UI_BINDING_BLOCKER` per il production bridge.
- **Planner candidato**: core, operazione read-only e superficie statica
  MCP/Mini sono integrati:
  `STATIC_SURFACE_INTEGRATED / PRODUCTION_BRIDGE_BLOCKER`. Il production bridge
  selezionato non ha callsite o test e SQL diretto resta vietato.
- **Recording differito**: la visita registrabile è `DEFER_NEXT_PATCH`. Il
  packet è solo foundation: nessuna integrazione runtime, callsite, UI o prova
  Xcode exact-tree appartiene al candidato. Cloud default-on e AI dai client
  paired restano fuori scope.
- **Attese locali**: la prima slice web collega prestazioni attese e risultati;
  il salvataggio resta esplicito e il workflow non e esteso ai client paired.
- **SISS/FSE**: handoff contestuale e flussi `webapp-assisted`; nessuna
  integrazione regionale nativa certificata dichiarata senza `SSI/A2A` e scenari
  approvati.
- **Repository pubblica**: contiene prodotto, documentazione e governance di
  sviluppo. PHI/PII, credenziali, runtime data, corpus autenticati e note
  personali di account restano fuori da Git.

---

## 🧱 2. Cosa e gia deciso

### 2.1 Local-first non e un dettaglio

Il default architetturale e locale:

- il dato nasce nel browser/client locale;
- i campi clinici sensibili vengono cifrati prima della persistenza;
- lo storage autorevole vive su disco locale;
- i provider AI ammessi, AnyDoc e i servizi terminologici sono locali quando
  presenti;
- l'eventuale rete locale e opt-in e bounded.

Questo significa che non sono ammessi, senza ADR e documentazione esplicita:

- sync cloud implicita;
- telemetry o analytics in background;
- runtime AI remoto come default (vietato);
- upload automatico di documenti clinici;
- database remoto multi-tenant;
- bypass del nodo Mac `home-base` per i client mobili.

### 2.2 La shell web ufficiale e una sola

La root web locale renderizza oggi il cockpit Kree8 come grammatica visuale di
riferimento, ispirazione esterna e non prodotto MediFlow a se. ADR 0060 supera
Graphite per il punto d'ingresso `/`, preservando pero la regola piu importante
gia decisa: MediFlow non deve tornare a shell concorrenti o a un selector
permanente. Graphite resta solo riferimento storico/architetturale del principio
no-selector.

Conseguenze pratiche:

- non si aggiungono nuovi chooser permanenti per shell alternative;
- AI, Smart Import e contesto paziente SISS restano superfici presenti nel
  runtime quando mature, senza passare da preview profiles persistiti;
- nuove sperimentazioni devono vivere come workstream espliciti, non come
  selector nascosti nelle impostazioni;
- la documentazione pubblica deve parlare di una sola esperienza supportata.

Documenti/ADR principali:

- [ADR 0060](./adr/0060-kree8-cockpit-live-root-entry.md)
- [ADR 0047](./adr/0047-graphite-workbench-single-official-web-shell.md)
- [ADR 0050](./adr/0050-functional-preview-profiles-retired-on-mainline.md)
- [docs/walkthrough.md](./walkthrough.md)

### 2.3 Il Mac resta il nodo autorevole

Il disegno Apple non e "tre app con tre store dati". E una family architecture:

- Mac come `home-base`;
- SQLite autorevole solo sul Mac;
- API versionate e boundary di rete espliciti;
- core Swift condiviso in prospettiva;
- shell distinte per macOS, iPhone e iPad;
- client mobili paired, con cache derivata e riconciliazione esplicita quando
  quella parte verra implementata.

Oggi la slice resta read-only-first nel disegno generale, ma non è più limitata
ai primi cinque moduli: lifecycle paziente, diario, terapie, checkup,
osservazioni, prestazioni e protesica hanno write versionati; i cataloghi sono
read-only e il dominio documentale ammette create manuale cifrato. Hard delete,
PUT/DELETE paired degli allegati, artifact document-derived, invocazione AI,
write offline, sync record-level e multi-master restano fuori scope.

Documenti/ADR principali:

- [ADR 0034](./adr/0034-local-only-default-and-network-home-base-opt-in.md)
- [ADR 0038](./adr/0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md)

### 2.4 Il documento e evidenza, non testo da ingoiare

La document intelligence e `artifact-first`:

- il formato viene riconosciuto dai byte e il documento supportato attraversa
  AnyDoc in un processo locale bounded;
- AnyDoc produce Markdown normalizzato, evidenza e provenienza senza usare rete
  o servizi hosted;
- il candidato classifica le sole pagine `needsOcr`, le materializza e le
  renderizza con limiti bounded; il preflight DeepSeek usa un fake seam e non è
  un runtime adapter;
- immagini, documenti cifrati e input ambigui falliscono chiusi; le route OCR
  legacy rispondono `410`;
- il risultato va trattato come evidenza reviewable;
- `summarySnapshot` e `parseEvidenceArtifactSnapshot` sono dati clinici e
  persistono cifrati;
- i nuovi `parseEvidenceArtifactSnapshot` possono includere `sectionMap`,
  ancore `page/section/snippet` e conflitti terapeutici reviewable;
- `patients.documentInsights` resta una projection compatibile, non il modello
  finale ideale.

Il sistema non deve promuovere automaticamente diagnosi o terapie solo perche
compaiono in testo libero. La scrittura strutturata richiede review e soglie di
certezza documentate.

Documenti/ADR principali:

- ADR 0040 (private)
- [ADR 0042](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md)
- [ADR 0102](./adr/0102-document-synthesis-source-authority.md)
- [ADR 0107](./adr/0107-anydoc-local-attachment-extraction.md)

### 2.5 Le integrazioni regionali restano dentro canali ufficiali

MediFlow puo aiutare l'operatore a preparare il contesto e aprire il percorso
corretto, ma non deve raccontare una integrazione SISS/FSE nativa quando manca
qualifica, provisioning o scenario approvato.

Stato attuale:

- `portal-handoff` e `webapp-assisted` sono ammessi e documentati;
- il prescrittivo regionale usa il percorso ufficiale;
- il corpus SISS/FSE locale serve a governare decisioni future;
- SGDT/FSE/prescrittivo nativo richiedono analisi scenario-specific;
- documenti autenticati o non redistribuibili restano fuori Git.

Documenti/ADR principali:

- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md)
- [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md)
- [ADR 0045](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md)
- [ADR 0046](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md)
- [ADR 0049](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)

---

## 🖥️ 3. Superfici runtime

| Superficie | Stato | Uso reale | Boundary |
| --- | --- | --- | --- |
| Web app locale | Primaria | Lavoro clinico quotidiano sul Mac, root Kree8 live e route cliniche locali | HTTP localhost, sessione web |
| `/api/*` | Runtime web | CRUD, auth, proxy locali, sistema | Session cookie |
| `/api/v1/*` | Contratto locale/shared | Client native e superfici stabili | Bearer token locale, TLS proxy |
| `/api/v1/network/*` | First slice home-base | Lista/dettaglio pazienti e write limitati/versionati su profilo/status, diario, terapie, checkup e osservazioni da device paired | Credenziale device + sessione operatore |
| macOS Apple shell | Operativa | Fronte nativo piu maturo: shell Apple/home-base, workspace paziente condiviso, runtime panel e store locale verificabile; Lume e consegnata nella card clinica opaca, mentre le altre superfici restano in migrazione | Firma/notarizzazione esplicite, Ollama/MLX non app-managed |
| `MediFlowCore` tri-OS | Verificato tri-OS | Core Swift condiviso per logica clinica, cifratura, contratti, filtri, conflict handling, clinical scales e SQLite locale | CI Linux/macOS/Windows; non equivale a app complete Windows/Linux |
| iPhone/iPad | Paired | Client paired non-AI, cache cifrata degradabile e workflow online versionati sui moduli core | No SQLite diretto |
| AnyDoc | Estrazione locale | Conversione deterministica degli allegati supportati in Markdown normalizzato | Processo figlio bounded; nessuna rete; non e OCR o provider Fabric |
| Pipeline `needsOcr` | Core selettivo integrato | Routing, manifest, materializzazione, rendering e preflight DeepSeek con fake seam | Nessun runtime adapter, prova live o benchmark E2E |
| Selector Fabric | Integrato | Discovery compatibile, smoke sintetico e binding atomico per cinque capability | Nessun segreto persistito; discovery non equivale a readiness |
| Ollama | Provider locale capability-specific | Percorsi generativi Fabric ammessi dalla capability | Solo loopback; nessun OCR o fallback implicito |
| ATHENA/MLX | Provider locale capability-specific | Solo Treatment Reasoning review-only | Nessuna prescrizione o apply clinico |
| OpenAI / Anthropic | Adapter ufficiali `default OFF` | Probe Document Synthesis review-only con policy e secret reference host-owned | Solo transport fake nel tree; nessuna credenziale, rete live o runtime readiness |
| MCP / Mini | Superficie figlia candidata | Catalogo, terminology search, Open Loops patient-scoped, proposta follow-up e query semantica bounded read-only | RPC AIP ereditato; entrypoint production `PRODUCTION_BRIDGE_BLOCKER` |
| Write checkup F10 | `INTERNAL_CANDIDATE_VERIFIED / AUTHORITY_UI_BINDING_BLOCKER` | Core e composizione SQLite verificati | Nessun binding launcher, MCP, Mini o UI; conferma trusted-UI richiesta |
| Semantic planner | `STATIC_SURFACE_INTEGRATED / PRODUCTION_BRIDGE_BLOCKER` | Core, validazione, esecutore, operazione read-only e superficie statica MCP/Mini integrati | Production bridge senza callsite o test; nessun SQL libero |
| ICD-11 WHO | Application Service server-only | Ricerca diagnosi/coding con output MediFlow data-only | Disattivato per default; egress e credenziali host-owned espliciti |
| OpenMed | Shadow/benchmark | Redaction lane locale non client-facing | Non runtime clinico |

---

## 🗄️ 4. Percorso dati clinici

### 4.1 Scrittura web ordinaria

1. Il medico opera nella web app.
2. Il client possiede la master key solo in RAM dopo unlock.
3. I campi sensibili vengono cifrati lato client.
4. Il payload cifrato arriva alle route `/api/*`.
5. Il server persiste su SQLite.
6. Audit/log restano PHI-safe e non sostituiscono il dato clinico.

### 4.2 Lettura e rendering

1. Il server legge record cifrati.
2. Il client riceve dati nel formato previsto.
3. La decifratura avviene nel browser/client con master key in memoria.
4. UI e componenti clinici mostrano solo il necessario per il workflow corrente.

### 4.3 Allegati e artifact documentali

1. Il medico carica o seleziona un allegato corrente host-owned.
2. Il runtime riconosce il formato dai byte e invoca AnyDoc localmente con
   limiti di input, tempo e output.
3. AnyDoc restituisce Markdown normalizzato, evidenza e provenienza.
4. Un'immagine, un PDF scansionato senza text layer, un documento cifrato o un
   input non supportato termina in
   `review_required/unsupported_local_extraction`. Il flusso non produce
   sintesi o proposta clinica.
5. I servizi downstream possono trasformare l'evidenza corrente in proposte
   tipizzate e review-only. L'applicazione resta un gesto separato e non e
   autorizzata dalla preview Fabric.
6. Gli artifact persistiti dai flussi di dominio restano cifrati:
   - allegato;
   - `summarySnapshot`;
   - `parseEvidenceArtifactSnapshot`;
   - projection `documentInsights` quando serve compatibilita.
7. Consumer reviewable:
   - `AI Patient Insight`;
   - Smart Import;
   - nuova anagrafica da documento;
   - troubleshooting documentale.

### 4.4 Home-base paired patient data plane

1. Operatore abilita `network-home-base`.
2. Device remoto apre un pairing intent PHI-safe.
3. Nodo Mac conferma esplicitamente il device.
4. Il device riceve una credenziale dedicata.
5. Le route `/api/v1/network/patients*` rispondono solo se:
   - device paired valido;
   - sessione operatore valida sul nodo;
   - scope clinico risolto dal nodo.
6. `GET` pazienti resta read-only; `PUT /api/v1/network/patients/{id}` e
   limitato a profilo/status paziente, richiede
   `network.replica.write-patient-profile` e `version`.
7. `/api/v1/network/patients/{id}/entries*` pubblica read/create/update/soft-delete
   del diario con capability diary dedicate e `entries.version`; i riferimenti
   allegato sono ammessi solo sigillati e validati dal client, mentre hard
   delete, sync e campi AI/document-derived restano bloccati.
8. Le sotto-risorse cliniche locali condivise `/api/v1/patients/{id}/entries*`,
   `/api/v1/patients/{id}/therapies*`, `/api/v1/patients/{id}/checkups*` e
   `/api/v1/patients/{id}/observations*` mantengono per web/native la stessa
   semantica reversibile e versionata: PUT figli con version guard e `409` su
   conflitto, lista attiva di default, `includeDeleted=true` per i tombstone,
   DELETE come soft-delete ovunque e audit che distingue eliminazione da
   aggiornamento.
9. `/api/v1/network/patients/{id}/therapies*`,
   `/api/v1/network/patients/{id}/checkups*` e
   `/api/v1/network/patients/{id}/observations*` seguono lo stesso boundary
   paired: capability dedicate, `therapies.version`/`checkups.version`/
   `observations.version`, `409` PHI-safe e soft delete, senza hard delete
   remoto o campi AI/documentali.
10. Se l'operatore disattiva `network-home-base`, i pairing restano
    conservati ma ogni token paired diventa inerte: le route del data plane
    rispondono `403 NETWORK_MODE_DISABLED` finche la modalita non torna
    attiva.

---

## 🤖 5. AI stack e regole di promozione

### 5.1 Runtime operativo del candidato locale 0.8.5

Il runtime AI operativo resta locale. Il default generativo protetto e trattato
come baseline finche benchmark e governance non giustificano un cambio.

L'Application Service Layer resta host-owned. Il Fabric risolve provider,
modello e venue per capability e restituisce receipt e provenienza PHI-safe.
Il chiamante non sceglie provider, modello, venue o fallback. Il gate egress
resta chiuso per default. Gli adapter cloud esistono, ma non sono attivi senza
opt-in host, lifecycle, policy e secret reference; il tree non include
credenziali o prove di rete live.

Le superfici operative includono:

- `AI Patient Insight`;
- Smart Import reviewable;
- Document Synthesis;
- Treatment Reasoning.

Le quattro superfici producono solo proposte. Receipt, provenienza e currentness
restano visibili nella UI; nessuna receipt e un grant e nessuna preview esegue
apply. Ollama serve i percorsi generativi locali ammessi dalla capability.
ATHENA/MLX serve soltanto Treatment Reasoning. AnyDoc resta una estrazione
deterministica separata: non e un provider Fabric e non soddisfa `ocr`.

ATHENA è inclusa soltanto se il modello e il runner MLX offline sono già
presenti sulla macchina. Il runner viene indicato con
`MEDIFLOW_ATHENA_MLX_GENERATE_BIN` come percorso eseguibile assoluto host-owned;
MediFlow non scarica o prepara il modello.
Il supporto del runner è nel commit `2574cf5fc`, verificato con TDD 6/6,
typecheck ed ESLint. Uno smoke sintetico sul percorso di produzione con modello
BF16 locale ha registrato 10,6 secondi, 64 token e 211 caratteri di output,
senza conservare il raw output.

Il router documentale usa `shadow` come default. La modalita `active` puo
evitare il modello solo su route esplicitamente eleggibili ad alta confidenza;
  non promuove mai proposte cliniche senza review e salvataggio espliciti.

### 5.1.1 Candidato sorgente locale 0.8.5

Il crosswalk machine-readable
[`fabric-generative-runtime-crosswalk.v1.json`](./capability-mapping/fabric-generative-runtime-crosswalk.v1.json)
lega ciascuna capability al proprio ingresso, production root, route, receipt,
provenienza e UI. Il guard dedicato verifica il mapping e mantiene separata la
receipt storica `candidate_not_integrated`.

- `patient_insight`: `proposal_only`.
- `smart_import`: `proposal_only`.
- `document_synthesis`: `proposal_only`.
- `treatment_reasoning`: `proposal_only`.
- `ocr`: core selettivo e preflight integrati, senza runtime adapter o
  production root qualificato.

Questo stato e locale al tree. Non prova CI remota, release readiness, tag,
pubblicazione, installazione o disponibilita operativa su un altro host. Lo
smoke ATHENA è una singola osservazione, non un benchmark o uno SLI. Non esiste
un benchmark di release per latenza, throughput, qualita generativa o
accuratezza OCR; il candidato non fa claim di prestazione su questi aspetti.

### 5.1.2 Esiti di perimetro F6 e F7

I gate distinguono il comportamento incluso dai componenti non pronti. Le
parti escluse non sono feature della `0.8.5` e non restano come dipendenze
implicite della patch.

| Gate | Implementato | Verificato nel tree locale | Residuo escluso | Esito |
| --- | --- | --- | --- | --- |
| F6 — OCR selettivo | AnyDoc first-pass; routing, manifest, materializzazione e rendering `needsOcr`; preflight DeepSeek con fake seam | Test bounded e fail-closed del core selettivo | Runtime adapter, prova live, benchmark italiano E2E e qualifica hardware | `INTEGRATED CORE / NO_RUNTIME_READINESS` |
| F7 — provider esterni | Provider v2, secret broker, adapter HTTPS ufficiali e probe review-only OpenAI/Anthropic | Test con transport fake e default OFF | Credenziali, rete live, retention account e runtime readiness remota | `INTEGRATED / DEFAULT_OFF` |

Una sottoscrizione o un login consumer OpenAI/Anthropic non costituiscono
accesso API. Registry, probe e adapter non autorizzano onboarding, invio di PHI
o esecuzione remota.

### 5.1.3 Headless, MCP e Mini candidati

Un launcher trusted avvia un processo figlio autenticato con ambiente
allowlisted e RPC AIP ereditato. MCP `stdio` e Mini pubblicano catalogo,
terminology search, Open Loops patient-scoped, proposta follow-up
`proposal_only` e query semantica bounded read-only. Ogni call passa dal broker
e dagli Application Services host-owned; gli adapter non importano SQLite e non
aprono listener.

Questa superficie resta un candidato integrato. Launcher production,
quickstart, onboarding e lifecycle operativo supportato restano
`PRODUCTION_BRIDGE_BLOCKER`. La topologia Supervisor portabile come trusted
parent su IPC ereditato è `DECIDED`; l'implementazione è `SPLIT_REQUIRED`. La
factory esaminata non chiude late-bind trusted-UI, owner sincrono di
`readHostContext`, lifecycle e revoca production o audit terminale sincrono. Un
broker residente o UDS non rientra nella `0.8.5`.

La transizione stato checkup F10 è verificata soltanto come candidato interno
nel core e nella composizione SQLite. Non ha binding launcher, MCP, Mini o UI.
La conferma trusted-UI resta `AUTHORITY_UI_BINDING_BLOCKER` e blocca la chiusura
del production bridge.

Il core, l'operazione read-only e la superficie statica MCP/Mini del semantic
query planner sono integrati:
`STATIC_SURFACE_INTEGRATED / PRODUCTION_BRIDGE_BLOCKER`. Il production bridge
selezionato non ha callsite o test. La visita registrabile è
`DEFER_NEXT_PATCH` e non è integrata nel runtime. Egress implicito, SQL diretto
ed esecuzione AI dai client paired restano chiusi.

### 5.2 Lane benchmark-only

> [!WARNING]
> Le lane benchmark/shadow sono strumenti interni, non claim di prodotto: una
> lane documentata o benchmarkata non e per questo runtime clinico disponibile.

Le lane seguenti restano separate dal runtime clinico:

- OpenMed `redaction.v1` (shadow/benchmark);
- HUMADEX / OpenMed NER;
- challenger generativi non promossi;
- esperimenti MLX diversi dalla capability nominata Treatment Reasoning;
- comparator cloud storico, escluso dal candidato `0.8.5`.

MLX non diventa un provider generico: nel candidato 0.8.5 ATHENA/MLX e ammesso
solo dalla capability Treatment Reasoning. Ollama resta capability-specific e
non esegue OCR. Ogni altra lane MLX resta benchmark, shadow o hold secondo la
matrice di serving.

OpenAI e Anthropic hanno adapter ufficiali e probe review-only. Restano
`default OFF`; il tree usa transport fake e non contiene credenziali o prove di
rete live. Registry e probe non autorizzano esecuzione o egress.

Per promuovere una lane servono:

- corpus sintetico o case pack governato;
- benchmark ripetibile;
- stop-rules;
- shadow mode quando applicabile;
- rollback/fallback chiari;
- aggiornamento docs/ADR se cambia un boundary.

La classificazione completa per task, modello e runtime vive in
[docs/ai-runtime-serving-matrix.md](./ai-runtime-serving-matrix.md). La matrice
separa `runtime`, `shadow`, `benchmark_only` e `hold`; un modello installato non
è automaticamente un modello serving.

### 5.3 Comparator cloud escluso

La documentazione storica conserva un comparator cloud di engineering, ma il
candidato `0.8.5` non ne include esecuzione, configurazione credenziali o
egress. Non e una lane runtime o una prova di provider disponibile.

---

## 📚 6. Documentazione: come leggere il repository

### 6.1 Percorso consigliato per capire tutto

1. [README.md](../README.md): ingresso prodotto.
2. [AGENTS.md](../AGENTS.md): regole operative e repository canonica.
3. [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md): lettura completa
   dello stato corrente.
4. [ARCHITECTURE.md](../ARCHITECTURE.md): principi stabili.
5. [SECURITY.md](../SECURITY.md): threat model, privacy, logging e redazione.
6. [docs/walkthrough.md](./walkthrough.md): flusso end-to-end.
7. [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md): percorsi dati
   e trust boundaries.
8. [docs/repository-topology.md](./repository-topology.md): governance della
   repository e confine Git/fuori-Git.
9. [docs/README.md](./README.md): mappa canonica e fonti autorevoli per tema.
10. [docs/markdown-index.md](./markdown-index.md): inventario completo.
11. [docs/adr/README.md](./adr/README.md): decisioni architetturali.

### 6.2 Repository pubblica e artefatti locali

La repository pubblica `Wulfgardr/mediflow` contiene tutto cio che serve allo
sviluppo e al rilascio del progetto:

- prodotto e installazione;
- architettura e sicurezza;
- roadmap pubblica;
- FAQ;
- walkthrough, ADR e documenti canonici;
- regole agentiche, workflow contributivo e script necessari allo sviluppo.

Restano fuori da Git, senza usare la repository privata archiviata come
destinazione alternativa:

- database reali o runtime artifacts;
- `medical.db`, `.sqlite`, `.sqlite3`, `.next`, `tmp-*`;
- PHI/PII, credenziali, log o screenshot con dati clinici;
- note personali di account, billing o limiti di spesa;
- documenti riservati o fonti autenticate del corpus SISS/FSE.

---

## 🧩 7. Stato per area funzionale

### 7.1 Pazienti e cartella clinica

Disponibile:

- anagrafica paziente;
- diario clinico;
- terapie;
- osservazioni;
- appuntamenti/checkup e agenda operativa sui casi visibili;
- allegati;
- archiviazione paziente;
- campi strutturati e projection documentale;
- versioning/compare-on-write sui percorsi rilevanti;
- ciclo di vita di cancellazione paziente reversibile (ADR 0066): DELETE come
  tombstone soft-delete version-guarded con `deletedAt`/`deletionReason`,
  letture filtrate sui soli pazienti attivi via helper condiviso, restore
  admin esplicito e purge amministrata dry-run/execute per l'erasure GDPR,
  con audit dedicato (`patient.purged`, `patient.restored`);
- clear del contenitore di test per membership M2M: esclude i pazienti con
  membership in ambulatori live e soft-deleta i soli pazienti di test con
  `deletionReason` dedicata e audit per paziente;
- PUT profilo con `ambulatoryId` come set-primary: aggiorna la membership
  primaria senza azzerare le membership multi-ambulatorio.
- attese locali web con collegamento esplicito tra prestazione prevista e
  risultato, senza estensione paired o scritture cliniche autonome.

Da preservare:

- cifratura client-side;
- conflitti espliciti;
- audit PHI-safe;
- niente scritture remote non governate;
- nessuna cancellazione fisica sul percorso caldo: l'erasure passa solo dalla
  purge amministrata e audited;
- il placeholder `[LOCKED DATA]` resta solo presentazione: quando la
  decifratura fallisce il ciphertext originale viene conservato e non va mai
  sovrascritto.

### 7.2 Backup, restore e continuita

Disponibile:

- artifact backup v1;
- preflight restore;
- scheduler notturno via macOS `launchd`;
- retention `keep-last-N`;
- guardrail anti-regressione;
- date dei backup schedulati serializzate come stringhe ISO, con restore che
  riconosce anche i legacy in secondi unix;
- repair del database crash-safe: backup online better-sqlite3 con checkpoint
  WAL, swap atomico retire-by-rename, mutex per percorso (una seconda repair
  concorrente riceve `409`), recovery a boot dei file `.old-*` superstiti e
  fallback legacy `VACUUM INTO`.

Da preservare:

- nessun backup con PHI in repo;
- restore distruttivo solo dopo preflight;
- documentazione aggiornata quando cambiano manifest o schema.

### 7.3 Smart Import e nuova anagrafica da documento

Disponibile:

- estrazione automatica locale con AnyDoc per i formati supportati;
- routing, manifest, materializzazione e rendering bounded delle pagine
  `needsOcr`, con preflight DeepSeek e fake seam;
- review di suggerimenti;
- soppressione rumore quando una fonte non introduce novita clinica;
- create-flow document-driven con persistenza prudente delle terapie;
- fallimento chiuso e revisione manuale per immagini, PDF scansionati senza
  text layer, documenti cifrati o formati non supportati; nessuna proposta
  clinica nasce da contenuto incompleto;
- estrazione identita documentale prudente: nessun fallback prima-data-trovata
  per la data di nascita (meglio assente che sbagliata), date costruite in
  UTC e codice fiscale riconosciuto anche in forma omocodica.

Fuori scope:

- auto-promozione di diagnosi/terapie da testo libero ambiguo;
- runtime adapter DeepSeek-OCR 2, benchmark OCR e relativa esecuzione E2E;
- import silenzioso di documenti reali senza review;
- uso di documenti reali come fixture Git.

### 7.4 SISS, FSE e Protesica

Disponibile:

- pannello contestuale paziente SISS;
- launcher/handoff verso percorsi ufficiali;
- prescrittivo `webapp-assisted`;
- utilita PRREG nel client Apple: copia locale del CF e apertura della dashboard
  nel browser di sistema, senza nuova route paired;
- corpus locale SISS/FSE con sync/freshness;
- diario locale protesico document-backed e handoff `Protesica-RL`;
- dominio locale per prescrizioni di prestazione (visite, esami, imaging,
  riabilitazione, screening) con item codificabili e matching repertorio locale,
  separato da terapie farmacologiche e protesica.

Fuori scope:

- canale SISS nativo certificato non dimostrato;
- UI prescrittiva custom sostitutiva del modulo regionale;
- generazione NRE, invio regionale o writeback FSE/SISS da MediFlow;
- scraping aggressivo;
- bypass di autenticazioni o vincoli regionali.

### 7.5 Apple/native e tri-OS

Disponibile:

- catalogo farmaci AIFA locale importabile da CSV nella web UI, con manifest
  persistito, hash SHA-256, indici SQLite e ricerca server-side limitata per
  prefisso su nome, principio attivo e AIC;
- autocomplete terapie web e Apple alimentati dallo stesso catalogo locale,
  senza full-fetch nel browser o nel client paired;
- macOS come fronte nativo piu maturo: shell Apple/home-base, workspace
  paziente, runtime panel e store locale verificabile;
- adozione Lume progressiva: ADR 0078 e `Accepted`, con prime superfici web e
  card clinica opaca nativa consegnate; componenti interni e QA manuale completa
  restano aperti;
- `MediFlowCore` condiviso e testato su macOS, Linux e Windows;
- contratto `/api/v1`;
- TLS proxy locale;
- runbook native/testing/parity;
- client iPhone/iPad paired non-AI con cache cifrata degradabile e primi
  workflow online versionati sui moduli core.

Fotografia parity post-Wave 5:

- 64 capability censite: 30 full, 13 partial, 21 host-only, 0 missing-both;
- tra le 43 capability per cui la parity è un obiettivo, 30 sono full (70%);
- PR #21 e `WUL-401`, ora completata, hanno consegnato bundle, fixture, probe AX
  e runbook P6 di base; prerequisiti operativi e verbale manuale sul Mac
  sbloccato restano in `WUL-481`;
- offline degradato onesto resta in `WUL-403`;
- Smart Import e invocazione AI paired restano host-only per ADR 0076.

La fonte canonica è [docs/parity-matrix.md](./parity-matrix.md).

Direzione:

- app Windows/Linux e launcher dedicati oltre il core;
- closeout parity residuo tramite `WUL-481`/`WUL-403` e decisione separata per i quattro residui documentali;
- cache locale cifrata derivata e riconciliazione esplicita.

Fuori scope corrente:

- accesso diretto a SQLite da mobile;
- sync cloud;
- write remote generici;
- AI plane remoto dentro il data plane clinico.

### 7.6 Impostazioni e superficie di sistema

Disponibile:

- impostazioni riorganizzate in sidebar con sotto-route per area: Generale
  (profilo, aspetto, ambulatori), Sicurezza e Dati (accesso, backup,
  repertori), Intelligenza Artificiale (modelli, funzioni), Avanzate
  (diagnostica, sviluppo, zona pericolo);
- `/settings` come dashboard sintetica `Stato sistema`, con redirect dalle
  vecchie ancore legacy;
- toggle Privacy Mode persistente nell'header dell'app;
- ricerca rapida delle impostazioni via CMD+K;
- import AIFA locale con fonte, URL, data di scarico, versione e stato di
  provenienza visibili; nessun dataset AIFA e incluso nel repository;
- restore e reset richiedono conferma con parola chiave digitata
  (`RIPRISTINA` / `RESET`) sulle superfici di avvertimento.

Da preservare:

- le azioni distruttive restano dietro conferma esplicita digitata;
- la riorganizzazione non introduce nuove superfici remote o cloud.

---

## ⚙️ 8. Regole di manutenzione

Quando cambia una feature runtime:

- aggiorna il documento canonico dell'area;
- aggiorna [docs/walkthrough.md](./walkthrough.md) se cambia il flusso reale;
- aggiorna [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) se
  cambiano trust boundary, API o percorsi dati;
- aggiorna [docs/README.md](./README.md) se cambia la fonte autorevole;
- aggiorna [docs/markdown-index.md](./markdown-index.md) se aggiungi, rimuovi o
  rinomini Markdown;
- aggiorna issue e roadmap pubbliche se cambia una priorita operativa.

Quando cambia un boundary:

- scrivi o aggiorna ADR prima del codice;
- verifica [SECURITY.md](../SECURITY.md);
- verifica impatto OpenAPI se riguarda `/api/v1`;
- dichiara esplicitamente cosa resta fuori scope.

Quando cambia la topologia della repository:

- aggiorna [AGENTS.md](../AGENTS.md) e
  [docs/repository-topology.md](./repository-topology.md);
- verifica che remote, branch, PR, tag e release puntino alla repository
  pubblica canonica;
- verifica che DB, runtime artifact, credenziali e materiali riservati restino
  fuori da Git.

---

## 🧪 9. Check rapidi

### 9.1 Verifica docs-only

Per una modifica solo documentale:

```bash
git diff --check
rg --files -g '*.md' | sort
```

Se i documenti toccano esempi di comandi, contratti o script, esegui anche il
comando citato o dichiara perche non e stato eseguito.

### 9.2 Verifica runtime generale

Per modifiche applicative non banali:

```bash
npm run lint
npm run typecheck
npm run build
npm run check:never-regress
```

In piu:

- `/api/v1`: `npm run check:openapi:drift`
- pazienti/versioning: `npm run test:concurrency:patients`
- home-base network: `npm run test:network:home-base-readonly`, `npm run test:network:home-base-write`, `npm run test:network:home-base-diary-write`, `npm run test:network:home-base-therapy-write`, `npm run test:network:home-base-checkup-write`, `npm run test:network:home-base-observation-write`
- document intelligence: `npm run test:document-synthesis`, `npm run
  test:ai-context`, `npm run test:pdf-service`
- nuova anagrafica da documento: `npm run test:patient-document-import`

---

## ⚠️ 10. Stop rules

Fermati e scrivi prima un ADR o una nota ADR-style se il lavoro propone:

- nuovo canale cloud;
- nuova superficie remota di scrittura;
- cambio del modello di cifratura/PIN/master key;
- promozione di una lane AI benchmark-only nel runtime clinico;
- integrazione SISS/FSE oltre `webapp-assisted`;
- accesso diretto a SQLite da client mobile;
- schema persistente nuovo per document intelligence;
- rimozione di guardrail zero-knowledge, audit o no-egress.

Fermati e apri/spezza workstream se:

- il diff supera un singolo tema;
- una doc pubblica richiede materiale privato per restare comprensibile;
- una modifica alla repository trascina dati o artefatti che devono restare
  fuori da Git;
- il worktree contiene cambi non correlati.
