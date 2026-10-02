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
host e include esplicitamente package.json, binario, README e il sidecar ICU
Windows descritto sotto, senza wildcard
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

### Asset ICU del renderer Windows

Il package ufficiale `@napi-rs/canvas-win32-x64-msvc@0.1.100` include
`icudtl.dat`: 10.468.208 byte, SHA-256
`9ae98c06cbb0ea43c5cd6b5725310c008c65e46072421a1118cb88e1de9a8b92`.
La provenienza e il tarball gia fissato nel profilo, SHA-256
`a918366995d85d6989bd85c1c82f21eae90479cb1df40c2d6867ccb00338595b`;
il [manifest upstream della versione](https://raw.githubusercontent.com/Brooooooklyn/canvas/db337893b9b53483050ca7b24c6d306e4da06741/npm/win32-x64-msvc/package.json)
elenca il sidecar insieme al binary. Il tracing Windows x64 conserva entrambi.
Worker, controllo standalone e preflight desktop verificano il file fisico,
la dimensione e il digest prima dell'ingresso nel renderer native. Un asset
mancante, alterato o risolto tramite symlink nega la disponibilita; nessun
recupero, download o ricerca di dati ICU nella directory di Node.

La prova distinta `scripts/anydoc-windows-icu-text-smoke.mjs STANDALONE NEW_RECEIPTS`
va eseguita su Windows x64/Node 24.21.0 soltanto dopo review della candidata
e autorizzazione dell'esperimento. Esegue un solo child: registra esplicitamente
il font Liberation Sans gia pinned in `pdfjs-dist@4.10.38`, chiama `fillText`
e richiede un PNG 256x64 non vuoto. Il parent verifica chunk/CRC, decodifica
IDAT con un limite pari all'immagine e conta almeno otto pixel scuri dopo la
composizione su bianco; il conteggio del child resta solo diagnostico.
Mantiene 30 secondi, heap 256 MiB,
maxBuffer 4 MiB e l'ambiente originale; salva entrambi i raw prima della
valutazione, senza retry. Il probe non e importato dal prodotto e non e un
rerun del corpus font A/B. I test simulati del preflight non dimostrano
l'esito di questa prova native Windows. Questa chiusura non qualifica OCR,
font mancanti, il precedente timeout PDF o errori Chromium `ERR_ABORTED`.

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
