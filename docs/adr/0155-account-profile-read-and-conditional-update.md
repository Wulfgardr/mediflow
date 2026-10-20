# ADR 0155 — Profilo dell'account: lettura e aggiornamento condizionale

Data: 2026-10-20. Stato: Proposed; approvato per l'implementazione,
accettazione finale dopo review e integrazione protetta.
Riferimenti: WUL-771, ADR 0143, ADR 0153, ADR 0154.

Sostituisce la bozza «ADR 0156» citata nello stato di WUL-771 del 19 ottobre,
che non è stata pubblicata e non è recuperabile. Il numero 0155 è il primo libero.

## Problema

Il client nativo Rust/GPUI deve mostrare e modificare il nome dell'operatore e
quello dello studio. Oggi l'unica superficie è `PUT /api/auth/profile`:

- non esiste una lettura. Web e Apple mostrano i valori ricevuti al login, che
  restano fermi se un altro client li cambia;
- l'aggiornamento è incondizionato: vince l'ultimo che scrive, e un campo omesso
  diventa `null` e cancella il valore salvato;
- per le sessioni native non c'è verifica dell'archivio corrente né della
  sessione al momento del commit;
- l'audit è scritto dopo il commit e un suo fallimento viene ignorato.

## Contesto

Il profilo è il record `users` dell'operatore autenticato più i due valori
`doctorName` e `clinicName` di `settings`, che la scoperta di rete espone. Non
appartiene a un ambulatorio e nessuna capability di abbinamento lo concede.
`requireAccountSession` ammette già sia la sessione Web sia quella nativa abbinata.

La tabella `users` non ha una colonna di versione. Aggiungerla richiede una
migrazione, l'aggiornamento delle fixture storiche dello schema, dei confronti
di deriva e del giro di backup e ripristino.

Web (`app/settings/profilo/page.tsx`) e Apple
(`PairedPatientsWorkspaceModel.swift`) usano la PUT attuale senza versione e
non vanno rotti da questo incremento.

## Opzioni

1. Nuovo ingresso paired `/api/v1/network/account/profile` con una nuova capability.
2. Estendere `/api/auth/profile` con una GET e una variante condizionale della
   PUT, con versione derivata dal contenuto.
3. Come la 2, ma con una colonna `profile_version` in `users`.

## Trade-off

- Opzione 1: allinea l'ingresso agli altri percorsi paired, ma introduce una
  capability che ogni dispositivo già abbinato dovrebbe richiedere di nuovo, per
  un dato che non è d'ambulatorio. Duplica una superficie già usata da Web e Apple.
- Opzione 2: nessuna migrazione e nessuna nuova capability. La versione è
  un'impronta dello stato: due stati identici hanno la stessa versione (ABA), il
  che per due campi di testo senza storia è innocuo, perché lo stato atteso
  coincide con quello corrente.
- Opzione 3: versione monotona, ma con un costo di migrazione sproporzionato
  rispetto a due campi di testo.

## Decisione

Opzione 2.

### Versione

`profileVersion` è la stringa `p1:` seguita dall'esadecimale minuscolo di
SHA-256 sul JSON canonico `[userId, displayName, ambulatoryName]`, con `null`
per un campo assente. Il prefisso permette di cambiare la derivazione in futuro
senza ambiguità. L'host la ricalcola dentro la transazione; il client non la
deriva e la tratta come opaca.

### Lettura

`GET /api/auth/profile`, con l'ammissione di `requireAccountSession`.
Operazione `account-profile.read.v1`, `contractVersion: 1`. La risposta contiene
soltanto `operation`, `contractVersion`, `userId`, `username`, `displayName`,
`ambulatoryName`, `profileVersion` e `archiveGeneration`. Non restituisce ruolo,
hash, sali, chiavi, stato del blocco o dati di recupero.

Per una sessione nativa, una generazione d'archivio della sessione diversa da
quella corrente dà `409 ARCHIVE_REPLACED`. Tutte le risposte sono
`Cache-Control: no-store`.

La generazione e la sessione corrente sono verificate nella stessa transazione
sincrona che legge il profilo, dopo la risoluzione del database. Un ripristino
tra l'ammissione e la lettura non può esporre dati del nuovo archivio con la
vecchia generazione. Una sessione ritirata dà `401`, senza dati del profilo.

### Aggiornamento condizionale

`PUT /api/auth/profile` con `expectedVersion` nel corpo. Il corpo deve contenere
esattamente `expectedVersion`, `displayName` e `ambulatoryName`. I due nomi sono
obbligatori, stringa o `null`. Una stringa viene ripulita degli spazi esterni;
se resta vuota diventa `null`; oltre 200 caratteri dà `400`. Campi in più,
`id` compreso, danno `400`: il soggetto è sempre l'utente della sessione.

Per una sessione Web vale `archiveWriteRequestDenial`, come per le altre
scritture Web. Poi una sola transazione `IMMEDIATE`:

1. verifica che la generazione d'archivio della sessione sia quella corrente,
   altrimenti `409 ARCHIVE_REPLACED`;
2. verifica che la sessione sia ancora quella corrente: chiusa o sostituita
   dà `401`, senza effetti. La verifica riusa la logica di sessione corrente
   di `lib/network-patient-commit-authority.ts`, estratta senza duplicarla.
   Per i client nativi, lettura e aggiornamento rileggono anche pairing e modalità
   nella transazione attraverso lo stesso controllo usato dal guard network:
   pairing revocato dà `401`; modalità disabilitata dà `403 NETWORK_MODE_DISABLED`.
   Il profilo non richiede capability aggiuntive;
3. ricalcola `profileVersion` dalla riga corrente. Se diverso da `expectedVersion`
   risponde `409 PROFILE_VERSION_CONFLICT` con il profilo corrente e nessun effetto;
4. se i valori normalizzati coincidono con quelli correnti, non scrive nulla e
   risponde `200` con `changed: false` e il profilo corrente;
5. altrimenti aggiorna `users` e i due valori di `settings`, e scrive l'audit
   `settings.updated` nella stessa transazione con `writeAuditEventInTransaction`.
   Se l'audit fallisce, fallisce l'intera scrittura;
6. rilegge la riga e risponde `200` con `changed: true` e il profilo aggiornato,
   compresa la nuova `profileVersion`.

### PUT senza versione

Una PUT senza `expectedVersion` mantiene il comportamento attuale per Web e
Apple. È un debito dichiarato: quei client passeranno alla forma condizionale
in un'unità successiva, poi la forma incondizionata sarà rimossa.

## Conseguenze

- Il client nativo legge il profilo corrente e lo modifica senza sovrascrivere
  modifiche concorrenti, con l'esito riletto dall'host.
- Due modifiche concorrenti con la stessa versione attesa: una vince, l'altra
  riceve 409 con lo stato aggiornato.
- Nessuna migrazione dello schema e nessuna nuova capability.
- La route ha due semantiche di PUT finché Web e Apple non migrano. Il ramo è
  scelto dalla sola presenza di `expectedVersion`, e i test coprono entrambi.

## First Thin Slice

Host: GET e PUT condizionale in `lib/security/profile-update-service.ts` e
nella route esistente, con test su SQLite reale per versione, conflitto,
nessuna modifica, archivio sostituito, sessione revocata prima del commit,
audit nella transazione e invarianza della PUT senza versione. Il consumer GPUI
è un'unità successiva che usa questo contratto.
