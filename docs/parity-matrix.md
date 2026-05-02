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
`FULL`. Le esenzioni in create/edit paziente risultano code-satisfied in
`WUL-22`, la semantica delete del diario e stata riallineata in `WUL-24`, le
osservazioni native LOINC/UCUM risultano code-satisfied in `WUL-23` e i
cataloghi farmaci/esenzioni sono ora operabili da Settings macOS in `WUL-25`.

| Modulo core | Contratto `/api/v1` | Web UI | macOS UI | Parity campi | Parity flessibilita | Indipendenza macOS | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pazienti | FULL (GET/POST/PUT/DELETE) | FULL | PARTIAL (view/add/edit/delete/archive/search/sort + filtri stato + esenzioni create/edit code-satisfied) | PARTIAL (click-map P6 non ancora eseguita) | FULL | FULL | PARTIAL |
| Diario clinico (entries) | FULL | PARTIAL (add + soft-delete/restore) | FULL (add/edit/soft-delete/restore + filtri eliminati) | PARTIAL | PARTIAL | FULL | PARTIAL |
| Terapie | FULL | FULL | PARTIAL (CRUD base, campi clinici ridotti) | PARTIAL | PARTIAL | FULL | PARTIAL |
| Appuntamenti (checkups) | FULL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Farmaci (catalogo/search) | FULL | FULL (search + import/clear) | FULL (search + status/import JSON/clear in Settings) | PARTIAL (click-map P6 non ancora eseguita) | FULL | FULL | PARTIAL |
| Esenzioni (catalogo + patient mapping) | FULL | FULL | FULL (patient mapping create/edit + status/import JSON/clear in Settings) | PARTIAL (click-map P6 non ancora eseguita) | FULL | FULL | PARTIAL |

## Gap principali da chiudere

2. Terapie e checkups/appuntamenti restano i gap modulo-specifici principali prima della chiusura parity formale.

## Regole di uscita (parity gate)

Un modulo core e considerato `FULL` solo se:

1. funzioni `view/add/edit/delete/filter` equivalenti nei due client
2. campi principali equivalenti in create/edit/detail
3. filtri/stati/ricerca/ordinamento equivalenti
4. workflow completabile end-to-end su entrambi i client
5. nessuna deviazione dati (stesso schema SQLite e stesso contratto `/api/v1`)
