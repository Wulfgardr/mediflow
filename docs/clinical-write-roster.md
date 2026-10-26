---
summary: "Roster operativo C05 delle mutazioni cliniche Web, API v1 e paired: ingressi, validazione, transazione, audit e prove da collegare."
read_when:
  - "Preparare una coorte WUL-720 o modificare una scrittura clinica ordinaria."
---

# Roster operativo delle scritture cliniche — C05

Roster per [WUL-720](https://linear.app/wulfgardr/issue/WUL-720), ricavato dalla
base `fe974d1956a72d97bf90fc10fd36d0892b092b8e` e mantenuto insieme alle migrazioni
C05. Le righe del CSV sono la mappa corrente C01: distinguono CRUD migrato,
writer non ordinari e differenze residue, senza riaprire automaticamente C05.
Una riga HTTP identifica metodo, adapter e superficie; il profilo ne completa
significato, validazione, identificativi e prove. La transazione con audit non
qualifica da sola tutti i caller né le sequenze composte. Il request ID è
correlazione, non una chiave generale di idempotenza.

## Fonti e regole di lettura

- [ADR 0015](./adr/0015-audit-taxonomy-minimum-catalog.md): contratti delle coorti
  paziente, diario, terapia, osservazione, checkup, prescrizioni e ambulatori.
- [Prima tranche](./analysis/2026-09-26-090-first-tranche.md): storia delle consegne;
  non trasferire automaticamente i risultati alla revisione corrente.
- [Matrice Apple](./apple-parity-matrix.json) e [parity](./parity-matrix.md): capacità
  ed esclusioni delle superfici; non dimostrano atomicità o uso reale corrente.
- [Route della capability map](./capability-mapping/sources/web-http-routes.v1.json)
  e [code explorer](../tools/code-explorer/curated-map.json): indici di sorgenti
  su baseline precedenti. L'explorer copre due esempi, non tutti i writer.
- [Selezione dei test](./test-selection.md):
  distingue presenza e selezione dall'esecuzione. Le prove sotto sono riferimenti,
  non nuovi PASS. La classificazione degli obblighi è nell’[elenco audit C04](./audit-writers.md).

**Superfici.** Web usa la sessione ammessa dall'adapter; v1 usa l'autorità locale
prevista dalla route; paired richiede capability e contesto rete, con scope
ambulatoriale e vincoli ENC dei rispettivi wrapper. Un endpoint non presente
non viene inventato per uniformare la tabella. L'API locale non equivale alla rete.

**Body.** `4 MiB` indica il reader applicativo bounded (4.194.304 byte), non un
limite RSS/trasporto. `JSON non bounded` indica `request.json()` senza un limite
applicativo osservato in quel percorso. Il limite dei dati allegato non equivale
al limite del JSON che li contiene. La validazione di shape/campi resta distinta.

## Profili delle famiglie e prove di riferimento

I test `lib/*.test.ts` sotto sono candidati della discovery di `test:unit`
([runner](../scripts/run-unit-suite.mjs), [selezione](../scripts/unit-test-selection.mjs)).
I test HTTP `scripts/*` vanno collegati al proprio comando/runner nel manifest;
la sola presenza del file non ne attesta la selezione. Nessun test è stato eseguito
per compilare questo documento.

### P — Paziente

Sorgenti: [lib/patient-write-normalization.ts](../lib/patient-write-normalization.ts), [lib/patient-json-object.ts](../lib/patient-json-object.ts), [lib/patient-profile-service.ts](../lib/patient-profile-service.ts), [lib/patient-update-operation.ts](../lib/patient-update-operation.ts), [lib/patient-delete-operation.ts](../lib/patient-delete-operation.ts), [lib/patient-create-service.ts](../lib/patient-create-service.ts), [lib/network-patient-write.ts](../lib/network-patient-write.ts), [lib/network-patient-lifecycle.ts](../lib/network-patient-lifecycle.ts).

I percorsi PUT Web **P-01**, v1 **P-08** e paired **P-05** attraversano
`updatePatientProfile` in `patient-profile-service`; il paired vi arriva
tramite `updateNetworkScopedPatient` in `network-patient-write`. Il commit
rimane in `patient-update-operation`. La porta resta un servizio Node
in-process; la [mappa della porta profilo](analysis/2026-10-17-patient-profile-port.md)
descrive questa estrazione e i limiti residui.

Create: normalizzazione paziente, ID fornito o generato secondo adapter, versione iniziale host; associazione ambulatoriale nel commit. PUT: ID path, versione attesa e CAS; assente/null del primario distinti, associazioni conservate. DELETE: tombstone e versione; esaurimento della versione corrente restituisce 409 prima degli effetti. DELETE/restore paired mantengono la stessa guardia dopo scope/currentness. Paired: parent paziente nello scope e campi sigillati; restore rete distinto dal ripristino amministrativo. Create-context Web lega la creazione al contesto corrente, non crea il paziente.

Prove di riferimento: [lib/patient-profile-service.test.ts](../lib/patient-profile-service.test.ts), [lib/patient-required-audit.test.ts](../lib/patient-required-audit.test.ts), [lib/patient-create-required-audit.test.ts](../lib/patient-create-required-audit.test.ts), [lib/network-patient-lifecycle-required-audit.test.ts](../lib/network-patient-lifecycle-required-audit.test.ts), [lib/patient-json-envelope.test.ts](../lib/patient-json-envelope.test.ts), [lib/patient-create-service.test.ts](../lib/patient-create-service.test.ts). test:concurrency:patients; test:network:home-base-patient-lifecycle-write; HTTP create in scripts/patient-create-required-audit-http.test.mjs. Create Web/v1/paired genera UUID solo quando ID è omesso; ID forniti non stringa, null o vuoti dopo trim danno 400, mentre gli ID opachi validi restano invariati. Il registro `patient_retired_ids` impedisce la ricreazione degli ID ritirati dal purge: retirement, cancellazione e audit condividono IMMEDIATE; Web/v1/paired danno 409 dopo ammissione del target/scope. Il guard importa gli ID esatti dai soli audit purge riusciti con subject valido e li conserva alle riaperture; purge storici privi di evidenza ed export/restore C15 non sono qualificati. Prove ABA, retirement ignorato/rollback e backfill nelle famiglie create/purge/network-lifecycle e bootstrap esistenti. Il duplicato esplicito dà 409 dopo ammissione del target/scope e senza nuovi dati o audit; la prenotazione del create-context viene annullata col rollback. Le prove SQLite e di normalizzazione coprono questi casi; OpenAPI 1.34.0 e ADR 0139 descrivono il contratto. Il create Web legacy/v1 rifiuta una destinazione inesistente con 404 nella transazione prima del lookup duplicato, senza effetti. V1 rifiuta `ambulatoryId` originale non stringa o blank con 400, conserva omissione/null senza membership e stringhe opache valide senza trim; la stessa famiglia SQLite verifica questi casi. Le ammissioni paired/fixed-preview/create-context restano invariate; il parser condiviso ora rifiuta versioni non safe con 400. Il core PUT paziente respinge versioni correnti esaurite con 409 prima degli effetti; MAX−1→MAX resta consentito. La successiva coorte lifecycle/move/clear aggiunge guardie di esaurimento nei percorsi esplicitati sotto; le altre operazioni amministrative restano fuori scope.

### E — Diario

Sorgenti: [lib/entry-write-input.ts](../lib/entry-write-input.ts), [lib/entry-write-operation.ts](../lib/entry-write-operation.ts), [lib/network-entry-write.ts](../lib/network-entry-write.ts).

Allowlist, date e normalizzazione; ID create validato o generato, patientId body Web/path v1 e paired. Update: ID figlio, versione richiesta, parent riletto nel core; v1/paired vincolano il figlio al path. Paired aggiunge membership e ENC, esclude campi AI/document-derived. PUT include tombstone/ripristino; DELETE locale è logico, non hard delete.

Prove di riferimento: [lib/entry-required-audit.test.ts](../lib/entry-required-audit.test.ts). test:network:home-base-diary-write; scripts/entry-required-audit-http.test.mjs. La suite SQLite verifica malformed input, parent/scope errati e stale senza effetti; il replay create con ID esplicito dà 409 su Web/v1 oppure 200 senza nuovi effetti su paired. Il diniego dopo tombstone del parent resta provato. La politica ADR 0015 è un’invariante, non una migrazione ancora da fare.

### T — Terapie

Sorgenti: [lib/therapy-write-input.ts](../lib/therapy-write-input.ts), [lib/api-schemas/clinical-writes.ts](../lib/api-schemas/clinical-writes.ts), [lib/api-v1-clinical-write-normalization.ts](../lib/api-v1-clinical-write-normalization.ts), [lib/therapy-write-operation.ts](../lib/therapy-write-operation.ts), [lib/network-therapy-write.ts](../lib/network-therapy-write.ts).

Allowlist/date/stati e normalizzazione per superficie; ID create o generazione host; patientId body Web/path v1 e paired. Parent attivo riletto nella transazione. Update/DELETE usano versione attesa e CAS del figlio; paired verifica membership e campi ENC. PUT comprende lifecycle; DELETE locale logico.

Prove di riferimento: [lib/therapy-required-audit.test.ts](../lib/therapy-required-audit.test.ts). test:network:home-base-therapy-write; scripts/therapy-required-audit-http.test.mjs. La suite SQLite copre le otto mutazioni con audit FAIL/IGNORE, ID/versioni non validi, parent/scope e duplicati senza effetti; le prove HTTP locali e paired sono collegate sopra. Conservare le differenze di data/timestamp già asserite fra adapter.

### O — Osservazioni

Sorgenti: [lib/observation-write-input.ts](../lib/observation-write-input.ts), [lib/api-v1-clinical-write-normalization.ts](../lib/api-v1-clinical-write-normalization.ts), [lib/observation-write-operation.ts](../lib/observation-write-operation.ts), [lib/network-observation-write.ts](../lib/network-observation-write.ts).

Allowlist/date e normalizzazione; ID create, parent attivo e CAS del figlio. v1/paired vincolano patientId al path; paired anche scope/ENC. Solo Web ammette servicePrescriptionItemId, verificato sullo stesso paziente nella transazione. PUT comprende tombstone/ripristino; DELETE locale logico.

Prove di riferimento: [lib/observation-required-audit.test.ts](../lib/observation-required-audit.test.ts), [lib/observation-service-item-link-schema.test.ts](../lib/observation-service-item-link-schema.test.ts). test:network:home-base-observation-write. Le prove SQLite coprono le otto mutazioni, input/ID/versioni, parent/scope e duplicati senza effetti. Il link prestazione viene verificato sullo stesso paziente e rimane esplicitamente respinto da v1/paired.

### C — Checkup

Sorgenti: [lib/checkup-json-body.ts](../lib/checkup-json-body.ts), [lib/api-v1-clinical-lifecycle.ts](../lib/api-v1-clinical-lifecycle.ts), [lib/api-schemas/clinical-writes.ts](../lib/api-schemas/clinical-writes.ts), [lib/api-v1-clinical-write-normalization.ts](../lib/api-v1-clinical-write-normalization.ts), [lib/checkup-write-operation.ts](../lib/checkup-write-operation.ts), [lib/network-checkup-write.ts](../lib/network-checkup-write.ts).

Schema/stati/date normalizzati; ID create, parent attivo nella transazione; update e DELETE con versione attesa/CAS. Figlio vincolato al patientId path v1/paired; membership e ENC paired. PUT comprende stato e lifecycle, DELETE locale logico; non conferisce autorità alla transizione headless.

Prove di riferimento: [lib/checkup-required-audit.test.ts](../lib/checkup-required-audit.test.ts), [lib/checkup-json-envelope.test.ts](../lib/checkup-json-envelope.test.ts). test:network:home-base-checkup-write. Create Web/v1/paired genera UUID solo se ID omesso; ID fornito non stringa, null o vuoto dopo trim dà 400 e gli ID opachi validi restano invariati. Duplicato dà 409 dopo parent/scope, senza effetti o dettagli del record esistente. La suite SQLite e lo schema coprono questi casi; OpenAPI 1.33.0 e ADR 0015 descrivono la restrizione. I caller Web forniscono UUID e Swift omette l’ID, quindi restano compatibili. Le prove body/date e audit restano invarianti ADR 0015/0141. Il parser condiviso rifiuta versioni non safe con 400. Il core update checkup, usato da PUT e dai DELETE che lo attraversano, verifica prima lookup/scope/stale e poi respinge la versione esaurita con 409 prima degli effetti; MAX−1→MAX resta consentito e il replay è stale. OpenAPI 1.35.0 e ADR 0010 documentano il limite del parser anche negli altri ingressi interessati. La successiva coorte lifecycle/move/clear aggiunge il guard di esaurimento ai percorsi sotto, senza estenderlo alle altre operazioni amministrative.

### PR — Prescrizioni protesiche

Sorgenti: [lib/api-schemas/prescriptions.ts](../lib/api-schemas/prescriptions.ts), [lib/prosthetic-prescription-write.ts](../lib/prosthetic-prescription-write.ts).

Schema create/update, ID e parent risolti dal core, versione richiesta per update/delete; controlli paziente/campo sigillato e scope del ramo paired. Create/update condividono il core; DELETE host è hard delete con CAS. Non esiste DELETE paired.

Prove di riferimento: [lib/prosthetic-prescription-atomic.test.ts](../lib/prosthetic-prescription-atomic.test.ts). test:network:home-base-prescriptions-write; scripts/prosthetic-audit-guard.test.mjs. Web e paired usano il [reader prescrizioni](../lib/prescription-json-body.ts): oggetto JSON entro 4 MiB, malformed/null/array/scalari 400 e oversize 413 dopo auth e prima del core. DELETE vuoto conserva la versione obbligatoria. Le [prove envelope](../lib/prescription-json-envelope.test.ts) coprono parser e collegamento Web/paired. ID create omesso genera UUID; se fornito deve essere una stringa non vuota dopo trim. ID opachi conservati, duplicati respinti con 409 prima di insert/audit. Le prove schema e SQLite atomiche esistenti coprono il contratto.

### SP — Prescrizioni prestazioni e item

Sorgenti: [lib/api-schemas/prescriptions.ts](../lib/api-schemas/prescriptions.ts), [lib/service-prescription-write.ts](../lib/service-prescription-write.ts).

Schema create/update, coerenza paziente/prescrizione/item nel core e versione attesa per update/delete. DELETE prescrizione host elimina anche gli item nella stessa transazione; DELETE item host usa il CAS item. Paired consente create/update, applica scope/ENC; niente DELETE paired.

Prove di riferimento: [lib/service-prescription-atomic.test.ts](../lib/service-prescription-atomic.test.ts). test:network:home-base-prescriptions-write; scripts/service-audit-guard.test.mjs. Stesso reader e prove envelope del profilo PR, su Web e paired. ID create segue la stessa regola PR; ordinal accetta interi safe o stringhe decimali complete, senza troncamento. Omissione create resta 0, omissione update non modifica il valore. Zero e negativi compatibili conservati; null, frazioni, suffissi e overflow sono 400. Mantenere parent/item/catalogo e cascade come invarianti distinti.

### A — Ambulatori e clear test

Sorgenti: [lib/ambulatory-write.ts](../lib/ambulatory-write.ts), [lib/network-ambulatory-write.ts](../lib/network-ambulatory-write.ts).

Validazione nel core, ID/versione, CAS, default e relativi incrementi; delete rifiuta contenitori ancora collegati. Clear è riservato al contenitore test, verifica versione e produce eventi per paziente più evento aggregato. Scope/capability paired resta nell’adapter, che prepara anche la guardia di autorità corrente: create, PUT, DELETE e clear paired la rieseguono nella transazione immediata prima degli effetti, e una revoca successiva all’ammissione dà 401/403 senza righe né audit. Il core rifiuta una scrittura paired priva di guardia prima della transazione. /api/v1/ambulatories è soltanto GET.

Prove di riferimento: [lib/ambulatory-atomic.test.ts](../lib/ambulatory-atomic.test.ts), [lib/test-container-clear.test.ts](../lib/test-container-clear.test.ts), [lib/network-ambulatory-write.test.ts](../lib/network-ambulatory-write.test.ts), [lib/network-ambulatory-commit-currentness.test.ts](../lib/network-ambulatory-commit-currentness.test.ts). test:network:home-base-ambulatory-write; scripts/ambulatory-audit-guard.test.mjs. Il body Web usa il parser condiviso con limite inclusivo di 4 MiB: JSON malformato o non oggetto dà 400, oltre soglia 413 prima degli effetti. DELETE vuoto conserva l’errore di versione mancante. Prova: [lib/ambulatory-json-body.test.ts](../lib/ambulatory-json-body.test.ts), selezionata dalla suite unit. Il create condiviso Web/paired rifiuta ID forniti non stringa o vuoti, `isDefault` non booleano e date di tipo non ammesso; ID omesso e data omessa conservano i default host. Le prove esistenti body Web e writer paired coprono il collegamento al parser condiviso. Clear non equivale a nukeTestData.

Clear incrementa anche i pazienti che perdono soltanto la membership test, senza cambiare primary o lifecycle; gli audit `patient.updated` condividono il commit. Ogni parent viene incrementato una sola volta. Clear rifiuta versioni non incrementabili del contenitore o di qualunque membro con 409: un errore paziente annulla anche il bump del contenitore prima della traduzione fuori transazione.

### B — Bulk paziente

Sorgenti: [lib/api-schemas/patient-bulk.ts](../lib/api-schemas/patient-bulk.ts).

Schema array ID e ambulatorio; lookup pazienti attivi/target. Move richiede mappa patientVersions esatta, CAS e preflight dell’incrementabilità dell’intero batch prima delle membership; duplicate genera UUID e copia le righe nella transazione batch. Assign/unassign richiedono la mappa patientVersions esatta e verificano tutto il batch prima degli effetti. Ogni modifica effettiva aggiorna versione/updatedAt e audit nella stessa transazione immediata; primary resta invariato. No-op con versione corrente non modifica dati né audit; richieste stale e replay di mutazioni restituiscono 409. Anche move e duplicate inseriscono gli eventi obbligatori nella propria transazione immediata e limitano il JSON a 256 KiB. Duplicate include i lookup nello stesso snapshot e conserva campi e versione degli originali nei nuovi cloni.

Prove di riferimento: [lib/patient-ambulatory-membership.test.ts](../lib/patient-ambulatory-membership.test.ts). test:patient-ambulatory-membership è riferimento adiacente, non prova completa dei quattro endpoint. Duplicate richiede sourceAmbulatoryId, patientVersions esatta e duplicateIntentId UUID; verifica appartenenza sorgente e versioni del batch prima degli effetti. Il token viene consumato nella stessa transazione di cloni e audit: qualunque riuso restituisce 409 anche dopo la rimozione dei cloni. Assign/unassign respingono versioni superate anche da fix-orphans, migrate-m2m e clear. Export/restore in un nuovo archivio resta C15; il retirement degli ID impedisce la ricreazione dopo purge nell’archivio attivo.

La [suite SQLite delle membership](../lib/patient-membership-required-audit.test.ts),
selezionata dal profilo unit richiesto, verifica successo con identità host,
rollback di tutto il batch al secondo audit, replay/no-op e 4xx senza effetti, compresi relink e clear interposti. Il clipboard copy invia la mappa versioni catturata; nessun nuovo writer nella facade.
Lo smoke [patient-concurrency](../scripts/patient-concurrency.test.mjs) usa
l'origine e i metadati di trasporto richiesti dal client Web. I suoi cinque
scenari verificano conflitti Web/API v1 e contesa del move; la prova specifica
di assign/unassign resta nella suite SQLite delle membership.

La [suite SQLite del trasferimento](../lib/patient-move-required-audit.test.ts)
è selezionata dal profilo unit richiesto: audit del batch, rollback sul secondo
evento, CAS/replay e input/scope negati senza effetti. Il trasferimento conserva
la semantica del filtro opzionale `sourceAmbulatoryId` e le altre membership.

Le [prove SQLite di duplicate](../lib/patient-duplicate-required-audit.test.ts),
selezionate dalla suite unit, verificano due cloni con eventi attribuiti all’host,
rollback di cloni/membership/eventi al guasto del secondo audit e dinieghi senza
effetti. UUID nuovi, campi e versione copiati, ambulatorio primario e count sono
preservati. La suite verifica CAS, sorgente errata, replay con body/target cambiato o cloni rimossi e rollback del token al guasto audit; il retry dopo rollback può completare. La snapshot e l’intento del clipboard restano stabili sugli errori. Non risultano consumatori UI del hook nella base esaminata: le prove del helper non attestano un percorso grafico operativo. Il registro è locale: restore nello stesso DB conserva i token, export/restore in un nuovo DB perde quelli storici; questo limite resta in WUL-730/C15.

### D — Allegati

Sorgenti: [lib/attachment-web-create.ts](../lib/attachment-web-create.ts), [lib/api-schemas/attachments.ts](../lib/api-schemas/attachments.ts), [lib/attachment-content-cas-route.ts](../lib/attachment-content-cas-route.ts), [lib/attachment-currentness-host.ts](../lib/attachment-currentness-host.ts), [lib/network-attachment-write.ts](../lib/network-attachment-write.ts).

Create Web: schema, ID client o UUID, payload e parent attivo nella transazione; currentness host. PUT metadata: allowlist e transizioni coda, patientId e currentness osservata richiesti prima dell’incremento host. PUT content: expected currentness e CAS, parser dedicato. DELETE Web: patientId/currentness client, predicato verificato e changes=1 nella stessa transazione. Paired upload genera ID host e rilegge paziente/scope in transazione; ENC e no campi document-derived. Paired detail è solo GET.

Prove di riferimento: [lib/attachment-web-create-currentness.test.ts](../lib/attachment-web-create-currentness.test.ts), [lib/attachment-web-put-currentness.test.ts](../lib/attachment-web-put-currentness.test.ts), [lib/attachment-currentness-host.test.ts](../lib/attachment-currentness-host.test.ts), [lib/network-attachment-write.test.ts](../lib/network-attachment-write.test.ts). test:network:home-base-documents-write; check:attachment-currentness-writers; test:attachment-currentness-writers. Create/delete Web ora richiedono un evento nella stessa transazione immediata della mutazione; il create legge JSON entro il limite attachment corrente e rifiuta duplicati con 409. Nel solo create Web, ID omesso genera UUID; ID presente null, non stringa o vuoto dopo trim dà 400 prima degli effetti. Una stringa opaca valida resta invariata byte per byte. Il parser attachment e la suite SQLite create/currentness coprono rifiuto senza attachment/audit, omissione e ID opaco. La suite create/currentness, già selezionata da unit, copre successo, rollback al guasto audit, INSERT ignorato e input/scope senza effetti. Anche metadata/content Web richiedono `attachment.updated` nella transazione esterna immediata: il savepoint currentness usa la stessa connessione e il guasto audit annulla entrambi. Metadata legge un oggetto JSON entro 4 MiB; il CAS content rimane invariato. Prove: [metadata PUT](../lib/attachment-metadata-currentness.test.ts) e [content CAS](../lib/attachment-web-put-currentness.test.ts). Metadata/delete ora confrontano patientId e tuple prima degli effetti; i GET Web espongono currentness nella stessa query del record. UI e facade inviano la snapshot catturata prima della conferma, senza aggiornamenti automatici. Prove server già citate e [client preconditions](../lib/attachment-client-preconditions.test.ts); la lettura mirata dei caller upload, cleanup, estrazione, backfill e archivio non ha trovato ulteriori richieste metadata/delete prive di snapshot. Le prove esistenti [source authority](../lib/domain/documents/attachment-extraction-source-authority.test.ts), [projection client](../lib/domain/documents/attachment-extraction-projection-client.test.ts), [backfill CAS](../scripts/document-evidence-backfill-currentness-cas.test.ts) e [archive](../lib/domain/documents/document-insights-archive.test.ts) restano i riferimenti dei rispettivi confini. La rilettura extraction è preview senza scritture; il DELETE cancella il grant. Restore resta C15.

Il create paired mantiene campi sigillati, allowlist e scope esistenti: insert,
currentness e audit condividono la transazione immediata. Le [prove SQLite paired](../lib/network-attachment-write.test.ts)
coprono successo, scope, fault audit e insert ignorato. Il wrapper POST distingue
input invalido (400) da guasto writer (500), conservando reservation, abort,
timeout e soglia JSON; prova in [native-network-attachment-budget](../scripts/native-network-attachment-budget.test.mjs).

### S — Workflow SISS persistito

Sorgenti:
[POST](../app/api/siss-handoffs/route.ts),
[PUT/DELETE](../app/api/siss-handoffs/[id]/route.ts),
[schema](../lib/api-schemas/siss-handoffs.ts).
POST/PUT usano JSON bounded a 262.144 byte e schema/outcome/date. POST accetta
ID o UUID, rilegge paziente attivo e duplicati nella transazione: 404 per parent
assente/eliminato, 409 per ID già presente. PUT/DELETE rileggono il handoff nella
transazione. Tutte e tre le mutazioni verificano rowcount e inseriscono audit
attribuito alla sessione nella stessa transazione sincrona IMMEDIATE; il successo
segue il commit. PUT/DELETE non aggiungono una nuova verifica del lifecycle parent.
Create e letture espongono versione host (iniziale 1). PUT/DELETE richiedono patientId e versione osservati: parent diverso 404, versione superata 409 prima degli effetti; PUT incrementa la versione nello stesso commit. Solo Web.

Prova: [siss-handoff-required-audit.test.ts](../lib/siss-handoff-required-audit.test.ts),
registrata nella suite unit. Verifica i tre rollback per errore audit, i successi
con un solo evento attribuito alla sessione e i dinieghi senza effetti.
La stessa suite prova wrong-parent, versione superata e replay senza effetti, parità dello schema nuovo/aggiornato e versioni iniziali dei record legacy. La facade invia la snapshot osservata; clear la cattura dagli item letti. La UI fissa target e versione all’inizio della bozza e blocca l’invio se cambiano, senza adottare una versione fresca; delete cattura prima della conferma. Restore C15 e cancellazione seguita da ricreazione della stessa identità/versione restano residui distinti. I test del lancio SISS non sostituiscono questa suite CRUD.

### M — Manutenzione paziente

Sorgenti: [lib/patient-cascade.ts](../lib/patient-cascade.ts).

Sessione Web admin. Restore accetta soltanto patientId, rilegge tombstone/versione in transazione immediata e incrementa versione host soltanto se safe e inferiore a MAX; esaurimento e replay dopo restore sono 409 senza effetti. Purge espone versione/deletedAt nel GET coerente e richiede ID/versione osservati nel POST: il confronto stale precede cascade e revoca locator; elimina figli/paziente e inserisce audit nella stessa transazione immediata. Il CAS riguarda la riga paziente, non lo snapshot dei figli. Fix-orphans richiede expectedSnapshot SHA-256 dal GET coerente: pazienti orfani ID/versione, target ID/versione/default e identità dei figli orfani ordinate. POST confronta il piano nella TX immediata prima di default, relink, purge, revoca e audit; preflight delle versioni incrementabili sull’intero batch. Ogni relink incrementa versione/updatedAt. Migrate-m2m richiede invece GET preview e POST con snapshot esatta di candidati, versioni paziente e primario/versione ambulatorio. Lookup, confronto completo, relink, bump e audit condividono la transazione IMMEDIATE; la risposta migrated/total è preservata. Entrambi i metodi richiedono Web admin. Restore qui descritto non richiede una versione client; fix-orphans richiede il digest del piano osservato.

Prove di riferimento: [lib/patient-restore-required-audit.test.ts](../lib/patient-restore-required-audit.test.ts), [lib/patient-lifecycle.test.ts](../lib/patient-lifecycle.test.ts). scripts/patient-restore-required-audit-http.test.mjs; test:patient-cascade. Purge è coperto anche da [lib/patient-purge-required-audit.test.ts](../lib/patient-purge-required-audit.test.ts), selezionato dalla suite unit: successo, fault audit con rollback dati/eventi, replay e input/scope senza effetti. La revoca conservativa dei locator del cascade resta attiva anche dopo rollback SQLite. Le [prove SQLite di fix-orphans](../lib/orphan-repair-required-audit.test.ts), selezionate dalla suite unit, coprono successo composto, rollback all’ultimo audit o durante il purge, input, replay superato immediato/interposto 409 e piano vuoto riletto senza eventi né revoca locator. Il corpo richiede expectedSnapshot (assente/malformato 400); il flag purge opzionale richiede un booleano esplicito. Il digest include conservativamente i figli anche senza purge. Le [prove SQLite membership](../lib/patient-membership-required-audit.test.ts) coprono migrate-m2m: snapshot esatta, target/versioni, replay immediato e interposto, rollback, input/auth e limite preview. Confini C05-M: purge-patient ha CAS della riga paziente e non dei figli; il registro `patient_retired_ids` impedisce il riuso dell’identità paziente dopo purge nel database corrente. Il ripristino di autorità e identità attraverso C15 resta distinto.

### Nomi evento e transazioni dei profili migrati

P: `patient.created/updated/deleted/restored`; E: `entry.created/updated/deleted`;
T: `therapy.created/updated/deleted`; O: `observation.created/updated/deleted`;
C: `checkup.created/updated/deleted`. Il ripristino del figlio tramite PUT è un
aggiornamento secondo il writer, non un evento `*.restored` inventato.
I core E/T/O/C usano transazioni sincrone immediate con rilettura e audit richiesto.
P mantiene gli owner distinti di create/update/delete/lifecycle e restore admin.
PR usa `prosthetic.prescription.*`; SP `service.prescription.*` e
`service.prescription_item.*`; A `ambulatory.*` e, nel clear, `patient.deleted` oppure `patient.updated` per il solo unlink.
I tre core PR/SP/A sono transazionali immediati. S usa `siss.handoff.*` nella stessa transazione; D paired usa `attachment.created` nella stessa transazione; purge paziente M usa
`patient.purged` nella stessa transazione, anche nel purge opzionale di fix-orphans. Nei rami segnati **nessuno** non va presunto un
evento solo perché il dominio compare nella taxonomy.


## Mappa canonica degli ingressi e dei caller

La fonte unica leggibile da macchina è [clinical-write-surfaces.csv](./clinical-write-surfaces.csv).
Una riga descrive una mutazione per superficie oppure un caller composto che
rinvia agli ID dei writer: i rinvii non contano come nuovi commit. Il CSV conserva
ID e profili delle precedenti righe HTTP, aggiunge gli owner non ordinari e separa
`active`, export senza caller produzione osservato e worker di prova.
Autorizzazione, versione/currentness, transazione e audit sono campi distinti;
`no` indica assenza osservata, non un permesso a omettere la garanzia.
Le differenze cliniche e le prove di riferimento restano nei profili sopra.
La [mappa delle altre autorità e disposizioni C01](./authority-census.md) classifica
restore, schema, processi, rete e custodia, senza confonderli con CRUD clinico.

## Identificativi: regola trasversale da conservare nel roster

La base non espone una route autonoma di mutazione degli identificativi paziente.
Le scritture di `id`, `patientId`, `ambulatoryId`, ID figli e riferimenti devono
restare nel contratto della rispettiva riga; non dedurre validazione UUID dal tipo
TypeScript. [common.ts](../lib/api-schemas/common.ts) definisce `optionalIdSchema`
come stringa opzionale, senza una garanzia UUID generale. La normalizzazione
[paziente](../lib/patient-write-normalization.ts) non è una validazione generale
anagrafica del codice fiscale. Il controllo duplicati lato UI non è una prova
transazionale di unicità.

C05-ID: caratterizzare per famiglia ID vuoto, whitespace, inesistente, duplicato,
figlio di altro paziente, target fuori scope, mismatch path/body e retry. Preservare
le decisioni esistenti: [patient-bulk](../lib/api-schemas/patient-bulk.ts) richiede
la corrispondenza della mappa versioni per move; create allegato Web accetta ID opaco non blank o genera
UUID solo se omesso, mentre upload paired lo genera; duplicate genera UUID per ciascun clone.
Non introdurre una nuova politica ID trasversale durante la sola migrazione SISS.

## Caller composti e percorsi senza commit

I caller composti sono righe `X-*` del CSV, con gli ID delle mutazioni raggiunte.
[ApiTable](../lib/db.ts) inoltra al writer HTTP; bulkPut/clear possono comporre
più richieste e non acquisiscono una transazione globale. I test dei caller
verificano esiti parziali, non sostituiscono le prove SQLite dei profili.
Create-context, local-extraction e le preview Fabric non applicano dati clinici;
OCR replay e apply Smart Import ritirati rimangono fail-closed. SOAP e review
esportati non sono presentati come UI o operazioni MCP disponibili.

Conversazioni e messaggi attraversati da `nukeTestData` sono dati applicativi
persistenti, non automaticamente cartella clinica. I loro POST/PUT/DELETE sono
in [conversations](../app/api/conversations/route.ts),
[conversation item](../app/api/conversations/[id]/route.ts),
[messages](../app/api/messages/route.ts) e [message item](../app/api/messages/[id]/route.ts).
C05-SEED deve registrare il loro contributo al risultato della pulizia; questo
roster non li promuove a un nuovo dominio di commit clinico.

## Superfici assenti e confini esclusi motivati

- Diario/terapia/osservazione/checkup paired espongono POST e PUT: eliminazione
  logica/ripristino passano dai campi lifecycle ammessi del PUT. Non inventare
  DELETE paired. Prescrizioni paired non espongono DELETE.
- Ambulatori API v1 locale: [route](../app/api/v1/ambulatories/route.ts) solo GET;
  CRUD/clear host e paired sono distinti. Bulk paziente, SISS persistito e
  manutenzione admin non hanno equivalenti v1/paired nella base.
- Allegati API v1 locale: nessun writer dedicato; paired ha upload, non PUT/DELETE
  del dettaglio. Policy document-derived: [ADR 0076](./adr/0076-paired-document-domain-write-policy.md).
- SOAP/headless, transizione checkup trusted e attestazioni di ruolo hanno i
  propri owner, receipt e replay: [ADR 0103](./adr/0103-headless-clinician-authorized-soap-entry-write.md)
  e [ADR 0116](./adr/0116-agentic-checkup-status-transition.md). Non sono migrazioni
  al writer ordinario C05 e nessuna capacità nuova viene concessa agli agenti.
- Backup restore, swap/repair DB e scheduler operano su custodia/storia e autorità
  differenti: [repair route](../app/api/system/repair-db/route.ts),
  [restore executor](../lib/backup-restore-executor.ts), [ADR 0142](./adr/0142-sqlite-maintenance-admission.md).
  Destinazione C15, non una transazione clinica ordinaria inventata da C05.
- Repertori farmaci/esenzioni/cataloghi sono dati di riferimento; i relativi import
  non diventano prescrizioni o osservazioni. Sicurezza/settings e lifecycle login
  conservano i propri contratti. I lanci SISS restituiscono handoff, non attestano
  prescrizioni o modifiche del diario SISS persistito.

## Aggiornamento del roster

Quando cambia un writer, aggiornare la sua riga CSV e il profilo interessato con
l'implementazione. Le prove di famiglia rimangono nella suite esistente; CI e PR
conservano esiti e revisione eseguita, senza copiare qui log o conteggi.
I limiti di restore/custodia rimangono C15. Differenze nuove rilevate dal censimento
sono esplicite nella mappa C01 e richiedono destinazione del responsabile, non una
chiusura o riapertura dedotta dalle etichette storiche delle coorti.

## C-5a / G-6: solo comando stato terapia

La Web compone `therapy.status.change.v1` mediante il medico admin Web corrente,
con ammissione fisica della projection e controlli host sotto IMMEDIATE.
`therapy-status-command-service.ts` delega allo stesso nucleo Tx di
`therapy-write-operation.ts`: CAS, update, audit e receipt committano insieme.
Read non scrive; close ritira l'ID con target NULL, senza CAS corrente.
Il tombstone non vale per PUT legacy. Nessuna autorità chat/MCP o AI.
La policy endDate usa un istante host e differisce dal browser legacy;
backup e restore conservano union esatta del ledger e audit (ADR0168).
Prove: `therapy-status-command*.test.ts`, regressioni required-audit, backup
roundtrip/recovery e `verify:therapy-status` con confini legacy/nuovo separati.
