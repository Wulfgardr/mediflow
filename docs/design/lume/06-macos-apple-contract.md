---
summary: "Contratto di destinazione Lume per macOS: struttura nativa, materiali, API Apple, availability, debito corrente, sequenza e verifiche."
read_when:
  - "Designing or implementing Lume on the MediFlow macOS app."
  - "Deciding where Liquid Glass, opaque clinical surfaces, sidebars, toolbars, inspectors, or Lume primitives belong on macOS."
---

# Lume su macOS: contratto Apple

Stato: contratto di destinazione per la futura superficie principale macOS.
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
| App prodotto | `MediFlowMacApp` ha deployment target macOS 14. `.inspector()` e quindi ammesso senza fallback nel target app. |
| Enhancement recente | Liquid Glass e le API geometriche/toolbar 26+ stanno dietro `#available(macOS 26, *)`; la struttura e la gerarchia non dipendono da esse. |
| Evidenza storica del candidato | Sul vecchio head PR #40, il run WUL-55 del 2026-07-12 con `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj -scheme MediFlowMacApp -configuration Debug -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build` restituì `BUILD SUCCEEDED` con SDK macOS 27 e target macOS 14. Non è prova fresca di questo packet docs-only né del runtime su `main`. |

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

Conseguenza: `CardStyleModifier` e `GlassCard` non possono rendere vetro il
contenuto clinico su OS 26+. Il percorso opaco attualmente usato come fallback
e piu vicino al contratto Lume del ramo recente.

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
| Le card cliniche usano `glassEffect` su OS 26+ | Candidato separato nel vecchio PR #40, non integrato in questo packet docs-only | Estrarre e verificare `clinicalCardStyle()` su un branch runtime dedicato; `cardStyle()` resterà alias transitorio e `GlassCard` sarà deprecata solo dopo quella promozione. |
| Il workspace pazienti interno e un `HStack` con colonna fissa 360pt | Confermato | Migrare a `NavigationSplitView` + `List(selection:)` come DS-2. |
| Non esiste `.inspector()` nel workspace | Confermato | Introdurlo dopo lo split, per contesto e drill-down. |
| Identita paziente scorre via e non esiste `safeAreaInset` | Confermato | Creare `TestataPaziente`; allergie richiedono prima verifica del contratto dati. |
| Il Registro non e applicato a dose/valore/codice/data | Confermato | Modifier `.registro()` e audit dei call-site. |
| La storia osservazioni e una sparkline senza assi o banda | Confermato | Non promuoverla come `RigaLaboratorio`; sostituirla solo con dati e fonti disponibili. |
| Pairing e credenziali occupano la colonna worklist | Confermato | Spostare la configurazione stabile in Settings; toolbar solo per stato/azione. |

La coda dell'attenzione, la testata con allergie e la baseline personale non
sono solo resa: richiedono contratti di dominio. Restano gated e non vengono
simulate con dati inventati.

## 7. Sequenza macOS

1. **M0, canone**: questo contratto, availability, debito corrente e gate.
2. **M1, primitive additive**: `LumePalette`, `LumeSurface`, `.registro()` e
   card clinica opaca; nessuna riorganizzazione funzionale.
3. **M2, struttura desktop**: `NavigationSplitView`, `List(selection:)`,
   workspace spacchettato e pairing fuori dalla worklist.
4. **M3, sicurezza di contesto**: `TestataPaziente` persistente con i soli dati
   realmente disponibili e blocco esplicito se il contesto e incerto.
5. **M4, densita a strati**: inspector e provenienza senza perdere la selezione.
6. **M5, firma Lume**: filo, fuoco e motion sobri, dopo la prova della struttura.

La prima slice eseguibile resta sotto circa 300 LOC e non combina M1 con M2.
Scelta candidata: primitive additive + Registro sui call-site esistenti, oppure
la sola correzione delle card cliniche. La scelta finale richiede issue Linear
dedicata e prova visuale prima del commit.

Il vecchio PR #40 contiene un candidato separabile per la sola correzione delle
card custom, senza cambiare navigazione, parity o contratti. Quel candidato e il
relativo test sintetico light/dark non fanno parte di questo packet docs-only:
devono essere estratti su un branch runtime dedicato e rieseguiti su base fresca
prima di poter dichiarare M1 consegnata.

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
