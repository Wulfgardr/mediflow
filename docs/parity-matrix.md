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
- [docs/apple-wide-parity-qa.md](./apple-wide-parity-qa.md)
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
`FULL`. Le esenzioni in create/edit paziente risultano code-satisfied in
`WUL-22`, la semantica delete del diario e stata riallineata in `WUL-24`, le
osservazioni native LOINC/UCUM risultano code-satisfied in `WUL-23` e i
cataloghi farmaci/esenzioni sono ora operabili da Settings macOS in `WUL-25`.
La parita campi/flex delle terapie native e code-satisfied in `WUL-76`.
La parita campi/flex dei checkups/appuntamenti nativi e code-satisfied in
`WUL-77`.

Il closeout `WUL-26` del 2026-05-02 ha rieseguito lo strict smoke automatizzato
post-moduli con esito `PASS` (`web PASS`, `native xcode PASS`) in
`tmp-parity-smoke/wul-26-20260502-post-module-closeout-rerun/summary.md`.
Questo chiude la track legacy come evidenza documentale/code-satisfied, non come
dichiarazione di UI parity piena del vecchio bundle macOS. Il primo slice
`WUL-192` sposta l'entrypoint compilato su Apple Foundation/home-base e aggiunge
osservabilita runtime, supervisione app-managed di backend/proxy e packaging
firmabile; non riapre la vecchia shell clinica come UI ufficiale. La verifica
capability-by-capability Apple-wide parte da
[docs/apple-wide-parity-qa.md](./apple-wide-parity-qa.md) e dal manifest
`docs/apple-wide-qa-manifest.json` (`WUL-194`).

| Modulo core | Contratto `/api/v1` | Web UI | macOS UI | Parity campi | Parity flessibilita | Indipendenza macOS | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pazienti | FULL (GET/POST/PUT/DELETE) | FULL | PARTIAL (view/add/edit/delete/archive/search/sort + filtri stato + esenzioni create/edit code-satisfied) | PARTIAL (click-map P6 non ancora eseguita) | FULL | FULL | PARTIAL |
| Diario clinico (entries) | FULL | PARTIAL (add + soft-delete/restore) | FULL (add/edit/soft-delete/restore + filtri eliminati) | PARTIAL | PARTIAL | FULL | PARTIAL |
| Terapie | FULL | FULL | FULL (CRUD + AIFA/manuale, principio attivo, motivazione, indicazione, date/stato) | PARTIAL (click-map P6 non ancora eseguita) | FULL | FULL | PARTIAL |
| Appuntamenti (checkups) | FULL | PARTIAL (form paziente con date/title/notes/status/source manuale) | FULL (CRUD + note operative, status, source manuale, metadata contratto) | PARTIAL (click-map P6 non ancora eseguita) | FULL | FULL | PARTIAL |
| Farmaci (catalogo/search) | FULL | FULL (search + import/clear) | FULL (search + status/import JSON/clear in Settings) | PARTIAL (click-map P6 non ancora eseguita) | FULL | FULL | PARTIAL |
| Esenzioni (catalogo + patient mapping) | FULL | FULL | FULL (patient mapping create/edit + status/import JSON/clear in Settings) | PARTIAL (click-map P6 non ancora eseguita) | FULL | FULL | PARTIAL |

### Runtime home-base Apple

`WUL-192` introduce una prima superficie osservabile nel bundle macOS:

- finestra primaria Apple Foundation/home-base invece del prototipo oncologico;
- pannello runtime con config nativa, presenza token, PID backend/proxy,
  modalita rete, fingerprint TLS e start/stop esplicito di backend web
  production + proxy TLS inclusi nel bundle, con stop bounded/escalation;
- health diagnostico read-only per Ollama e Docker/ICD se gia attivi, senza
  installazione, avvio, arresto o supervisione app-managed.

Questa non modifica gli stati dei moduli core nella tabella legacy: e la base
per la track Apple-wide successiva, non una nuova certificazione di parity UI.

## QA Apple-wide (WUL-194)

La matrice legacy sopra resta la fonte per il vecchio confronto web/macOS core.
Dal momento in cui il bundle macOS usa il shell Apple/home-base, la promessa
Apple-wide si verifica invece con una matrice separata:

- documento canonico: [docs/apple-wide-parity-qa.md](./apple-wide-parity-qa.md)
- manifest machine-readable: `docs/apple-wide-qa-manifest.json`
- guard: `npm run check:apple-wide-qa`

La matrice Apple-wide distingue esplicitamente capability `covered` con
comando/runbook ripetibile, gap `WUL-193` per CRUD UI mobile e cache/offline, e
click-map `WUL-194` coperto sulle superfici oggi disponibili: macOS home-base
shell, smoke mobile paired e write paired non-AI.

Nessuna riga `covered` nella matrice Apple-wide equivale da sola a parity piena
del prodotto.

## Gap principali da chiudere

1. Nessun gap modulo-specifico legacy resta aperto nella track `WUL-75`: pazienti, esenzioni, osservazioni, diario, cataloghi, terapie e checkups sono code-satisfied sui rispettivi thin slice.
2. La parity UI piena non va dichiarata sul bundle macOS corrente finche l'entrypoint compilato non torna a una shell clinica MediFlow. Questo lavoro passa alla track Apple-native/home-base (`WUL-187`/`WUL-194`).

## Regole di uscita (parity gate)

Un modulo core e considerato `FULL` solo se:

1. funzioni `view/add/edit/delete/filter` equivalenti nei due client
2. campi principali equivalenti in create/edit/detail
3. filtri/stati/ricerca/ordinamento equivalenti
4. workflow completabile end-to-end su entrambi i client
5. nessuna deviazione dati (stesso schema SQLite e stesso contratto `/api/v1`)
