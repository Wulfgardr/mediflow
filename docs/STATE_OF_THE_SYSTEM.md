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

Ultimo aggiornamento: 2026-08-10 (preparazione release sorgente v0.8.2)

> [!NOTE]
> La candidata v0.8.2 non è ancora pubblicata. Il tag remoto più recente resta
> `v0.8.0`. Tag, GitHub Release e merge richiedono un'autorizzazione separata.
> La deroga VoiceOver mobile e i rischi residui restano documentati.

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
  sono verdi sul tree verificato. La parity resta clinico-semantica, non pixel.
  VoiceOver reale mobile non è provato per il limite esterno della beta Xcode
  27; la deroga vale solo per la release sorgente e non autorizza claim di
  conformità.
- **Checkpoint 0.8.2**: le PR 163-173 sono su `main`. Le PR 174 e 175 restano
  aperte. I due commit finali hanno review DeepSeek pulita e verifica Sol.
  La prova iPad registra 4/4 contratti UI passati senza skip su iPadOS 27.
- **Document intelligence**: Smart Import, nuova anagrafica da documento e
  `AI Patient Insight` restano reviewable; gli allegati possono persistere
  artifact cifrati `parse/evidence` con prime ancore sezionali. Il fallback OCR
  Apple Vision e certificato solo su macOS; Windows non ha oggi un fallback OCR
  platform-specific equivalente in MediFlow.
- **Evidence absorption**: il layer locale di assorbimento evidenza e ora
  misurato con corpus sintetico multi-fonte, recall di fonte, disciplina di
  citazione, recupero di fonti superate e leakage da fonti stale.
- **Prescrizioni di prestazione**: visite, esami, imaging, riabilitazione e
  screening sono separati dalle terapie farmacologiche; gli item figli e il
  catalog matching restano reviewable e non generano invii regionali.
- **AI**: runtime locale per default, `OllamaAdapter` e `AIService` come
  integrazioni presenti nel tree e gate egress ancora chiuso; benchmark e
  shadow lane restano separati dal prodotto clinico. Lo scaffold intelligente
  di ADR 0086 e un contratto accettato per il programma post-0.8 e non apre una
  funzione nuova della v0.8. Sulla linea post-0.8 sono presenti il registry
  provider locale per task (WUL-502) e lo scaffold Intelligence Fabric di ADR
  0089: contratto congelato, cataloghi delle capability generative e
  deterministiche, resolver fail-closed e stato read-only
  `/api/ai/fabric/status`. ADR 0090 e ADR 0091 aggiungono un candidato locale
  limitato: lifecycle provider dichiarativo senza segreti, continuita
  fail-closed, proiezione PHI-safe `status_only` per i client paired e harness
  sintetico receipt-provenance-review. Il candidato non aggiunge provider,
  egress, grant paired o automazione: Intelligence Fabric resta una linea in
  costruzione, non una funzione completa del prodotto corrente.
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
- i servizi AI/OCR e terminologici sono locali quando presenti;
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

La direzione document intelligence e `artifact-first`:

- il documento viene normalizzato;
- OCR/estrazione restano locali;
- OCR primario resta Ollama/DeepSeek OCR quando disponibile;
- su macOS, se l'OCR primario produce testo vuoto o degenerato, il runtime puo
  usare Apple Vision come fallback locale;
- su Windows e Linux non esiste oggi un fallback platform-specific certificato:
  senza OCR primario utile o testo gia disponibile il flusso deve fallire in modo
  esplicito;
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
- [ADR 0059](./adr/0059-macos-apple-vision-ocr-fallback.md)

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
| macOS Apple shell | Operativa | Fronte nativo piu maturo: shell Apple/home-base, workspace paziente condiviso, runtime panel e store locale verificabile; Lume e consegnata nella card clinica opaca, mentre le altre superfici restano in migrazione | Firma/notarizzazione esplicite, Ollama/Docker non app-managed |
| `MediFlowCore` tri-OS | Verificato tri-OS | Core Swift condiviso per logica clinica, cifratura, contratti, filtri, conflict handling, clinical scales e SQLite locale | CI Linux/macOS/Windows; non equivale a app complete Windows/Linux |
| iPhone/iPad | Paired | Client paired non-AI, cache cifrata degradabile e workflow online versionati sui moduli core | No SQLite diretto |
| Ollama | Opzionale locale | AI/OCR/sintesi dove disponibile | Solo localhost; OCR primario |
| Apple Vision OCR | macOS-only fallback | Seconda lettura locale quando DeepSeek/Ollama OCR restituisce output blank/low-signal | Solo macOS, nessun equivalente certificato Windows/Linux |
| ICD-11 Docker | Opzionale locale | Diagnosi/coding | Solo localhost |
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

1. Upload documento.
2. Normalizzazione input e OCR locale: primario Ollama/DeepSeek OCR, con fallback
   Apple Vision solo su macOS quando l'output primario e low-signal.
3. Se il testo estratto e assente o insufficiente, il documento entra nella
   coda OCR-needed con stato e motivo espliciti e nessuna proposta clinica;
   al completamento dell'OCR il replay per hash documento riapplica la
   pipeline in modo idempotente.
4. Sintesi/estrazione locale.
5. Persistenza cifrata di:
   - allegato;
   - `summarySnapshot`;
   - `parseEvidenceArtifactSnapshot`;
   - projection `documentInsights` quando serve compatibilita.
6. Consumer reviewable:
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

### 5.1 Runtime operativo

Il runtime AI operativo resta locale. Il default generativo protetto e trattato
come baseline finche benchmark e governance non giustificano un cambio.

`OllamaAdapter` e `AIService` separano il provider dal servizio applicativo.
Nel pacchetto post-0.8, `LocalProviderRegistry` centralizza il binding
task-provider-modello per i task instradati tramite `AIService` e accetta solo
Ollama su loopback, senza fallback. Non estende grant o fallback alle lane
separate, come ATHENA MLX. Questo packet non appartiene alla candidata 0.8. Il
gate egress resta
`closed_pending_redaction_lane`: non esistono provider cloud o consenso egress
consegnati.

Le superfici operative includono:

- `AI Patient Insight`;
- Smart Import reviewable;
- sintesi documentale;
- eventuali helper locali di normalizzazione/estrazione.

Le superfici AI restano review-first e protette da safety gate (WUL-355,
WUL-358): kill-switch dedicato per `patient-insight`, `smart-import` e
`document-synthesis`, piu model governance delle decisioni documentali. Nessuna
scrittura clinica autonoma: l'AI locale propone, il medico rivede.

Il router documentale usa `shadow` come default. La modalita `active` puo
evitare il modello solo su route esplicitamente eleggibili ad alta confidenza;
  non promuove mai proposte cliniche senza review e salvataggio espliciti.

### 5.1.1 Release sorgente v0.8: perimetro verificabile

Il tree della release contiene hardening delle superfici documentali, UI web
Lume e aggiornamenti della family Apple. Le integrazioni sono incluse solo
entro i gate e i limiti dichiarati.

- Il registro delle proposte diagnostiche resta separato dalle diagnosi
  cliniche. La promozione richiede review esplicita.
- Le superfici web trattano gli stati documentali come stati accessibili.
- La family Apple conserva i limiti paired, non-AI e local-first già dichiarati.
- Nessuna voce aggiunge cloud, auto-write clinico, SISS/FSE nativo o una inbox
  conversazionale.

### 5.1.2 Candidato locale Intelligence Fabric post-0.8

Il branch di programma post-0.8 contiene un candidato tecnico locale regolato
da ADR 0089, ADR 0090 e ADR 0091. Il candidato:

- applica onboarding, degrado e revoca provider a snapshot dichiarativi che
  non contengono credenziali;
- nega venue offline, sconosciute o degradate e non cambia provider in
  fallback;
- espone su `/api/v1/network/ai-runtime` una proiezione PHI-safe decodificabile
  dal core Swift condiviso;
- lascia il client paired in `status_only`, con esecuzione AI non autorizzata;
- collega in un harness sintetico receipt, provenance, proposta e revisione
  del medico senza eseguire scritture cliniche;
- mantiene il core deterministico non-AI disponibile senza provider.

Il router candidato non governa ancora tutti i call path AI operativi. Il
lifecycle provider non e persistito e non parla con API vendor. Cloud,
on-device e invocazione AI paired restano in `hold`. Il risultato e quindi un
candidato locale verificabile, non una promozione prodotto o remota.

### 5.2 Lane benchmark-only

> [!WARNING]
> Le lane benchmark/shadow sono strumenti interni, non claim di prodotto: una
> lane documentata o benchmarkata non e per questo runtime clinico disponibile.

Le lane seguenti restano separate dal runtime clinico:

- OpenMed `redaction.v1` (shadow/benchmark);
- HUMADEX / OpenMed NER;
- challenger generativi non promossi;
- TurboQuant / MLX runtime experiments;
- comparator cloud opt-in (`gpt-5.4`).

`WUL-165` rende MLX benchmark-visible e diagnosticabile in read-only nella
home-base, ma non lo promuove a runtime clinico: Ollama resta il default
operativo generativo e il motore OCR primario. L'unico fallback OCR
platform-specific certificato oggi e Apple Vision su macOS; Windows/Linux non
hanno un fallback OCR equivalente dichiarato.

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

### 5.3 Comparator cloud

Il comparator cloud e ammesso solo come strumento interno opt-in di engineering,
su case pack privati redatti/minimizzati e fuori Git. Non e un canale runtime,
non scrive dati paziente e non cambia il default local-first.

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

- OCR/local parsing, con fallback Apple Vision solo su macOS quando il primario
  locale produce output vuoto o degenerato;
- review di suggerimenti;
- soppressione rumore quando una fonte non introduce novita clinica;
- create-flow document-driven con persistenza prudente delle terapie;
- coda OCR-needed con stati espliciti (pending, processing, ocr_done,
  ocr_failed, manual_review), motivi tracciati, pannello `Coda OCR` in upload
  documenti e replay idempotente post-OCR per hash documento: nessuna proposta
  clinica finche il testo non e sufficiente;
- estrazione identita documentale prudente: nessun fallback prima-data-trovata
  per la data di nascita (meglio assente che sbagliata), date costruite in
  UTC e codice fiscale riconosciuto anche in forma omocodica.

Fuori scope:

- auto-promozione di diagnosi/terapie da testo libero ambiguo;
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
