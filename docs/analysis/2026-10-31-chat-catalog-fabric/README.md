# Catalogo chat e Fabric 0.9.1

Refs WUL-788. Censimento del codice su `911f2c2e5cabeefc785ded119edc63cf95d1e187`,
prima delle modifiche di questa tranche. Fonti: registro I-0, `catalog.ts`,
`chat_access/adapter.rs`, `chat_access/owner.rs`, `shell/chat_access.rs`,
`native-access.html` e dossier broker del 30 ottobre.

C-7 e C-8 restano aperti. La presenza di un servizio o di un descriptor non
abilita la funzione nella chat. Il catalogo Fabric mantiene anche il descriptor
storico Treatment Reasoning: prevale il diniego di `ai-function-availability.ts`.
La prima tranche non modificava il contratto, il registro o la sua impronta.

## Raccordo operativo del 4 novembre 2026

Il [catalogo operativo generato](catalogo-operativo.md) deriva dai descriptor,
dai servizi, dai controlli di accesso, dai chiamanti e dai test del codice.
`npm run check:fabric-operational-catalog` verifica che sia aggiornato e nega
capacità senza controllo di permesso o senza test. Per rigenerarlo:
`npm run check:fabric-operational-catalog -- --write`. Il controllo e le sue
prove negative fanno parte di Repository Guards.

Il gate I-0 comprende sei celle: Patient Insight, Smart Import e Document
Synthesis su Ollama e ChatGPT. Le sei API OpenAI/Anthropic sono ora in
`optionalCells`, non qualificate e con `countsAsReleaseEvidence: false`.
Treatment Reasoning resta rinviato. Il contratto non cambia.

I negativi sintetici coprono ogni funzione e venue del gate: output
malformato, revoca durante l'esecuzione, indisponibilità e permesso mancante.
Il controllo del kill switch viene ripetuto dopo la risposta del provider:
una funzione disattivata durante il calcolo non pubblica la proposta. Le prove
ChatGPT sostituiscono solo il trasporto e, nei casi positivi, il confine egress
con doppioni dichiarati dal test esistente; non attestano account, contenimento
del processo o generazioni reali. Nessun account e nessuna inferenza a pagamento.

Restano non provati le generazioni ChatGPT reali con Leonardo, la parità dei
desktop installati e i raccordi clinici chat dichiarati non collegati sotto.
La tabella generata è una mappa dei riferimenti sorgente, non un grant né una
qualifica runtime. Le sezioni successive conservano le evidenze delle tranche.

## Raccordo del 10 novembre 2026: Quadro paziente

Il Quadro paziente è collegato alla chat con il comando app-only
`patient-insight`, senza argomenti. Il comando apre il Quadro del paziente
selezionato nella finestra MediFlow; consenso, generazione, fonti, ricevuta e
scarto restano lì. Alla chat tornano solo `insight-opened`,
`insight-unavailable`, `insight-busy`, `insight-closed` o il ritiro; «Revoca»
resta attivo nella carta finché la finestra prepara, attende il consenso o
genera. La
[nota di progetto](raccordi-c7-funzioni-generative.md) descrive i tre raccordi,
i negativi C-7 e dove si provano. Sintesi dei documenti e import assistito
restano non collegati. I due host desktop non sono qualificati.

## Funzioni e azioni effettive

Il trasporto MCP Apps corrente è lo stesso nei due host. La colonna prova indica
il test del componente, non un collaudo del desktop. In **Claude Desktop** e
**Codex desktop**, per tutte le righe, restano da provare sul candidato esatto:
ruolo/versione/capacità effettivi, tastiera, fonti e stati vuoto, stale e revocato.
Il frame automatizzato a 390 e 1440 px non sostituisce queste due prove.

| Funzione | Servizio comune | Vista/azione attuale | Permesso effettivo | Prova di componente | Residuo |
| --- | --- | --- | --- | --- | --- |
| Scheda | `createSyntheticCardBroker` | Storia, terapie e misure della fixture basic, mai archivio | Sessione paired, selezione, revisione byte e consenso nativo monouso | `synthetic-card-broker.test.ts`, `native-chat-access-frame.spec.ts`, Rust `chat_access::owner` | Scheda archivio non collegata; due host da qualificare |
| Terapie in lettura | Stesso broker | Massimo due terapie sintetiche | Stesso consenso della scheda | Stesse prove | Lettura terapie archivio non collegata |
| Farmaci | `RuntimeSession.chat_drug_search` → `drug_count` / `search_drugs`, servizio AIFA comune | Ricerca AIC/nome/principio attivo, massimo 20 risultati, solo vista app | Sessione, scope e selezione correnti; revisione byte e conferma nativa monouso | Spec frame e test Rust catalogo | Data di aggiornamento non verificata; qualificare i due host, nessuna prescrizione |
| Protesica | `RuntimeSession.chat_prosthetics_search` → `createProstheticsCatalog.search` | Ricerca repertorio locale, massimo 20 voci, solo vista app | Capability lettura protesica, sessione, scope, selezione e conferma nativa monouso | Spec frame, test route e Rust owner | Prescrizioni archivio non collegate; qualificare i due host |
| Quadro paziente | Patient Insight: vista GPUI `patient_insight`, route Web `patient-insight/preview` | Comando `patient-insight`: apre il Quadro nella finestra; consenso, proposta, fonti e ricevuta restano lì; alla chat solo stati | Sessione abbinata, selezione corrente, riammissione sul server (account, archivio, epoca), host locale aperto, interruttore della funzione | Rust `chat_access::owner` e `chat_access::tests`, `shell::patient_insight::tests::chat`, `lib/chat-card/patient-insight.test.ts`, spec frame | Due host da qualificare; Ollama e ChatGPT reali; budget end-to-end |
| Riassunto dei documenti | Document Synthesis | Nessuna generazione chat collegata | Nessun grant chat | Nessuna prova chat | Vista GPUI in lavorazione; raccordo previsto nella nota C-7 |
| Stato terapia | `createChatTherapyStatusService`, `executeTherapyStatusInTransaction` | active/suspended/completed e rilettura ricevuta | Native admin, tre capability network, selezione/archivio correnti, CAS, PIN e conferma nativa | `chat-therapy-status.test.ts`, `native-chat-write-approval.test.ts`, spec frame, Rust owner | Due host reali, disponibilità controlli per ruolo/versione/capacità |
| Nuovo paziente da PDF | `lib/native-patient-document.ts`, `lib/patient-document-create-command.ts` | Apre revisione nativa; nessun allegato chat usato | Selezione file e campi visti dal medico, revisione e conferma nativa, writer comune | `native-patient-document.test.ts`, `patient-document-create-command.test.ts`, spec frame | Due host reali; apertura non equivale a creazione |
| Altri comandi clinici | Servizi applicativi esistenti | Non collegati | Nessun grant generico | Nessuna prova chat | Censire ogni comando prima del grant; nessuna esecuzione libera |
| Ricerca e navigazione | `lib/headless/application-operation-registry.ts`, `lib/headless/canonical-capability-catalog.ts` | Nessun raccordo nel canale nativo chat | Descriptor manual_only/not_grantable non abilita un comando | Nessuna prova chat | Collegare soltanto operazioni nominate |

## Tutte le capability I-0

Per ogni riga non collegata: nessuna vista, nessun permesso chat, nessuna prova
chat, nessun ripiego. I test dei servizi esistenti non provano C-7. Il primo
passo residuo è il raccordo al servizio indicato, seguito da fonti, controllo
output locale/remoto, malformato/token estraneo, indisponibilità, scadenza e
revoca durante l'operazione. Tutti questi negativi restano richiesti per ciascun
raccordo nei due host.

| Capability | Servizio/entry point dal catalogo | Stato effettivo chat | Residuo |
| --- | --- | --- | --- |
| `patient_insight` | `app/api/ai/patient-insight/preview/route.ts` | Collegata, app-only: apre il Quadro nella finestra, alla chat solo stati; prova di componente | Due host da qualificare; provider reali e budget end-to-end |
| `smart_import` | `app/api/ai/smart-import/preview/route.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `document_synthesis` | `app/api/ai/document-synthesis/preview/route.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `ocr` | `nessuno` | Indisponibile nel catalogo | Mostrare indisponibilità, non sostituire AnyDoc/Apple Vision |
| `treatment_reasoning` | `app/api/ai/treatment-reasoning/preview/route.ts` | Esclusa dalla 0.9.1, diniego comune | Verificare diniego nei due host; nessuna generazione |
| `icd_lookup` | `lib/icd-service.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `aifa_drug_search` | `RuntimeSession.chat_drug_search`, servizio AIFA comune | Ricerca locale in sola lettura, conferma nativa, risultato app-only | Qualifica nei due host; aggiornamento del catalogo non verificato |
| `service_prescription_matching` | `lib/service-prescription-write.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `evidence_absorption` | `lib/domain/documents/evidence-queue-contract.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `patient_open_loops` | `lib/patient-open-loops.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `fhir_export` | `lib/fhir/bundle-generator.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `document_classification` | `lib/domain/documents/document-class-router.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `document_identity_resolution` | `lib/domain/documents/document-identity-resolution.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `pii_redaction_layer1` | `lib/ai-egress-gate.ts` | Solo preparazione scheda sintetica tramite ai-preparation | GLiNER reale documentato nel broker; C-7 generale e due host aperti |
| `fse_document_validation` | `lib/fse-validate-document.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
| `observation_range_classification` | `lib/observation-range.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |

| Requisito aggiuntivo | Servizio censito | Stato chat e residuo |
| --- | --- | --- |
| `anydoc` | `lib/domain/documents/anydoc-local-extraction-runner.ts` | Non collegato; raccordo e prova nei due host mancanti |
| `apple_vision` | `lib/domain/documents/ocr-service.ts` | Non collegato; raccordo e prova nei due host mancanti |
| `search` | `lib/headless/application-operation-registry.ts` | Non collegato; raccordo e prova nei due host mancanti |
| `navigation` | `lib/headless/canonical-capability-catalog.ts` | Non collegato; raccordo e prova nei due host mancanti |

## Dodici celle censite nella prima tranche

Ogni cella era **non qualificata nella chat**. Con l’emendamento del 4/11,
I-5 e I-6 sono opzionali e fuori gate;
ChatGPT richiede la decisione D-I1 su account e quota. Nessuna chiamata API,
generazione ChatGPT o inferenza locale è eseguita da questa tranche.

| Cella | Servizio comune da riusare | Vista/azione e permesso chat | Prova chat | Residuo |
| --- | --- | --- | --- | --- |
| `patient_insight/ollama` | `lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts` / composizione provider della funzione | Comando `patient-insight`; il provider lo sceglie la configurazione della funzione | Componente con host sintetico e risposta Ollama registrata | Ollama reale e identità modello nei due host; I-2 non qualificata |
| `patient_insight/openai.responses.v1` | `lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `patient_insight/anthropic.messages.v1` | `lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `patient_insight/chatgpt` | `lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts` / composizione provider della funzione | Stesso comando; il raccordo non dipende dal provider | Nessuna risposta ChatGPT nella prova chat | D-I1 e I-4 prima di generare; prova nei due host con ChatGPT come provider della funzione |
| `smart_import/ollama` | `lib/domain/documents/patient-smart-import-fabric.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | Raccordo locale, identità modello, fonti e negativi C-7; I-2 non qualificata |
| `smart_import/openai.responses.v1` | `lib/domain/documents/patient-smart-import-fabric.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `smart_import/anthropic.messages.v1` | `lib/domain/documents/patient-smart-import-fabric.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `smart_import/chatgpt` | `lib/domain/documents/patient-smart-import-fabric.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | D-I1 e I-4 prima di generare; raccordo e negativi C-7 |
| `document_synthesis/ollama` | `lib/ai-providers/fabric/document-synthesis-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | Raccordo locale, identità modello, fonti e negativi C-7; I-2 non qualificata |
| `document_synthesis/openai.responses.v1` | `lib/ai-providers/fabric/document-synthesis-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `document_synthesis/anthropic.messages.v1` | `lib/ai-providers/fabric/document-synthesis-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `document_synthesis/chatgpt` | `lib/ai-providers/fabric/document-synthesis-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | D-I1 e I-4 prima di generare; raccordo e negativi C-7 |

Le quattro celle Treatment Reasoning (`athena_mlx`, `openai.responses.v1`,
`anthropic.messages.v1`, `chatgpt`) sono rinviate separatamente nel registro.
Non entrano nelle dodici celle né possono riattivarsi con pesi o credenziali.

## Comandi del catalogo applicativo

Tutti i 66 anchor del catalogo **corrente nel codice** sono elencati sotto.
I titoli provengono dal crosswalk congelato e non sono nuova ammissione runtime.
`applicationServiceRef` e `operationId` sono `null` su ogni descriptor;
`manual_only`, `not_grantable` e `applyPolicy: none` restano effettivi. Per ogni
riga il servizio operativo è quindi **non risolto**, la vista/azione canonica
chat è **assente**, il permesso è **negato** e la prova chat è **mancante nei due
host**. La ricerca AIFA e le azioni native terapia/PDF nella prima tabella hanno il proprio
raccordo nominato e non rendono operativi questi anchor. Non si usa una CLI
storica per concedere un'azione chat.

| Riga | Funzione censita | Comando Mini associato dal registro operativo | Residuo |
| --- | --- | --- | --- |
| 1 | Anagrafica paziente: lista, ricerca, view, create, update | patient search; patient show | Servizio, azione, permesso e prova chat da risolvere |
| 2 | Archivia / soft-delete / ripristina paziente (stato scheda) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 3 | Diario clinico: view/list, create, update, soft-delete+restore, filtri | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 4 | Nuova voce clinica avanzata (S/O/A/P, allegati OCR, sessione visita, elabora bozza AI) | draft preview | Servizio, azione, permesso e prova chat da risolvere |
| 5 | Editor rich-text clinico (formattazione S/O/A/P) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 6 | Somministrazione scale cliniche (runner + salvataggio come voce diario) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 7 | Libreria/catalogo scale standalone con storico e scorciatoie | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 8 | Gestione terapie farmacologiche (CRUD + stato + collegamento diagnosi) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 9 | Ragionamento terapeutico AI (Treatment Reasoning, review-only) | Nessuno | Diniego di release da provare nei due host |
| 10 | Controlli/checkup follow-up (CRUD + stato) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 11 | Suggerimenti follow-up proiettati da documenti | open-loops | Servizio, azione, permesso e prova chat da risolvere |
| 12 | Osservazioni/parametri clinici (CRUD LOINC/UCUM + trend/sparkline) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 13 | Prestazioni prescritte (Service Prescriptions, CRUD ricco + stato) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 14 | Diario ausili e prescrizioni protesiche (CRUD + collaudo) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 15 | Upload documenti + OCR + sintesi clinica (Archivio documenti) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 16 | Archivio Intelligente / Document Insights (view estrazioni + delete) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 17 | Smart Import (candidati diagnosi/terapie da documenti, applica in scheda) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 18 | Referti recenti (Evidence Stack tile, view sintesi) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 19 | AI Patient Insight (sintesi/follow-up/alert generati) | Nessuno | Comando chat `patient-insight` app-only: apre il Quadro nella finestra; due host da qualificare |
| 20 | Foglio sinottico / Identity Lens / Review Queue (viste sintetiche cockpit) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 21 | Export FHIR paziente (con pre-check validazione FSE) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 22 | Report PDF paziente | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 23 | Esenzioni paziente (selezione/gestione codici cifrati) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 24 | Catalogo farmaci AIFA (ricerca/validazione prontuario) | Nessuno | Ricerca app-only tramite servizio catalogo comune e conferma nativa; descriptor manual_only invariato, freschezza e due host da qualificare |
| 25 | Ricerca ICD in-app per codifica diagnosi | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 26 | Ricerca terminologica generale (ICD/systems oltre in-app) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 27 | Selezione scope ambulatorio attivo | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 28 | Gestione anagrafica ambulatori (create/update/predefinita/svuota/elimina) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 29 | Cruscotto analytics locale (popolazione, età, diagnosi, ADI) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 30 | Pannello audit operativo locale | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 31 | Apertura portali regionali SISS/FSE (context panel + handoff diary) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 32 | Cockpit shell / rail navigazione globale + toolbar + deep-link | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 33 | Agenda di oggi / turno + bridge candidati agenda clinica | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 34 | Diario clinico globale cross-paziente (ultime 50 voci) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 35 | Cruscotto repertori clinici (AIFA/esenzioni/ICD freschezza) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 36 | Wizard nuova scheda da documento (PdfImporter + review + form) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 37 | Pairing + login operatore + PIN (deriva master key) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 38 | Cambio PIN / gestione ciclo di vita chiave (rewrap/reset) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 39 | Blocco sessione immediato / stato sessione | whoami | Servizio, azione, permesso e prova chat da risolvere |
| 40 | Profilo medico/ambulatorio (nome mostrato su documenti) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 41 | Preferenze UI: tema light/dark/system, riduci movimento | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 42 | Modalità Privacy / redazione dati | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 43 | Conversazioni AI e messaggi | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 44 | Configurazione/invocazione runtime AI (Ollama/modelli/kill switch) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 45 | Cache pazienti cifrata offline (consultazione degradata) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 46 | Backup: schedulazione automatica + ripristino manuale | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 47 | Diagnostica: architettura servizi + Diagnostic Hub + service health | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 48 | Update Awareness (aggiornamenti software) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 49 | Repertori: import CSV AIFA + gestione DB esenzioni | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 50 | Modelli AI: pull modello Ollama + profilo hardware | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 51 | Kill switch funzioni AI (stato read-only rilevante al client) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 52 | Network Operating Mode (gestione modalità boundary) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 53 | Zona pericolo: reset onboarding + sviluppo (seeder, apri app nativa, DB repair/purge) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 54 | Hub Impostazioni / governance (dashboard navigazione settings) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 55 | POST/GET /api/context (imposta/legge ambulatory_id come cookie di sessione) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 56 | Validazione documento FSE singolo (profilo->payload) via v1 | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 57 | GET /api/service-catalog (catalogo prestazioni) + famiglie distinte /api/service-prescriptions e /api/service-prescription-items | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 58 | POST /api/proxy/ollama/chat e POST /api/proxy/ollama/generate (proxy invocazione modello AI locale via Ollama), distinti da /api/conversations e /api/messages (CRUD storico) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 59 | GET /api/system/mlx (stato/gestione generico runtime MLX via PM2, admin-only, solo macOS), distinto da /api/system/treatment-reasoning/athena-mlx (generazione ragionamento terapeutico specifico, kill-switch dedicato) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 60 | GET /api/system/redaction (stato/health provider OpenMed per redazione PII) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 61 | GET /api/system/revision (fingerprint/branch/revisione build corrente, usato per rilevare mismatch versione) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 62 | POST/GET /api/system/fix-orphans (conteggio+riparazione righe cliniche orfane, admin-only) e POST /api/system/migrate-m2m (migrazione relazione paziente-ambulatorio da 1:1 a many-to-many, admin-only); DISTINTI dal generico /api/system/migrate (setup ambulatorio di default) e da repair-db/purge | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 63 | GET /api/v1/network/capabilities, /api/v1/network/identity, /api/v1/network/node (negoziazione capability host, identità di rete, sommario nodo); famiglie boundary distinte da pairing-intents/confirm e session | capabilities | Servizio, azione, permesso e prova chat da risolvere |
| 64 | /settings/ai (hub); redirect al registro Fabric, vista reale in sola lettura | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 65 | Registro Intelligence Fabric: 16 capability, 4 venue osservate e profili egress | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
| 66 | Governance AI: parliament dei modelli e prontezza al rollout | Nessuno | Servizio, azione, permesso e prova chat da risolvere |

| Host obbligatorio | Ruolo/versione/capacità | Fonti | Tastiera | Vuoto | Stale | Revocato |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Desktop | Non osservato sul candidato | Non osservato | Non osservato | Non osservato | Non osservato | Non osservato |
| Codex desktop | Non osservato sul candidato | Non osservato | Non osservato | Non osservato | Non osservato | Non osservato |

Questa matrice di accettazione si applica a ciascuna funzione, capability,
cella I e comando sopra: i test del frame non trasformano alcuna casella host
in PASS. Per funzioni non collegate il primo esito atteso è l'indisponibilità
esplicita, con nessuna concessione o ripiego.

## Prima tranche

Il valore clinico immediato è impedire che la vista presenti come scheda un
output locale malformato o lasci leggibili contenuti dopo un ritiro incerto.
Si mantengono broker, consenso e writer esistenti. La vista deve mostrare le
fonti opache per voce e le funzioni non collegate in modo esplicito. La scheda
resta sintetica. Nessun modello seleziona o compila campi clinici e nessun nuovo
writer viene introdotto. Contenuti di documenti e chat restano dati.

Prove ed esiti della tranche sono nella PR e nel rapporto di consegna locale.
Nessuna riga precedente diventa qualificata per effetto di questa descrizione.

## Seconda tranche: consultazione farmaci

Base della seconda tranche: `9694e5e4e60cde30953ae5e9a5f747d6a19f6d16`.

La ricerca AIFA riusa il lettore del catalogo della sessione nativa. Non legge
terapie o dati paziente e non invia query o risultati al modello. Il contesto
della selezione attuale resta richiesto dal canale: sessione, scope, archivio
e selezione vengono ricontrollati prima e dopo la lettura e prima del consumo.
La conferma nativa revisiona i byte esatti, con SHA-256 e scadenza esistenti.
I riferimenti fonte opachi sono per riga del risultato; AIC e provenienza
sono consultabili da tastiera. Il broker della scheda mantiene l'autorità
sui token PII; nessun token del catalogo viene ricomposto come dato paziente.

Un catalogo vuoto o non accessibile nega la consultazione. Una ricerca senza
corrispondenze mostra uno stato vuoto. Venti risultati segnalano il limite,
senza dichiarare completa la ricerca. La data del catalogo non è verificata:
la vista lo dichiara su risultati e fonti, senza attribuire freschezza. Revoca,
scadenza, cambio turno, stato sconosciuto e teardown ritirano la vista.

Questa PR non collega scheda archivio, lettura terapie archivio, protesica
o riassunto. La grammatica del broker sintetico non autorizza prosa clinica
arbitraria: occorre un raccordo dedicato ai servizi comuni con il confine di
redazione qualificato. Non si amplia qui quel confine. Restano aperti C-7,
C-8, tutte le celle generative e le prove desktop sul candidato. Treatment
Reasoning resta indisponibile; Provider API fermi. Nessuna scrittura nuova.

## Terza tranche: repertorio protesico

La ricerca protesica riusa il percorso AIFA di richiesta, binding di sessione,
scope, selezione, revisione byte e consumo monouso. Il servizio comune del
repertorio è esposto da una route nominata di sola lettura con la capability
protesica esistente. La proiezione scarta chiavi interne e mantiene codice,
sistema, descrizione, versione, fonte e ambito. Ogni riga riceve una fonte opaca.
Il frame valida uno schema chiuso e mostra le fonti anche da tastiera. Query e
risultati restano app-only, senza aggiornare il contesto del modello.

Catalogo assente, zero corrispondenze, troncamento a 20 risultati e aggiornamento
non verificato restano distinti. Revoca, scadenza e cambio selezione consumano
o ritirano i byte secondo il percorso esistente. Nessuna scrittura introdotta.

Consegna parziale C-8: scheda archivio, terapie archivio, prescrizioni protesiche
e riassunto restano non collegati. Il broker monouso attuale accetta soltanto
la grammatica sintetica; non costituisce un confine qualificato per prosa clinica
arbitraria. Non si aggira quel limite inviando i campi direttamente al frame.
Le celle generative e C-7 restano aperti. Treatment Reasoning indisponibile,
Provider API fermi. Prove desktop e review indipendente del diff finale richieste
prima dell'integrazione. Nessuna qualifica clinica implicita.

## Proiezioni cliniche dell'archivio

La ricognizione del raccordo clinico conferma il confine della terza tranche.
L'[estensione di ADR 0165](../../adr/0165-native-chat-access-channel.md#proiezioni-cliniche-dellarchivio-confine-e-selezione-da-approvare)
esplicita il profilo distinto necessario e la selezione dei campi ancora da
approvare. Non introduce codice o un'abilitazione clinica.

| Funzione | Servizio da raccordare | Vista e autorità | Prova del nuovo percorso | Stato |
| --- | --- | --- | --- | --- |
| Scheda archivio | `readPatientProfile`, query scoped `patient-profile.read.v1`, `RuntimeSession.open_patient_profile` | Proiezione clinica distinta, redazione locale e revisione dei byte nella UI nativa; solo pseudonimi nel frame app-only | Non eseguita: nessun raccordo implementato | Selezione dei campi da approvare; verticale non consegnata |
| Terapie archivio | Servizio terapie e `RuntimeSession.list_therapies` già usati dal client nativo | Lettura clinica separata dalla scrittura stato; nessuna uscita diretta dei DTO | Non eseguita: nessun raccordo implementato | Non collegata al broker clinico |
| Prescrizioni protesiche | Servizio prescrizioni e relativo client nativo; distinto da `chat_prosthetics_search` | Dati del paziente, non risultati del repertorio | Non eseguita: nessun raccordo implementato | Non collegate; ricerca del repertorio resta distinta |
| Riassunto | Percorso Fabric ammesso dalla release, con controllo anche del risultato locale | Proposta con fonti, consenso e token validati; nessuna nuova autorità del modello | Non eseguita: nessun raccordo implementato | Non collegato; celle generative C-7 aperte |

Le prove della grammatica sintetica, dei repertori e del cambio stato terapia
non qualificano queste quattro letture. La matrice non attesta parità né
accettazione C-B/C-3/C-4/C-7/C-8 sui due desktop.

## C-9b: agenda e prenotazione

Censimento della base `7c9d33ddf`. La tranche collega la sola consultazione
app-only dell’agenda interna al lettore comune
`RuntimeSession.list_agenda_with_filter` e a `/api/v1/network/checkups`.
L’operazione nominata `agenda` non accetta campi dal modello. Proietta al massimo
20 date e stati con fonti opache per riga. Titoli, note, chiavi e nomi non
entrano nel payload del frame né nel contenuto restituito al modello.
La conferma nativa riguarda i byte finali con hash, scadenza e consumo singolo.
Sessione, archivio e selezione sono ricontrollati; il consumo richiede anche
una nuova lettura autorizzata dell’agenda. Nessuna nuova route e nessun
cambiamento dei contratti consumati da Swift.

| Percorso | Servizio esistente | Stato chat | Residuo C-9b |
| --- | --- | --- | --- |
| Agenda interna | `lib/network-checkup-read.ts`, `RuntimeSession.list_agenda_with_filter` | Lettura app-only con consenso nativo, massimo 20 controlli, data e stato | Prova desktop sui due host; limite distinto da elenco completo |
| Candidati da calendario | `lib/clinical-agenda-bridge.ts`, `/api/clinical-agenda/candidates` | Non collegati; nessuna lettura dei calendari introdotta | Restano candidati da revisionare, senza equivalenza con appuntamenti confermati |
| Prenotazione confermata | `lib/chat-checkup-booking.ts` sopra `createCheckupOperation` di `lib/checkup-write-operation.ts`; route `/api/auth/native/checkup-booking` | Comando `booking` senza campi dal modello: data e ora scritte e viste nella finestra nativa, titolo fisso, PIN, approvazione monouso, selezione ricontrollata, CAS sulla revisione dell’agenda, audit `native` e ricevuta durevole | Prova desktop sui due host; nessuna modifica o annullamento da chat |
| Attività territoriali | `lib/territorial-pack-store.ts`, writer territoriali nominati | Nessun grant chat e nessuna azione esposta | Collegare soltanto operazioni nominate con controllo del pacchetto sotto la transazione del writer; pacchetto spento deve negarle |
| Invio istituzionale | Nessun servizio ammesso da questo raccordo | Non disponibile | Nessun invio autorizzato |

Il lettore dell’agenda interna appartiene al nucleo comune e non abilita una
capacità territoriale. Non si impone un pacchetto regionale per consultare
controlli interni. Nessun comando territoriale è aggiunto al canale.
Il percorso Web/native ordinario di creazione e aggiornamento dei controlli
ha un writer comune con audit obbligatorio e CAS sugli aggiornamenti; non è
una prenotazione chat confermata. Il solo `201` della creazione non fornisce
la ricevuta durevole del comando e non viene presentato come tale.

### Prenotazione confermata (corsia c9b-prenotazione)

La coppia minima lettura/prenotazione è collegata nel codice. Il comando
`booking` della card non porta campi. All’apertura la finestra GPUI riceve,
dalla stessa transazione, la revisione dell’agenda della cartella selezionata
e i controlli da oggi in avanti (i 20 più vicini, solo data e stato, nessun
testo libero) con il numero dei controlli futuri rimasti fuori, e li mostra
prima del campo data. La CAS copre l’intero insieme, passati ed eliminati
compresi. Il medico scrive data e ora (`GG/MM/AAAA HH:MM`, dal giorno
locale corrente a due anni; per l’ora saltata o ripetuta del cambio d’ora un
messaggio dedicato) e vede l’anteprima. Il titolo è fisso
(«Controllo»), nessuna nota, stato da svolgere. La conferma usa il PIN nativo e
l’approvazione monouso di `lib/native-chat-write-approval.ts`, consumata prima
dell’attesa del PIN; sessione, archivio, selezione e scadenza sono ricontrollati
dentro la transazione.

La scrittura passa da `createCheckupOperation`, il writer comune di Web e
paired, senza modificarlo. Ammissione, ricevuta già presente e CAS girano come
guardia di commit nella stessa transazione IMMEDIATE del writer. La revisione
dell’agenda è un’impronta SHA-256 dell’insieme (id, versione, cancellazione)
dei controlli del paziente: cambia per ogni inserimento, modifica o
cancellazione, anche fisica, senza contare sulla crescita delle versioni. Se è cambiata dall’apertura la prenotazione è
respinta con `version_conflict`.

La ricevuta è l’evento di audit legato al `commandId` (`checkup.created`,
superficie `native`, flag `chat:checkup-booking`): `success` con il controllo
creato con id uguale al comando, oppure `denied` con motivo `version_conflict`.
Sta nelle tabelle già esportate dal backup portabile, quindi sopravvive al
riavvio e al backup senza un nuovo registro; il test del backup esporta e
valida un archivio con una prenotazione applicata e una respinta. Se un
ripristino da un’esportazione senza audit riporta il controllo senza la sua
ricevuta, la rilettura risponde applicata e storica, mai ritirata, solo se il
controllo è della cartella selezionata nell’ambito; l’esecuzione non usa mai
questo ripiego. Una ricevuta importata da un ripristino è marcata storica e la
card la mostra come presente in agenda senza dire «auditato».

Il riferimento del comando resta nel deposito locale della GPUI insieme al
tipo (terapia o prenotazione). Dopo un riavvio, e dal pulsante «Rileggi
esito» della card, la rilettura usa solo la route di quel tipo; il pulsante
della prenotazione non legge né cancella un riferimento salvato come terapia.
Un riferimento salvato prima che il tipo venisse registrato prova le route che
l’abbinamento concede; un 403 viene superato solo se l’altra route trova
davvero il comando, altrimenti l’esito resta incerto. Una
risposta persa si riconcilia dalla ricevuta senza ripetere la scrittura.

C-9b resta aperta per le prove sui due desktop reali, non eseguite qui.
Candidati da calendario, calendari personali, attività territoriali e invii
istituzionali restano non collegati. Il profilo clinico della PR #765 non viene
modificato.
