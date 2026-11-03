# Risoluzione dei glifi nel visualizzatore PDF.js

Stato: corretto il 3 novembre 2026. La regola stretta su `isInFont` descritta sotto resta inutilizzabile; la correzione esclude gli spazi e rifiuta ogni altro glifo senza contorno, nell'anteprima Web e nel raster per l'OCR. Dettagli nella sezione «Correzione» in fondo e nell'ADR 0107.

Analisi originale dell'1 novembre, PDF.js 4.10.38, configurazione del visualizzatore locale: font del pacchetto, useSystemFonts=false, disableFontFace=true, stopAtErrors=true, niente risorse ausiliarie remote.

`isInFont` non è un esito di risoluzione sufficiente: PDF.js lo calcola da `toFontChar`, dopo la riparazione del font, che può escludere anche glifi vuoti legittimi. Le prove usano il motore reale e i controlli di risorse di produzione, senza sostituire i record dei glifi. Non sono una prova del percorso autenticato completo nel browser.

## Controprove

- Base14: `/Differences [32 /space]` e `/Differences [32 /nonexistentSyntheticGlyph]`, con codice 32 effettivamente usato, producono record identici: fontChar e unicode spazio, width=278, isSpace=true, isInFont=false. Un'esenzione degli spazi accetterebbe anche il nome irrisolvibile.
- Font CID incorporato: i due PDF condividono il font originale, che contiene `.notdef`, `space` e un glifo sintetico. Per il codice 32 il primo CIDToGIDMap punta al glifo 1 (`space`), il secondo al glifo 0 (`.notdef`). Dopo la normalizzazione PDF.js sono identici sia i record sia tutti i campi serializzabili del font esportato con fontExtraProperties=true, compreso l'hash dei byte del font ricostruito. Il test verifica nei file originali gli indici 1 e 0. Il generatore dei due PDF CID è conservato accanto ai dati; fontTools e pikepdf servono soltanto a rigenerare questi dati sintetici, non al prodotto.

Questa è una prova del limite dell'interfaccia di operatori/font esportati verificata, non un teorema sull'impossibilità di ispezionare il PDF originale con altri strumenti. Una distinzione affidabile richiede informazioni anteriori alla normalizzazione del font. Non viene introdotta un'eccezione fondata soltanto su Unicode, isSpace o larghezza, né una nuova garanzia tipografica.

## Corpus e falsi rifiuti

I file e gli hash sono gli stessi della misura GPUI: 24 casi principali e 6 controlli validi aggiuntivi. I sei PDF/A riutilizzano i sei DOCX; non è un campione di 30 origini indipendenti e non misura la frequenza clinica. DOCX esportati con LibreOffice 25.2.7.2: esportatore Microsoft Word non provato. PDF/A-2b dichiarato dall'esportatore, senza validatore indipendente.

| Famiglia | File | Flag false in almeno un glifo | Rifiuti con regola stretta e quote esistenti |
| --- | ---: | ---: | ---: |
| DOCX esportati | 6 | 6 | 6 |
| Laboratorio non incorporato | 6 | 2 | 2 |
| OCR | 6 | 0 | 2 |
| Esportazione PDF/A-2b | 6 | 6 | 6 |
| Differences validi | 6 | 2 | 2 |
| Totale legittimi | 30 | 16 | 18 |

Il controllo originale di risorse rifiuta i due OCR oltre quota immagine. Una regola stretta isInFont rifiuterebbe altri 16 PDF, tutti per spazi legittimi nei casi misurati. Nei PDF della review il flag è false per A e 3, rispettivamente. Esentare gli spazi dai record non risolve l'ambiguità dimostrata sopra.

La misura dell'1 novembre non modificava la guardia di produzione. Il confronto dei campi del font esportato con fontExtraProperties=true è stato fatto allora e non è ripetuto dalla prova attuale, che usa la configurazione di produzione.

## Correzione

Le controprove mostrano che PDF.js non distingue uno spazio valido da un nome irrisolvibile usato sul codice dello spazio. Non serve distinguerli: entrambi disegnano un avanzamento vuoto e lo strato di testo dice spazio, quindi l'immagine non contraddice il documento. Il difetto clinico nasce quando a mancare è un carattere visibile, una cifra o una lettera: lì il raster mostra un vuoto mentre il codice e il testo dicono «3».

La regola adottata, `hasUnresolvedPdfGlyph` in `lib/pdf-raster-preflight.mjs`, rifiuta la pagina se un glifo ha `isInFont=false` e un carattere che non è spaziatura. Sul corpus: 0 rifiuti su 30 legittimi, oltre ai 2 OCR già fuori quota immagine; rifiutati `missing-glyph.pdf`, `lab-missing-digit.pdf` e i due casi GPUI `simple-three-missing.pdf` e `cid-three-missing.pdf`. Le prove sono in `components/document-viewer-pdf-glyphs.test.ts` e nel test del renderer AnyDoc.
