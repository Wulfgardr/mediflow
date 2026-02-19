<!-- Codex: created 2026-02-19 -->
# Matrice Parity Web <-> macOS (Core)

Stato documento: CANONICAL (parity operativa web/native)  
Ultimo aggiornamento: 2026-02-19

---

## Obiettivo vincolante

Nei moduli core, web app e app macOS devono avere:

1. le stesse funzioni
2. gli stessi campi clinici rilevanti
3. la stessa flessibilita operativa
4. capacita di lavorare in modo indipendente (stesso DB condiviso, nessun storage duplicato)

Riferimenti:
- `docs/adr/0005-web-native-functional-parity.md`
- `docs/adr/0007-strict-web-native-parity-gate.md`
- `PLANS.md` (sezione 5 e 5a)

## Legenda

- `FULL`: allineato
- `PARTIAL`: parzialmente allineato
- `MISSING`: assente

---

## Baseline corrente (2026-02-19)

| Modulo core | Contratto `/api/v1` | Web UI | macOS UI | Parity campi | Parity flessibilita | Indipendenza macOS | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pazienti | FULL (GET/POST/PUT/DELETE) | FULL | PARTIAL (view/add + filtro ambulatorio) | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Diario clinico (entries) | FULL | PARTIAL (add + soft-delete/restore) | FULL (add/edit/delete + filtri) | PARTIAL | PARTIAL | FULL | PARTIAL |
| Terapie | FULL | FULL | PARTIAL (CRUD base, campi clinici ridotti) | PARTIAL | PARTIAL | FULL | PARTIAL |
| Appuntamenti (checkups) | FULL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Farmaci (catalogo/search) | FULL | FULL (search + import/clear) | PARTIAL (search) | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Esenzioni (catalogo + patient mapping) | FULL | FULL | MISSING (solo visualizzazione codici paziente) | MISSING | MISSING | MISSING | MISSING |

## Gap principali da chiudere

1. Pazienti su macOS: edit/delete/archive/search/sort e filtri stato.
2. Esenzioni su macOS: selector + search + save in create/update paziente.
3. Osservazioni su macOS: UI CRUD LOINC+UCUM gia presente a contratto.
4. Diario clinico: allineare semantica delete (soft delete + restore + reason) tra web e macOS.
5. Cataloghi farmaci/esenzioni: minima operabilita parity in Settings macOS.

## Regole di uscita (parity gate)

Un modulo core e considerato `FULL` solo se:

1. funzioni `view/add/edit/delete/filter` equivalenti nei due client
2. campi principali equivalenti in create/edit/detail
3. filtri/stati/ricerca/ordinamento equivalenti
4. workflow completabile end-to-end su entrambi i client
5. nessuna deviazione dati (stesso schema SQLite e stesso contratto `/api/v1`)
