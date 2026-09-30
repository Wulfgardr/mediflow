# ADR 0138: nessuna adozione implicita nella cartella dati scelta

Data: 2026-09-27. Stato: Proposed; accettazione con il merge della PR.
Riferimenti: WUL-686, WUL-724, WUL-729.

## Problema

Il runtime copiava `medical.db` dalla directory di lavoro anche quando
`MEDIFLOW_DATA_DIR` indicava esplicitamente una cartella nuova. Un nuovo
archivio o una fixture poteva quindi ereditare dati non selezionati.
Il veto `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1` veniva rispettato soltanto dal
preparatore E2E. Il preflight di ADR 0130 non proteggeva questo ramo runtime.

## Decisione

- Un `MEDIFLOW_DATA_DIR` non vuoto sceglie l'archivio: il runtime non cerca né
  copia il database legacy dalla directory di lavoro. La semantica del valore
  resta quella del resolver, inclusi i percorsi relativi.
- Il veto `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1` impedisce questa copia anche
  quando il runtime usa la cartella predefinita.
- Senza override né veto resta la migrazione storica verso il default, con
  copia SQLite che include WAL, staging e rename invariati.
- Il primo avvio nativo, che richiede una cartella dati esplicita, conserva
  creazione esclusiva nella cartella vuota e rifiuto della cartella non vuota
  senza database, anche se nella directory di lavoro esiste un legacy.
- Database già presenti e recupero di swap nella cartella selezionata non
  cambiano. Per trasferire un archivio serve un'operazione di recupero/import
  esplicita; la selezione di una cartella non equivale a tale richiesta.

## Limiti e verifica

La scelta intenzionale dello stesso percorso, anche tramite alias, apre lo
stesso archivio. Questo controllo non è una sandbox e non qualifica da solo
isolamento di sessioni, scheduler, backup, restore o dati clinici.

Il preparatore `scripts/prepare-e2e-db.mjs` mantiene il proprio contratto:
richiede ancora il veto esplicito per non copiare un legacy prima del runtime.
I nuovi test non lo usano e creano soltanto database sintetici in directory
temporanee proprie. Verificano due archivi distinti, riavvio, percorso relativo,
veto e compatibilità della migrazione default; la home è sostituita soltanto
nel processo figlio di prova, senza accedere alla cartella dati reale.

L'allineamento del primo avvio nativo verifica anche una destinazione non
vuota senza database in presenza di un legacy: deve restare bloccata e intatta.
La correzione estende esplicitamente il contratto runtime oltre ADR 0130;
non modifica il tag pubblicato `v0.8.6` né ammette un deployment clinico.
