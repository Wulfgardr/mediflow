# ADR 0119: estrazione AnyDoc e OCR Apple Vision sulla sorgente corrente

Date: 2026-09-05
Status: Accepted
Issue: [WUL-671](https://linear.app/wulfgardr/issue/WUL-671)
Program line: candidato locale `0.8.6`

Aggiornamento 7 settembre 2026: [ADR 0128](./0128-local-desktop-ocr.md)
estende il candidato locale a Tesseract WASM e renderer Windows/Linux.
Le prove qui descritte restano riferite al Mac e non attestano equivalenza.

## Problema e precedenza

La composizione documentale già presente sulla base `b72ac713b` continua le
pagine PDF segnalate da AnyDoc con Apple Vision. ADR 0107 descrive invece il
ritiro di ogni fallback e ADR 0111 prescrive DeepSeek. ADR 0117 rende gli engine
opzionali, senza distinguere abbastanza il percorso già eseguibile dal catalogo
Fabric. Queste formulazioni rendono ambiguo sia lo sviluppo sia il significato
dello stato OCR mostrato all'utente.

Per l'estrazione locale degli allegati, questa decisione:

- sostituisce il divieto generale di fallback Apple Vision di
  [ADR 0107](./0107-anydoc-local-attachment-extraction.md) limitatamente alle
  pagine PDF ammesse dal routing AnyDoc;
- conserva [ADR 0111](./0111-deepseek-ocr2-selective-page-routing.md) come
  contratto dell'eventuale adapter DeepSeek, non come motore obbligatorio;
- precisa [ADR 0117](./0117-headless-portable-agent-first-and-capability-first-fabric.md):
  candidabilità di un engine, configurazione del catalogo ed esecuzione
  documentale osservata sono fatti distinti;
- conserva sorgente corrente, revisione e authority degli owner esistenti.

## Decisione

Il percorso supportato in questa tranche è:

```text
allegato corrente dell'host → AnyDoc locale
  → testo disponibile: anteprima da rivedere
  → pagine PDF needsOcr: materializzazione e rendering bounded
    → Apple Vision locale → ricomposizione in ordine → controllo currentness
      → anteprima da rivedere con provenienza OCR
```

AnyDoc è estrazione deterministica, non OCR. Apple Vision non diventa un
provider Fabric. Il percorso invocato dalla UI rimane il servizio autenticato
`POST /api/attachments/{id}/local-extraction`; il caller non sceglie engine,
provider, pagine, sorgente, endpoint o fallback. La capability Fabric `ocr`
rimane `unavailable` e le route OCR legacy autenticate rimangono ritirate.
La loro riattivazione non è una condizione per usare il fallback documentale.

Solo il risultato finale ammesso dall'owner della sorgente può essere mostrato.
Il risultato conserva `review=required`, `writes=0`, `apply=none` e, se estratto,
`candidateUse=review_only`. Nessuna scrittura clinica o inferenza generativa
segue automaticamente l'estrazione. Il cambio della sorgente o la revoca della
sessione durante il lavoro impediscono la pubblicazione del risultato.

## Matrice e limiti

| Input / ambiente | Esito della tranche |
| --- | --- |
| PDF con testo | AnyDoc; nessun claim OCR quando manca la provenienza OCR. |
| PDF scansionato sul Mac target arm64 | Apple Vision sulle sole pagine `needsOcr`; anteprima e provenienza verificate con fixture. |
| PDF misto con ultima pagina scansionata | Testo nativo conservato, scansione riconosciuta, ancore di pagina e ordine preservati. |
| Immagine singola PNG | La composizione attuale non ha routing PDF: esito da rivedere manualmente. La capacità del motore di leggere raster non implica supporto dell'allegato immagine nella UI. |
| Altri sistemi / Mac Intel | Nessuna equivalenza OCR attestata da questa prova. Il core non richiede Apple Vision; il supporto OCR per piattaforma resta da qualificare separatamente. |
| File vuoto, corrotto, protetto, oltre i limiti o engine indisponibile | Nessuna anteprima di successo con contenuto vuoto/incompleto; esito non estratto e revisione manuale. |

La composizione corrente ammette documenti PDF fino a 16 pagine e sorgenti fino
a 25 MiB. Il renderer limita raster, pixel, memoria e tempo; il riconoscimento
ha una scadenza condivisa di 30 secondi, fino a 16 MiB per raster e 32 MiB per
documento. Quel tempo riguarda il riconoscimento, non l'intero flusso UI.
È ammesso un documento OCR attivo per processo, senza coda implicita.
Le costanti nei moduli di estrazione, rendering e OCR restano la fonte dei
limiti eseguibili; cambiarle richiede verifiche proporzionate.

I processi usano script verificati per digest, input bounded e ambiente locale.
Il renderer PDF legge soltanto dal package root consentito: nei worktree di
prova le dipendenze devono essere realmente presenti dentro quel root.
Non allargare i permessi per accomodare un symlink di test esterno.
Nessun servizio remoto o download di modelli è un fallback implicito.

## Presentazione e verifica

La UI distingue l'anteprima AnyDoc dall'anteprima OCR soltanto dopo che il
client ha validato envelope, identità allegato, digest del testo e provenienza
Apple Vision. Per un successo OCR mostra il numero di pagine riconosciute sul
totale, con richiesta di revisione. Non deduce disponibilità globale del motore
o stato Fabric da un singolo risultato e non mostra identificatori tecnici.

`e2e/document-upload-ocr.spec.ts` verifica dal pulsante UI la matrice testuale,
scansione, misto e immagine; il test client verifica che conteggi/provenienza
non validi non producano una preview. Le prove di composizione controllano
currentness e revoca; quelle del motore e del renderer coprono limiti ed errori.
I risultati sintetici non misurano accuratezza clinica e non provano un
installer distribuito o supporto universale.

## Alternative e seguito

Non trapiantare l'adapter Fabric Apple Vision storico: la composizione AnyDoc
esistente copre il percorso PDF e possiede già currentness e provenienza.
DeepSeek, Ollama, OCR immagini applicativo ed engine per altre piattaforme
richiedono un bisogno esplicito e prove proprie; il solo nome del branch o la
discovery del modello non giustificano la loro attivazione.

WUL-671 resta aperta per completare recupero/errori dalla UI e prova sul pacchetto
target. WUL-674 dovrà rendere comprensibile la distinzione tra percorso
documentale e registro Fabric. La scelta estetica globale rimane in WUL-677.


## Raccordo WUL-671 del 12 settembre 2026: allegati ordinari cifrati

Il precedente E2E inseriva plaintext via API: non attestava il percorso ordinario
upload UI → `ENC:`. In questa candidata l'upload e la cifratura restano invariati.
Si applica la projection client prevista da ADR 0095 §2 con un adattatore
strettamente documentale; `typed-projection-broker.ts` resta Smart Import-only.
Non vengono estesi owner auth, schema, PIN, Fabric, DS/SI o motori.

Il client sbloccato chiede una concessione monouso al medesimo endpoint locale
con `X-MediFlow-Extraction-Action: acquire`. Il server usa la selezione canonica
corrente compatibile, oppure, per questo nuovo gesto esplicito, il binding
univoco già previsto. Nessuna fase successiva al grant può riselezionare o
rinnovare un lease obsoleto. L'owner
verifica paziente, appartenenza all'ambulatorio, versioni ed epoch. La concessione
opaca è associata in RAM a sessione, locator, sourceRef/revision/freshness,
generazione di restore e digest **calcolato dall'host sul dato cifrato memorizzato**.
Non contiene chiavi o dati clinici. Le versioni e gli hash del caller non sono
accettati per costruire, rinnovare o validare questa authority.

Dopo la concessione il client rilegge l'allegato con la facade `db` già decifrante,
tramite un GET `no-store` successivo al grant e invia solo i byte
richiesti, come `application/octet-stream`, con azione `project` e concessione in
header. La master key resta nel client. Il server accetta soltanto richieste
same-origin su loopback, con sessione web valida; nessun endpoint anonimo di
conversione, percorso file, provider, engine, pagine o URL è accettato. Il corpo
è letto in streaming bounded, dopo aver riservato monouso la concessione e con
controlli di currentness prima/dopo ogni attesa di lettura. L'authority copia i
byte e ricontrolla il ciphertext corrente nello stesso lease del consumo.

La provenienza è esplicita: `authenticated_client_decryption`, con
`ciphertextEquality: not_attested`. L'host attesta identità/incarnazione e
currentness della riga cifrata; i digest AnyDoc attestano i byte ricevuti e il
testo prodotto. **Nessuno di questi dati dimostra crittograficamente che il
plaintext sia la decifratura di quel ciphertext.** Il client medico sbloccato e
il suo codice di decifratura sono parte del trust domain ADR 0095. La facade esegue una lettura fresca dopo acquire; consume/finalize verificano
che il ciphertext host non sia cambiato. Le API ordinarie conservano la
proiezione senza tuple di currentness: il client non le inventa e non le usa
come prova contro un client compromesso. Non è previsto trasferire chiavi o introdurre
una nuova prova crittografica in questo intervento.

AnyDoc resta il primo passaggio; soltanto `image_or_scan` prosegue nella
composizione OCR esistente, che rende esclusivamente pagine `needsOcr`. Prima e
dopo ciascun await di composizione l'authority verifica sessione, selezione,
review, sorgente e restore. Il risultato viene serializzato soltanto dopo il
finalize corrente. I processi già avviati restano soggetti ai loro timeout
esistenti: cancel non promette preemption del motore. Impedisce l’avvio della
continuazione OCR dopo una revoca osservata dalla composizione e ogni
pubblicazione tardiva; non interrompe le fasi interne già delegate al motore. Nessun cambiamento ai digest degli script o ai limiti dei
motori. Il percorso senza payload esistente resta compatibile per le sole
sorgenti già leggibili dall'host; non è il percorso della UI ordinaria.

Limiti dell'adattatore: 25 MiB per sorgente, 16 concessioni in memoria, una
acquisizione/esecuzione attiva per processo; concessione non usata 30 secondi,
operazione 120 secondi. Concorrenza eccedente nega senza coda e consente un nuovo
gesto esplicito. Riutilizzo, sessione diversa, scadenza o source/selection change
non ammettono retry impliciti. `DELETE` autenticato sullo stesso endpoint revoca
la concessione; lock/logout revocano anche tramite l'owner. Il segnale sincrono
`db.getSessionReadSignal()` impedisce al client di continuare fra lock e unmount.
Cambio selezione, cancellazione e pagehide eliminano la preview transiente.

Le copie mutabili di proprietà di questo adattatore sono azzerate a consumo,
revoca e termine; concessioni, input e risultati non sono persistiti né loggati.
Le copie interne dei motori e le stringhe immutabili JavaScript sono rilasciate
secondo il lifecycle/GC esistente: non si rivendica secure erasure dell'intero
processo. Nessuna modifica allo storage del client o agli engine. Cache HTTP
`no-store`, redirect client `error`, nessun egress o fallback di rete.

L'E2E aggiornato carica file sintetici dal vero input UI e verifica `ENC:` sia
nella richiesta di persistenza sia nella successiva lettura API. Distingue la
risposta `acquire` dall'esecuzione `project`, verifica provenienza, testo completo,
ordine e ultima pagina; include annullamento e replay. Il lock è coperto dalle
prove client e di composizione con owner reale. Le prove deterministiche
aggiunte coprono inoltre mutazione/eliminazione, revoca, appartenenza, selezione,
scadenza, corpo malformato/oversize e input non supportati. I risultati effettivi
e quelli mancanti sono nel VALIDATION della consegna: non sono qualifica release.

Il grant di proiezione registra inoltre una dipendenza sulla selezione presso il
`selectionLifecycleController` del singleton owner già esistente. Il cambio
selezione revoca sincronicamente il grant, interrompe una lettura HTTP sospesa e
azzera i buffer posseduti: non attende il completamento del parser. Gli ulteriori
check canonici prima/dopo ogni attesa restano necessari per modifiche del record,
appartenenza, versione e restore. Nessuna nuova authority di selezione viene creata.

Verifica di integrazione del parent: la lista e il dettaglio web omettono
intenzionalmente sourceRef/revision/freshness (test del contratto esistente
invariati). Solo il grant documentale espone la propria provenienza descrittiva.
La UI ritira la preview a ogni refresh della lista di allegati, oltre che a
selezione/lock/pagehide; non deduce currentness da campi assenti. La pulizia
locale e l abort sono sincroni; l unregister delle risorse viene rinviato alla
microtask successiva per evitare reingresso nell owner durante il lock.

Next puo normalizzare `request.url` a localhost anche quando il browser usa
127.0.0.1. Il trasporto verifica URL interno e Host entrambi loopback, stessa
porta e Origin esattamente uguale all Host pubblico. Non usa header forwarded
ne ammette host esterni, credenziali o percorsi dentro Host.
