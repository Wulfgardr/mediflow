# WUL-689 — percorso di sintesi OpenAI con abbonamento personale

Stato: **PROPOSED**. Run b50705abec2b4142a4d1f8501f0b2b7c. Data: 2026-09-08.
Questa proposta è stata scritta prima delle modifiche dipendenti. Non promuove ADR
0126, 0129 o 0134 e non costituisce qualifica runtime.

## Regola vigente e delta

0126 ammette controllo account, non inferenza; 0129 non ammette ChatGPT nel picker
clinico; 0134 sospende l'ammissione della sintesi. Il delta candidato aggiunge una
pagina separata `/settings/ai/chatgpt`, una composizione Web owner-bound, consenso
nominato alla sola fixture, login ufficiale nuovo, catalogo del processo di
esecuzione, scelta esplicita e una singola sintesi manuale. Le route account
preesistenti, i loro processi e `inferenceEnabled: false` rimangono invariati.

## Autorità, consenso e handoff

Il registro usa il vero owner 0.8.7: proiezione autentica per identità, resource
port, private-resource disposal e commit sincrono della risposta. GET crea al più
stato locale owner-bound: non avvia processi, non legge binari, non fa RPC.
Un consenso accetta esclusivamente operation/dataClass fissi e revisione opaca
della disclosure server. Il grant resta solo in memoria, legato alla proiezione,
fixture/digest, revisione della qualifica/configurazione e contesto di esecuzione.
TTL massimo cinque minuti, verificato anche con clock monotono locale; lock,
scadenza, cancel, cambio account/catalogo, contesto o qualifica lo invalidano.
Il picker non concede egress. Nessun identificatore di consenso è una credenziale.

Dopo consenso e qualifica corrente, il root crea un host nuovo e confinato PRIMA
di initialize. Richiede config/read restrittivo, account assente, login ufficiale
nel medesimo trasporto, evento di completamento con loginId posseduto e success,
config/read e account/read freschi. Non esiste RPC login/complete: è una verifica
host. Solo dopo questo handoff chiama `bindChatGptSyntheticSynthesis`.
Il candidato device-code usa ESCLUSIVAMENTE i campi della variante presente negli
schemi allegati. C1 lega ora i 24 schemi al generatore esatto tramite la ricevuta allegata;
non prova startup, schema input ConfigToml o normalizzazione config/read.
Il readback autentico resta assente: la composizione distribuita rimane held. Nessun fallback OAuth
privato, API key, riuso di home/account control, token import o callback inventato.
URL e codice dispositivo sono transitori, solo nella risposta a login/start;
mai in snapshot, storage browser, log o ricevute. La UI specifica il processo.

## Contratto HTTP e UI

Namespace `/api/settings/ai/chatgpt/synthesis/`. GET status solo snapshot. POST
consent accetta esattamente operation, dataClass, expectedDisclosureRevision;
generate accetta esattamente modelOptionId, expectedCatalogRevision; gli altri
POST accettano `{}`. Metodi e percorsi sono fissati nelle route. Sono richiesti
sessione corrente, JSON, Origin/Sec-Fetch-Site trusted, nessuna query, body strict
senza chiavi duplicate, massimo 1024 byte / un secondo, abort e commit owner.
Richieste concorrenti non vengono ritentate. Cancel/logout possono revocare
startup/login/generazione senza aspettare il lavoro attivo. Ogni child che arriva
dopo revoca conserva il proprio close/drain; una risposta tardiva non lo riattiva.
Le operazioni hanno deadline massima 120 secondi; login/grant/host massimo cinque
minuti. Nessun aumento dei massimi preesistenti del servizio.

Catalogo di esecuzione: opzioni opache per coppia modello/effort supportata e
revisione nuova a ogni refresh. Prima di generare viene riletto il catalogo e
verificata l'intera scelta contro la stessa enumerazione bounded. Un cambio
invalida senza sostituzione. Il readback thread deve corrispondere; priority è
richiesto, tier osservato può essere sconosciuto. Limiti assenti non sono zero.
La UI non genera al mount, al login, al refresh o al cambio scelta. Cambiare
scelta durante un'operazione ritira l'autorità tramite cancel e scarta risposte
vecchie; lock, unmount e cambio contesto eliminano lo stato sensibile locale.
Il risultato espone fonti fisse, citazioni con hash, modello/effort richiesti e
osservati, spiegazione senza ragionamento privato, proposalOnly e zero scritture.

## Qualifica e confini per OS

Il root di produzione usa solo l'adapter incluso, non un booleano da UI/env o
un callback fake di readiness. Non è presente alcun record di ammissione valido.
La dependency injection del costruttore server serve ai test e all'integrazione
host futura; non è una route né una facoltà del browser. Le revisioni di qualifica
sono solo etichette di currentness, non prove crittografiche o ammissioni autonome.

macOS: preservati tutti i pin di execution-sandbox e il profilo sandbox-exec,
HOME/runtime privati, configurazione immutabile, CA pubbliche e proxy CONNECT
ristretto. Il probe e l'osservazione del gruppo non provano i discendenti usciti
dal gruppo: held fino a prova completa e protocollo/config esatti. Non si
allarga rete, filesystem o IPC per far riuscire login o generazione.
Linux e Windows: nessun substrate completo/API nativa o artefatto qualificato è
incluso. Gli adapter locali negano prima di creare processi e descrivono le
mancanze. Nessun relay Mac. Una directory vuota, flag app-server, Job Object solo
nominale o sandbox dei soli comandi non possono ammettere il server.

Servono evidenza versionata del binario/protocollo/config, confine pre-avvio
per server e discendenti, filesystem/IPC/rete, risorse possedute e drain bounded.
Sono esclusi installatori, helper inventati, URL di distribuzione o hash nuovi.
L'autorità di promozione è del parent, dopo review ADR e prove autentiche per OS.

## Revoca e ricevute

La rinuncia locale all'autorità è immediata; turn/interrupt è best effort e
tracciato separatamente. Le ricevute distinguono richiesta di chiusura egress,
uscita leader, cessazione gruppo osservata, discendenti fuori gruppo non
attestati, cleanup e logout remoto verificato con account/read nullo. Un errore,
una deadline o assenza di osservazione producono unknown/unconfirmed, non true.
Dopo generazione il servizio chiude il trasporto e conserva solo la proposta
owner-bound. Un logout successivo a quel close non è attestabile da una RPC
nuova: resta not_attempted, senza riavviare o riautenticare.

## Migrazione e acceptance

FOLLOWUP1 sostituisce integralmente la consegna iniziale: dopo review applicare
una sola IMPLEMENTATION.patch ai preimage originali, mai al risultato precedente.
La proposta resta separata in proposals/; nessuna promozione implicita.
Nessun file condiviso con TR viene modificato. INTEGRATION.md specifica
navigazione, seam, docs index e promozione ADR parent-owned. Non aggiungere le
opzioni DEMO ai default clinici. Test: root/HTTP/binding con owner reale e
trasporto/confinamento fake; controller UI con route vere; browser DOM e
qualifica per OS restano prove separate. Solo evidenza autentica permette
LIVE_SYNTHETIC_QUALIFIED/OS_QUALIFIED. SOURCE_COMPLETE non significa readiness.

Contesto clinico futuro: selezione esclusivamente host, identità fonte, digest,
revisione corrente, classe dati e base di governance; grant distinto legato a
sessione/operazione/contesto, verifica prima/dopo ogni await. Il seam restituito
nega tale ammissione: nessun campo paziente/testo libero e nessun writer.

## Seam di qualifica Mac da completare con evidenza del parent

È previsto un adapter Mac che chiama concretamente l'host già incluso, solo
quando un'autorità host revisionata fornisce un witness corrente di qualifica.
Il witness non è un DTO, un file di auto-attestazione o un flag: la sua emissione
richiede il verificatore del parent per provenienza protocollo, configurazione,
substrate e confine completo. Quel verificatore manca nel pacchetto e non viene
simulato. Il factory distribuito di default resta held; non effettua discovery
del binario né usa variabili d'ambiente per abilitarsi. Il seam consente di
innestare evidenza autentica senza riscrivere consenso, route, login o binding.

## Readback non qualificato

Il controllo di versione accetta il token di versione esatto, non una
sottostringa (0.153.40 non è 0.153.4). Il controllo config/read richiede le
restrizioni congelate e nega chiavi sconosciute anche se il valore sembra
inerte. L'eventuale elenco di campi normalizzati aggiuntivi deve derivare dallo
schema esatto e da readback qualificato: non viene dedotto dal successo di
un trasporto fake. Un readback reale diverso rimane un blocco esplicito.


## FOLLOWUP1 — correzioni candidate, prima del codice dipendente

Stato invariato: **PROPOSED**, 2026-09-08. FULL_REPLACEMENT_44 dalla base
originale congelata, non una patch incrementale. ADR accettati e file condivisi
restano invariati. Non è verificabile qui il selettore UI del modello richiesto.
Nessuna attestazione del target o delega viene costruita.

### Challenge e polling locali

Solo il 409 `login_pending` della richiesta posseduta `login/complete` è non
terminale. La UI conserva challenge e messaggio nel medesimo contesto/revisione
di disclosure e nelle scadenze già ricevute. GET status non ricrea challenge:
può solo mantenere quella già in memoria, finché contesto, fase e scadenze
corrispondono. Errore diverso, risposta vecchia, contesto differente, lock,
unmount, cancel, logout o scadenza eliminano il contenuto transitorio. La
notifica corrispondente abilita la verifica manuale; solo account/config
riletti nel processo originale consentono il binding e rimuovono la challenge.
Nessun login, catalogo o turno automatico. Nessuna persistenza o logging.

### Provenienza C1, limiti C2 e restrizioni RPC

La ricevuta allegata C1 lega 24 schemi ai byte del binario 0.153.4, SHA-256
`a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.
È prova fornita di rigenerazione corrente, non startup, login o confine OS.
Il candidato controlla i campi richiesti da InitializeResponse, inclusi
CODEX_HOME privato atteso e piattaforma del processo, e usa solo la variante
`chatgptDeviceCode` effettivamente dichiarata. L'host esistente fissa il layout
`<root>/work` e `<root>/codex`; un adapter con layout diverso richiede una
revisione esplicita del contratto, non discovery della home. Il completamento
resta una notifica correlata, mai una nuova RPC `account/login/complete`.

Nessun nuovo root nullable dei tredici segnalati da C2 viene ammesso.
ConfigReadResponse non è ConfigToml: assenza, null e oggetto vuoto non sono
intercambiabili. Un campo dichiarato dallo schema può comunque restare negato
per mancanza di normalizzazione autentica e semantica restrittiva qualificata.
Si restringe inoltre il vecchio checker: le istruzioni opzionali accettano
solo assenza/null (non oggetti); le mappe non dichiarate MCP/provider/plugin/hook
restano negate anche vuote/null. Solo model_provider assente/null/openai resta
compatibile con il percorso che impone openai esplicitamente nel thread.
Tutte le restrizioni frozen devono essere presenti e identiche, senza extra
annidati; origins deve essere una mappa vuota e layers assente/null, come
richiesto dal controllo conservativo di una sola configurazione isolata.
Questa è una grammatica candidata restrittiva, NON un readback autentico.

C2-HOLD prevale sulle note storiche: startup negato prima di initialize,
config/read mai inviato. Il diniego non prova esistenza di un file né un BUG
MediFlow. Il successivo lstat con FileNotFoundError è un'osservazione riferita
dal parent, distinta e non rieseguita qui. Nessuna lettura di configurazioni
globali, ampliamento dell'isolamento o ulteriore tentativo è autorizzato.

### Qualifica e limiti della consegna

qualification-tools/ contiene solo strumenti offline e procedura revisionabile,
non un adapter OS, un issuer o un runner account. I probe futuri necessitano di
contratto nativo e autorizzazione separati, limiti <=30s, nessun retry o
workaround dopo un diniego, dati pubblici/fixture posseduti, cleanup verificato.
Un report strutturalmente valido non vale OS_QUALIFIED. Factory held invariata;
C2 e C3-C7 aperti. Node24, owner reale, lint e DOM hanno prove separate: i
293 PASS e typecheck del parent riguardano esclusivamente il primo risultato.
