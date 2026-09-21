---
summary: "Contratto di destinazione Lume per macOS: struttura nativa, materiali, API Apple, availability, debito corrente, sequenza e verifiche."
read_when:
  - "Designing or implementing Lume on the MediFlow macOS app."
  - "Deciding where Liquid Glass, opaque clinical surfaces, sidebars, toolbars, inspectors, or Lume primitives belong on macOS."
---

# Lume su macOS: contratto Apple

Questo è il contratto di destinazione della futura superficie principale macOS: applica [ADR 0078](../../adr/0078-lume-lingua-di-design-di-destinazione.md) all'app reale `MediFlowMacApp`, senza governare la parità funzionale, affidata a un filone separato, né attivare le lane Windows/Linux.

## Decisione corrente: Carta neutrale

ADR 0078 ha già escluso la direzione calda/carta "Referto". Nella slice WUL-566/WUL-567, **Carta** va quindi intesa come organizzazione documentale del contenuto clinico: gerarchia tipografica, continuità, spazio, hairline e poca elevazione, non crema, beige, avorio, parchment, texture o ombre da foglio. Coerentemente, l'inspector usa `controlBackgroundColor` e `separatorColor`, colori nativi neutrali che si adattano a light/dark mode.

La shell conserva un modello per finestra, così che toolbar, menu Vista e `⌥⌘I` agiscano attraverso la scena focalizzata. Il percorso predefinito usa l'inspector di sistema; soltanto la major esatta macOS 27 ricorre a uno sheet, per evitare il loop di layout osservato nel runtime beta. Da macOS 28 si torna all'inspector nativo, finché una nuova prova non renda necessaria un'altra eccezione.

Il pannello mostra soltanto lo stato: non autorizza azioni. Il manifest Mini di PR #184, SHA `3fd988bafe71a058fdd7d3c25ea569793dcba903`, conserva infatti la shell a `sourceRow: 32`, `miniDisposition: manual_only`, `miniCommands: []`, con motivo `NOT_IN_MINI_PILOT`. Applicare questo contratto non abilita comandi Mini, azioni headless o parità macOS; per introdurre in futuro un'azione inspector Mini o headless occorre una modifica esplicita del manifest e dell'autorità.

<a id="1-outcome-e-confini"></a>

## 1. Risultato atteso e confini

L'app macOS deve diventare la superficie primaria di lavoro di MediFlow senza riprodurre il web o ingrandire un'interfaccia iPad. La condivisione riguarda semantica, dati, contratti e identità Lume; struttura, controlli, comandi, densità e materiali devono invece appartenere al modo di lavorare di macOS.

Vincoli:

- SwiftUI è la scelta predefinita; AppKit interviene solo quando serva un comportamento desktop che SwiftUI non esprima stabilmente.
- Finestre, sidebar, toolbar, menu, sheet, popover, selezione, focus e inspector appartengono al sistema.
- Lume governa contenuto clinico, fuoco, filo, Registro, segnali e provenienza.
- Le prove di design non devono contenere dati reali né screenshot con PHI/PII.
- Non è ammesso un selettore di stile utente: i registri seguono sistema e contesto.

<a id="2-fonti-apple-e-availability"></a>

## 2. Fonti Apple e disponibilità delle API

La verifica delle fonti ufficiali Apple riportata qui è stata svolta con Apple Docs MCP il 2026-07-12:

- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass): privilegiare componenti e spaziature di sistema, rimuovere i background custom che interferiscono con il materiale, limitare il vetro custom e verificare Reduce Transparency e Reduce Motion.
- [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views): `glassEffect`, `GlassEffectContainer`, interattività, morphing e limiti di performance.
- [NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview): disponibile da macOS 13.
- [inspector](https://developer.apple.com/documentation/swiftui/view/inspector(ispresented:content:)): disponibile da macOS 14.
- [glassEffect](https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)), [ToolbarSpacer](https://developer.apple.com/documentation/swiftui/toolbarspacer), [ConcentricRectangle](https://developer.apple.com/documentation/swiftui/concentricrectangle) e [ScrollEdgeEffectStyle](https://developer.apple.com/documentation/swiftui/scrolledgeeffectstyle): disponibili da macOS 26.

Matrice operativa:

| Livello | Contratto |
| --- | --- |
| Package condiviso | `MediFlowMac/Package.swift` conserva macOS 13 per il codice condiviso. |
| App prodotto | `MediFlowMacApp` ha deployment target macOS 14. Usa `.inspector()` per default; soltanto la major esatta macOS 27 usa lo sheet compatibile. macOS 28+ torna al percorso nativo. |
| Enhancement recente | Liquid Glass e le API geometriche/toolbar 26+ stanno dietro `#available(macOS 26, *)`; la struttura e la gerarchia non dipendono da esse. |
| Evidenza del ramo card opaca | La correzione delle card cliniche opache e il suo test sono poi atterrati su `main` (PR #46). Un run storico WUL-55 del 2026-07-12 sul vecchio head PR #40 (`DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj -scheme MediFlowMacApp -configuration Debug -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build`) aveva dato `BUILD SUCCEEDED` con SDK macOS 27 e target macOS 14; questo packet docs-only non riesegue la build. |

## 3. Disposizione della finestra

### Proposta macOS 0.8.6 del 6 settembre

La proposta nasce dal giudizio che la revisione visiva precedente fosse ancora troppo vicina alla struttura originaria. Nel candidato successivo le aree dell'app passano quindi a una barra superiore compatta e rimane **una sola sidebar**, dedicata ai pazienti. Il resto della finestra è occupato dalla cartella, con testata opaca continua, indice visibile delle sette sezioni e contenuto non racchiuso in un involucro arrotondato uniforme. Controlli nativi e menu delle aree secondarie mantengono raggiungibili tutte le funzioni; i titoli brevi della navigazione non sostituiscono né i nomi completi delle sezioni né le etichette accessibili.

La disposizione traduce per il Mac vicinanza, orientamento e profondità progressiva della [raccolta illustrata Breccia](../2026-09-06-breccia-apple-reference.md): è una proposta del progetto, non un layout prescritto dai video. Nel candidato 0.8.6 sostituisce la doppia colonna di navigazione descritta sotto, senza cambiare l'assegnazione delle responsabilità ai componenti di sistema. Restano invariati modello per finestra, writer, capability, inspector status-only e ciclo di vita della registrazione; iOS/iPadOS conservano il proprio percorso. Compilazione e osservazione di questa disposizione devono essere documentate separatamente dalle prove funzionali del candidato precedente.

La struttura di destinazione assegna a ciascuna parte della finestra una responsabilità desktop nativa:

1. **Sidebar di sistema**: navigazione primaria e worklist usano `NavigationSplitView` e `List(selection:)`. Le righe sono piatte, con al massimo un'icona, titolo forte e una sola riga secondaria. Il filo non sostituisce la selezione di macOS.
2. **Workbench clinico**: il dettaglio costituisce il fuoco Lume, con superfici cliniche opache, densità professionale e testata paziente persistente. Il contenuto si organizza per decisione, non come dashboard di card.
3. **Inspector di sistema**: permette di approfondire contesto, provenienza e filtri o modificare l'oggetto selezionato senza perdere il punto; non diventa una terza navigazione permanente.
4. **Toolbar e menu**: raccolgono le azioni frequenti e globali per responsabilità, mantenendo quelle importanti disponibili anche da menu e tastiera. Pairing e configurazione operativa non devono occupare stabilmente la worklist.
5. **Settings scene**: contiene configurazione home-base, pairing, cataloghi e preferenze, senza mescolarli al contenuto clinico.

## 4. Legge dei materiali macOS

| Superficie | Resa |
| --- | --- |
| Sidebar, toolbar, sheet, popover, menu | Componenti di sistema. Su macOS 26+ ricevono Liquid Glass dal sistema; niente fill o blur custom sopra. |
| Card e pannelli clinici | Opachi: `field` o `focal`, bordo reale, ombra solo sul fuoco quando la prova nel bundle la giustifica. Mai `glassEffect`. |
| Controllo custom eccezionale | `glassEffect` solo se e davvero un controllo funzionale sopra il contenuto, con pochi effetti, stesso `GlassEffectContainer` e availability 26+. |
| Overlay sotto macOS 26 | Materiale di sistema o resa opaca coerente; il task resta comprensibile senza traslucenza. |
| Reduce Transparency / Motion | I componenti standard si adattano automaticamente; ogni resa custom deve avere un equivalente solido e senza morphing. |

Le card che adottano `clinicalCardStyle()` sono quindi opache su ogni OS. La primitiva è condivisa, `cardStyle()` ne è l'alias e `GlassCard` è deprecata e resa opaca da PR #46: per queste card l'opacità è il contratto, non più un ripiego.

## 5. Spaziatura, controlli e tipografia

- Usare anzitutto spacing, padding, row height e control size dei componenti standard. I token Lume regolano il contenuto custom, senza sovrascrivere le metriche del chrome.
- Su macOS la densità serve prima di tutto puntatore e tastiera. Il target 44pt rimane un vincolo touch per iPhone/iPad, non l'altezza universale delle righe desktop.
- Mantenere standard pulsanti, picker, menu, search, form e confirmation dialog: non aggiungere capsule o card custom a un'azione già nativa per cambiarne soltanto l'aspetto.
- SF Pro costituisce la Voce; SF Mono con cifre tabellari costituisce il Registro per dosi, valori, codici, date, orari e identificativi verificabili.
- Il colore rimane riservato al segnale clinico, allo stato e all'azione realmente prominente; non distingue struttura o selezione.
- Le geometrie custom 26+ usano `ConcentricRectangle`; sotto quella soglia usano shape continue con valori tokenizzati, senza imitare il contorno della finestra.

## 6. Audit della shell corrente

La ricognizione seguente è stata confermata localmente e sottoposta a contro-revisione di Opus 4.8 max:

| Finding | Stato | Destinazione |
| --- | --- | --- |
| Le card cliniche usano `glassEffect` su OS 26+ | Risolto (PR #46): `clinicalCardStyle()` rende opaca la card clinica su ogni OS, `cardStyle()` è alias di compatibilità e `GlassCard` è deprecata e resa opaca | Consolidare le primitive Lume (`LumeSurface`/`LumeCard`) resta lavoro separato. |
| Il workspace pazienti interno è un `HStack` con colonna fissa 360pt | Risolto nella slice M2a (#74) | `NavigationSplitView` + `List(selection:)` usano l'ID paziente stabile; la visibilità `.all` ripristina la worklist quando si rientra dalla sidebar clinica e il dettaglio resta opaco. |
| Non esiste `.inspector()` nel workspace | Risolto nella slice WUL-566/WUL-567 con inspector status-only neutrale e stato per finestra | Test focalizzati, suite nativa, build Xcode e screenshot sintetici light/dark passano. Focus, resize e VoiceOver interattivi della slice restano `PARTIAL` perché la sessione del run era bloccata. |
| Identità paziente scorre via e non esiste `safeAreaInset` | Implementato nella slice M2b (#106): testata `focal` persistente con nome, codice abbreviato, età se nota e aggiornamento; heading AX autonomo. Il probe interattivo finale resta un gate separato | Le allergie restano escluse finché il contratto dati non espone un valore strutturato affidabile. |
| Il Registro non e applicato a dose/valore/codice/data | Confermato | Modifier `.registro()` e audit dei call-site. |
| La storia osservazioni e una sparkline senza assi o banda | Confermato | Non promuoverla come `RigaLaboratorio`; sostituirla solo con dati e fonti disponibili. |
| Pairing e credenziali occupano la colonna worklist | Confermato | Spostare la configurazione stabile in Settings; toolbar solo per stato/azione. |

Coda dell'attenzione, testata con allergie e baseline personale dipendono da contratti di dominio, non soltanto dalla resa. Restano pertanto subordinate a quei contratti e non devono essere simulate con dati inventati.

## 7. Sequenza macOS

1. **M0, canone**: definire attraverso questo contratto disponibilità delle API, debito e gate.
2. **M1, primitive additive**: introdurre `LumePalette`, `LumeSurface`, `.registro()` e card clinica opaca, senza riorganizzazione funzionale. Nel quadro descritto è consegnata soltanto la card clinica opaca (PR #46); le altre primitive restano aperte.
3. **M2, struttura desktop**: M2a (#74, stabilizzata in #94) consegna `NavigationSplitView` e `List(selection:)`; M2b (#106) aggiunge la testata paziente persistente al dettaglio macOS usando soltanto i dati disponibili, senza modificare iOS/iPadOS. Il controllo AX diretto è verde sulla fixture sintetica; il run interattivo finale rimane una prova separata da eseguire. Anche lo spostamento del pairing fuori dalla worklist resta una slice distinta.
4. **M3, sicurezza di contesto avanzata**: allergie e altri segnali invariabili entrano solo dopo la definizione di un contratto dati strutturato; non si inferiscono dalla prosa.
5. **M4, densità a strati**: WUL-566/WUL-567 consegnano la prima slice status-only di inspector e provenienza, conservando la selezione. M4 non è chiusa, perché focus, resize e VoiceOver interattivi devono ancora essere esercitati.
6. **M5, firma Lume**: introdurre filo, fuoco e movimento sobri soltanto dopo la prova della struttura.

La prima slice, integrata con PR #46, corregge le card cliniche opache senza cambiare navigazione, parità o contratti: `clinicalCardStyle()` è la primitiva, `cardStyle()` l'alias e `GlassCard` il componente deprecato. La prova comprende il test sintetico light/dark `ClinicalCardStyleTests` e la build del bundle macOS (PR #46); non equivale a una QA manuale completa dei gate seguenti.

Le responsabilità delle slice restano distinte: #74/#94 possiedono lo split desktop M2a, #106 la testata persistente M2b e WUL-566/WUL-567 la prima slice inspector status-only. Restano esplicitamente aperti spostamento del pairing, azioni inspector e segnali clinici privi di contratto dati.

## 8. Gate di verifica

- Compilare il bundle reale `MediFlowMacApp`, non soltanto eseguire `swift build` sul package.
- Eseguire l'app macOS ed esercitare con puntatore e tastiera selezione, resize continuo, sidebar, focus, toolbar, menu e Settings.
- Verificare light/dark, Increase Contrast, Reduce Transparency e Reduce Motion.
- Percorrere con VoiceOver worklist -> paziente -> sezione -> inspector.
- Provare la finestra minima 1120x760 e dimensioni maggiori: nessun pannello fisso deve nascondere dati o azioni essenziali.
- Acquisire screenshot sintetici prima/dopo e misurare il rapporto di contrasto di ogni coppia testo/superficie Lume.
- Conservare gli `accessibilityIdentifier` esistenti, salvo migrazione esplicita dei test.