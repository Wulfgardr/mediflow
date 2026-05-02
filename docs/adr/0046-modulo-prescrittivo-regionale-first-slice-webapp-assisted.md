# ADR 0046: Il primo step oltre l'handoff per il prescrittivo regionale e `webapp-assisted`, non UI custom

Date: 2026-04-15
Status: Accepted

## Problema

Dopo `WUL-180`, il primo target concreto oltre il `portal-handoff` e il
`Modulo Prescrittivo Regionale`.

Serve pero una decisione esplicita su quale forma debba avere la prima slice
realistica:

1. richiamo assistito della `web application` ufficiale
2. integrazione piu profonda con WS/API
3. ricostruzione di una UI prescrittiva interamente nativa a MediFlow

Senza questa decisione, il rischio e riaprire ogni volta la stessa ambiguita:
il backend SISS esiste, quindi "forse possiamo gia rifare il prescrittivo in
casa". Le fonti ufficiali raccolte non sostengono questa conclusione.

## Contesto

- La pagina `Ricetta Elettronica` conferma che la prescrizione e un servizio di
  piattaforma con regole centrali, NRE e ciclo prescrittivo/erogativo.
- `Modalita di accesso` e `A2A` chiariscono che l'accesso operatore dipende da
  credenziale SISS, contesto funzionale e canali distinti per `A2A` e
  `Web Application`.
- La pagina `A2A` specifica che `API Manager` permette di implementare webapp
  dell'Aderente che accedono ai WS del SISS senza integrare la `Porta
  Delegata` della PdL.
- Il catalogo documentale pubblico espone:
  - `Specifiche di integrazione Modulo Prescrittivo Regionale`
    (`ARIA-PRREG-SIAA@01`, `02/12/2025`)
  - `Manuale Utente Modulo Prescrittivo Regionale`
    (`CRS-FORM-MES#884`, `03/12/2025`)
  - `Credenziali API SISS` (`11/11/2024`)
- Le FAQ pubbliche mostrano che il modulo prescrittivo integrato con il SISS
  puo fungere anche da front-end per servizi come identificazione cittadino e
  classe di esenzione.

## Opzioni

1. Prima slice `webapp-assisted` basata sul percorso ufficiale del Modulo
   Prescrittivo Regionale.
2. Prima slice direttamente su WS/API SISS con UI MediFlow dedicata.
3. Prima slice come re-implementazione completa del prescrittivo in UI custom.

## Trade-off

- Opzione 1:
  - Pro: aderisce alla prova pubblica piu forte oggi disponibile.
  - Pro: minimizza il rischio di inventare logica prescrittiva fuori boundary.
  - Contro: non soddisfa ancora il desiderio di avere tutto davvero nativo in
    MediFlow.
- Opzione 2:
  - Pro: apre la strada a piu integrazione locale.
  - Contro: richiede dettagli scenario/API ancora non sufficientemente raccolti
    per partire senza ipotesi forti.
- Opzione 3:
  - Pro: massima ambizione di prodotto.
  - Contro: non e sostenuta dalle fonti raccolte; rischia di duplicare in modo
    non conforme il modulo ufficiale.

## Decisione

Adottiamo l'opzione 1.

Per MediFlow, la prima slice credibile oltre il `portal-handoff` sul
prescrittivo regionale e:

- `webapp-assisted official path`

Questo significa:

- MediFlow puo preparare il contesto paziente e l'coordinamento locale
- l'atto prescrittivo vero resta nel `Modulo Prescrittivo Regionale`
  ufficiale
- non trattiamo questa slice come `prescrittivo nativo MediFlow`
- non assumiamo prefill/embedding finche non emergono prove documentali
  esplicite

## Conseguenze

Positivo:

- il prossimo step runtime resta coerente con le fonti ufficiali
- riduciamo il rischio di spendere settimane su una UI custom non validabile
- manteniamo aperta la strada a WS/API solo dopo raccolta documentale piu
  precisa

Negativo:

- il prodotto non guadagna ancora una UX completamente nativa
- alcune ottimizzazioni desiderate restano subordinate a documentazione
  scenario-specific non ancora raccolta

## First Thin Slice

1. Documentare il boundary scenario-specific in
   [docs/siss-modulo-prescrittivo-regionale.md](../siss-modulo-prescrittivo-regionale.md).
2. Selezionare il richiamo ufficiale del modulo come target della prima issue
   runtime futura.
3. Bloccare esplicitamente:
   - re-implementazione integrale della UI prescrittiva
   - prefill spinto non documentato
   - uso improprio di WS/API fuori scenario approvato
