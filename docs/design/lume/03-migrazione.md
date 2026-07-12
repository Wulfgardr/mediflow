---
summary: "Migration path from Vetro Clinico to Lume: token mapping, phased adoption, what survives, risks and gates."
read_when:
  - "Planning Lume adoption after approval, or estimating its cost."
  - "Checking which Vetro Clinico investments remain valid under Lume."
---

# La migrazione

Principio: Lume non butta niente di ciò che vale. Il consolidamento di Vetro Clinico (roadmap DS-1..DS-3) è il prerequisito tecnico di Lume: si migra un sistema a token, non duemila valori sparsi. Per questo la migrazione NON parte finché DS-1 (token web) e DS-2 (nativo) non sono a posto.

## 1. Cosa sopravvive tale e quale

- I segnali clinici (warning/critical/success/plum) e la legge "il colore è semantica".
- Tutta la grammatica di interazione (feedback, spring sul gesto, tastiera, form, stati onesti) e il contratto di accessibilità.
- Il modello di densità a due livelli e i ruoli dei breakpoint.
- Le esplorazioni Guardia (diventa il registro notturno) e Inchiostro (resta il linguaggio di stampa).
- I componenti consolidati: toast, confirm, skeleton, listrow, input; cambiano vestito, non contratto.
- Le guide di piattaforma nella loro struttura (la mappa dei materiali cambia resa, non logica).

## 2. Mappa dei token

| Vetro Clinico | Lume | Nota |
| --- | --- | --- |
| `surface.base` | `surface.canvas` + `surface.field` | La periferia si sdoppia: canvas (fondo) e field (pannelli in penombra) |
| `surface.elevated` | `surface.focal` | Solo per il fuoco; i pannelli non focali usano field |
| (nessuno) | `surface.chrome` | Nuovo: il buio operativo |
| `material.vitreous` (vetro strutturale) | RITIRATO | Il telaio diventa chrome opaco |
| `material.specular` (vetro transitorio) | `overlay` (ombra+scrim; blur opzionale di piattaforma) | Il vetro resta solo qui |
| `material.paper` | `surface.focal`/`surface.field` | La carta si fonde nel modello focale |
| `--glass-*` | RITIRATI | Dopo la migrazione degli overlay |
| `radius.panel/card/control` 30/24/16 | 20/14/10 | Curva più asciutta |
| `--mf-font-sans` | `font.voce` (variabile impacchettata; SF su Apple) | Richiede decisione sul font e bundling locale |
| (nessuno) | `font.registro` (mono) | Nuovo: gli atomi verificabili |
| `--mf-focus-ring` | invariato | |
| Selezione a campitura (`--plum-tint` di fondo) | Filo focale sul bordo + field appena rialzato | La campitura resta per hover |

## 3. Fasi

| Fase | Contenuto | Gate |
| --- | --- | --- |
| L0 | Decisione di prodotto e canone: Lume lingua di destinazione, ADR 0074 e contratti di piattaforma | Completata per la direzione; font non-Apple e slice restano decisioni di delivery |
| L1 | Token: registri giorno/grafite/guardia nel sorgente DTCG, misura dei contrasti, `data-lume` accanto ai token attuali (convivenza temporanea, non selettore utente: flag di sviluppo) | Tutte le coppie AA misurate |
| L2 | Fuoco e chrome: modello focale nel cockpit (worklist/Quadro), rail e barre a chrome opaco, ritiro del vetro strutturale | Smoke visivo 3 registri + 3 segnali di accessibilità |
| L3 | Il filo: selezione focale, timeline diario, storia valori con banda personale | Leggibilità misurata; il tratteggio bozza copre i contenuti proposti |
| L4 | Le due voci: bundling font, regola del Registro su dosi/valori/codici/date (web e nativo) | Nessun fetch remoto; parity visiva print |
| L5 | Overlay e motion: overlay a ombra+scrim, cross-fade focale, filo che prosegue Quadro/Scheda | 60fps; Reduce Motion |
| L6 | Piattaforme native: Apple viene implementata per prima; Windows/Linux restano documentazione prospettica finché le lane non vengono riaperte | Contratto macOS verificato nel bundle; nessuna claim di client tri-OS |

Le fasi L2-L5 atterrano in fette piccole per superficie (prima il cockpit, poi la Scheda, poi settings), con la disciplina già in uso.

## 4. Rischi

- **Il gradiente di temperatura è sottile**: su monitor scadenti può sparire. Mitigazione: la gerarchia non dipende MAI dalla sola temperatura (c'è sempre luminanza + ombra + filo); la temperatura è rifinitura.
- **Fatica da doppio sistema** durante la convivenza L1-L5: il flag `data-lume` è di sviluppo, non un selettore utente (ADR 0047 rispettato); la convivenza ha una data di fine scritta nell'ADR.
- **Il font impacchettato** aggiunge peso al bundle e una scelta di licenza: candidati open (Inter, IBM Plex) con licenza OFL; su Apple si resta su SF (zero costo).
- **Il filo tratteggiato come stato**: convenzione nuova da insegnare; mitigazione: legenda nella vista di aiuto `?` e coerenza assoluta (mai tratteggio decorativo).
- **Regressione di identità**: togliendo il vetro, MediFlow deve restare riconoscibile; l'identità passa al filo, alla temperatura e alle due voci. Il dimostratore serve esattamente a giudicare questo prima di scrivere codice.
