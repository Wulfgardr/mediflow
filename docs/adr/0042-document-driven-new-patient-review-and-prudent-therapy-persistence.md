<!-- Codex: created 2026-04-03 -->
# ADR 0042: nuova anagrafica da documento con review esplicita e persistenza prudente delle terapie

Date: 2026-04-03  
Status: Accepted

## Problema

MediFlow aveva gia:

- OCR locale e analisi documentale reviewable
- autofill prudente delle sole diagnosi con codice ICD esplicito
- create-flow della nuova anagrafica con precompilazione dei campi base

Mancava pero un passaggio intermedio esplicito per il caso piu delicato:
creare una nuova scheda paziente partendo da un documento clinico senza
trasformare in modo opaco problemi e terapie estratti in dati strutturati.

Il rischio era doppio:

- precompilare troppo presto dati clinici ancora incerti o incompleti
- perdere il valore operativo delle terapie documentali, relegandole solo a
  nota libera anche quando il documento le supporta in modo abbastanza forte

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) richiede contratti espliciti, diff
  piccoli e niente scorciatoie architetturali.
- [SECURITY.md](../../SECURITY.md) impone output AI non fidato finche non
  reviewato e nessun import clinico silenzioso da free text.
- [ADR 0012](./0012-operator-reviewed-smart-import-from-patient-context.md)
  governa lo smart import reviewable sul profilo paziente gia esistente.
- [ADR 0027](./0027-ai-task-extraction-envelope-and-local-render.md) governa il
  contratto condiviso di estrazione per le lane documentali locali.

Questa decisione non apre nuovi endpoint `/api/v1` e non modifica il filone
native congelato.

## Opzioni

1. Continuare con precompilazione diretta nel form della nuova anagrafica,
   limitando la review ai soli campi testuali base.
2. Inserire una review esplicita field-by-field prima della creazione scheda,
   con riconciliazione locale ICD/AIFA e persistenza strutturata solo per le
   terapie sufficientemente confermate.
3. Tenere tutto come nota documentale da riconciliare dopo il salvataggio,
   evitando qualsiasi scrittura strutturata nel create-flow.

## Trade-off

- Opzione 1:
  - Pro: meno passaggi UI.
  - Contro: rischio di import troppo opaco; diagnosi e terapie non abbastanza
    governate.
- Opzione 2:
  - Pro: mantiene il controllo umano, sfrutta matching locale gia disponibile e
    riduce il lavoro post-creazione quando la terapia e abbastanza supportata.
  - Contro: aggiunge una review intermedia e logica di default-selection piu
    prudente.
- Opzione 3:
  - Pro: rischio minimo di write strutturati impropri.
  - Contro: spreca casi buoni gia abbastanza affidabili e lascia troppo carico
    manuale dopo il create.

## Decisione

Adottiamo l'opzione 2.

Nel create-flow `Nuova Anagrafica`:

- il documento viene prima analizzato e arricchito localmente
- problemi e terapie candidate vengono riconciliati in locale contro ICD-11 e
  catalogo farmaci AIFA/ATC
- l'operatore passa sempre da una review esplicita prima di applicare i default
  al form
- le diagnosi senza codice esplicito restano reviewable e non entrano in modo
  silenzioso
- una terapia viene persistita come record strutturato solo se:
  - resta selezionata in review
  - e marcata `active`
  - ha almeno nome farmaco e posologia utili
- i casi incompleti, incerti, non attivi o manual-only possono restare come
  nota documentale di supporto invece di forzare una `therapy` strutturata

## Conseguenze

Diventa piu semplice:

- creare una nuova scheda partendo da un documento senza perdere review e
  auditabilita operativa
- salvare subito le terapie piu solide senza doverle re-inserire a mano
- distinguere meglio tra terapia corrente, transizione e materiale solo
  documentale

Diventa piu difficile:

- trattare qualsiasi menzione farmacologica come terapia gia confermata
- usare il create-flow come scorciatoia per import silenziosi da testo libero

## First Thin Slice

1. Arricchire l'output documentale per la nuova anagrafica con candidati
   reviewable per problemi e terapie.
2. Introdurre una review draft esplicita prima del salvataggio.
3. Persistire come `therapies` solo le terapie confermate e sufficientemente
   supportate.
4. Aggiungere test dedicati e aggiornare la documentazione canonica del flusso.

## Fuori Scope

- nuovi endpoint `/api/v1` o parity native su questo create-flow
- import automatico di terapie manual-only senza match o posologia minima
- promozione del materiale documentale non confermato a dato strutturato senza
  review operatore
