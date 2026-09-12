# ADR 0134: sintesi con abbonamento ChatGPT e processo confinato

Data: 2026-09-08. Stato: proposto per WUL-689; ammissione runtime sospesa.
Integra ADR 0126, 0129 e 0121. Nessun impatto su `/api/v1`.

## Decisione

Il requisito è eseguire sintesi tramite l'account personale ChatGPT attraverso
il protocollo ufficiale Codex app-server. Un login, un catalogo o una risposta
mock non soddisfano il requisito. API key, endpoint ricostruiti, token esterni
e riuso delle credenziali personali Codex non sono alternative ammesse.

Il controllo account di ADR 0126 resta separato. La nuova esecuzione richiede
un processo dedicato, un nuovo accesso ufficiale e un confine verificato prima
di inviare contesto. L'assenza assoluta di ogni tool non è una precondizione:
la precondizione è un limite effettivo ai dati leggibili e alle azioni possibili,
valido per tutto il processo, le letture iniziali e i suoi discendenti.

## Confine richiesto

- Solo contesto selezionato dall'host, con fonti identificate e hash. Nessun
  percorso, prompt, provider, endpoint, comando, credential o writer dal caller.
- HOME, CODEX_HOME, cwd, cache e temporanei nuovi e privati. Nessun accesso al
  database, alla home personale, ad altre sessioni, socket o servizi MediFlow.
- Il contenitore OS deve precedere l'avvio del server e consentire soltanto
  runtime indispensabile e directory possedute. Rete limitata alle destinazioni
  ufficiali necessarie; nessun accesso ai servizi locali o ad altri provider.
- Configurazione immutabile dell'invocazione; no app, MCP, browser, computer
  use, plugin, hook, agenti, web search o escalation. Una richiesta server di
  strumenti/permessi inattesa invalida la generazione e chiude il processo.
- L'host non inoltra RPC generiche. Sono ammessi lifecycle account, catalogo,
  limiti e una sola conversazione effimera con un solo turno di sintesi;
  cancellazione usa `turn/interrupt`, seguita da arresto bounded se necessario.
- Modello e effort devono appartenere al catalogo corrente del processo.
  Readback discordante, quota esaurita, revoca, cancellazione, timeout o errore
  negano l'output. Nessun fallback, acquisto crediti, reset quota o riavvio.
- Il risultato contiene proposta, fonti, dati usati, modello, esito e una
  spiegazione concisa. Eventi di ragionamento privato non sono esposti o salvati.
  Non viene attribuito alcun potere di scrittura clinica.

Il lifecycle deve essere legato all'owner della sessione MediFlow. Lock,
scadenza e logout invalidano immediatamente autorità e risposte tardive; la
chiusura del processo e la cancellazione dei temporanei hanno receipt separata.
Un aborto locale non è una revoca remota globale né prova rimborso della quota.

La ricevuta di chiusura distingue l'uscita del leader dalla cessazione osservata
del gruppo posseduto. La revoca del proxy è immediata; il cleanup attende entrambe
le prove attraverso un'interfaccia bounded. Un gruppo ancora presente, un errore
o una deadline non attestano il dreno: la directory resta conservata e il cleanup
non è confermato. Non si inviano segnali distruttivi a un group ID dopo l'uscita
del leader; l'osservazione del gruppo non autorizza a terminarne membri di identità
incerta. La cessazione del gruppo non prova quella di discendenti che ne siano
usciti; questa ulteriore qualifica OS resta aperta e non ammette il runtime.

## Ammissione e prova

La prima qualifica usa esclusivamente fixture sintetiche fissate dall'host.
Un flag dichiarativo `synthetic: true` non rende sicuro testo libero. Il binding
Fabric mantiene `proposal_only`, zero scritture cliniche e fonti verificabili.
La qualifica sintetica non apre automaticamente l'uso di dati clinici reali:
restano necessari condizioni account, governance dei dati e verifica di qualità.

La selezione nel picker non autorizza da sola egress. Fino a integrazione del
consenso e verifica del confine, account e preferenze esistenti conservano i
loro blocchi. Nessuna modifica al binding locale Ollama/ATHENA è implicita.

Il candidato macOS usa un profilo OS applicato prima dell'avvio, con pin del
binario, del build OS e del solo supporto Apple `dyld-support.sb`. Quest'ultimo
è un'interfaccia privata: ogni variazione richiede una nuova qualifica. Il
client riceve tramite `CODEX_CA_CERTIFICATE` un bundle di sole CA pubbliche
incluse in Node, con hash verificato e file immutabile nel contenitore. TLS
resta verificato; il portachiavi personale e certificati privati non sono fonti
di autenticazione o trust. Nessuna intercettazione TLS è introdotta dal proxy.

La promozione richiede insieme: pin binario/protocollo; prova OS dei confini
effettivi; nuovo login ufficiale; catalogo osservato; generazione reale con
fonti sintetiche; owner/revoca/cancellazione/limiti/errori verificati; receipt
minimizzata. Un controllo che fallisce arresta la promozione, non viene
sostituito da istruzioni al modello o da un profilo meno restrittivo.

## Evidenza osservata e limiti

Codex locale osservato: 0.153.4. La documentazione corrente descrive
`ReadOnlyAccess.restricted`, assente dal `SandboxPolicy` TypeScript generato
per questo binario. Non si invia un campo non qualificato confidando che sia
applicato. I permission profile sono beta e la loro documentazione limita
l'enforcement ai comandi sandboxed, non alle letture del server.

Il wrapper ufficiale `codex sandbox` è una superficie candidata per applicare
un profilo all'intero processo. Le prime verifiche con file sintetici esterni
non hanno dimostrato il confine di lettura atteso. Questo risultato non prova
l'impossibilità del prodotto e non autorizza inferenza. Le ricevute private
conservano configurazione, comandi, esiti e limiti; il gate resta aperto.

Il candidato successivo usa `/usr/bin/sandbox-exec` con deny-default e un
proxy CONNECT locale per i soli `auth.openai.com:443` e `chatgpt.com:443`.
La risoluzione ammette soltanto IPv4 pubblici verificati prima del connect
numerico. Sono limitati header, buffer iniziale, concorrenza e inattività;
il proxy non legge TLS né registra payload. La chiusura revoca subito questa
sola uscita di rete, anche se l'uscita del processo non è ancora attestata.

Su macOS build `26A5425a` e Codex `0.153.4`, la prova con sentinelle proprie
ha osservato: lettura/scrittura esterna negate, modifica della configurazione
e delle CA negata, scratch posseduto scrivibile, solo il listener del proxy
raggiungibile, esecuzione shell negata. Il probe usa un eseguibile Node
aggiuntivo; il profilo del server lo rimuove. Sono verifiche concrete del
confine osservato, non una prova esaustiva o trasferibile ad altri OS/build.

Il server reale inizializza, rilegge la configurazione restrittiva e conferma
account assente nella nuova home. Un errore iniziale di rete è stato risolto
fornendo il bundle verificato di CA pubbliche. Il successivo
`account/login/start` ufficiale ha emesso il codice dispositivo. Il nuovo
login non è completato: la selezione dell'account browser attende identità e
autorizzazione esplicite dopo un rifiuto dell'approvazione automatica.
Non sono quindi osservati catalogo autenticato o generazione reale.
Il tentativo è poi scaduto al limite locale previsto; la ricevuta conferma
arresto e rimozione dei temporanei. La domanda sull'account resta pendente.

Il binding nuovo usa il vero owner Web e soltanto tre fonti DEMO fissate
dall'host. I test verificano lock, isolamento, risposte tardive, cancellazione,
quota, modello/effort, errori, richieste tool negate e citazioni con hash.
Transport e risposte di inferenza in questi test sono fake; le citazioni
verificate provano corrispondenza testuale, non correttezza clinica o supporto
di ogni affermazione. Nessuna route, CTA, preferenza, dispatch di produzione,
database o writer clinico è collegato da questo cambiamento. Il gate di
integrazione utente e l'ammissione runtime restano aperti.

## Verifica del readback corrente: proposta del 12 settembre 2026

La ricostruzione corrente usa macOS `26A428` e il binario ufficiale Codex
`0.153.4`, distinto dal binario della ricevuta C1 storica. Pin, rigenerazione
dei 24 schemi e inizializzazione sono stati osservati sul nuovo substrato;
il readback resta bloccato e la produzione non è ammessa.

Il sorgente del tag ufficiale `rust-v0.153.4`, commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`, distingue il `ConfigToml`
consumato dalla rappresentazione `ApiConfig`. Quest'ultima aggiunge valori
predefiniti e omette due campi `tools` che il resolver supporta. Una risposta
parziale non deve attestare da sola che tali opzioni siano applicate.

La correzione del verificatore deve mantenere queste condizioni:

- Richiedere i layer e il cwd posseduto esplicitamente, senza scoprire percorsi
  personali. Il layer utente deve contenere esattamente la configurazione
  imposta dall'host, provenire dal file immutabile del run e avere versione
  coerente con il suo contenuto canonico.
- Verificare chiavi, cardinalità e provenienza di tutte le origini. Non
  accettare layer di progetto, profili, flag di sessione, MDM o altre autorità.
  L'eventuale layer di sistema vuoto non prova assenza di policy: restano
  obbligatori i controlli indipendenti sull'assenza dei file amministrativi.
- Confrontare la proiezione effettiva con aspettative chiuse e fondate sul
  sorgente della versione esatta. Non ignorare campi aggiuntivi né considerare
  automaticamente innocui `null`, mappe vuote o valori predefiniti. Un hash di
  una risposta osservata, da solo, non sostituisce questa verifica semantica.
- Per opzioni omesse dalla proiezione, legare il layer esatto al resolver
  della versione verificata e al medesimo processo posseduto. Un layer
  ricaricato dopo l'avvio non è da solo prova della configurazione consumata:
  devono restare verificate immutabilità, percorso, substrato e currentness.
- Conservare la ricevuta C1 come provenienza storica degli schemi, senza
  attribuirle il nuovo hash binario o autorità runtime. Nessun callback,
  ricevuta importata o flag dichiarativo può sostituire l'issuer concreto.

Questa proposta non cambia le capacità ammesse sopra, non abilita egress o
login e non dichiara completata la qualifica. Richiede prove positive sul
readback reale e prove negative per contenuti, origini, layer e risposte
tardive alterati prima di qualsiasi promozione.

## Esito locale del readback — 12 settembre 2026

La candidata Mac ha superato il readback reale con layer e cwd espliciti sul
binario ufficiale `0.153.4`, macOS `26A428`. Il controllo include configurazione
utente immutabile prima dell'avvio, origini e proiezione chiuse, identità delle
directory possedute e assenza indipendente delle policy amministrative.
I 24 schemi coincidono; inizializzazione, chiusura e cessazione dell'albero
posseduto sono state osservate. La ricevuta resta evidenza del singolo run.

L'audit distingue `layered_source_projection_observed` dalla verifica indiretta
dei due controlli tools omessi dalla risposta API. Il legame completo fra
sorgenti e build resta `unqualified`: questa prova non lo sostituisce.
Nessun login, turno provider o ammissione di produzione è stato eseguito.
Il percorso utente completo e l'accettazione con fixture sintetica rimangono
da dimostrare.

## Collegamento candidato del login allo stesso host preparato

Il login può consumare una sola volta l'osservazione di initialize del processo
Mac preparato. L'issuer associa privatamente l'identità di quell'oggetto al
trasporto concreto: il wrapper di prodotto lo inoltra, ma non può sostituirlo
con una ricevuta ricostruita, un callback di successo o un flag di piattaforma.
Il claim è monouso, vincolato al cwd posseduto e alla custodia corrente. Non è
una nuova autorità dichiarativa e non modifica il consenso del prodotto.

Per quel solo host, `start` e `complete` richiedono il readback attuale con
`includeLayers:true` e cwd esplicito sullo stesso trasporto. L'issuer esegue il
verificatore già accettato e le sue fence; non riscrive la risposta in config
attesa. Tutti gli RPC login/account e le notifiche usano il trasporto concreto;
`read` e `cancel` mantengono guard e currentness, senza estendere durata o
capacità. Logout e chiusura restano sotto il proprietario di prodotto.
Il percorso storico/sintetico rimane distinto e non qualifica un Mac.

Il factory di produzione resta HELD. Questa modifica non è un login reale,
non rappresenta consenso o accettazione dell'utente e non abilita provider turn.
`omittedToolBinding` resta indiretto e `fullSourceBuildBinding` resta
`unqualified`. L'esito live end-to-end rimane da verificare dal parent.

## Decisione per il collegamento applicativo Mac

Il collegamento candidato usa un `POST prepare` autenticato prima del
consenso. Import, avvio del backend e GET restano passivi. La preparazione
locale mantiene il processo account-free con egress provider chiuso; non
preleva l'host e non consuma l'osservazione di initialize.

Il tentativo appartiene alla vera sessione Web, con prenotazione prima del
primo await e una sola preparazione/esecuzione Mac viva per backend. Le
sessioni non condividono autorita. Abort, retirement e scadenza ritirano il
tentativo; un handle restituito in ritardo resta posseduto e viene chiuso.
Un errore di pubblicazione ritira soltanto la risposta del tentativo relativo,
fuori dalla sezione critica dell'owner. Nessuna ricostruzione da JSON o IPC.

La disclosure viene associata privatamente al contesto e alla qualifica del
tentativo preparato. Il consenso verifica questa associazione senza sostituire
il controller o rinnovare la qualifica. La scadenza effettiva e il minimo fra
sessione, vita residua del tentativo e limite del consenso. Soltanto
`login/start` puo trasferire una volta lo stesso host e attivare l'egress.

La chiusura comprende preparazioni pendenti, pronte e host trasferiti.
Un cleanup non confermato blocca il riavvio anche dopo la rimozione della
sessione. La chiusura intenzionale conserva soltanto il sigillo necessario
alla pubblicazione finale; non abilita un secondo turno. Un nuovo ciclo
richiede preparazione e consenso espliciti. Il riavvio del backend non prova
retroattivamente la cessazione delle risorse precedenti. Una prenotazione
persistente nel data-dir impedisce di aggirare un cleanup non confermato
creando una nuova sessione o un nuovo backend; non viene rimossa in base
al solo PID o all'assenza di un processo. La riconciliazione di un arresto
anomalo resta un'operazione esplicita, non un ripristino automatico.

Gli asset pubblici necessari sono risolti nell'installazione del backend,
senza ricerca in HOME o nelle credenziali dello sviluppatore. Il loro
ritrovamento non emette qualifica: pin, toolchain, protocollo e custodia sono
verificati nuovamente dall'issuer concreto. La distribuzione deve preservare
la stessa autorita fra le route del backend effettivo.

Questa decisione non attesta il collaudo della candidata installata. L'accettazione del
collegamento richiede ingress/passivita, ownership, pubblicazione, consenso e
trasferimento, account/catalogo, generazione, stop/rinnovo e distribuzione
verificati. La prova sintetica non sostituisce le esperienze ordinarie di
WUL-689 e non ammette dati clinici reali.

## Decisione di integrazione nelle esperienze ordinarie — 12 settembre 2026

WUL-689/691 richiedono il canale ChatGPT nelle quattro esperienze ordinarie,
non la sola sintesi DEMO. Il ponte usa quattro profili host nominati:
`patient_insight`, `smart_import`, `document_synthesis`, `treatment_reasoning`.
Ogni profilo conserva il builder, il parser e il risultato specifico della
funzione. Un profilo prepara e valida contenuti: non concede autorita,
consenso, ammissione dei dati o una qualifica del provider.

L'acquisizione del contesto rimane nell'owner/broker della funzione. Il
tentativo conserva privatamente funzione, selezione, revisioni e hash delle
fonti; copie dei riferimenti browser, testo libero, prompt, schema o callback
del caller non sostituiscono questa acquisizione. La preparazione precede
la disponibilita del modello. Consenso, catalogo e Genera restano azioni
esplicite riferite al medesimo tentativo; nessuna estensione delle lease.

Trasporto, account, limiti, modello/effort, annullamento e chiusura rimangono
condivisi. Istruzioni e validazione dell'output sono scelte esclusivamente dai
quattro profili host. Il risultato torna al proprietario della funzione per
la pubblicazione corrente; il pannello account non conserva fonti o proposte
del paziente. Prima del turno serve il catalogo vivo; dopo la chiusura serve
il sigillo terminale insieme a owner, consenso e selezione ancora correnti.
Una ricevuta remota dichiara OpenAI, canale ChatGPT ed egress effettivo; non
simula una ricevuta Ollama, una attestazione ATHENA o assenza di egress.

Per Treatment Reasoning il parser nominato ChatGPT condivide le verifiche
cliniche e i `sourceBindings` del contratto locale, ma richiede una trace
`chatgpt_subscription` senza strumenti. Produce una proposta, non una
attestazione del processo o dell'ammissione: la provenienza di esecuzione viene
aggiunta esclusivamente dal ponte host dopo il turno qualificato. Il parser
ATHENA continua a rifiutare la trace remota. Il prompt ChatGPT non dichiara
esecuzione locale e non classifica autonomamente le fonti come sintetiche.

La codifica Structured Outputs rende espliciti con `null` solo i campi che
il contratto canonico considera opzionali; il decoder host li riporta ad
assenza prima del parser esistente. Non ripara campi obbligatori o contenuti
non validi. Document Synthesis conserva l'envelope completo, le citazioni e
il binding al source-set autentico; la decodifica iniziale conserva anche il
rifiuto di chiavi JSON duplicate. Queste trasformazioni sono locali e non
concedono ammissione, consenso o currentness.

Questa integrazione non sostituisce il chokepoint egress degli ADR 0033/0077:
il testo narrativo clinico richiede redazione locale promossa, consenso,
minimizzazione e audit. Lo stato benchmark-only non viene promosso dal login
o dalla generazione DEMO. Le prove di sviluppo usano solo fonti sintetiche
possedute dal test; un flag `synthetic` del caller non ne prova l'origine.
La decisione competente sul deployment e sui dati reali resta WUL-688.
Finche i requisiti applicabili non sono soddisfatti non si dichiara conclusa
l'esperienza OpenAI ordinaria; non si sostituisce il requisito con una DEMO.

La verifica integrata richiede i quattro percorsi reali su dati sintetici
nella stessa candidata, output e fonti specifici, preferenza/override/restart,
revoca e cambio contesto, modello rimosso e quota, chiusura e pubblicazione,
assenza di fallback e regressione dei percorsi locali. Il ponte e i profili
sono implementazioni candidate fino a queste verifiche, non prove di rilascio.

## Raccordo redatto dei profili — candidata 462f1652

I builder nominati producono un piano di emissione: letterali e campi strutturali,
unita dati decodificate e codifica text/json-string. Senza redazione il rendering
resta byte-identico; per DS UTF8_BYTES e derivato dalla stessa unita effettivamente
inviata. Il source-set originale e i parser canonici non vengono sostituiti.
Una preparazione possiede una sola sessione RAM e un runner locale, usa batch di
unita intere entro 12000 UTF16 e respinge span fra unita o su surrogate. Il runner
viene chiuso al termine della preparazione; la mappa vive solo fino alla consegna
o revoca. Il risultato remoto passa prima dallo scanner lessicale, con isolamento
dei token per envelope e reidratazione delle sole stringhe dati ammesse. Non si
riparano chiavi, tipi, numeri, citazioni o limiti del contratto canonico.

Un unico envelope di contenuto {input, outputSchema} e serializzato UTF8 e congelato
prima della disclosure; il suo hash e distinto dall'hash del contesto originale.
Il consenso ordinario e un oggetto privato, legato alla sessione autenticata,
al contesto/tentativo/qualifica e alla preparazione precisa; il browser puo
soltanto accettare la sua revisione. Il pannello DEMO non ospita input o output
ordinari. Un risultato ordinario torna al proprietario della funzione per il
binding/commit e contiene provenienza ChatGPT, mai un'attestazione locale.

Questa candidata non emette l'ammissione egress: il gate degli ADR0033/0077 rimane
chiuso. Ne un consenso, ne un profilo registrato, ne shadowReady, ne una sessione
Web provano da soli provenienza/currentness del contesto o governance. Gli innesti
nei root delle quattro funzioni devono preservare i loro lease e commit originali;
assenza di un binding autentico o della decisione vigente rimane un blocco, non
viene compensata da callback o flag positivi. Nessun risultato dei test sintetici
costituisce ammissione di dati reali o completamento di WUL-689/691.

## Confezionamento Mac del payload fissato — WUL-697, 12 settembre 2026

Il resolver conserva il layout standalone `resources/chatgpt-execution/mac/codex-0.153.4`
ma riconosce separatamente il cwd esatto `.app/Contents/Resources/WebRuntime`.
Nel bundle il solo eseguibile `codex` e fisico in
`Contents/Helpers/mediflow-chatgpt-codex` (file diretto, senza directory
intermedie per codice annidato); sorgente C, schema e
ricevute rimangono nelle risorse. Non sono ammessi fallback al binario sotto
Resources, symlink, root non canonici o ancestor symlink. I marker del bundle
verificano la struttura, non autenticita, firma o ammissione all'esecuzione.

Staging, risoluzione e migrazione controllano tutti i sette pin pubblici esistenti,
inclusi binario e sorgente nativa. La migrazione riguarda solo il payload fisso,
prima della normalizzazione delle sei dipendenze Web in Frameworks. Il guard
continua a vietare qualsiasi Mach-O o symlink nativo in Resources; le sei
dipendenze e la loro politica di linkage/firma non cambiano. Una seconda
normalizzazione di un layout completo e valido e una verifica senza scritture.

Il binario qualificato viene copiato senza cambiarne i byte: la sua firma
esistente viene verificata, mai rimossa o sostituita. La firma delle dipendenze
Web e quella esterna dell'app sono separate; `--deep` e solo verifica.
I sette pin sono riletti dopo l'eventuale firma esterna, senza staging.
Una firma esistente non valida o incompatibile con la distribuzione richiesta
non autorizza una ri-firma del binario: occorrono nuova qualifica e approvazione
fuori da questo intervento. Notarizzazione e distribuibilita non sono attestate
da questo layout. Build native, verifica reale delle firme e smoke restano
necessari sulla candidata integrata; test con fixture non li sostituiscono.

Lo staging e la normalizzazione rifiutano bundle gia sigillati. Una build
incrementale firmata richiede una nuova destinazione DerivedData non firmata,
non la modifica del bundle distribuito. Senza tutti gli asset validi il builder
fallisce prima di dichiarare l'app pronta. C1/C2, custodian, pin OS/CA,
consenso, autenticazione ed autorita runtime restano invariati.

## Fonti

- [ConfigToml del tag verificato](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/config/src/config_toml.rs),
  [costruzione del readback](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/config_manager_service.rs)
  e [proiezione API](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server-protocol/src/protocol/v2/config.rs):
  fonti della proposta del 12 settembre, non prova autonoma di ammissione.
- [OpenAI App Server](https://learn.chatgpt.com/docs/app-server): integrazione
  di prodotto, autenticazione gestita, thread/turn e `externalSandbox`.
- [OpenAI Authentication](https://learn.chatgpt.com/docs/auth): distinzione tra
  sottoscrizione ChatGPT e API key.
- [OpenAI Permissions](https://learn.chatgpt.com/docs/permissions): profili,
  enforcement OS, proxy e superfici escluse.
- [OpenAI HTTP Client](https://github.com/openai/codex/tree/main/codex-rs/http-client):
  gestione comune delle CA pubbliche tramite `CODEX_CA_CERTIFICATE`.
- Protocollo e config schema locali generati da Codex 0.153.4; hash e ricevute
  fuori Git. Le pagine correnti non costituiscono un pin di versione.
