<!-- Codex: created 2026-02-20 -->
# Parity Smoke Harness (Web + macOS)

Stato documento: SECONDARY (runbook operativo)  
Ultimo aggiornamento: 2026-05-02

---

## Obiettivo

Eseguire un check rapido parity con un comando unico che copre:

1. lane web smoke (Playwright)
2. lane native smoke (XCTest via SwiftPM/Xcode)
3. output artifacts + summary

Script:
- `scripts/parity-smoke.sh`

---

## Comando base

```bash
bash scripts/parity-smoke.sh
```

Output:
- report: `tmp-parity-smoke/<run-id>/summary.md`
- log web: `tmp-parity-smoke/<run-id>/web-smoke.log`
- log native: `tmp-parity-smoke/<run-id>/native-smoke.log`

---

## Variabili principali

- `MEDIFLOW_PARITY_RUN_WEB=1|0` (default: `1`)
- `MEDIFLOW_PARITY_RUN_NATIVE=1|0` (default: `1`)
- `MEDIFLOW_PARITY_REQUIRE_WEB=1|0` (default: `0`)
- `MEDIFLOW_PARITY_REQUIRE_NATIVE=1|0` (default: `1`)
- `MEDIFLOW_PARITY_NATIVE_RUNNER=swift|xcode|both` (default: `xcode`)
- `MEDIFLOW_PARITY_ARTIFACT_DIR=<path>` (default: `tmp-parity-smoke/<run-id>`)

Esempio strict (fallisce se una lane fallisce):

```bash
MEDIFLOW_PARITY_REQUIRE_WEB=1 MEDIFLOW_PARITY_REQUIRE_NATIVE=1 bash scripts/parity-smoke.sh
```

Esempio offline (solo native):

```bash
MEDIFLOW_PARITY_RUN_WEB=0 MEDIFLOW_PARITY_NATIVE_RUNNER=xcode bash scripts/parity-smoke.sh
```

---

## Evidenza WUL-21 / WUL-26 automated strict

Run locale isolato del 2026-05-02:

```bash
MEDIFLOW_PARITY_REQUIRE_WEB=1 MEDIFLOW_PARITY_REQUIRE_NATIVE=1 MEDIFLOW_PARITY_NATIVE_RUNNER=xcode MEDIFLOW_PARITY_ARTIFACT_DIR=tmp-parity-smoke/wul-21-20260502-strict-rerun bash scripts/parity-smoke.sh
```

Esito:

- web lane: `PASS` (`e2e/document-import.spec.ts`, `e2e/web-smoke.spec.ts`)
- native lane: `PASS` (`xcodebuild test`, 45 test)
- summary locale: `tmp-parity-smoke/wul-21-20260502-strict-rerun/summary.md`

Il run strict valida l'harness web+native required e chiude la sola lane
automatizzata `P0b.c`. Non e sufficiente per dichiarare `WUL-26` Done come
chiusura parity completa: la click-map manuale capability-by-capability resta
separata nel gate `P6`. `WUL-22` e code-satisfied per le esenzioni in
create/edit paziente, la semantica delete del diario e stata chiusa in
`WUL-24` e `WUL-23` e code-satisfied per le osservazioni native LOINC/UCUM. I
gap modulo residui restano in `WUL-25`, `WUL-76` e `WUL-77`.

---

## VM workflow consigliato

1. Snapshot VM pulita.
2. Esegui `bash scripts/parity-smoke.sh`.
3. Compila manualmente click-map macOS:
   - opzionale: `npm run test:native:clickmap:probe` per verificare in modo read-only i controlli AX chiave prima dei passaggi manuali
   - `docs/parity-click-map-macos.md`
4. Archivia artifacts e ripristina snapshot.

---

## Note operative

- Se Playwright non e installato:
  - con `MEDIFLOW_PARITY_REQUIRE_WEB=0` la lane web viene marcata `SKIPPED`
  - con `MEDIFLOW_PARITY_REQUIRE_WEB=1` la lane web fallisce (`FAIL`)
- La lane native usa `scripts/native-test.sh`; per dettagli vedi:
  - `docs/native-testing.md`
- Il probe AX `scripts/native-click-map-probe.swift` non sostituisce la checklist manuale e non esegue scritture: verifica solo presenza controlli chiave e apertura delle sheet parity principali.
