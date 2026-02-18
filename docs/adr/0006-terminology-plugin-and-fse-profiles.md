<!-- Codex: created 2026-02-18 -->
# ADR 0006: Terminology plugin unificato + profili documentali FSE/EDS

Date: 2026-02-18  
Status: Proposed

---

## Problema

MediFlow gestisce oggi codifiche con integrazioni verticali (ICD-11, AIC/esenzioni).
Per la compliance progressiva al Fascicolo Sanitario Elettronico 2.0 (EDS) servono
piu sistemi terminologici su documenti diversi, senza duplicare logica nei form
e senza rompere la parita web/native.

## Contesto

- Architettura local-first e zero-knowledge non negoziabile.
- Contratto condiviso via `/api/v1/*` (ADR 0005).
- Nessuna dipendenza cloud di default.
- Evoluzione incrementale, diff piccoli.

## Opzioni

1. Continuare con integrazioni ad-hoc per ogni modulo (form-specifiche).
2. Introdurre un layer "terminology plugin" unico con modello canonico coding +
   profili documentali FSE/EDS validabili localmente.
3. Adottare da subito un terminology server completo enterprise.

## Trade-off

- Opzione 1:
  - Pro: veloce nel brevissimo.
  - Contro: deriva tra web/native, duplicazione, difficile audit/compliance.
- Opzione 2:
  - Pro: scala meglio, mantiene coerenza, abilita validazione documentale esplicita.
  - Contro: richiede disciplina su modello e contratti API.
- Opzione 3:
  - Pro: massima copertura teorica.
  - Contro: complessita eccessiva per la fase attuale del progetto.

## Decisione

Proporre Opzione 2:

- `terminology plugin` locale per ogni sistema (ICD, AIC/ATC, LOINC, UCUM, SNOMED, CND),
- payload canonico unico per qualsiasi codice clinico,
- profili documentali FSE/EDS configurabili e validazione pre-export.

La decisione resta `Proposed` finche non viene approvata dal Lead Architect.

## Conseguenze

- Positivo: meno drift tra client, governance migliore delle codifiche, export piu robusto.
- Negativo: serve lavoro iniziale su astrazione e profiling documentale.
- Vincolo operativo: evitare rollout "big bang"; procedere per fasi.

## First Thin Slice

1. Rendere `ATC` first-class nei flussi terapia gia basati su `AIC`.
2. Aggiungere supporto `LOINC + UCUM` per un singolo percorso osservazioni (vitali).
3. Introdurre validatore locale su un profilo documentale pilota (`error` / `warning`).
4. Esporre il minimo contratto `/api/v1/terminology/*` necessario al pilot.

