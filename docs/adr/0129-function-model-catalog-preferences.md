# ADR 0129: preferenze per esperienza da catalogo host sigillato

Data: 2026-09-07. Stato: accettato per la lane locale WUL-691; integrazione e
qualificazione restano separate. Estende ADR 0122, ADR 0094 e ADR 0121.

## Decisione e autorità

Il servizio nominato `FunctionModelPreferencesService` proietta un catalogo
locale dalle configurazioni host già possedute dai due ruoli Ollama e dal
percorso ATHENA. Non scopre, installa, ammette o recupera provider. I riferimenti
opachi del catalogo non sono model ID liberi: il server ricostruisce l'identità,
l'endpoint locale, le esperienze ammesse e la revisione dalle proprie fonti.
Le query UI sono sola lettura e non invocano attestazione o inferenza.

ADR 0122 conserva l'ammissione/recovery/revoca al comando host: nessuna nuova
route ne importa il controllo. Salvare una preferenza o accendere una funzione
non ammette un provider. Tutti i percorsi richiedono ancora lifecycle e readiness
locali; `available_unqualified` non è qualificazione clinica. ChatGPT remoto,
OAuth consumer, prompt, policy, endpoint, provider, fallback e apply non entrano
nel contratto del picker.

La sola eccezione al divieto di caller model choice del crosswalk è un
`modelOptionId` opaco presente nel catalogo host corrente, accompagnato da
`expectedCatalogRevision`. `FunctionModelDispatch` risolve questa richiesta
contro la stessa allowlist usata per le preferenze. Il modello resta risolto
dal production root; nessun input browser diventa configurazione libera.

## Persistenza e concorrenza

La preferenza è della postazione, come le schede esistenti. Un record JSON
versionato `ai.fabric.functionPreferences` in `settings` conserva default per
ciascuna delle quattro esperienze, revisione catalogo e ultimo comando.
Gli interruttori restano le quattro chiavi esistenti; nessun secondo kill switch.
La route generica nega la nuova chiave. Il servizio Web autenticato dedicato
usa transazione IMMEDIATE, CAS della revisione delle preferenze (inclusi gli
interruttori esistenti) e `expectedCatalogRevision`. La risposta si conferma
con rilettura. Retry identico dell'ultimo comando è idempotente; collisioni o
retry più vecchi falliscono. Record corrotto o binding stale non sono riparati.

In assenza del nuovo record resta il binding host storico della funzione;
un default esplicitamente salvato non viene sostituito quando diventa stale.
L'override occasionale non viene persistito e dura solo per una preview. La
revisione catalogo include configurazione e lifecycle durevole; un riavvio con
fonti immutate preserva i riferimenti. Revoca, recovery o cambio di configurazione
invalidano il catalogo e i default salvati. Il provider non disponibile o un
modello non supportato producono denial senza fallback.

I preset nominati del nuovo servizio sono anteprime deterministiche delle
quattro preferenze e interruttori: `host_defaults` conserva gli interruttori e
ripristina le scelte host; `all_off` spegne le quattro funzioni. La preview non
scrive. Apply richiede lo stesso CAS e rilettura; nessun preset ammette provider.
I preset hardware delle schede esistenti restano bozze del loro owner.

## Dispatch e currentness

La route preview autenticata di ogni esperienza entra nel servizio nominato
prima del production handler. Un header JSON bounded `x-mediflow-function-model`
può contenere soltanto `modelOptionId` e `expectedCatalogRevision`; senza header
si risolve il default. Query di scelta e campi liberi restano vietati.
La selezione sigillata è confinata alla richiesta server; non viaggia nei
payload clinici né nelle ricevute come autorità di apply.

Il servizio verifica sessione e snapshot prima del binding, prima e dopo il
trasporto e prima della risposta. Gli owner clinici conservano selezione,
paziente, lock, revoca delle risorse, lease e currentness. Il picker deve essere
resettato su cambio paziente/sessione e richiesta annullata; l'override non è una
preferenza globale né un nuovo handle clinico. Risultati fuori contesto non si
pubblicano. Nessun writer clinico viene aggiunto, i quattro path restano
`proposal_only` e le operazioni di apply mantengono il proprio owner.

## DTO e verifica

`GET /api/settings/ai/functions` restituisce schema, revisione, revisione
catalogo, opzioni ammesse per esperienza, stato dei default e interruttori.
`POST` accetta solo comandi versionati per una preferenza o preset nominato;
`POST /api/settings/ai/functions/preview` prepara il preset senza scrivere.
La proiezione esistente `/api/system/function-status` legge i default per
esperienza e distingue binding stale/illeggibile; non mostra gli override di
richiesta come preferenze salvate. Le route `/api/settings/ai/chatgpt/*`
appartengono a WUL-689 e non cambiano.

Il coordinatore integra il picker vicino a Genera riusando le schede presenti:
mostrare default e scelta per questa richiesta come controlli distinti;
nessun autosave, autoapply o successo senza rilettura. Non cambia `/api/v1`.
Verifiche richieste: default/override, CAS/restart, catalogo stale/non catalogato,
funzione spenta, provider indisponibile/revocato, sessione/paziente mutati,
no autoapply, preset preview/apply/reread e retry idempotente. Build e prova UI
integrata restano gate del parent se non eseguite nella lane.

## Estensione nominata ChatGPT — decisione del 12 settembre 2026

Per WUL-689/691 l'esclusione del remoto dal picker viene superata soltanto
dal ponte ChatGPT di ADR 0134 per le quattro esperienze nominate. Il registry
locale e i suoi endpoint restano invariati. L'estensione non ammette provider,
dati o esecuzioni per effetto di una preferenza.

La preferenza remota conserva modello ed effort esatti scelti da un catalogo
autenticato come intenzione non autorizzativa, con formato persistito
versionato. Non conserva account, consenso, credenziali, port, qualifica o ID
effimeri. Il tentativo corrente emette le proprie opzioni opache, risolve
l'intenzione contro il catalogo del suo processo e rifiuta modello/effort
assenti senza sostituzione. L'override resta limitato alla richiesta.

Revisione delle preferenze e catalogo locale restano distinti dalla revisione
del tentativo remoto: login, chiusura o cambio del catalogo ChatGPT non devono
invalidare i default locali. CAS, rilettura e interruttori restano obbligatori;
i client precedenti non ricevono varianti fuori dal loro schema. Le letture
GET proiettano soltanto stato gia posseduto, senza login o chiamate provider.

La UI distingue account collegato, modello disponibile nel tentativo e
funzione pronta con contesto/consenso correnti. Dopo la chiusura il modello
non e riutilizzabile come processo vivo; la proposta puo restare visibile nel
proprio contesto. La preparazione di una nuova operazione non e una generazione
automatica. Questa decisione definisce l'integrazione richiesta, non attesta
che picker, persistenza o percorsi ordinari siano gia implementati e verificati.

## Lettura HTTP e continuità dell'owner

Il modulo HTTP riusa readBoundedJsonBody in modalità strict, massimo 4096 byte
e deadline di 1000 ms con cancellazione del reader. Abort della richiesta o
revoca della risorsa privata Web cancellano la lettura. Dopo ogni await di
autenticazione/lettura si verifica la sessione; l'owner esistente viene
controllato sincronicamente prima del servizio e della pubblicazione. Nessuna
nuova autorità di sessione o eccezione auth. Errori di body rimangono
input_invalid; abort/revoca rimangono session_stale.
