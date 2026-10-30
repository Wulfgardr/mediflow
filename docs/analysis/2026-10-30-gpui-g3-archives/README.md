# GPUI: backup e ricevuta del ripristino

Base `498658cbf` (#723 e #725). Riferimenti: contratto 0.9.1,
G-3a–d del censimento GPUI, WUL-771 e WUL-706.

**G-3 resta parziale.** Il contributo consegna backup completo cifrato e
verifica, esportazione e ripristino portabile con conferma, confronto atomico
e ricevuta durevole rileggibile. Non chiude selezione/creazione dell’archivio,
modo host, programmazione, recupero completo offline o zona pericolo nativi.

## Superfici di scrittura e recupero

| Superficie | Autorità ed effetto |
| --- | --- |
| Gestione locale GPUI | Cookie/control P3 e attestazione loopback della #725, senza duplicarla. Nessuna nuova autenticazione o autorità paired. |
| GET `/api/system/backup-restore` | Esportazione canonica Web; GPUI verifica formato e leggibilità dei campi cifrati prima di salvare. |
| POST `/api/system/backup-restore/verify` | Preflight senza scrittura; aggiunge impronta della fonte e snapshot letto in transazione tramite il collegamento SQLite già ammesso. Nessuna nuova connessione al driver. |
| POST `/api/system/backup-restore` | Per local-client sono obbligatori identificatore, snapshot e `RIPRISTINA`. Lo stesso executor Web confronta lo snapshot sotto `BEGIN IMMEDIATE`, prima delle cancellazioni. |
| Executor comune | Controlla che le tabelle cancellate siano vuote e che tutti gli inserimenti abbiano il numero di righe previsto. Salva e rilegge la ricevuta nella stessa transazione; nessun writer alternativo. |
| GET `/api/system/backup-restore/receipts/[id]` | Solo amministratore Web autenticato. Dopo il nuovo accesso GPUI confronta identificatore, impronta, origine e generazione corrente. La risposta del POST non sostituisce questo GET. |
| POST `/api/system/recovery-backup` | Snapshot completo dal servizio esistente; GPUI cifra in RAM nel formato Web `MDFREC01`, con chiave dati casuale, doppia autenticazione AES-GCM e stesso AAD. La master key non viene esportata. |
| File di backup | Selettore nativo prima della lettura remota; destinazione assente, creazione esclusiva, sincronizzazione e rilettura. Una copia già ammessa può terminare dopo il blocco. Un errore può lasciare un file parziale. |
| Registro locale | Prima dell’invio salva soltanto identificatore, origine e impronta. Nessun contenuto clinico o credenziale. Non sovrascrive un registro esistente; persiste al blocco/riavvio. |

Lo snapshot copre anche account, impostazioni e audit; esclude le associazioni
volatili sessione-generazione e le ricevute di questo protocollo. Qualsiasi
modifica concorrente coperta blocca il ripristino. Non si promette una
transazione composta fra HTTP, filesystem locale e database.

Le ricevute sono impostazioni riservate `archive.restore.receipt.<id>`:
POST, PUT e GET generici, oltre al writer condiviso delle impostazioni,
rifiutano l’intero prefisso. Solo il servizio nominato può inserirle nella
transazione di ripristino. La spec HTTP tenta creazione e sovrascrittura,
controlla 403, assenza della falsa ricevuta e identità di quella autentica.

Il contratto dei campi cifrati è un unico JSON Web/Rust, equivalente al
literal precedente. GPUI rifiuta tutti i valori illeggibili di quei campi
prima del preflight. Il formato portabile conserva account e chiavi correnti;
il backup completo comprende anche account e involucri delle chiavi, ma il
suo recupero resta offline.

La conferma mostra nome e dimensione del file associati al comando preparato.
I rifiuti certi 400/403/409/412 liberano soltanto il registro corrispondente,
senza reinvio. Errori di trasporto, risposte 5xx e altri esiti incerti lo
conservano. Una ricevuta verificata richiede un gesto esplicito per chiudere
il registro. La perdita della risposta non autorizza una nuova scrittura.

## Scenari provati

| Scenario | Esito osservato |
| --- | --- |
| Annullamento della revisione GPUI | Nessun POST di ripristino o registro; blocco: parola e comando ritirati. |
| Conflitto | 409 `restore_blocked`, motivo `snapshot`, nessuna sostituzione o ricevuta. GPUI invia una volta, chiude l’accesso e libera il proprio registro dopo il rifiuto certo. |
| `ARCHIVE_REPLACED` | Vecchia generazione rifiutata; sessione precedente invalida. Riapertura e ricevuta sul nuovo archivio. |
| `SIGKILL` dopo la cancellazione dei pazienti, dentro la transazione | Riapertura SQLite integra: archivio precedente, account/chiavi/storico e generazione identici; ricevuta assente. |
| Arresto dopo commit | Record e allegato sintetico recuperati, chiavi e storico conservati, ricevuta presente. |
| SQLite ignora una cancellazione | Controllo del vuoto fallisce; rollback completo. |
| SQLite ignora un inserimento clinico | Conteggio delle righe fallisce; rollback completo. |
| SQLite ignora l’inserimento della ricevuta | Conteggio/rilettura falliscono; rollback completo. |
| Chiave errata, file troncato o tag alterate | Verifica rifiutata; nessuna sostituzione. Vettore comune Web/Rust con identità dei byte. |

I guasti SQL sono trigger/funzioni delle sole fixture, installati dopo
l’apertura dell’archivio sintetico. Nessun interruttore di guasto nel prodotto.
Prima delle correzioni, i tre test delle scritture ignorate fallivano perché
il writer poteva completare una sostituzione incompleta; ora passano.
Non sono prove di interruzione dell’alimentazione o di recupero completo
nativo. Tutti gli archivi sono inventati e temporanei, con percorso verificato
prima delle operazioni distruttive. Nessun archivio reale o copia primaria.

## Verifica

Sul runtime `d07f93fbbe5f69d4e74a68a8826c67db803cee10`:

- Build standalone e spec HTTP con processo/archivio propri passate. La spec
  rifiuta la porta 3000 e ritira prima la sessione di setup con il logout
  locale esatto; nessuna modifica al processo condiviso.
- `npm run test:unit`: 8.870 + 61 + 66 test eseguiti, **8.974 passati,
  zero falliti, 23 saltati**. Node 24.18.0, percorsi fisici temporanei e
  sorgenti Mac congelate verificate; nessuna sostituzione delle fixture.
- **87 prove** su recupero, backup completo/portabile, audit, chiavi e ledger
  passate; **28 prove** su policy, writer e confini HTTP delle ricevute passate.
- Rust workspace prima del delta finale: **484 passati, otto ignorati
  preesistenti**. Sul delta: **tre prove GPUI dell’area archivi e tre del
  trasporto passate**; Clippy di tutti i target con `-Dwarnings` e fmt passati.
  Usata `gpui_apple/runtime_shaders`; resta l’avviso upstream `block 0.1.6`.
- Typecheck, lint, claims, never-regress e censimento database passati;
  **20 test**, comprese le fixture negative del confine database, passati. Selezione COMPLETE:
  **1319 file, 1276 selezionati, 43 esclusioni motivate**.
- Raccordo formale delle terapie: **5.903.794 stati distinti**, coda vuota,
  invarianti invariati; tre mutanti e sei testimoni del modello rilevati,
  **122 test causali**, due mutanti del controller e **29 test restaurati**.
  Il confronto verifica identità dei campi cifrati e del resto di `lib/db.ts`;
  il JSON condiviso entra nei pin. TLC non viene esteso a backup o ricevute.

La galleria esterna `~/Antigravity/mf-hillclimb-20261028/gpui-g3-<head>/`
conserva log completi, inclusi i rossi, prove formali e SHA-256. Il CSV in
questo dossier identifica le sorgenti; nessuna galleria in Git.

## Mutazioni e rossi conservati

| Mutazione richiesta, in copia temporanea | Asserzione che fallisce |
| --- | --- |
| Rimozione della conferma | `Missing expected exception` sul comando senza parola. |
| Rimozione del confronto atomico | Paziente `after` invece di `before`: modifica concorrente sovrascritta. |
| Ricevuta inventata senza GET | `receipt GET absent`, quindi fallimento della prova del trasporto. |

Il test della ricevuta usa un riscontro causale al ritorno del metodo,
senza dipendere dalla durata del login. Una riesecuzione verde che non aveva
ricompilato il mutante non è stata conteggiata: la prova valida usa un target
separato, con compilazione osservata dal percorso mutato, e fallisce come
atteso. Gli artefatti e i log dei due casi restano distinti. Nessuna mutazione
rimane nel ramo.

Altri rossi intermedi conservati: fixture Mac esterne mancanti; guard del
vecchio literal dei campi cifrati; mock/import nuovi; selettore CI; Clippy e
CSV; build inizialmente respinta per alias di Next dev o sorgente non ancora
commessa; setup della spec isolata. Le CI hanno rilevato il pin formale di
`lib/db.ts` e la nuova connessione readonly: il primo è stato riesaminato,
la seconda eliminata a favore del collegamento già ammesso. Nessun guard,
test, invariante o limite del prodotto è stato allentato.

Un run unit precedente ha avuto un rosso MCP esterno al diff (`history,
search` anziché `search`), poi il modulo isolato passa 15/15 e le esecuzioni
complete successive sono verdi. Un rosso di terminazione OCR esterno al diff
nel primo run è anch’esso conservato. La nuova regressione delle ricevute
prima della riserva del prefisso falliva con `true !== false`.

## Residui

Restano selezione/creazione dell’archivio e modo host, programmazione,
recupero completo con kit/chiave nel client GPUI, reset/repair/purge,
fix-orphans, migrate-m2m e seeder nativi. L’owner di manutenzione esistente
non è stato ampliato implicitamente a un lifecycle generale; i comandi delle
sedi già integrati restano quelli esistenti.

Limiti del client: portabile **8 MiB**, completo **512 MiB**. Un invio incerto
senza ricevuta conserva il registro e blocca altri ripristini: manca una
risoluzione nativa assistita del dubbio. VoiceOver, percorso Mac installato
qualificato e accettazione clinica non sono attestati dai test sintetici.
Nessun rinvio al Web è contato come completamento nativo.

Implementazione assistita: GPT 6.1 Sol, effort xhigh. Nessun collaboratore
aggiuntivo; consumi non attribuibili. PR in bozza, nessun merge o auto-merge;
review indipendente del diff finale ancora necessaria. Gli esiti CI vanno
letti sull’head della PR.


## Integrazione con main e prova nella finestra Mac

Integrato `origin/main` `37116136a` con il commit `3d9f8cf04`.
L’unico conflitto era nella fixture Playwright: conservati annullamento e
selezione del plugin, percorso dati isolato e rifiuto della porta 3000.
Sul nuovo standalone `3d9f8cf04b94cb623c91127a8c483a3cee59cd03`, build e
spec HTTP passano; typecheck e lint passano. Due esecuzioni complete della
suite unit passano: ciascuna **9.001 test, 8.977 passati, zero falliti,
24 saltati**. JavaScript e writer Web non cambiano nei commit successivi;
i delta finali riguardano soltanto il client Rust, le sue prove e il dossier.

Workspace Rust al commit `de22190a7`: **486 passati, otto ignorati**.
Il successivo delta delle righe Impostazioni passa le **tre prove** dedicate;
il delta finale del ritiro passa **otto prove** della gestione locale e
archivi. Clippy workspace/tutti i target con `-Dwarnings`, fmt e **171 prove**
della selezione passano sul sorgente finale. Questi gruppi si sovrappongono.

La prova interattiva usa una copia temporanea ad-hoc del binario debug,
`runtime_shaders`, archivio e stato interfaccia in cartelle temporanee private.
Binario osservato: `6efa10cbc058e87d042192a12654bd89a82db7e6`;
l’identità autorevole e il SHA-256 dell’eseguibile sono nel manifest esterno.
Non è il bundle qualificato G-9: il packager ordinario richiede Metal
precompilato e rifiuta `runtime_shaders`. Nessun archivio reale utilizzato.

Esiti osservati nella finestra Mac con accessibilità attiva:

- Abbinamento e accesso, Impostazioni e Archivi e backup, nuova autenticazione
  della gestione locale; selettori nativi e backup completo cifrato di
  **622.688 byte**, sincronizzato e riletto.
- Anteprima del file portabile, pulsante distruttivo disabilitato senza parola,
  annullamento: pazienti, utenti/chiavi, audit e generazione identici;
  ricevuta e registro di invio assenti, verificati sul solo archivio temporaneo.
- `RIPRISTINA`, invio dalla UI, sostituzione e ricevuta durevole. Record e
  chiavi identici, ogni evento precedente conservato. Il vecchio abbinamento
  viene rifiutato. Riavvio del solo servizio posseduto sullo stesso loopback,
  nuovo abbinamento e nuovo accesso, GET della ricevuta dalla UI nativa;
  «Concludi verifica» elimina il solo registro corrispondente. Ricevuta unica,
  nessun reinvio. L’ultima gestione locale viene chiusa con ritiro confermato.
- Il file completo prodotto da GPUI viene recuperato dal **writer offline
  canonico**, dopo l’arresto del processo sorgente, in una seconda cartella
  temporanea vuota. Record e involucri delle chiavi identici; gli otto eventi
  originali identici più il solo evento canonico `territorial.packs.preserved`;
  generazione nuova, zero sessioni restaurate. Questo non è un recupero
  completo eseguito dalla UI GPUI.

La prova reale ha trovato due collisioni di accessibilità nell’ingresso delle
Impostazioni: pulsante Blocca ripetuto e descrizioni delle righe senza un
contenitore identificato. I panic e due regressioni rosse precedono le
correzioni: identità separate del pulsante e delle righe; le sei descrizioni
sono distinte attraverso due ridisegni. La compilazione intermedia richiedeva
anche il ritorno `Stateful<Div>`; il rosso è conservato.

Dopo il ripristino, un ritiro remoto non confermato nascondeva il messaggio
con le istruzioni per la ricevuta. La nuova regressione fallisce prima della
correzione e passa dopo: il modulo locale aggiorna la vista senza riscrivere
altri esiti. Il registro del ritiro e il suo avviso persistente rimangono
invariati. Nella prova interattiva resta l’avviso conservativo relativo alla
sessione precedente al ripristino: non viene cancellato dalla ricevuta o dal
successivo ritiro riuscito di un’altra sessione. La sua risoluzione nativa
assistita resta un limite.

Altri rossi della prova: build ordinaria senza Metal Toolchain, risolta nella
build di tutti i target con `runtime_shaders`; setup isolato con generazione
mancante, rifiutato 409 e corretto in una nuova fixture. Il primo controllo
dello storico offline pretendeva uguaglianza dell’intero elenco e rilevava
il legittimo evento aggiunto. Una rilettura indipendente in sola lettura della
stessa destinazione, senza ripetere il writer, verifica gli otto eventi
identici e l’unico evento aggiuntivo con tutti i campi previsti.

I due processi Web e le finestre native di questa prova sono stati chiusi;
archivi sintetici e risultati restano preservati esternamente. Nessuna nuova
galleria nel repository. **G-3 rimane parziale** per i residui dichiarati sopra;
CI finale e review indipendente non vengono dedotte dalle prove locali.
