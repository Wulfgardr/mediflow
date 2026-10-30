# Compatibilità macOS del client GPUI

Il minimo del pacchetto è **macOS 11.0, arm64**. Mac Apple Silicon da M1
incluso è un obiettivo di compatibilità, ancora da provare su un M1 reale.
Intel è escluso. La qualifica resta sul Mac16,5 di Leonardo con macOS 27.2;
un deployment target non qualifica gli altri sistemi.

## Limiti delle dipendenze

Il grafo Cargo bloccato usa GPUI alla revisione
`56934ec0560bce8929025497411de7f5322fb6ca`.

| Componente | Vincolo osservato |
| --- | --- |
| Rust, `aarch64-apple-darwin` | Minimo macOS 11.0 della piattaforma arm64. È il limite inferiore scelto. |
| `gpui_apple/build.rs` | Shader Metal precompilati con `-mmacosx-version-min=10.15.7`, incorporati nel bundle; nessun aumento a 14.0 o 27.2. |
| Renderer Metal | `supportsFamily:` da 10.15, storage condiviso solo sui dispositivi Apple riconosciuti; CoreGraphics e CAMetalLayer precedono 11.0. |
| `gpui_macos` | `maximumFramesPerSecond` da 12.0 protetto da `respondsToSelector:`; localizzazione automatica dei menu da 12.0 e registrazione degli URL da 12.0 protette da controllo OS. Codice per finestre da 15.0/15.3 protetto da controllo OS. |
| AccessKit macOS 0.26.3 | Espone l'albero attraverso NSAccessibility. Le API usate precedono 11.0; nessun uso delle proprietà `accessibilityUserInputLabels` da 14.0. Non dimostra VoiceOver su un vecchio sistema. |
| Cattura schermo | Feature `screen-capture` non attiva nel grafo del client. ScreenCaptureKit non impone 12.3 a questo pacchetto. |
| Raccordo Objective-C dell'app | Foundation, AppKit, Security, LocalAuthentication, CoreGraphics e libbsm. `LAContext` da 10.10, riuso Touch ID da 10.12, `biometryType` da 10.13.2. Il controllo Clang a 11.0 non rileva usi successivi senza guardia. |

Fonti: [piattaforma Rust](https://doc.rust-lang.org/rustc/platform-support/apple-darwin.html),
sorgenti della revisione GPUI bloccata e header dell'SDK Apple usato per la build.
Il controllo Clang non analizza i messaggi Objective-C inviati da Rust: quelli
richiedono anche la ricognizione delle dipendenze. La build e il controllo
`minos` non sostituiscono l'esecuzione sul sistema minimo.

`app/build.rs` applica `MACOSX_DEPLOYMENT_TARGET` anche al raccordo Objective-C
(default 11.0) e tratta `-Wunguarded-availability` e
`-Wunguarded-availability-new` come errori. Il packaging imposta quel target
per Cargo e verifica lo stesso valore nel Mach-O e nel plist. Il valore 14.0
dell'app Swift separata non è un vincolo del client GPUI.

La biometria mantiene la sola policy biometrica, riuso disabilitato e verifica
di Touch ID. Quando manca o è bloccata restituisce uno stato esplicito;
nessun consenso viene prodotto e nessun percorso alternativo viene scelto
automaticamente. L'eventuale conferma PIN resta una scelta esplicita del
flusso già esistente. Nessuna sostituzione del percorso di accessibilità è
introdotta per i sistemi precedenti.

## Perimetro delle prove

Il candidato va costruito e provato sul Mac16,5 con macOS 27.2. I sistemi
precedenti e M1 richiedono prove separate. Una VM arm64 con risorse ridotte
può verificare solo quel sistema virtualizzato: non prova Metal, Touch ID,
prestazioni reali o compatibilità fisica M1.

Il bundle è un client collegato, senza Node o archivio. Il backend deve avere
un runtime compatibile con il proprio sistema e seguire i propri requisiti.
ATHENA è opzionale e può non essere disponibile su macchine piccole. Il
minimo del client non promette inferenza locale né requisiti dell'intero prodotto.
