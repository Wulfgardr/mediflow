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
| Farmaci | `lib/aifa-catalog.ts` | Nessuna ricerca chat | Nessun grant chat | Nessuna prova chat | Collegare ricerca e revisione nativa, freschezza e fonti |
| Protesica | `lib/prosthetic-prescription-write.ts`, `lib/reference-data/prosthetics-catalog-service.ts` | Nessuna azione chat | Nessun grant chat; writer richiede scope, versione e audit | Nessuna prova chat | Ricerca, lettura e revisione nel writer comune |
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
| `aifa_drug_search` | `lib/aifa-catalog.ts` | Non collegata | Raccordo e tutti i negativi C-7 nei due host |
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
| `patient_insight/ollama` | `patient-insight-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | Raccordo locale, identità modello, fonti e negativi C-7; I-2 non qualificata |
| `patient_insight/openai.responses.v1` | `patient-insight-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `patient_insight/anthropic.messages.v1` | `patient-insight-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `patient_insight/chatgpt` | `patient-insight-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | D-I1 e I-4 prima di generare; raccordo e negativi C-7 |
| `smart_import/ollama` | `smart-import-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | Raccordo locale, identità modello, fonti e negativi C-7; I-2 non qualificata |
| `smart_import/openai.responses.v1` | `smart-import-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `smart_import/anthropic.messages.v1` | `smart-import-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `smart_import/chatgpt` | `smart-import-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | D-I1 e I-4 prima di generare; raccordo e negativi C-7 |
| `document_synthesis/ollama` | `document-synthesis-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | Raccordo locale, identità modello, fonti e negativi C-7; I-2 non qualificata |
| `document_synthesis/openai.responses.v1` | `document-synthesis-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `document_synthesis/anthropic.messages.v1` | `document-synthesis-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | I-5/I-6 fermi; accesso e spesa da autorizzare, poi prove reali e negativi C-7 |
| `document_synthesis/chatgpt` | `document-synthesis-production-operation.ts` / composizione provider della funzione | Non collegati; nessun grant | Nessuna | D-I1 e I-4 prima di generare; raccordo e negativi C-7 |

Le quattro celle Treatment Reasoning (`athena_mlx`, `openai.responses.v1`,
`anthropic.messages.v1`, `chatgpt`) sono rinviate separatamente nel registro.
Non entrano nelle dodici celle né possono riattivarsi con pesi o credenziali.

## Prima tranche

Il valore clinico immediato è impedire che la vista presenti come scheda un
output locale malformato o lasci leggibili contenuti dopo un ritiro incerto.
Si mantengono broker, consenso e writer esistenti. La vista deve mostrare le
fonti opache per voce e le funzioni non collegate in modo esplicito. La scheda
resta sintetica. Nessun modello seleziona o compila campi clinici e nessun nuovo
writer viene introdotto. Contenuti di documenti e chat restano dati.

Prove ed esiti della tranche sono nella PR e nel rapporto di consegna locale.
Nessuna riga precedente diventa qualificata per effetto di questa descrizione.
