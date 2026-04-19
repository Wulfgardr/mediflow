# ADR 0009: Strategia test native macOS con XCTest/Xcode (web separato)

Date: 2026-02-20  
Status: Accepted

---

## Problema

La parity web/macOS richiede test ripetibili su entrambe le app.
L'harness attuale e centrato su Playwright (web) e non copre in modo nativo i
click-path della app macOS.

## Contesto

- Sviluppo principale web-first (ADR 0008).
- Client macOS in SwiftUI (SwiftPM), sviluppato e validato su stack Apple.
- Obiettivo parity invariato: stessa funzione/campi/flessibilita sui moduli core.
- Nessuna dipendenza cloud o infrastruttura esterna obbligatoria.

## Opzioni

1. Unificare tutto su Playwright.
2. Separare i runner: Playwright per web, XCTest/Xcode per macOS.
3. Solo checklist manuali per macOS.

## Trade-off

- Opzione 1:
  - Pro: un solo tool.
  - Contro: copertura macOS debole/non idiomatica, alta fragilita.
- Opzione 2:
  - Pro: test nativi robusti, aderenti all'ecosistema Swift/Xcode.
  - Contro: due pipeline da mantenere.
- Opzione 3:
  - Pro: costo iniziale minimo.
  - Contro: bassa ripetibilita, regressioni piu probabili.

## Decisione

Adottiamo opzione 2:

- **Web**: Playwright smoke (resta invariato).
- **macOS**: XCTest/Xcode come metodo canonico per test automatici native.
- `P0b` parity testing viene interpretato come doppio binario:
  - web smoke automation
  - native test automation + click-map verificabile su tooling Apple.

## Conseguenze

- Positivo: la quality bar native non dipende da workaround browser-centrici.
- Positivo: test nativi eseguibili sia da CLI (`swift test`) sia da Xcode/xcodebuild.
- Negativo: maggiore disciplina documentale per mantenere allineati i due runner.

## First Thin Slice

1. Estrarre logica pazienti (filter/sort) in componente Swift testabile.
2. Introdurre test XCTest in SwiftPM (`MediFlowMacTests`).
3. Aggiungere script operativo `scripts/native-test.sh` con runner `swift|xcode|both`.
4. Documentare il playbook in `docs/native-testing.md` e collegarlo ai documenti canonical.
