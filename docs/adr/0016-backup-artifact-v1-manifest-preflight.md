# ADR 0016: Backup artifact v1 con manifest e restore preflight

Date: 2026-03-17  
Status: Accepted

## Problema

Il backup esistente e ancora uno stub raw e non garantisce un contratto
verificabile per export/restore. Manca un formato stabile che consenta di:

- dichiarare in modo esplicito cosa e incluso nel backup
- validare integrita e compatibilita prima di toccare i dati
- rendere il restore ripetibile senza introdurre cloud o schedulazione

## Contesto

- MediFlow resta local-first e non introduce egress cloud di default.
- La UI attuale di backup vive nel web client e deve continuare a essere
  semplice per l'operatore.
- Il restore deve preservare i record cosi come sono, non ricostruirli tramite
  create route che riscrivono metadati.
- `settings` e altre preferenze non hanno ancora un export/list endpoint
  simmetrico: non sono parte della first thin slice.

## Opzioni

1. Tenere un dump raw senza manifest.
2. Introdurre un snapshot binario direttamente sul file DB.
3. Introdurre un artifact JSON v1 con manifest, checksum e restore preflight.

## Trade-off

- Opzione 1: minimale, ma non verificabile e facile da corrompere senza
  accorgersene.
- Opzione 2: accurata per il DB, ma meno adatta al flusso browser e piu
  fragile da ispezionare o versionare.
- Opzione 3: leggibile, testabile e abbastanza rigorosa da rifiutare artifact
  invalidi prima della scrittura.

## Decisione

Adottiamo l'opzione 3.

- Formato canonico: `format = "mediflow-backup"`, `version = 1`.
- Il manifest contiene `scope`, `createdAt`, lista collezioni, counts per
  collezione e checksum `sha256` del payload canonicalizzato.
- Le collezioni v1 includono solo quelle esportabili via snapshot server-side
  dedicato:
  `ambulatories`, `attachments`, `conversations`, `drugs`, `entries`,
  `exemptions`, `messages`, `observations`, `patients`, `checkups`,
  `therapies`.
- L'export canonico passa da `app/api/system/backup-restore/route.ts`, che
  legge direttamente SQLite e non dipende da route client-scoped come
  `/api/patients`.
- I record `patients` possono includere il campo opzionale
  `assignedAmbulatoryIds` per preservare le assegnazioni secondarie
  many-to-many senza introdurre una collezione top-level separata nel formato
  v1.
- I nuovi artifact possono includere anche `assignedAmbulatoryMemberships`,
  metadato opzionale e retrocompatibile che conserva `ambulatoryId` e
  `assignedAt` di ogni relazione. Il restore usa questo valore quando presente
  e mantiene `assignedAmbulatoryIds` come fallback per gli artifact precedenti.
- Il restore esegue un preflight server-side: format, versione, scope,
  checksum, counts e riferimenti interni devono essere coerenti prima di
  cancellare o reinserire i record.
- Il restore scrive direttamente su SQLite via route server-side dedicata, cosi
  timestamps e record persistiti restano fedeli al payload dell'artifact.
- `patients.ambulatoryId` e gli eventuali `assignedAmbulatoryIds` vengono
  ripristinati anche nella relazione join corrispondente, senza introdurre un
  payload separato per `patients_to_ambulatories`.

## Estensione audit ordinario — WUL-730

I produttori correnti aggiungono la collection `auditEvents` al payload v1,
al manifest e ai counts/checksum quando la tabella sorgente esiste. Una tabella
presente vuota produce `auditEvents: []`; una tabella assente omette la collection.
Gli artifact precedenti restano leggibili dal nuovo lettore. L'omissione resta
distinta dal vuoto durante la normalizzazione e nel risultato del preflight e
del restore; non attesta una storia vuota o un recupero completo. I lettori
precedenti, che richiedono il vecchio set esatto, rifiutano la nuova collection.

Lo snapshot conserva tutte le tredici colonne persistite: identità, versione
dello schema evento, tipo/esito, attore/soggetto/superficie originali, requestId,
metadata testuale e timestamp SQLite in secondi. `createdAt` può essere `null`;
NULL e stringhe vuote restano distinti. Non si filtrano gli eventi in base ai
soggetti clinici ancora presenti né si rigenerano eventi tramite writer clinici.
ID duplicati nell'artifact sono invalidi. Con audit incluso, ogni snapshot audit
H7b deve esistere ed essere field-exact nella collection generale.

Il restore, sotto lo stesso writer lock e prima di cancellare dati target,
rifiuta un eventId presente con uno dei tredici campi diverso. Riusa soltanto
eventi identici e inserisce direttamente quelli assenti nella stessa transazione
dei dati clinici e del ledger H7b. Non aggiorna o cancella audit, conserva la
storia esclusiva del target e annulla anche gli eventi appena inseriti se la
transazione fallisce. Le guardie dei durable review commands, il mutation fence
e l'ammissione admin/trasporto esistenti restano invariati.

Il risultato conserva il checksum del payload originale prima della
normalizzazione, la copertura `included`/`omitted` e i conteggi eventi inseriti
o riusati. In modalità `omitted`, questi conteggi possono descrivere il solo
sottoinsieme H7b incorporato nell'artifact legacy. Checksum, conteggi e riferimenti
storici non autenticano la sorgente e non concedono authority, sessioni o chiavi.
Un re-export fotografa l'unione corrente, senza ricostruire storia omessa da un
artifact precedente. Questa estensione non qualifica il recupero completo C15.

## Conseguenze

- Positivo: il backup diventa verificabile e molto piu facile da manutenere.
- Positivo: il restore fallisce prima della scrittura se il file e corrotto o
  non compatibile.
- Positivo: il formato e leggibile e puo essere testato con artifact sintetici.
- Negativo: le preferenze non esportabili e i futuri follow-up di policy backup
  restano fuori da v1.

## First Thin Slice

1. Definire helper di artifact con checksum e validazione.
2. Esportare snapshot raw delle collezioni supportate nel file `.mediflow`.
3. Aggiungere restore server-side con preflight e scrittura diretta in SQLite.
4. Coprire il contract con test mirati sul manifest e sulla validazione.
