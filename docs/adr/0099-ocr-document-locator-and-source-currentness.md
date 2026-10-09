# ADR 0099: locator OCR e currentness della sorgente documentale

Date: 2026-08-23
Status: Accepted

Issue: WUL-522
Program line: candidato `0.8.5`

Related: [ADR 0088](./0088-deterministic-pdf-page-router.md),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md) e
[ADR 0098](./0098-physician-terminal-review-authority.md).

## Problema

L'OCR richiede una sorgente documentale corrente, ma gli identificatori e le
versioni gia disponibili descrivono altri confini. Un attachment puo cambiare,
essere eliminato, ripristinato o ricreato mentre una selezione OCR e in corso.
Un controllo separato dalla risoluzione del documento aprirebbe una race fra
validazione e consumo.

Serve un contratto che permetta a O1 di introdurre metadati documentali senza
trasformare ID di dominio, hash, versioni di review o dati del chiamante in
autorita di currentness.

## Decisione

### Identita e currentness dell'incarnazione

Ogni incarnazione di attachment possiede tre valori host-generated:

- `documentSourceRef`: riferimento opaco, immutabile e unico per
  l'incarnazione;
- `documentRevision`: intero sicuro, maggiore o uguale a `1`, monotono;
- `documentFreshnessEpoch`: intero sicuro, maggiore o uguale a `1`, monotono.

Ogni mutazione attachment accettata incrementa atomicamente e in modo
conservativo `documentRevision` e `documentFreshnessEpoch`, anche quando il
contenuto o il significato risultano uguali. Delete e recreate producono una
nuova `documentSourceRef`; non riusano quella eliminata.

`documentRevision` e `documentFreshnessEpoch` sono safe integer. Se una
mutazione accettata deve incrementare uno dei due valori al massimo del tipo,
fallisce atomicamente prima di ogni mutazione. Non deve mai eseguire wrap,
reset, saturazione o aggiornamento parziale.

Una migrazione raw che riproduce dati gia canonici deve essere idempotente.
Alla riesecuzione conserva ogni `documentSourceRef`, `documentRevision` e
`documentFreshnessEpoch` canonico esistente. Non rigenera l'identita e non
incrementa i valori per effetto del replay. Se non puo conservare tutti e tre i
valori per ogni record interessato, fallisce atomicamente prima di qualunque
mutazione. Il replay non puo lasciare uno stato parzialmente migrato.

`createdAt`, `ocrQueueUpdatedAt`, `patients.version`, la versione della
proposta, `reviewRevision`, `sourceRevision` del browser e
`documentSha256` fornito dal chiamante non sono currentness canonica. Possono
essere dati di osservazione o di verifica in altri contratti, ma non validano
un locator OCR.

### Locator volatile, emissione e consumo atomico

Il broker emette un locator OCR monouso, in memoria e legato al lease corrente.
Il locator non contiene attachment ID, patient ID, contenuto, hash, provider,
venue, egress, authority, prompt o apply. Non puo diventare un handle per
selezionare provider o per autorizzare esecuzione.

L'emissione e il consumo sono operazioni distinte nel tempo. Entrambe usano lo
stesso owner e il primitivo P4 sincrono, ma non avvengono nella stessa
invocazione. Durante il consumo, una sola sezione critica P4 risolve la sorgente
host-owned, verifica lease, selezione e currentness, poi brucia il locator
monouso prima di restituire il risultato. E vietato aprire una seconda sezione
di lease fra resolve e consume. Dopo il riavvio, lo stato in memoria non esiste
e ogni locator precedente viene negato.

Il cambio di sessione, review o selezione, l'eliminazione, purge, restore,
logout, expiry e riavvio revocano o distruggono tutti i locator interessati.
Una revoca non ammette fallback, riemissione implicita o continuazione con un
locator precedente.

### Backup, restore e confini Fabric

Il restore 0.8.5 richiede, per ogni attachment, gli esatti tre campi
`documentSourceRef`, `documentRevision` e `documentFreshnessEpoch`. Un
artefatto legacy di backup o restore che ne omette anche uno viene negato prima
della mutazione con un errore tipizzato e sanitizzato
`BACKUP_DOCUMENT_CURRENTNESS_UNSUPPORTED`. L'errore non include contenuto,
identificatori clinici o metadati dell'artefatto.

Il restore 0.8.5 non ribasa, non genera e non deduce i tre valori mancanti. Una
futura migrazione, autorizzata separatamente, puo produrre un artefatto di
rebase revisionato. Il suo contratto, la sua evidenza e la sua applicazione non
appartengono a questo restore. Fino a quel momento la continuita legacy resta
negata, non `HOLD` operativo.

La decisione del resolver Fabric e l'invocazione del provider restano confini
separati. Il locator non sostituisce la decisione Fabric, non sceglie provider,
venue o fallback e non abilita fallback silenziosi. `applyPolicy=none` resta
invariato.

## DAG e ownership

```text
O1a schema e vincoli dei tre campi
  -> O1b migrazione raw idempotente e atomica
     -> O1c fixture e verifica schema
        -> O2a writer attachment host-owned
        -> O2b read guard e serializzazione
        -> O2c CAS update e incremento atomico revision+epoch
        -> O2d delete/recreate con nuova sourceRef
        -> O2e verifiche writer e read guard
           -> O3a deny backup/restore legacy tipizzato
           -> O3b cascade e revoca
           -> O4 bridge P4 e locator: emissione e consumo distinti
              -> O5 replay, route e client
```

O3a e O3b possono procedere in parallelo solo dopo O2e. O1a, O1b e O1c sono
sub-packet distinti dello schema; O2a-O2e sono sub-packet distinti dei writer e
read guard. Ogni owner modifica un solo confine. Ogni packet resta sotto circa
300 LOC. Un conflitto fra owner, una semantica non definita o una base non
integrata interrompe il packet: nessun owner assorbe il confine altrui.

## Evidenza e stato

Questo ADR accetta il contratto documentale. Non prova schema, migrazione,
writer, backup, restore, revoca, bridge, route, client, provider o runtime.
Il runtime resta non implementato. L'integrazione richiede i gate del DAG e le
verifiche specifiche di ciascun packet. Una release richiede evidenza di
integrazione e i suoi gate separati; questa decisione non dichiara release,
conformita o promozione.

## Falsificatori e stop condition

Fermare il lavoro e mantenere il denial se:

- un ID attachment o patient, un hash, una versione di review o un dato del
  chiamante diventa currentness canonica;
- una mutazione accettata non incrementa insieme revision ed epoch;
- una mutazione al massimo del safe integer esegue wrap, reset, saturazione o
  un aggiornamento parziale, invece di fallire atomicamente;
- delete/recreate riusa `documentSourceRef`;
- una migrazione raw rigenera i valori canonici, incrementa revision o epoch
  durante un replay, oppure fallisce dopo una mutazione parziale;
- un locator contiene dati vietati, persiste, sopravvive a restart o e riusato;
- resolve e consume avvengono in sezioni di lease diverse;
- un backup o restore senza tutti e tre i campi viene accettato, ribasato o
  modificato senza un errore tipizzato e sanitizzato;
- il locator permette di scegliere provider, venue o fallback, oppure sostituisce
  la decisione del resolver Fabric;
- compare apply o cambia `applyPolicy=none`.

## Non-obiettivi

Questo ADR non aggiunge schema, migrazioni, runtime, route, UI, client,
provider, esecuzione OCR, backup, restore, egress, dati clinici, apply,
promozione o release. Le verifiche future usano soltanto fixture sintetiche.


## Addendum WUL-720 C05-D — precondizioni delle scritture Web

GET `/api/attachments`, anche con `metadata=true`, e GET
`/api/attachments/[id]` espongono `currentness: { sourceRef, revision,
freshnessEpoch }` dalla stessa query del record restituito. Il dettaglio include
il payload; la lista metadata continua a ometterlo. GET
`/api/attachments/[id]/content` conserva `{ currentness }`, senza patientId.
I nomi interni `documentSourceRef`, `documentRevision` e
`documentFreshnessEpoch` non vengono aggiunti alla risposta Web.

PUT metadata `/api/attachments/[id]` richiede `patientId`, `expected` con
esattamente i tre campi della tuple osservata e almeno un campo mutabile fra
`summarySnapshot`, `parseEvidenceArtifactSnapshot`, `ocrQueueState`. DELETE
richiede `patientId` e la stessa `expected`. Il JSON di entrambi è limitato a
4 MiB. SourceRef deve essere 64 caratteri esadecimali minuscoli; revision e
freshnessEpoch sono interi sicuri positivi. Lo stripping dei campi root ignoti
rimane invariato; la tuple rifiuta campi aggiuntivi. I client precedenti privi
delle precondizioni ricevono 400 e devono essere aggiornati insieme alla route.

La transazione esterna IMMEDIATE rilegge parent e tuple prima del core o del
DELETE, poi contiene anche l'audit richiesto. Parent diverso o allegato assente
restituiscono 404; tuple superata restituisce 409; input non valido 400, JSON
oltre soglia 413. Gli errori conservano `{ error: string }`. Non viene aggiunta
una condizione di paziente attivo al metadata/delete: il cleanup successivo al
tombstone del paziente mantiene la propria semantica. Il core currentness e le
transizioni OCR restano invariati. Omissione conserva summary/evidence,
`null` o stringa vuota li cancellano. Metadata risponde `{ success: true,
currentness }`; DELETE conserva `{ success: true }`.

Il replay metadata con la vecchia tuple riceve 409 senza incremento o audit.
DELETE ripetuto riceve 404; dopo ricreazione dello stesso ID la sourceRef nuova
fa rifiutare il vecchio comando con 409. Non viene introdotta una ricevuta
idempotente di successo. I rifiuti e il fallimento dell'audit non lasciano
mutazioni parziali nella singola operazione.

La facade richiede una precondizione esplicita legata all'ID; non rilegge
currentness dentro update/delete e non ritenta automaticamente un conflitto.
La UI cattura il record prima della conferma; il recupero richiede rilettura
dell'elenco e nuova azione. Clear usa il record della lista del proprio
fallback, bulkDelete richiede record osservati espliciti. Il seeder propaga il
record osservato e segnala un cleanup attachment fallito: le precedenti
eliminazioni possono già essere state confermate e non vengono annullate.

`no contract impact` per `/api/v1`: proiezioni paired, upload paired e client
nativi restano invariati e non ricevono la tuple Web. Non viene aggiunto alcun
writer metadata/delete v1 o paired. Il restore C15 resta fuori dal delta.

Prove: `lib/attachment-metadata-currentness.test.ts`,
`lib/attachment-web-create-currentness.test.ts`,
`lib/attachment-web-put-currentness.test.ts`,
`lib/attachment-client-preconditions.test.ts`; runner `scripts/run-strip-types.mjs
--test` con MEDIFLOW_DATA_DIR sintetica esplicita. I risultati eseguiti restano
associati alla revisione nella consegna, non dedotti dalla presenza dei test.
