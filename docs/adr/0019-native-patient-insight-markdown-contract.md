<!-- Codex: created 2026-03-18 -->
# ADR 0019: Native patient insight con contratto markdown compatibile

Date: 2026-03-18
Status: Accepted

## Problema

La lane `WUL-85` richiede di generare e salvare `AI Patient Insight` dal client
macOS sbloccato, con provenance locale. Il branch storico stacked salva pero un
envelope JSON raw in `patients.aiSummary`, mentre `main` lato web legge oggi
ancora markdown con sezioni diagnostiche e citazioni.

## Opzioni

1. Salvare JSON raw in `aiSummary` anche dal native.
2. Rinviare il salvataggio native finche web e native non condividono lo stesso envelope.
3. Generare l'insight sul client native, validare le citazioni locali e
   persistere markdown compatibile con il contratto attuale del web.

## Trade-off

- Opzione 1:
  - Pro: recupera piu fedelmente il branch storico.
  - Contro: rompe il consumer web attuale o richiede un merge stacked piu largo.
- Opzione 2:
  - Pro: zero rischio di contratto.
  - Contro: non chiude `WUL-85`.
- Opzione 3:
  - Pro: thin slice landabile, local-first, compatibile con `main`.
  - Contro: l'envelope strutturato resta solo transiente nel client per questa fase.

## Decisione

Adottiamo l'opzione 3.

Il client macOS genera l'insight da contesto locale sbloccato, usa solo fonti
`Sx` esplicitate nel prompt, normalizza l'output e salva in `aiSummary`
markdown con sezioni e citazioni compatibili col parser web corrente.

## First Thin Slice

1. Allineare il modello native a `diagnoses` e `monitoringProfile`.
2. Arricchire il prompt native con fonti locali `Sx`, mantenendo il contratto
   markdown gia letto dal web.
3. Collegare `PatientDetailView` a `Generate and save insight` con cifratura
   locale e `PUT /api/v1/patients/:id`.
4. Coprire decode del contratto `/api/v1` e salvataggio payload con test XCTest
   isolati.
