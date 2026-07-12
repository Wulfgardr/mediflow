---
summary: "Apple platform guide: HIG/Liquid Glass mapping, SwiftUI structure, consolidation of VetroClinico.swift, native gaps and API references."
read_when:
  - "Working on native/MediFlowMac or MediFlowAppleShared UI, or reviewing native design parity."
---

# Piattaforma: Apple (iOS, iPadOS, macOS)

Contratto: outcome = client accoppiato con la stessa grammatica del web, reso con i mezzi nativi. Floor: iOS 17 / macOS 14, con Liquid Glass reale solo su OS 26+ dietro `#available` (già così). UI: SwiftUI, condivisa in `MediFlowAppleShared`, differenziata da size class e `#if os`.

Per macOS, il contratto Lume è mantenuto nella lane di destinazione separata. Questa guida descrive la baseline transitoria condivisa Apple.

## 1. Mappa superficie -> API

| Superficie | OS 26+ | Sotto il floor Liquid Glass |
| --- | --- | --- |
| Chrome (toolbar, tab bar, sidebar) | Componenti di sistema: sono già Liquid Glass da soli, non si replica a mano | Materiali di sistema standard |
| Card cliniche | Carta: fill `surface.elevated` + stroke, NIENTE `glassEffect` | Identico |
| Superfici di servizio (badge di stato runtime, capsule) | `VetroGlassModifier` (`.glassEffect(.regular, in:)`) | `.regularMaterial` (fallback già scritto) |
| Più elementi glass vicini | `GlassEffectContainer` (fusione e morphing con `glassEffectID`) | Non applicabile |
| Azione primaria / secondaria | `.buttonStyle(.glassProminent)` / `.buttonStyle(.glass)` | `.borderedProminent` / `.bordered` |
| Bordo scroll sotto barre | `scrollEdgeEffectStyle(.soft, for:)` | Comportamento di sistema |
| Conferme distruttive | `confirmationDialog` (già usato) con ruolo `.destructive` | Identico |

La legge dei materiali vale identica: le card che contengono dati clinici sono carta anche su Apple. `GlassCard` di `VetroClinico.swift` va rinominato/limitato di conseguenza: vetro per superfici di servizio, carta per la clinica (oggi il nome invita all'errore).

## 2. Consolidamento

1. **Un solo sistema di card**: `VetroClinico.swift` assorbe `CardStyleModifier` (`AppleFoundationStyle.swift`); i call-site di `.cardStyle()` migrano; il file legacy si ritira.
2. **`NavigationSplitView` per il workspace pazienti**: sostituisce il master-detail manuale di `PairedPatientsWorkspaceView` (HStack + colonna fissa 360pt). Con `List` nativa nella colonna si recuperano gratis selezione, swipe actions, pull-to-refresh, e la colonna diventa ridimensionabile su macOS.
3. **Spacchettare `PairedPatientsWorkspaceView`** (3365 righe al controllo corrente) in viste per dominio (lista, quadro paziente, diario, terapie, osservazioni): prerequisito per qualsiasi lavoro di design fine.
4. **Via gli artefatti di rollout dalla produzione**: le tab Overview/Milestones (`AppleFoundationOverviewView`) escono dal `TabView` utente (dietro build flag di sviluppo se servono ancora).
5. **`Color.red` -> `VetroPalette.tint(for: .critical)`** nei 2 punti noti; nessun colore diretto fuori da `VetroPalette`.
6. **Guardie di accessibilità** (dettaglio in [06-accessibilita.md](../06-accessibilita.md)): `accessibilityReduceTransparency` dentro `VetroGlassModifier`, passata `accessibilityLabel`/`accessibilityValue`, Dynamic Type agli estremi.

## 3. Idiomi da rispettare per piattaforma

- **macOS**: barra menu con comandi reali (nuova voce diario, ricerca, navigazione), scorciatoie `Cmd` coerenti con la mappa tastiera del cockpit ([04-interazione.md](../04-interazione.md)); `Settings` scene già presente; finestre multiple senza stato condiviso involontario; pieno supporto puntatore + hover.
- **iPadOS**: size class regular = split view; tastiera esterna supportata (stesse scorciatoie); target 44pt.
- **iOS**: `TabView` compatta attuale va bene; le azioni di riga diventano swipe actions con `List`; il privacy shield resta.
- **SF Symbols per le azioni cliniche**: copertura oggi bassa; adottare un set coerente e semantico (esempi: diario `text.book.closed`, terapie `pills`, parametri `waveform.path.ecg`, controlli `calendar.badge.clock`, elimina `trash`, esporta `square.and.arrow.up`), sempre affiancati al testo nelle azioni primarie.
- **Concentricità**: nei contenitori annidati usare le shape relative al contenitore dove l'API lo consente, invece di raggi fissi copiati dal web.

## 4. Riferimenti

- HIG Materials e sessioni WWDC25 su Liquid Glass (regole vetro/contenuto, Regular vs Clear).
- API: `glassEffect(_:in:)`, `GlassEffectContainer`, `glassEffectID`, `buttonStyle(.glass/.glassProminent)`, `scrollEdgeEffectStyle` (tutte 26.0+).
- Nota di prudenza: il ciclo 2026 (iOS 27/macOS 27) riduce la trasparenza di default e dà all'utente un regolatore di intensità; la nostra resa conservativa e i fallback sotto floor sono coerenti con quella direzione.
- Verifica: build + esercizio reale su simulatore/dispositivo con Xcode-beta (`DEVELOPER_DIR`, vedi `docs/native-testing.md`); gli screenshot delle Preview non bastano come prova per lavoro di interazione.
