---
summary: "Migration path from Vetro Clinico to Lume: token mapping, phased adoption, what survives, risks and gates."
read_when:
  - "Planning Lume adoption after approval, or estimating its cost."
  - "Checking which Vetro Clinico investments remain valid under Lume."
---

# La migrazione

Lume conserva gli investimenti di Vetro Clinico che restano utili, ma la migrazione deve poggiare sul consolidamento tecnico della superficie interessata: DS-1 per i consumatori web, DS-2 per le slice strutturali native, DS-3 per i flussi di feedback toccati. La roadmap DS-1..DS-3 non costituisce quindi un blocco globale fra piattaforme. Le prime slice web L1-L2 hanno chiuso la parte di DS-1 necessaria al proprio perimetro; DS-2 resta il gate per il lavoro nativo oltre la card opaca. Nessuno di questi avanzamenti equivale al completamento di DS-1..DS-3 in tutta l'app.

## 1. Cosa sopravvive tale e quale

- Restano invariati i segnali clinici warning/critical/success/plum, perché il colore conserva il proprio significato.
- Restano la grammatica di interazione — feedback, spring sul gesto, tastiera, form e stati onesti — e l'intero contratto di accessibilità.
- Si conservano il modello di densità a due livelli e i ruoli dei breakpoint.
- Guardia diventa il registro notturno; Inchiostro rimane il linguaggio di stampa.
- Toast, confirm, skeleton, listrow e input consolidati cambiano resa, non contratto.
- Le guide di piattaforma mantengono la propria struttura: cambia la resa dei materiali, non la logica della mappa.

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
| L0 | Decisione di prodotto e canone: Lume lingua di destinazione, ADR 0078 e contratti di piattaforma | Completata per la direzione; font non-Apple e slice restano decisioni di delivery |
| L1a (attiva) | Contratto token: registri giorno/grafite/guardia nel sorgente DTCG (`tokens/lume.tokens.json`) con misura strumentale dei contrasti (`scripts/check-lume-tokens.mjs`) | Tutte le coppie testo/superficie dichiarate misurate >= 4,5:1 |
| L1b (consegnata, PR #48) | Convivenza: mirror CSS `app/lume-tokens.css`, marker fisso `data-lume="true"` (temporaneo, non gate né selettore utente), alias giorno su `:root` e grafite su `.dark`, con test di allineamento al sorgente; guardia non ancora tema attivo | Marker di migrazione isolato, ADR 0047 rispettato |
| L2 (in corso) | Fuoco e chrome: modello focale nel cockpit (worklist/Quadro), rail e barre a chrome opaco, ritiro del vetro strutturale. Prime superfici atterrate: cockpit (PR #49), shell del workspace con fuoco focale e scrollspy (PR #52), lock screen (PR #53); le altre viste e i componenti interni restano da migrare | Smoke visivo 3 registri + 3 segnali di accessibilità |
| L3 | Il filo: selezione focale, timeline diario, storia valori con banda personale | Leggibilità misurata; il tratteggio bozza copre i contenuti proposti |
| L4 | Le due voci: bundling font, regola del Registro su dosi/valori/codici/date (web e nativo) | Nessun fetch remoto; parity visiva print |
| L5 | Overlay e motion: overlay a ombra+scrim, cross-fade focale, filo che prosegue Quadro/Scheda | 60fps; Reduce Motion |
| L6 | Piattaforme native: Apple viene implementata per prima; Windows/Linux restano documentazione prospettica finché le lane non vengono riaperte | Contratto macOS verificato nel bundle; nessuna attestazione di client tri-OS |

Le fasi L2-L5 procedono per interventi circoscritti a una superficie: prima il cockpit, poi la Scheda e infine settings. La disciplina resta quella già adottata, così che ogni passaggio abbia un perimetro verificabile.

Nel quadro del 2026-07-28, L0, L1a e L1b sono attive e L2 dispone di superfici nella candidata locale v0.8, senza essere chiusa finché non superi i gate visuali previsti. Rimangono aperte L3-L5 — filo, due voci con tipografia nel bundle, overlay e motion — e L6 nativa oltre la thin slice della card clinica opaca. Il registro di [ADR 0078](../../adr/0078-lume-lingua-di-design-di-destinazione.md) distingue le tranche e i relativi gate.

L'aggiornamento mirato del 2026-07-16, relativo alle issue #71 e #75, documenta la rimozione del vocabolario colore legacy dal layer page-owned `app/patients/[id]/entries/new/page.tsx` e dall'editor condiviso `components/clinical-rich-text-editor.tsx`. Le due voci sono state tolte dall'allowlist senza rigenerarne l'impronta. Sul tree della seconda slice, `check:lume-tokens` misura così 258 occorrenze di debito clinico allowlisted anziché 328: 57 appartenevano alla pagina, 13 all'editor. La riduzione non chiude il debito globale e non soddisfa ancora la condizione di uscita da `data-lume` definita in ADR 0078.

## 4. Rischi

- **Il gradiente di temperatura è sottile** e può scomparire sui monitor meno adeguati. La gerarchia non deve MAI dipendere dalla sola temperatura: luminanza, ombra e filo restano presenti, mentre la temperatura affina la resa.
- **La convivenza L1-L5 comporta un doppio sistema**. `data-lume` rimane un marker tecnico fisso, non un gate né un selettore utente, nel rispetto di ADR 0047. Vale la condizione di uscita formalizzata in ADR 0078, e ogni slice deve ridurre i consumatori legacy, non aumentarli.
- **Il font impacchettato incide sul peso del bundle e richiede una scelta di licenza**. I candidati open sono Inter e IBM Plex, con licenza OFL; Apple mantiene SF senza costo aggiuntivo.
- **Il filo tratteggiato come stato richiede apprendimento**. La mitigazione prevista è una legenda nella vista di aiuto `?`, insieme a una coerenza assoluta: il tratteggio non deve mai essere decorativo.
- **La rimozione del vetro può ridurre la riconoscibilità**. L'identità deve quindi passare al filo, alla temperatura e alle due voci; il dimostratore serve a valutarne l'esito prima di scrivere il codice.