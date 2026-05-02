<!-- Codex: created 2026-02-19 -->
# Matrice Parity Web <-> macOS (Core)

Stato documento: CANONICAL (parity operativa web/native)  
Ultimo aggiornamento: 2026-05-02

---

## Obiettivo vincolante

Nei moduli core, web app e app macOS devono avere:

1. le stesse funzioni
2. gli stessi campi clinici rilevanti
3. la stessa flessibilita operativa
4. capacita di lavorare in modo indipendente (stesso DB condiviso, nessun storage duplicato)

Riferimenti:
- [docs/adr/0005-web-native-functional-parity.md](./adr/0005-web-native-functional-parity.md)
- [docs/adr/0008-web-first-with-parity-sweeps.md](./adr/0008-web-first-with-parity-sweeps.md)
- [docs/adr/0009-native-testing-strategy-xcode-xctest.md](./adr/0009-native-testing-strategy-xcode-xctest.md)
- [PLANS.md](../PLANS.md) (sezione 5 e 5a)
- [docs/parity-smoke.md](./parity-smoke.md)
- [docs/parity-click-map-macos.md](./parity-click-map-macos.md)

## Cadenza operativa

- Modalita ordinaria: `web-first` (sviluppo principale sulla web app).
- Modalita convergenza: `parity sweep` dedicati su macOS.
- Regola: il gap puo esistere temporaneamente, ma deve essere tracciato qui e chiuso nelle wave di parity.

## Legenda

- `FULL`: allineato
- `PARTIAL`: parzialmente allineato
- `MISSING`: assente

---

## Baseline corrente (frozen native snapshot)

Il run strict `WUL-21` del 2026-05-02 ha validato la lane automatizzata
web+native (`web 2/2`, Xcode native `45/45`), ma non cambia gli stati modulo:
la click-map manuale `P6` non e stata eseguita e nessun modulo core e ancora
`FULL`. I residui restano tracciati in Linear sotto `WUL-23`, `WUL-24`,
`WUL-25`, `WUL-76` e `WUL-77`.

| Modulo core | Contratto `/api/v1` | Web UI | macOS UI | Parity campi | Parity flessibilita | Indipendenza macOS | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pazienti | FULL (GET/POST/PUT/DELETE) | FULL | PARTIAL (view/add/edit/delete/archive/search/sort + filtri stato) | PARTIAL (esenzioni in edit/create: P2) | FULL | FULL | PARTIAL |
| Diario clinico (entries) | FULL | PARTIAL (add + soft-delete/restore) | FULL (add/edit/delete + filtri) | PARTIAL | PARTIAL | FULL | PARTIAL |
| Terapie | FULL | FULL | PARTIAL (CRUD base, campi clinici ridotti) | PARTIAL | PARTIAL | FULL | PARTIAL |
| Appuntamenti (checkups) | FULL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Farmaci (catalogo/search) | FULL | FULL (search + import/clear) | PARTIAL (search) | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Esenzioni (catalogo + patient mapping) | FULL | FULL | PARTIAL (selector/search/save in create/edit; catalogo settings ancora mancante) | PARTIAL | PARTIAL | PARTIAL | PARTIAL |

## Gap principali da chiudere

1. Pazienti su macOS: consolidare smoke VM sulle nuove azioni `edit/delete/archive` e toolbar/context-menu (checklist: `docs/parity-click-map-macos.md`).
2. Esenzioni su macOS: completare il catalogo in Settings e la gestione operativa del catalogo stesso.
3. Osservazioni su macOS: UI CRUD LOINC+UCUM gia presente a contratto.
4. Diario clinico: allineare semantica delete (soft delete + restore + reason) tra web e macOS.
5. Cataloghi farmaci/esenzioni: minima operabilita parity in Settings macOS, con esenzioni patient mapping gia attivo ma catalogo ancora da chiudere.

## Regole di uscita (parity gate)

Un modulo core e considerato `FULL` solo se:

1. funzioni `view/add/edit/delete/filter` equivalenti nei due client
2. campi principali equivalenti in create/edit/detail
3. filtri/stati/ricerca/ordinamento equivalenti
4. workflow completabile end-to-end su entrambi i client
5. nessuna deviazione dati (stesso schema SQLite e stesso contratto `/api/v1`)
