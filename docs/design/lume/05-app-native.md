---
summary: "Lume for the native apps: SwiftUI mapping for Apple, compact/mobile grammar, and prospective notes for Windows and Linux."
read_when:
  - "Implementing Lume on the Apple paired client or planning the tri-OS clients."
  - "Deciding how a Lume concept (fuoco, filo, registri, coda) maps to SwiftUI, WinUI, or GTK."
---

# Lume nelle app native

Lume nasce multipiattaforma per costruzione, ma la delivery corrente e Apple-first e macOS-first. Questo documento traduce la lingua per le app: l'app Apple accoppiata, la grammatica compatta iPhone e, solo come nota prospettica, i client tri-OS futuri. Il contratto operativo macOS e in [06-macos-apple-contract.md](./06-macos-apple-contract.md). Feature parity e delivery Windows/Linux restano fuori da questo filone.

## 1. Apple: mappa dei concetti

| Concetto Lume | SwiftUI |
| --- | --- |
| Registri giorno/grafite | Color assets light/dark: `LumePalette` (canvas/field/focal/chrome, ink, minerale) segue `colorScheme` di sistema |
| Registro guardia | Raffinamento del dark: variante dei token attivata da contesto (ambiente `lumeGuardia`), mai un tema utente in più |
| Buio operativo (chrome) | Le superfici di sistema restano di sistema: sidebar di `NavigationSplitView`, toolbar e tab bar NON si ridipingono (su OS 26+ sono Liquid Glass nativo: è l'idioma della piattaforma, e per Lume il chrome deve solo recedere). Il buio operativo si applica alle superfici di telaio CHE COSTRUIAMO NOI (rail custom, barre interne) |
| Penombra (field) | Colonna lista e pannelli non focali: fondo `field`, bordo sottile, niente ombra |
| Fuoco (focal) | Pannello attivo: fondo `focal`, ombra corta (`shadow(radius: 4, y: 2)` a bassa opacità), filo sul bordo di testa |
| Il filo | Capsule 2pt sul leading edge dell'oggetto focale (overlay su riga/pannello); timeline con linea verticale custom; tratteggio bozza con `StrokeStyle(dash:)`; continuità Quadro -> Scheda con `matchedGeometryEffect` sul filo e sull'identità paziente |
| La Voce | SF Pro via stili semantici (Dynamic Type gratis, optical sizing già nel font) |
| Il Registro | SF Mono: un modifier `.registro()` che applica `.monospaced()` + `monospacedDigit()`; OBBLIGATORIO su dosi, valori, codici, date e orari |
| Overlay transitori | Sheet e popover di sistema (vetro nativo su OS 26+: è l'eccezione ammessa dalla lingua) |
| Scrim | Dim di sistema dei sheet |

## 2. Apple: da VetroClinico.swift a LumeKit

`VetroClinico.swift` evolve in `Lume.swift` (LumeKit), la libreria di primitive della lingua (regola "primitive prima dei dashboard", [04-perlustrazione.md](./04-perlustrazione.md)):

| Oggi | Domani | Nota |
| --- | --- | --- |
| `VetroGlassModifier` | `LumeSurface(zone:)` | Rende canvas/field/focal/chrome; niente `glassEffect` sulle superfici strutturali; la guardia `accessibilityReduceTransparency` resta per gli overlay |
| `GlassCard` | `LumeCard(zone:)` | Opaca, bordo 1px, ombra solo se focale |
| `StatusBadge`, `VetroTone`/`VetroPalette` | Invariati nei valori, rinominati `LumeTone`/`LumePalette` | I segnali clinici non cambiano |
| `InfoRow` | `RigaLista` | Altezza 44pt touch, filo di selezione, cifre tabellari |
| (nuovo) | `TestataPaziente` | Identità verificabile (nome, anno, identificativo, allergie), compressa in compact, `safeAreaInset(edge: .top)` nel contesto paziente; si integra con il privacy shield esistente |
| (nuovo) | `RigaLaboratorio` | Anatomia canonica: nome (Voce), valore (Registro), unità, banda di range + banda personale (Canvas/Gauge custom), delta, data |
| (nuovo) | `Filo` | La linea con stile di tratto = stato epistemico; usata da selezione, timeline, provenienza |
| (nuovo) | `CodaAttenzione` | Voce con perché/owner/scadenza, due binari (clinico/amministrativo) resi con tono, mai con lo stesso colore |
| (nuovo) | `PannelloLaterale` | `.inspector()` su macOS/iPad per il drill-down senza perdere il punto (densità a strati) |

Il commit semantics del filo sul nativo: una bozza (voce diario proposta, prescrizione in preparazione) è resa col tratteggio e un'azione esplicita "Firma" la consolida; `confirmationDialog` con ruolo `.destructive` resta per le distruttive; un inserimento errato si marca, non si cancella (pattern Canvas, coerente con l'audit locale).

## 3. La grammatica compatta (iPhone)

Sulla fascia compatta il modello focale si semplifica, non si spegne:

- **Il fuoco è lo schermo corrente**: la penombra è lo stack di navigazione alle spalle; niente tre zone simultanee su 390pt.
- **La coda dell'attenzione è la home**: la tab primaria del client accoppiato mostra la coda con i due binari come filtri; ogni voce porta perché e scadenza; le azioni delegabili sono swipe actions.
- **La testata si comprime a barra** (nome, anno, glifo allergie) e resta appuntata sopra il contenuto paziente; il tap la espande.
- **Il Registro non si negozia**: le cifre tabellari servono proprio dove lo spazio è poco.
- **Registro guardia**: sul telefono è il caso d'uso principe (reperibilità notturna); segue il dark di sistema con i token notte.
- I target restano 44pt; la densità densa non esiste in compact.

## 4. Tri-OS prospettico: Windows e Linux sotto Lume

Questa sezione conserva una direzione e non apre una lane. Le guide di Vetro Clinico ([../vetro-clinico/07-piattaforme/windows.md](../vetro-clinico/07-piattaforme/windows.md), [linux.md](../vetro-clinico/07-piattaforme/linux.md)) restano note prospettiche; le tabelle seguenti non sono un piano di implementazione attivo:

| Concetto Lume | Windows (Fluent/WinUI) | Linux (GNOME/libadwaita) |
| --- | --- | --- |
| Canvas | Mica sulla finestra (è il canvas idiomatico) | Fondo finestra piatto |
| Field / Focal | Layer fill sopra Mica; il focale con elevazione Fluent bassa | Card Adwaita; il focale con la superficie leggermente rialzata |
| Chrome | Titlebar estesa + `NavigationView` rail | `AdwHeaderBar` + sidebar di sistema |
| Il filo | Linea accent 2px (nessuna dipendenza dal materiale: funziona ovunque) | Idem, con accent color |
| La Voce / Il Registro | Segoe UI Variable / Cascadia Mono | Font di sistema (Cantarell) / mono di sistema |
| Registri | Segue light/dark di Windows; guardia nel dark | Segue il portal `color-scheme`; guardia nel dark |
| Overlay | Acrylic (suo dominio naturale) | Dialoghi piatti di sistema |
| Segnali clinici | Token Lume invariati (mai l'accent utente sui significati clinici) | Idem |

Il punto strategico: **Lume elimina il problema del degrado**. Con Vetro Clinico, Linux richiedeva una variante "piatta" e Windows una traduzione dei materiali; con Lume la lingua è già opaca e fondata su luce, filo e tipografia, che esistono identiche su tutti e tre gli OS. Nello scenario shell nativa + canvas web (pattern già descritto nelle guide tri-OS), il canvas Lume è lo stesso ovunque e solo il telaio cambia idioma.

## 5. Verifica nativa

- Build + esercizio reale su simulatore iOS e run macOS (Xcode-beta via `DEVELOPER_DIR`, `docs/native-testing.md`).
- Snapshot dei tre registri (giorno/grafite/guardia) sulle primitive LumeKit.
- VoiceOver sui flussi principali; Dynamic Type AX5; Reduce Transparency (overlay) e Reduce Motion (crossfade e filo).
- Parità dei contratti: le primitive LumeKit dovranno preservare gli `accessibilityIdentifier` già usati dai test UI iOS e dai probe macOS. Un target XCUITest macOS dedicato non esiste ancora e resta un gate separato.

## 6. Sequenza nativa

1. Con DS-2 (prerequisito): `NavigationSplitView`, spacchettamento workspace, guardie di accessibilità.
2. L1 nativa: `LumePalette` come asset catalog con i tre registri, contrasti misurati.
3. L2-L3 nativa: `LumeSurface`/`LumeCard`/`Filo` in LumeKit, adozione su worklist e Quadro del client accoppiato.
4. L4 nativa: modifier `.registro()` su tutti gli atomi verificabili (dosi, valori, date già presenti nel workspace).
5. L5-L6: coda dell'attenzione come home compatta; tri-OS resta fermo finché una lane separata non viene autorizzata.
