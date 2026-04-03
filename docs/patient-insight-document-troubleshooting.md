> [!IMPORTANT]
> **Stato documento: SECONDARY (runbook operativo locale).**
> Questa nota non cambia le policy canoniche di `AI Patient Insight`.
> Le decisioni normative restano in [docs/adr/0018-ai-insight-full-auto-and-pro-settings.md](./adr/0018-ai-insight-full-auto-and-pro-settings.md),
> [docs/adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md](./adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md)
> e [docs/ai-rollout-governance.md](./ai-rollout-governance.md).

# Runbook troubleshooting documentale di `AI Patient Insight`

Ultimo aggiornamento: 2026-04-03

## Scopo

Fissare la procedura minima per diagnosticare e recuperare i casi in cui
`AI Patient Insight` non incorpora correttamente:

- note del diario clinico
- documenti allegati alla visita
- follow-up o segnali riabilitativi presenti nel PDF/OCR sorgente

Questa nota nasce da un failure mode reale osservato il 2026-04-03 su un caso
locale, ma il runbook resta generico e non contiene dati paziente.

Riferimenti:

- [SECURITY.md](../SECURITY.md)
- [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md)
- [docs/patient-insight-benchmark.md](./patient-insight-benchmark.md)
- [docs/ai-rollout-governance.md](./ai-rollout-governance.md)

## Sintomi tipici

- la card `Insight clinico AI` mostra un fallback degradato o troppo generico
- il follow-up post-dimissione o riabilitativo non compare nell'insight finale
- il documento allegato esiste, ma non sembra contribuire al contesto
- il diario clinico recente e visibile in UI, ma viene oscurato da fonti piu
  deboli o da testo documentale povero

## Failure mode da controllare prima

### 1. Snapshot documentale povero o assente

Segnali:

- `patient.documentInsights` vuoto o poco informativo
- `attachment.summarySnapshot` generico o non clinico

Effetto pratico:

- il builder usa poco o male il documento allegato
- il budget prompt viene consumato da testo a basso segnale

### 2. OCR o testo documento appiattito in una singola riga

Segnali:

- il file contiene testo, ma l'excerpt persistito e quasi inutilizzabile
- sezioni cliniche come follow-up, FKT, riabilitazione o deambulazione non
  emergono nel summary

Effetto pratico:

- il documento non entra nel contesto con la priorita giusta

### 3. Evidence pack sbilanciato

Segnali:

- nel rendering contestuale sopravvivono soprattutto farmaci o frammenti poco
  rilevanti
- follow-up e stato funzionale spariscono quando il budget e stretto

Effetto pratico:

- il modello riceve contesto incompleto anche se l'estrazione documentale esiste

### 4. Guardrail nomi troppo aggressivo

Segnali:

- l'insight viene declassato pur avendo contenuto clinico coerente
- compaiono bigrammi che sembrano nomi ma in realta sono accoppiate
  farmaco/azione o heading/azione clinica

Effetto pratico:

- il render finale puo retrocedere a fallback o perdere contenuto utile

### 5. Drift del modello clinico locale

Segnali:

- il badge UI `Clinico:` non mostra il baseline documentato
- l'insight peggiora dopo rigenerazione anche se il contesto e stato riparato

Effetto pratico:

- si confonde un problema di configurazione runtime con un problema documentale

Baseline attesa oggi:

- `qwen3.5:35b-a3b` per la lane `clinical`

## Diagnosi minima consigliata

Ordine operativo:

1. verificare se il fallback e visibile nella card `Insight clinico AI`
2. verificare se il documento allegato ha testo locale realmente estraibile
3. ispezionare `documentInsights` e `summarySnapshot` per capire se il problema
   e nel file o nella persistenza
4. controllare che il rendering documentale preservi follow-up e stato
   funzionale
5. controllare il modello attivo della lane `clinical`

Se il PDF ha testo buono ma `documentInsights` e povero, il problema e quasi
sempre nel path di persistenza o nel packing del contesto, non nel documento.

## Procedura di recovery locale

### 1. Backup prima di scrivere

- creare un backup del file SQLite locale
- non lavorare mai sul caso reale senza un punto di ripristino
- non committare mai backup o dati paziente nel repo

### 2. Verificare il documento sorgente

- controllare che il PDF allegato abbia testo estraibile localmente
- se il file e solo immagine, verificare il path OCR locale prima di attribuire
  il problema a `Patient Insight`

### 3. Riparare il contesto documentale

Se il codice corrente e gia aggiornato:

- lasciare che `lib/ai-context.ts` tenti il fallback da file locale quando
  `summarySnapshot` e low-signal

Se il dato persistito e gia degradato:

- rigenerare excerpt, summary e evidence pack del documento a partire dal file
  sorgente locale
- riscrivere `attachment.summarySnapshot` solo dopo avere verificato che il
  nuovo testo sia clinicamente utile
- aggiornare `patient.documentInsights` con il nuovo estratto

### 4. Rigenerare `ai_summary`

- rigenerare l'insight solo dopo il repair documentale
- usare la baseline clinica prevista, non un challenger o un modello locale
  degradato

### 5. Verificare la resa finale in UI

Controlli minimi:

- la card `Insight clinico AI` non deve mostrare il fallback degradato
- devono comparire sezioni strutturate come `Quadro Clinico`,
  `Attenzioni`, `Prossimi passi`
- il badge `Clinico:` deve riflettere il modello atteso
- i segnali documentali chiave devono essere tornati visibili
  (es. follow-up, riabilitazione, deambulazione, post-dimissione)

## Guardrail per non riaprire il problema

- mantenere test dedicati per:
  - fallback da allegato low-signal
  - segmentazione OCR-like single-line
  - evidence pack con priorita a follow-up e stato funzionale
  - falsi positivi del guardrail nomi su azioni cliniche
- mantenere almeno un controllo UI/E2E che verifichi il render strutturato
  dell'insight senza fallback
- trattare i repair di casi reali come operazioni locali fuori Git, ma fissare
  sempre in repo il failure mode e la regressione sintetica

## Quando fermarsi

Interrompere il recovery e non scrivere dati se:

- il documento sorgente non e leggibile localmente
- non esiste backup del DB
- la lane `clinical` e su un modello non validato e non puoi riallinearla
- il caso richiede inferenze oltre le fonti locali disponibili

In questi casi:

- preservare il dato sorgente
- non forzare un insight "best effort"
- rientrare su benchmark sintetici o su repair infrastrutturale prima di
  toccare di nuovo il caso reale
