# ADR 0135 — Configurazione AI con autorità nativa esplicita

- Data: 2026-09-07
- Stato: accettato per implementazione WUL-694; promozione subordinata alle verifiche.
- Contratti: ADR 0124 (JSON bounded), ADR 0129 nel parent 09ebe699b (preferenze), ADR 0126 (account).

## Decisione

Il Mac configura le quattro esperienze attraverso servizi nominati
ReadNativeFunctionPreferences, PreviewNativeFunctionPreferences e
ApplyNativeFunctionPreferences. Le route sono GET/POST
`/api/v1/network/ai/functions` e POST `/api/v1/network/ai/functions/preview`.
La configurazione riguarda tutto l'host, non il paziente o l'ambulatorio.
Non autorizza inferenza, provider, credenziali, endpoint o data plane ADR0134.

Ogni richiesta richiede il pairing vigente, home-base attiva e la sessione
operatore server-tagged `native`, legata allo stesso dispositivo/token. Riusa
`requirePairedNativeSession` e il lifecycle fisico delle sessioni; non usa
`requireSession`, port Web, cookie Web o autorità derivata da altri owner.
Il solo pairing non concede lettura o scrittura delle preferenze.

Un grant esplicito dell'amministratore host autorizza esclusivamente la coppia
`userId`/`clientId`, con ruolo corrente `admin`, capability
`native.ai.configure`, scadenza e grantId. È un file locale privato indicato
all'avvio da `MEDIFLOW_NATIVE_AI_CONFIG_GRANTS_FILE`: percorso assoluto,
file regolare senza symlink, proprietario uguale al processo e permessi 0600,
limite 16 KiB e massimo 32 grant. Assenza, errore o record ambiguo nega l'accesso.
Non viene creato o popolato automaticamente da un login o dal client Mac.
Il grant non contiene token, PIN, session ID o altre credenziali. Il parsing
strict canonico rifiuta anche proprietà JSON duplicate, incluse chiavi
equivalenti dopo decodifica degli escape.

Questa implementazione del grant è Mac-only: richiede i controlli filesystem
UID/0600 e identità/versione descritti qui. Non qualifica grant su host Windows.
La normalizzazione dei percorsi nel gate documentale OpenAPI preserva la
portabilità di quel controllo, senza estendere il supporto runtime del grant.

Formato esatto:

```json
{"schemaVersion":"mediflow.native-ai-grants.v1","grants":[{"grantId":"synthetic-grant-0001","userId":"synthetic-admin","clientId":"synthetic-mac","capability":"native.ai.configure","expiresAt":1799452800000}]}
```

L'esempio è solo sintetico e non viene installato. Gli identificatori vanno
forniti dall'amministratore sul computer host, ricavati dalla propria gestione
operatori/pairing, mai da cookie o secret Web. Un grant può durare al massimo
24 ore dalla rilettura; scadenze superiori sono negate. Ogni rilettura verifica
contenuto e identità/versione osservata del file (device, inode, dimensione,
mtime e ctime a precisione nanosecondi). I metadati devono restare identici
prima e dopo la lettura dal descriptor. Rimozione o scadenza osservata,
sostituzione del file o variazione dei metadati/contenuto rilevata al recheck
revocano la richiesta ancora in attesa, anche a contenuto invariato. Non si
promette di catturare eventi transitori non osservati tra le verifiche. Le
modifiche vanno pubblicate atomicamente mantenendo 0600. Non esiste endpoint
remoto per auto-concedersi il grant. Una UI host per concederlo resta un gap.

L'adapter registra la cancellazione sul lifecycle della sessione nativa,
limita body a 4096 byte/1 secondo, rilegge pairing/sessione/ruolo dopo gli await,
e verifica sincronicamente sessione, grant e abort prima del servizio. Nessun
await separa la verifica finale, il CAS sincrono, la rilettura e la costruzione
della risposta. La revoca non annulla retroattivamente una scrittura già
committata; un esito di trasporto ambiguo richiede una rilettura, mai auto-retry.

## Preferenze e protocollo

Il dominio è FunctionModelPreferencesService identico al parent 09ebe699b.
Non se ne duplica la semantica nel canale nativo. Catalogo host con opzioni
opache, quattro experience IDs, revisioni di catalogo e preferenze separate.
Comandi `set` o `preset`, commandId stabile tra preview e conferma, confronto
ottimistico e idempotenza bounded del servizio (ultimo comando; replay dopo
comandi intermedi può produrre conflitto). Preset solo `host_defaults` e
`all_off`. Il primo preserva gli switch, il secondo spegne le quattro funzioni.
Preview senza scritture; conferma esplicita; apply con rilettura transazionale,
seguita da GET del client. Il campo di dominio `apply: denied` riguarda apply
clinico e non nega il writer di configurazione autorizzato dal nuovo grant.

SwiftUI conserva i draft solo nella sessione corrente. Cambio connessione,
lock, revoca rilevata o uscita dalla vista cancella richieste, snapshot e preview;
le risposte tardive non ripopolano la vista. I conflitti invalidano la preview.
Nessun valore locale viene presentato come preferenza persistita dell'host.

## Account

Nessuna route account viene introdotta in questa slice: ADR0126 possiede
l'account della specifica sessione Web. Un eventuale ReadNativeAccountStatus
richiede un owner nativo distinto ed esplicitamente autorizzato. La UI dichiara
snapshot non disponibile; non legge account Web, non avvia processi/RPC/OAuth,
non deduce connessione dalla presenza di binari. ADR0134 resta separato.

## Verifica e limiti

Test sintetici: grant assente/errato/scaduto/revocato; sessione Web respinta;
revoca durante body; CAS/catalogo stale; replay; preview zero write; rilettura;
nessun nuovo campo provider/endpoint. Client: DTO, comandi, cancellazione e
risposte tardive. Xcode Mac reale massimo due job e fixture dedicata.
Build verde non prova host autenticato live, concessione del grant tramite UI,
account connesso, inferenza o parità totale Web/macOS.
