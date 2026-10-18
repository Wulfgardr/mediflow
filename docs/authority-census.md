---
summary: "C01: owner delle autorità correnti, copertura delle mutazioni e disposizione dei candidati già individuati."
read_when:
  - "Verificare il censimento C01 o scegliere una semplificazione senza trasferire autorità."
---

# Autorità e disposizioni del censimento C01

Questa mappa accompagna [WUL-705](https://linear.app/wulfgardr/issue/WUL-705).
Descrive il codice versionato insieme al documento, non disponibilità sul Mac,
esecuzione di test o qualifica clinica. Il [CSV delle mutazioni](./clinical-write-surfaces.csv)
è la fonte unica per ingressi, owner e differenze delle garanzie; il
[roster](./clinical-write-roster.md) conserva significati e prove delle famiglie.
Le fonti storiche restano storia, non una seconda mappa corrente.

## Copertura e differenze

La riconciliazione segue route e caller della facade fino ai writer ORM/SQL,
compresi nomi tabella risolti tramite schema e helper di cascade/membership.
P/E/T/O/C/PR/SP/A/B/D/S/M sono gli ingressi HTTP; `X-*` sono caller composti,
non nuove autorità né un'altra copia degli endpoint. Un PUT può comprendere
più transizioni lifecycle del profilo. I percorsi assenti restano assenti.

- `H-*` distingue append SOAP esportato e commit checkup trusted Web. MCP/Mini
  possono preparare proposte, non ottenere proof o commit. Il catalogo
  [headless canonico](../lib/headless/canonical-capability-catalog.ts) descrive
  ancore manuali non concedibili: non prova la raggiungibilità di un writer.
- `R-*` registra persistenza dell'envelope, link paziente e decisione terminale.
  Le ricerche degli export nei sorgenti, negli script e nei manifest non trovano
  caller prodotto di create/link/command; il worker del record store è un harness
  di prova. Il command ha audit atomico, record/link no: non sono applicazione
  clinica né servizi da concedere agli agenti per colmare una differenza.
- `L-01` e `X-13` sono ritirati in WUL-774 dopo la verifica dell'assenza di
  caller runtime: helper Smart Import ed export legacy della sintesi sono rimossi.
  La route legacy conserva il `410` autenticato; le preview Fabric non scrivono
  la cartella. Le righe storiche restano nel CSV con disposizione `retired`.
- I writer raw di [attachment-currentness-host](../lib/attachment-currentness-host.ts)
  sono raggiunti da D-01/D-02 dentro l'audit dell'adapter, non da local-extraction:
  la rilettura extraction è preview; cancellarne il grant non elimina l'allegato.
  Il [guard esistente](../scripts/check-attachment-currentness-writers.mjs)
  distingue delegati, migration, restore e script sintetici.
- D-06 è backfill CLI con conferma e backup: CAS e transazione sono presenti,
  audit no. M-04 è la route legacy migrate: transazione presente, CAS, bump e audit
  assenti. Sono differenze osservate, non lavori dichiarati aperti in WUL-720,
  che è conclusa. La destinazione proposta è [WUL-730](https://linear.app/wulfgardr/issue/WUL-730)
  per manutenzione/custodia; il responsabile decide se il danno richiede intervento
  bloccante nel [padre](https://linear.app/wulfgardr/issue/WUL-717).

La tabella `document_diagnosis_proposals` è raggiunta da restore/cascade, non
da un writer indipendente individuato nel codice corrente.

La mappa non afferma che una ricerca testuale dimostri assenza di consumatori
esterni. Gli export non collegati restano censiti come tali; restore, bootstrap
e script di fixture sono classificati qui sotto, non eliminati dall'analisi.

## Altre autorità: owner e fonte da consultare

| Responsabilità | Owner / ingresso corrente | Confine e fonte unica del dettaglio |
| --- | --- | --- |
| Apertura e allineamento schema clinico | [sqlite-schema-open](../lib/sqlite-schema-open.ts) → [sqlite-schema](../lib/sqlite-schema.ts); [db-server](../lib/db-server.ts) | Guard, originale recuperabile e commit schema; [ADR0080](./adr/0080-serialize-sqlite-schema-guards-at-bootstrap.md). `schema.ts` dichiara ORM, `drizzle/` conserva storia. |
| Schema dati di riferimento | [exemption-catalog-schema](../lib/exemption-catalog-schema.ts), [prosthetics-catalog-schema](../lib/reference-data/prosthetics-catalog-schema.ts) | Cataloghi distinti dalla cartella; non attribuire loro un writer di prescrizioni. |
| Repair/swap del database | [repair-db](../app/api/system/repair-db/route.ts), [maintenance-admission](../lib/sqlite-maintenance-admission.mjs) | Autorità admin e originale recuperabile; [ADR0142](./adr/0142-sqlite-maintenance-admission.md), WUL-730. |
| Import/ripristino e storico | [backup-restore route](../app/api/system/backup-restore/route.ts) → [executor](../lib/backup-restore-executor.ts) | Sostituzione/merge, audit storici e ledger SOAP non sono CRUD ordinario; [backup artifact](./adr/0016-backup-artifact-v1-manifest-preflight.md), WUL-730. |
| Scheduler e backup automatici | [backup-scheduler](../app/api/system/backup-scheduler/route.ts), [scheduled backup](../scripts/run-scheduled-backup.mjs) | Configurazione OS e DB sono due autorità; [audit-writers](./audit-writers.md#sicurezza-e-amministrazione). |
| Vita processi Web/MCP/Mini | [launcher](../scripts/mediflow-headless-supervisor.mjs) → [supervisor production](../lib/security/portable-supervisor-production.ts) | Avvio, terminazione e autorità figli; [ADR0117](./adr/0117-headless-portable-agent-first-and-capability-first-fabric.md), WUL-727. |
| Worker documentali/modelli locali | [AnyDoc runner](../lib/domain/documents/anydoc-local-extraction-runner.ts), [Treatment operation](../lib/ai-providers/fabric/treatment-reasoning-production-operation.ts) | Processi bounded, nessun provider alternativo implicito; [ARCHITECTURE](../ARCHITECTURE.md#application-services-fabric-e-headless-085). |
| Sessioni e chiavi Web/native | [web auth owner adapter](../lib/security/web-auth-lifecycle-owner-adapter.ts), [client session](../lib/security/client-security-session.ts) | Custodia nella [matrice dati a riposo](./data-at-rest-matrix.md#chiavi); credenziale corrente [ADR0143](./adr/0143-strong-unlock-credential.md). Nessuna copia della matrice qui. |
| Segreti provider e OAuth | [secret broker](../lib/ai-providers/v2/provider-secret-broker.ts) | Accesso distinto da login consumer e subscription; [ADR0112](./adr/0112-provider-v2-secret-broker-and-official-cloud-adapters.md). |
| Egress provider ufficiali | [OpenAI transport](../lib/ai-providers/v2/openai-responses-official-transport.ts), [Anthropic transport](../lib/ai-providers/v2/anthropic-messages-official-transport.ts) | Host opt-in e prova sintetica default OFF; [matrice AI](./ai-runtime-serving-matrix.md). Non usare la presenza dell'adapter come autorizzazione. |
| Egress consumer e locale AI | [ordinary chokepoint](../lib/chatgpt-execution/ordinary-egress-chokepoint.ts), [Ollama locality](../lib/ai-providers/ollama-locality.ts) | [ADR0134](./adr/0134-chatgpt-subscription-synthesis-execution.md) e [matrice AI](./ai-runtime-serving-matrix.md); loopback e remoto sono distinti. |
| Terminologia WHO e aggiornamenti | [WHO node HTTPS](../lib/reference-data/icd11-who-node-https-client.ts), [WHO locale](../lib/reference-data/icd11-who-local-node-transport.ts), [update awareness](../lib/update-awareness.ts) | Sorgenti e opt-in nei rispettivi adapter; [ADR0115](./adr/0115-icd11-who-reference-data-adapter.md). Aggiornamenti software non inviano la cartella. |
| Rete client paired | [TLS proxy](../scripts/local-api-tls-proxy.mjs), [network context](../lib/network-write-context.ts) | Rete autorizzata distinta da API v1 locale; scope e capability nei wrapper, [topologia](./topologia-dati-flussi.md#410-modalità-network-home-base---paired-client-readwrite-limitato). |
| Workspace Apple e core SQLite sperimentale | [Factory della scheda Apple](../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift) → [HomeBasePatientsClient](../native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePatientsClient.swift); store [SQLitePatientStore](../native/MediFlowMac/Sources/MediFlowCore/SQLitePatientStore.swift) / [SQLiteClinicalStore](../native/MediFlowMac/Sources/MediFlowCore/SQLiteClinicalStore.swift) conservati | La factory usa HTTP per l'intero workspace; il vecchio flag `MEDIFLOW_LOCAL_AUTHORITY` non seleziona più SQLite. L'adattatore senza caller produzione è ritirato per impedire profilo host e sottorisorse di un altro archivio locale. [ADR0071](./adr/0071-tri-os-reversed-flow-shared-core.md) conserva la direzione nativa/offline e i gate del writer futuro; gli store Core restano sperimentali e testati. |
| Import repertori e lanci regionali | [AIFA importer](../lib/aifa-importer.ts), [exemption importer](../lib/exemption-importer.ts), [SISS launcher](../lib/siss-prescription.ts) | File/repertori non sono dati clinici; SISS URL/clipboard è distinto da S-01/S-02/S-03 persistiti. |
| Export, plaintext, file/cache | [PDF service](../lib/pdf-service.ts), [backup executor](../lib/backup-restore-executor.ts) | La [matrice dati a riposo](./data-at-rest-matrix.md) possiede elenco di colonne, file, cache, chiavi e residui plaintext; non promettere cifratura integrale. |
| Audit e sink tecnici | [security audit](../lib/security/audit.ts), [egress audit](../lib/ai-egress-audit.ts) | [audit-writers](./audit-writers.md) distingue clinical commit, storico, sicurezza e telemetria. |
| Scritture sintetiche e migrazioni storiche | [seed baseline](../scripts/seed-performance-baseline.mjs), [restore drill](../scripts/backup-restore-drill.mjs), `scripts/fixtures/`, `scripts/test-support/`, `drizzle/` | Fixture e prove non sono ingressi operativi di cartella; presenza del codice non autorizza esecuzione su dati reali. |

## Verticale profilo e sole note: confine S0

Questa mappa del 18 ottobre 2026 dettaglia lettura e UPDATE del profilo.
La selezione della factory Apple riguarda tutto il workspace, perché separare
profilo e sottorisorse fra archivi diversi non è ammesso. [ADR0146](./adr/0146-patient-profile-query-application-boundary.md)
definisce il confine della lettura; [ADR0071](./adr/0071-tri-os-reversed-flow-shared-core.md)
spiega la delega temporanea Apple. Il writer resta Node: il client Rust/GPUI
non apre SQLite e non è una migrazione del nucleo clinico.

| Decisione | Simboli e chiamanti effettivi | Garanzia e limite |
| --- | --- | --- |
| Identità e ruolo nella lettura | `readPatientProfile` in [patient-profile-service](../lib/patient-profile-service.ts), chiamato dai GET Web, local-v1, paired e FSE | Web usa `requireSession`; paired usa dispositivo, modalità, capability e `requireAccountSession`; FSE conserva `requireNetworkCapabilityContext` con la propria capability. Local-v1 resta un servizio con token (`requireLocalApiToken`), senza inventare un autore umano o un ruolo medico. |
| Paziente, scopo e ambito | [PatientProfileQuery](../lib/patient-profile-query.ts), `resolveNetworkScope`, [bindNetworkRequestScope](../lib/network-request-scope.ts) | Il paziente proviene dal parametro della route; purpose e proiezione sono fissati dall'adapter host. Lo scope paired viene risolto dall'host e applicato alla membership; l'header expected-ambulatory è solo un'asserzione. L'accesso Web/local-v1 non acquisisce retroattivamente la policy paired. |
| Vista e attualità della lettura | `queryPatientProfile` privato, `PatientProfileView`, `activePatients` | Vista interna esplicita, nessun tipo ORM nel contratto. SELECT corrente, tombstone escluse, nessun effetto clinico/audit. Non è un handle durevole né una promessa di validità dopo la risposta: WUL-583 resta separata. |
| Autorità dell'UPDATE | PUT Web/local-v1 → `updatePatientProfile`; PUT paired → [updateNetworkScopedPatient](../lib/network-patient-write.ts) → stessa porta | Body e metadati non emettono identità o ricevute. L'host sceglie audit e versione attesa; paired ammette solo i campi previsti e richiede ENC per quelli sensibili. L'audit non è costruito dal corpo della richiesta. |
| Validità al commit | [prepareNetworkPatientCommitGuard](../lib/network-patient-commit-authority.ts), [updatePatientOperation](../lib/patient-update-operation.ts) | Il guard paired ricontrolla generazione, dispositivo, modalità, capability, sessione/ruolo e scope nella transazione IMMEDIATE. Il writer ricontrolla paziente/versione e committa paziente, membership e audit insieme. Questo non estende automaticamente tutti i guard paired al diverso contratto Web/local-v1. |
| Esito e ricevuta | `updatePatientOperation` → `{success:true}` o errore; client → rilettura | L'ack HTTP attuale non è la futura ricevuta firmata/idempotente del pilota. Timeout e perdita della risposta non provano un rollback; i client non devono ritentare implicitamente la scrittura. WUL-584/585 restano aperte. |
| Percorso Swift | `PairedPatientsWorkspaceModel.makeClient` → `HomeBasePatientsClient` | L'intero workspace usa lo stesso servizio. La chiave sbloccata e il vecchio flag locale non selezionano un secondo archivio. Gli store Core rimangono disponibili e testati, senza caller del workspace di produzione. La cache cifrata conserva il binding all'host e la consultazione già prevista. |

### Comando prima della cifratura e custodia delle chiavi

Il punto che vede il testo in chiaro appartiene oggi al client autorizzato:

- Web: la bozza del profilo viene preparata da `patient-edit-session`, quindi
  la facade [db.ts](../lib/db.ts) applica `encryptItem` e `encryptData` prima
  dell'invio. I campi bloccati vengono preservati o omessi, non sostituiti
  con il segnaposto visuale.
- Apple: `PairedPatientsWorkspaceModel` costruisce `HomeBasePatientUpdatePayload`
  con versione osservata, trim e `PatchValue`; `encryptedPatientPatchValue`
  delega a `PatientFieldCrypto.encryptedPatchValue` prima del client HTTP.
  La master key sbloccata resta nel processo Apple, senza passare al server.
- Rust: `Session::update_patient_notes` richiede la lettura corrispondente e
  prepara versione/note; `Session::seal_fields` serializza e sigilla con la
  chiave della sessione prima del PUT. `ClinicalApp` conserva il significato
  del testo ricco e degli esiti incerti; blocco/ritiro eliminano i riferimenti
  attivi ai buffer senza promettere azzeramento fisico della RAM.

Questi sono punti fidati identificati, **non un canonicalizzatore unico già
estratto**: per esempio Swift tratta il testo vuoto dopo trim come null,
mentre gli altri ingressi possono distinguere vuoto e null. I contratti
attuali e i vettori condivisi restano validi; l'eventuale unificazione deve
essere esplicita e preservare significato e cifrato precedente.
`normalizePatientUpdateInput` riceve già ENC e normalizza il contenitore:
non verifica il significato del plaintext. Le chiavi non vengono spostate
nel server per aggirare questo limite. Envelope canonico, autorizzazione
umana monouso ed estrazione portabile restano WUL-584/580.

### Operazione clinica e capacità intelligenti

`PATIENT_PROFILE_READ_OPERATION` in [patient-profile-query](../lib/patient-profile-query.ts)
identifica `patient-profile.read.v1`, usato dalla costruzione e dal dispatch della
query. `PATIENT_PROFILE_UPDATE_OPERATION` in [patient-profile-update-contract](../lib/patient-profile-update-contract.ts)
identifica `patient-profile.update.v1`, versione 1: `updatePatientProfile` ne
assegna il discriminatore interno e `updatePatientOperation` ne verifica identità e
versione prima di aprire la transazione esistente. Il body non sceglie il
dispatch. Questi contratti operativi coprono lettura e UPDATE della verticale;
non concedono capacità, non registrano un nuovo writer e non sono il registro
completo delle future operazioni del pilota. Il catalogo [application-operation-registry](../lib/headless/application-operation-registry.ts)
resta statico `denied/unavailable`, con riferimenti operativi null; i cataloghi
intelligenti/Fabric conservano i propri owner. Nessun agente ottiene un
commit dalla presenza del descrittore di lettura.

Le prove di comportamento sono in [patient-profile-service.test](../lib/patient-profile-service.test.ts),
[patient-update-operation.test](../lib/patient-update-operation.test.ts) e
[PairedPatientsWorkspaceModelLifecycleTests](../native/MediFlowMac/Tests/MediFlowAppleSharedTests/PairedPatientsWorkspaceModelLifecycleTests.swift).
Le prove degli store SQLite restano conservate. CI e qualifica installata
vanno associate alla revisione effettivamente eseguita, non inferite dalla mappa.

## Processi, lavori e temporanei del runtime locale

Questa è la mappa C12 ([WUL-727](https://linear.app/wulfgardr/issue/WUL-727)),
non un elenco di prove superate. Limiti e segnali restano definiti negli owner
collegati; aggiungere un processo richiede aggiornare il suo owner, non un registro
parallelo di numeri. Build, installazione dei modelli e fixture non sono lavori
clinici. Un adapter opzionale presente nel sorgente non è un runtime qualificato.

| Processo / lavoro / risorsa | Owner e limite da consultare | Scadenza, terminazione e residui |
| --- | --- | --- |
| Web e MCP/Mini avviati dal Supervisor | [child processes](../lib/security/portable-supervisor-child-processes.ts), [launcher](../scripts/mediflow-headless-supervisor.mjs); argv e ambiente costruiti dall'owner | Revoca prima dello stop; SIGTERM, escalation sul figlio preciso e attesa di `close`. EOF e segnali del parent chiudono i figli posseduti, non processi cercati per nome. |
| Sessione, code e preview headless | [Supervisor](../lib/security/portable-supervisor-production.ts), [preview job control](../lib/security/in-process-preview-job-control.ts) | Binding, lease e deadline governano ammissione e uso. Revoca/annullamento non cambiano provider né ripartono; una risposta tardiva non riabilita la proiezione. |
| Web durante manutenzione dell'archivio | [maintenance owner](../lib/security/archive-maintenance-owner.ts), [admission](../lib/sqlite-maintenance-admission.mjs) | Solo il child creato dall'owner può essere drenato. Candidato validato prima dello stop; attesa reale, lease esclusiva, swap e riavvio. Intento e copia recuperabile restano su esito ambiguo; non sono temporanei da pulire alla cieca. |
| Conversione documentale locale | [extraction runner](../lib/domain/documents/anydoc-local-extraction-runner.ts); deadline, cap output e diagnostica nel modulo | Input su stdin, worker regolare con digest verificato e cwd fisica propria. Timeout/cap terminano il child; il risultato si pubblica dopo `close`, senza stderr o copie dei byte persistenti. |
| PDF materializzato / rasterizzato | [PDF child owner](../lib/domain/documents/anydoc-pdf-child-process-owner.ts); single flight, memoria, pagine e cap dei frame | Deadline condivisa, permessi Node ristretti e SIGKILL sul child posseduto; header e PNG validati prima di pubblicare. Slot occupato finché la terminazione non è osservata. |
| OCR Apple Vision e directory temporanea | [Vision owner](../lib/domain/documents/anydoc-apple-vision-ocr.ts); cap input/output, una deadline per documento | Input su stdin, nessun file immagine creato dall'owner; TMPDIR privato. Abort/limite termina il gruppo creato dall'owner e attende `close`, poi rimuove la radice. Errore di creazione/pulizia ha uno stato esplicito. Solo macOS. |
| Ragionamento terapeutico portabile | [portable runtime](../lib/ai-providers/fabric/treatment-reasoning-portable-runtime.ts); one-shot, single flight, cap e deadline inclusa acquisizione | Ambiente offline allowlisted, stdin e frame bounded. Revoca/abort fermano il lavoro e il gruppo posseduto; mancata prova di uscita mantiene lo slot indisponibile. Nessun download in inferenza o fallback implicito. |
| Redazione neurale locale | [GLiNER runner](../lib/gliner-redaction-runner.ts), [preparazione ordinaria](../lib/chatgpt-execution/ordinary-preparation.ts) | Worker Python isolato su Mac, frame bounded, stderr scartato; abort e chiusura attendono l'uscita dopo TERM/KILL. Modello e disponibilità sono preflight separati, non una promessa sugli altri profili. |
| Login account esterno e home effimera | [account host](../lib/chatgpt-account/account-host.ts), [account transport](../lib/chatgpt-account/account-transport.ts) | Binario assoluto esplicito, argv fissi e home privata. Timeout/protocollo/uscita chiudono il trasporto; cleanup solo dopo uscita confermata. Parent morto termina i suoi figli ma non dichiara eliminata la home rimasta, mai riusata. Non è il trasporto MCP clinico. |
| Custode nativo dell'esecuzione Mac | [native execution](../lib/chatgpt-execution/execution-mac-native.ts), [qualification](../lib/chatgpt-execution/execution-mac-qualification.ts) | Probe bounded e heartbeat; workspace privato e diagnostica non conservata. Le condizioni native restano nel contratto dell'adapter: i profili sorgente 0.9.0 non qualificano una distribuzione `.app`. |
| Scheduler OS e backup avviato manualmente | [scheduler e limiti dei comandi](../lib/backup-scheduler.ts), [OS adapter](../lib/backup-scheduler-adapter.ts), [runner](../scripts/run-scheduled-backup.mjs) | Job OS nominato e configurato esplicitamente; comandi con deadline e output limitato. Una lettura fallita lascia lo stato incerto: nessun fallback o riscrittura dei job. I file del job si rimuovono solo dopo la revoca confermata. Il runner possiede snapshot e `.mediflow.tmp`; gli originali recuperabili non sono residui eliminabili. |
| Probe NTFS dello swap | [durability](../lib/sqlite-durability.mjs) | PowerShell senza shell, timeout e output limitati; qualunque errore o risultato diverso dal filesystem richiesto nega il commit. Nessun contenuto clinico negli argomenti. |
| Copia temporanea dello storico SISS | [session observer](../lib/siss-session-observer.ts) | Il fallimento della copia iniziale e il cleanup dopo lettura rimuovono la sola radice posseduta; sorgente e file estranei sono conservati. Distinta dal monitor di rete e dalle sessioni browser dell'utente, che non vengono terminate. |

La [matrice dati a riposo](./data-at-rest-matrix.md) resta la fonte per contenuti,
chiavi, log, export e residui; questa mappa non promette cancellazione sicura del
supporto. [data-dir](../lib/data-dir.ts) e l'admissione possiedono la radice dati:
cwd del caller, alias di macOS e path degli allegati sono confini diversi.
I generatori legacy ATHENA importati dai soli smoke non ereditano le garanzie del
runtime portabile; discovery o presenza di un export non ne fanno ingressi operativi.

## Disposizione dei candidati già individuati

Fonte dei candidati: [rapporto WUL-683](./analysis/2026-09-06-086-code-inventory.md#prioritized-findings).
Le prove dei consumatori sono lette sulla revisione di questa mappa; non sono
prova di esecuzione. REMOVE/CONSOLIDATE sono destinazioni, KEEP è una decisione
motivata, non un debito automaticamente assegnato a un'altra issue.

| Candidato esistente | Disposizione e prova dei consumatori corrente | Destinazione |
| --- | --- | --- |
| `framer-motion` e SDK `openai` | RIMOSSI dal manifest e dal lock dopo verifica di import, script, loader e build. `motion-dom` e `motion-utils` erano transitive esclusive; il trasporto OpenAI corrente usa il `fetch` fornito dall’host. | [WUL-779](https://linear.app/wulfgardr/issue/WUL-779). |
| `use-clinical-alerts` | RIMOSSO hook mai richiamato dal prodotto e test esclusivo del suo selettore. Nessun export di pacchetto, caricamento dinamico o altra prova lo consuma; non rappresentava avvisi mostrati dall’interfaccia corrente. | [WUL-779](https://linear.app/wulfgardr/issue/WUL-779). |
| F1 builder macOS ritirato | RIMOSSO: `scripts/build-native-app.sh` non esiste; il manifest mantiene `scripts/build-apple-macos-app.sh`. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728); nessun nuovo intervento. |
| F2 builder simulatore | KEEP: [build-mobile-sim-app](../scripts/build-mobile-sim-app.sh) è richiamato dagli harness mobile; usa Xcode, non lo stub ritirato. La prova live resta separata. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728). |
| F3 clipboard paziente | RIMOSSO hook/helper senza consumer UI, export di pacchetto o caricamenti dinamici. I soli consumatori erano test e alias dedicato, ritirati insieme. Le route bulk mantengono i propri core e test negativi. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728); nessun nuovo intervento. |
| F4 envelope audit paired | CONSOLIDATO per atomicità nei core C05; KEEP dei mapper dominio attuali: [therapy](../lib/network-therapy-write.ts) raggiunge il core condiviso, [prescriptions](../lib/service-prescription-write.ts) conserva campi propri. Il vecchio swallow audit non descrive i writer migrati. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728); [audit-writers](./audit-writers.md) possiede lo stato degli obblighi. |
| Route OCR/PDF/Smart Import ritirate | KEEP: guardie e risposte 410 sono consumer di compatibilità e diniego; [roster](./clinical-write-roster.md#caller-composti-e-percorsi-senza-commit) distingue il legacy dalla preview. | [WUL-726](https://linear.app/wulfgardr/issue/WUL-726); nessuna riattivazione. |
| SQLite vendorizzato | KEEP: [manifest nativo](../native/MediFlowMac/Package.swift) mantiene il target/binding SQLite; sorgenti/licenza non equivalgono al runtime Web distribuito. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728). |
| Corpora/fixture | KEEP: input delle suite e casi negativi; esclusi dal debito sorgente dal comando inventario, non cancellati per ridurre conteggi. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728). |
| Archivi package e metadata generati | KEEP dove richiesti da manifest/lock/provenienza e build; [payload ledger](./runtime-payload-ledger.md) distingue artefatto e sorgente. Non assimilare output locali non versionati. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728). |
| Screenshot/evidenze storiche | KEEP della provenienza nel sorgente; esclusi dal punteggio debito e dalle copie nel runtime Web. Non prova di software corrente. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728). |
| Parsing argomenti benchmark ripetuto | KEEP: CLI con opzioni distinte; il rapporto storico non prova equivalenza semantica, quindi non giustifica un parser generale. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728). |
| Scaffold route simili | KEEP: ammissioni Web/token/paired e schemi differenti non sono duplicazione equivalente; il CSV espone le differenze. | [WUL-725](https://linear.app/wulfgardr/issue/WUL-725) per authority lifecycle; nessun framework route C01. |

## Raccordo delle disposizioni iniziali C01

Il ledger locale originario del 26 settembre è stato recuperato in sola lettura.
La tabella raccorda i suoi ID alle fonti correnti e agli outcome già assegnati;
non pubblica il ledger, i suoi log o una nuova copia dei criteri di accettazione.
Una destinazione indica responsabilità, non che la issue sia ancora aperta.
F1–F4 sopra coprono il rapporto precedente; CLIPBOARD/HISTORIC_BUILDER vi rinviano
senza introdurre candidati aggiuntivi.

| ID iniziale | Disposizione corrente e fonte | Destinazione |
| --- | --- | --- |
| A01 | CONSOLIDATO: [patient-update-operation](../lib/patient-update-operation.ts) possiede update e membership nello stesso commit. Gli ingressi Web/v1/paired preparano il profilo tramite [patient-profile-service](../lib/patient-profile-service.ts); il writer resta quello esistente. | [WUL-718](https://linear.app/wulfgardr/issue/WUL-718); [porta comune del profilo](analysis/2026-10-17-patient-profile-port.md). |
| A02 | CONSOLIDATO: sink required audit nella transazione dei core; classificazione in [audit-writers](./audit-writers.md). | [WUL-719](https://linear.app/wulfgardr/issue/WUL-719). |
| A03 | KEEP: protezione per campo e custodia descritte nella [matrice dati a riposo](./data-at-rest-matrix.md), senza promessa whole-DB. | [WUL-721](https://linear.app/wulfgardr/issue/WUL-721). |
| A04 | KEEP della migrazione recoverable corrente [ADR0143](./adr/0143-strong-unlock-credential.md); non ripristinare il contratto PIN storico. | [WUL-722](https://linear.app/wulfgardr/issue/WUL-722). |
| A05 | KEEP di definizioni e significati storici: [scale-definitions](../lib/scale-definitions.ts), [Tinetti versionata](../lib/scales/tinetti-poma28-v1.ts); interpretazione e diritti restano C08. | [WUL-723](https://linear.app/wulfgardr/issue/WUL-723). |
| A06 | KEEP dei negativi [admin-route-auth-boundary](../scripts/admin-route-auth-boundary.test.mjs); fixture e selezione sono responsabilità C14, non parità clinica. | [WUL-729](https://linear.app/wulfgardr/issue/WUL-729). |
| NULL_JSON | CONSOLIDATO: reader/normalizzazione e profili del [roster](./clinical-write-roster.md) distinguono malformed/null/versioni; il debito della baseline non descrive i writer migrati. | [WUL-720](https://linear.app/wulfgardr/issue/WUL-720). |
| A07 | KEEP: [canonical-read-plan](../lib/headless/canonical-read-plan.ts) e catalogo concedono soltanto operazioni nominate; nessun update paziente dedotto dalla presenza di MCP. | [WUL-731](https://linear.app/wulfgardr/issue/WUL-731). |
| A08 | KEEP: [gate locale](../lib/ai-egress-gate.ts) chiuso; le composizioni provider esplicite sono autorità separate nella tabella sopra. | [WUL-725](https://linear.app/wulfgardr/issue/WUL-725). |
| A09 | KEEP della distinzione sorgente/installazione/uso clinico nello [stato del sistema](./STATE_OF_THE_SYSTEM.md); non convertire inventario in qualifica. | [WUL-734](https://linear.app/wulfgardr/issue/WUL-734). |
| SERVICE_AUDIT | CONSOLIDATO: [service-prescription-write](../lib/service-prescription-write.ts) scrive audit required con prescrizione/item nel commit. | [WUL-720](https://linear.app/wulfgardr/issue/WUL-720). |
| DDL_BOOTSTRAP | KEEP: [schema-open](../lib/sqlite-schema-open.ts) possiede apertura/allineamento; migrazioni storiche conservate, ORM non è un secondo bootstrap. | [WUL-724](https://linear.app/wulfgardr/issue/WUL-724). |
| BACKUP_RECOVERY | KEEP: [artifact](../lib/backup-artifact.ts) e [restore executor](../lib/backup-restore-executor.ts) conservano formati/storia; il censimento non qualifica recovery. | [WUL-730](https://linear.app/wulfgardr/issue/WUL-730). |
| PACKED_AUTH | KEEP: manifest/lock e archivio owner hanno consumer install/build; la verifica dei byte resta nel [payload ledger](./runtime-payload-ledger.md). | [WUL-733](https://linear.app/wulfgardr/issue/WUL-733). |
| HISTORIC_BUILDER | KEEP degli ingressi mantenuti F1/F2; il builder ritirato non viene reintrodotto. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728). |
| CLIPBOARD | RIMOSSO il solo hook/helper come F3; KEEP dei contratti bulk indipendenti e delle relative prove. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728). |
| MINI_MANIFEST | KEEP: [materialize-surface-terminal-dispositions](../scripts/materialize-surface-terminal-dispositions.mjs) usa il riferimento storico per artefatti di mapping, non per concedere capability runtime. | [WUL-728](https://linear.app/wulfgardr/issue/WUL-728). |
| UI_LANGUAGE | KEEP dei contratti [DESIGN](../DESIGN.md) e delle correzioni già consegnate; percorsi e linguaggio medico non sono debito da cancellare meccanicamente. | [WUL-732](https://linear.app/wulfgardr/issue/WUL-732). |
| NATIVE_CHOOSER | KEEP dell'oracolo [document-upload-anydoc-focus](../e2e/document-upload-anydoc-focus.spec.ts); diagnosi e instabilità restano C14, non una prova live dedotta da rerun. | [WUL-729](https://linear.app/wulfgardr/issue/WUL-729). |
| TEMP_PHYSICAL | SEMPLIFICATO: [test-data-dir](../scripts/test-data-dir.mjs) usa realpath dell'mkdtemp posseduto e conserva i percorsi espliciti del caller. | [WUL-729](https://linear.app/wulfgardr/issue/WUL-729). |

KEEP dei richiami ripetuti a Node verify: i quattro hook lifecycle e il controllo
manuale in [package.json](../package.json) proteggono ingressi distinti; anche
[build-installability](../scripts/build-installability-v0-macos.sh) consuma il
controllo. Non sono wrapper duplicati da eliminare per ridurre gli script C13.

## Conteggi ripetibili

Usare Node 24 previsto dal progetto; il comando esistente legge path e bytes
dall'albero Git indicato, senza aprire archivi clinici o eseguire il prodotto:

```sh
node scripts/inventory-first-party-code.mjs --ref <revisione> --json
```

Non salvare qui un'altra copia dei conteggi. L'output espone categorie, linguaggi,
esclusioni e duplicati byte-identici: non misura consumatori o equivalenza clinica.
La revisione passata al comando identifica anche le fonti del CSV da leggere.
