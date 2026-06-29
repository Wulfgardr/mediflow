# Decisioni Fase 0: app universale Apple (2026-06-28)

Stato: DECISE in sessione con Leonardo. Sblocca la roadmap parity descritta in
`docs/analysis/2026-06-28-review-a-minore-energia-e-parity-apple.md` (Parte 2).
Convenzione di stile: niente trattino lungo.

## Contesto verificato (topologia nativa)

Tutti e tre i punti di ingresso `@main` montano la STESSA root condivisa
`AppleFoundationMobileRootView(snapshot: .live)` dalla libreria `MediFlowAppleShared`:

1. Progetto Xcode `native/MediFlowAppleApp` (xcodegen `project.yml`): app iOS,
   bundle `com.mediflow.mobile`, `TARGETED_DEVICE_FAMILY "1,2"` (iPhone+iPad),
   Catalyst off, dipende da `MediFlowAppleShared`. Unico artefatto spedibile su App Store.
2. Eseguibile SPM `MediFlowMobile`: duplicato ridondante del #1 per `swift run`/simulatore.
3. Eseguibile SPM `MediFlowMac` (macOS): monta la stessa root mobile in una finestra
   1120x760 piu una finestra prototipo oncologico. La macchina E anche l'home-base:
   `HomeBaseRuntimeSupervisor` (solo macOS) lancia il `WebRuntime` Next.js come processo figlio.

Codice morto confermato: circa 12k righe di "rich Mac UI"
(`ContentView`, `PatientDetailView` 2495, `LocalAPIClient` 1517, prototipo oncologico ~3000,
editor e form) non sono montate da nessun `@main`. La loro `CryptoService` (il bug encrypt/decrypt
del report) e usata SOLO da questa UI morta: il percorso condiviso live non fa cifratura client-side
(legge dati gia decifrati dall'home-base via `/api/v1`).

## Decisione 1: artefatto e strategia macOS

ADOTTATO: il progetto Xcode `MediFlowAppleApp` diventa l'UNICA app universale
(iOS / iPadOS / macOS) via SwiftUI multipiattaforma nativo (un target con adattamenti
`#if os(macOS)`), dipendente da `MediFlowAppleShared`. I due eseguibili SPM vengono ritirati
una volta che i target Xcode coprono lo smoke (SPM resta come libreria + test).

Scartato: Mac Catalyst (porterebbe la shell iPhone su Mac, minore fedelta Liquid Glass) e
due artefatti separati (duplicazione e divergenza dal boundary `/api/v1`).

## Decisione 2: UI Mac morta

ADOTTATO: rimuovere/congelare la rich Mac UI non raggiungibile e ricostruire la superficie
macOS dalla root condivisa resa size-class aware. Prima della cancellazione vanno promosse
nel contratto `/api/v1` SOLO le semantiche davvero utili, e la logica pura riusabile va
spostata in `MediFlowAppleShared` (non cancellata).

Scartato: rianimare `PatientDetailView`/`LocalAPIClient` come superficie macOS (duplica la
logica e diverge dal client condiviso `HomeBasePatientsClient`).

## Validazione (secondo parere Codex, read-only)

Codex (codex-cli 0.142.3) ha confermato entrambe le scelte e aggiunto:
- Xcode = corsia di rilascio; ritirare gli eseguibili SPM solo dopo che Xcode copre lo smoke.
- SwiftUI multipiattaforma nativo, non Catalyst (root gia SwiftUI: meglio finestre, menu,
  sidebar, accessibilita, minore drift).
- Prima di cancellare la UI morta, promuovere le semantiche: copertura DTO completa incluso
  `statusReason`, `409 VERSION_CONFLICT` tipizzato, metadati version/deleted/restore,
  ricerca/filtri/ordinamento, endpoint catalogo (farmaci/esenzioni/ICD), create/update paziente,
  insight AI read/regenerate.
- Crypto NON e un P0 di percorso live (unico consumatore = UI morta): il vero P0 e
  target/entitlement/corsia-build/rimozione-codice-morto.
- "App universale" = una sola famiglia di rilascio Xcode, NON lo stesso albero di view identico
  su tutte le piattaforme. Compact: stack; iPad/macOS regular: vero `NavigationSplitView` 2/3 colonne.
- Anticipare uno split meccanico di `AppleFoundationViews.swift` (120KB) prima del redesign visivo.
- Fonti Apple usate: "Meet Liquid Glass" (WWDC25 session 219) e "Adopting Liquid Glass".

## Fase 0 (questa sessione): passi verificabili

1. Entitlement rete locale nel target spedibile: `NSBonjourServices = _mediflow-homebase._tcp`
   e `NSLocalNetworkUsageDescription` su iOS; equivalenti App Sandbox network su macOS.
2. Script di guardia di packaging che fallisce se gli entitlement mancano.
3. Wrapper `xcodegen generate` riproducibile (oggi il pbxproj e committato ma xcodegen non e
   in nessuno script: drift garantito).
4. Quarantena UI morta + ritiro ambiguita eseguibili SPM + preservazione logica pura,
   verificati con `swift build` + `swift test`.
5. Target macOS nativo nel progetto Xcode (montaggio root condivisa, bundling WebRuntime,
   supervisione home-base). Verifica con `xcodegen generate` + `xcodebuild` macOS.

Le semantiche esatte da preservare prima della cancellazione sono prodotte da un audit
multi-agente pre-cancellazione (vedi sezione che segue).

## Audit pre-cancellazione: cosa e stato preservato vs differito

Un workflow multi-agente (8 lettori paralleli + sintesi adversarial) ha mappato le ~12k righe
di UI Mac morta contro il client condiviso live. La sintesi ha anche corretto errori dei
sotto-agenti (es. PatientDetailView/AISettingsResolver NON sono live; X-MediFlow-Source-Surface
gia presente nel client live; il client morto usava /api/v1 mTLS mentre il live usa
/api/v1/network paired: contratti diversi, da verificare in Fase 1).

Preservato in MediFlowAppleShared (verificato, testato):
- ExemptionCodesCodec.swift (+ test) spostato verbatim: round-trip esenzioni (JSON-array o CSV).
- APIPatchValue.swift (nuovo): PatchValue<Value> tri-stato (.omit/.null/.value) + encodePatch.
- APIVersionConflict.swift (nuovo): VersionConflictPayload + VersionConflictSnapshot (409 WUL-308).
  Questi due sono il nucleo del contratto che la Fase 1 cabla in HomeBaseClientError + send().

Differito a Fase 1 (logica recuperabile da git, NON persa) perche legata a DTO morti che vanno
ri-agganciati ai tipi HomeBase* live (riconciliazione, non move meccanico):
- PatientsFiltering.swift (ricerca multi-termine + sort) -> legata a PatientSummary morto;
  ri-targetizzare su HomeBasePatientSummary quando si costruisce la lista pazienti (A2).
- ObservationEditorLogic.swift (merge LOINC/UCUM, current-value injection) -> legata a
  TerminologySearchItem/Create/UpdateObservationPayload morti; ri-agganciare ai DTO observation
  live (A6).
- Riconciliazione del vocabolario tipi/stati diario-terapia-checkup (i Paired*Status live sono un
  set diverso/superset rispetto agli 8 tipi morti): unificare in una sola fonte condivisa.
- Recupero: `git show 155bc8f6:native/MediFlowMac/Sources/MediFlowMac/<file>` (HEAD pre-branch).

Oncologia (A22): FREEZE fuori parita. Il cluster (engine + modelli + viste + store, ~3000 righe)
e un prototipo UserDefaults senza API ne controparte live. Cancellato col target morto;
le semantiche dell'engine (validazione booking, severita alert, macchina a stati pathway) sono
recuperabili da git (155bc8f6) e dal progetto separato OncoBackboneMac. Da ri-promuovere come
modulo dormiente solo se/quando la direzione neuro-oncologica entra nella roadmap dell'app universale.

## Fase 0: stato finale (questa sessione)

FATTO e VERIFICATO (toolchain Xcode-beta 27.0, SDK iOS/macOS 27, Liquid Glass WWDC26):
1. Artefatto unico: rimossi i due eseguibili SPM (MediFlowMac, MediFlowMobile) e l'intera UI Mac
   morta (~12k righe). Package.swift ora espone 1 sola libreria + 1 test target. `swift build` 1.5s.
2. Logica preservata + nuovo contratto in shared, 56 test verdi (incluso APIContractsTests nuovo).
3. Entitlement rete locale (NSBonjourServices=_mediflow-homebase._tcp + NSLocalNetworkUsageDescription)
   nei target iOS e macOS via project.yml; verificati nel bundle costruito.
4. Target macOS nativo aggiunto al progetto Xcode (MediFlowMacApp): `xcodebuild` macOS BUILD SUCCEEDED.
   App iOS (MediFlowMobileApp) BUILD SUCCEEDED su simulatore generico.
5. Script: generate-apple-xcodeproj.sh (xcodegen + guardie), check-apple-network-entitlements.sh,
   check-apple-structure.sh (impedisce il ritorno di eseguibili/UI morta). native-test.sh ora
   auto-seleziona un Xcode completo per XCTest.
6. Rimossi 143MB di artefatti stale in native/MediFlowMac/Build/. Script di build vecchi
   (build-native-app.sh, build-mobile-sim-app.sh) deprecati con puntatore al nuovo flusso.

DIFFERITO (follow-up tracciati, non bloccanti per il build lane):
- Packaging macOS WebRuntime: FATTO. scripts/build-apple-macos-app.sh costruisce l'app macOS
  (scheme MediFlowMacApp) e inietta il WebRuntime Next.js standalone + local-api-tls-proxy.mjs nel
  bundle. Verificato: il server.js bundlato gira con node e risponde HTTP 200 (Next.js 16.2.6).
  Il supervisor ora risolve anche node da nvm/fnm (oltre ai path standard e MEDIFLOW_NODE_BINARY),
  cosi l'app trova node su macchine senza node nei path di sistema. Resta per App Store: firma
  Developer ID + notarizzazione (lo script supporta MEDIFLOW_CODESIGN_IDENTITY) e decisione App
  Sandbox (l'app lancia un processo node figlio e bind una porta locale). Catena launch/watchdog
  storica da rifare se serve.
- CI nativa: workflow GitHub che esegua native-test.sh + xcodebuild iOS/macOS + le guardie.
- Doc da allineare: native-launch.md, mobile-home-base-smoke.md, apple-wide-parity-qa.md e il
  manifest apple-wide-qa-manifest.json (declassare le capability con sola evidenza simulatore/SPM).
- Fase 1: cablare PatchValue/VersionConflict nel client live + riconciliazione DTO/vocabolari +
  split di AppleFoundationViews.swift (120KB) prima del redesign visivo Vetro Clinico.

## Progresso parity (PR #271, branch feat/apple-universal-fase0)

Slice cliniche consegnate sopra la base (ognuna: logica pura unit-testata + XCUITest interazione
+ CI verde):
- A2: ricerca/filtro/sort lista pazienti (PatientsFiltering su HomeBasePatientSummary).
- A3: dettaglio paziente arricchito (data nascita, esenzioni via ExemptionCodesCodec, indirizzo/
  telefono/caregiver/ambulatorio, flag ADI/archiviato via InfoRow + chip non-glass).
- A5: filtro tipo voci diario + chip tipo per riga (EntryFiltering).
- A7: filtro stato terapie (TherapyFiltering).
- A8: filtro stato controlli (CheckupFiltering).

Infrastruttura test consolidata: seed Debug-only gated da MEDIFLOW_APPLE_UITEST_PATIENTS=1 (lista,
dettaglio, terapie, controlli, voci) per pilotare la UI senza pairing; identificatori stabili
(patient-cell-<id>, therapy-row-<id>, checkup-row-<id>, entry-row-<id>); 85 unit test + 8 XCUITest.

Aree ancora assenti/parziali verso parity totale: A4 anagrafica crea/modifica, A6 osservazioni
trend/picker, A7 DrugAutocomplete AIFA, A9 prescrizioni, A10 scale, A11 import/OCR, A12 AI insight,
A13 SISS/FSE, A14 ICD search, A15 analytics, A16 backup, A17 impostazioni complete, A18 ambulatori
picker, A19 sync offline bidirezionale, A20 onboarding, A22 oncologia. Restano
inoltre i follow-up Fase 1 (contratto live) e packaging App Store macOS (sandbox + notarizzazione).

## Fase 1 contratto: conferme dalla sorgente (web backend)

Due domande aperte dell'audit risolte leggendo la fonte di verita (non a indovinare):

1. **409 VERSION_CONFLICT FATTO e CONFERMATO**: il client live ora decodifica il body strutturato in
   `HomeBaseClientError.versionConflict(VersionConflictPayload)` (commit 3b934da5). Verificato che
   `VersionConflictPayload` combacia campo-per-campo con `lib/checkup-concurrency.ts`
   (`CheckupVersionConflictPayload`: error/code/entity/recordId/expectedVersion/currentVersion?/
   currentUpdatedAt?/currentState/currentSnapshot?) e con gli analoghi patient/therapy/entry/observation.
   Quindi la decodifica funziona contro il contratto REALE, non solo i mock.
2. **PatchValue SERVE (confermato)**: `lib/patient-write-normalization.ts` DISTINGUE campo-assente
   (`undefined` -> lasciato invariato, filtrato via riga 80) da campo-null (`null` -> azzera il campo).
   I payload Swift di update con optional semplici possono solo OMETTERE, mai mandare null esplicito,
   quindi NON possono azzerare un campo. La migrazione a `PatchValue` (omit/null/value) e necessaria
   per la correttezza ed e parte naturale del tier "create/update" (A4): PatchValue e l'encoding dei
   payload di update che A4 richiede. Da fare insieme, su branch di follow-up.
