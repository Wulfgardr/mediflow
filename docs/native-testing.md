<a id="testing-app-macos-swiftxcode"></a>

# Verificare l’app macOS (Swift/Xcode)

Stato documento: CANONICAL (testing nativo macOS)  
Ultimo aggiornamento: 2026-09-06 (tooling simulatore e interoperabilità mobile)

---

## Obiettivo

La verifica del client macOS deve poter essere ripetuta con gli strumenti Apple nativi, SwiftPM, XCTest e Xcode/xcodebuild. Questo metodo permette di confrontarne i comportamenti con la web app senza forzare strumenti pensati per il browser sull'interfaccia Swift.

Riferimenti:
- [docs/adr/0008-web-first-with-parity-sweeps.md](./adr/0008-web-first-with-parity-sweeps.md)
- [docs/adr/0009-native-testing-strategy-xcode-xctest.md](./adr/0009-native-testing-strategy-xcode-xctest.md)
- [docs/parity-matrix.md](./parity-matrix.md)
- [docs/parity-click-map-macos.md](./parity-click-map-macos.md)

---

## Decisione operativa

2. Per l'app macOS, eseguire i test automatici con XCTest tramite SwiftPM/Xcode.
3. Per il parity sweep, verificare entrambi i binari nello stesso ciclo, mantenendo distinti i rispettivi strumenti.

---

<a id="livelli-di-test-native"></a>

## Livelli di test nativi

### 1) Unit test (obbligatorio)

- Usare `swift test` oppure `xcodebuild test` sul package.
- Coprire logica pura, trasformazioni, filtri, ordinamenti e mapping dei payload.
- I target sono `native/MediFlowMac/Tests/MediFlowCoreTests` e `native/MediFlowMac/Tests/MediFlowAppleSharedTests`.
- Le fixture di modello e client non sostituiscono una sessione sul runtime reale.

### 2) Integration test locale (progressivo)

- Usare XCTest con dipendenze locali reali, come API locale, token e proxy TLS, dove siano utili.
- Validare i principali percorsi endpoint `/api/v1` senza richiedere la UI completa.
- Per il client paired, eseguire il preflight HTTPS descritto sotto e le regressioni di rete del runbook dedicato, distinguendoli dai test con data source simulato.

### 3) UI automation macOS (roadmap)

- Il runner previsto è XCUITest sul target dell'app nativa in Xcode.
- Occorre prima un progetto Xcode dotato di bundle UI test dedicato.
- Gli `accessibilityIdentifier` già presenti nelle viste principali costituiscono la base disponibile, non la suite UI completa.

---

## Comandi standard

### CLI (consigliato in automation)

```bash
npm run test:native
```

Il comando richiama `scripts/native-test.sh`, che usa per default il runner `swift`, ossia `swift test --package-path native/MediFlowMac`.

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

Il contratto del tooling, aggiornato il 2026-09-06, richiede Xcode completo selezionato e SDK iOS Simulator 26+. Il progetto Xcode canonico si compila attraverso:

```bash
bash scripts/build-mobile-sim-app.sh
```

Lo script compila `MediFlowMobileApp` in Debug con la firma simulatore predefinita dell'SDK Xcode selezionato, quindi restituisce su stdout il percorso assoluto dell'app verificata. La firma ad-hoc del simulatore non è una firma di distribuzione. I log vanno su stderr; l'output predefinito è `tmp-ios-sim-dd/Build/Products/Debug-iphonesimulator/MediFlow.app`, modificabile impostando `MEDIFLOW_IOS_DERIVED_DATA`. Il progetto non viene rigenerato e la build non richiede backend, dati o simulatore avviato.

L'installazione richiede invece un gesto esplicito, Node 24 e l'UDID di un simulatore iOS già avviato:

```bash
MEDIFLOW_IOS_SIMULATOR_ID=<UDID> bash scripts/build-mobile-sim-app.sh --install
```

Il builder non avvia né simulatori né app. Il paired smoke deve usare questo contratto prima di accedere al backend o modificare il pairing. Quando `xcode-select` punti a Command Line Tools, impostare `DEVELOPER_DIR` verso Xcode completo per entrambi gli script, come indicato in [native/README.md](../native/README.md).

Per controllare su macOS soltanto il tooling, senza simulatori o backend reali, eseguire:

```bash
node --test scripts/build-mobile-sim-app.test.mjs
bash scripts/check-apple-structure.sh
bash scripts/check-apple-network-entitlements.sh
```

La suite usa fixture temporanee sintetiche e simula i comandi Apple e del backend. Ne verifica quindi il tooling, senza attestare una build Xcode reale, un'installazione certificata o il completamento del paired smoke.

<a id="interoperabilita-mobile-con-host-reali"></a>

### Interoperabilità mobile con host reali

La matrice iPhone/iPad × macOS/Windows/Linux usa `scripts/mobile-home-base-interop.mjs` e `scripts/mobile-home-base-interop-xctestrun.py`. Ogni host esegue il runtime e termina TLS sul proprio sistema, usando un database sintetico distinto. Il descriptor JSON locale deve essere privato, con permessi `0600`, e identificare SHA sorgente, URL HTTPS, certificato PEM, pin DER SHA-256, operatore sintetico, ambulatorio, paziente e due credenziali paired distinte. Il token API locale resta al proprietario dell'host, che crea e conferma gli intent soltanto attraverso le API supportate.

Prima delle prove reali, eseguire le suite UI con fixture isolate. Conservare poi una build `build-for-testing` identificata da SHA e digest e usare lo script Python per prepararne una copia privata del `.xctestrun`; i parametri sono descritti da `--help`. Il descriptor va al test runner, mentre l'app riceve le credenziali attraverso il normale login UI. Sono opt-in soltanto `testRealPairedHostWorkflow` e `testRealPairedOtherClientReread`: le altre suite non devono essere avviate con quel descriptor.

Prima del run UI deve essere eseguito il controllo HTTPS indipendente:

```bash
node scripts/mobile-home-base-interop.mjs preflight \
  --descriptor /percorso/privato/host.json --client ios \
  --output /percorso/privato/preflight-ios.json
```

Ripetere il preflight per `ipados`. Il controllo separa sessione Web e sessione nativa e confronta versione e dati decifrati dello stesso paziente, ma il suo successo non dimostra l'interazione nell'app. `native-boundary` esercita inoltre una scrittura versionata dell'indirizzo sintetico: ne conserva il valore, ma produce una nuova versione. Dopo l'uso dell'app, `reread` confronta i valori attesi con riletture indipendenti.

Persistenza e funzionamento offline devono essere provati con Keychain e cache ordinarie, senza `DEV_SKIP_KEYCHAIN`, autologin, pazienti o stati paired iniettati e trasporti fittizi. Un pairing preesistente inatteso deve interrompere il flusso senza essere cancellato. Le variazioni di connettività possono riguardare solo proxy o processo della fixture; revoca e scadenza devono passare da API e configurazioni supportate, senza modificare clock o database. Log, descriptor e `.xctestrun` privati restano fuori da Git.

Il precedente `mobile-home-base-paired-smoke.sh` documenta avvio e lettura, ma usa snapshot SQLite, bypass TLS nel setup e autologin. Per questi motivi non è il runner della matrice reale 0.8.6 e non ne attesta login, scritture o persistenza.

### Xcode (workflow locale)

1. Apri `native/MediFlowMac/Package.swift` in Xcode.
2. Seleziona lo scheme package `MediFlowMac-Package`.
3. Esegui `Product > Test`.

Per diagnosticare un test, usare breakpoint nei sorgenti e nei file di test ed eseguire il singolo metodo dal gutter di Xcode.

---

## Workflow consigliato per parity sweep

1. Eseguire lo smoke web con `npm run e2e:smoke`.
2. Eseguire gli unit test nativi con `npm run test:native`.
3. Finché i test UI non siano completi, esercitare la click-map nativa manuale: aprire l'app con `./scripts/Launch_MediFlowMac.command`, eseguire e verbalizzare P6 da `docs/parity-click-map-macos.md` e controllare i punti chiave di `docs/parity-matrix.md`. È facoltativo il probe AX in sola lettura con `--app-path`, secondo il runbook P6.
4. Quando si modifica `home-base` iPhone/iPad, seguire il [percorso con host reali](#interoperabilita-mobile-con-host-reali), registrando separatamente preflight e UI per ogni combinazione. Le modifiche al confine `/api/v1/network/*` richiedono anche `npm run test:network:home-base-readonly` e `npm run test:network:home-base-write`; se interessano il diario paired, anche `npm run test:network:home-base-diary-write`. `docs/mobile-home-base-smoke.md` conserva regressioni headless e precedente smoke mobile, ma non sostituisce le ricevute della matrice reale.
5. Registrare in PR/note ciò che è stato verificato e ciò che non lo è stato, con il relativo motivo.

Comando aggregato (raccomandato per `P0b`):

```bash
npm run test:parity:smoke
```

---

## Mapping parity -> test

Per ciascuna capacità inclusa nella parità (`view/add/edit/delete/filter`), distinguere tre livelli di prova:

1. Unit test per logica deterministica, filtri, ordinamenti e normalizzazioni.
2. Test di integrazione per chiamate API e validazione dei codici di risposta.
3. Verifica UI, manuale o XCUITest, per il percorso end-to-end.

Per i pazienti, la corrispondenza è questa:
- filtro attivi/archiviati: unit test (`PatientsFilteringTests`);
- ordinamento recenti/A-Z: unit test (`PatientsFilteringTests`);
- modifica, archiviazione ed eliminazione: flusso UI, ancora manuale nel quadro descritto e destinato a XCUITest.

---

## Cosa NON fare

- Non usare Playwright per automatizzare l'interfaccia macOS Swift.
- Non unire test nativi e web in un unico runner fragile.
- Non dichiarare "parity FULL" senza avere almeno verificato la logica principale e i percorsi di interazione fondamentali.

---

## Troubleshooting rapido

### `xcodebuild` non trova scheme

Elencare gli scheme disponibili:

```bash
cd native/MediFlowMac
xcodebuild -list
```

Quindi indicare quello corretto:

```bash
MEDIFLOW_XCODE_SCHEME=<nome_scheme> npm run test:native:xcode
```

### Errori cache/permessi build

Usare una directory derived data locale al workspace:

```bash
MEDIFLOW_DERIVED_DATA_DIR=./tmp-native-derived-data npm run test:native:xcode
```

### Test native passano ma parity non allineata

Registrare il divario effettivo in `docs/parity-matrix.md`: il successo dei test nativi non deve nascondere una differenza di comportamento.

---

<a id="prossimi-step-suggeriti-testing-native"></a>

## Passi successivi suggeriti (test nativi)

1. Estendere gli unit test alla normalizzazione degli stati di terapie e checkup.
2. Introdurre i primi test di integrazione su `LocalAPIClient`.
3. Preparare il target XCUITest per i percorsi fondamentali di parità P0b/P6.
4. Mantenere il probe AX in sola lettura allineato agli `accessibilityIdentifier` chiave, per ridurre l'ambiguità dei parity sweep.