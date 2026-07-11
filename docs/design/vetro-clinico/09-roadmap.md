---
summary: "Design system implementation roadmap: DS lanes converging with the 2026-07-02 UI/UX roadmap, with paths, gates, and sequencing."
read_when:
  - "Planning or prioritizing design system work, or checking what gates a design change before it ships."
---

# Roadmap di implementazione

Questo piano non biforca la roadmap in 7 fasi della revisione UI/UX 2026-07-02 (`docs/analysis/2026-07-02-revisione-ui-ux-viste-liste-sinottica.md`, Parte 6): la assume come binario dei problemi di interazione e vi aggiunge le corsie del sistema di design (DS). Dove una corsia DS tocca una fase esistente, lo dichiara.

## Corsie

### DS-0. Canone (questa review)

- Questo folder come specifica operativa del canone proposto da [ADR 0077](../../adr/0077-vetro-clinico-canonical-cross-platform-design-language.md): glossario, legge dei materiali e sovranità dei token.
- Gate: ADR 0077 accettato e review del dossier contro codice e linee guida di piattaforma.

### DS-1. Consolidamento token web (converge con fase 6 "unificazione semantici")

Le 8 azioni di [02-token.md](./02-token.md) sezione 7: stile unico (`data-ui-style`), `card.tsx` sui token, ritiro `palette` legacy di `badge.tsx`, dark derivato, alias deprecati, ritiro 8-9px + `tabular-nums`, pulizia Geist, sorgente DTCG.

- Percorsi principali: `app/globals.css`, `app/layout.tsx`, `tailwind.config.ts`, `components/ui/{card,badge}.tsx`.
- Gate: smoke visivo su `/mockups/scheda` e cockpit, light+dark+3 segnali di accessibilità; zero valori letterali nuovi (grep di verifica su `#`/`rgb(` nei diff).

### DS-2. Consolidamento nativo Apple

Le 6 azioni di [07-piattaforme/apple.md](./07-piattaforme/apple.md): un solo sistema di card, `NavigationSplitView`, spacchettamento del workspace, via gli artefatti di rollout, colori solo da `VetroPalette`, guardie di accessibilità.

- Percorsi: `native/MediFlowMac/Sources/MediFlowAppleShared/` (VetroClinico.swift, AppleFoundationStyle.swift, PairedPatientsWorkspaceView.swift, AppleFoundationViews.swift).
- Gate: build + esercizio su simulatore iOS e run macOS (Xcode-beta via `DEVELOPER_DIR`), passata VoiceOver sui flussi principali, verifica Reduce Transparency.

### DS-3. Fondamenta di feedback (è la fase 5 della roadmap, invariata)

ConfirmDialog/Toast al posto dei 71 dialoghi nativi, combobox sui tre autocomplete clinici, `useLiveQueryState` sulle 28 superfici mute. Contributo DS: le specifiche di [04-interazione.md](./04-interazione.md) sono il capitolato di quella fase.

### DS-4. Strumento (converge con fasi 2 e 4)

Preferenza densità (mini-ADR), righe dense, cifre tabellari, tre pannelli >= 1600px, ritiro degli orb in denso. [08-esplorazioni.md](./08-esplorazioni.md) A.

- Gate: target di accessibilità invariati misurati in denso; prova su monitor 1080p e 4K.

### DS-5. Guardia (dopo DS-1)

Ricalibrazione del dark sui token derivati. [08-esplorazioni.md](./08-esplorazioni.md) B.

- Gate: misura dei contrasti su tutte le coppie notte; smoke in penombra reale (brightness bassa).

### DS-6. Inchiostro (parallelizzabile da subito)

Foglio di stile print web + revisione template PDF nativo (`TherapyPlanDocument`). [08-esplorazioni.md](./08-esplorazioni.md) D.

- Gate: stampa fisica in bianco e nero leggibile; parità concettuale export web/nativo.

### DS-7. Vetro Vivo (dopo fase 6: URL del cockpit)

Le tre transizioni: Quadro/Scheda, capsule, overlay. [08-esplorazioni.md](./08-esplorazioni.md) C.

- Gate: 60fps sulle transizioni su hardware medio; Reduce Motion integrale; nessuna regressione dei tempi di input.

### DS-8. Lane tri-OS (si apre con ADR 0068/0071, non prima)

[07-piattaforme/windows.md](./07-piattaforme/windows.md) e [07-piattaforme/linux.md](./07-piattaforme/linux.md) diventano operativi; decisione shell nativa vs canvas web al momento del kickoff, con i confini già scritti nei due documenti.

## Sequenza e dipendenze

```
DS-0 ──> DS-1 ──> DS-5 (Guardia)
   │        └───> DS-4 (Strumento, con fasi 2/4)
   ├──> DS-2 (nativo, indipendente)
   ├──> DS-3 (= fase 5, indipendente)
   ├──> DS-6 (Inchiostro, indipendente)
   └──> [fase 6: URL cockpit] ──> DS-7 (Vetro Vivo)
DS-8 quando la lane tri-OS apre
```

## Regole di ingaggio

- Ogni corsia atterra in fette piccole e verificate (la disciplina già in uso: WUL-273 "small verified slices").
- Nessuna fetta cambia i valori dei token e i consumatori nello stesso PR: prima si consolida chi consuma, poi si valuta se cambiare i valori.
- Ogni PR che tocca la UI dichiara nel testo quale documento di questo folder applica; le deviazioni si scrivono, non si improvvisano.
- Verifica visiva minima per PR di design: light + dark + Reduce Transparency, screenshot nel PR.
