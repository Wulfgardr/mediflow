---
summary: "Roster operativo C05 delle mutazioni cliniche Web, API v1 e paired: ingressi, validazione, transazione, audit e prove da collegare."
read_when:
  - "Preparare una coorte WUL-720 o modificare una scrittura clinica ordinaria."
---

# Roster operativo delle scritture cliniche — C05

Roster per [WUL-720](https://linear.app/wulfgardr/issue/WUL-720), ricavato dalla
base `fe974d1956a72d97bf90fc10fd36d0892b092b8e` e aggiornato con la migrazione
atomica del diario SISS locale e delle membership ambulatoriali. Le correzioni successive aggiornano la riga
interessata insieme al codice. Le celle con un gap indicano lavoro ancora aperto
in C05; la presenza della tabella non ne attesta il completamento.

Una riga HTTP identifica **metodo + adapter + superficie**. Il profilo richiamato
nella riga ne completa validazione, identificativi, transazione, audit e prove:
i profili sono parte del roster, non un rinvio a una verifica non eseguita.
`TX+audit` significa che il core corrente inserisce l'evento nella stessa
transazione; non significa che tutti gli input e tutti i client siano qualificati.
`Nessuno` e `al meglio` sono debiti distinti, entrambi aperti quando attestano
una mutazione clinica. Il request ID resta correlazione, non idempotenza.

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
- [Inventario test](./test-inventory.md) e [manifest test](../test-inventory.v1.json):
  distinguono presenza, selezione ed esecuzione. Le prove sotto sono riferimenti,
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

Sorgenti: [lib/patient-write-normalization.ts](../lib/patient-write-normalization.ts), [lib/patient-json-object.ts](../lib/patient-json-object.ts), [lib/patient-update-operation.ts](../lib/patient-update-operation.ts), [lib/patient-delete-operation.ts](../lib/patient-delete-operation.ts), [lib/patient-create-service.ts](../lib/patient-create-service.ts), [lib/network-patient-lifecycle.ts](../lib/network-patient-lifecycle.ts).

Create: normalizzazione paziente, ID fornito o generato secondo adapter, versione iniziale host; associazione ambulatoriale nel commit. PUT: ID path, versione attesa e CAS; assente/null del primario distinti, associazioni conservate. DELETE: tombstone e versione; esaurimento della versione corrente restituisce 409 prima degli effetti. DELETE/restore paired mantengono la stessa guardia dopo scope/currentness. Paired: parent paziente nello scope e campi sigillati; restore rete distinto dal ripristino amministrativo. Create-context Web lega la creazione al contesto corrente, non crea il paziente.

Prove di riferimento: [lib/patient-required-audit.test.ts](../lib/patient-required-audit.test.ts), [lib/patient-create-required-audit.test.ts](../lib/patient-create-required-audit.test.ts), [lib/network-patient-lifecycle-required-audit.test.ts](../lib/network-patient-lifecycle-required-audit.test.ts), [lib/patient-json-envelope.test.ts](../lib/patient-json-envelope.test.ts), [lib/patient-create-service.test.ts](../lib/patient-create-service.test.ts). test:concurrency:patients; test:network:home-base-patient-lifecycle-write; HTTP create in scripts/patient-create-required-audit-http.test.mjs. Create Web/v1/paired genera UUID solo quando ID è omesso; ID forniti non stringa, null o vuoti dopo trim danno 400, mentre gli ID opachi validi restano invariati. Il registro `patient_retired_ids` impedisce la ricreazione degli ID ritirati dal purge: retirement, cancellazione e audit condividono IMMEDIATE; Web/v1/paired danno 409 dopo ammissione del target/scope. Il guard importa gli ID esatti dai soli audit purge riusciti con subject valido e li conserva alle riaperture; purge storici privi di evidenza ed export/restore C15 non sono qualificati. Prove ABA, retirement ignorato/rollback e backfill nelle famiglie create/purge/network-lifecycle e bootstrap esistenti. Il duplicato esplicito dà 409 dopo ammissione del target/scope e senza nuovi dati o audit; la prenotazione del create-context viene annullata col rollback. Le prove SQLite e di normalizzazione coprono questi casi; OpenAPI 1.34.0 e ADR 0139 descrivono il contratto. Il create Web legacy/v1 rifiuta una destinazione inesistente con 404 nella transazione prima del lookup duplicato, senza effetti. V1 rifiuta `ambulatoryId` originale non stringa o blank con 400, conserva omissione/null senza membership e stringhe opache valide senza trim; la stessa famiglia SQLite verifica questi casi. Le ammissioni paired/fixed-preview/create-context restano invariate; il parser condiviso ora rifiuta versioni non safe con 400. Il core PUT paziente respinge versioni correnti esaurite con 409 prima degli effetti; MAX−1→MAX resta consentito. La successiva coorte lifecycle/move/clear aggiunge guardie di esaurimento nei percorsi esplicitati sotto; le altre operazioni amministrative restano fuori scope.

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

Validazione nel core, ID/versione, CAS, default e relativi incrementi; delete rifiuta contenitori ancora collegati. Clear è riservato al contenitore test, verifica versione e produce eventi per paziente più evento aggregato. Scope/capability paired resta nell’adapter. /api/v1/ambulatories è soltanto GET.

Prove di riferimento: [lib/ambulatory-atomic.test.ts](../lib/ambulatory-atomic.test.ts), [lib/test-container-clear.test.ts](../lib/test-container-clear.test.ts), [lib/network-ambulatory-write.test.ts](../lib/network-ambulatory-write.test.ts). test:network:home-base-ambulatory-write; scripts/ambulatory-audit-guard.test.mjs. Il body Web usa il parser condiviso con limite inclusivo di 4 MiB: JSON malformato o non oggetto dà 400, oltre soglia 413 prima degli effetti. DELETE vuoto conserva l’errore di versione mancante. Prova: [lib/ambulatory-json-body.test.ts](../lib/ambulatory-json-body.test.ts), selezionata dalla suite unit. Il create condiviso Web/paired rifiuta ID forniti non stringa o vuoti, `isDefault` non booleano e date di tipo non ammesso; ID omesso e data omessa conservano i default host. Le prove esistenti body Web e writer paired coprono il collegamento al parser condiviso. Clear non equivale a nukeTestData.

Clear incrementa anche i pazienti che perdono soltanto la membership test, senza cambiare primary o lifecycle; gli audit `patient.updated` condividono il commit. Ogni parent viene incrementato una sola volta. Clear rifiuta versioni non incrementabili del contenitore o di qualunque membro con 409: un errore paziente annulla anche il bump del contenitore prima della traduzione fuori transazione.

### B — Bulk paziente

Sorgenti: [lib/api-schemas/patient-bulk.ts](../lib/api-schemas/patient-bulk.ts).

Schema array ID e ambulatorio; lookup pazienti attivi/target. Move richiede mappa patientVersions esatta, CAS e preflight dell’incrementabilità dell’intero batch prima delle membership; duplicate genera UUID e copia le righe nella transazione batch. Assign/unassign richiedono la mappa patientVersions esatta e verificano tutto il batch prima degli effetti. Ogni modifica effettiva aggiorna versione/updatedAt e audit nella stessa transazione immediata; primary resta invariato. No-op con versione corrente non modifica dati né audit; richieste stale e replay di mutazioni restituiscono 409. Anche move e duplicate inseriscono gli eventi obbligatori nella propria transazione immediata e limitano il JSON a 256 KiB. Duplicate include i lookup nello stesso snapshot e conserva campi e versione degli originali nei nuovi cloni.

Prove di riferimento: [lib/patient-ambulatory-membership.test.ts](../lib/patient-ambulatory-membership.test.ts). test:patient-ambulatory-membership è riferimento adiacente, non prova completa dei quattro endpoint. Duplicate richiede sourceAmbulatoryId, patientVersions esatta e duplicateIntentId UUID; verifica appartenenza sorgente e versioni del batch prima degli effetti. Il token viene consumato nella stessa transazione di cloni e audit: qualunque riuso restituisce 409 anche dopo la rimozione dei cloni. Assign/unassign respingono versioni superate anche da fix-orphans, migrate-m2m e clear. Restore C15 e purge seguito da ricreazione dello stesso ID/versione restano casi distinti da risolvere.

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

Sessione Web admin. Restore accetta soltanto patientId, rilegge tombstone/versione in transazione immediata e incrementa versione host soltanto se safe e inferiore a MAX; esaurimento e replay dopo restore sono 409 senza effetti. Purge espone versione/deletedAt nel GET coerente e richiede ID/versione osservati nel POST: il confronto stale precede cascade e revoca locator; elimina figli/paziente e inserisce audit nella stessa transazione immediata. Il CAS riguarda la riga paziente, non lo snapshot dei figli. Fix-orphans unisce lookup, default, relink e purge opzionale con i rispettivi audit in una transazione immediata; ogni relink incrementa versione/updatedAt. Migrate-m2m richiede invece GET preview e POST con snapshot esatta di candidati, versioni paziente e primario/versione ambulatorio. Lookup, confronto completo, relink, bump e audit condividono la transazione IMMEDIATE; la risposta migrated/total è preservata. Entrambi i metodi richiedono Web admin. Restore e fix-orphans qui descritti non richiedono una versione client.

Prove di riferimento: [lib/patient-restore-required-audit.test.ts](../lib/patient-restore-required-audit.test.ts), [lib/patient-lifecycle.test.ts](../lib/patient-lifecycle.test.ts). scripts/patient-restore-required-audit-http.test.mjs; test:patient-cascade. Purge è coperto anche da [lib/patient-purge-required-audit.test.ts](../lib/patient-purge-required-audit.test.ts), selezionato dalla suite unit: successo, fault audit con rollback dati/eventi, replay e input/scope senza effetti. La revoca conservativa dei locator del cascade resta attiva anche dopo rollback SQLite. Le [prove SQLite di fix-orphans](../lib/orphan-repair-required-audit.test.ts), selezionate dalla suite unit, coprono successo composto, rollback all’ultimo audit o durante il purge, input e replay vuoto senza eventi né revoca locator. Il corpo assente resta compatibile, il flag purge richiede un booleano esplicito. Le [prove SQLite membership](../lib/patient-membership-required-audit.test.ts) coprono migrate-m2m: snapshot esatta, target/versioni, replay immediato e interposto, rollback, input/auth e limite preview. Gap C05-M: versione attesa dal client e replay interposto restano aperti per fix-orphans; purge ha CAS della riga paziente e non dei figli; ABA dopo ricreazione della stessa identità/versione e C15 non sono qualificati.

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


## Tabella degli ingressi di mutazione

`Profilo` rinvia alle regole e ai test sopra. I metodi PUT possono includere
più transizioni ammesse (stato, archiviazione, tombstone/ripristino): queste non
sono nuovi endpoint. Le righe non elencano GET, preview o route ritirate come commit.

| ID | Superficie, metodo e adapter | Profilo / validazione e body | ID, parent e versione | Owner transazione / audit | Stato e coorte |
| --- | --- | --- | --- | --- | --- |
| A-01 | Web PUT [/api/ambulatories/[id]/route.ts](../app/api/ambulatories/[id]/route.ts) | A; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | ambulatory-write; **TX+audit** | Audit e body migrati; prove C05-A sopra |
| A-02 | Web DELETE [/api/ambulatories/[id]/route.ts](../app/api/ambulatories/[id]/route.ts) | A; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | ambulatory-write; **TX+audit** | Audit e body migrati; prove C05-A sopra |
| A-03 | Web POST [/api/ambulatories/clear/route.ts](../app/api/ambulatories/clear/route.ts) | A; JSON oggetto ≤ 4 MiB | ambulatoryId + versione; solo test container | ambulatory-write; **TX+audit** | Audit e body migrati; prove C05-A sopra |
| A-04 | Web POST [/api/ambulatories/route.ts](../app/api/ambulatories/route.ts) | A; JSON oggetto ≤ 4 MiB | Create: ID/parent del profilo; versione host | ambulatory-write; **TX+audit** | Audit, body e campi create validati; prove C05-A sopra |
| D-01 | Web PUT [/api/attachments/[id]/content/route.ts](../app/api/attachments/[id]/content/route.ts) | D; JSON ≤ resolveMaxAttachmentBytes | ID/currentness del profilo; no patients.version | TX esterna + currentness savepoint; **TX+audit** | Audit migrato; CAS content preservato |
| D-02 | Web PUT [/api/attachments/[id]/route.ts](../app/api/attachments/[id]/route.ts) | D; JSON oggetto ≤ 4 MiB | ID, patientId e currentness osservata; no patients.version | TX esterna + currentness savepoint; **TX+audit** | Audit e precondizione client migrati; stale/replay senza effetti |
| D-03 | Web DELETE [/api/attachments/[id]/route.ts](../app/api/attachments/[id]/route.ts) | D; JSON oggetto ≤ 4 MiB | ID, patientId e currentness osservata | Precheck+delete in TX immediata; **TX+audit** | Audit e CAS migrati; replay/ricreazione respinti |
| D-04 | Web POST [/api/attachments/route.ts](../app/api/attachments/route.ts) | D; JSON bounded al limite attachment + payload | ID omesso UUID, invalido400, duplicato409; currentness host; parent attivo | attachment-web-create TX immediata; **TX+audit** | Create migrato; altri writer C05-D aperti |
| C-01 | Web PUT [/api/checkups/[id]/route.ts](../app/api/checkups/[id]/route.ts) | C; 4 MiB | ID path; parent e versione del profilo | checkup-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| C-02 | Web DELETE [/api/checkups/[id]/route.ts](../app/api/checkups/[id]/route.ts) | C; 4 MiB | ID path; parent e versione del profilo | checkup-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| C-03 | Web POST [/api/checkups/route.ts](../app/api/checkups/route.ts) | C; 4 MiB | Create: ID/parent del profilo; versione host | checkup-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| E-01 | Web PUT [/api/entries/[id]/route.ts](../app/api/entries/[id]/route.ts) | E; 4 MiB | ID path; parent e versione del profilo | entry-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| E-02 | Web DELETE [/api/entries/[id]/route.ts](../app/api/entries/[id]/route.ts) | E; 4 MiB | ID path; parent e versione del profilo | entry-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| E-03 | Web POST [/api/entries/route.ts](../app/api/entries/route.ts) | E; 4 MiB | Create: ID/parent del profilo; versione host | entry-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| O-01 | Web PUT [/api/observations/[id]/route.ts](../app/api/observations/[id]/route.ts) | O; 4 MiB | ID path; parent e versione del profilo | observation-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| O-02 | Web DELETE [/api/observations/[id]/route.ts](../app/api/observations/[id]/route.ts) | O; 4 MiB | ID path; parent e versione del profilo | observation-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| O-03 | Web POST [/api/observations/route.ts](../app/api/observations/route.ts) | O; 4 MiB | Create: ID/parent del profilo; versione host | observation-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| P-01 | Web PUT [/api/patients/[id]/route.ts](../app/api/patients/[id]/route.ts) | P; 4 MiB | ID path; parent e versione del profilo | patient-update-operation; **TX+audit** | Migrato; delta/prove per profilo |
| P-02 | Web DELETE [/api/patients/[id]/route.ts](../app/api/patients/[id]/route.ts) | P; 4 MiB | ID path; parent e versione del profilo | patient-delete-operation; **TX+audit** | Migrato; delta/prove per profilo |
| B-01 | Web POST [/api/patients/assign/route.ts](../app/api/patients/assign/route.ts) | B; 256 KiB | Array patientIds, targetAmbulatoryId e mappa patientVersions esatta; CAS | TX immediata adapter con lookup; **TX+audit** per modifica effettiva | Audit/input e CAS migrati; prova membership sotto |
| B-02 | Web POST [/api/patients/duplicate/route.ts](../app/api/patients/duplicate/route.ts) | B; 256 KiB | IDs, source/target, versioni esatte e intento UUID; UUID nuovo per clone | Precheck+token+clone+membership in TX immediata; **TX+audit** | CAS/replay archivio attivo migrati; restore nuovo DB resta C15 |
| B-03 | Web POST [/api/patients/move/route.ts](../app/api/patients/move/route.ts) | B; 256 KiB | Array patientIds, target e mappa patientVersions esatta; CAS | TX immediata adapter; **TX+audit** per paziente | Audit/input migrati; prova move nel profilo B |
| P-03 | Web POST [/api/patients/route.ts](../app/api/patients/route.ts) | P; 4 MiB | Create: ID/parent del profilo; versione host | TX adapter + patient-create-service; **TX+audit** | Migrato; delta/prove per profilo |
| B-04 | Web POST [/api/patients/unassign/route.ts](../app/api/patients/unassign/route.ts) | B; 256 KiB | Array patientIds, ambulatoryId e mappa patientVersions esatta; CAS | TX immediata adapter con lookup; **TX+audit** per modifica effettiva | Audit/input e CAS migrati; prova membership sotto |
| PR-01 | Web PUT [/api/prosthetic-prescriptions/[id]/route.ts](../app/api/prosthetic-prescriptions/[id]/route.ts) | PR; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | prosthetic-prescription-write; **TX+audit** | Audit, body e ID create migrati; prove PR sopra |
| PR-02 | Web DELETE [/api/prosthetic-prescriptions/[id]/route.ts](../app/api/prosthetic-prescriptions/[id]/route.ts) | PR; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | prosthetic-prescription-write; **TX+audit** | Audit, body e ID create migrati; prove PR sopra |
| PR-03 | Web POST [/api/prosthetic-prescriptions/route.ts](../app/api/prosthetic-prescriptions/route.ts) | PR; JSON oggetto ≤ 4 MiB | Create: ID/parent del profilo; versione host | prosthetic-prescription-write; **TX+audit** | Audit, body e ID create migrati; prove PR sopra |
| SP-01 | Web PUT [/api/service-prescription-items/[id]/route.ts](../app/api/service-prescription-items/[id]/route.ts) | SP; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| SP-02 | Web DELETE [/api/service-prescription-items/[id]/route.ts](../app/api/service-prescription-items/[id]/route.ts) | SP; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| SP-03 | Web POST [/api/service-prescription-items/route.ts](../app/api/service-prescription-items/route.ts) | SP; JSON oggetto ≤ 4 MiB | Create: ID/parent del profilo; versione host | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| SP-04 | Web PUT [/api/service-prescriptions/[id]/route.ts](../app/api/service-prescriptions/[id]/route.ts) | SP; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| SP-05 | Web DELETE [/api/service-prescriptions/[id]/route.ts](../app/api/service-prescriptions/[id]/route.ts) | SP; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| SP-06 | Web POST [/api/service-prescriptions/route.ts](../app/api/service-prescriptions/route.ts) | SP; JSON oggetto ≤ 4 MiB | Create: ID/parent del profilo; versione host | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| S-01 | Web PUT [/api/siss-handoffs/[id]/route.ts](../app/api/siss-handoffs/[id]/route.ts) | S; 256 KiB + schema | ID path, patientId/versione osservati | CAS+bump in TX IMMEDIATE; **TX+audit** | Audit/CAS e caller migrati; replay stale409 |
| S-02 | Web DELETE [/api/siss-handoffs/[id]/route.ts](../app/api/siss-handoffs/[id]/route.ts) | S; 256 KiB + schema | ID path, patientId/versione osservati | CAS+delete in TX IMMEDIATE; **TX+audit** | Audit/CAS e conferma osservata migrati |
| S-03 | Web POST [/api/siss-handoffs/route.ts](../app/api/siss-handoffs/route.ts) | S; 256 KiB + schema | ID/parent attivo in TX; dup409; versione host1 | TX adapter IMMEDIATE; **TX+audit** | Audit migrato; versione restituita al caller |
| M-05 | Web GET/POST [/api/system/migrate-m2m/route.ts](../app/api/system/migrate-m2m/route.ts) | M; Web admin; POST strict JSON ≤ 64 KiB | Snapshot esatta paziente/versione/primario/versione target; GET rifiuta preview oltre limite | Confronto completo prima di relink+bump; **TX+audit** | Suite membership: stale, target, replay interposto, rollback, limiti/auth; ABA/C15 residui |
| M-01 | Web POST [/api/system/fix-orphans/route.ts](../app/api/system/fix-orphans/route.ts) | M; oggetto ≤ 64 KiB, body assente ammesso | selezione host; flag purge booleano opzionale | Default+relink+purge in TX immediata; **TX+audit** | Audit/input migrati; CAS/replay interposto residui C05-M |
| M-02 | Web POST [/api/system/purge-patient/route.ts](../app/api/system/purge-patient/route.ts) | M; JSON oggetto ≤ 64 KiB | patientId/versione osservati; GET coerente con deletedAt | CAS prima di cascade/revoca; **TX+audit** | Suite purge: stale/input senza effetti né revoca; CAS non copre snapshot figli, ABA/C15 residui |
| M-03 | Web POST [/api/system/restore-patient/route.ts](../app/api/system/restore-patient/route.ts) | M; 65.536 byte; solo patientId | patientId/tombstone; versione host nel restore | TX adapter immediata; **TX+audit** | Restore migrato |
| T-01 | Web PUT [/api/therapies/[id]/route.ts](../app/api/therapies/[id]/route.ts) | T; 4 MiB | ID path; parent e versione del profilo | therapy-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| T-02 | Web DELETE [/api/therapies/[id]/route.ts](../app/api/therapies/[id]/route.ts) | T; 4 MiB | ID path; parent e versione del profilo | therapy-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| T-03 | Web POST [/api/therapies/route.ts](../app/api/therapies/route.ts) | T; 4 MiB | Create: ID/parent del profilo; versione host | therapy-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| A-05 | paired PUT [/api/v1/network/ambulatories/[id]/route.ts](../app/api/v1/network/ambulatories/[id]/route.ts) | A; 4 MiB | ID path; parent e versione del profilo | ambulatory-write; **TX+audit** | Audit e body migrati; prove C05-A sopra |
| A-06 | paired DELETE [/api/v1/network/ambulatories/[id]/route.ts](../app/api/v1/network/ambulatories/[id]/route.ts) | A; 4 MiB | ID path; parent e versione del profilo | ambulatory-write; **TX+audit** | Audit e body migrati; prove C05-A sopra |
| A-07 | paired POST [/api/v1/network/ambulatories/clear/route.ts](../app/api/v1/network/ambulatories/clear/route.ts) | A; 4 MiB | ambulatoryId + versione; solo test container | ambulatory-write; **TX+audit** | Audit e body migrati; prove C05-A sopra |
| A-08 | paired POST [/api/v1/network/ambulatories/route.ts](../app/api/v1/network/ambulatories/route.ts) | A; 4 MiB | Create: ID/parent del profilo; versione host | ambulatory-write; **TX+audit** | Audit, body e campi create validati; prove C05-A sopra |
| D-05 | paired POST [/api/v1/network/patients/[id]/attachments/route.ts](../app/api/v1/network/patients/[id]/attachments/route.ts) | D; payload + 4 MiB; 30 s; 1 in-flight | ID/currentness del profilo; no patients.version | network-attachment-write TX; **TX+audit** | Audit paired migrato; allowlist e scope preservati |
| C-04 | paired PUT [/api/v1/network/patients/[id]/checkups/[checkupId]/route.ts](../app/api/v1/network/patients/[id]/checkups/[checkupId]/route.ts) | C; 4 MiB | ID path; parent e versione del profilo | checkup-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| C-05 | paired POST [/api/v1/network/patients/[id]/checkups/route.ts](../app/api/v1/network/patients/[id]/checkups/route.ts) | C; 4 MiB | Create: ID/parent del profilo; versione host | checkup-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| E-04 | paired PUT [/api/v1/network/patients/[id]/entries/[entryId]/route.ts](../app/api/v1/network/patients/[id]/entries/[entryId]/route.ts) | E; 4 MiB | ID path; parent e versione del profilo | entry-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| E-05 | paired POST [/api/v1/network/patients/[id]/entries/route.ts](../app/api/v1/network/patients/[id]/entries/route.ts) | E; 4 MiB | Create: ID/parent del profilo; versione host | entry-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| O-04 | paired PUT [/api/v1/network/patients/[id]/observations/[observationId]/route.ts](../app/api/v1/network/patients/[id]/observations/[observationId]/route.ts) | O; 4 MiB | ID path; parent e versione del profilo | observation-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| O-05 | paired POST [/api/v1/network/patients/[id]/observations/route.ts](../app/api/v1/network/patients/[id]/observations/route.ts) | O; 4 MiB | Create: ID/parent del profilo; versione host | observation-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| P-04 | paired POST [/api/v1/network/patients/[id]/restore/route.ts](../app/api/v1/network/patients/[id]/restore/route.ts) | P; 4 MiB | ID path, scope, tombstone e versione attesa/CAS | network-patient-lifecycle restore; **TX+audit** | Migrato; delta/prove per profilo |
| P-05 | paired PUT [/api/v1/network/patients/[id]/route.ts](../app/api/v1/network/patients/[id]/route.ts) | P; 4 MiB | ID path; parent e versione del profilo | patient-update-operation; **TX+audit** | Migrato; delta/prove per profilo |
| P-06 | paired DELETE [/api/v1/network/patients/[id]/route.ts](../app/api/v1/network/patients/[id]/route.ts) | P; 4 MiB | ID path; parent e versione del profilo | network-patient-lifecycle; **TX+audit** | Migrato; delta/prove per profilo |
| T-04 | paired PUT [/api/v1/network/patients/[id]/therapies/[therapyId]/route.ts](../app/api/v1/network/patients/[id]/therapies/[therapyId]/route.ts) | T; 4 MiB | ID path; parent e versione del profilo | therapy-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| T-05 | paired POST [/api/v1/network/patients/[id]/therapies/route.ts](../app/api/v1/network/patients/[id]/therapies/route.ts) | T; 4 MiB | Create: ID/parent del profilo; versione host | therapy-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| P-07 | paired POST [/api/v1/network/patients/route.ts](../app/api/v1/network/patients/route.ts) | P; 4 MiB | Create: ID/parent del profilo; versione host | network-patient-lifecycle; **TX+audit** | Migrato; delta/prove per profilo |
| PR-04 | paired PUT [/api/v1/network/prosthetic-prescriptions/[id]/route.ts](../app/api/v1/network/prosthetic-prescriptions/[id]/route.ts) | PR; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | prosthetic-prescription-write; **TX+audit** | Audit, body e ID create migrati; prove PR sopra |
| PR-05 | paired POST [/api/v1/network/prosthetic-prescriptions/route.ts](../app/api/v1/network/prosthetic-prescriptions/route.ts) | PR; JSON oggetto ≤ 4 MiB | Create: ID/parent del profilo; versione host | prosthetic-prescription-write; **TX+audit** | Audit, body e ID create migrati; prove PR sopra |
| SP-07 | paired PUT [/api/v1/network/service-prescription-items/[id]/route.ts](../app/api/v1/network/service-prescription-items/[id]/route.ts) | SP; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| SP-08 | paired POST [/api/v1/network/service-prescription-items/route.ts](../app/api/v1/network/service-prescription-items/route.ts) | SP; JSON oggetto ≤ 4 MiB | Create: ID/parent del profilo; versione host | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| SP-09 | paired PUT [/api/v1/network/service-prescriptions/[id]/route.ts](../app/api/v1/network/service-prescriptions/[id]/route.ts) | SP; JSON oggetto ≤ 4 MiB | ID path; parent e versione del profilo | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| SP-10 | paired POST [/api/v1/network/service-prescriptions/route.ts](../app/api/v1/network/service-prescriptions/route.ts) | SP; JSON oggetto ≤ 4 MiB | Create: ID/parent del profilo; versione host | service-prescription-write; **TX+audit** | Audit, body, ID create e ordinal migrati; prove SP sopra |
| C-06 | v1 PUT [/api/v1/patients/[id]/checkups/[checkupId]/route.ts](../app/api/v1/patients/[id]/checkups/[checkupId]/route.ts) | C; 4 MiB | ID path; parent e versione del profilo | checkup-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| C-07 | v1 DELETE [/api/v1/patients/[id]/checkups/[checkupId]/route.ts](../app/api/v1/patients/[id]/checkups/[checkupId]/route.ts) | C; 4 MiB | ID path; parent e versione del profilo | checkup-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| C-08 | v1 POST [/api/v1/patients/[id]/checkups/route.ts](../app/api/v1/patients/[id]/checkups/route.ts) | C; 4 MiB | Create: ID/parent del profilo; versione host | checkup-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| E-06 | v1 PUT [/api/v1/patients/[id]/entries/[entryId]/route.ts](../app/api/v1/patients/[id]/entries/[entryId]/route.ts) | E; 4 MiB | ID path; parent e versione del profilo | entry-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| E-07 | v1 DELETE [/api/v1/patients/[id]/entries/[entryId]/route.ts](../app/api/v1/patients/[id]/entries/[entryId]/route.ts) | E; 4 MiB | ID path; parent e versione del profilo | entry-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| E-08 | v1 POST [/api/v1/patients/[id]/entries/route.ts](../app/api/v1/patients/[id]/entries/route.ts) | E; 4 MiB | Create: ID/parent del profilo; versione host | entry-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| O-06 | v1 PUT [/api/v1/patients/[id]/observations/[observationId]/route.ts](../app/api/v1/patients/[id]/observations/[observationId]/route.ts) | O; 4 MiB | ID path; parent e versione del profilo | observation-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| O-07 | v1 DELETE [/api/v1/patients/[id]/observations/[observationId]/route.ts](../app/api/v1/patients/[id]/observations/[observationId]/route.ts) | O; 4 MiB | ID path; parent e versione del profilo | observation-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| O-08 | v1 POST [/api/v1/patients/[id]/observations/route.ts](../app/api/v1/patients/[id]/observations/route.ts) | O; 4 MiB | Create: ID/parent del profilo; versione host | observation-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| P-08 | v1 PUT [/api/v1/patients/[id]/route.ts](../app/api/v1/patients/[id]/route.ts) | P; 4 MiB | ID path; parent e versione del profilo | patient-update-operation; **TX+audit** | Migrato; delta/prove per profilo |
| P-09 | v1 DELETE [/api/v1/patients/[id]/route.ts](../app/api/v1/patients/[id]/route.ts) | P; 4 MiB | ID path; parent e versione del profilo | patient-delete-operation; **TX+audit** | Migrato; delta/prove per profilo |
| T-06 | v1 PUT [/api/v1/patients/[id]/therapies/[therapyId]/route.ts](../app/api/v1/patients/[id]/therapies/[therapyId]/route.ts) | T; 4 MiB | ID path; parent e versione del profilo | therapy-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| T-07 | v1 DELETE [/api/v1/patients/[id]/therapies/[therapyId]/route.ts](../app/api/v1/patients/[id]/therapies/[therapyId]/route.ts) | T; 4 MiB | ID path; parent e versione del profilo | therapy-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| T-08 | v1 POST [/api/v1/patients/[id]/therapies/route.ts](../app/api/v1/patients/[id]/therapies/route.ts) | T; 4 MiB | Create: ID/parent del profilo; versione host | therapy-write-operation; **TX+audit** | Migrato; delta/prove per profilo |
| P-10 | v1 POST [/api/v1/patients/route.ts](../app/api/v1/patients/route.ts) | P; 4 MiB | Create: ID/parent del profilo; versione host | TX adapter create v1; **TX+audit** | Migrato; delta/prove per profilo |

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

## Chiamanti composti, import e seeder

| Operazione / ingresso | Validazione, ID e confine | Transazione e audit raggiunti | Test / gap assegnato |
| --- | --- | --- | --- |
| Web `seedDatabase` in [seeder.ts](../lib/seeder.ts), UI [data-seeder](../components/data-seeder.tsx) | Opzioni/count e generazione sintetica; add pazienti, terapie, allegati, checkup, diario tramite [ApiTable.add](../lib/db.ts). | Ogni chiamata HTTP ha il confine della sua riga; nessuna transazione comune al seed. Audit ereditato dai writer aggiornati, compresi gli allegati. | [seeder-outcomes](../lib/seeder-outcomes.test.ts) prova il caller con HTTP sintetico: conteggi dei salvataggi confermati, pazienti completati ed errore parziale senza rollback o retry; la UI conserva il progresso e non espone stack. Le garanzie SQLite restano nelle suite dei writer raggiunti. |
| Web `nukeTestData(false)` | Filtra il prefisso TEST, elimina pazienti con versione, poi cleanup figli tramite facade; catch per tabella. | Scritture separate; ogni errore cleanup viene propagato dopo aver atteso tutte le operazioni già avviate. Le letture non autenticate falliscono; i conteggi includono solo DELETE confermate. Non equivale a purge atomico. | [seeder-outcomes](../lib/seeder-outcomes.test.ts) verifica successo, primo fallimento, errore figlio dopo tombstone e attesa dei cleanup avviati; precondizioni allegati preservate. |
| Web `nukeTestData(true)` | `clear` di diario, terapie, checkup, allegati, pazienti, conversazioni, messaggi. | [ApiTable.clear](../lib/db.ts) prova DELETE collection e, su 404/405, DELETE individuali; per allegati propaga patientId/currentness della lista osservata. Nessuna TX globale; errore esplicito sui risultati parziali. | [api-table-clear-outcomes](../lib/api-table-clear-outcomes.test.ts) verifica GET non autenticata e attesa dei DELETE avviati. Le precondizioni versione/currentness restano richieste; il reset totale non dichiara conteggi che le risposte bulk non confermano. Nessuna transazione comune dedotta dal successo dei singoli clear. |
| Web import anagrafico da documento | [patient-document-import-service](../lib/domain/documents/patient-document-import-service.ts), [patient-bulk-import](../lib/patient-bulk-import.ts): revisione e facade; create context vincola la creazione corrente. | Raggiunge create paziente e scritture successive; non assumere TX comune paziente/terapie dal wizard. | [patient-bulk-import.test](../lib/patient-bulk-import.test.ts), [patient-document-import-service.test](../lib/domain/documents/patient-document-import-service.test.ts); `test:patient-document-import`, E2E separato. C05-IMPORT: preservare mappa caller→route e risultati parziali. |
| Web Patient Insight, salvataggio risultato | [ai-summary-service](../lib/ai-summary-service.ts) aggiorna `aiSummary`, timestamp/hash e versione letta, tramite `db.patients.update`. | Raggiunge P-01: transazione e audit paziente; non crea una prescrizione. | C05-IMPORT/P: includere conflitto e contesto corrente; la prova del core non qualifica da sola il ciclo generazione→salvataggio. |
| Web Document Synthesis e archivio insights | La UI corrente usa Fabric proposal-only: la funzione legacy `synthesizeDocument` nel [service](../lib/domain/documents/document-synthesis-service.ts) non risulta chiamata dai percorsi esaminati. L’[archivio insight](../lib/domain/documents/document-insights-archive.ts) alimenta il PUT paziente con versione osservata. | P-01, versione paziente letta e audit del core. | [document-insights-archive.test](../lib/domain/documents/document-insights-archive.test.ts); C05-IMPORT/P: mantenere proposta e persistenza distinte, senza nuovi poteri di applicazione. |
| Web terapia con diagnosi aggiunta al paziente | [therapy-manager](../components/therapy-manager.tsx): create terapia seguito, se necessario, da update diagnosi con versione paziente. | T-03 e P-01 sono commit separati: nessuna TX comune dedotta dalla UI. | C05-IMPORT/T: distinguere terapia creata da aggiornamento diagnosi fallito. |
| Web edit paziente con checkup | [patient-edit-form](../components/patient-edit-form.tsx) → [patient-edit-session](../lib/patient-edit-session.ts), dipendenze update paziente e create/update/delete checkup. | Raggiunge P e C; non dichiarare atomicità dell'intera sequenza dal singolo core. | [patient-edit-session.test](../lib/patient-edit-session.test.ts); C05-IMPORT/P/C: conservare draft, versioni ed esiti parziali. |
| Web Smart Import apply client legacy | [patient-smart-import-service](../lib/domain/documents/patient-smart-import-service.ts) prepara selezione/ID, poi `db.applyPatientSmartImport` nella [facade](../lib/db.ts). | La destinazione è l'endpoint ritirato sotto: il codice client presente non dimostra una scrittura attiva riuscita. | C05-IMPORT: visibile come percorso non operativo, nessuna riattivazione implicita. |
| Web POST create-context | [route](../app/api/patients/create-context/route.ts): autorizza contesto/preview; nessun paziente inserito qui. | Il commit resta nel POST paziente P; non contare il grant come scrittura clinica. | [patient-create-service.test](../lib/patient-create-service.test.ts); C05-P. |
| Smart Import legacy POST patient | [route ritirata](../app/api/patients/[id]/smart-import/route.ts): fail-closed, nessuna mutazione clinica ammessa. | Non è un writer da migrare riattivandolo. | [test retired](../lib/legacy-smart-import-apply-retired-route.test.ts); capability proposal-only separate. |
| Allegato local-extraction POST / DELETE | [route](../app/api/attachments/[id]/local-extraction/route.ts): grant, selettore/currentness, proiezione e cancellazione; risultato di estrazione non equivale ad applicazione clinica. | Non sostituisce PUT metadata/content D. Le transizioni indirette dei servizi documentali devono restare nel guard currentness. | [attachment-local-extraction-route.test](../lib/attachment-local-extraction-route.test.ts); C05-D deve seguire i caller dei writer, senza attribuire commit al solo metodo POST. |
| Allegato ocr-replay legacy | [route](../app/api/attachments/[id]/ocr-replay/route.ts): ritirata, non nuovo ingresso di commit. | Nessuna riattivazione implicita. | [test retired](../lib/attachment-ocr-replay-retired-route.test.ts). |

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

## Ordine delle coorti e criterio di aggiornamento

1. **C05-S:** audit e CAS osservato dei writer Web migrati, con binding paziente e bozza stabile. Restore e ricreazione della stessa identità/versione restano distinti; il lancio SISS non equivale al diario persistito.
2. **C05-B:** assign/unassign migrati per audit atomico, input e CAS; repair/clear
   invalidano le versioni precedenti. Restore/ricreazione identità restano distinti. Move migrato con il CAS esistente;
   duplicate usa CAS degli originali e token consumato atomicamente; la garanzia non copre export/restore su nuovo DB (C15).
3. **C05-D:** create/delete e metadata/content Web, upload paired migrati per audit atomico.
   Metadata/delete e i caller indiretti esaminati conservano la precondizione osservata; restore resta C15.
   Conservare sourceRef/revision/freshness e le restrizioni document-derived.
4. **C05-M:** purge ha CAS della riga paziente; per fix-orphans restano versione
   client e replay dopo operazioni interposte. Lo snapshot dei figli purge, ABA e C15 restano distinti. Restore già migrato rimane
   una riga di regressione, non la prova dei rami diversi.
5. **C05-SEED/IMPORT/ID:** raccordare gli ingressi composti alle righe aggiornate;
   dare esiti espliciti alle sequenze parziali. Le coorti migrate P/E/T/O/C/PR/SP/A
   conservano test e contratti, senza chiusura globale dedotta dal solo audit.

Per ogni riga modificata, collegare prova di input invalido senza scritture,
parent/scope/versione, rollback su errore audit e successo dopo commit secondo il
contratto della famiglia. Registrare quale runner seleziona il test e quale SHA
è stata eseguita, nelle evidenze della consegna; non copiare log o dati nel roster.
La lettura mirata dei caller documentali descritti sopra è completata; resta la copertura
assertiva degli altri flussi composti. La tabella rende questi lavori assegnabili e non
pretende che il censimento statico dimostri l'assenza di ogni writer indiretto.
