# Risoluzione dei glifi nel visualizzatore PDF.js

Stato: limite riprodotto, correzione non qualificata. PDF.js 4.10.38, configurazione del visualizzatore locale: font del pacchetto, useSystemFonts=false, disableFontFace=true, stopAtErrors=true, niente risorse ausiliarie remote. Il difetto clinico del visualizzatore rimane aperto.

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

La PR contiene prove e dati, senza una modifica alla guardia di produzione. Il comando «Salva originale» di main rimane disponibile; non viene dichiarato che la cifra mancante sia stata corretta. Le nuove prove sono incluse nella suite unit Web reale come `components/document-viewer-pdf-glyph-observation.test.ts`.
