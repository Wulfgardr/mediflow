# ADR 0022: Backup automatico notturno via `launchd` su macOS

Date: 2026-03-18
Status: Superseded

Superseded by: [ADR 0068](./0068-cross-platform-runtime-windows-linux.md), che
porta lo scheduling backup dietro un `SchedulerAdapter` cross-platform (launchd
su macOS, Task Scheduler su Windows, systemd-timer o cron su Linux). La decisione
sotto resta valida come thin slice macOS originaria.

## Problema

L'artifact backup v1 esiste gia, ma il suo uso e solo manuale dal browser.
`WUL-30` richiede un backup automatico locale, affidabile e verificabile, senza
introdurre cloud sync o dipendere da una tab aperta.

## Contesto

- MediFlow e local-first e il Mac e l'home base architetturale.
- Il backup v1 con manifest/checksum e il restore preflight sono gia canonici
  tramite ADR 0016.
- Il job deve poter girare in modo headless anche senza browser aperto.
- `WUL-31` retention e cleanup storico restano fuori da questa slice.

## Opzioni

1. Timer nel client web o job in-process dentro Next.js.
2. Scheduler applicativo generico cross-platform in repository.
3. Adapter OS-level minimo: `launchd` utente su macOS + runner headless locale.

## Trade-off

- Opzione 1:
  - Pro: semplice da sviluppare.
  - Contro: non affidabile; fallisce se browser o app non sono attivi.
- Opzione 2:
  - Pro: astrattamente piu portabile.
  - Contro: troppo ampia per questa fase; introduce un framework di job non
    necessario.
- Opzione 3:
  - Pro: coerente con "Mac home base", affidabile, diff limitato.
  - Contro: thin slice inizialmente macOS-only.

## Decisione

Adottiamo l'opzione 3.

- Il backup notturno usa un `LaunchAgent` utente su macOS.
- La configurazione minima e persistita in `settings`:
  - `enabled`
  - `hour`
  - `minute`
  - `destinationDir`
- Il job esegue un runner headless locale che:
  - legge `medical.db`
  - genera un artifact `.mediflow` v1
  - scrive esito, timestamp e path ultimo artifact nelle stesse settings
- Il pannello web Impostazioni resta il punto di configurazione e verifica.

## Conseguenze

- Positivo: il backup automatico non dipende da una sessione browser aperta.
- Positivo: il formato artifact resta identico a quello manuale v1.
- Positivo: il failure mode e osservabile nella UI tramite stato ultimo run.
- Negativo: questa slice non copre Linux/Windows.
- Negativo: la retention automatica resta fuori scope.

## First Thin Slice

1. Definire stato scheduler persistente e adapter `launchd`.
2. Aggiungere runner headless che genera artifact v1 da SQLite.
3. Esporre UI minima per enable/time/destination + `run now`.
4. Salvare esito ultimo run e coprire il runner con smoke automatico.


## Controlli della destinazione durante la pubblicazione

Il runner conserva device e inode della directory verificata. Crea il temporaneo
con apertura esclusiva, riverifica percorso fisico, device e inode prima di
scrivere e prima e dopo la pubblicazione esclusiva con hard link. Confronta
device e inode del file pubblicato con il descrittore del temporaneo e verifica
i byte riletti. Un cambio rilevato produce errore, conserva il riferimento alla
copia precedente e permette di eliminare soltanto il proprio temporaneo ancora
identificabile. Un percorso cambiato può lasciare un temporaneo da esaminare.

Questi controlli rilevano scambi ai confini delle operazioni, ma Node non offre
`openat`: le operazioni a percorso non sono vincolate atomicamente al descrittore
della directory. Un attaccante locale con accesso in scrittura alla directory
di destinazione o ai suoi antenati è fuori dal modello di protezione di questo
runner. Può ancora intervenire fra due controlli, reindirizzare una scrittura
o ripristinare il percorso prima della verifica. I controlli non garantiscono
assenza di uscita dei byte contro tale attaccante.

La preview GPUI verifica la forma della configurazione senza dedurre il filesystem
o la home dell'host dalla macchina client. Il server decide l'ammissibilità della
destinazione; il runner la riverifica a ogni esecuzione. Il confronto lessicale
usa normalizzazione Unicode NFC e case folding uniforme, anche sui percorsi
risolti e sui nomi delle cartelle sincronizzate.

## Directory private Windows, novembre 2026

Le nuove destinazioni Windows usano una sottocartella `.mediflow-private`.
Prima di scrivere un payload la DACL deve essere protetta dall'ereditarietà e
contenere soltanto due ACE di accesso completo, propagabili a file e directory:
SID dell'utente corrente e SYSTEM. Una cartella preesistente con DACL più larga
viene rifiutata. I temporanei di creazione e ripristino del recupero applicano
la stessa verifica prima di scrivere lo snapshot.

Token, DACL e restrizione della nuova cartella passano dalle API Windows del
bootstrap nativo verificato, senza PowerShell, whoami o icacls a runtime per
questo controllo. Il produttore legge il SID dal token e le ACE da un handle
alla directory, rifiuta reparse point e filesystem senza ACL persistenti.
Il parser richiede SID numerici, esattamente due Allow FullControl, OI+CI,
nessuna propagazione speciale e nessuna regola ereditata. Solo una cartella
nuova e vuota può ricevere una nuova DACL. Le cartelle preesistenti non vengono
corrette automaticamente. Dinieghi per cartella esistente, filesystem e
controllo nativo indisponibile hanno rimedi distinti per l'utente.

Salvataggio della configurazione, runner, retention e lock usano la medesima
destinazione effettiva. Le vecchie configurazioni che indicano il padre
vengono risolte nella sottocartella privata, senza spostare o cancellare i
backup nel padre; la destinazione effettiva è mostrata prima della conferma
manuale della retention. Non è introdotta retention automatica.
Resta escluso un processo ostile con la stessa identità dell'utente che cambia
i permessi durante la scrittura. Il probe BitLocker precedente è distinto dal
controllo DACL e mantiene i limiti di verifica del volume già documentati.
