# Audit iPad dopo l'integrazione con main

L'audit completo resta rosso. Non sono esclusi tipi di controllo o elementi dell'interfaccia. Il test raccoglie tutti i rilievi prima di terminare, così viene controllata anche Agenda dopo l'elenco pazienti.

## Causa e confine osservato

Il problema coinvolge la disposizione adattiva della scheda e la toolbar della colonna pazienti. Non basta sostituire il font o il contenitore del messaggio vuoto.

Nel simulatore iPad Pro 13 pollici, iOS 27.3, verticale, una prova ha cambiato la dimensione di **sistema** da Large a XXXL mentre l'app era aperta, senza l'override Dynamic Type di debug:

Il codice del prodotto in questa misura è il merge `ac1ac600b4ed666295e46a4dfe137c14b0b8c7dd`. La successiva correzione riguarda soltanto la conservazione delle allergie nella fixture di modifica anagrafica.

| Elemento | Large | XXXL |
| --- | --- | --- |
| Messaggio «Scegli un paziente…» | rettangolo 398 × 38 pt | rettangolo 389 × 77,5 pt |
| Testo «Recenti» | rettangolo 53 × 18,5 pt | assente dall'albero accessibile della pagina |
| Azioni della toolbar | gruppo visibile | comando con tre punti al posto del gruppo |

Il messaggio quindi cresce nella fascia standard. Il comando di ordinamento entra nell'overflow della barra di navigazione quando il gruppo non trova più spazio. La [cattura Large](ipad-audit-large.png) e la [cattura XXXL](ipad-audit-xxxl.png) sono originali del simulatore ed usano soltanto la fixture sintetica.

Per le dimensioni di accessibilità esiste inoltre un cambio esplicito di disposizione: [`PatientsWorkspaceLayout.usesSideBySide`](../../../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PatientsWorkspaceLayout.swift) restituisce `false`. Il messaggio senza selezione appartiene alla colonna dettaglio di [`PairedPatientsWorkspaceView`](../../../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift), che non resta visibile nell'elenco a una colonna. Questo passaggio è dedotto dal codice e dai test AX5 della colonna singola. La prova Large/XXXL non misura da sola tutti i passaggi nelle cinque dimensioni di accessibilità.

L'audit segnala come parzialmente non supportati entrambi i testi dello stato senza selezione e «Recenti». La misura del rettangolo del messaggio impedisce di interpretare questo esito come prova che il font rimanga sempre fisso. Resta da chiudere il rapporto tra la variazione di dimensione, i nodi che cambiano disposizione ed il controllo automatico di quei nodi.

Sono emersi anche due difetti visivi:

- **Contrasto di «Recenti» in Grafite:** testo `#e9ecef` sul fondo effettivamente renderizzato `#9ca5ba`, circa 2,1:1. Il fondo del controllo nativo non coincide con il token di selezione richiesto dal contenitore SwiftUI.
- **Testo tagliato nella voce «Pazienti» della barra laterale:** la barra ha larghezza fissa di 192 pt. L'etichetta con icona, spazio e segno di selezione deve adattarsi al testo più grande. Il punto responsabile è `sidebarButton` in [`AppleFoundationViews`](../../../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundationViews.swift).

Serve quindi rivedere il comportamento del gruppo della toolbar nella colonna stretta e delle etichette della barra laterale, conservando il cambio a una sola colonna e la destinazione del paziente. I tentativi locali su stile del menu, contenitore del messaggio, override della dimensione e font ereditato non hanno chiuso l'audit e sono stati rimossi. Questa PR conserva il residuo esplicito, senza presentare quei tentativi come correzioni.

## Riproduzione

Con Xcode beta e uno scratch APFS, dal checkout della PR:

```sh
export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
xcodebuild -jobs 6 \
  -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj \
  -scheme MediFlowMobileApp -configuration Debug \
  -destination 'platform=iOS Simulator,id=<iPad>' \
  -derivedDataPath '<scratch>/DerivedData' \
  -clonedSourcePackagesDirPath '<scratch>/packages' \
  -parallel-testing-enabled NO \
  -only-testing:MediFlowMobileAppUITests/MediFlowMobileAppUITests/testAccessibilityAuditCoversWorklistAndAgenda \
  -resultBundlePath '<scratch>/audit.xcresult' \
  CODE_SIGNING_ALLOWED=NO test
```

Per la variazione reale, il simulatore era avviato con `simctl bootstatus -b` completato. `xcrun simctl ui <iPad> content_size large` precedeva l'avvio dell'app. Al segnale della prova UI veniva eseguito `xcrun simctl ui <iPad> content_size extra-extra-extra-large`, poi venivano riletti i rettangoli e catturata la schermata. L'impostazione precedente è stata ripristinata. La prova di misura termina rossa sull'asserzione che «Recenti» resti presente, mentre l'asserzione di crescita del messaggio passa.

Il controllo isolato Dynamic Type sulla base assegnata era già rosso. Il residuo attuale non viene attribuito interamente al merge: le nuove prove ne descrivono i punti osservati dopo l'integrazione, senza dichiarare verificata tutta la UI della base corrente.
