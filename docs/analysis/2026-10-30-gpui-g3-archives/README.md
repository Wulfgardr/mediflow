# GPUI: backup e ricevuta del ripristino

Base: `498658cbf` (main, #723 e #725). Riferimenti: contratto 0.9.1,
G-3a–d del censimento GPUI, WUL-771 e WUL-706.

**G-3 resta parziale.** Questo contributo consegna esportazione portabile,
backup completo cifrato e sua verifica, ripristino portabile con conferma,
confronto atomico dello snapshot e ricevuta durevole rileggibile. Non attesta
apertura/creazione dell’archivio, modo host, programmazione, recupero completo
o zona pericolo nativi. Non è una chiusura del contratto G-3.

## Scritture e recupero

| Superficie | Autorità ed effetto |
| --- | --- |
| Gestione locale GPUI | Riusa cookie/control P3 e attestazione server loopback della #725. Nessuna nuova autenticazione, grant paired o attestazione alternativa. |
| GET `/api/system/backup-restore` e POST `/api/system/backup-restore/verify` | Il primo esporta con la route esistente; il secondo mantiene il preflight senza writer. Aggiunge impronta della fonte e snapshot letto tramite il collegamento SQLite già ammesso dal runtime, in una transazione di lettura. |
| POST `/api/system/backup-restore` | Le sessioni local-client devono presentare identificatore, snapshot e parola `RIPRISTINA`. Lo stesso executor Web controlla lo snapshot sotto `BEGIN IMMEDIATE`, prima della cancellazione. |
| Executor comune | Nella stessa transazione salva `archive.restore.receipt.<id>` nelle impostazioni, con impronta della fonte, generazione finale e data. Non aggiunge un secondo writer. Record, chiavi, allegati e storico seguono il contratto portabile esistente. |
| GET `/api/system/backup-restore/receipts/[id]` | Solo amministratore Web autenticato. GPUI riapre l’autorità dopo il ripristino e confronta identificatore, fonte, origine e generazione corrente. La risposta al POST non sostituisce il GET. |
| POST `/api/system/recovery-backup` | Snapshot completo dal servizio esistente; GPUI cifra in RAM nel formato `MDFREC01`, con chiave dati casuale distinta, doppia autenticazione AES-GCM e stesso AAD del Web. La chiave master non viene esportata. |
| File scelti dal medico | Selettori nativi prima della lettura remota; destinazioni assenti, creazione esclusiva, sincronizzazione e rilettura. Una copia già ammessa può terminare dopo il blocco, come le copie documentali. Un errore può lasciare un file parziale. |
| Registro locale GPUI | Prima dell’invio conserva soltanto identificatore, origine e impronta; nessun contenuto clinico, cookie o chiave. Un registro esistente non viene sovrascritto. Persiste al blocco e al riavvio; si chiude soltanto dopo una ricevuta verificata e un gesto esplicito. |

Lo snapshot copre le tabelle dell’archivio, compresi account, impostazioni e
audit; esclude le associazioni volatili sessione-generazione e le ricevute
di questo stesso protocollo. Qualsiasi modifica concorrente osservata dal
confronto blocca il ripristino. Non si promette una transazione composta tra
HTTP, filesystem locale e database.

Il contratto dei campi cifrati è ora un unico JSON consumato da Web e Rust:
il client rifiuta **tutti** i valori cifrati illeggibili dei campi del contratto prima del preflight.
Il formato portabile non comprende account e involucri delle chiavi; questi
rimangono nell’archivio corrente. Il backup completo comprende anche tali
elementi, ma il suo recupero resta offline.

## Scenari e limiti delle prove

- Annullamento della revisione GPUI: nessun POST di ripristino e nessun registro;
  blocco: parola e comando ritirati. Il selettore fisico macOS non è attestato.
- Snapshot cambiato: 409 `restore_blocked`, motivo `snapshot`, nessuna sostituzione
  o ricevuta. Una vecchia generazione ottiene `ARCHIVE_REPLACED`.
- `SIGKILL` dopo la cancellazione dei pazienti, dentro la transazione reale:
  al riavvio SQLite integra, archivio precedente, account/chiavi/storico e
  generazione identici, nessuna ricevuta. Il guasto è introdotto da un trigger
  e una funzione della fixture; nessun interruttore di guasto nel prodotto.
- `SIGKILL` dopo il commit: dati e allegato sintetico recuperati, chiavi e
  storico conservati, ricevuta presente. Non è una prova di interruzione
  dell’alimentazione né del ripristino offline completo.
- HTTP reale: conferma mancante, conflitto, invalidazione delle sessioni,
  riaccesso e ricevuta GET; archivio temporaneo sintetico. La spec finale
  possiede un runtime standalone separato e rifiuta la porta 3000.
- Codec completo: vettore sintetico comune Web/Rust, identità dei byte,
  rifiuto di chiave errata, troncamenti e alterazioni di entrambe le tag.

Le tre mutazioni sono eseguite in una copia temporanea indipendente:

| Mutazione | Asserzione che fallisce |
| --- | --- |
| Rimozione della conferma | `Missing expected exception` sul comando senza parola. |
| Rimozione del confronto atomico | Paziente `after` invece di `before`: la modifica concorrente è sovrascritta. |
| Ricevuta inventata senza GET | `receipt GET absent`, poi fallimento del test del trasporto. |

Nessuna mutazione rimane nel ramo. Tutti gli archivi sono inventati e
appartengono a cartelle temporanee verificate prima delle scritture distruttive.
Nessun archivio reale o copia primaria utilizzato.

## Verifica e residui

Verifica locale: Rust workspace 484 test passati, otto ignorati già previsti;
42 test mirati Node e 44 del selettore passati. Formattazione, Clippy con
`-Dwarnings`, typecheck, lint, never-regress e claims passati. Inventario
COMPLETE: 1319 file, 1276 selezionati, 43 esclusioni motivate. Le prove mirate
del trasporto sono state ripetute dopo l’ultima validazione del formato.
Un run di `npm run test:unit` conta 8841 passati, un fallito e
23 saltati: il fallimento è la cancellazione MCP esterna al diff, con
`history, search` invece di `search`; la stessa prova passa nella rilettura
isolata, senza modifiche. Le due invocazioni WHO successive non sono eseguite
dal launcher quando il primo gruppo è rosso. Il run successivo sul runtime `f6b1a155aa4a4a01807079ced0b095ab4d2756a0`
passa tutte le tre invocazioni: 8842 + 61 + 66 test passati, 23 saltati,
zero falliti. Il precedente rosso è conservato. La successiva riserva del
prefisso delle ricevute è verificata anche da 28 test pertinenti, incluse
le due nuove regressioni della policy e del writer condiviso. Le suite WHO residue sono poi state eseguite separatamente: 61/61 e
66/66 verdi, in sequenza. Build standalone e spec HTTP con runtime/archivio
propri passano sul runtime `91acfa2f5abfbdb1c0029a0b89dac708da0bcab8`.
La spec ritira prima la sessione di setup con il logout locale esatto.

La prima CI ha segnalato la deriva del digest di `lib/db.ts` nella copertura
formale delle terapie. Dopo il confronto strutturale del JSON e l’identità
byte per byte del resto del client, il raccordo documenta e fissa la nuova
fonte condivisa. `verify:therapy-status` passa: 5.903.794 stati distinti,
coda vuota, invarianti invariati; tre mutanti e sei testimoni del modello,
122 test causali, due mutanti del controller e 29 test dopo ripristino.
Questa correzione cambia soltanto copertura e documentazione: il prodotto
mantiene le sorgenti del runtime verificato. Gli esiti CI sull’head sono
riportati nella PR. I log completi, compresi i rossi,
restano fuori dalla repository nella cartella `gpui-g3-<head>` sotto
`~/Antigravity/mf-hillclimb-20261028/`. Il CSV locale identifica le sorgenti;
non viene aggiunta una galleria in Git.

Rossi intermedi: fixture Mac esterne mancanti (tre test), guard del vecchio
literal dei campi cifrati, mock dei nuovi import, guard delle dipendenze del
preflight e trigger del selettore CI; corretti o configurati con gli originali
fissati. Un test di terminazione OCR non pertinente ha osservato soltanto
`terminate` anziché `terminate, kill` nel primo run: riportato senza cambiare
il test. Clippy ha richiesto il collasso di un `if`, corretto. Il primo tentativo
di build standalone locale è stato respinto dal guard per alias di Next dev;
il successivo richiedeva un commit pulito. Nessun guard è stato disattivato.

Restano: selezione/creazione dell’archivio e cambio modo host; programmazione;
recupero completo con kit/chiave nel client GPUI; reset, repair, purge,
fix-orphans, migrate-m2m e seeder nella zona pericolo. L’owner amministrativo
esistente offre solo il recupero/repair già contrattualizzato, non una porta
nativa generale per cambiare archivio. Non è stato ampliato implicitamente.
I comandi delle sedi già integrati restano quelli esistenti.

Il client portabile è esplicitamente limitato a 8 MiB (il Web conserva il suo
limite maggiore); backup completo e verifica a 512 MiB. Un invio con esito
incerto e nessuna ricevuta conserva il registro e impedisce altri ripristini:
non offre una cancellazione ottimistica del dubbio. Mancano qualifica del
percorso Mac installato, VoiceOver, verifica dei selettori e accettazione
clinica. Queste prove non sono sostituite da build o test sintetici.

Implementazione assistita: GPT 6.1 Sol, effort xhigh. Nessun collaboratore
aggiuntivo; consumi non attribuibili. Nessun merge o auto-merge.


La CI ha inoltre rifiutato il nuovo import diretto del driver per la lettura
dello snapshot. Tale connessione è stata eliminata: anteprima e ricevuta
usano il collegamento canonico già ammesso. Il censimento registra soltanto
l’esatto import `openDbServer` del servizio nominato, senza nuova connessione,
writer alternativo o accesso SQL Rust. I guard e le relative fixture negative
sono stati rieseguiti. Le prove precedenti del writer e del codec restano
valide; il percorso HTTP viene rieseguito per il nuovo adattatore di lettura.


Il riesame dei consumer ha riprodotto un diniego mancante: la policy delle
impostazioni accettava il prefisso delle ricevute come chiave sconosciuta
scrivibile dal Web. La nuova regressione falliva con `true !== false`.
Il prefisso condiviso è ora riservato al servizio: POST, PUT, GET generici e
il writer comune delle impostazioni lo rifiutano. La spec HTTP tenta sia la
creazione di una falsa ricevuta sia la sovrascrittura di quella reale;
controlla 403, assenza della falsa e identità della ricevuta autentica.
