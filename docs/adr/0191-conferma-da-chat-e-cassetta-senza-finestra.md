# ADR 0191: Conferma da Codex e cassetta senza finestra

Data: 2026-11-18

Stato: **Proposto**. Le due decisioni sono sottoposte separatamente a Leonardo.

## Punto di partenza

L'[ADR 0190](0190-mandato-agenti-e-cassetta-della-visita.md) distingue
il deposito dall'applicazione. CLI e MCP depositano buste cifrate via loopback con
un token associato a un mandato. In `packages/agent-client` il token serve
per il deposito e la ripresa. Il browser sbloccato apre le buste, verifica
l'identità del paziente e prepara i valori per i writer. Su `main` nota,
trascrizione e PDF verificati possono già entrare così. Terapie, diagnosi,
prestazioni, esenzioni ed osservazioni attendono il gesto in «In arrivo».
Il percorso Web autentica la sessione e distingue le due fasi, ma il
`POST` di «In arrivo» non verifica oggi una prova nativa del gesto.
Riferimenti: [guida al deposito](../agent-visit.md),
[preparazione Web](../../lib/agent-incoming.ts),
[route di applicazione](../../app/api/agent-mandates/incoming/route.ts),
[writer della visita](../../lib/agent-visit-application.ts).

Le due scelte riguardano l'autorità di conferma e la custodia della chiave.
Si può provare la conferma da chat con MediFlow già sbloccato e decidere
separatamente se la chiave può restare nel servizio senza una finestra aperta.

## 1. Confermare una visita da Codex

### Raccomandazione

Nel plugin «MediFlow Ambulatorio» il medico apre la conferma della singola
visita. MediFlow presenta un riquadro nativo di propria competenza, con
paziente, fonti, differenze rispetto alla scheda ed operazioni da registrare.
Il medico conferma lì con un Touch ID fresco. Dopo l'esito torna alla chat.
Il percorso parte da Codex e conserva un punto di controllo che il modello
non può impersonare. Basta il riquadro temporaneo sul Mac, anche senza una
finestra principale quando è attiva la modalità del punto 2.

La chat può chiedere di aprire quel riquadro e leggere un esito minimale.
Un «Confermo» nel transcript, un tool call, l'origine del frame, la firma
dell'host Codex o un token agente non attestano il gesto. La firma dell'host
può aiutare a riconoscere il software che si connette. Il riquadro e la prova
del gesto appartengono a MediFlow. Il meccanismo segue il confine dell'[ADR
0165](0165-native-chat-access-channel.md), la cui concessione attuale ha un
altro scopo. La compatibilità con il plugin e con il Codex desktop effettivo
va provata. Se manca il percorso fidato, il medico conclude in «In arrivo».

### Che cosa autorizza il gesto

1. MediFlow rilegge la cassetta chiusa, le fonti e lo stato della scheda.
   Costruisce il piano esatto da mostrare e da applicare, senza usare la
   selezione corrente o un nominativo fornito dalla chat. L'àncora dichiarata
   dall'agente non basta. Servono CF verificato nelle fonti, una sola scheda
   esistente e nessun PDF discordante. Il codice fiscale proveniente da
   prescrittori va trattato con lo stesso resolver dell'ADR 0190. Un dubbio
   sull'identità o sulla proposta rinvia a «In arrivo». L'anteprima si rende
   sul dispositivo, fuori da prompt, tool result e metadati del frame.
2. L'autorità locale crea una richiesta con un nonce casuale e una durata
   breve, inizialmente 60 secondi. Congela medico e sessione, dispositivo,
   archivio e generazione, mandato, agente, cassetta e revisione, paziente e
   sua versione. Lega la prova anche all'impronta di una rappresentazione
   canonica del piano e delle fonti mostrate. La prova vale per quella
   singola operazione.
3. Una chiave di firma del dispositivo, dedicata e registrata per
   l'account MediFlow, firma la richiesta solo dopo il gesto nel riquadro.
   L'uso della chiave richiede il set biometrico corrente, con contesto
   fresco e senza riuso dello sblocco mattutino. L'account macOS deve essere
   riservato al medico, con sole impronte autorizzate: Touch ID verifica
   un'impronta registrata sul Mac. L'identità clinica viene dalla sessione
   MediFlow. Annullamento, timeout o Touch ID indisponibile chiudono il
   tentativo. [Apple: criteri biometrici](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthenticationwithbiometrics).
4. La prova arriva direttamente al proprietario della scrittura sul canale
   locale privato. Il writer rilegge ammissione, mandato, pairing, sessione,
   versioni e piano. Una differenza richiede un nuovo riquadro. Il writer
   consuma la prova una sola volta nella transazione SQLite `IMMEDIATE` che
   applica la visita. Elementi, scritture, audit e ricevuta durevole
   confermano insieme. A risposta persa il client legge quella ricevuta
   tramite un riferimento opaco autorizzato. Duplicazione o modifica della
   richiesta non generano un secondo commit. Chiudere il riquadro o perdere
   il collegamento fidato prima del consumo ritira la richiesta pendente.

Il canale agente resta confinato a loopback e deposito. Restano esclusi
conferme per delega o per lotto da Codex, creazione di pazienti, modifiche
fuori piano, letture cliniche generiche, codici inventati, invio di ricette
o scritture SISS/FSE. Le proposte strutturate richiedono tutte la conferma,
incluse le osservazioni. Il percorso automatico non può cambiare il tipo
di una proposta o riversarla nel diario per evitare la revisione. Nota e
trascrizione restano documentazione della visita senza effetti sui registri
strutturati. La fase con conferma rispetta la precedenza del passaggio
automatico nelle cassette miste. La UI Web mantiene il suo percorso fidato.
Il nuovo ingresso non accetta direttamente `phase: review`, cookie Web o
identità fornite dal modello come prova.

### Audit e ricevuta

L'audit conserva il medico come autore (`actorType=user` e `recorded_by`
secondo l'[ADR 0183](0183-autore-delle-voci-di-diario.md)), il proponente,
il mandato, il provider dichiarato e l'indicazione di egress del mandato.
Distingue conferma «In arrivo», conferma avviata da Codex con Touch ID e
applicazione automatica autorizzata dal mandato. Registra riferimento opaco
della conferma e del dispositivo, revisione, fase, esito e conteggio.
I rifiuti rilevanti e le revoche hanno eventi locali con motivo codificato,
distinti dagli eventi di applicazione. Niente CF, dettagli clinici, token,
firma, credenziali o dati biometrici nei nuovi eventi. La ricevuta in chat
espone riferimento opaco ed esito, distinguendo deposito, attesa,
applicazione e diniego. L'audit locale attribuisce l'atto verificato e
conserva il provider dichiarato, dal quale non può dedurre quali dati il
provider abbia effettivamente ricevuto.

### Alternative e costo

- **Gesto in «In arrivo».** È il percorso disponibile ed il ripiego.
  Richiede di spostarsi nella scheda per ogni conferma.
- **Codice breve letto in MediFlow.** Può correlare richiesta e riquadro,
  come nel pairing. Se lo si trascrive in chat il modello può ripeterlo.
  Come prova unica non basta. Un PIN verificato solo da una UI MediFlow
  richiederebbe una decisione e prove proprie per questa operazione.
- **Conferma del solo host chat.** Si può riconsiderare se l'host espone
  una superficie locale verificabile, con gesto umano isolato dal modello
  e prova legata al piano. Una firma generica del dispositivo non
  documenta quel gesto.
- **Riquadro MediFlow e Touch ID.** Raccomandato per un pilota macOS.
  Consente di vedere il piano autorevole sul dispositivo ed usare la
  firma solo dopo un gesto dedicato.

Stima: **8–12 giorni di lavoro**. Due o tre per verificare il raccordo con
Codex ed il riquadro, tre o quattro per prova, writer ed audit, tre o cinque
per modello formale e prove sul Mac. La stima presuppone un trasporto locale
adatto. Se manca, il pilota si ferma alla prova di fattibilità.

### Prove per accettare l'implementazione

- **Empiriche.** Nel vero Codex desktop, su un archivio sintetico, il
  medico confronta fonti e differenze, annulla una volta ed applica una
  visita con Touch ID. Si controllano dati, audit e ricevuta. Lo stesso
  flusso senza gesto, con testo «Confermo», con l'identità del solo agente,
  con una revisione cambiata, con CF ambiguo o PDF discordante deve lasciare
  invariati i registri. Verificare biometria non disponibile, approvazione
  mattutina riusata, finestra chiusa, revoca, scadenza, retry concorrenti,
  risposta persa e rollback di un writer. Le prove del nuovo ingresso
  partono dalla base senza quel percorso e conservano i positivi di
  «In arrivo» e del solo deposito.
- **Formali.** Modellare anteprima, prova pendente, approvazione, consumo,
  scadenza, revoca e commit concorrente. Verificare che ogni applicazione
  strutturata dal plugin corrisponda a un solo gesto sullo stesso piano e
  alla stessa generazione. Una variazione di piano, paziente o generazione,
  anche dopo il gesto, invalida la prova. Nessuna scrittura senza consumo,
  audit e ricevuta nello stesso commit. Controllare che, togliendo il
  vincolo di revisione o di consumo, il modello trovi un controesempio.

## 2. Applicare la cassetta senza finestra aperta

### Raccomandazione

Offrire una modalità macOS facoltativa, spenta al primo avvio e disponibile
per un account v3. Dopo l'abilitazione, il medico avvia la sessione di lavoro
con un Touch ID fresco in MediFlow. Il servizio locale firmato conserva la
master key aperta nella propria memoria per al massimo 12 ore, e solo finché
valgono le condizioni sotto. Chiudere la finestra o il browser lascia
lavorare il servizio. Il mandato resta distinto: si apre come oggi e
definisce operazioni e fornitore. Il servizio può applicare nota,
trascrizione e PDF verificati per un mandato corrente autorizzato. Per le
voci strutturate attende la conferma del punto 1 o il percorso Web già
previsto. Senza conferma in chat approvata, la modalità senza finestra
riguarda il solo passaggio automatico.

L'abilitazione iniziale richiede passphrase v3 e Touch ID nella superficie
nativa firmata. Il servizio apre l'involucro v3 con la passphrase in memoria
e crea un secondo involucro legato a dispositivo, account ed archivio.
Autentica l'account con il verificatore v3 e registra l'abilitazione presso
il proprietario dell'archivio, con la generazione corrente e la versione
della credenziale. Anche il successivo avvio con Touch ID verifica quel
legame.
La passphrase e la master key aperta non transitano da browser, shell,
MCP o route HTTP verso il servizio. Il Portachiavi locale conserva
l'involucro, vincolato a una chiave privata P-256 generata nella Secure
Enclave e protetta dal set biometrico corrente. Chiave ed involucro sono
vincolati al dispositivo, accessibili solo all'identità firmata prevista
e fuori dalla sincronizzazione. La Secure Enclave protegge la chiave
privata usata per ottenere la chiave di avvolgimento. Dopo l'apertura
l'AES-256 dell'archivio è utilizzabile in RAM dal servizio: è lì che
avvengono decifratura delle buste, verifica dell'identità e preparazione dei
campi protetti per il writer esistente. L'involucro v3 ed il kit rimangono
le vie di sblocco e recupero indipendenti dal dispositivo.
[Apple: chiavi protette dalla Secure Enclave](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave),
[Apple: controllo sul set biometrico](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/biometrycurrentset).

Usare un processo per l'utente, senza privilegi amministrativi, distinto
da Codex, MCP e dal server di persistenza. Il servizio legge il minimo
necessario per la cassetta. Riusare resolver, validazioni e writer dell'ADR
0190 con prove di parità tra browser e servizio. L'interfaccia privata verso
il writer ammette solo le due fasi della cassetta ed identifica il peer
firmato e la sessione di lavoro. Trasporta i soli valori del contratto
esistente, con i campi protetti già cifrati. Nessun cookie Web, esecuzione
di codice del plugin, endpoint di decifratura o HTTP/LAN per il nuovo
canale. La firma e i controlli IPC limitano l'uso della chiave tramite
l'interfaccia. Chi ottenesse la master key in memoria potrebbe decifrare
tutti i campi protetti da quella chiave.

### Durata, blocco e revoca

- **Scadenza.** Le 12 ore decorrono dal gesto MediFlow su un orologio
  monotono che comprende la sospensione. Mandato ed agente possono scadere
  prima. Verificare la validità della sessione all'ammissione ed al commit.
  L'attività o la riapertura della finestra non la rinnovano. Ora civile e
  timeout della UI non decidono da soli.
- **Blocco.** L'inattività della scheda può chiudere la sessione Web
  lasciando attiva quella del servizio. Il blocco manuale di MediFlow,
  il blocco schermo, la sospensione, il cambio di utente, il logout e
  l'uscita esplicita da MediFlow terminano la sessione del servizio.
  Al risveglio o dopo un crash o riavvio serve un nuovo gesto MediFlow.
  Lo sblocco di macOS da solo lascia il servizio fermo.
- **Revoca.** Il medico può fermare la sessione, revocare mandato o
  pairing e disabilitare il dispositivo. Cambio di passphrase, recupero,
  sostituzione dell'archivio o cambio del set biometrico fanno decadere
  l'abilitazione e richiedono nuova registrazione. Alla chiusura della
  sessione il servizio ritira l'autorità, invalida il contesto biometrico,
  rilascia i riferimenti, azzera i buffer di cui ha controllo e termina il
  processo che detiene la chiave. Disabilitazione e cambio di credenziale
  comportano anche la rimozione dell'involucro locale e della sua chiave
  dedicata. Le regole dell'ADR 0190 continuano a governare il solo deposito
  cifrato. Una revoca locale non è una cancellazione a distanza di un
  portatile rubato offline.
- **Concorrenza.** Il proprietario del commit ordina l'invalidazione della
  sessione e le scritture. Dopo la barriera di revoca nessun nuovo commit
  può passare, compresi i lavori già preparati. Un commit già confermato
  rimane registrato e riconciliabile. L'ammissione richiede stato OS
  corrente e peer vivo, con esito negativo se lo stato manca. La prova
  sul Mac deve misurare la finestra fra evento OS e barriera. Se la
  piattaforma non consente di far valere la scadenza ed il blocco nel
  writer, la modalità rimane spenta.

### Modello di minaccia

| Situazione | Che cosa cambia e che cosa protegge |
| --- | --- |
| Disco copiato o Mac spento | L'involucro locale è legato al dispositivo e richiede biometria. L'involucro v3, il kit e gli artefatti mantengono la rispettiva protezione. FileVault e permessi limitano l'accesso a database, WAL ed eventuali residui. Alcuni dati e metadati SQLite restano leggibili a chi ottiene il file. |
| Altro utente o processo locale | La chiave aperta vive in un processo in più e più a lungo, anche dopo la chiusura del browser. Permessi, firma del peer, Hardened Runtime senza diritto di debug nella build distribuita ed accesso ristretto al Portachiavi riducono la superficie. Il token di deposito non apre il servizio. |
| Dump di memoria, swap o crash | Un dump del processo che decifra può contenere chiave e contenuti. Ridurre copie e vita dei buffer, escludere core dump del servizio e diagnostica con payload, evitare file temporanei in chiaro nel nuovo percorso, richiedere volume cifrato e provare crash e residui. La pulizia dei buffer posseduti non garantisce la cancellazione da ogni copia del sistema. |
| Malware con utente loggato | Un processo ordinario deve essere respinto dal confine IPC. Un malware che controlla il servizio, un processo fidato o il sistema operativo può osservare dati ed usare la chiave aperta. La Secure Enclave protegge il proprio segreto, non la RAM del servizio. |
| Mac rubato acceso | Se è sbloccato con servizio attivo, il passaggio automatico già autorizzato può operare. Un nuovo atto clinico strutturato dal plugin richiede ancora Touch ID. Il blocco dello schermo chiude la sessione, entro il confine OS verificato sopra. Autolock e FileVault riducono l'esposizione. |

### Backup, recupero ed altre piattaforme

Il [contratto dei dati a riposo](../data-at-rest-matrix.md) conserva il
recupero completo cifrato e l'export portabile con le tutele proprie di
ciascuno. Backup completo, kit corrispondente e chiave di recupero separata
devono bastare su un Mac nuovo o su una piattaforma supportata, senza
Portachiavi precedente. L'involucro dedicato al dispositivo, le chiavi della
Secure Enclave, le sessioni del servizio e le prove pendenti restano
fuori dagli artefatti MediFlow e dalla loro autorità di ripristino.
Le cassette conservano buste e privata avvolta come oggi. Dopo il restore
una nuova generazione ritira autorizzazioni precedenti. Il medico può
rivedere il deposito recuperato ed aprire le fonti, senza rieseguirlo con
vecchi mandati. Riabilitare il servizio richiede passphrase e nuova
registrazione. Togliere l'involucro locale non ruota la master key
dell'archivio e non ritira copie già sottratte.

Windows, Linux, Web ed avvio headless mantengono deposito cifrato e
applicazione dal browser sbloccato. Lo stesso vale su macOS senza
configurazione supportata, con biometria indisponibile o con account PIN
transitorio. Windows Hello, TPM o altri portachiavi richiedono una propria
decisione e prove. Evitare ripieghi con file di chiavi o sblocco con PIN.

### Claim WUL-342/354

L'eccezione proposta riguarda l'ADR 0190 e la custodia dell'[ADR
0143](0143-strong-unlock-credential.md). Cambia la condizione del claim
«master key aperta solo nella memoria del client» ammesso dall'[ADR
0065](0065-intended-purpose-and-claims-guard.md). Per la modalità macOS
si ritira la promessa che solo la scheda sbloccata possa disporre della
chiave e che chiuderla interrompa ogni applicazione. Anche nel profilo
browser va precisato che «Rinnova accesso» può riprendere la CryptoKey
v3 già in memoria di un'altra scheda autorizzata. Riferimenti:
[`security-provider.tsx`](../../components/security-provider.tsx),
[`tab-key-share.ts`](../../lib/security/tab-key-share.ts),
[`unlock-credential.ts`](../../lib/security/unlock-credential.ts).

Testo proposto per l'eventuale rilascio, dopo le prove:

> MediFlow cifra con AES-256-GCM i campi indicati nella matrice dei dati a riposo prima
> della scrittura. Identificativi, alcuni metadati ed alcuni export possono
> essere leggibili. Con lo sblocco v3 l'applicazione usa la chiave aperta in
> memoria. Se attivi la cassetta senza finestra su un Mac compatibile, anche
> il servizio locale MediFlow può usare quella chiave per un massimo di
> 12 ore dopo Touch ID, fino al blocco o alla fine della sessione.
> Il Portachiavi conserva una copia avvolta, vincolata a quel Mac. La
> chiusura della finestra lascia attiva la sessione del servizio.

Restano esclusi la cifratura integrale di SQLite, lo zero-knowledge
sull'intero archivio, la protezione da un sistema compromesso e l'accesso
ininterrotto per 12 ore. Restano da descrivere separatamente il profilo PIN
transitorio, gli export, il recupero completo ed il mandato che autorizza
l'eventuale egress. Il servizio non estende l'egress né concede nuove
autorità al provider.

Prima di pubblicare la modalità occorre approvare il delta al testo
congelato in ADR 0065, SECURITY, architettura, matrice ed avviso di
abilitazione. `check:claims` ed il suo self-test bloccano claim pubblici
fuorvianti. `check:never-regress` verifica invarianti minime di trasporto,
avvolgimento, primitive e mancata persistenza di PIN/password nel browser.
Servono inoltre prove sul nuovo confine, perché quei controlli non
attestano la vita della chiave nel servizio.
[Guard dei claim](../../scripts/check-claims-guard.mjs),
[guard delle invarianti](../../scripts/check-never-regress.mjs).

### Alternative e costo

- **Browser sbloccato.** Ha il confine attuale, con meno processi che
  possono accedere alla chiave. Le cassette aspettano quando non c'è
  una scheda in grado di applicarle.
- **Biometria ad ogni visita.** Riduce la durata della chiave aperta.
  Richiede presenza anche per note e PDF ammessi dal mandato.
- **Segreto di cassetta separato.** Potrebbe ridurre l'impatto della
  cattura della chiave. Per popolare i campi protetti occorre comunque
  cambiare il modello delle chiavi o aspettare uno sblocco ordinario.
- **Servizio a tempo con involucro hardware.** Raccomandato solo come
  opzione macOS. Riusando la cifratura corrente evita una migrazione dei
  campi, al costo di una finestra di esposizione aggiuntiva. Se questa
  esposizione è inaccettabile, scegliere il browser e lasciare i depositi
  in attesa.

Stima: **15–22 giorni di lavoro**, aggiuntivi al punto 1. Da tre a cinque
per custodia e ciclo di vita, cinque a sette per composizione ed autorità
del writer, sette a dieci per prove sul Mac, recupero, modello formale e
testi. La stima esclude porting, redistribuzione delle chiavi e qualifica
clinica.

### Prove per accettare l'implementazione

- **Empiriche.** Sul bundle firmato del Mac target, avviare una sessione
  con Touch ID, chiudere finestra e browser, applicare una cassetta
  sintetica mista. Verificare che entrino solo gli elementi ammessi,
  che il doppio consumer non duplichi e che CF discordante o assente
  blocchi l'applicazione. Provare scadenza, spostamento dell'ora, lock OS,
  sospensione, uscita, cambio utente, riavvio, revoca e perdita del
  servizio durante preparazione e commit. Misurare la barriera del
  writer al lock. Provare che un peer estraneo è respinto e che tracce,
  buste, file temporanei, dump applicativi e backup controllati non
  contengano le sentinelle attese solo in RAM. Ripristinare un backup su
  un profilo pulito senza il Portachiavi originario, con kit e chiave
  separata. Verificare lettura di dati e cassette, e mancata
  riattivazione dei vecchi grant. Controllare l'attesa nel profilo Web
  senza servizio e su Windows e Linux.
- **Formali.** Comporre gli stati del punto 1 con sessione del servizio
  inattiva, attiva o terminata, due consumer ed una barriera di commit.
  Modellare perdita di eventi, deadline, revoca e generazione nuova
  dopo restore, anche in presenza di retry. Verificare che una
  sessione ritirata non rientri in uso senza un nuovo gesto, che
  l'ammissione viva fino al commit e che applicazione ed audit abbiano la
  stessa sorte. Il modello deve trovare controesempi togliendo il
  controllo di generazione o il ritiro al blocco. Le assunzioni sugli
  eventi OS si provano sul bundle, fuori dal modello.

## Chiedere a Leonardo

- Va bene iniziare da Codex e confermare una singola visita in un
  riquadro MediFlow con Touch ID? Questa scelta determina dove compare
  la prova umana e che cosa resta visibile nella chat.
- Autorizzi il profilo macOS facoltativo con chiave in RAM fuori dalla
  scheda, tetto di 12 ore e nuovo Touch ID dopo ogni blocco o
  sospensione? Vuoi un tetto più breve per il pilota?
- Approvi la formulazione proposta per WUL-342/354 per il solo profilo
  provato? I testi di prodotto cambierebbero dopo la qualifica tecnica.
