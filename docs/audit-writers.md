# Writer audit del prodotto corrente

Elenco C04 / [WUL-719](https://linear.app/wulfgardr/issue/WUL-719), verificato
sulla base `fe974d1956a72d97bf90fc10fd36d0892b092b8e`, con la successiva
migrazione C05 del diario SISS locale descritta sotto. La classificazione segue
[ADR 0015](./adr/0015-audit-taxonomy-minimum-catalog.md); la migrazione dei writer
clinici residui appartiene a [C05 / WUL-720](https://linear.app/wulfgardr/issue/WUL-720),
con le operazioni e le prove raccolte nel [roster delle scritture](./clinical-write-roster.md).

**Obbligatorio** indica la traccia necessaria all'operazione. Per una modifica
clinica, dati ed evento devono committare nella stessa transazione del database
autorevole. **Telemetria** indica un tentativo o una misura operativa che non
attesta un commit clinico e può essere al meglio. La colonna dello stato descrive
il codice corrente: un audit obbligatorio ancora al meglio resta un lavoro da
fare, non diventa telemetria.

Gli eventi di sicurezza, i permessi e le ricevute headless conservano i propri
contratti. Una lettura o un diniego possono richiedere audit; non vengono
indeboliti per uniformarli al pilota clinico. Il ritiro di una sessione o un
cambiamento dello scheduler OS non è una transazione SQLite distribuita.

Le righe identificano i punti di scrittura e i wrapper che li raggiungono;
gli adapter che convergono sulla stessa operazione non sono writer aggiuntivi.
I numeri di riga si riferiscono alla base sopra; i link SISS puntano ai writer aggiornati.
Test, fixture, DDL,
lettori dell'audit ed export dei record non sono nuovi eventi di produzione.

## Mutazioni cliniche con audit nella transazione

Tutte le righe di questa tabella sono **obbligatorie**. Il writer comune
`writeAuditEventInTransaction` usa la transazione ricevuta e pretende esattamente
una riga inserita; non apre una seconda connessione.

| Punto di scrittura | Operazione e motivo | Stato corrente |
| --- | --- | --- |
| [patient-update-operation.ts:74](../lib/patient-update-operation.ts#L74) | Aggiornamento/archiviazione/riattivazione profilo: comprende versione e membership. | Transazione immediata; Web, API v1 e paired convergono qui. |
| [patient-delete-operation.ts:40](../lib/patient-delete-operation.ts#L40) | Eliminazione logica paziente: cambia visibilità e versione. | Evento e mutazione nella stessa transazione Web/v1. |
| [patients/route.ts:140](../app/api/patients/route.ts#L140) | Creazione locale: il wrapper `writeCreateAudit` attesta il paziente creato, compresa la variante con ambulatorio. | Chiamate :160 e :176 dentro le rispettive transazioni. |
| [v1/patients/route.ts:105](../app/api/v1/patients/route.ts#L105) | Creazione API v1: nuova autorità paziente e associazione. | Audit richiesto nella transazione. |
| [network-patient-lifecycle.ts:55](../lib/network-patient-lifecycle.ts#L55) | Wrapper lifecycle paired: creazione (:248), eliminazione (:307), ripristino (:363). | Riceve `tx` da ciascuna operazione; evento richiesto prima del commit. |
| [restore-patient/route.ts:89](../app/api/system/restore-patient/route.ts#L89) | Ripristino amministrativo: rende di nuovo disponibile il paziente. | Audit e ripristino nella transazione. |
| [entry-write-operation.ts:73](../lib/entry-write-operation.ts#L73) | Creazione diario: nuovo contenuto clinico. | Transazione condivisa Web/v1/paired. |
| [entry-write-operation.ts:107](../lib/entry-write-operation.ts#L107) | Modifica/eliminazione logica diario: cambia contenuto, lifecycle e versione. | Stessa transazione del writer condiviso. |
| [therapy-write-operation.ts:46](../lib/therapy-write-operation.ts#L46) | Creazione terapia: nuovo trattamento. | Transazione del writer condiviso. |
| [therapy-write-operation.ts:77](../lib/therapy-write-operation.ts#L77) | Modifica/eliminazione logica terapia: cambia trattamento e versione. | Transazione del writer condiviso. |
| [observation-write-operation.ts:59](../lib/observation-write-operation.ts#L59) | Creazione osservazione: nuovo dato clinico. | Transazione del writer condiviso. |
| [observation-write-operation.ts:94](../lib/observation-write-operation.ts#L94) | Modifica/eliminazione logica osservazione: cambia dato e versione. | Transazione del writer condiviso. |
| [checkup-write-operation.ts:45](../lib/checkup-write-operation.ts#L45) | Creazione checkup: nuovo percorso clinico. | Transazione del writer condiviso. |
| [checkup-write-operation.ts:76](../lib/checkup-write-operation.ts#L76) | Modifica/eliminazione logica checkup: cambia stato e versione. | Transazione del writer condiviso. |
| [prosthetic-prescription-write.ts:244](../lib/prosthetic-prescription-write.ts#L244) | Creazione prescrizione protesica host. | Transazione immediata. |
| [prosthetic-prescription-write.ts:286](../lib/prosthetic-prescription-write.ts#L286) | Aggiornamento prescrizione protesica host/paired. | Transazione immediata del core comune. |
| [prosthetic-prescription-write.ts:307](../lib/prosthetic-prescription-write.ts#L307) | Eliminazione prescrizione protesica host. | Transazione immediata. |
| [prosthetic-prescription-write.ts:325](../lib/prosthetic-prescription-write.ts#L325) | Creazione prescrizione protesica paired. | Transazione immediata. |
| [service-prescription-write.ts:433](../lib/service-prescription-write.ts#L433) | Creazione prescrizione di servizio host. | Transazione immediata. |
| [service-prescription-write.ts:466](../lib/service-prescription-write.ts#L466) | Aggiornamento prescrizione di servizio host/paired. | Transazione immediata del core comune. |
| [service-prescription-write.ts:487](../lib/service-prescription-write.ts#L487) | Eliminazione prescrizione di servizio host. | Transazione immediata. |
| [service-prescription-write.ts:511](../lib/service-prescription-write.ts#L511) | Creazione item di prescrizione host/paired. | Transazione immediata del core comune. |
| [service-prescription-write.ts:539](../lib/service-prescription-write.ts#L539) | Aggiornamento item host/paired. | Transazione immediata del core comune. |
| [service-prescription-write.ts:556](../lib/service-prescription-write.ts#L556) | Eliminazione item host. | Transazione immediata. |
| [service-prescription-write.ts:572](../lib/service-prescription-write.ts#L572) | Creazione prescrizione di servizio paired. | Transazione immediata. |
| [ambulatory-write.ts:55](../lib/ambulatory-write.ts#L55) | `auditDefaultChange`: cambio indiretto del default e della versione di un ambulatorio. | Usa la transazione dell'operazione chiamante. |
| [ambulatory-write.ts:135](../lib/ambulatory-write.ts#L135) | Creazione ambulatorio: modifica il contenitore e lo scope clinico. | Transazione immediata host/paired. |
| [ambulatory-write.ts:196](../lib/ambulatory-write.ts#L196) | Modifica ambulatorio e versione. | Transazione immediata host/paired. |
| [ambulatory-write.ts:232](../lib/ambulatory-write.ts#L232) | Eliminazione ambulatorio: cambia lo scope persistito. | Transazione immediata host/paired. |
| [ambulatory-write.ts:258](../lib/ambulatory-write.ts#L258) | Pulizia ambulatorio: evento per ciascun paziente eliminato logicamente. | Transazione della pulizia, anche per contenitori di test. |
| [ambulatory-write.ts:261](../lib/ambulatory-write.ts#L261) | Evento complessivo `ambulatory.cleared`. | Stessa transazione degli effetti sui pazienti. |
| [siss-handoffs/route.ts](../app/api/siss-handoffs/route.ts) | Creazione del workflow locale riferito al paziente. | C05: controllo paziente e duplicati, insert e audit nella stessa transazione immediata. |
| [siss-handoffs/[id]/route.ts](../app/api/siss-handoffs/[id]/route.ts), PUT | Modifica workflow, stato e tempi persistiti. | C05: esistenza, update e audit nella stessa transazione immediata. |
| [siss-handoffs/[id]/route.ts](../app/api/siss-handoffs/[id]/route.ts), DELETE | Eliminazione del workflow persistito. | C05: esistenza, delete e audit nella stessa transazione immediata. |

Il diario SISS locale usa l'identità della sessione autenticata. POST e PUT
leggono al massimo 256 KiB e applicano gli schemi esistenti; input non valido,
ID duplicato e paziente assente/eliminato sono respinti prima della creazione.
Le [prove SQLite dei tre handler](../lib/siss-handoff-required-audit.test.ts)
verificano rollback per guasto audit e successo con un solo evento. Il controllo
di versione e l'idempotenza generale dei PUT restano lavori C05: la transazione
immediata non li introduce.

## Writer clinici ancora al meglio: consegna a C05

Queste tre operazioni sono **obbligatorie**, ma il codice corrente può
committare la modifica prima dell'audit. C05 deve spostare l'evento nel writer
che possiede la transazione, usando il contesto attore già derivato dall'host
e la stessa interfaccia del pilota; un errore audit deve annullare gli effetti.

| Punto di scrittura | Motivo | Stato da correggere in C05 |
| --- | --- | --- |
| [purge-patient/route.ts:96](../app/api/system/purge-patient/route.ts#L96) | Purge rimuove paziente e figli clinici. | Audit dopo il commit di `purgePatientCascade` e cancellazione paziente. |
| [fix-orphans/route.ts:144](../app/api/system/fix-orphans/route.ts#L144) | Purge opzionale rimuove figli clinici orfani. | Audit dopo la transazione di cancellazione :142. |
| [network-attachment-write.ts:126](../lib/network-attachment-write.ts#L126) | `attachment.created` attesta un nuovo allegato e la sua currentness. | Wrapper :120 chiamato da `createNetworkScopedAttachment` a :209, dopo il commit; catch assorbe l'errore. Adapter: [attachments/route.ts](../app/api/v1/network/patients/[id]/attachments/route.ts). |

Il ramo precedente di [fix-orphans:111–135](../app/api/system/fix-orphans/route.ts#L111)
crea eventualmente un ambulatorio e associa pazienti **senza evento audit**.
È un ulteriore writer da inserire nel roster C05: l'evento del purge successivo
non attesta queste associazioni. Questa lista non sostituisce il censimento
C05 delle operazioni che non chiamano affatto un writer audit.

## Telemetria operativa

Queste righe sono **telemetria**, perché non registrano una modifica clinica
riuscita. Il loro contratto corrente al meglio resta invariato.

| Punto di scrittura | Esito registrato e motivo |
| --- | --- |
| [siss/prescription/route.ts:49](../app/api/siss/prescription/route.ts#L49) | Lancio contestuale riuscito: restituisce URL/clipboard, non crea una prescrizione né una riga clinica. |
| [siss/prescription/route.ts:64](../app/api/siss/prescription/route.ts#L64) | Errore SISS tipizzato: tentativo fallito, nessun commit clinico. |
| [siss/prescription/route.ts:88](../app/api/siss/prescription/route.ts#L88) | Errore inatteso del lancio: tentativo fallito. |
| [siss/context/route.ts:67](../app/api/siss/context/route.ts#L67) | Lancio `prescription.create` riuscito, stesso servizio contestuale URL/clipboard. |
| [siss/context/route.ts:83](../app/api/siss/context/route.ts#L83) | Errore contestuale tipizzato, nessuna mutazione clinica. |
| [siss/context/route.ts:107](../app/api/siss/context/route.ts#L107) | Errore contestuale inatteso, nessuna mutazione clinica. |
| [cloud-provider-probe/route.ts:75](../app/api/system/cloud-provider-probe/route.ts#L75) | Wrapper `audit` di una sonda esplicitamente sintetica: non applica risultati clinici. Copre dinieghi di sessione/ruolo/trasporto/input (:90, :94, :98, :102), sessione cambiata (:111, :117, :136), sonda disabilitata (:123), errore (:140) e completamento (:144). |

Il servizio dei lanci SISS è [siss-prescription.ts](../lib/siss-prescription.ts)
→ [siss-patient-context.ts](../lib/siss-patient-context.ts). È distinto dalle
route `siss-handoffs`, che scrivono righe persistenti e sono obbligatorie.

## Sicurezza e amministrazione

Sono tracce **obbligatorie secondo il contratto della rispettiva autorità**;
lo stato corrente sotto espone i percorsi ancora al meglio. Non si promette
che una revoca riuscita possa essere annullata se fallisce il log, né si
converte una traccia di sicurezza in prova di commit clinico. Il completamento
C04 classifica questi punti; non dichiara risolta la loro migrazione.

| Punto di scrittura | Motivo e stato corrente | Destinazione |
| --- | --- | --- |
| [settings/route.ts:49](../app/api/settings/route.ts#L49) | POST impostazioni: upsert persistente prima dell'audit, catch separato. | C05 per effetti persistenti; C06/C10 per impostazioni di sicurezza. |
| [settings/[key]/route.ts:73](../app/api/settings/[key]/route.ts#L73) | PUT impostazione: stesso confine upsert/audit separato. | C05, con il contratto della specifica impostazione. |
| [profile-update-service.ts:80](../lib/security/profile-update-service.ts#L80) | Profilo utente e discovery identity: transazione precedente all'audit; non è il profilo paziente. | C10. |
| [pin-change-service.ts:236](../lib/security/pin-change-service.ts#L236) | CAS credenziale e ritiro autorità Web/native precedono audit; errore assorbito. | C07/C10, preservando il ritiro dell'autorità. |
| [rewrap-master-key/route.ts:64](../app/api/auth/rewrap-master-key/route.ts#L64) | Cambia wrapping/salt prima dell'audit; catch separato. | C06/C07. |
| [auth/login/route.ts:77](../app/api/auth/login/route.ts#L77) | Login Web: audit dopo emissione dell'autorità, con catch. | C10, protocollo di autenticazione. |
| [native-login-http.ts:61](../lib/security/native-login-http.ts#L61) | Login nativo: wrapper chiamato a :94 dopo creazione autorità; fallback esplicito. | C10. |
| [web-auth-logout-server.ts:104](../lib/security/web-auth-logout-server.ts#L104) | Logout: retirement autorevole prima dell'audit; un errore non riattiva la sessione. | C10. |
| [web-auth-application-lock-server.ts:117](../lib/security/web-auth-application-lock-server.ts#L117) | Lock: retirement/fence precedono audit; errore non annulla il lock. | C10. |
| [host-credential-verification.ts:141](../lib/security/host-credential-verification.ts#L141) | Diniego credenziali/lockout/conflitto: `deny` conserva il rifiuto anche se audit fallisce; chiamanti :184, :188, :190, :198, :200, :222, :228. | C07/C10; tentativo negato, non successo clinico. |
| [backup-scheduler/route.ts:128](../app/api/system/backup-scheduler/route.ts#L128) | Configurazione scheduler: install/uninstall OS e salvataggio DB precedono audit. | C15: due autorità, nessuna transazione distribuita presunta. |

## Writer con contratto dedicato e conservazione dello storico

Tutte le righe sono **obbligatorie**. Il codice che non usa il wrapper clinico
comune conserva verifiche, ricevute e replay propri; non viene sostituito con
un audit al meglio.

| Punto di scrittura | Motivo e confine corrente |
| --- | --- |
| [physician-review-command.ts:105](../lib/ai-providers/fabric/physician-review-command.ts#L105) | Accettazione/rifiuto medico persistiti: stato, evento e registro idempotenza nella stessa transazione immediata. |
| [headless-soap-entry-commit-owner.ts:525](../lib/security/headless-soap-entry-commit-owner.ts#L525) | Commit SOAP: insert SQL sul nome tabella derivato da `auditEvents`; transazione con entry, ledger e ricevuta, replay durevole. |
| [headless-checkup-status-transition-storage.ts:289](../lib/security/headless-checkup-status-transition-storage.ts#L289) | Transizione checkup: evento e CAS dentro transazione, con verifica della ricevuta/replay. |
| [headless-soap-active-role-attestation-store.ts:47](../lib/security/headless-soap-active-role-attestation-store.ts#L47) | `INSERT_ACTIVATION_AUDIT`, eseguito da `activate`: attivazione ruolo SOAP e audit nella stessa transazione. |
| [headless-checkup-active-role-attestation-store.ts:160](../lib/security/headless-checkup-active-role-attestation-store.ts#L160) | Attivazione ruolo checkup e audit nella stessa transazione. |
| [headless-checkup-active-role-attestation-store.ts:181](../lib/security/headless-checkup-active-role-attestation-store.ts#L181) | Revoca ruolo checkup e audit nella stessa transazione. |
| [portable-supervisor-aip-audit-port.ts:278](../lib/security/portable-supervisor-aip-audit-port.ts#L278) | Tentativo AIP: transazione e rilettura del contesto/record richieste dal port, anche senza mutazione clinica. |
| [portable-supervisor-semantic-audit-port.ts:220](../lib/security/portable-supervisor-semantic-audit-port.ts#L220) | Esito terminale semantic query: decisione, binding e record verificati nella stessa transazione. |
| [headless-checkup-status-transition-web-production.ts:113](../lib/security/headless-checkup-status-transition-web-production.ts#L113) | Diniego del percorso Web trusted: l'owner converte il fallimento del port in `audit_unavailable`; non è un commit clinico. |
| [icd11-who-production.ts:28](../lib/reference-data/icd11-who-production.ts#L28) | Ricevuta ricerca WHO: il servizio attende il writer e fallisce con `audit_unavailable`; non è semplice telemetria. |
| [icd11-who-production.ts:57](../lib/reference-data/icd11-who-production.ts#L57) | Ricevuta code check WHO: stesso obbligo prima del risultato del servizio. |
| [backup-restore-executor.ts:305](../lib/backup-restore-executor.ts#L305) | `restoreHeadlessSoapEntryCommits`: preserva l'evento originale H7b, con controllo collisioni e snapshot esatto nella transazione restore. |
| [backup-restore-executor.ts:345](../lib/backup-restore-executor.ts#L345) | `insertBackupAudits`: ripristina lo storico, riusa soltanto righe identiche e pretende un inserimento; stessa transazione restore. Non inventa un nuovo evento clinico. |

## Log tecnici fuori da audit.v1

Questi file non costituiscono un secondo registro clinico autorevole. Si
classificano anche i sink su file chiamati “audit”, per non confonderli con
la storia clinica in `medical.db`.

| Punto | Classificazione e motivo |
| --- | --- |
| [ai-egress-audit.ts:27](../lib/ai-egress-audit.ts#L27), `appendRecord` | Sink tecnico condiviso per decisioni egress; eredita il vincolo del chiamante, non attesta invio o commit clinico. Nessun errore viene soppresso qui. |
| [ai-egress-audit.ts:41](../lib/ai-egress-audit.ts#L41), `appendEgressGateAudit` / `evaluateAndAuditEgress` | Telemetria di decisione del gate; `evaluateAndAuditEgress` propaga gli errori. Non è autorizzazione clinica né prova di trasmissione. |
| [ai-egress-audit.ts:61](../lib/ai-egress-audit.ts#L61), `appendChatGptEgressAudit` | Obbligatorio per il [chokepoint ordinario](../lib/chatgpt-execution/ordinary-egress-chokepoint.ts): due chiamanti per allowed/denied, errore append significa diniego. Non abbassare questo contratto a best-effort. |
| [document-router-control-flow-audit.ts:25](../lib/document-router-control-flow-audit.ts#L25) | Telemetria del router in shadow: classificazione/confidenza e decisione simulata, senza commit clinico. La [route](../app/api/ai/document-router-audit/route.ts) restituisce 500 se non può registrarla. |

## Infrastruttura e punti senza scrittura attiva

- [security/audit.ts](../lib/security/audit.ts): `writeAuditEventInTransaction`
  è il sink obbligatorio; `writeAuditEvent` esegue l'insert sulla connessione
  server e propaga gli errori, ma da solo non collega evento e modifica.
  `safeWriteAuditEventFromRequest` assorbe gli errori: i suoi nove punti
  produzione sono tutti classificati nelle tabelle sopra.
- [network-patient-write.ts:110](../lib/network-patient-write.ts#L110):
  `writeNetworkPatientAuditEvent` è un helper esportato senza caller produzione
  nella revisione esaminata. Non è prova di un writer paziente attivo; se
  riutilizzato per un successo clinico richiederebbe il confine obbligatorio.
- [siss-audit.ts](../lib/siss-audit.ts) costruisce soltanto metadati;
  [audit-db.ts](../lib/security/audit-db.ts) crea schema, indici e trigger
  append-only. Nessuno dei due genera eventi di operazione.
- `scripts/run-scheduled-backup.mjs` e gli export leggono gli eventi; la
  verifica schema inserisce fixture sintetiche. I client nativi leggono o
  trasportano le ricevute e invocano i writer host elencati sopra.

## Prove del pilota paziente e uso dell'elenco

[patient-required-audit.test.ts](../lib/patient-required-audit.test.ts) usa
SQLite temporaneo reale e le route Web/API v1, con il core paired. Verifica
rollback di paziente e membership per errore/insert ignorato/`SQLITE_FULL`,
un processo ucciso prima dell'insert audit, riapertura senza modifica né evento,
morte dopo commit e richiesta ripetuta in un processo nuovo, e due writer
concorrenti con un solo successo e un solo evento. Il replay usa la versione
attesa e risponde `409`: il request ID è correlazione, non una chiave generale
di idempotenza. È una prova di arresto del processo, non di perdita di alimentazione.

La suite è selezionata dal runner unit mediante discovery `lib/**/*.test.ts`
in [unit-test-selection.mjs](../scripts/unit-test-selection.mjs) ed è registrata
nell'[inventario](../test-inventory.v1.json). Gli esiti del candidato sono nella
PR e nella CI collegata, senza duplicare i log in questo elenco.

Quando cambia un writer, aggiornare la sua riga insieme all'implementazione.
C05 deve aggiungere al proprio roster anche le operazioni senza eventi e
collegare le prove per famiglia; C04 non ne dichiara la migrazione conclusa.
