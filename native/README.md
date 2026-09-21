<a id="mediflow-universal-apple-app"></a>

# App Apple universale di MediFlow

La famiglia Apple di MediFlow condivide una base SwiftUI per iOS, iPadOS e
macOS, mantenendo lo stesso rapporto con l'home-base e con il contratto
`/api/v1` usato dall'applicazione web. Questa condivisione permette di sviluppare
le superfici native senza introdurre un accesso separato ai dati. Lume è il
linguaggio di design attivo; Vetro Clinico resta un riferimento storico e
transitorio.

Qui sono descritti sorgenti e strumenti di sviluppo, non la disponibilità di
una release firmata, notarizzata o pubblicata. La release 0.8.6 distribuisce i
sorgenti; il seguito nativo rimane distinto. Per convenzione, i testi di questa
repository non usano il trattino lungo.

<a id="layout"></a>

## Struttura

- `MediFlowAppleApp/`: il progetto unico da cui costruire i bundle Apple,
  generato in Xcode da `project.yml` tramite xcodegen. Comprende due target app
  con lo stesso bundle id `com.mediflow.mobile` (universal purchase):
  - `MediFlowMobileApp` (iOS/iPadOS, device family 1,2);
  - `MediFlowMacApp` (macOS nativo).
  Entrambi montano `AppleFoundationMobileRootView` dalla libreria condivisa.
- `MediFlowMac/`: il package SwiftPM, che contiene libreria e test, non
  eseguibili app:
  - `Sources/MediFlowAppleShared/`: il modulo condiviso raccoglie radice SwiftUI
    e modelli di vista (`AppleFoundation/`), rete verso l'home-base, Bonjour,
    pairing, cache, componenti di design `Lume`, elementi di interfaccia Liquid
    Glass facoltativi e primitive del contratto `/api/v1`
    (`APIPatchValue`, `APIVersionConflict`);
  - `Tests/MediFlowAppleSharedTests/`: la suite XCTest.

Nella Fase 0 sono stati rimossi i due precedenti eseguibili SPM
(`MediFlowMac`, `MediFlowMobile`) e ~12k righe della “rich Mac UI” non
montata. La struttura da usare è quindi quella dei target e della libreria
condivisa descritti sopra.

<a id="toolchain"></a>

## Strumenti di compilazione

Il codice Liquid Glass usa `.glassEffect` dietro un controllo di disponibilità
`iOS 26 / macOS 26`; per compilarlo serve quindi Xcode con SDK 26 o successivo.
Le sole Command Line Tools non includono XCTest: `scripts/native-test.sh`
seleziona automaticamente un'installazione completa di Xcode. Quando occorre
indicarla esplicitamente in locale, esporta `DEVELOPER_DIR`:

    export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer

<a id="build-and-test"></a>

## Compilazione e test

    # SwiftPM library + tests
    scripts/native-test.sh                      # swift test (auto-selects Xcode)

    # Regenerate the Xcode project + run the guards (structure + entitlements)
    scripts/generate-apple-xcodeproj.sh

    # Build the apps
    xcodebuild -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj \
      -scheme MediFlowMacApp   -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO
    bash scripts/build-mobile-sim-app.sh

    # XCUITest interaction tests (boots a simulator, drives the tab bar/sections)
    xcodebuild test -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj \
      -scheme MediFlowMobileApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO

La CI esegue lo stesso percorso in `.github/workflows/apple-native.yml`, con
filtro sui percorsi `native/**`. I controlli
`scripts/check-apple-structure.sh` e
`scripts/check-apple-network-entitlements.sh` falliscono se ricompaiono gli
eseguibili ritirati o radici non usate, oppure se mancano le chiavi per Bonjour
e per la rete locale.

<a id="simulator-build-and-optional-install"></a>

## Compilazione per simulatore e installazione facoltativa

`scripts/build-mobile-sim-app.sh` compila il progetto Xcode tracciato e lo
scheme `MediFlowMobileApp` in Debug, con firma disabilitata. Usa Xcode selezionato
tramite `DEVELOPER_DIR`, quando impostato, richiede SDK iOS Simulator 26 o
successivo e non rigenera mai il progetto. Se sono selezionate le Command Line
Tools, indica un Xcode completo con `DEVELOPER_DIR`, come mostrato sopra.

Il risultato predefinito è
`tmp-ios-sim-dd/Build/Products/Debug-iphonesimulator/MediFlow.app`.
`MEDIFLOW_IOS_DERIVED_DATA` permette di scegliere la directory dei dati di
compilazione; i percorsi relativi sono risolti dalla radice della repository.
Prima di dichiarare il successo, il builder verifica identificativo del bundle,
piattaforma del simulatore ed eseguibile. Solo allora scrive su stdout il
percorso assoluto dell'app; la diagnostica di compilazione e installazione va
su stderr. Se fornito, `MEDIFLOW_IOS_BUNDLE_ID` verifica l'identificativo atteso:
non cambia l'identità dell'app.

Compilare non richiede simulatore, backend, PIN, database o pairing. Installare
richiede invece Node 24 nel PATH, un UDID esplicito e un simulatore iOS
disponibile e già avviato:

    MEDIFLOW_IOS_SIMULATOR_ID=<UDID> bash scripts/build-mobile-sim-app.sh --install

Il builder non avvia, lancia o cancella mai un simulatore. Lo smoke paired usa
questo stesso contratto di installazione prima del setup del backend e delle
modifiche temporanee al pairing, come descritto nel
[runbook dello smoke mobile](../docs/mobile-home-base-smoke.md). Compilazione e
installazione riuscite non attestano login, pairing, comportamento della UI o
distribuzione.

I test di regressione degli strumenti usano su macOS fixture sintetiche
temporanee e sostituti dei comandi Apple e backend: non contattano server né
simulatori.

    node --test scripts/build-mobile-sim-app.test.mjs

<a id="runnable-macos-app-with-the-home-base-webruntime"></a>

## App macOS eseguibile con WebRuntime home-base

Nel percorso macOS l'app svolge il ruolo di home-base: supervisiona un server
Next.js standalone incluso nel bundle tramite `HomeBaseRuntimeSupervisor`.
Il solo `xcodebuild` non include questo server, così la CI rimane rapida e non
dipende da npm. Per costruire l'app eseguibile con il proprio runtime, anche
come base del successivo percorso di distribuzione, usa:

    scripts/build-apple-macos-app.sh            # next build + xcodebuild + inject WebRuntime
    MEDIFLOW_SKIP_WEB_BUILD=1 scripts/build-apple-macos-app.sh   # reuse existing .next/standalone
    MEDIFLOW_CODESIGN_IDENTITY=- scripts/build-apple-macos-app.sh # ad-hoc sign incl. the runtime

Lo script assembla `Contents/Resources/WebRuntime/`, con `server.js`,
`.next/static` e `public`, insieme a `local-api-tls-proxy.mjs`: sono i componenti
che il supervisore avvia. Node NON è incluso. Il WebRuntime contiene un
manifest Node/ABI prodotto alla compilazione, rispetto al quale il supervisore
accetta solo un Node 24.x compatibile, trovato nel sistema, in Homebrew,
nvm/fnm o tramite `MEDIFLOW_NODE_BINARY`. Se non lo trova, si arresta senza
ripiegare su un interprete incompatibile.

Anche l'architettura deve coincidere: lo script produce un'app `arm64` oppure
`x86_64`, coerente con il WebRuntime nativo. Non produce per questo un artefatto
macOS universale.

<a id="known-limitations-tracked-follow-ups"></a>

## Limiti noti e attività successive

- La distribuzione diretta fuori dal Mac App Store richiede firma Developer ID
  Application e notarizzazione Apple. La distribuzione nel Mac App Store segue
  invece il proprio percorso di firma e caricamento e richiede una decisione
  distinta su App Sandbox, perché l'app avvia Node come processo figlio e apre
  una porta locale.
- Il raccordo del contratto reale `/api/v1/network` con `PatchValue` e
  `VersionConflict` in `HomeBasePatientsClient` appartiene al lavoro di Fase 1
  qui richiamato. Per verificarne gli scambi completi di richiesta e risposta
  serve un backend in esecuzione; i soli test locali dei tipi non lo attestano.
