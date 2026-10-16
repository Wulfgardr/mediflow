# Asset ICD-11 MMS

Include `catalog.zip`, archivio WHO ufficiale originale e non modificato,
SimpleTabulation MMS 2026-01 inglese, scaricato il 15 ottobre 2026 da:
<https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip>.

- Dimensione: 4.214.980 byte.
- SHA-256: `f1356588f40953a83e3af2b662deab47c5e269f944d1ea4ed0cfeb2007c7cd39`.
- Versione nell'intestazione: 17 gennaio 2026, 05:30 UTC.
- 37.052 record logici: 35.664 categorie con codice, 1.360 blocchi e 28 capitoli.

`manifest.json` è generato e verificato da `parseWhoTabulation` in
`lib/reference-data/icd11-embedded-parser.ts` sullo ZIP originale. Registra URL,
release, lingua, attribuzione, licenza, hash, byte, conteggi, data di versione,
file selezionato e file ignorati. Non costituisce una firma WHO.

Il parser sceglie esattamente `SimpleTabulation-ICD-11-MMS-en.txt`.
`readme.txt` e il gemello `.xlsx` sono conservati nello ZIP ma ignorati;
XLSX da solo non è supportato. Zero o più file SimpleTabulation `.txt` candidati
sono rifiutati, così come una lingua diversa dall'inglese.
Il TXT contiene BOM UTF-8, record CRLF, campi quotati e CodingNote multilinea,
anche con LF non quotati. La colonna finale Version è metadato d'intestazione,
non una colonna dati. Le 100 righe fisiche di continuazione non sono record.

Solo le categorie con codice vengono indicizzate. Per ricerca e visualizzazione
si toglie il prefisso di profondità dei titoli e si associa la release 2026-01
agli URI MMS senza anno. `originalUri` nel risultato del parser e l'archivio
integrale conservano la fonte originale; non viene riscritto l'archivio WHO.
BrowserLink è una formula Excel e non viene eseguita né usata.

International Classification of Diseases, Eleventh Revision (ICD-11).
World Health Organization (WHO), 2019. <https://icd.who.int/browse11>.
Dati sotto licenza [CC BY-ND 3.0 IGO](https://creativecommons.org/licenses/by-nd/3.0/igo/),
separata dalla MIT del software. [Attribuzione e condizioni](../../../licenses/who-icd11/NOTICE.md).
L'inclusione non implica approvazione di MediFlow da parte della WHO.
