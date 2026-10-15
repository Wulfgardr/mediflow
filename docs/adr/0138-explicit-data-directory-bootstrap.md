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


## Emendamento 2026-10

Il lanciatore unificato conserva preferenze e ricevute per cartella sorgente
nella configurazione utente, con una chiave derivata dal percorso reale:

- macOS: `~/Library/Application Support/MediFlow/launcher`;
- Windows: `%APPDATA%\MediFlow\launcher` (fallback nella cartella
  `AppData/Roaming` dell'utente);
- Linux: `$XDG_CONFIG_HOME/mediflow/launcher`, oppure
  `~/.config/mediflow/launcher`.

Le directory sono riservate al proprietario: modo `0700` su POSIX e ACL del
solo utente corrente su Windows; i file nuovi hanno modo `0600` su POSIX e
su Windows ereditano la ACL della directory. Se non può proteggere la
configurazione, il lanciatore si ferma.
La risoluzione della configurazione non crea la cartella selezionata con
`MEDIFLOW_DATA_DIR`. Il lanciatore non vi salva più preferenze o lock.
Su macOS il percorso richiesto resta sotto la stessa radice predefinita di
MediFlow: la sottocartella `launcher` è riconosciuta soltanto in quella
posizione canonica, mai in una cartella dati arbitraria. Altre sovrapposizioni
fra configurazione e cartella dati sono rifiutate prima di creare directory.

La migrazione silenziosa riguarda solo `launcher-preferences.json` con lo
schema esatto del lanciatore e `.mediflow-launcher-<chiave>/instance.json`
con ricevuta della stessa sorgente, processo terminato e nessun altro file
nella directory. Non segue symlink o file con hard link, non sposta file
sconosciuti e non sostituisce preferenze già presenti. Conserva eventuali
copie in conflitto nella nuova configurazione. Un proprietario ancora vivo
impedisce la migrazione e richiede di arrestare quell'avvio. Non cancella
ricorsivamente directory dell'archivio.

Per `/api/auth/check`, in assenza sia del database selezionato sia del legacy,
il primo avvio ammette esclusivamente directory vuote o queste voci di servizio:

- directory `pm2`;
- file regolari `local-api-token`, `local-web-backend.pid`,
  `local-api-tls-proxy.pid`, `runtime-status.json`;
- directory `launcher` soltanto nella radice predefinita macOS sopra descritta.

I tipi devono corrispondere e i collegamenti simbolici non sono ammessi.
Qualsiasi altra voce, compresi backup, residui `*.db*`, directory sconosciute
o lock di manutenzione SQLite, mantiene `DB_MISSING` e richiede recupero
esplicito. Questa eccezione non cambia il preparatore del primo avvio nativo,
che riserva il database prima di scrivere i propri metadati, né autorizza
adozione di un archivio o scritture cliniche automatiche.

L'import del gestore PM2 e del modulo token locale è inerte rispetto al
filesystem. La home PM2, il controllo della lunghezza dei socket e il
caricamento di PM2 avvengono solo al suo primo uso runtime. Restano validi
isolamento dal daemon globale, rifiuto degli override esterni, controlli di
sessione e serializzazione delle connessioni. Un percorso dati troppo lungo
può ancora impedire MLX quando richiesto, ma non deve impedire la build o
il primo avvio senza MLX.
