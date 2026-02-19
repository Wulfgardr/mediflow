<!-- Codex: created 2026-02-19 -->
# ADR 0008: Web-first delivery con parity sweep periodici su macOS

Date: 2026-02-19  
Status: Accepted

---

## Problema

Serve mantenere alta la velocita di delivery sul client web (corsia principale),
senza perdere l'obiettivo di parity funzionale tra web e macOS sui moduli core.

Un gate di parity stretta su ogni singola feature rallenta il flusso principale.
Al tempo stesso, lasciare il client macOS senza governance porta drift permanente.

## Contesto

- Web app = canale primario di sviluppo.
- App macOS = progetto side, aggiornato a discrezione.
- Database unico condiviso (SQLite locale).
- Contratto condiviso `/api/v1/*` (ADR 0005).
- Obiettivo finale invariato: parity reale su funzioni/campi/flessibilita nei moduli core.

## Opzioni

1. Parity stretta simultanea feature-by-feature (gate immediato su ogni rilascio).
2. Web-first senza processo di convergenza (parity solo opportunistica).
3. Web-first con lag controllato + parity sweep periodici e backlog esplicito.

## Trade-off

- Opzione 1:
  - Pro: drift minimo nel breve.
  - Contro: riduce velocita del flusso principale.
- Opzione 2:
  - Pro: massima velocita web.
  - Contro: rischio alto di divergenza strutturale.
- Opzione 3:
  - Pro: mantiene velocita web e introduce convergenza governata.
  - Contro: richiede disciplina su backlog parity e finestre di recupero.

## Decisione

Adottare opzione 3.

Modello operativo:

- sviluppo ordinario: **web-first**
- convergenza: **parity sweep dedicati** (come finestra corrente)
- drift ammesso solo temporaneamente, mai permanente sui moduli core
- backlog parity obbligatoriamente tracciato in `docs/parity-matrix.md` e `PLANS.md`

Parita target per moduli core:
- stesse funzioni (`view/add/edit/delete/filter`)
- stessi campi rilevanti
- stessa flessibilita operativa (filtri/stati/ricerca/ordinamento)
- capacita operativa indipendente per client (stesso DB/contratto condiviso)

## Conseguenze

- Positivo: massimizza output web senza rinunciare alla convergenza.
- Positivo: rende esplicito quando siamo in modalita recovery parity.
- Negativo: serve manutenzione costante della matrice gap.
- Vincolo: nessuna deviazione con storage separato o logica dati duplicata.

## First Thin Slice

1. Marcare ADR 0007 come superseded.
2. Formalizzare in `PLANS.md` il modello web-first + parity sweep.
3. Mantenere baseline e gap in `docs/parity-matrix.md`.
4. Eseguire sweep corrente su `P1 -> P6` con check capability-by-capability.
