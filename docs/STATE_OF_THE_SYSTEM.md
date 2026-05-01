# Stato del Sistema MediFlow

> [!IMPORTANT]
> **Stato documento: CANONICAL (lettura completa dello stato corrente).**
> Questo documento e il punto di lettura piu ampio per capire cosa esiste oggi,
> cosa e solo direzione dichiarata e quali boundary non vanno superati.
>
> Per i principi stabili prevalgono sempre [ARCHITECTURE.md](../ARCHITECTURE.md)
> e [SECURITY.md](../SECURITY.md). Per il flusso operativo end-to-end prevale
> [docs/walkthrough.md](./walkthrough.md). Le priorita operative a breve restano
> nel piano engineering del workspace sorgente.

Ultimo aggiornamento: 2026-05-01

---

## 1. Lettura rapida

MediFlow e una cartella clinica local-first per il lavoro territoriale quotidiano.
Lo stato corrente non va letto come una semplice web app con AI aggiunta: e un
sistema locale ibrido in cui il Mac resta il nodo autorevole, il database e
SQLite cifrato, la web app e la superficie primaria, i client Apple futuri si
appoggiano a contratti locali versionati e ogni integrazione esterna resta
dentro boundary documentati.

La fotografia corrente e questa:

- **Superficie primaria**: web app Next.js locale, avviata sul Mac.
- **Shell ufficiale**: `Clinical Workbench / Graphite`, unica shell supportata
  su `main`.
- **Storage autorevole**: un solo file SQLite locale (`medical.db`), con accesso
  server via Drizzle e cifratura client-side dei campi clinici.
- **Sicurezza di default**: local-only, zero-knowledge a riposo, nessun cloud o
  telemetry default-on.
- **Contratto condiviso**: `/api/v1/*` per client native/locali; OpenAPI come
  riferimento anti-drift per la parte stabile.
- **Home-base**: modalita opt-in in cui il Mac espone una first slice
  `/api/v1/network/*` read-only verso client paired su rete fidata.
- **Document intelligence**: Smart Import, nuova anagrafica da documento e
  `AI Patient Insight` restano reviewable; gli allegati possono persistere
  artifact cifrati `parse/evidence`.
- **AI**: runtime locale per default, benchmark e shadow lane separati dal
  prodotto clinico.
- **SISS/FSE**: handoff contestuale e flussi `webapp-assisted`; nessuna
  integrazione regionale nativa certificata dichiarata senza `SSI/A2A` e scenari
  approvati.
- **OSS**: la repo pubblica deve restare prodotto-centrica, senza materiale
  interno di coordinamento, attribuzione agentica, piani privati o runtime data.

---

## 2. Cosa e gia deciso

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
- runtime AI remoto come default;
- upload automatico di documenti clinici;
- database remoto multi-tenant;
- bypass del nodo Mac `home-base` per i client mobili.

### 2.2 La shell web ufficiale e una sola

`Clinical Workbench / Graphite` e la shell web ufficiale. I vecchi confronti di
stile e i `Preview Profiles` funzionali sono ritirati da `main`.

Conseguenze pratiche:

- non si aggiungono nuovi chooser permanenti per shell alternative;
- AI, Smart Import e contesto paziente SISS sono parte del workbench quando
  maturi;
- nuove sperimentazioni devono vivere come workstream espliciti, non come
  selector nascosti nelle impostazioni;
- la documentazione pubblica deve parlare di una sola esperienza supportata.

Documenti/ADR principali:

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

Oggi la first slice disponibile e read-only. Write remoti, sync record-level,
replica automatica e multi-master sono fuori scope corrente.

Documenti/ADR principali:

- [ADR 0034](./adr/0034-local-only-default-and-network-home-base-opt-in.md)
- [ADR 0038](./adr/0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md)

### 2.4 Il documento e evidenza, non testo da ingoiare

La direzione document intelligence e `artifact-first`:

- il documento viene normalizzato;
- OCR/estrazione restano locali;
- il risultato va trattato come evidenza reviewable;
- `summarySnapshot` e `parseEvidenceArtifactSnapshot` sono dati clinici e
  persistono cifrati;
- `patients.documentInsights` resta una projection compatibile, non il modello
  finale ideale.

Il sistema non deve promuovere automaticamente diagnosi o terapie solo perche
compaiono in testo libero. La scrittura strutturata richiede review e soglie di
certezza documentate.

Documenti/ADR principali:

- ADR 0040 (private)
- [ADR 0042](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md)

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

## 3. Superfici runtime

| Superficie | Stato | Uso reale | Boundary |
| --- | --- | --- | --- |
| Web app locale | Primaria | Lavoro clinico quotidiano sul Mac | HTTP localhost, sessione web |
| `/api/*` | Runtime web | CRUD, auth, proxy locali, sistema | Session cookie |
| `/api/v1/*` | Contratto locale/shared | Client native e superfici stabili | Bearer token locale, TLS proxy |
| `/api/v1/network/*` | First slice home-base | Lista/dettaglio pazienti read-only da device paired | Credenziale device + sessione operatore |
| macOS storico | Snapshot congelato | Riferimento di parity e compat, non base del prossimo sviluppo | Rebuild controllato |
| iPhone/iPad | Direzione post-v0.5 | Client paired non-AI, cache derivata futura | No SQLite diretto |
| Ollama | Opzionale locale | AI/OCR/sintesi dove disponibile | Solo localhost |
| ICD-11 Docker | Opzionale locale | Diagnosi/coding | Solo localhost |
| OpenMed | Shadow/benchmark | Redaction lane locale non client-facing | Non runtime clinico |

---

## 4. Percorso dati clinici

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
2. Normalizzazione input e OCR locale.
3. Sintesi/estrazione locale.
4. Persistenza cifrata di:
   - allegato;
   - `summarySnapshot`;
   - `parseEvidenceArtifactSnapshot`;
   - projection `documentInsights` quando serve compatibilita.
5. Consumer reviewable:
   - `AI Patient Insight`;
   - Smart Import;
   - nuova anagrafica da documento;
   - troubleshooting documentale.

### 4.4 Home-base read-only

1. Operatore abilita `network-home-base`.
2. Device remoto apre un pairing intent PHI-safe.
3. Nodo Mac conferma esplicitamente il device.
4. Il device riceve una credenziale dedicata.
5. Le route `/api/v1/network/patients*` rispondono solo se:
   - device paired valido;
   - sessione operatore valida sul nodo;
   - scope clinico risolto dal nodo.
6. Il data plane resta read-only.

---

## 5. AI stack e regole di promozione

### 5.1 Runtime operativo

Il runtime AI operativo resta locale. Il default generativo protetto e trattato
come baseline finche benchmark e governance non giustificano un cambio.

Le superfici operative includono:

- `AI Patient Insight`;
- Smart Import reviewable;
- sintesi documentale;
- eventuali helper locali di normalizzazione/estrazione.

### 5.2 Lane benchmark-only

Le lane seguenti non vanno lette come runtime clinico disponibile solo perche
sono documentate o benchmarkate:

- OpenMed redaction;
- HUMADEX / OpenMed NER;
- challenger generativi non promossi;
- TurboQuant / MLX runtime experiments;
- comparator cloud opt-in.

Per promuovere una lane servono:

- corpus sintetico o case pack governato;
- benchmark ripetibile;
- stop-rules;
- shadow mode quando applicabile;
- rollback/fallback chiari;
- aggiornamento docs/ADR se cambia un boundary.

### 5.3 Comparator cloud

Il comparator cloud e ammesso solo come strumento interno opt-in di engineering,
su case pack privati redatti/minimizzati e fuori Git. Non e un canale runtime,
non scrive dati paziente e non cambia il default local-first.

---

## 6. Documentazione: come leggere il repository

### 6.1 Percorso consigliato per capire tutto

1. [README.md](../README.md): ingresso prodotto.
2. [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md): lettura completa
   dello stato corrente.
3. [ARCHITECTURE.md](../ARCHITECTURE.md): principi stabili.
4. [SECURITY.md](../SECURITY.md): threat model, privacy, logging e redazione.
5. [docs/walkthrough.md](./walkthrough.md): flusso end-to-end.
6. [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md): percorsi dati
   e trust boundaries.
7. [docs/README.md](./README.md): mappa canonica e fonti autorevoli per tema.
8. [docs/markdown-index.md](./markdown-index.md): inventario completo.
9. [docs/adr/README.md](./adr/README.md): decisioni architetturali.
10. Piano engineering privato: priorita operative a breve, disponibile solo nel
    workspace sorgente quando presente.

### 6.2 Documenti pubblici vs documenti privati

Il workspace sorgente puo contenere:

- piani operativi a breve;
- attribution agentica;
- playbook interni di delivery e tracciabilita;
- runbook interni di benchmark e shadow evaluation;
- riferimenti a vault o workspace locali privati, sempre senza PHI in Git.

La repo OSS deve contenere:

- prodotto e installazione;
- architettura e sicurezza;
- roadmap pubblica;
- FAQ;
- walkthrough e documenti canonici non interni;
- ADR pubblicabili;
- script runtime necessari alla app nuda.

La repo OSS non deve contenere:

- database reali o runtime artifacts;
- `medical.db`, `.sqlite`, `.sqlite3`, `.next`, `tmp-*`;
- piani interni e attribution agentica;
- riferimenti a tracker interni, branch interni, coordinamento agentico o materiali non
  esportabili;
- documenti riservati o fonti autenticate del corpus SISS/FSE.

---

## 7. Stato per area funzionale

### 7.1 Pazienti e cartella clinica

Disponibile:

- anagrafica paziente;
- diario clinico;
- terapie;
- osservazioni;
- appuntamenti/checkup;
- allegati;
- archiviazione paziente;
- campi strutturati e projection documentale;
- versioning/compare-on-write sui percorsi rilevanti.

Da preservare:

- cifratura client-side;
- conflitti espliciti;
- audit PHI-safe;
- niente scritture remote non governate.

### 7.2 Backup, restore e continuita

Disponibile:

- artifact backup v1;
- preflight restore;
- scheduler notturno via macOS `launchd`;
- retention `keep-last-N`;
- guardrail anti-regressione.

Da preservare:

- nessun backup con PHI in repo;
- restore distruttivo solo dopo preflight;
- documentazione aggiornata quando cambiano manifest o schema.

### 7.3 Smart Import e nuova anagrafica da documento

Disponibile:

- OCR/local parsing;
- review di suggerimenti;
- soppressione rumore quando una fonte non introduce novita clinica;
- create-flow document-driven con persistenza prudente delle terapie.

Fuori scope:

- auto-promozione di diagnosi/terapie da testo libero ambiguo;
- import silenzioso di documenti reali senza review;
- uso di documenti reali come fixture Git.

### 7.4 SISS, FSE e Protesica

Disponibile:

- pannello contestuale paziente SISS;
- launcher/handoff verso percorsi ufficiali;
- prescrittivo `webapp-assisted`;
- corpus locale SISS/FSE con sync/freshness;
- diario locale protesico document-backed e handoff `Protesica-RL`.

Fuori scope:

- canale SISS nativo certificato non dimostrato;
- UI prescrittiva custom sostitutiva del modulo regionale;
- scraping aggressivo;
- bypass di autenticazioni o vincoli regionali.

### 7.5 Apple/native

Disponibile:

- shell macOS storica come snapshot;
- contratto `/api/v1`;
- TLS proxy locale;
- runbook native/testing/parity;
- direzione ADR per rebuild family Apple.

Direzione:

- macOS packaged `home-base`;
- shared core Swift;
- iPhone/iPad paired;
- parity non-AI tramite API;
- cache locale cifrata derivata e riconciliazione esplicita.

Fuori scope corrente:

- accesso diretto a SQLite da mobile;
- sync cloud;
- write remote generici;
- AI plane remoto dentro il data plane clinico.

---

## 8. Regole di manutenzione

Quando cambia una feature runtime:

- aggiorna il documento canonico dell'area;
- aggiorna [docs/walkthrough.md](./walkthrough.md) se cambia il flusso reale;
- aggiorna [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) se
  cambiano trust boundary, API o percorsi dati;
- aggiorna [docs/README.md](./README.md) se cambia la fonte autorevole;
- aggiorna [docs/markdown-index.md](./markdown-index.md) se aggiungi, rimuovi o
  rinomini Markdown;
- aggiorna il piano engineering privato se cambia priorita operativa.

Quando cambia un boundary:

- scrivi o aggiorna ADR prima del codice;
- verifica [SECURITY.md](../SECURITY.md);
- verifica impatto OpenAPI se riguarda `/api/v1`;
- dichiara esplicitamente cosa resta fuori scope.

Quando esporti OSS:

- esegui `MEDIFLOW_OSS_TARGET_DIR=<target> npm run prepare:oss` su una
  destinazione di prova;
- verifica che non compaiano DB, runtime artifacts o documenti interni;
- cerca termini interni e riferimenti privati;

---

## 9. Check rapidi

### 9.1 Verifica docs-only

Per una modifica solo documentale:

```bash
git diff --check
rg --files -g '*.md' | sort
MEDIFLOW_OSS_TARGET_DIR=/tmp/mediflow-oss-docs-check npm run prepare:oss
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
- home-base network: `npm run test:network:home-base-readonly`
- document intelligence: `npm run test:document-synthesis`, `npm run
  test:ai-context`, `npm run test:pdf-service`
- nuova anagrafica da documento: `npm run test:patient-document-import`

---

## 10. Stop rules

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
- una modifica OSS trascina riferimenti interni;
- il worktree contiene cambi non correlati.
