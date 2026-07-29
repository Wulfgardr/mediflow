# ADR 0018: AI Patient Insight full-auto e manual Pro

Date: 2026-03-18
Status: Accepted

## Problema

L'insight clinico sintetico usa oggi budget fissi per documenti e output del
modello. Questo rende difficile adattare il comportamento a:

- macchine molto diverse tra loro
- pazienti con contesto documentale semplice vs denso
- casi in cui l'operatore vuole piu controllo sul budget dell'insight

Il branch storico `WUL-66` contiene pero anche cambi stacked su upload
documenti, OCR e guardrail gia evoluti altrove, quindi non e landabile
integralmente su `main`.

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` richiedono diff piccoli, local-first e
  nessuna espansione non necessaria delle superfici AI.
- `docs/adr/0013-qwen35-default-text-only-medgemma-specialist.md` fissa il
  modello text-only di default, ma non governa il budget dell'insight.
- `docs/adr/0012-operator-reviewed-smart-import-from-patient-context.md`
  mantiene separata la pipeline reviewable di import da qualunque tuning
  automatico dell'insight.
- `WUL-84` ha gia rifinito provenance e diagnostics dell'insight; questa slice
  non deve regredire quella pipeline.

## Opzioni

1. Lasciare budget fissi hardcoded.
2. Portare su `main` il branch storico `WUL-66` quasi per intero.
3. Estrarre una thin slice autonoma: persistence settings + UI settings +
   applicazione minima dei budget nel builder dell'insight.

## Trade-off

- Opzione 1:
  - Pro: zero rischio di integrazione.
  - Contro: nessun controllo operativo e nessun adattamento al contesto.
- Opzione 2:
  - Pro: recupera tutto il lavoro storico in una volta.
  - Contro: diff troppo largo, stacked, con rischio alto di reintrodurre
    vecchie assunzioni su document-upload/OCR gia cambiate.
- Opzione 3:
  - Pro: diff piccolo, reviewabile, compatibile con `main` corrente.
  - Contro: non copre ancora follow-up su upload automatico o policy OCR.

## Decisione

Adottiamo l'opzione 3.

Introduciamo un layer dedicato `lib/ai-insight-settings.ts` che definisce:

- modalita `full_auto`, `balanced`, `complete`, `manual`
- configurazione manuale sanitizzata
- risoluzione runtime in base a profilo hardware e complessita del caso
- persistenza su `settings`

Il nome tecnico `full_auto` riguarda solo la scelta automatica dei budget di
contesto e generazione. Non autorizza diagnosi, prescrizioni o altre scritture
cliniche automatiche.

La UI web in `app/settings/page.tsx` espone i controlli dell'insight senza
toccare pipeline OCR o upload.

Il runtime dell'insight applica solo questi budget minimi:

- numero massimo di documenti inclusi
- caratteri massimi per summary documentale
- budget complessivo di contesto documentale
- `outputMaxTokens` passato al modello

## Esplicitamente fuori scope

Questa ADR non introduce:

- automazioni di refresh dopo upload
- nuovi limiti OCR per pagina o per allegato
- cambi al contratto `/api/v1`
- regressioni o riscritture della provenance/diagnostics gia atterrate

I follow-up futuri su document pipeline restano separati.

## Conseguenze

- Positivo: l'operatore ha un controllo esplicito e persistente sul costo
  dell'insight.
- Positivo: il full-auto resta semplice e usa il profilo macchina gia presente.
- Positivo: il delta su `main` resta piccolo e non reintroduce codice stacked.
- Negativo: il tuning agisce solo sul builder/generazione insight e non ancora
  su tutta la pipeline documentale.

## First Thin Slice

1. Aggiungere `lib/ai-insight-settings.ts` con preset, sanitizzazione e
   persistence.
2. Esporre la UI minimale in `app/settings/page.tsx`.
3. Applicare i budget a `lib/ai-context.ts` e `lib/ai-summary-service.ts`.
4. Coprire il layer puro con test isolati senza coinvolgere Dexie o upload OCR.
