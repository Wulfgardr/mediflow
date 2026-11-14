# PDF sintetici per l'ammissione dell'anteprima

`app/tests/document_pdf.rs` passa questi byte al binario dell'app con
`--document-preview-worker`, senza avviare GPUI, poi usa il parser Rust reale
per verificare metadati e raster completo. Tutti i contenuti sono inventati.
I test usano i file conservati qui e non richiedono i produttori installati.

| File | Produttore e struttura | Risultato atteso |
| --- | --- | --- |
| `referto-QSette-Lucia.pdf` | pdf-lib, PDF 1.7, object stream e xref stream, una pagina | Accettato, raster non bianco |
| `coregraphics-two-pages.pdf` | Quartz/CoreGraphics di macOS 27.3, due pagine con rettangoli colorati | Entrambe le pagine accettate, 300 x 180 pixel |
| `ghostscript.pdf` | GPL Ghostscript 10.08.0, da PostScript, testo Helvetica e rettangolo | Accettato, 300 x 180 pixel |
| `reportlab.pdf` | ReportLab 5.1.0, testo Helvetica e rettangolo, senza object stream | Accettato, 300 x 180 pixel |
| `reportlab-bookmarks.pdf` | ReportLab 5.1.0, due pagine con segnalibri generati tramite bookmarkPage/addOutlineEntry | Entrambe le pagine accettate come su main |
| `bookmark-goto.pdf` | Azione GoTo nel solo segnalibro | Accettato |
| `bookmark-uri.pdf` | Collegamento URI nel solo segnalibro | Accettato |
| `openaction-destination.pdf` | OpenAction come destinazione e zoom iniziale | Accettato |
| `openaction-goto.pdf` | OpenAction GoTo | Accettato |
| `empty-indirect-object-stream.pdf` | Fixture sintetica serializzata e compressa con qpdf 12.4.2 | Accettato, `/Annots` riferisce un array vuoto |
| `annotated-object-stream.pdf` | Fixture sintetica serializzata e compressa con qpdf 12.4.2 | Rifiutato, pagina e annotazione in object stream |
| `outline-action.pdf` | Fixture sintetica con segnalibro e azione URI, compressa con qpdf 12.4.2 | Accettato come su main, collegamento solo nei segnalibri |
| `annotated-second-page.pdf` | Fixture sintetica, xref classica, annotazione Text solo sulla seconda pagina | Rifiutato anche chiedendo la prima pagina |

Nel file pdf-lib la pagina è l'oggetto 5, nello stream compresso 7, e contiene
`/Annots []`. La presenza della chiave non implica che ci siano annotazioni.
Rimangono rifiutati array Annots non vuoti o malformati e array Fields non vuoti in AcroForm. Un AcroForm vuoto è ammesso. Segnalibri, destinazioni, GoTo, URI e metadati JavaScript/Launch mantengono l’ammissione di main, senza eseguire azioni.

Il corpus copre questi produttori e il serializzatore sintetico del test.
Non prova Acrobat, LibreOffice, Microsoft Office, scanner o tutti i PDF
prodotti dalle versioni elencate. Non attesta la resa dell'app installata
né la fedeltà di ogni carattere.

`main-preview-admission.json` conserva commit della base, hash dei PDF e
metadati delle pagine realmente emessi dal lavoratore di main per CoreGraphics,
Ghostscript, ReportLab e ReportLab con segnalibri. Il test di compatibilità
verifica che questi stessi byte rimangano ammessi, con raster completi non
bianchi e gli stessi metadati. Non vincola i pixel al font rendering di una
singola versione di macOS.
