---
summary: "Lume for the native apps: SwiftUI mapping for Apple, compact/mobile grammar, and prospective notes for Windows and Linux."
read_when:
  - "Implementing Lume on the Apple paired client or planning the tri-OS clients."
  - "Deciding how a Lume concept (fuoco, filo, registri, coda) maps to SwiftUI, WinUI, or GTK."
---

# Lume nelle app native

Lume nasce multipiattaforma per costruzione, ma la delivery corrente e Apple-first e macOS-first. Questo documento traduce la lingua per le app: l'app Apple accoppiata, la grammatica compatta iPhone e, solo come nota prospettica, i client tri-OS futuri. Il contratto operativo macOS e in [06-macos-apple-contract.md](./06-macos-apple-contract.md). Feature parity e delivery Windows/Linux restano fuori da questo filone.

## 1. Apple: mappa dei concetti

> Riconciliato con [07-gesto-e-movimento.md](./07-gesto-e-movimento.md) il 2026-07-14: il tratteggio come stato e il filo come marcatore di fuoco sono superati.

| Concetto Lume | SwiftUI |
| --- | --- |
| Registri giorno/grafite | Palette code-first: `LumePalette` (canvas/field/focal/chrome, ink, minerale) segue `colorScheme` di sistema |
| Registro guardia | Raffinamento del dark: variante dei token attivata da contesto (ambiente `lumeGuardia`), mai un tema utente in più |
| Buio operativo (chrome) | Le superfici di sistema restano di sistema: sidebar di `NavigationSplitView`, toolbar e tab bar NON si ridipingono (su OS 26+ sono Liquid Glass nativo: è l'idioma della piattaforma, e per Lume il chrome deve solo recedere). Il buio operativo si applica alle superfici di telaio CHE COSTRUIAMO NOI (rail custom, barre interne) |
| Penombra (field) | Colonna lista e pannelli non focali: fondo `field`, bordo sottile, niente ombra |
| Fuoco (focal) | Pannello attivo: fondo `focal`, ombra corta (`shadow(radius: 4, y: 2)` a bassa opacità); il fuoco si dice solo con la luce |
| Il filo | Solo connettore reale, continuo: timeline custom, provenienza e continuità Quadro -> Scheda con `matchedGeometryEffect` esclusivamente sul filo |
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
| `StatusBadge`, `VetroTone`/`VetroPalette` | Invariati nei valori, rinominati `LumeTone`/`LumePalette` | Badge su superficie field opaca; il segnale clinico resta soltanto su testo o glifo |
| `InfoRow` | `RigaLista` | Altezza 44pt touch, fuoco di selezione reso con la luce, cifre tabellari |
| (nuovo) | `TestataPaziente` | Identità verificabile: nome e anno in compact; dettagli espandibili e identificativo abbreviato sotto il privacy shield. Il glifo allergie compare solo quando esiste un dato strutturato affidabile |
| (nuovo) | `RigaLaboratorio` | Anatomia canonica: nome (Voce), valore (Registro), unità, banda di range + banda personale (Canvas/Gauge custom), delta, data |
| (nuovo) | `Filo` | Connettore reale continuo: timeline, provenienza e continuità |
| (nuovo) | `.lumeInchiostro(bozza:)` | Porta lo stato epistemico: bozza tenue con micro-etichetta del chiamante, firma a contrasto pieno |
| (nuovo) | `CodaAttenzione` | Voce con perché/owner/scadenza, due binari (clinico/amministrativo) resi con tono, mai con lo stesso colore |
| (nuovo) | `PannelloLaterale` | `.inspector()` su macOS/iPad per il drill-down senza perdere il punto (densità a strati) |

Il commit semantics sul nativo segue l'inchiostro: una bozza (voce diario proposta, prescrizione in preparazione) usa `ink-muted` con una micro-etichetta onesta; un'azione esplicita "Firma" la consolida e l'inchiostro asciuga a contrasto pieno, come definito in [07-gesto-e-movimento.md](./07-gesto-e-movimento.md) par. 3. `confirmationDialog` con ruolo `.destructive` resta per le distruttive; un inserimento errato si marca, non si cancella (pattern Canvas, coerente con l'audit locale).

La palette nativa è code-first nel package condiviso, senza asset catalog. I valori restano nella sorgente unica `tokens/lume.tokens.json`; un test XCTest risolve quel file da `#filePath` e confronta ogni token. Qualunque drift fallisce in modo chiuso e ne elenca i nomi.

## 3. La grammatica compatta (iPhone)

Sulla fascia compatta il modello focale si semplifica, non si spegne:

- **Il fuoco è lo schermo corrente**: la penombra è lo stack di navigazione alle spalle; niente tre zone simultanee su 390pt.
- **La coda dell'attenzione è la home**: la tab primaria del client accoppiato mostra la coda con i due binari come filtri; ogni voce porta perché e scadenza; le azioni delegabili sono swipe actions.
- **La testata si comprime a barra** (nome e anno) e resta appuntata sopra il contenuto paziente; il tap la espande. Il glifo allergie compare solo se il modello espone il dato. Il modello paired corrente non lo espone, quindi la UI non lo inventa.
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

Stato al 2026-07-15: oltre alla thin slice delle card cliniche opache, la Wave N2 consegna `LumePalette`, `LumeSurface`, `LumeCard`, `Filo`, `RigaLista`, `.registro()`, `.lumeInchiostro(bozza:)` e `lumeGlass`, con alias di compatibilità Vetro. Il branch `feat/lume-apple` consegna anche lo spacchettamento del workspace e l'adozione L2-L4 su worklist, Scheda, diario e impostazioni del client accoppiato. Coda dell'attenzione, trigger contestuale della guardia, parity completa e un target XCUITest macOS dedicato restano aperti.

1. Con DS-2 (prerequisito): spacchettamento workspace e guardie di accessibilita consegnati sul branch nativo; struttura desktop completa ancora aperta.
2. L1 nativa: `LumePalette` code-first con i tre registri e test di parità fail-closed. Consegnata in Wave N2.
3. L2-L3 nativa: primitive e adozione su worklist, Scheda, diario e impostazioni consegnate sul branch nativo. La timeline usa una sola spina continua dietro le voci.
4. L4 nativa: `.registro()` adottato sui valori, codici, date e contatori toccati dalla tranche; etichette e copy restano nella Voce. Il completamento sulle altre superfici resta progressivo.
5. L5-L6: coda dell'attenzione come home compatta e trigger contestuale della guardia restano debito; tri-OS resta fermo finche una lane separata non viene autorizzata.
