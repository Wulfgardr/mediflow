---
summary: "Lume for the native apps: SwiftUI mapping for Apple, compact/mobile grammar, and prospective notes for Windows and Linux."
read_when:
  - "Implementing Lume on the Apple paired client or planning the tri-OS clients."
  - "Deciding how a Lume concept (fuoco, filo, registri, coda) maps to SwiftUI, WinUI, or GTK."
---

# Lume nelle app native

La lingua di Lume è pensata per più piattaforme, ma il percorso di realizzazione parte da Apple e, in particolare, da macOS. Questa pagina distingue quindi la traduzione per il client Apple accoppiato, la grammatica compatta iPhone e le sole indicazioni prospettiche per i futuri client tri-OS. Il riferimento operativo per macOS è [06-macos-apple-contract.md](./06-macos-apple-contract.md); la parità funzionale e la distribuzione Windows/Linux restano fuori da questo filone.

## 1. Apple: mappa dei concetti

> Il raccordo con [07-gesto-e-movimento.md](./07-gesto-e-movimento.md), effettuato il 2026-07-14, supera il tratteggio come indicazione di stato e il filo come marcatore del fuoco.

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

Perché le viste possano condividere elementi componibili anziché replicare schermate, `VetroClinico.swift` evolve in `Lume.swift` (LumeKit), secondo la regola «primitive prima dei dashboard» di [04-perlustrazione.md](./04-perlustrazione.md):

| Oggi | Domani | Nota |
| --- | --- | --- |
| `VetroGlassModifier` | `LumeSurface(zone:)` | Rende canvas/field/focal/chrome; niente `glassEffect` sulle superfici strutturali; la guardia `accessibilityReduceTransparency` resta per gli overlay |
| `GlassCard` | `LumeCard(zone:)` | Opaca, bordo 1px, ombra solo se focale |
| `StatusBadge`, `VetroTone`/`VetroPalette` | `LumeTone`/`LumePalette`, con alias Vetro di compatibilità | Mapping register-aware: neutral -> `ink.muted`, info/amministrativo -> `accent.minerale`, positive -> `signal.success`, attention -> `signal.warning`, critical -> `signal.critical`. Per la resa dei tre signal, il seed DTCG viene miscelato in sRGB al 60% con il 40% di `ink.primary`: il minimo misurato su `field` è 5,41:1 nei tre registri. I badge restano opachi e conservano testo o glifo; `signal.plum` non rappresenta alcun tono finché manca uno stato strutturato dedicato |
| `InfoRow` | `RigaLista` | Altezza 44pt touch, fuoco di selezione reso con la luce, cifre tabellari |
| (nuovo) | `TestataPaziente` | Identità verificabile: nome e anno in compact; dettagli espandibili e identificativo abbreviato sotto il privacy shield. Il glifo allergie compare solo quando esiste un dato strutturato affidabile |
| (nuovo) | `RigaLaboratorio` | Anatomia canonica: nome (Voce), valore (Registro), unità, banda di range + banda personale (Canvas/Gauge custom), delta, data |
| (nuovo) | `Filo` | Connettore reale continuo: timeline, provenienza e continuità |
| (nuovo) | `.lumeInchiostro(bozza:)` | Porta lo stato epistemico: bozza tenue con micro-etichetta del chiamante, firma a contrasto pieno |
| (nuovo) | `CodaAttenzione` | Voce con perché/owner/scadenza, due binari (clinico/amministrativo) resi con tono, mai con lo stesso colore |
| (nuovo) | `PannelloLaterale` | `.inspector()` su macOS/iPad per il drill-down senza perdere il punto (densità a strati) |

Sul nativo, il consolidamento del contenuto segue la resa dell'inchiostro. Una voce di diario proposta o una prescrizione in preparazione rimangono bozze in `ink-muted`, accompagnate da una micro-etichetta esplicita; soltanto l'azione "Firma" le consolida e porta l'inchiostro a contrasto pieno, come definito nel par. 3 di [07-gesto-e-movimento.md](./07-gesto-e-movimento.md). Per le azioni distruttive resta `confirmationDialog` con ruolo `.destructive`, mentre un inserimento errato deve essere marcato, non cancellato: il pattern Canvas rimane così coerente con l'audit locale.

La palette nativa viene definita in codice nel package condiviso, senza asset catalog, ma i valori di riferimento restano in `tokens/lume.tokens.json`. I test XCTest risolvono quel file da `#filePath`, confrontano ciascun token e attraversano tutte le combinazioni registro x `LumeTone`. Qualsiasi divergenza o tono nuovo privo di mapping determina un fallimento chiuso, con indicazione del token atteso.

## 3. La grammatica compatta (iPhone)

Lo spazio compatto richiede di semplificare il modello focale, non di rinunciarvi:

- **Il fuoco coincide con lo schermo corrente**; la penombra è nello stack di navigazione precedente, perché su 390pt non devono convivere tre zone simultanee.
- **La coda dell'attenzione costituisce la home**: la tab primaria del client accoppiato presenta i due binari come filtri, espone motivo e scadenza di ogni voce e offre swipe actions per le azioni delegabili.
- **La testata si comprime in una barra** con nome e anno, fissata sopra il contenuto paziente ed espandibile al tap. Il glifo allergie compare soltanto quando il modello esponga quel dato: il modello paired descritto non lo espone, quindi la UI non lo inventa.
- **Il Registro rimane obbligatorio**, perché le cifre tabellari sono necessarie anche nello spazio ridotto.
- **Il registro guardia** segue il dark di sistema con i token notte, in particolare per la reperibilità notturna.
- I target restano 44pt; in compact non è ammessa la densità densa.

## 4. Tri-OS prospettico: Windows e Linux sotto Lume

Le indicazioni per Windows e Linux conservano una direzione, senza autorizzare l'apertura di una lane. Anche le guide di Vetro Clinico ([../vetro-clinico/07-piattaforme/windows.md](../vetro-clinico/07-piattaforme/windows.md), [linux.md](../vetro-clinico/07-piattaforme/linux.md)) rimangono prospettiche: la tabella non costituisce un piano di implementazione attivo.

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

La scelta di superfici opache riduce il problema che Vetro Clinico poneva nel passaggio fra piattaforme: Linux richiedeva una variante piatta e Windows una traduzione dei materiali. Luce, filo e tipografia possono invece conservare la stessa funzione in Lume sui tre OS. Nello scenario già descritto dalle guide tri-OS, con shell nativa e canvas web, il canvas rimarrebbe comune e sarebbe il telaio a usare l'idioma della piattaforma.

## 5. Verifica nativa

- Eseguire build ed esercizio reale su simulatore iOS e macOS, con Xcode-beta tramite `DEVELOPER_DIR` e riferimento a `docs/native-testing.md`.
- Acquisire snapshot delle primitive LumeKit nei registri giorno/grafite/guardia.
- Esercitare VoiceOver sui flussi principali, Dynamic Type AX5, Reduce Transparency sugli overlay e Reduce Motion su crossfade e filo.
- Conservare nelle primitive LumeKit gli `accessibilityIdentifier` già usati dai test UI iOS e dai probe macOS. Il target XCUITest macOS dedicato, ancora assente nel quadro descritto, rimane un gate distinto.

## 6. Sequenza nativa

Lo stato del 2026-07-15 distingue quanto consegnato dalle parti ancora aperte. Alla thin slice delle card cliniche opache, Wave N2 aggiunge `LumePalette`, `LumeSurface`, `LumeCard`, `Filo`, `RigaLista`, `.registro()`, `.lumeInchiostro(bozza:)` e `lumeGlass`, mantenendo alias Vetro di compatibilità. Sul branch `feat/lume-apple` sono inoltre presenti lo spacchettamento del workspace e l'adozione L2-L4 in worklist, Scheda, diario e impostazioni del client accoppiato. Rimangono aperti coda dell'attenzione, trigger contestuale della guardia, parità completa e target XCUITest macOS dedicato.

1. Con DS-2 come prerequisito, il branch nativo consegna lo spacchettamento del workspace e le guardie di accessibilità, non ancora l'intera struttura desktop.
2. L1 nativa: Wave N2 consegna `LumePalette` definita in codice, con i tre registri e test di parità fail-closed.
3. L2-L3 nativa: il branch nativo consegna primitive e adozione su worklist, Scheda, diario e impostazioni; la timeline mantiene una sola spina continua dietro le voci.
4. L4 nativa: `.registro()` viene applicato a valori, codici, date e contatori toccati dalla tranche. Etichette e testi restano nella Voce, mentre l'adozione sulle altre superfici procede separatamente.
5. L5-L6: rimangono da realizzare la coda dell'attenzione come home compatta e il trigger contestuale della guardia. Il tri-OS resta fermo finché non sia autorizzata una lane separata.