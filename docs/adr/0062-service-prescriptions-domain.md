# ADR 0062: Dominio prescrizioni prestazioni separato dalle terapie

Date: 2026-05-21
Status: Proposed

Related: [ADR 0051](./0051-patient-import-decision-contract-between-review-and-persistence.md),
[ADR 0057](./0057-local-evidence-absorption-layer.md),
[ADR 0046](./0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md)

## Problema

Document Ops puo incontrare prescrizioni codificate di specialistica,
laboratorio, imaging o riabilitazione dentro impegnative e referti. Quando
queste voci finiscono in `therapies`, MediFlow le presenta come terapia
farmacologica, con campi e azioni sbagliate.

Serve un dominio persistente dedicato, review-first e codificabile, che
assorba queste informazioni senza confonderle con farmaci, AIC/ATC, posologia
o piano terapeutico.

## Opzioni

1. Continuare a bloccare queste voci nella review documentale senza persisterle.
2. Estendere `therapies` con un sottotipo non farmacologico.
3. Creare `service_prescriptions` come dominio paziente separato.

## Trade-off

- Opzione 1:
  - Pro: minimo cambiamento dati.
  - Contro: perde la tracciabilita operativa dopo la review.
- Opzione 2:
  - Pro: riusa UI e query esistenti.
  - Contro: mantiene l'ambiguita clinica e rende fragili export, filtri e
    bonifiche.
- Opzione 3:
  - Pro: separa chiaramente farmaci e prestazioni, consente codifica,
    matching futuro dalle impegnative e bonifica del legacy.
  - Contro: richiede nuova tabella, API, backup e superficie UI dedicata.

## Decisione

Adottiamo l'opzione 3.

MediFlow introduce `service_prescriptions` per visite, esami, imaging,
riabilitazione, screening e procedure prescritte. Il dominio e paziente-scoped,
cifrato lato client per i campi clinici, incluso nel backup locale, e resta
distinto da:

- `therapies`, che conserva solo terapia farmacologica o piano terapeutico
  farmacologico;
- `prosthetic_prescriptions`, che resta il diario protesica/ausili;
- route SISS/FSE prescrittive certificate, che non vengono simulate da questa
  slice.

La prima implementazione non genera NRE, non invia impegnative e non dichiara
integrazione SISS nativa. Le voci da documento entrano come dati reviewable o
come bonifica legacy esplicita, con `source` distinto.

## First Thin Slice

1. Aggiungere schema SQLite, migrazione, runtime guard, client API cifrato e
   CRUD web session-protected.
2. Aggiungere un pannello UI dedicato nella scheda paziente, vicino ma non
   dentro le terapie.
3. Preparare mapping documentale e bonifica legacy dalle righe terapia
   chiaramente non farmacologiche.
4. Includere il dominio nel backup v1 e nei test di contratto.
5. Lasciare il matching repertorio prestazioni come evoluzione successiva,
   guidata dalla lista codificata fornita da Leonardo.

## Fuori Scope

- Prescrizione regionale certificata o invio SISS/FSE.
- Matching automatico completo senza repertorio verificato.
- Migrazione automatica di righe ambigue o farmaci importati male.
- Esposizione `/api/v1` per client paired prima di un contratto nativo
  dedicato.
