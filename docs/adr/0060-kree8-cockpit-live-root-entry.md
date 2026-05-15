<!-- Codex: WUL-272 -->
# ADR 0060: Kree8 cockpit come root entry web live

Date: 2026-05-15
Status: Accepted

Supersedes for the web root entry: [ADR 0047](./0047-graphite-workbench-single-official-web-shell.md).

## Problema

`WUL-271` ha prodotto una superficie Kree8-inspired completa ma isolata sotto
`/mockups/kree8`. Dopo review visuale, Leonardo ha chiesto che la nuova linea
non resti un mockup e sia visibile direttamente all'avvio web locale, cioe su
`http://localhost:3000` aperto da `Start_MediFlow.command`.

La decisione precedente su Graphite aveva gia chiarito una regola valida:
MediFlow non deve tornare a un selettore persistente con shell concorrenti.
Serve quindi promuovere la nuova linea senza reintrodurre toggle o fork runtime.

## Opzioni

1. Lasciare Kree8 solo in `/mockups/kree8`.
2. Aggiungere un nuovo selector visuale per scegliere Graphite/Kree8.
3. Promuovere Kree8 come nuova direzione visuale ufficiale e come root entry
   `/`, mantenendo una sola direzione live e lasciando le route non ancora
   migrate come superfici storiche/di continuita.

## Trade-off

- Opzione 1:
  - Pro: minimo rischio runtime.
  - Contro: non rispetta la decisione prodotto di vedere la nuova linea
    direttamente su `localhost:3000`.
- Opzione 2:
  - Pro: confronto immediato tra shell.
  - Contro: riapre il problema gia chiuso dei selector persistenti e aumenta
    drift/test matrix.
- Opzione 3:
  - Pro: rende verificabile la nuova linea nel punto d'ingresso reale, mantiene
    un'unica direzione visuale e non introduce nuovi toggle.
  - Contro: la prima slice usa ancora dati sintetici e non migra subito tutte
    le route cliniche reali nella nuova grammatica.

## Decisione

Adottiamo l'opzione 3.

La home web locale `/` renderizza il Kree8 cockpit come root entry live e nuova
direzione dell'interfaccia MediFlow.
`Start_MediFlow.command` continua ad avviare lo stesso server locale su
`localhost:3000`; non serve digitare una route di mockup.

La regola no-selector resta invariata: nessun toggle Graphite/Kree8, nessun
preview profile estetico, nessuna modalita persistita. `/mockups/kree8` resta
temporaneamente come alias di review, da rimuovere quando la migrazione app-wide
[`WUL-273`](https://linear.app/wulfgardr/issue/WUL-273/kree8-app-wide-migration-real-data-surfaces-and-route-consolidation)
coprira le superfici reali.

La sicurezza resta attiva sulla root live: PIN/sessione e provider runtime
restano montati, ma la root usa un layout fullscreen senza sidebar/mobile chrome
storici per evitare collisione visuale.

## First Thin Slice

1. Estrarre il cockpit Kree8 in un componente condiviso.
2. Rendere `app/page.tsx` con il cockpit in modalita `live`, senza copy
   "mockup" o pulsante di uscita.
3. Lasciare `/mockups/kree8` come wrapper `review` temporaneo.
4. Aggiornare documentazione, attribution e Linear.
5. Verificare lint/typecheck e browser QA su `/` desktop/mobile.

## Fuori Scope

- Migrare tutte le route cliniche reali alla nuova grammatica Kree8: tracciato
  da `WUL-273`.
- Collegare il cockpit sintetico a dati clinici reali: tracciato da `WUL-273`.
- Introdurre un selettore visuale o profili preview estetici.
- Rimuovere immediatamente tutte le superfici Graphite secondarie.
