<!-- Codex: created 2026-02-19 -->
# ADR 0007: Strict web/native parity come release gate operativo

Date: 2026-02-19  
Status: Accepted

---

## Problema

La parity web/macOS e stata finora trattata soprattutto come copertura API.
Restano divergenze lato UI e comportamento: funzioni diverse, campi non allineati,
flessibilita operativa non equivalente e dipendenza pratica dal client web per
alcuni workflow.

Il Lead Architect richiede parity stretta: stesse funzioni, stessi campi, stessa
flessibilita funzionale e capacita operativa indipendente per entrambi i client,
mantenendo un unico database condiviso.

## Contesto

- Local-first e zero-knowledge non negoziabili.
- Storage autorevole unico: SQLite locale condiviso.
- Contratto condiviso via `/api/v1/*` (ADR 0005).
- Nessuno storage duplicato o percorso dati separato per il client nativo.
- Scope parity core: pazienti, diario clinico, terapie, appuntamenti, farmaci, esenzioni.

## Opzioni

1. Continuare con parity graduale senza gate esplicito di rilascio.
2. Introdurre parity stretta con gate esplicito capability-by-capability.
3. Consentire deviazioni funzionali permanenti tra web e macOS.

## Trade-off

- Opzione 1:
  - Pro: meno overhead nel breve periodo.
  - Contro: rischio drift continuo e regressioni silenziose.
- Opzione 2:
  - Pro: convergenza verificabile e prevedibile tra client.
  - Contro: disciplina maggiore su pianificazione, test e documentazione.
- Opzione 3:
  - Pro: velocita locale su singolo client.
  - Contro: viola il mandato di parity e aumenta il rischio operativo.

## Decisione

Adottare l'opzione 2.

La parity web/macOS diventa un gate operativo esplicito sui moduli core:

- parity funzionale: `view/add/edit/delete/filter`
- parity campi: stessi campi significativi nei workflow
- parity flessibilita: stesso livello operativo (filtri, stati, ricerca, ordinamento)
- indipendenza operativa: ciascun client completa i workflow del modulo senza aprire l'altro client

La verifica avviene su matrice versionata (`docs/parity-matrix.md`) e piano
esecutivo in `PLANS.md` (sezione parity).

## Conseguenze

- Positivo: criteri di convergenza chiari, meno drift, review piu oggettive.
- Negativo: piu lavoro upfront su allineamento UI/behavior e test smoke.
- Vincolo: nessuna estensione "web-only" nei moduli core senza piano parity esplicito.

## First Thin Slice

1. Baseline parity matrix web/macOS con stato reale corrente e gap.
2. Esecuzione incrementale `P0 -> P6` nel piano parity.
3. Chiusura prioritari: pazienti + esenzioni + osservazioni + allineamento semantica delete diario.
4. Smoke test manuale finale capability-by-capability su entrambi i client.
