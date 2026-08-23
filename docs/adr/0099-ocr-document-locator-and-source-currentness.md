# ADR 0099: locator OCR e currentness della sorgente documentale

Date: 2026-08-23
Status: Proposed

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

### Backup e confini Fabric

Il supporto legacy dei backup resta fail-closed. Un backup privo di metadati
compatibili non puo riusare silenziosamente una sorgente stantia. O3a deve
scegliere e verificare una policy esplicita di deny oppure rebase; fino ad allora
la continuita resta `HOLD`.

La decisione del resolver Fabric e l'invocazione del provider restano confini
separati. Il locator non sostituisce la decisione Fabric, non sceglie provider,
venue o fallback e non abilita fallback silenziosi. `applyPolicy=none` resta
invariato.

## DAG e ownership

```text
O1 schema
  -> O2 writer e read guard
     -> O3a backup/restore
     -> O3b cascade/revocation
     -> O4 bridge P4 e locator: emissione e consumo distinti
        -> O5 replay, route e client
```

O3a e O3b possono procedere in parallelo solo dopo O2. Ogni owner modifica un
solo confine: O1 schema, O2 writer/read guard, O3a backup/restore, O3b
cascade/revocation, O4 bridge/locator, O5 replay/route/client. Ogni packet
resta sotto circa 300 LOC. Un conflitto fra owner, una semantica non definita o
una base non integrata interrompe il packet: nessun owner assorbe il confine
altrui.

## Evidenza e stato

Questo ADR e una candidata documentale. Non prova schema, writer, backup,
revoca, bridge, route, client, provider o runtime. L'integrazione richiede i
gate del DAG e le verifiche specifiche di ciascun packet. Una release richiede
evidenza di integrazione e i suoi gate separati; questa decisione non dichiara
release, conformita o promozione.

## Falsificatori e stop condition

Fermare il lavoro e mantenere il denial se:

- un ID attachment o patient, un hash, una versione di review o un dato del
  chiamante diventa currentness canonica;
- una mutazione accettata non incrementa insieme revision ed epoch;
- delete/recreate riusa `documentSourceRef`;
- un locator contiene dati vietati, persiste, sopravvive a restart o e riusato;
- resolve e consume avvengono in sezioni di lease diverse;
- backup legacy riusa silenziosamente una sorgente stantia;
- il locator permette di scegliere provider, venue o fallback, oppure sostituisce
  la decisione del resolver Fabric;
- compare apply o cambia `applyPolicy=none`.

## Non-obiettivi

Questo ADR non aggiunge schema, migrazioni, runtime, route, UI, client,
provider, esecuzione OCR, backup, restore, egress, dati clinici, apply,
promozione o release. Le verifiche future usano soltanto fixture sintetiche.
