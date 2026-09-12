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
