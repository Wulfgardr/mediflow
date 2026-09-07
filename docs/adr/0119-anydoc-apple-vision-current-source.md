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
