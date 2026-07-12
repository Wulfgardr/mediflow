# ADR 0079: attese locali e collegamento prestazione-risultato

Date: 2026-07-12
Status: Proposed

Related: [ADR 0057](./0057-local-evidence-absorption-layer.md), [ADR 0062](./0062-service-prescriptions-domain.md), [ADR 0064](./0064-service-prescription-itemization-and-catalog-matching.md), [ADR 0056](./0056-network-observation-write-boundary.md)

## Problema

Una prestazione prescritta puo restare senza esito registrato nella Scheda. Le
serie di osservazioni possono anche interrompersi senza che la UI renda visibile
il semplice fatto temporale. Mancano un collegamento esplicito tra risultato e
item di prestazione e una proiezione locale delle attese.

## Contesto

La prima slice e web locale. Le osservazioni restano scritture manuali,
versionate e review-first. La proiezione deve usare solo record gia persistiti,
soglie temporali dichiarate e provenance leggibile. Non interpreta dati clinici,
non assegna priorita e non produce prescrizioni o azioni automatiche.

## Opzioni

1. Mostrare promemoria liberi senza collegamento persistito.
2. Collegare un risultato a un item e derivare le attese localmente.
3. Aggiungere un motore remoto di reminder o una sincronizzazione paired.

## Trade-off

- Opzione 1: e semplice, ma non chiude in modo verificabile l'attesa.
- Opzione 2: conserva provenance e chiusura deterministica con un diff locale.
- Opzione 3: amplia rete, dati e contratti prima di avere una slice web utile.

## Decisione

Adottiamo l'opzione 2.

- `observations.service_prescription_item_id` e un riferimento nullable a
  `service_prescription_items.id`; la cancellazione fisica dell'item conserva
  il risultato e azzera il collegamento tramite `ON DELETE SET NULL`.
- Una proiezione pura segnala item `prescribed` o `performed` senza referto,
  senza osservazione collegata e oltre 14 giorni dalla data programmata o di
  creazione.
- La stessa proiezione segnala una serie solo quando ha almeno tre date di
  misura distinte, calcola la mediana sui soli intervalli positivi tra tali
  date, non supera 180 giorni e l'ultima misura supera 1,5 volte tale
  intervallo.
- La Scheda mostra solo righe aperte con provenienza e una CTA che precompila
  il form osservazioni. Il salvataggio resta sempre un gesto esplicito
  dell'operatore.
- Il normalizer accetta il collegamento solo dalle route web locali. Il
  boundary `/api/v1` e paired non viene esteso in questa slice.

## Conseguenze

Un'osservazione collegata o `reportReceivedAt` valorizzato chiude l'attesa
dell'item. Le attese si aggiornano dalla lettura locale senza job, rete o
modello. La parity paired del collegamento e della CTA resta un follow-up
separato, con contratto API e decisione dedicati.

## First Thin Slice

1. Aggiungere colonna, guardia runtime e artefatto Drizzle storico.
2. Introdurre proiezione pura con test di soglia, mediana e ordinamento.
3. Mostrare le righe aperte nella Scheda e precompilare il form locale.
