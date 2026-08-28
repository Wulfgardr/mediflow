# ADR 0107: AnyDoc come estrazione locale unica degli allegati

Date: 2026-08-28
Status: Proposed

Issue: WUL-522
Program line: candidato `0.8.5`

Supersedes, per il percorso di estrazione documentale:
[ADR 0011](./0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md),
[ADR 0059](./0059-macos-apple-vision-ocr-fallback.md),
[ADR 0077](./0077-ai-provider-abstraction-and-egress-anonymization-boundary.md) e
[ADR 0088](./0088-deterministic-pdf-page-router.md).

Related: [ADR 0084](./0084-document-diagnoses-review-only.md),
[ADR 0086](./0086-intelligent-scaffold-and-graded-automation-boundary.md),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md) e
[ADR 0099](./0099-ocr-document-locator-and-source-currentness.md).

## Problema

La filiera corrente divide la lettura degli allegati fra text layer PDF,
DeepSeek OCR via Ollama e fallback Apple Vision. Questo rende il comportamento
dipendente dal formato, dal sistema operativo e dalla disponibilita di un
provider vision. Gli allegati Office e OpenDocument non attraversano una
corsia unica.

MediFlow richiede invece un solo ingresso locale e deterministico per gli
allegati. Il risultato deve alimentare i consumer review-only esistenti senza
trasformare un parser in autorita clinica.

## Decisione

`@firecrawl/anydoc` diventa l'unica corsia automatica di estrazione locale.
La dipendenza resta fissata a una versione esatta e gira in un processo figlio
bounded. Il runtime usa soltanto la conversione locale a Markdown e non passa
mai l'opzione `ocr: 'hosted'`.

La corsia accetta i formati supportati localmente da AnyDoc:

- Word: `.doc`, `.docx`, `.docm`;
- PowerPoint: `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm`;
- Excel: `.xls`, `.xlsx`, `.xlsm`, `.xlsb`;
- OpenDocument: `.odt`, `.ods`, `.odp`;
- RTF, EPUB, CSV e PDF.

Il formato viene rilevato dai byte. L'estensione viene usata soltanto per i
formati senza firma, come CSV. Nome, MIME type e dati del chiamante non
autorizzano un formato o un consumer.

La sequenza e:

```text
attachment corrente -> AnyDoc locale -> Markdown normalizzato
-> evidenza e provenance -> sintesi e candidati review-only
-> eventuale gesto applicativo separato
```

AnyDoc estrae e struttura il contenuto. Non assegna codici ICD, non decide
terapie, ausili o protesi e non scrive note cliniche. Questi restano output
candidati dei servizi downstream, legati alla fonte e soggetti a revisione.

## Sostituzione della corsia OCR

DeepSeek/Ollama OCR e Apple Vision vengono rimossi dal flusso automatico degli
allegati. Non esiste fallback provider, platform-specific o hosted. La route
OCR legacy viene deprecata e non puo invocare un modello.

AnyDoc non esegue OCR locale. Un'immagine o un PDF con pagine scansionate prive
di text layer fallisce chiuso come
`review_required/unsupported_local_extraction`. Lo stesso vale per documenti
cifrati, formati non supportati, input malformati o limiti di risorsa. Nessuna
sintesi o proposta clinica viene prodotta da un contenuto incompleto.

## Localita e sicurezza

- Nessun documento o suo estratto esce dal nodo locale.
- Il runtime non usa Firecrawl Parse, API key, browser remoto o rete.
- Il worker applica limiti di byte, tempo e output e restituisce errori
  tipizzati senza percorsi, testo clinico o payload nei log.
- Il testo estratto e input non fidato. Resta soggetto a normalizzazione,
  provenance e guardrail clinici.
- Test e fixture usano soltanto dati sintetici.

La currentness di ADR 0099 resta invariata. AnyDoc consuma solo i byte della
sorgente host-owned corrente. Non introduce locator, hash o versioni forniti
dal chiamante e non modifica schema, CAS, backup o durable store.

## Compatibilita e migrazione

I campi e gli stati legacy con nome `ocr*` possono restare temporaneamente nel
contratto persistente per compatibilita. Non provano che un OCR sia stato
eseguito. I nuovi esiti applicativi usano `local_extraction` e
`unsupported_local_extraction`; una rinomina persistente richiede un packet di
schema separato.

Gli artifact gia prodotti da DeepSeek o Apple Vision restano evidenza storica
immutabile. Non vengono rigenerati, reinterpretati o usati come prova della
nuova estrazione.

## Conseguenze

- Tutti i formati supportati attraversano lo stesso parser locale.
- I documenti digitali non dipendono da Ollama o da un modello vision.
- Le scansioni e le immagini richiedono revisione manuale finche un futuro ADR
  non approva un OCR locale distinto.
- Windows, Linux e macOS condividono lo stesso contratto di estrazione.
- La processazione downstream resta provenance-bound, review-only e zero-write.

## First thin slice

1. Introdurre il contratto e il worker AnyDoc bounded con errori tipizzati.
2. Aggiungere una route locale autenticata per la conversione degli allegati.
3. Collegare upload, import paziente e contesto AI alla nuova corsia.
4. Disabilitare la route OCR legacy e rimuovere i richiami automatici a
   DeepSeek, Ollama e Apple Vision.
5. Verificare PDF nativo, DOCX, XLSX, CSV e fallimento chiuso per immagine,
   PDF scansionato, file cifrato, input malformato e limite di risorsa.

## Regole di arresto

Fermare il packet se:

- compare `ocr: 'hosted'`, una API key o una richiesta di rete;
- una scansione viene trattata come documento completo;
- un errore produce sintesi o candidati clinici;
- l'output del parser scrive direttamente dati clinici;
- currentness, provenance o revisione vengono aggirate;
- il worker espone percorso, contenuto o identificatori clinici nei log;
- la modifica richiede schema, CAS, backup, security condivisa o durable store.

## Non-obiettivi

Questo ADR non aggiunge OCR locale per immagini, egress, cloud, apply clinico,
schema, migrazioni, route paired, locator, CAS, backup o nuove authority.
