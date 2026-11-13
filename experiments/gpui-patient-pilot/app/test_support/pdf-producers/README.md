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
| `empty-indirect-object-stream.pdf` | Fixture sintetica serializzata e compressa con qpdf 12.4.2 | Accettato, `/Annots` riferisce un array vuoto |
| `annotated-object-stream.pdf` | Fixture sintetica serializzata e compressa con qpdf 12.4.2 | Rifiutato, pagina e annotazione in object stream |
| `outline-action.pdf` | Fixture sintetica con segnalibro e azione URI, compressa con qpdf 12.4.2 | Rifiutato anche senza Annots o OpenAction |
| `annotated-second-page.pdf` | Fixture sintetica, xref classica, annotazione Text solo sulla seconda pagina | Rifiutato anche chiedendo la prima pagina |

Nel file pdf-lib la pagina è l'oggetto 5, nello stream compresso 7, e contiene
`/Annots []`. La presenza della chiave non implica che ci siano annotazioni.
Rimangono rifiutati array non vuoti, valori malformati, campi e azioni.

Il corpus copre questi produttori e il serializzatore sintetico del test.
Non prova Acrobat, LibreOffice, Microsoft Office, scanner o tutti i PDF
prodotti dalle versioni elencate. Non attesta la resa dell'app installata
né la fedeltà di ogni carattere.
