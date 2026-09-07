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

## Fonti

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
