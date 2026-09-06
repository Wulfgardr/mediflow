# Testing app macOS (Swift/Xcode)

Stato documento: CANONICAL (testing nativo macOS)  
Ultimo aggiornamento: 2026-09-06 (tooling simulatore e interoperabilità mobile)

---

## Obiettivo

Definire un metodo chiaro e ripetibile per testare la app macOS di MediFlow
usando strumenti Apple-native (SwiftPM, XCTest, Xcode/xcodebuild), mantenendo
la parity con la web app senza forzare tool browser-centrici sul client Swift.

Riferimenti:
- [docs/adr/0008-web-first-with-parity-sweeps.md](./adr/0008-web-first-with-parity-sweeps.md)
- [docs/adr/0009-native-testing-strategy-xcode-xctest.md](./adr/0009-native-testing-strategy-xcode-xctest.md)
- [docs/parity-matrix.md](./parity-matrix.md)
- [docs/parity-click-map-macos.md](./parity-click-map-macos.md)

---

## Decisione operativa

2. App macOS: test automatici con XCTest (SwiftPM/Xcode).
3. Parity sweep: usare entrambi i binari nello stesso ciclo di verifica.

---

## Livelli di test native

### 1) Unit test (obbligatorio)

- Runner: `swift test` oppure `xcodebuild test` su package.
- Scopo: logica pura, trasformazioni, filtri, sorting, mapping payload.
- Target correnti: `native/MediFlowMac/Tests/MediFlowCoreTests` e
  `native/MediFlowMac/Tests/MediFlowAppleSharedTests`.
- Le fixture del modello e del client non sostituiscono una sessione sul runtime reale.

### 2) Integration test locale (progressivo)

- Runner: XCTest con dipendenze reali locali (API locale, token, TLS proxy) dove utile.
- Scopo: validare percorsi endpoint principali (`/api/v1`) senza UI completa.
- Per il client paired, usa il preflight HTTPS descritto sotto e le regressioni
  network del runbook dedicato, distinguendoli dai test con data source simulato.

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
- `MEDIFLOW_XCODE_SCHEME` (default: `MediFlowMac-Package`)
- `MEDIFLOW_XCODE_DESTINATION` (default: `platform=macOS,arch=arm64`)
- `MEDIFLOW_DERIVED_DATA_DIR` (default: `./tmp-native-derived-data`)

### Build/install simulatore iPhone e iPad

Contratto tooling aggiornato il 2026-09-06. Con Xcode completo selezionato e SDK
iOS Simulator 26+, usa il progetto Xcode canonico attraverso:

```bash
bash scripts/build-mobile-sim-app.sh
```

Compila `MediFlowMobileApp` in Debug con la firma simulatore predefinita dell'SDK
Xcode selezionato e restituisce su stdout il path assoluto dell'app verificata.
La firma ad-hoc per simulatore non e una firma di distribuzione. I log vanno su
stderr; output predefinito:
`tmp-ios-sim-dd/Build/Products/Debug-iphonesimulator/MediFlow.app`.
Per una directory dedicata imposta `MEDIFLOW_IOS_DERIVED_DATA`. Non rigenera il
progetto e non richiede backend, dati o un simulatore avviato.

L'installazione e esplicita, richiede Node 24 e un UDID iOS gia booted:

```bash
MEDIFLOW_IOS_SIMULATOR_ID=<UDID> bash scripts/build-mobile-sim-app.sh --install
```

Il builder non avvia simulatori o app. Il paired smoke usa questo contratto
prima di accedere al backend o modificare il pairing. Se `xcode-select` indica
Command Line Tools, imposta `DEVELOPER_DIR` verso Xcode completo per entrambi
gli script; vedi [native/README.md](../native/README.md).

Per verificare il solo tooling su macOS, senza simulatori o backend reali:

```bash
node --test scripts/build-mobile-sim-app.test.mjs
bash scripts/check-apple-structure.sh
bash scripts/check-apple-network-entitlements.sh
```

La suite usa fixture temporanee sintetiche e comandi Apple/backend simulati.
Questi test non attestano una build Xcode reale, un'installazione certificata
o il completamento del paired smoke.

### Interoperabilita mobile con host reali

Per la matrice iPhone/iPad × macOS/Windows/Linux usa
`scripts/mobile-home-base-interop.mjs` e
`scripts/mobile-home-base-interop-xctestrun.py`. Ogni host termina TLS ed esegue
il runtime sul proprio sistema, con un database sintetico distinto. Il descriptor
JSON locale è un file privato `0600`: identifica SHA sorgente, URL HTTPS,
certificato PEM e pin DER SHA-256, operatore sintetico, ambulatorio, paziente e
due credenziali paired distinte. Il token API locale resta al proprietario
host, che crea e conferma gli intent tramite le API supportate.

Esegui prima le suite UI con fixture isolate. Per le prove reali, conserva una
build `build-for-testing` identificata da SHA e digest e prepara una copia
privata del suo `.xctestrun` con lo script Python (`--help` descrive i parametri).
Il descriptor viene passato al test runner: l'app riceve le credenziali mediante
il normale login UI. I metodi opt-in sono `testRealPairedHostWorkflow` e
`testRealPairedOtherClientReread`. Le altre suite non devono essere lanciate con
questo descriptor.

Il controllo HTTPS indipendente precede il run UI:

```bash
node scripts/mobile-home-base-interop.mjs preflight \
  --descriptor /percorso/privato/host.json --client ios \
  --output /percorso/privato/preflight-ios.json
```

Ripeti per `ipados`. Il preflight separa la sessione Web dalla sessione nativa e
confronta versione e dati decifrati del medesimo paziente; il successo non prova
l'interazione nell'app. `native-boundary` esercita anche una scrittura versionata
dell'indirizzo sintetico conservandone il valore: produce una nuova versione.
Dopo l'uso dell'app, `reread` confronta i valori attesi con le riletture indipendenti.

Le prove di persistenza e offline usano Keychain e cache ordinarie: non impostare
`DEV_SKIP_KEYCHAIN`, autologin, pazienti/stati paired iniettati o trasporti finti.
Un pairing preesistente inatteso interrompe quel flusso, senza cancellarlo. I
cambiamenti di connettività riguardano solo il proxy/processo della fixture;
revoca e scadenza passano da API e configurazioni supportate, senza alterare
clock o database. Conserva log, descriptor e `.xctestrun` privati fuori da Git.

Il vecchio `mobile-home-base-paired-smoke.sh` resta un precedente di avvio e
lettura: usa snapshot SQLite, bypass TLS nel setup e autologin. Non è il runner
della matrice reale 0.8.6 e non ne attesta login, scritture o persistenza.

### Xcode (workflow locale)

1. Apri `native/MediFlowMac/Package.swift` in Xcode.
2. Seleziona lo scheme package `MediFlowMac-Package`.
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
   - opzionale: esegui il probe AX read-only con `--app-path` come descritto nel runbook P6
   - esegui e verbalizza la P6 da `docs/parity-click-map-macos.md`
   - verifica i punti chiave parity da `docs/parity-matrix.md`
4. Interoperabilità mobile paired (quando tocchi `home-base` iPhone/iPad):
   - segui il [percorso con host reali](#interoperabilita-mobile-con-host-reali), registrando separatamente preflight e UI per ogni combinazione
   - per modifiche al boundary `/api/v1/network/*`, esegui anche `npm run test:network:home-base-readonly`, `npm run test:network:home-base-write` e, se tocchi il diario paired, `npm run test:network:home-base-diary-write`
   - `docs/mobile-home-base-smoke.md` conserva le regressioni headless e il precedente smoke mobile; non sostituisce i receipt della matrice reale
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
