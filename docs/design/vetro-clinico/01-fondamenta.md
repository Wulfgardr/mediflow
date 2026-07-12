---
summary: "Vetro Clinico design principles, honest current-state audit (web + native), and binding design decisions."
read_when:
  - "Making any design decision on MediFlow and needing the principles or the binding constraints."
  - "Understanding what already works and what is visual debt before touching UI."
---

# Fondamenta

## 1. Principi

Otto principi, in ordine di precedenza. Quando due confliggono, vince quello con il numero più basso.

1. **Il dato clinico è sovrano.** Il vetro incornicia, la carta accoglie. Nessun materiale traslucido sotto testo clinico: le superfici dove si legge o si scrive clinica sono opache. Il vetro vive nel chrome (navigazione, comandi, overlay), mai sotto il contenuto.
2. **Il colore è semantica clinica.** La palette resta neutra (inchiostro, grigi, superfici). Il colore pieno compare solo con significato: critico, attenzione, successo, informazione, azione primaria. Ogni segnale colorato è sempre accompagnato da testo o glifo: il colore da solo non porta mai il significato.
3. **Nascondere la complessità, non i dati.** La lezione dei terminali professionali: densità ben gerarchizzata batte il minimalismo che moltiplica i livelli di navigazione. Se un'informazione serve al lavoro clinico ricorrente, si struttura meglio, non si rimuove.
4. **Stati onesti.** Uno stato vuoto dice cosa manca e come procedere. Un errore è distinguibile da un caricamento. Niente meta-testo, niente copy celebrativo, niente flash di "nessun dato" durante il load.
5. **Risposta immediata, movimento motivato.** Feedback al pointer-down, non al rilascio. Le animazioni esistono solo per cambi di stato reali, partono dal valore corrente a schermo e sono interrompibili. Spring smorzata come default; rimbalzo solo dove il gesto aveva quantità di moto.
6. **Una grammatica, materiali idiomatici.** I token semantici (colore, tipografia, spaziatura, geometria) sono unici a monte. Il materiale che li rende (Liquid Glass su Apple e web, Mica/Acrylic su Windows, flat su GNOME) lo decide la piattaforma, mai il token.
7. **Accessibile per costruzione.** WCAG 2.2 AA è un contratto, non una rifinitura. Il caso peggiore del vetro (testo sopra sfondo dinamico) si verifica con misure, non si presume. Reduce Transparency, Reduce Motion e Increase Contrast hanno sempre un equivalente usabile.
8. **La tastiera è un'interfaccia di prima classe.** Ogni azione clinica ricorrente ha una scorciatoia, scopribile senza manuale. Il flusso a tastiera si progetta insieme al layout, non dopo.

## 2. Stato attuale, senza sconti

Fotografia al 2026-07-11, dalla ricognizione su codice. Il sistema esiste già a metà: la seconda metà è consolidamento, non invenzione.

### Web: cosa funziona

- **Sistema di token reale**: variabili `--mf-*` in `app/globals.css` (2443 righe), esposte come utility Tailwind (`text-ink`, `bg-glass`) in `tailwind.config.ts`. Palette semantica clinica già definita (primary, plum, warning, critical, success, muted).
- **Tier di vetro nominati**: `--mf-tier-specular-*` (chrome, modali) e `--mf-tier-vitreous-*` (pannelli), con blur e saturazione parametrizzati. È già la distinzione giusta.
- **La legge "vetro non tocca la clinica" è già rispettata d'istinto**: lo stile attivo (`data-ui-style="redesign"`) applica `backdrop-filter: none` alle superfici paziente (`.patient-identity-lens`, `.patient-detail-section`, ecc., `app/globals.css` righe 391-398) e riserva il vetro a sidebar, header mobile, command capsule. Questo non è debito: è la regola del sistema (vedi [03-materiali.md](./03-materiali.md)), che qui viene promossa da istinto a legge scritta.
- **Accessibilità già cablata nel CSS**: `[data-ui-reduce-transparency]`, `[data-ui-reduce-motion]`, `prefers-contrast: more`, `prefers-reduced-motion` hanno override dedicati.
- **Feedback moderno**: `components/ui/toast-provider.tsx` e `components/ui/confirm-dialog.tsx` (con motivazione obbligatoria per azioni distruttive cliniche, focus trap, fallback sicuro se il provider manca).
- **Stati vuoti onesti** dove il passaggio v2 è arrivato (es. `components/case-lens-panel.tsx:257,334`).
- **Niente webfont remoti**: stack di sistema (`SF Pro Text/Display, -apple-system, Segoe UI`), scelta giusta per un'app locale-first.

### Web: debito

- **Tre stili UI paralleli nel CSS** (`liquid`, `redesign`, default implicito) con `redesign` hardcoded in `app/layout.tsx`: gli altri due sono peso morto se non raggiungibili.
- **`components/ui/card.tsx` fuori vocabolario**: hardcoda `border-slate-200/70 bg-white/80` invece dei token `--paper-*`/`--glass-*`, ed è usato ~8 volte nelle sotto-schede paziente.
- **Palette dark duplicata a mano**: `.graphite-chip-tone-*` in dark usa `rgb()` letterali (es. `rgb(244, 170, 158)`) invece di derivare dai token; se il token cambia, il dark deriva.
- **`components/ui/badge.tsx` con due sistemi di colore** (`tone` su token, `palette` legacy su classi Tailwind letterali): migrazione a metà dichiarata nei commenti.
- **Coppie di classi duplicate** (`.mf-input`/`.input-field`, `.mf-btn-secondary`/`.ui-btn-secondary`) mantenute per compatibilità storica.
- **`components/kree8/` con varianti `X-area.tsx` e `live-X-area.tsx` affiancate**: duplicazione strutturale da riassorbire.
- **Scala tipografica sotto la soglia di leggibilità**: utility `3xs` (8px) e `micro` (9px) in `tailwind.config.ts`; sotto i 10px non si legge in ambulatorio (vedi [02-token.md](./02-token.md)).
- **Residuo Geist**: `--font-geist-sans/mono` mappati in `@theme` ma non usati dal body; da rimuovere o da motivare.
- Gli 80 finding della revisione 2026-07-02 (`docs/analysis/2026-07-02-revisione-ui-ux-viste-liste-sinottica.md`) restano il registro puntuale dei problemi di interazione: card-soup ematici, terapie che non scalano sul polifarmaco, gerarchia della Scheda, 23 `confirm()` + 47 `alert()` + 1 `prompt()` nativi ancora vivi.

### Nativo Apple: cosa funziona

- **`VetroClinico.swift` è il seme giusto**: `VetroGlassModifier` applica `.glassEffect(.regular, in:)` su iOS/macOS 26+ con fallback esplicito a `.regularMaterial` sotto (floor: iOS 17, macOS 14). `GlassCard`, `StatusBadge`, `InfoRow`, `VetroTone`/`VetroPalette` mappano i toni clinici sui colori semantici di sistema.
- **Colori e tipografia quasi tutti semantici**: stili testuali di sistema (Dynamic Type implicito), `Color.primary/.secondary`, `PlatformColors` che wrappano i colori di sistema.
- **Privacy shield** con logica testabile separata dal modifier.

### Nativo Apple: debito

- **Due sistemi di card paralleli**: `GlassCard` (Vetro Clinico) e `CardStyleModifier` (`AppleFoundationStyle.swift`). Uno deve morire: resta Vetro Clinico.
- **`PairedPatientsWorkspaceView` (1813 righe) reimplementa a mano il master-detail** (HStack con colonna fissa 360pt) invece di `NavigationSplitView`, e la lista pazienti è `ForEach` in `ScrollView` invece di `List`: si perdono swipe actions, pull-to-refresh, selezione automatica.
- **Accessibilità solo strumentale**: centinaia di `accessibilityIdentifier` (per test), 2 soli `accessibilityLabel` reali, zero guardie `reduceTransparency`/`reduceMotion`. Un utente con Reduce Transparency attivo riceve comunque il materiale traslucido.
- **Artefatti di rollout in produzione**: `AppleFoundationOverviewView` e le tab Overview/Milestones sono viste di stato interno, non prodotto.
- **`Color.red` hardcoded** in 2 punti al posto di `VetroTone.critical`.
- **Copertura SF Symbols bassa** rispetto alla superficie clinica: molte azioni sono solo testuali.

## 3. Decisioni vincolanti

Registro delle decisioni che questo sistema non può contraddire senza un nuovo ADR.

| Decisione | Fonte | Conseguenza operativa |
| --- | --- | --- |
| Nessun selettore di stile UI persistito | ADR 0047 (2026-04-22), ribadito in ADR 0060 | Un solo linguaggio visivo. Le preferenze utente ammesse sono assi ergonomici e di accessibilità (densità, trasparenza, motion, contrasto), non temi alternativi. Ogni nuovo asse di preferenza richiede un ADR. |
| Cockpit alla root `/` | ADR 0060 (2026-05-15) | Il cockpit è l'ingresso; la grammatica visiva della root è quella di WUL-271. |
| `Scheda paziente` = `/patients/[id]/modules`, unica destinazione di rotta; `Quadro` = sinossi in-cockpit senza cambio rotta | `docs/design/wul-271-kree8-visual-translation.md` righe 134, 193-196 | Una parola, un concetto. Le transizioni Quadro/Scheda sono il punto di continuità spaziale più importante del prodotto. |
| Direzione visiva unica su tutte le piattaforme: Lume come destinazione, Vetro Clinico come canone transitorio | [ADR 0078](../../adr/0078-lume-lingua-di-design-di-destinazione.md) | Niente lingue visive per-piattaforma; cambiano struttura e resa idiomatica, non la semantica clinica condivisa. |
| Direzione calda/carta "Referto" per la UI dell'app: valutata e respinta (2026-06) | Decisione di progetto in memoria di lavoro; questo documento ne è la prima registrazione scritta in repo | Non si ripropone come tema dell'app. Il linguaggio di stampa (vedi [08-esplorazioni.md](./08-esplorazioni.md), proposta Inchiostro) riguarda solo gli artefatti esportati, non la UI. |
| Trattino lungo bandito da docs e stringhe UI; meta-testo bandito dalla UI; stati vuoti onesti | Convenzione ripetuta nei documenti (WUL-271 "meta-text purge"; revisione 2026-07-02) | Vincola anche i testi degli esempi in questo folder. |
| Claims guard | ADR 0065, `scripts/check-claims-guard.mjs` (scansiona anche `docs/design/`) | I testi UI e questi documenti non fanno claim su autonomia clinica, integrazioni regionali o cloud. |

La direzione e ora formalizzata in [ADR 0078](../../adr/0078-lume-lingua-di-design-di-destinazione.md): questo folder conserva le fondamenta cliniche e il canone operativo transitorio mentre la migrazione a Lume procede per slice verificabili.

## 4. Anti-pattern (vietati)

- Vetro sotto contenuto clinico, o vetro su vetro (due superfici traslucide sovrapposte).
- Colore decorativo: gradienti o tinte senza significato clinico o di azione.
- Nuovi valori colore/radius/blur letterali nei componenti: ogni valore passa dai token.
- `alert()`, `confirm()`, `prompt()` nativi su azioni cliniche: esistono `useToast` e `useConfirm`.
- Testo sotto i 10px o target interattivi sotto 24x24 px.
- Animazioni decorative, non interrompibili, o che partono dal valore logico invece che da quello a schermo.
- Copy riempitivo negli stati vuoti; flash di stato vuoto durante il caricamento.
- Un nuovo componente dove ne esiste già uno nel vocabolario (prima si estende, poi si crea).
