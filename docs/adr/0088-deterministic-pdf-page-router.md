# ADR 0088: router deterministico per pagina dei PDF

Date: 2026-08-06
Status: Accepted

Issue: WUL-412

## Problema

La pipeline PDF selezionava euristicamente fino a sei pagine e avviava OCR
anche quando tutto il documento aveva un text layer utile. Nei documenti misti
il testo nativo poteva inoltre nascondere una pagina scansionata.

## Decisione

`@firecrawl/pdf-inspector` 1.12.0 entra come pre-parser locale e
deterministico. L'unica autorita di routing e l'esito `needsOcr` di ciascuna
pagina restituita da `extractPagesMarkdown`; il classificatore globale e il
campo aggregato `pagesNeedingOcr` upstream non sono usati.

Il parser gira in un processo Node figlio, senza rete, con limiti di input,
output, tempo, memoria residente, concorrenza e numero di pagine. L'API restituisce testo nativo completo,
pagine OCR 1-indexed e stato `native`, `mixed` o `ocr_required`.

- `native`: nessun OCR;
- `mixed`: OCR solo delle pagine indicate, entro il limite esistente;
- `ocr_required`: OCR locale secondo la policy corrente;
- errore, cifratura o limite: fallimento esplicito, senza fallback cloud.

Le cause `parser_failed` e `resource_limit` restano distinte nella coda di
review host/web e non vengono riclassificate come semplice assenza di text
layer. Il boundary paired v1 le redige a `null`, già ammesso dal contratto,
finché una futura versione API non estenderà esplicitamente l'enum pubblico.

DeepSeek/Ollama resta un provider OCR locale separato. Il router decide *dove*
serve OCR; non sostituisce il modello né autorizza scritture cliniche.

## Evidenza di adozione

Il corpus sintetico italiano WUL-412 copre PDF nativi, scansioni, documenti
misti, scansione tardiva, text overlay, pagine vuote e taglie da 2 a 75 pagine.
Il gate richiede zero omissioni OCR per-pagina, struttura nativa preservata,
fallimento chiuso su input corrotti/protetti e test reali del processo isolato.

## Conseguenze e limiti

- I PDF nativi evitano rendering e OCR, riducendo latenza e uso del modello.
- I PDF misti conservano il testo nativo e renderizzano solo pagine candidate.
- Un falso positivo OCR e accettabile; un falso negativo non lo e.
- Il corpus sintetico non dimostra superiorita clinica o sostituzione di
  DeepSeek OCR 2. Il runtime locale rilevato nel benchmark e `deepseek-ocr` v1.
- WASM non entra nel runtime; l'integrazione usa il binding nativo supportato.
- Su macOS Intel, per cui upstream non pubblica un binding x64, resta attivo il
  fallback PDF.js per-pagina già supportato; il packaging ne verifica la presenza.

## Regole di arresto

Fermare o ripristinare il router se compare una omissione OCR, se il processo
non rispetta i limiti, se il binding apre egress, se la build multipiattaforma
non include il binario richiesto o se una pagina documentale viene applicata
automaticamente a dati clinici.
