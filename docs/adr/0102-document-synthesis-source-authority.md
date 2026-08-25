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

Il chiamante non puo fornire riferimenti a paziente, documento o sorgente, ID,
digest, provider, citazioni, receipt o provenance. Questi valori non possono
entrare da body, path, query, cookie, UI, cache, projection o AIP/Mini.

Il source-set handle e opaco, memory-only e legato a sessione autenticata,
selezione paziente canonica, `selectionEpoch`, `reviewContextEpoch`, identita e
scadenza del lease, `documentSourceRef`, `documentRevision`,
`documentFreshnessEpoch`, `sourceSetEpoch` e `revocationGeneration`.

Il lifecycle e `minted -> burned at begin -> in_flight -> published | denied`.
Il burn avviene all'inizio e impedisce un secondo consumo. Un timestamp non
prova la correntezza; la correntezza dipende dai binding ed epoch riletti
dall'host.

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

### Fence a due fasi e receipt finale

La prima sezione e sincrona: begin, controllo P4 e snapshot delle fonti, burn
dell'handle e preparazione dell'invocazione. Segue esattamente una chiamata
asincrona al provider, con cancellazione interna.

La seconda sezione e sincrona: rilettura completa degli epoch, validazione di
citazioni e digest, preparazione di un payload receipt non osservabile e commit
con il lease DS come ultima operazione. Le sezioni protette non accettano
`Promise` o thenable. Non eseguono DB, persistenza o scritture cliniche.

Solo dopo la rilettura e il commit l'host crea e restituisce receipt e
provenance finali. La receipt lega i digest di output, citazioni, source set e
provider-binding receipt. Dichiara `review-only`, `applyPolicy=none` e
`writesPerformed=0`.

I gate avversari sono obbligatori e deterministici. Se durante la chiamata
asincrona cambiano revoca, selezione, review, revisione documento, freshness,
source set o expiry, l'operazione abortisce o termina negata. Un completamento
tardivo puo essere osservato per la denial, ma non e mai pubblicato. La
revalidation finale e il commit-last devono riuscire prima di creare o
restituire receipt o provenance; un failure iniettato prima del commit prova
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
- un digest della projection viene usato come digest dell'allegato originale;
- la receipt manca di revalidation, binding o `writesPerformed=0`;
- la composizione usa `221758c3` come base integrata o dichiara uno SHA combinato.

## Non-obiettivi e stato di delivery

Questa ADR non aggiunge runtime, route, UI, schema, migrazioni, DB,
persistenza, log, provider, invocazioni live, cloud, egress, cancellazione
caller-supplied, review persistente, apply o scritture cliniche. Non prova
plaintext originale, authority del provider, entailment, correttezza clinica o
causalita del modello.

Lo stato e `Accepted`. Un packet downstream delimitato richiede un gate
precedente accettato e una base esatta; non richiede una nuova autorizzazione
utente per ogni fase. Questa decisione non autorizza runtime, azioni remote,
egress, persistenza o scritture cliniche.
