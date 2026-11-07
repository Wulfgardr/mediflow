# Catture Apple

Dalla checkout eseguire `scripts/ui-identita/apple/capture.sh`.

Richiede Xcode beta, XcodeGen, Python 3 e il banco sintetico già in esecuzione descritto in `~/Antigravity/mf-ui-identita-20261107/BANCO.md`. Lo script non avvia né ferma il banco. Compila MediFlowMobileApp Debug, prepara i pairing iOS/iPadOS, genera una copia del wrapper Xcode nello scratch e guida la sequenza 01–07 nei due temi. La schermata nuova voce contiene un titolo digitato; il corpo resta vuoto e la bozza non viene salvata. Il Mac SwiftUI è escluso dalla ripresa: il primo tentativo ha documentato la schermata nera a Mac bloccato.

Scratch esclusivamente su Vision: `/Volumes/Vision/mf-ui-identita-20261107-scratch/apple/`. Contiene DerivedData, pacchetti, progetto generato, pairing sintetici, log e risultati xcresult. `prepare.py` copia Sources e Assets e riferisce il package Swift originale in sola lettura. Non eseguire XcodeGen sul progetto versionato.

Simulatori dedicati: iPhone 17 Pro `39C682EE-A9B7-4AE2-AF1F-840D44658BB6`; iPad Pro 13-inch M5 `FB0654D2-8CC3-49F3-9406-903F2BD54241`, in orizzontale. Lo script attende `bootstatus -b` con timeout di 180 secondi e altri cinque secondi prima del test. Il trap finale esegue `simctl shutdown all`, anche in caso di errore.

Il tema viene impostato con `simctl ui appearance` e con la preferenza UserDefaults `mediflow.apple.appearance.theme` passata come argomento di lancio. XCUITest usa le variabili di lancio per URL TLS loopback, pin, pairing e accesso automatico. Naviga solo nell'archivio sintetico. Per ogni stato stampa `CAPTURE_READY`, scarica stdout e attende otto secondi; `run-capture.py` legge il segnale e chiama `simctl io screenshot` con timeout di 40 secondi e due tentativi. Il test non invoca XCUIScreen: la cattura resta indipendente dalla raccolta schermata di XCTest. In caso di timeout l'immagine va controllata perché il test potrebbe avere già cambiato stato.

Le PNG originali e gli indici sono in `~/Antigravity/mf-ui-identita-20261107/{ios-iphone,ios-ipad}/`. `export.py` legge le dimensioni dal PNG e segnala le catture mancanti. Non conta le immagini diagnostiche come schermate canoniche. L'exit code complessivo è in `capture-exit-code.txt`, gli esiti per dispositivo in `ios-iphone-exit-code.txt` e `ios-ipad-exit-code.txt`. Un file presente non basta: controllare immagini e asserzioni nel log.
