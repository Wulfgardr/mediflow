# ADR 0102: autorita della sorgente per Document Synthesis

Date: 2026-08-25
Status: Accepted

Issue: WUL-522
Program line: candidato `0.8.5`

Related: [ADR 0089](./0089-contratto-intelligence-fabric-e-venue-esecutive.md),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md), ADR 0099,
ADR 0100, ADR 0101 e WUL-282.

## Problema

Document Synthesis deve ricevere un insieme di fonti determinato dall'host,
non dal chiamante o dal provider. Il provider puo dichiarare supporto testuale,
ma non puo dichiarare identita, correntezza, provenienza o correttezza clinica.
Serve quindi un contratto stretto prima di introdurre runtime.

## Decisione

### Autorita e handle della sorgente

L'application host autenticato e l'unico issuer di:

- handle monouso del source set;
- capability dell'operazione;
- etichette `S1`...`Sn`;
- receipt finale e provenance finale.

Fuori dalle frontiere di acquisizione definite sotto, il chiamante non puo
fornire riferimenti a paziente, documento o sorgente, ID, digest, provider,
citazioni, receipt o provenance. Questi valori non possono entrare da body,
path, query, cookie, UI, cache, projection o AIP/Mini come authority.

Il source-set handle e opaco, memory-only e legato a sessione autenticata,
selezione paziente canonica, `selectionEpoch`, `reviewContextEpoch`, identita e
scadenza del lease, `documentSourceRef`, `documentRevision`,
`documentFreshnessEpoch`, `sourceSetEpoch` e `revocationGeneration`.

Il lifecycle e `minted -> burned at begin -> in_flight -> published | denied`.
Il burn avviene all'inizio della sezione autenticata, dopo la validazione della
forma esterna inerte e il lookup autenticato nello stesso owner, e impedisce un
secondo consumo. Un timestamp non prova la correntezza; la correntezza dipende
dai binding ed epoch riletti dall'host.

### Lineage indipendente del source set

Il lineage del source set di Document Synthesis e indipendente, `memory-only` e
scoped esclusivamente all'`ServerSessionProjectionOwner` autenticato. Non e
`session-global`, `static`, `globalThis` o persistente.

La prima allocazione usa `sourceSetEpoch=1`. Ogni tentativo autenticato di
capture/ingest che raggiunge l'allocazione del lineage consuma un nuovo valore
monotono `u64`. Un tentativo negato dopo l'allocazione puo lasciare un gap.
Nell'owner live `sourceSetEpoch` non puo fare wrap, reset o riuso. Il valore
iniziale e `revocationGeneration=0` per ogni lineage live di cattura/source set
DS; `revocationGeneration` incrementa esattamente una volta per ogni distinta
transizione di revoca osservata dall'owner: una revoca esplicita di una cattura
`pending` oppure un'invalidazione di selezione, review o currentness documentale
osservata mentre l'owner resta live. La stessa revoca `latched` osservata di
nuovo non incrementa il valore. L'owner deve fare uno snapshot atomico dei due
valori e rileggerli alla fence finale. Non si dichiara alcun callback immediato:
conta solo la transizione rilevata dall'owner.

`sourceSetEpoch` e `revocationGeneration` non derivano da timestamp, digest, ID
allegato, `documentRevision`, `documentFreshnessEpoch`, `selectionEpoch` o
`reviewContextEpoch`. Questi restano binding distinti.

L'overflow di `sourceSetEpoch` o `revocationGeneration` nega in modo terminale
ed e `fail-closed`. Logout, expiry della sessione, reset, disposal e restart
distruggono l'owner in memoria e ogni authority: gli handle e le capsule
precedenti diventano invalidi senza richiedere un incremento osservabile.
L'host puo ricreare un lineage nuovo e `memory-only` perche l'autorita
precedente e morta.

### Ordine I1c di acquisizione

Alla frontiera pubblica, prima dell'autenticazione, non si osservano campi della
projection. In I1c l'ordine e vincolante:

1. validare solo la forma esterna inerte sufficiente a evitare l'osservazione
   dell'attaccante;
2. autenticare e acquisire l'owner, quindi risolvere il capture handle nello
   stesso owner;
3. consumare e bruciare immediatamente l'handle;
4. solo dopo validare e normalizzare in modo puro la projection tipizzata
   esatta;
5. entrare o proseguire nella fence P4 ed eseguire una sola lettura di
   currentness vincolata al paziente e all'ambulatorio selezionati, confrontando
   `documentSourceRef`, `documentRevision` e `documentFreshnessEpoch` memorizzati;
6. allocare e acquisire uno snapshot atomico di `sourceSetEpoch` e
   `revocationGeneration`, quindi catturare il source set;
7. dopo l'unica chiamata asincrona al provider, rileggere il lineage e superare
   la fence finale P4 su selezione, review e sessione prima di pubblicare il
   `private terminal ticket`.

Ogni errore dopo il burn lascia l'handle speso. Non si copia la regola OCR
`resolve-before-burn`: quella semantica non si trasferisce a Document Synthesis.
Il claim di questo ordine e limitato alla sezione host sincrona nello stesso
processo (`sync`, senza `await`); la currentness multiprocesso resta fuori da
questo packet.

Questo addendum non introduce, autorizza o dimostra provider, route,
persistenza, apply, scritture cliniche o runtime.

### Intent di selezione, ingest e preview

L'identificatore di allegato o documento fornito dal client e soltanto un
intent di selezione non autorevole alla frontiera di acquisizione autenticata.
L'host deve risolverlo sotto la sessione corrente, il paziente canonico
selezionato e una currentness monotona dell'allegato. L'intent non diventa mai
`documentSourceRef`, digest, receipt o provenance e non dimostra contenuto,
provenienza o correttezza clinica.

Solo dopo una risoluzione riuscita, un ingest broker autenticato e separato
puo accettare una volta la projection client-decrypted minimizzata e tipizzata:

```text
{ sourceKind, sourceText }
```

Il broker ne copia il valore in memoria e lo lega a un capture handle opaco,
broker-owned e non trasferibile. L'handle trattiene soltanto binding host-owned:
riferimento opaco, revisione, freshness, epoch, scopo, scadenza e revoca.
Non espone owner, sessione o testo. Logout, revoca, scadenza, reselection,
revisione o freshness incompatibile invalidano la cattura e il preview.

La route di preview capability-specific accetta soltanto il capture handle
opaco e, se necessario, una correlazione di richiesta. Non accetta testo,
identificatore di allegato, ID paziente, revisione, freshness, provider o
prompt. Cattura e preview sono due frontiere di authority distinte anche quando
una composizione locale le richiama in sequenza.

`sourceSetAuthority=application_host` dichiara soltanto che l'host possiede il
set catturato e ha validato lo scope del digest dell'input provider. Non
dichiara plaintext, digest o provenienza dell'allegato originale, ne verita
clinica.

### Cattura, ordine e limiti del source set

La frontiera di sorgente e indipendente dal rendering del prompt. Prima del
renderer, l'host cattura fonti esatte e uniche, le ordina con confronto
lessicografico dei byte UTF-8 normalizzati e unsigned di `documentSourceRef`,
poi per `documentRevision` `u64BE` e `documentFreshnessEpoch` `u64BE`. Non usa
ordine locale, codepoint o case-insensitive. I duplicati negano.

Il source set contiene da 1 a 32 fonti. Dopo l'ordinamento l'host assegna, senza
salti, le sole etichette globalmente uniche `S1`...`Sn`. Il renderer non puo
aggiungere, rimuovere, riordinare o troncare fonti o etichette.

`mediflow.document-synthesis.host-projection.v1` conserva il limite esistente:
una fonte deve avere al massimo 12.000 unita UTF-16 prima e dopo la
normalizzazione. Per compatibilita, il limite v1 della projection normalizzata
e 36.000 byte UTF-8 per fonte e 1.152.000 byte UTF-8 per l'insieme. Una fonte o
un insieme oltre il limite nega prima della chiamata provider; non esiste
troncamento silenzioso.

### Normalizzazione, etichette e citazioni

La normalizzazione v1 e congelata: rifiuta testo che non sia Unicode valido,
inclusi surrogate isolati, e i controlli `U+0000`...`U+0008`, `U+000B`,
`U+000C`, `U+000E`...`U+001F` e `U+007F`. Sostituisce `CRLF` e `CR` con `LF`,
applica NFC e infine l'esistente `String.prototype.trim()`. Il trim fa parte
della normalizzazione e non e un passaggio di rendering.

Il provider riceve soltanto testo normalizzato taggato e le relative etichette.
Non riceve riferimenti canonici, digest, provider binding, receipt, provenance
o plaintext dell'allegato originale. Non puo coniare etichette.

Ogni claim canonico deve restituire una citazione testuale esatta e un sottoinsieme
non vuoto, univoco, senza ripetizioni e ordinato numericamente, delle etichette
host `S1`...`Sn`. Etichette ripetute, duplicate, sconosciute o gapped negano;
il set globale deve restare contiguo e ogni etichetta dichiarata deve esistere.

Per ogni coppia etichetta-citazione, l'host confronta la citazione con gli
esatti byte UTF-8 normalizzati della sola projection nominata dall'etichetta.
La citazione deve comparire una sola volta in quella sorgente. L'offset e un
intervallo zero-based half-open di byte UTF-8 nella stessa projection;
`quoteSha256` usa gli esatti byte dell'occorrenza. L'host rifiuta citazioni
assenti, ambigue, sconosciute, duplicate o non citate.

Questo contratto ha il seguente ceiling: supporto dichiarato dal provider con
membership e locator validati dall'host. Non dimostra entailment, correttezza
clinica o causalita del modello.

### Digest e provenienza

I digest seguenti restano distinti:

| Valore | Significato |
| --- | --- |
| `projectionDigestSha256` | Digest della projection normalizzata consegnata al provider. |
| `sourceSetDigestSha256` | Digest dell'insieme ordinato catturato dall'host. |
| digest metadata esistente non verificato | Metadato disponibile, non prova la sorgente o il contenuto. |
| digest plaintext allegato originale | Non disponibile; questa ADR non ne inventa una prova. |

La provenance dichiara soltanto: set di projection catturato e posseduto
dall'host; scope esatto del digest dell'input provider; semantica di citazione
dichiarata dal modello; causalita del modello non stabilita.

`sourceSetDigestSha256` usa il codec binario domain-separated
`mediflow.document-synthesis.source-set-digest.v1`, non JSON o ordine di
oggetto. Il payload e l'esatta concatenazione:

```text
u32BE(byteLength(domainTag)) || utf8(domainTag) || u16BE(1) || u8(sourceCount)
|| u64BE(sourceSetEpoch) || u64BE(revocationGeneration)
|| per ogni sorgente ordinata:
   u32BE(byteLength(label)) || utf8(label)
   || u32BE(byteLength(documentSourceRef)) || utf8(documentSourceRef)
   || u64BE(documentRevision) || u64BE(documentFreshnessEpoch)
   || raw32(projectionDigestSha256)
```

`domainTag` e la stringa esatta del nome codec. Ogni prefisso UTF-8 e `u32`
unsigned big-endian del numero di byte, seguito immediatamente da esattamente
quei byte UTF-8, senza terminatore o padding. `sourceCount`, epoch e revisioni
usano gli stessi interi unsigned big-endian indicati nel payload. Il digest e
SHA-256 dei soli byte concatenati sopra.

Prima dell'hash l'host rifiuta overflow dei prefissi, UTF-8 o Unicode invalidi,
valori vuoti quando tag, etichetta o `documentSourceRef` devono essere non
vuoti, e byte oltre i limiti di campo, sorgente o aggregato gia definiti. I
digest restano 32 byte raw, non hex. Nessun campo puo dipendere dall'ordine JSON.
Questo codec resta invariato: questa ADR non introduce JCS, un master digest o
un digest del plaintext originale.

### Evidence di provider-binding

La `provider-binding receipt` e l'esatta receipt emessa dall'host, con schema
`mediflow.document-synthesis.provider-binding.v1`, per il binding autenticato
di Document Synthesis. E distinta dalla `ProviderSelectionReceipt`
del registry, che e gia nidificata nella Fabric resolution receipt. Una receipt
finale puo legare entrambe come evidence distinte. Nessuna delle due concede
authority o puo sostituire l'altra.

### Schema di pubblicazione e codec delle citazioni

`U0` indica l'esatto ramo `available` congelato emesso da
`DocumentSynthesisSourceSetValidationResult` dopo la validazione host
source-bound. I suoi campi hanno questo ordine di enumerazione:
`status`, `code`, `schemaVersion`, `output`, `outputSha256`, `citations`,
`claims`, `reviewOnly`, `writesPerformed`, `applyPolicy`,
`sourceSetDigestSha256`. I valori fissi sono `status=available`, `code=null`,
`reviewOnly=true`, `writesPerformed=0` e `applyPolicy=none`.

| Valore U0 | Rappresentazione o limite congelato |
| --- | --- |
| `schemaVersion`, `output`, `outputSha256`, `citations`, `claims` | Ereditano esattamente il contratto versionato `mediflow.document-synthesis.claim-citations.v1`. `outputSha256` e lower hex canonico di 64 caratteri. |
| `citations` | Da 1 a 32, nell'ordine validato dall'host. Ogni citation ha, in questo ordine, `label`, `quote`, `startByte`, `endByte`, `quoteSha256`; `quoteSha256` e lower hex canonico di 64 caratteri. |
| `claims` | Esattamente un claim per ogni canonical output path, fino al limite corrente di 194. Ogni claim ha, in questo ordine, `claimPath`, `labels`; `labels` contiene da 1 a `citationCount` label uniche e in ordine strettamente crescente rispetto alle citazioni. |
| Offset e testo | `startByte` e `endByte` sono interi sicuri non negativi. Il codec li codifica come gli stessi interi `u64BE`, senza arrotondamento o coercizione. I contratti esistenti hanno gia validato e normalizzato il testo; il codec UTF-8 codifica le esatte stringhe trattenute senza ulteriore normalizzazione. |
| `sourceSetDigestSha256` | Raw32 dal currentness owner: esattamente 32 interi da 0 a 255, copiati come byte senza rehash o hex. |

La pubblicazione riuscita usa esclusivamente questi tre schema versionati:

- `mediflow.document-synthesis.publication.v1`;
- `mediflow.document-synthesis.publication-receipt.v1`;
- `mediflow.document-synthesis.publication-provenance.v1`.

Ogni record ha esattamente i campi sotto indicati, nello stesso ordine di
enumerazione. Un campo mancante, aggiunto, duplicato o riordinato nega. Questo
ordine definisce la forma del record, non una serializzazione JSON e non un
input per JCS.

| Record | Campi ordinati e valori congelati |
| --- | --- |
| Publication | `schemaVersion`, `output`, `citations`, `claims`, `receipt`, `provenance` |
| Receipt | `schemaVersion`, `capability`, `outputSha256`, `claimCitationsDigestSha256`, `sourceSetDigestSha256`, `providerBindingReceipt`, `reviewOnly`, `applyPolicy`, `writesPerformed` |
| Provenance | `schemaVersion`, `capability`, `sourceSetAuthority`, `inputDigestScope`, `citationSupport`, `modelCausality`, `fabricProvenance` |

Il record Publication ha `schemaVersion=mediflow.document-synthesis.publication.v1`.
`output`, `outputSha256`, `citations` e `claims` sono gli esatti valori U0
gia validati. La pubblicazione non li normalizza, riordina, serializza,
ricostruisce o ricalcola. `outputSha256` mantiene la sua rappresentazione U0;
`sourceSetDigestSha256` e il digest raw32 U0, copiato senza hex, decoding o
rehash.

La receipt ha `schemaVersion=mediflow.document-synthesis.publication-receipt.v1`,
`capability=document_synthesis`, `reviewOnly=true`, `applyPolicy=none` e
`writesPerformed=0`. `providerBindingReceipt` e l'esatto riferimento trattenuto
alla `DocumentSynthesisProviderBindingReceipt` host-owned gia emessa. Non e una
copia, un clone, una proiezione JSON o una receipt ricostruita. Il digest
`claimCitationsDigestSha256` e raw32.

La provenance ha
`schemaVersion=mediflow.document-synthesis.publication-provenance.v1`,
`capability=document_synthesis`, `sourceSetAuthority=application_host`,
`inputDigestScope=ordered_normalized_provider_projection_set`,
`citationSupport=provider_declared_host_membership_and_locator_validated` e
`modelCausality=not_established`. `fabricProvenance` e l'esatto
`FabricProvenanceRecord` gia trattenuto dal Fabric. Questa ADR non ne congela
di nuovo i campi o lo schema. Il suo campo `receipt` deve essere lo stesso
riferimento trattenuto alla `FabricResolutionReceipt` del Fabric, senza clone,
ricostruzione o sostituzione. Nessuna evidence, receipt o provenance concede
authority.

`claimCitationsDigestSha256` usa il codec binario domain-separated
`mediflow.document-synthesis.claim-citations-digest.v1`. Il payload e l'esatta
concatenazione seguente:

```text
u32BE(byteLength(domainTag)) || utf8(domainTag) || u16BE(1)
|| u16BE(citationCount)
|| per ogni citation U0 ordinata:
   u32BE(byteLength(label)) || utf8(label)
   || u32BE(byteLength(quote)) || utf8(quote)
   || u64BE(startByte) || u64BE(endByte)
   || raw32(decodeLowerHex(quoteSha256))
|| u16BE(claimCount)
|| per ogni claim U0 ordinato:
   u32BE(byteLength(claimPath)) || utf8(claimPath)
   || u16BE(labelCount)
   || per ogni label del claim, nell'ordine U0:
      u32BE(byteLength(label)) || utf8(label)
```

`domainTag` e la stringa esatta del nome codec. Ogni `u32BE` della lunghezza e
l'unsigned big-endian del numero di byte UTF-8, seguito subito da quegli stessi
byte senza terminatore o padding. Versione e conteggi usano `u16BE` unsigned;
offset e estremi usano `u64BE` unsigned. SHA-256 restituisce raw32 dei soli byte
del payload concatenato. Il codec non usa JSON, JCS, un master digest, un digest
di pubblicazione o un digest del plaintext originale.

Prima dell'hash, l'host rifiuta Unicode o UTF-8 non validi, stringhe vuote dove
U0 richiede label, quote o claim path non vuoti, `quoteSha256` che non sia lower
hex canonico di 64 caratteri e i cui 32 byte decodificati non coincidano con la
citazione U0, overflow di conteggi, lunghezze o interi, e valori fuori dai limiti
U0. Rifiuta inoltre qualunque drift di ordine, cardinalita o duplicato nelle
citazioni, nei claim o nelle label dei claim. Il codec non ordina, deduplica o
altrimenti corregge l'input.

### Fence a due fasi e receipt finale

La prima sezione e sincrona e segue I1c: la frontiera pubblica non osserva campi
della projection prima dell'autenticazione; l'host autentica e acquisisce lo
stesso owner, risolve il capture handle e lo brucia immediatamente, quindi
valida e normalizza in modo puro la projection tipizzata. Poi entra o continua
la fence P4, esegue una sola lettura di currentness vincolata alla coppia
paziente/ambulatorio selezionata confrontando `documentSourceRef`,
`documentRevision` e `documentFreshnessEpoch`, poi alloca e acquisisce uno
snapshot atomico del lineage (`sourceSetEpoch`, `revocationGeneration`) e
cattura il source set. Il claim per questa sezione e `sync` nello stesso
processo, senza `await`; la currentness multiprocesso e fuori da questo packet.
Segue esattamente una chiamata asincrona al provider, con cancellazione interna.

La seconda sezione e sincrona: rilettura completa del lineage, fence finale P4
su selezione, review e sessione, validazione di citazioni e digest. Prima del
commit puo precomputare e congelare un payload di pubblicazione opaco, privato
e non osservabile, trattenuto solo in memoria come `private terminal ticket`.
Il payload trattiene direttamente i valori U0 e i riferimenti evidence gia
congelati; non li clona, serializza o ricostruisce.
Prima della revalidation riuscita e del commit del lease DS, quel payload non e
una receipt o provenance emessa e non puo essere restituito, risolto, loggato,
persistito, ispezionato o usato come authority. Il commit del lease DS resta
l'ultima operazione. Le sezioni protette non accettano `Promise` o thenable. Non
eseguono DB, persistenza o scritture cliniche.

Solo dopo la rilettura riuscita e il commit, la pubblicazione seleziona e
restituisce il riferimento immutabile precompilato nello schema congelato come
receipt e provenance finali. Dopo il commit non avvengono hashing, cloning,
freezing, callback, logging, cleanup, persistenza o altro lavoro fallibile. La
receipt lega il digest U0 dell'output, il digest delle citazioni e dei claim, il
source set raw32 e la provider-binding receipt. Dichiara `review-only`,
`applyPolicy=none` e `writesPerformed=0`.

I gate avversari sono obbligatori e deterministici. Se durante la chiamata
asincrona cambiano revoca, selezione, review, revisione documento, freshness,
source set o expiry, l'operazione abortisce o termina negata. Un completamento
tardivo puo essere osservato per la denial, ma non e mai pubblicato. La
revalidation finale e il commit-last devono riuscire prima della pubblicazione
o restituzione di receipt o provenance; un failure iniettato prima del commit prova
`receipt: null`.

### Riconciliazione dell'integrazione

ADR 0099 e ADR 0100 sono riservate a decisioni sibling. ADR 0101 e allocata al
binding sealed/presentation di Treatment. Questa ADR usa quindi il numero 0102.

Il candidato divergente di attachment-currentness
`221758c3` resta `HOLD_INTEGRATION_BASE`. Non e una base integrata e non esiste
uno SHA combinato da dichiarare. Il runtime resta diviso tra i candidati fino a
una base esplicita e una verifica indipendente prima di qualsiasi composizione.

## Thin slices e stop rule

| Slice | Confine unico | Fermare se |
| --- | --- | --- |
| C3c1 | Mint e consume del handle host-owned. | Il chiamante fornisce un binding o il consume non e monouso. |
| C3c2 | Cattura ordinata e assegnazione `S1`...`Sn`. | Il set o il suo ordine puo cambiare dopo begin. |
| C3c3 | Projection minimizzata per provider. | Il provider riceve ID, provenance o plaintext originale. |
| C3c4 | Validatore host di etichetta, citazione, offset e `quoteSha256`. | Una citazione ambigua, duplicata o non citata e accettata. |
| C3c5 | Fence sincrono/asincrono e cancellazione interna. | Una sezione protetta attende, accetta thenable o effettua I/O persistente. |
| C3c6 | Receipt finale review-only dopo revalidation e commit. | La receipt precede il commit o indica apply o scritture. |

Ogni slice resta sotto circa 300 LOC, usa fixture sintetiche e non autorizza la
slice successiva. Un fallimento mantiene l'operazione negata e non abilita
fallback, caller abort, provider authority o persistenza.

## Falsificatori

Fermare la promozione se:

- un chiamante o provider influenza paziente, documento, sorgente, digest,
  citazione, receipt o provenance;
- un handle resta consumabile dopo burn, revoca, expiry o cambio di epoch;
- un timestamp viene presentato come prova di correntezza;
- il provider riceve un riferimento canonico o il plaintext originale;
- una citazione non localizzabile in modo univoco viene pubblicata;
- una pubblicazione cambia ordine, cardinalita o valori U0, o il codec ordina,
  deduplica, ricalcola o serializza JSON per correggere tali valori;
- `claimCitationsDigestSha256` non usa il codec raw32 domain-separated fissato,
  oppure una receipt o provenance ricostruisce una evidence trattenuta;
- un digest della projection viene usato come digest dell'allegato originale;
- la receipt manca di revalidation, binding o `writesPerformed=0`;
- la composizione usa `221758c3` come base integrata o dichiara uno SHA combinato.

## Non-obiettivi e stato di delivery

Questa ADR non aggiunge runtime, route, UI, schema persistente, migrazioni, DB,
persistenza, log, provider, invocazioni live, cloud, egress, cancellazione
caller-supplied, review persistente, apply o scritture cliniche. Non prova
plaintext originale, authority del provider, entailment, correttezza clinica o
causalita del modello. Non introduce JCS, un master digest, un digest della
pubblicazione o del plaintext originale.

Lo stato e `Accepted`. Un packet downstream delimitato richiede un gate
precedente accettato e una base esatta; non richiede una nuova autorizzazione
utente per ogni fase. Questa decisione non autorizza runtime, azioni remote,
egress, persistenza o scritture cliniche.
