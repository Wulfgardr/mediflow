# ADR 0064: Itemizzazione prescrizioni di prestazione e matching repertorio

Date: 2026-05-21
Status: Proposed

Related: [ADR 0062](./0062-service-prescriptions-domain.md),
ADR 0040 (private),
[ADR 0051](./0051-patient-import-decision-contract-between-review-and-persistence.md)

---

## Problema

`service_prescriptions` separa correttamente visite, esami, imaging,
riabilitazione e screening dalle terapie farmacologiche. La prima slice pero
puo ancora comprimere in una sola stringa gruppi di prestazioni come `esami
ematochimici`, perdendo gli atti distinti: emocromo, D-dimero, LDH, AST, ALT,
vitamina D e cosi via.

Serve una struttura che conservi il contesto documentale della richiesta e,
allo stesso tempo, renda codificabili i singoli atti quando arrivera il
repertorio ufficiale fornito dall'operatore.

## Contesto

- Le terapie farmacologiche restano un dominio ricco e separato: farmaco,
  AIC/ATC, principio attivo, posologia, motivazione e piano terapeutico non
  devono essere degradati o assorbiti dalle prestazioni.
- Il repertorio reale delle prestazioni non e ancora disponibile in repo.
- Document Ops e lo stack locale devono usare lo stesso contratto concettuale:
  recognition review-first, nessun auto-write da testo libero, nessun codice
  inventato.
- Il boundary SISS/FSE resta `webapp-assisted`: questa decisione non prescrive
  ufficialmente, non genera NRE e non invia dati regionali.

## Opzioni

1. Continuare con una riga libera per ogni richiesta.
2. Trasformare ogni atto in una `service_prescription` indipendente.
3. Mantenere `service_prescriptions` come contenitore e aggiungere item figli
   codificabili.

## Trade-off

- Opzione 1:
  - Pro: nessuna migrazione aggiuntiva.
  - Contro: impedisce matching affidabile e mischia pannelli complessi in testo
    libero.
- Opzione 2:
  - Pro: modello semplice per liste piatte.
  - Contro: perde NRE, quesito, fonte e priorita comuni alla prescrizione.
- Opzione 3:
  - Pro: preserva il documento come contenitore e rende codificabili gli atti.
  - Contro: aggiunge tabella figlia, UI piu articolata e backup/API dedicati.

## Decisione

Adottiamo l'opzione 3.

`service_prescriptions` resta il contenitore patient-scoped della richiesta:
data, priorita, categoria principale, quesito, struttura, riferimento
impegnativa, fonte documentale e note. Ogni contenitore puo avere zero o piu
`service_prescription_items`, uno per atto richiesto e potenzialmente
codificabile.

Gli item conservano nome, eventuale codice esplicito, categoria, stato, esito,
e stato di matching (`unmatched`, `candidate`, `matched`, `manual`,
`not_found`). Prima del repertorio reale, il catalogo locale resta uno scaffold
importabile e ricercabile, ma non autoritativo.

## Conseguenze

- Le richieste singole restano veloci: una prescrizione puo avere un solo item.
- I pannelli di laboratorio e le impegnative miste diventano leggibili senza
  perdere il contesto documentale.
- Il matching futuro deve essere bounded: lookup per codice, poi ricerca
  testuale limitata, mai scansione completa del catalogo in render UI.
- I campi clinici degli item restano cifrati lato client come il contenitore.

## First Thin Slice

1. Aggiungere `service_prescription_items` e `service_catalog_entries` con
   migrazione compatibile che crea un item iniziale dalle righe esistenti.
2. Esporre CRUD web session-protected per item e import/search locale del
   catalogo.
3. Aggiornare la UI del pannello prestazioni per inserire piu voci sotto una
   prescrizione.
4. Estendere il contratto AI/documentale per produrre `items[]` senza
   persistenza automatica non revisionata.
5. Verificare con esempi sintetici e casi live review-safe, mantenendo PHI fuori
   da repo, log e screenshot.
