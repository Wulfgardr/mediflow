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

### Contratto mobile 0.8.6: armonizzazione del 6 settembre 2026

La slice mobile applica la gerarchia documentale del
[candidato Mac](../../2026-09-06-086-macos-redesign.md) e i criteri della
[raccolta illustrata Breccia](../../2026-09-06-breccia-apple-reference.md).
Le catture sintetiche Mac mostrano una testata continua e sezioni testuali.
I fotogrammi pubblici sostengono vicinanza, orientamento e profondità
progressiva; la loro traduzione in questo layout è una decisione di MediFlow,
non una prescrizione del video o una prova di usabilità.

- **iPhone e larghezze compatte:** lista → cartella con ritorno nativo.
  La testata paziente è opaca e mantiene la disclosure degli identificatori.
  Scheda, Diario e Documenti hanno accessi testuali da almeno 44 pt quando
  entrano nello spazio disponibile; il menu completo rimane raggiungibile.
  In poco spazio o con testo accessibile si mostra il nome della sezione
  corrente con il menu completo, senza ridurre il carattere.
- **iPad con spazio sufficiente:** worklist e cartella restano affiancate.
  Nome, identificatori, data disponibile e navigazione delle sette sezioni
  sono fuori dal contenuto scorrevole. L'indice testuale passa da una a più
  righe; rimangono i limiti di larghezza e il percorso compatto esistenti.
- **Contenuto:** superficie clinica continua, margine di lettura di 20 pt
  in compatto e 24 pt nel dettaglio affiancato. L'anagrafica precede i
  riepiloghi di conteggio, che restano disponibili mediante disclosure.
  Le esenzioni vanno a capo; le voci diario hanno data con mese e anno,
  padding proprio e separatori. Gli input mobili hanno almeno 44 pt e
  padding interno; i comandi del compositore restano controlli nativi.
- **Stato:** la sezione attiva resetta soltanto lo scroll del contenitore.
  Le view di sezione conservano il ciclo precedente; bozze, currentness,
  selezione, task, capability e writer restano nei proprietari esistenti.
  Il recorder Mac e il suo arresto quando nascosto non sono modificati.
  Il presenter allegati rimane unico nel Workspace. Nessuna nuova coda offline.
- **Confini:** root e resa Mac, API, permessi, autenticazione, pairing e
  accesso alla persistenza non cambiano. Il form di collegamento conserva
  campi, ID e handler. Le azioni legittime restano soggette ai gate esistenti.

Contratto per la verifica UI separata:

| Percorso | Identificatori |
| --- | --- |
| Sezioni visibili | `patient-section-navigation`, `patient-section-<rawValue>` |
| Tutte le sezioni in compatto | `patient-section-picker`, con valore accessibile della sezione corrente |
| Contesto iPad | `patient-workspace-header`, `patient-workspace-detail` |
| Contesto compatto | `patient-compact-header-disclosure`, `patient-compact-detail-destination` invariati |
| Riepiloghi progressivi | `patient-clinical-signals-disclosure`, `patient-chart-contents-disclosure` |
| Date delle voci | `entry-date-<id>`; righe e comandi diario mantengono gli ID precedenti |

Build e test unitari sono prove distinte dalla verifica UI di Ohm e dal
pairing reale tra processi. La demo e i transport sintetici non attestano
onboarding, scritture persistite, interoperabilità con host Mac/Windows/Linux
o recupero delle sessioni. Questi restano gate dell'integrazione coordinata.

Verifica locale della slice (Xcode 26.6, 17F113): build Debug dello schema
`MediFlowMobileApp` per destinazione generica iOS Simulator riuscita;
33 test SwiftPM superati nei gruppi `PatientsWorkspaceLayoutTests`,
`PairedPatientsWorkspaceSelectionTests`,
`PairedPatientsWorkspaceModelDocumentsTests` e `ClinicalContentRenderingTests`.
Build e test hanno usato cache dedicate e `MEDIFLOW_DATA_DIR` sintetica in
una nuova directory temporanea marcata. La compilazione SwiftPM copre anche
il ramo condiviso Mac; la UI Mac non è stata eseguita in questa lane.
`git diff --check` superato. Nessun simulatore avviato né XCUITest eseguito:
geometria, tastiera, Dynamic Type e resa visiva restano alla verifica separata.
Rimangono avvisi di deprecazione `onChange(of:perform:)`, inclusi i due
reset dello scroll; la build non li tratta come errori.

### Baseline e consolidamento precedente

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
