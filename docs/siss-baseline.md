<!-- Codex: created 2026-03-18 -->
# SISS Baseline Canonica

> Stato documento: `CANONICAL`

Questo documento fissa la baseline SISS di MediFlow per il filone `WUL-43`.
Serve a separare chiaramente lo stato attuale, ancora basato su shortcut web,
dal target certificato che verrà affrontato in modo controllato con i follow-up
`WUL-45` e `WUL-44`.

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [PLANS.md](../PLANS.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/walkthrough.md](./walkthrough.md)
- [docs/COMPLIANCE.md](./COMPLIANCE.md)

## Stato attuale

MediFlow non integra ancora una catena SISS certificata.
Lo stato presente è un comportamento di servizio web locale che:

- apre i portali `operatorisiss`
- copia il Codice Fiscale negli appunti
- delega all'operatore il completamento manuale nel portale esterno

Questo significa che:

- non esiste un backend SISS mediato da MediFlow
- non esiste un canale certificato locale per autenticazione o prescrizione
- non esistono certificati o adapter SISS gestiti dall'app
- non esiste audit SISS dedicato, retry policy o mapping errori certificati

## Target certificato

Il target di lungo periodo è una catena locale esplicita, con step separati:

1. identificazione paziente e contesto operatore
2. autenticazione/canale certificato secondo le regole regionali
3. invocazione del servizio prescrittivo o documentale
4. tracciamento audit PHI-safe dell'operazione
5. gestione errori, retry e fallback espliciti

La baseline non definisce ancora il dettaglio tecnico del trasporto o dei
certificati; quello richiederà un ADR dedicato prima del runtime.

## Prerequisiti minimi

Prima di qualsiasi integrazione runtime SISS, MediFlow deve avere:

- baseline documentale con ambito e gap espliciti
- audit taxonomy estesa ai nuovi eventi SISS
- strategia sicurezza per canali, certificati e fallimenti
- flusso operatore chiaro e reversibile
- confini netti tra UI, mediator e servizi esterni

## Gap espliciti

Oggi mancano ancora:

- adapter certificato verso SISS
- backend mediator locale per prescrizione o documenti SISS
- contratto errori e retry policy SISS
- gestione credenziali/certificati dedicata
- audit SISS con correlazione di richiesta
- test sintetici del flusso certificato end-to-end

Il file `lib/siss.ts` e il pulsante nel profilo paziente restano quindi un
collegamento operativo al portale, non una integrazione certificata.

## Sequenza consigliata

La sequenza di lavoro per questo stream è:

1. `WUL-43`: baseline documentale e mappa dei gap
2. `WUL-45`: progettazione dell'adapter/mediator locale con audit, retry e
   mapping errori
3. `WUL-44`: integrazione del flow prescrittivo nel pannello operativo, solo
   dopo che il mediator e le sue regole sono stati fissati

Questa sequenza evita di legare l'UI a un comportamento SISS non ancora
certificato.

## Out of scope

Per questa baseline non sono inclusi:

- implementazione runtime SISS
- gestione certificati o PKI
- network discovery o pairing
- cambi al modello dati clinico
- export FSE end-to-end

## Nota operativa

Se questa baseline cambia in modo sostanziale, il primo aggiornamento deve
passare da `docs/README.md` e da un ADR dedicato al comportamento runtime.
