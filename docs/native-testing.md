# Testing app macOS (Swift/Xcode)

Stato documento: CANONICAL (testing nativo macOS)  
Ultimo aggiornamento: 2026-02-20

---

## Obiettivo

Definire un metodo chiaro e ripetibile per testare la app macOS di MediFlow
usando strumenti Apple-native (SwiftPM, XCTest, Xcode/xcodebuild), mantenendo
la parity con la web app senza forzare tool browser-centrici sul client Swift.

Riferimenti:
- [docs/adr/0008-web-first-with-parity-sweeps.md](./adr/0008-web-first-with-parity-sweeps.md)
- [docs/adr/0009-native-testing-strategy-xcode-xctest.md](./adr/0009-native-testing-strategy-xcode-xctest.md)
- [docs/parity-matrix.md](./parity-matrix.md)

---

## Decisione operativa

2. App macOS: test automatici con XCTest (SwiftPM/Xcode).
3. Parity sweep: usare entrambi i binari nello stesso ciclo di verifica.

---

## Livelli di test native

### 1) Unit test (obbligatorio)

- Runner: `swift test` oppure `xcodebuild test` su package.
- Scopo: logica pura, trasformazioni, filtri, sorting, mapping payload.
- Stato attuale:
  - target test: `native/MediFlowMac/Tests/MediFlowMacTests`
  - suite iniziale: `PatientsFilteringTests.swift`

### 2) Integration test locale (progressivo)

- Runner: XCTest con dipendenze reali locali (API locale, token, TLS proxy) dove utile.
- Scopo: validare percorsi endpoint principali (`/api/v1`) senza UI completa.
- Nota: da aggiungere in step successivi, mantenendo diff piccoli.

### 3) UI automation macOS (roadmap)

- Runner target: XCUITest su target app nativo in Xcode.
- Prerequisito: assetto progetto Xcode con bundle UI test dedicato.
- Base gia pronta: `accessibilityIdentifier` nelle view principali.

---

## Comandi standard

### CLI (consigliato in automation)

```bash
npm run test:native
```

Esegue:
- `scripts/native-test.sh`
- default runner `swift` (`swift test --package-path native/MediFlowMac`)

Runner alternativi:

```bash
MEDIFLOW_NATIVE_TEST_RUNNER=xcode npm run test:native
MEDIFLOW_NATIVE_TEST_RUNNER=both npm run test:native
```

Shortcut:

```bash
npm run test:native:xcode
```

Variabili utili:
- `MEDIFLOW_XCODE_SCHEME` (default: `MediFlowMac`)
- `MEDIFLOW_XCODE_DESTINATION` (default: `platform=macOS,arch=arm64`)
- `MEDIFLOW_DERIVED_DATA_DIR` (default: `./tmp-native-derived-data`)

### Xcode (workflow locale)

1. Apri `native/MediFlowMac/Package.swift` in Xcode.
2. Seleziona scheme package (`MediFlowMac`).
3. Esegui `Product > Test`.

Per debugging test:
- usa breakpoints in source + test file
- esegui singolo test method dal gutter di Xcode

---

## Workflow consigliato per parity sweep

1. Web smoke:
   - `npm run e2e:smoke`
2. Native unit test:
   - `npm run test:native`
3. Native click-map manuale (finche UI test non e completa):
   - apri app con `./scripts/Launch_MediFlowMac.command`
   - opzionale: esegui il probe AX read-only `npm run test:native:clickmap:probe`
   - verifica punti chiave parity da `docs/parity-matrix.md`
4. Smoke mobile paired (quando tocchi `home-base` iPhone/iPad):
   - esegui `bash scripts/mobile-home-base-paired-smoke.sh`
   - per prerequisiti, safety notes e artifact consulta `docs/mobile-home-base-smoke.md`
5. Aggiorna esito in PR/notes:
   - cosa e stato verificato
   - cosa non e stato verificato e perche

Comando aggregato (raccomandato per `P0b`):

```bash
npm run test:parity:smoke
```

---

## Mapping parity -> test

Per ogni capability parity (`view/add/edit/delete/filter`):

1. Unit test: logica deterministica (filtri, ordinamenti, normalizzazioni).
2. Integration test: chiamate API e validazione codici risposta.
3. UI check (manuale o XCUITest): click-path end-to-end.

Esempio pazienti:
- filter stato attivi/archiviati: unit test (`PatientsFilteringTests`)
- sort recenti/A-Z: unit test (`PatientsFilteringTests`)
- edit/archive/delete: UI flow (attualmente manuale, futuro XCUITest)

---

## Cosa NON fare

- Non usare Playwright per automatizzare UI macOS Swift.
- Non mescolare test native e web in un unico runner fragile.
- Non dichiarare "parity FULL" senza almeno:
  - test logica principali
  - verifica click-path core

---

## Troubleshooting rapido

### `xcodebuild` non trova scheme

Verifica scheme disponibili:

```bash
cd native/MediFlowMac
xcodebuild -list
```

Poi imposta:

```bash
MEDIFLOW_XCODE_SCHEME=<nome_scheme> npm run test:native:xcode
```

### Errori cache/permessi build

Usa derived data locale nel workspace:

```bash
MEDIFLOW_DERIVED_DATA_DIR=./tmp-native-derived-data npm run test:native:xcode
```

### Test native passano ma parity non allineata

Aggiorna:
- `docs/parity-matrix.md` (gap reale)

---

## Prossimi step suggeriti (testing native)

1. Estendere unit test a normalizzazione stati terapie/checkup.
2. Introdurre primi integration test su `LocalAPIClient`.
3. Preparare target XCUITest per click-path parity core (P0b/P6).
4. Mantenere il probe AX read-only allineato agli `accessibilityIdentifier` chiave per ridurre ambiguita nei parity sweep.
