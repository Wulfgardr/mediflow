# ADR 0128: OCR desktop locale Tesseract WASM

Date: 2026-09-07
Status: Accepted for candidate implementation; target qualification pending
Issue: WUL-671

## Decisione e precedenza

Estendere ADR 0119 per Windows/Linux con un adapter Tesseract WebAssembly
CPU locale. macOS conserva Apple Vision. AnyDoc resta il primo passaggio e
l'unica autorita del routing: solo pagine PDF `needsOcr` raggiungono il renderer
esistente e il riconoscimento. Nessun PDF viene passato direttamente a
Tesseract e nessuna pagina nativa viene interpretata come prova OCR.
ADR 0088 resta storico; ADR 0107/0119 governano estrazione e currentness;
ADR 0111 conserva soltanto il contratto dell'eventuale adapter DeepSeek.

Il core `tesseract.js-core` 6.0.0, variante LSTM senza SIMD, e il modello italiano
`tessdata_fast` sono artifact opzionali provisionati localmente, fissati per
SHA-256 nel codice. Non usare download, cache remota, selezione automatica di
varianti, shell, GPU, worker annidati o eseguibili nativi Tesseract.
Il port WASM upstream modifica Tesseract: non dichiararlo binario nativo
upstream o Apple Vision multipiattaforma. Core e modello sono Apache-2.0;
la distribuzione deve conservare licenze e notice delle dipendenze upstream.

## Profili del renderer

Il renderer preesistente era limitato a macOS arm64. Questa decisione ammette
anche `@napi-rs/canvas` 0.1.100 su Windows x64 MSVC e Linux glibc x64/arm64;
ciascun pacchetto e descritto per digest di archivio e binario in un manifest
locale revisionato. Il nuovo controllo del binario grezzo riguarda soltanto
Windows/Linux. macOS conserva la verifica di versione preesistente e il proprio
packaging Mach-O, che modifica e ricolloca canvas in Contents/Frameworks:
non confrontare quel binario firmato con il digest del pacchetto npm grezzo. La selezione dipende da OS/arch/libc dell'host, non dal
caller. Binario assente, alterato o profilo non ammesso negano rendering e OCR.
Linux musl, Windows ARM nativo e Mac Intel non sono qualificati qui.
Il preflight Tesseract di produzione si applica soltanto a Windows/Linux.
Su macOS restituisce `not_applicable` prima di ispezionare gli artifact;
non verifica disponibilita o firma di Apple Vision. Il CLI usa exit 2 per
questa selezione non applicabile. La smoke Tesseract sul Mac richiede
`--development-tesseract-smoke` esplicito, e verifica i byte npm grezzi anche
su Mac: non va usata per il pacchetto firmato/ricollocato. Il renderer Mac
e i suoi guard di packaging/versione restano invariati.
Il tracing Next seleziona dal manifest il profilo Windows/Linux del build
host e include esplicitamente package.json, binario e README, senza wildcard
su tutti i backend. La configurazione non prova la presenza nel bundle
costruito: i controlli del pacchetto target restano necessari.
Windows ARM con Node x64 emulato appartiene al profilo x64 e richiede prova
nel guest. Il renderer continua a usare addon nativi nel proprio child: il
guard JavaScript della rete non costituisce sandbox OS degli addon. OCR WASM
non concede addon. Nessuna nuova dipendenza runtime nel package lock.

## Confine eseguibile

Riutilizzare il protocollo e l'owner del processo PDF esistente per una nuova
operazione di riconoscimento raster. Il child Node 24 ha permessi di sola
lettura sul package root, senza addon per OCR, scritture, processi o worker;
il guard locale nega import di rete e fetch. WASM usa filesystem in memoria.
Questa difesa copre il codice fissato, non un host o runtime compromesso.
Il parent conserva deadline, limiti stdout/stderr, terminazione e ammissione
fino a `close`. Gli input raster restano bounded a 16 MiB, 4096 pixel per lato,
12 milioni di pixel; massimo 16 pagine e 32 MiB per documento, 30 secondi di
riconoscimento condivisi. Nessun output parziale su errore o pagina vuota.
La heap JS e limitata a 256 MiB e la memoria lineare WASM a 8192 pagine
da 64 KiB (512 MiB); non equivalgono a un limite RSS di sistema.
La qualifica deve misurare memoria e latenza del profilo target.

Il controllo capability rileva artifact assenti, digest errati e piattaforme
non ammesse senza caricare il modello; distingue disponibilita tecnica da
qualifica. Restituisce una guida locale e non scarica nulla. Il risultato OCR
riporta l'identita Tesseract, i digest di core/modello/worker e gli hash di
input e output. Nessuna provenienza Apple Vision viene fabbricata.

Precisazione del 7 settembre dopo la prova guest: il comando di preflight
esegue anche un PDF nativo interamente sintetico attraverso l'owner AnyDoc
esistente. Un binding AnyDoc non caricabile deve produrre exit 1 e guida ai
prerequisiti locali, anche se gli artifact Tesseract sono integri. La funzione
sincrona di inventario artifact non prova il caricamento dei binding nativi.
Il controllo non installa runtime Microsoft, non avvia OCR e non qualifica
renderer, pacchetto o accuratezza. Il confine di estrazione resta invariato.

Currentness, revoca, sorgente host-owned e pubblicazione finale restano negli
owner esistenti. Anteprima obbligatoriamente review-only, writes=0, apply=none.
Nessun cambiamento a DB, Fabric, cataloghi, account, impostazioni o API v1;
le route OCR legacy restano ritirate. La UI deve validare la provenienza prima
di usare i conteggi OCR; non puo chiamare un successo desktop «su questo Mac».

## Qualifica e arresto

Test di protocollo con fakes provano solo contratti e recupero. La prova OCR
richiede raster interamente sintetici e il motore reale con digest registrati.
Su ciascun guest Windows/Linux servono scansione italiana, PDF misto con
scansione tardiva, testo nativo preservato, accenti, date e quantita sintetiche,
rotazione, rumore, tabelle, errori, timeout e retry; zero omissioni di routing,
zero pagine native inviate all'OCR e ricomposizione completa. Il coordinatore
fissa corpus, soglie CER/WER/exact-match, RAM e latenza prima del benchmark.
Una smoke sul Mac non qualifica Windows/Linux o accuratezza clinica.

Finche mancano esecuzione target, benchmark e packaging, lo stato e candidato
locale e il gap di equivalenza rimane aperto. Artifact mancanti o cambiati,
output vuoto/malformato, superamento limiti o currentness diversa negano
l'estrazione completa. Nessun fallback cloud o successo dedotto dal preflight.

## Fonti primarie

- https://github.com/naptha/tesseract.js-core — port WASM e modifiche upstream.
- https://tesseract-ocr.github.io/tessdoc/Data-Files.html — tessdata_fast, LSTM.
- https://github.com/tesseract-ocr/tessdata_fast — modello italiano e licenza.
- https://tesseract-ocr.github.io/tessdoc/Installation.html — sistemi e licenze.
