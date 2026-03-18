<!-- Codex: created 2026-03-18 -->
# ADR 0020: AI insight source hierarchy and conflict rules

Date: 2026-03-18
Status: Accepted

## Problema

`AI Patient Insight` su `main` applica gia una gerarchia implicita delle fonti
e un fallback prudente, ma la decisione non e ancora fissata in un documento
canonico. Questo lascia ambigui due punti critici:

- quale fonte prevale quando dati strutturati e documenti OCR divergono
- quando l'output deve essere declassato o marcato come incompleto

Per un sistema local-first clinico, la regola deve vivere su disco e non solo
nel codice di `lib/ai-context.ts`, `lib/patient-insight.ts` e
`lib/ai-summary-service.ts`.

## Opzioni

1. Lasciare la gerarchia implicita nel codice.
2. Documentare la regola solo in `PLANS.md` o note operative.
3. Formalizzare la gerarchia e le regole di conflitto in un ADR canonico.

## Trade-off

- Opzione 1:
  - Pro: nessun lavoro documentale aggiuntivo.
  - Contro: review e manutenzione piu fragili; rischio di drift tra builder e UI.
- Opzione 2:
  - Pro: piu veloce di un ADR.
  - Contro: non e una source of truth stabile per una decisione architetturale.
- Opzione 3:
  - Pro: rende espliciti priorita delle fonti, fallback e criteri di conflitto.
  - Contro: richiede disciplina di manutenzione quando il builder evolve.

## Decisione

Adottiamo l'opzione 3.

`AI Patient Insight` deve applicare in modo deterministico questa gerarchia:

1. Scheda clinica strutturata del paziente.
2. Codifiche cliniche e classificazioni (`ICD`, esenzioni, stato strutturato).
3. Terapie, checkup, osservazioni e timeline clinica recente.
4. Documentazione extra sintetizzata/OCR come supporto, mai come fonte primaria.

Regole di conflitto:

- se due fonti divergono, prevale la fonte di livello piu alto
- il conflitto va esposto come limite o incertezza, non risolto inventando dati
- claim non supportati direttamente devono essere marcati come incompleti
- note narrative contaminate o nominalmente sospette non devono alimentare il prompt

## First Thin Slice

1. Fissare questa decisione in ADR.
2. Mantenere allineati `lib/ai-context.ts`, `lib/patient-insight.ts` e
   `lib/ai-summary-service.ts` a questa gerarchia.
3. Usare `docs/README.md` e `docs/markdown-index.md` come puntatori canonici.
