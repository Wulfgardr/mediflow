# ADR 0126: controllo account ChatGPT separato dall’inferenza

Data: 2026-09-07. Stato: accettato per la tranche locale WUL-689.
Integra ADR 0095 e 0121. Nessun impatto sul contratto `/api/v1`.

## Decisione e limiti

MediFlow usa il protocollo ufficiale Codex app-server osservato in 0.153.4
soltanto per `initialize`, `account/login/start` (tipo `chatgpt`),
`account/login/cancel`, `account/read`, `model/list`, `account/rateLimits/read`
e `account/logout`, con notifica `initialized` e completamento server
`account/login/completed`. Il completamento non è un comando del browser:
si valida il loginId in memoria e si rilegge account/read.

Nessun thread, turno, prompt, tool o inferenza. Il catalogo è informativo:
ogni DTO contiene `inferenceEnabled: false` e
`executionBlock: "data_boundary_unqualified"`. Non viene modificato Fabric,
il lifecycle dei provider, il binding o lo stato eseguibile delle funzioni.
Il confine del registro tool e delle letture ambientali resta non qualificato.

## Autorità e ciclo di vita

Route Web sotto `/api/settings/ai/chatgpt/*`, sessione Web attiva richiesta,
nessun fallback a token locale. Tutte le operazioni RPC sono POST con corpo
esatto `{}`, controllo `isTrustedWebMutationRequest` e risposta no-store.
GET status legge soltanto stato locale, senza avviare processi o rete.
I resource port dell’owner esistente legano istanza e pubblicazione alla
sessione: lock, scadenza e logout MediFlow dispongono il processo e negano
risposte tardive. Logout ChatGPT e cancellazione invalidano subito la
generazione locale, anche se il server non risponde. Operazioni concorrenti
falliscono con busy, mentre cancellazione/logout possono interromperle.

Login parte solo da gesto esplicito. Nessun loginId, email, token, accountId,
percorso, output grezzo o errore upstream nei DTO. Solo la risposta login/start
consegna l’URL OAuth ufficiale validato; è transitorio e non va persistito o
registrato dalla UI. Stato e completamento non lo ripetono. Login ha scadenza
locale di cinque minuti; un evento estraneo, tardivo o malformato non autentica.

## Processo e credenziali

Il processo è dedicato a una sessione MediFlow, con directory temporanea
privata nuova (0700), HOME, CODEX_HOME, XDG e cwd interamente propri.
Il binario assoluto è configurato esclusivamente dall’host mediante
`MEDIFLOW_CHATGPT_CODEX_BIN`; assenza significa controllo non configurato.
Nessun percorso, argv o metodo RPC è accettato dal browser. Niente shell.
La risposta initialize deve confermare esattamente il CODEX_HOME privato atteso.
Ambiente minimo esplicito, senza ereditare token, proxy, config o sessioni.
Storage credenziali `ephemeral` (memoria del processo secondo lo schema
ufficiale 0.153.4), login forzato ChatGPT, analytics e feedback OFF.
Non si apre né copia auth.json, cookie o credenziali di altri ambienti.

L’autenticazione è deliberatamente legata alla sessione, non persistente:
lock, logout, cancel ed errore terminale eliminano la directory
posseduta dopo l’uscita del figlio. Il disposer della sessione invalida subito
l’autorità; il drain del processo è asincrono e la receipt auth non ne attesta
il completamento. All’uscita del processo Web un hook termina soltanto i figli
posseduti; non può attendere né attestare la cancellazione della home.
Riavvio richiede nuovo login, senza importare
stato precedente. Arresti non intercettabili possono lasciare una directory
privata orfana: non viene riutilizzata né scandita al riavvio. Lo storage
`ephemeral` evita la persistenza intenzionale delle credenziali; questa tranche
verifica la configurazione con un eseguibile sintetico, non il binario reale. Non si dichiara
cancellazione sicura del supporto o revoca remota globale. Logout prova la RPC,
poi verifica account/read nullo; l’errore resta distinguibile dal distacco locale.

STDIO JSON delimitato da newline, limiti di frame, timeout, uscita inattesa,
richieste server non ammesse e cleanup bounded fanno fallire chiuso. Il processo
è terminato con TERM e poi KILL se necessario. Nessun riavvio automatico.
Il login browser ufficiale può usare callback loopback: la futura UI deve
far completare il login sul computer che ospita MediFlow.

## Contratto UI e verifica

DTO esportato da `lib/chatgpt-account/account-contract.ts`. CTA:
`connect` (Collega ChatGPT), `cancel_login` (Annulla accesso), `refresh_account`
(Aggiorna account), `read_models` (Mostra modelli), `read_rate_limits`
(Controlla utilizzo), `logout` (Scollega ChatGPT), `configure_host`
(Configura il componente host). Nessuna CTA di esecuzione.

Test sintetici per protocollo, minimizzazione, timeout, cancellazione,
completamento, dati malformati, scadenza, logout, isolamento e riavvio;
verifica dell’owner reale senza database clinico. Nessun login o rete live,
nessuna UI in questa tranche, nessuna qualificazione clinica o release.

## Fonti

Protocollo TypeScript locale generato da Codex 0.153.4: ClientRequest,
InitializeParams, v2/LoginAccount*, CancelLoginAccount*, AccountLoginCompletedNotification,
GetAccount*, ModelList*, RateLimit*. Schema config ufficiale locale: storage
credenziali, forced_login_method, analytics, feedback. Hash nella ricevuta privata.
[OpenAI App Server](https://learn.chatgpt.com/docs/app-server) documenta il
trasporto e il lifecycle; la pagina corrente non costituisce pin del binario.
La review privata `codex-supported-tool-boundary-review/REPORT.md` conserva
il blocco sul registro tool: questo ADR non lo risolve.

## API e collegamento UI

| Metodo e suffisso sotto `/api/settings/ai/chatgpt/` | Risposta | Effetto |
| --- | --- | --- |
| GET `status` | AccountStatus | Solo snapshot locale. |
| POST `login/start` | AccountLoginStart | Avvio esplicito e URL OAuth transitorio. |
| POST `login/cancel` | AccountStatus | Cancella il login posseduto e distrugge il contesto locale. |
| POST `login/complete` | AccountStatus | Dopo notifica valida, conferma con account/read. |
| POST `read` | AccountStatus | Rilegge account, senza refresh proattivo del token. |
| POST `models` | AccountModels | Catalogo informativo, massimo 10 pagine da 100 modelli. |
| POST `rate-limits` | AccountRateLimits | Finestre del bucket Codex, null significa non disponibile. |
| POST `logout` | AccountStatus | Logout ufficiale, verifica account nullo, poi cleanup locale. |

Tutti i POST richiedono `{}`, Content-Type `application/json`, Origin esatto
e Sec-Fetch-Site `same-origin`. Query, identificatori di login, percorsi,
credenziali e argomenti extra sono rifiutati. Body massimo 64 byte e 2 secondi;
RPC massimo 15 secondi; frame massimo 1 MiB; chiusura TERM/KILL massimo 1 secondo.
401 indica sessione assente/scaduta; 403 trasporto non trusted; 400 input errato;
409 operazione concorrente/stato incompatibile; 504 timeout; 503 controllo
indisponibile o protocollo inatteso. Errori privi di dettagli upstream.

La UI mostra `awaiting_login` e poi `verifying`; in quest’ultimo stato propone
`complete_login` (Verifica accesso). Il polling GET non avvia RPC. `connected`
significa account osservato, mai funzione utilizzabile. `logout_unconfirmed`
indica distacco locale senza conferma del logout upstream. `canceled` indica
cancellazione locale, non revoca remota globale. Cambiare pagina non cancella
implicitamente il login: usare la CTA o attendere la scadenza.

Il runtime è process-local: un solo processo Web deve servire questa sessione;
non è un broker multi-worker. Il binario ufficiale assoluto, la versione effettiva,
il callback browser sul computer host e il packaging devono essere verificati
in integrazione. Questa tranche non installa o seleziona un binario per l’utente.
