# ADR 0099: locator OCR e currentness della sorgente documentale

Date: 2026-08-23
Status: Accepted

Issue: WUL-522
Program line: candidato `0.8.5`
Baseline: `de6faac0326a41c165d0912ffadf206e1cfc3892`

Related: [ADR 0088](./0088-deterministic-pdf-page-router.md),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md),
[ADR 0089](./0089-contratto-intelligence-fabric-e-venue-esecutive.md) e
[ADR 0098](./0098-physician-terminal-review-authority.md).

## Problema

L'OCR richiede una sorgente documentale corrente, ma gli identificatori e le
versioni gia disponibili descrivono altri confini. Un attachment puo cambiare,
essere eliminato, ripristinato o ricreato mentre una selezione OCR e in corso.
Un controllo separato dalla risoluzione del documento aprirebbe una race fra
validazione e consumo.

Serve un contratto che permetta a O1 di introdurre metadati documentali senza
trasformare ID di dominio, hash, versioni di review o dati del chiamante in
autorita di currentness. Prima del locator runtime O4, serve anche fissare chi
puo consumare una sorgente, con quale selezione e quale evidenza puo attraversare
un confine asincrono.

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

### O4: locator opaco, monouso e host-owned

O4 e un bridge host-owned. Il suo locator e opaco, volatile e monouso. Non e
un riferimento documento riutilizzabile, una capability Fabric, una receipt o
un grant. Il chiamante puo richiedere l'operazione, ma non puo creare,
modificare, rinnovare, decifrare o consumare il locator come autorita.

L'host emette il locator solo dopo avere risolto una selezione corrente. Il
locator lega, senza esporli, almeno sessione, lease, selezione e
`selectionEpoch`, `documentSourceRef`, `documentRevision`,
`documentFreshnessEpoch`, scadenza e generazione di revoca. L'host conserva
questi binding solo in memoria.

L'host rivalida tutti i binding prima di ogni lavoro asincrono e dopo ogni suo
completamento. Se sessione, selezione, currentness, revisione, freshness o
revoca non corrispondono, l'host brucia il locator e nega. Il completamento
tardivo viene scartato. Il confronto include l'incarnazione
`documentSourceRef`: delete/recreate non puo superare il controllo con valori
numericamente uguali. Questo blocca anche la sostituzione ABA della sorgente.

Un riavvio elimina locator, binding e stato di consumo. Un locator precedente
fallisce chiuso. Nessun percorso ricostruisce il locator da ID, hash, timestamp,
versione, cache, receipt o input del chiamante.

### Sorgenti cifrate e authority di decifratura

Una sorgente attachment con prefisso `ENC:` e un denial O4, salvo una decrypt
authority host-owned. La decrypt authority deve appartenere alla stessa
sessione, selezione, lease, currentness e generazione di revoca del locator.
La sola presenza di `ENC:` non prova questa authority.

Nessun chiamante decifra il payload per O4. O4 non persiste, restituisce o
registra nei log payload grezzi, plaintext, chiavi, prompt o output provider.
L'evidenza host e PHI-safe e contiene soltanto gli esiti e i binding opachi
necessari al passo successivo.

### Selezione, evidenza e binding provider

L'ordine O4 e stretto e depth-first:

```text
O4 locator
  -> selezione host corrente
  -> evidenza host PHI-safe
  -> coordinator provider-neutral
  -> provider binding esplicito
  -> O5 route
```

Il coordinator riceve solo l'evidenza host valida. Risolve il provider secondo
ADR 0089 e non puo dedurre un binding dal nome del registry, dal modello, dalla
venue o da un risultato precedente. Un denial O4 non raggiunge il coordinator.

`applyPolicy=none` resta invariato. O4 esegue zero scritture: non applica
output OCR, non modifica review, non persiste payload e non abilita route O5.

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

O4 precede O5. O5 non crea un locator, non riesegue la selezione, non riusa
l'evidenza e non aggiunge fallback. Provider binding e route restano due
confini successivi al coordinator.

## Evidenza e stato

La decisione O4 e accettata per il candidato `0.8.5`, ma questo packet e solo
documentale. Non prova schema, writer, backup, revoca, bridge, route, client,
provider o runtime.

| Stato | Cosa prova questo ADR |
| --- | --- |
| Contratto candidato | La decisione O4 e `Accepted`; il DAG e i denial sono canonici. |
| Integrato | Non dichiarato. Richiede O1-O5 e le verifiche di integrazione specifiche. |
| Release-ready | Non dichiarato. Richiede i gate di release separati. |
| Released | Non dichiarato. Richiede evidenza della pubblicazione effettiva. |

Questa decisione non dichiara conformita normativa, promozione o release.

## Falsificatori e stop condition

Fermare il lavoro e mantenere il denial se:

- un ID attachment o patient, un hash, una versione di review o un dato del
  chiamante diventa currentness canonica;
- una mutazione accettata non incrementa insieme revision ed epoch;
- delete/recreate riusa `documentSourceRef`;
- un locator contiene dati vietati, persiste, sopravvive a restart o e riusato;
- resolve e consume avvengono in sezioni di lease diverse;
- il locator non e rivalidato prima e dopo un confine asincrono;
- selection, sessione, revision, freshness, revoca o incarnazione sorgente
  possono cambiare senza denial, incluso un caso ABA;
- una sorgente `ENC:` e decifrata senza decrypt authority host-owned con gli
  stessi binding del locator;
- un chiamante decifra, oppure O4 persiste o registra payload grezzo,
  plaintext, chiavi, prompt o output provider;
- backup legacy riusa silenziosamente una sorgente stantia;
- il locator permette di scegliere provider, venue o fallback, oppure sostituisce
  la decisione del resolver Fabric;
- O4 raggiunge O5 senza selezione, evidenza host e coordinator provider-neutral;
- compare una scrittura, apply o cambia `applyPolicy=none`.

## Non-obiettivi

Questo ADR non aggiunge schema, migrazioni, runtime, route, UI, client,
provider, esecuzione OCR, backup, restore, egress, dati clinici, apply,
promozione o release. Le verifiche future usano soltanto fixture sintetiche.
