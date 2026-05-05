<!-- Codex: created 2026-03-16 -->
# ADR 0011: OCR-first con Qwen text-only e autofill prudente ICD da documenti

Date: 2026-03-16  
Status: Accepted

Update: la scelta del default text-only e stata aggiornata da `docs/adr/0013-qwen35-default-text-only-medgemma-specialist.md`; la pipeline OCR-first e l'autofill prudente ICD restano validi. La filiera OCR e stata poi precisata da [ADR 0059](./0059-macos-apple-vision-ocr-fallback.md): DeepSeek/Ollama resta OCR primario locale, con fallback Apple Vision certificato solo su macOS quando l'output primario e blank/low-signal.

---

## Problema

La strategia modelli AI ha gia deciso `DeepSeek OCR` per la lettura documentale e
`qwen2.5:32b` come default migliore per le superfici text-only, ma il flusso
documentale non traduce ancora questa decisione in un comportamento coerente e
clinicamente prudente:

- restano fallback/default legacy su `medgemma` per task clinici text-only
- i documenti caricati vengono sintetizzati, ma non producono un risultato
  strutturato utile per popolare la scheda paziente
- le codifiche ICD presenti nei documenti non confluiscono automaticamente nei
  campi del paziente, anche quando il codice e esplicito

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` impongono local-first, nessun egress cloud e
  logging PHI-safe.
- `WUL-49` e `WUL-69` hanno chiuso la decisione di benchmark: `qwen2.5:32b`
  resta il default raccomandato per il text-only; OCR separato.
- `WUL-64`, `WUL-61` e `WUL-57` richiedono pipeline OCR-first obbligatoria,
  document insights strutturati, uso delle codifiche ICD e refresh del contesto.
- Non vogliamo introdurre nuove tabelle o un mapping automatico aggressivo da
  testo libero a ICD senza evidenza sufficiente.

## Opzioni

1. Mantenere pipeline bifasica ma con sintesi libera e senza autofill strutturato.
2. Usare `DeepSeek OCR -> Qwen text-only` con output JSON strutturato e autofill
   solo per codici ICD esplicitamente presenti nel documento.
3. Tentare mapping automatico full-text -> ICD anche quando il documento non
   espone un codice esplicito.

## Trade-off

- Opzione 1:
  - Pro: diff minimo.
  - Contro: non risolve drift modelli e non abilita compilazione utile della scheda.
- Opzione 2:
  - Pro: coerente con benchmark, prudente sul piano clinico, diff piccolo,
    nessuna nuova tabella, riusa `documentInsights` e `patients.diagnoses`.
  - Contro: non copre diagnosi citate solo in testo libero senza codice.
- Opzione 3:
  - Pro: maggiore automazione percepita.
  - Contro: rischio clinico eccessivo, maggiore opacita e probabili falsi positivi.

## Decisione

Adottiamo l'opzione 2.

Regole operative:

- ogni documento passa prima da `DeepSeek OCR`/Ollama come OCR primario locale
- su macOS, output OCR blank/low-signal puo attivare fallback locale Apple
  Vision; Windows/Linux non hanno oggi un fallback platform-specific equivalente
  certificato in MediFlow
- la post-elaborazione clinica text-only usa `qwen2.5:32b` come default
- l'output documentale viene strutturato in `documentInsights` con:
  - summary
  - quality `green|yellow|red`
  - eventuali diagnosi ICD estratte
- l'autofill della scheda paziente e consentito solo per diagnosi con codice ICD
  esplicitamente presente nel testo OCR, con confidenza non bassa, e viene
  disattivato sui documenti `red`; il merge resta deduplicato su `patients.diagnoses`
- nessun mapping automatico da patologia free-text a nuovo codice ICD in questa fase

Decisione approvata dal Lead Architect il 2026-03-16.

## Conseguenze

- Positivo: unifica davvero il runtime text-only sul modello deciso.
- Positivo: rende i documenti caricati immediatamente utili per la scheda paziente.
- Positivo: mantiene una soglia prudente di affidabilita sul riempimento ICD.
- Negativo: diagnosi senza codice esplicito restano solo nel summary e non vengono
  autopopolate.
- Negativo: il quality triage in questa thin slice si basa sul testo OCR risultante,
  non ancora su metriche visive dedicate per pagina.

## First Thin Slice

1. Riallineare i default clinici text-only a `qwen2.5:32b` su web e macOS.
2. Far produrre a `lib/document-synthesis-service.ts` un JSON strutturato
   (`summary`, `quality`, `diagnoses`) invece di sola sintesi libera.
3. Salvare il risultato in `patients.documentInsights` e fondere in modo
   deduplicato le diagnosi ICD esplicite in `patients.diagnoses`.
4. Aggiornare `lib/ai-context.ts` e la UI documentale per mostrare qualita e ICD
   rilevati, cosi l'AI Patient Insight consumi davvero le nuove codifiche.
