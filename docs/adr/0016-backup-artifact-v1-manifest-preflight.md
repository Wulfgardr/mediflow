<!-- Codex: created 2026-03-17 -->
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
- Le collezioni v1 includono solo quelle esportabili via API locale:
  `ambulatories`, `attachments`, `conversations`, `drugs`, `entries`,
  `exemptions`, `messages`, `observations`, `patients`, `checkups`,
  `therapies`.
- Il restore esegue un preflight server-side: format, versione, scope,
  checksum, counts e riferimenti interni devono essere coerenti prima di
  cancellare o reinserire i record.
- Il restore scrive direttamente su SQLite via route server-side dedicata, cosi
  timestamps e record persistiti restano fedeli al payload dell'artifact.
- `patients.ambulatoryId` viene ripristinato anche nella relazione join
  corrispondente, senza introdurre un payload separato per `patients_to_ambulatories`.

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
