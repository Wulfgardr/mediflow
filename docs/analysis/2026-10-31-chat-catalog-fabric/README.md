# Catalogo chat e Fabric 0.9.1

Refs WUL-788. Censimento del codice su `911f2c2e5cabeefc785ded119edc63cf95d1e187`,
prima delle modifiche di questa tranche. Fonti: registro I-0, `catalog.ts`,
`chat_access/adapter.rs`, `chat_access/owner.rs`, `shell/chat_access.rs`,
`native-access.html` e dossier broker del 30 ottobre.

C-7 e C-8 restano aperti. La presenza di un servizio o di un descriptor non
abilita la funzione nella chat. Il catalogo Fabric mantiene anche il descriptor
storico Treatment Reasoning: prevale il diniego di `ai-function-availability.ts`.
Non si modifica il contratto, il registro o la sua impronta.

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
| Riassunto | Patient Insight, Document Synthesis | Nessuna generazione chat collegata | Nessun grant chat; proposta e consenso Fabric richiesti | Nessuna prova chat | Tre provider più ChatGPT per funzione, fonti e negativi C-7 |
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
| `patient_insight` | `app/api/ai/patient-insight/preview/route.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
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

## Dodici celle generative rimaste

Ogni cella è **non qualificata nella chat**. I-5 e I-6 restano fermi;
ChatGPT richiede la decisione D-I1 su account e quota. Nessuna chiamata API,
generazione ChatGPT o inferenza locale è eseguita da questa tranche.

| Cella | Servizio comune da riusare | Vista/azione e permesso chat | Prova chat | Residuo |
| --- | --- | --- | --- | --- |
| `patient_insight/ollama` | `lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | Raccordo locale, identità modello, fonti e negativi C-7; I-2 non qualificata |
| `patient_insight/openai.responses.v1` | `lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `patient_insight/anthropic.messages.v1` | `lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `patient_insight/chatgpt` | `lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | D-I1 e I-4 prima di generare; raccordo e negativi C-7 |
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
| 19 | AI Patient Insight (sintesi/follow-up/alert generati) | Nessuno | Servizio, azione, permesso e prova chat da risolvere |
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
