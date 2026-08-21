---
summary: "Contratto di destinazione Lume per macOS: struttura nativa, materiali, API Apple, availability, debito corrente, sequenza e verifiche."
read_when:
  - "Designing or implementing Lume on the MediFlow macOS app."
  - "Deciding where Liquid Glass, opaque clinical surfaces, sidebars, toolbars, inspectors, or Lume primitives belong on macOS."
---

# Lume su macOS: contratto Apple

Stato: contratto di destinazione per la futura superficie principale macOS.

## Decisione esplorativa WUL-565

La slice WUL-565 adotta **Strumento su Carta** come default esplorativo macOS:
chrome, toolbar, menu e inspector restano componenti di sistema. Carta indica
la funzione semantica del contenuto clinico, non una palette o un materiale
caldo. I blocchi dell'inspector usano `controlBackgroundColor` e
`separatorColor`: colori neutrali nativi che seguono light mode, dark mode e le
impostazioni del sistema. La slice non usa crema, beige, avorio, texture, ombre
da foglio o altre rese skeuomorfiche.

La correzione cromatica e accettata per WUL-565. La scelta identitaria piu
ampia resta `PROPOSED_FOR_OWNER_REVIEW`: non approva una nuova identita di
prodotto, non definisce la densita di tutte le viste e resta reversibile.

L'inspector espone solo contesto locale e stato di autorita. Non aggiunge
azioni headless e non attribuisce privilegi a Mini o CLI. Ogni futura azione
resta gated dai contratti WUL-557 e WUL-518.
Questo documento applica [ADR 0078](../../adr/0078-lume-lingua-di-design-di-destinazione.md)
alla app reale `MediFlowMacApp`. Non governa la feature parity, che resta in un
workstream separato, e non attiva le lane Windows/Linux.

## 1. Outcome e confini

L'app macOS deve diventare la superficie primaria di lavoro MediFlow senza
sembrare un port del web o un iPad ingrandito. Condivide con le altre superfici
semantica, dati, contratti e identita Lume; usa pero struttura, controlli,
comandi, densita e materiali propri di macOS.

Vincoli:

- SwiftUI e il default; AppKit entra solo per un comportamento desktop che
  SwiftUI non esprime in modo stabile.
- Il sistema possiede finestre, sidebar, toolbar, menu, sheet, popover,
  selezione, focus e inspector.
- Lume possiede contenuto clinico, fuoco, filo, Registro, segnali e provenienza.
- Nessun dato reale o screenshot con PHI/PII entra nelle prove di design.
- Nessun selettore di stile utente: i registri seguono sistema e contesto.

## 2. Fonti Apple e availability

Fonti ufficiali verificate con Apple Docs MCP il 2026-07-12:

- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass): standard components first, rimozione dei background custom che interferiscono con il materiale, spaziature di sistema, uso parco del vetro custom, test con Reduce Transparency e Reduce Motion.
- [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views): `glassEffect`, `GlassEffectContainer`, interattivita, morphing e limiti di performance.
- [NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview): disponibile da macOS 13.
- [inspector](https://developer.apple.com/documentation/swiftui/view/inspector(ispresented:content:)): disponibile da macOS 14.
- [glassEffect](https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)), [ToolbarSpacer](https://developer.apple.com/documentation/swiftui/toolbarspacer), [ConcentricRectangle](https://developer.apple.com/documentation/swiftui/concentricrectangle) e [ScrollEdgeEffectStyle](https://developer.apple.com/documentation/swiftui/scrolledgeeffectstyle): disponibili da macOS 26.

Matrice operativa:

| Livello | Contratto |
| --- | --- |
| Package condiviso | `MediFlowMac/Package.swift` conserva macOS 13 per il codice condiviso. |
| App prodotto | `MediFlowMacApp` ha deployment target macOS 14. Usa `.inspector()` su macOS 14-26; macOS 13 del package e il runtime beta macOS 27 usano la sheet compatibile, perché su quest'ultimo l'API entra in un ciclo di layout riprodotto anche con contenuto minimo. |
| Enhancement recente | Liquid Glass e le API geometriche/toolbar 26+ stanno dietro `#available(macOS 26, *)`; la struttura e la gerarchia non dipendono da esse. |
| Evidenza del ramo card opaca | La correzione delle card cliniche opache e il suo test sono poi atterrati su `main` (PR #46). Un run storico WUL-55 del 2026-07-12 sul vecchio head PR #40 (`DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj -scheme MediFlowMacApp -configuration Debug -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build`) aveva dato `BUILD SUCCEEDED` con SDK macOS 27 e target macOS 14; questo packet docs-only non riesegue la build. |

## 3. Disposizione della finestra

La disposizione di destinazione e desktop-native:

1. **Sidebar di sistema**: navigazione primaria e worklist, tramite
   `NavigationSplitView` e `List(selection:)`. Riga piatta, una icona al
   massimo, titolo forte e una sola riga secondaria. La selezione resta quella
   di macOS; il filo non la sostituisce.
2. **Workbench clinico**: il dettaglio e la zona focale Lume. Superfici
   cliniche opache, densita professionale, testata paziente persistente e
   contenuto organizzato per decisione, non per dashboard di card.
3. **Inspector di sistema**: contesto, provenienza, filtri o modifica
   dell'oggetto selezionato senza perdere il punto. Non diventa una terza
   navigazione permanente.
4. **Toolbar e menu**: azioni frequenti e globali, raggruppate per responsabilita.
   Comandi importanti disponibili anche da menu e tastiera. Pairing e
   configurazione operativa non occupano stabilmente la worklist.
5. **Settings scene**: configurazione home-base, pairing, cataloghi e
   preferenze. Il contenuto clinico non viene mescolato alla configurazione.

## 4. Legge dei materiali macOS

| Superficie | Resa |
| --- | --- |
| Sidebar, toolbar, sheet, popover, menu | Componenti di sistema. Su macOS 26+ ricevono Liquid Glass dal sistema; niente fill o blur custom sopra. |
| Card e pannelli clinici | Opachi: `field` o `focal`, bordo reale, ombra solo sul fuoco quando la prova nel bundle la giustifica. Mai `glassEffect`. |
| Controllo custom eccezionale | `glassEffect` solo se e davvero un controllo funzionale sopra il contenuto, con pochi effetti, stesso `GlassEffectContainer` e availability 26+. |
| Overlay sotto macOS 26 | Materiale di sistema o resa opaca coerente; il task resta comprensibile senza traslucenza. |
| Reduce Transparency / Motion | I componenti standard si adattano automaticamente; ogni resa custom deve avere un equivalente solido e senza morphing. |

Conseguenza: le card cliniche che adottano `clinicalCardStyle()` non sono rese a
vetro su nessun OS. La primitiva e opaca e condivisa, `cardStyle()` ne e alias e
`GlassCard` e deprecata e resa opaca (PR #46): per queste card il percorso opaco
non e piu un fallback ma il contratto.

## 5. Spaziatura, controlli e tipografia

- Usare prima spacing, padding, row height e control size dei componenti
  standard. I token Lume regolano il contenuto custom, non sovrascrivono le
  metriche del chrome.
- Su macOS la densita e pointer/keyboard-first. Il target 44pt resta un vincolo
  touch per iPhone/iPad, non l'altezza universale delle righe desktop.
- Pulsanti, picker, menu, search, form e confirmation dialog restano standard;
  niente capsule o card custom per rendere moderna un'azione gia nativa.
- SF Pro e la Voce. SF Mono con cifre tabellari e il Registro per dosi, valori,
  codici, date, orari e identificativi verificabili.
- Il colore non distingue struttura o selezione: resta riservato a segnale
  clinico, stato e azione realmente prominente.
- Le geometrie custom 26+ usano `ConcentricRectangle`; sotto il floor recente
  usano shape continue con valori tokenizzati, senza imitare il contorno della
  finestra.

## 6. Audit della shell corrente

Confermato localmente e contro-rivisto da Opus 4.8 max:

| Finding | Stato | Destinazione |
| --- | --- | --- |
| Le card cliniche usano `glassEffect` su OS 26+ | Risolto (PR #46): `clinicalCardStyle()` rende opaca la card clinica su ogni OS, `cardStyle()` è alias di compatibilità e `GlassCard` è deprecata e resa opaca | Consolidare le primitive Lume (`LumeSurface`/`LumeCard`) resta lavoro separato. |
| Il workspace pazienti interno è un `HStack` con colonna fissa 360pt | Risolto nella slice M2a (#74) | `NavigationSplitView` + `List(selection:)` usano l'ID paziente stabile; la visibilità `.all` ripristina la worklist quando si rientra dalla sidebar clinica e il dettaglio resta opaco. |
| Non esiste `.inspector()` nel workspace | Slice WUL-565 implementata: inspector contestuale su macOS 14-26, sheet equivalente su macOS 13 e sul runtime beta macOS 27, superfici cliniche neutrali native | Build bundle, test sintetici e percorso AX del fallback sono provati. Restano da chiudere VoiceOver narrato e isolamento focus tra due finestre; il pannello resta status-only. |
| Identità paziente scorre via e non esiste `safeAreaInset` | Implementato nella slice M2b (#106): testata `focal` persistente con nome, codice abbreviato, età se nota e aggiornamento; heading AX autonomo. Il probe interattivo finale resta un gate separato | Le allergie restano escluse finché il contratto dati non espone un valore strutturato affidabile. |
| Il Registro non e applicato a dose/valore/codice/data | Confermato | Modifier `.registro()` e audit dei call-site. |
| La storia osservazioni e una sparkline senza assi o banda | Confermato | Non promuoverla come `RigaLaboratorio`; sostituirla solo con dati e fonti disponibili. |
| Pairing e credenziali occupano la colonna worklist | Confermato | Spostare la configurazione stabile in Settings; toolbar solo per stato/azione. |

La coda dell'attenzione, la testata con allergie e la baseline personale non
sono solo resa: richiedono contratti di dominio. Restano gated e non vengono
simulate con dati inventati.

## 7. Sequenza macOS

1. **M0, canone**: questo contratto, availability, debito corrente e gate.
2. **M1, primitive additive**: `LumePalette`, `LumeSurface`, `.registro()` e
   card clinica opaca; nessuna riorganizzazione funzionale. Consegnata finora
   solo la card clinica opaca (PR #46); le altre primitive restano aperte.
3. **M2, struttura desktop**: la slice M2a (#74, stabilizzata in #94) consegna
   `NavigationSplitView` e `List(selection:)`; la slice M2b (#106) aggiunge la
   testata paziente persistente nel dettaglio macOS con i soli dati disponibili,
   senza cambiare iOS/iPadOS. Il controllo AX diretto è verde sulla fixture
   sintetica; il run interattivo finale resta da eseguire separatamente.
   Spostare il pairing fuori dalla worklist resta una slice distinta.
4. **M3, sicurezza di contesto avanzata**: allergie e altri segnali invariabili
   entrano solo dopo un contratto dati strutturato; nessuna inferenza dalla prosa.
5. **M4, densita a strati**: WUL-565 consegna la prima slice di inspector e
   provenienza senza perdere la selezione, con visibilita per finestra e comando
   focalizzato. Non chiude M4: VoiceOver narrato, isolamento focus tra due
   finestre, pairing in Settings e qualunque azione headless restano aperti.
6. **M5, firma Lume**: filo, fuoco e motion sobri, dopo la prova della struttura.

La prima slice, atterrata con PR #46, e la correzione delle card cliniche opache
(`clinicalCardStyle()`, alias `cardStyle()`, `GlassCard` deprecata) con test
sintetico light/dark (`ClinicalCardStyleTests`) e build del bundle macOS
(PR #46), senza cambiare navigazione, parity o contratti. Il test e sintetico,
non una QA manuale completa dei gate qui sotto.

Le slice M2a e M2b restano separate: #74/#94 possiedono lo split desktop, #106
possiede la testata persistente e WUL-565 possiede l'inspector status-only.
Spostamento del pairing e segnali clinici senza contratto dati restano
esplicitamente aperti; il debito documentale sulle primitive M1 viene
riconciliato nel follow-up docs finale di #68.

## 8. Gate di verifica

- Build del bundle reale `MediFlowMacApp`, non solo `swift build` del package.
- Run macOS con selezione, resize continuo, sidebar, focus, toolbar, menu e
  Settings esercitati con pointer e tastiera.
- Light/dark, Increase Contrast, Reduce Transparency e Reduce Motion.
- VoiceOver sul percorso worklist -> paziente -> sezione -> inspector.
- Finestra minima 1120x760 e resize piu ampio; nessun dato o azione essenziale
  nascosto da un pannello fisso.
- Screenshot sintetici prima/dopo e verifica dei contrast ratios per ogni
  coppia testo/superficie Lume.
- Gli `accessibilityIdentifier` esistenti restano stabili salvo migrazione
  esplicita dei test.
