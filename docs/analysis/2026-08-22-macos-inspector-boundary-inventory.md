---
summary: "WUL-563/WUL-566-WUL-568 inventory of the macOS patient-inspector boundary and current proof limits."
read_when:
  - "Preparing a collision matrix or a follow-up macOS inspector change."
  - "Evaluating whether inspector focus, accessibility, or macOS 27 compatibility is verified."
---

# Inventario dei confini dell'inspector macOS

Data: 2026-08-22

Scope: WUL-563, WUL-566, WUL-567 e WUL-568
Head ispezionata: `7a8f12c8c94ed2110f4c2a4b8150fd3924cb18c4`

Questo inventario separa il contratto nel codice dalle prove locali eseguite.
Non promuove la slice e non sostituisce una sessione VoiceOver reale.

## Contratti e file proprietari

| Area semantica | File | Contratto da preservare | Collisione da evitare |
| --- | --- | --- | --- |
| Stato per finestra | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/MacWorkspaceRootView.swift` | Ogni `MediFlowMacSceneModel` ha sezione e workspace propri; `@SceneStorage` conserva la visibilità dell'inspector nella scena. | Non spostare selezione o visibilità in stato app-globale. |
| Routing del comando | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/MacWorkspaceRootView.swift` | Toolbar, menu **Vista** e `⌥⌘I` leggono `clinicalWorkspaceInspectorAction` dalla scena focalizzata. | Non usare un singleton o una closure catturata dalla prima finestra. |
| Contenuto e compatibilità | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/MacPatientContextInspector.swift` | Major macOS `27` usa solo lo sheet compatibile; le altre major usano `.inspector`. Il contenuto è status-only e usa colori nativi neutri. | Non estendere il fallback a `28+`, non introdurre azioni applicative/headless, né colori Carta caldi. |
| Creazione finestre | `native/MediFlowAppleApp/Sources/MediFlowMacApp/MediFlowMacShellApp.swift` | Le due `WindowGroup` montano una `MediFlowMacWindow` con un proprio `@StateObject` di scena. | Non condividere il modello della scena tra primary e secondary window. |
| Prova unitaria | `native/MediFlowMac/Tests/MediFlowAppleSharedTests/MacWindowInspectorCommandTests.swift` | Copre l'indipendenza dei modelli e delle closure di toggle in memoria. | Non presentarla come prova AppKit di focus tra finestre. |
| Prova unitaria | `native/MediFlowMac/Tests/MediFlowAppleSharedTests/MacPatientContextInspectorTests.swift` | Copre major esatta, snapshot sintetico e resa neutra light/dark. | Non presentare `ImageRenderer` come audit dell'albero AX o come VoiceOver. |
| Probe AX P6 | `scripts/native-click-map-probe.swift` | Verifica identificatori e binding worklist/dettaglio nel bundle lanciato. | Il probe attuale non apre né ispeziona l'inspector; non è una ricevuta WUL-567/T3. |
| Contratto e stato | `docs/NATIVE.md`, `docs/design/lume/06-macos-apple-contract.md`, `docs/parity-matrix.md` | Carta è grammatica documentale neutra; focus, resize e VoiceOver dell'inspector restano `PARTIAL`. | Non convertire prove candidate o test unitari in un PASS di accessibilità. |

## Scala di prova applicata

| Livello | Comando o fonte | Esito | Cosa dimostra |
| --- | --- | --- | --- |
| Unità mirata | `swift test --package-path native/MediFlowMac --filter 'MacPatientContextInspectorTests|MacWindowInspectorCommandTests'` | PASS, 6/6 | Semantica della major, isolamento del modello, toggle in memoria, snapshot e resa sintetica. |
| AX del bundle | `npm run test:native:clickmap:probe -- --app-path <bundle>` | Non eseguito | Richiede bundle lanciato, permesso Accessibility e sessione macOS sbloccata. Inoltre il probe non copre l'inspector. |
| Due finestre reali | Sessione AppKit con primary e secondary window | Non rieseguito | Deve dimostrare che la finestra focalizzata cambia soltanto il proprio inspector. |
| VoiceOver reale | Percorso worklist → paziente → inspector | Non eseguito | Deve verificare ordine di focus, nome/valore annunciati e chiusura del pannello. |

## Limite di stop

Non modificare l'autorità dell'inspector per aumentare la copertura: resta una
superficie status-only. Un follow-up può aggiungere una prova AX dell'inspector
solo dopo avere definito il perimetro del probe e senza trattare tale prova come
sostituto di VoiceOver reale.
