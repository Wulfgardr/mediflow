# ADR 0174: anteprima PDF GPUI in un helper macOS

Stato: proposta per 0.9.1. Data: 2026-11-01.

## Decisione

Il target GPUI installato della 0.9.1 è macOS. Il ponte nativo già compilato
nell'app espone un ingresso PDFKit eseguito esclusivamente nel processo figlio,
prima dell'inizializzazione di GPUI e delle sessioni. `PDFDocument` riceve `NSData`
creato sui byte della pipe, equivalenti a `PDFDocument(data:)` in Swift. Non si
scrivono PDF o raster intermedi. Hayro, font/CMap e dipendenze dedicate escono
dal pacchetto. Sugli altri sistemi l'anteprima è dichiarata indisponibile.

Seatbelt viene applicato prima della lettura dei byte, con rete e scritture
negate. Il helper verifica il diniego tramite apertura in scrittura e tentativo
di connessione loopback. Sono consentite letture per le risorse di sistema e
mach lookup per i servizi dei font. Non è una sandbox che nasconde il filesystem.
Un errore nell'isolamento impedisce l'anteprima. Nessuna eccezione per directory
temporanee o cache viene aggiunta al profilo.

Il parent possiede il processo, campiona footprint/RSS e lo termina oltre
256 MiB, a revoca o dopo 15 secondi totali, compresi parsing e raster. Kill e
wait avvengono anche all'uscita anticipata. Il campionamento può superare la
soglia fra due letture; non è una quota atomica di heap. Il processo separato
rilascia anche le allocazioni interne di PDFKit quando termina.

## Fedeltà e limiti

L'ammissione controlla tutte le pagine prima di emettere pixel. Sono conservati
il limite di 500 pagine, i limiti di dimensioni e i 12 milioni di pixel per
immagine prima del raster; per JPEG si leggono le dimensioni codificate, senza
fidarsi del dizionario PDF. Un errore rifiuta l'intera anteprima. Maschere,
annotazioni, XObject Form, Type3 e pattern non sono ammessi.
Le codifiche Differences sono controllate sui codici effettivamente usati dagli
operatori di testo, con font attivo e stato grafico salvato/ripristinato. Per un
font Base14 non incorporato il nome deve appartenere alla Adobe Glyph List 2.0;
per un font incorporato deve essere risolvibile nel font stesso tramite
CGFontGetGlyphWithGlyphName. Nomi sconosciuti non usati non bloccano l'anteprima.
L'elenco Adobe è incorporato come soli nomi, con origine e licenza nel pacchetto;
non aggiunge dipendenze Cargo o font.

La guardia copre i nomi Differences effettivamente usati, non ogni glifo.
Non verifica cmap e CIDToGIDMap. I casi sintetici `cid-three-missing.pdf` e
`simple-three-missing.pdf`, conservati nel corpus di test, sono accettati e
possono produrre un raster bianco pur mantenendo il codice della cifra 3 e
ToUnicode. Sono limiti documentati, non rifiuti riusciti.

Sotto ogni anteprima PDF accettata è sempre mostrato:
«Alcuni caratteri possono mancare o differire: per un valore clinico controlla
il documento originale.» Accanto rimane «Salva l'originale…», con le protezioni
esistenti su sessione, paziente e operazioni in corso. L'avviso rende visibile
il limite; non equivale a una garanzia di fedeltà o a una verifica di ogni valore.
Gli operatori sconosciuti seguono il renderer di sistema.

L'input e il raster posseduti dal helper sono azzerati prima del rilascio.
I buffer interni di PDFKit, del kernel e della GPU non hanno questa garanzia.
Le prove sintetiche sul helper non sostituiscono il collaudo del pacchetto.

Le risorse ereditate dai nodi Pages vengono controllate come quelle dirette.
Gli XObject Form sono rifiutati: la scansione dei contenuti inline annidati
non è qualificata in questa tranche e non deve aggirare le quote immagini.
