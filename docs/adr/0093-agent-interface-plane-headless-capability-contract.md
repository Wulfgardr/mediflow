# ADR 0093: Agent Interface Plane headless

Date: 2026-08-19
Status: Proposed

---

## Problema

MediFlow espone gia API locali versionate, capability paired e capability
Intelligence Fabric. Queste superfici servono client e runtime specifici, ma
non formano ancora un contratto headless completo per agenti software.

Un agente deve poter scoprire cosa MediFlow sa fare, leggere solo il contesto
scelto dal medico, eseguire operazioni deterministiche e preparare proposte
revisionabili. Non deve ottenere accesso implicito al database, al filesystem,
al token locale generale o all'autorita clinica dell'operatore.

Il requisito nasce da `WUL-518`. Richiede una decisione architetturale prima di
aggiungere route, server MCP, CLI o credenziali, perche modifica confini di
sessione, dati e autorizzazione.

## Contesto

Per **headless** si intende una superficie macchina completa e versionata,
indipendente dalla UI. Non significa accesso senza limiti.

I vincoli esistenti restano validi:

- MediFlow e local-first e non abilita cloud, telemetria o egress per default;
- i dati clinici restano cifrati e il plaintext non puo essere letto
  direttamente da database, file o log;
- il medico conserva il controllo del contesto clinico e delle scritture;
- le capability Intelligence Fabric descrivono esecuzione e provenienza, ma
  una receipt non autorizza il consumer;
- il flusso graduato resta `proposta -> chiarimento -> anteprima ->
  autorizzazione contestuale -> eventuale applicazione auditata`;
- diagnosi, prescrizioni e identita del paziente non sono auto-applicabili;
- fixture, test e prove devono usare solo dati sintetici.

Il token locale `/api/v1` non e una credenziale per agenti: concede un accesso
applicativo ampio e oggi puo rappresentare una sessione di sistema con privilegi
amministrativi. Anche una credenziale paired identifica un client, non un
mandato agentico delimitato.

La completezza richiesta viene quindi misurata come **copertura dichiarata**:
ogni capacita visibile all'utente deve avere una disposizione headless
versionata, anche quando resta manuale o non disponibile.

## Opzioni

1. Esporre direttamente OpenAPI, token locale e route esistenti.
2. Creare tool MCP o comandi CLI separati, caso per caso.
3. Introdurre un **Agent Interface Plane** applicativo, con un solo catalogo di
   capability e adapter sottili per REST, MCP e CLI.
4. Usare automazione del browser come interfaccia primaria per gli agenti.

## Trade-off

- **Opzione 1**: riusa molto codice, ma confonde compatibilita client e
  autorita agentica. Espone privilegi troppo ampi e non risolve il plaintext
  cifrato selezionato dal medico.
- **Opzione 2**: permette una demo rapida, ma duplica logica clinica e crea una
  superficie incompleta, difficile da verificare e mantenere.
- **Opzione 3**: richiede nuovi contratti, catalogo e harness. In cambio rende
  completa la scoperta, uniforme l'applicazione delle policy e verificabile la
  parita tra adapter.
- **Opzione 4**: puo restare uno strumento di test o compatibilita, ma e fragile,
  poco osservabile e non offre un confine di autorita sufficiente.

## Decisione proposta

Si propone l'opzione 3: un **Agent Interface Plane (AIP)** locale, applicativo e
fail-closed. Lo stato `Proposed` non autorizza ancora implementazione runtime o
scritture.

### 1. Un solo contratto di capability

La logica clinica resta nei servizi applicativi. REST, MCP e CLI sono adapter
sottili dello stesso contratto e non implementano regole cliniche proprie.

Il manifest AIP deve descrivere, per ogni capability:

- identificatore stabile e versione dello schema;
- stadio massimo: `observe`, `read`, `compute`, `propose`, `preview` o `apply`;
- disposizione: `available`, `proposal_only`, `manual_only` o `unavailable`;
- contesto richiesto, dati minimi, provenienza e freshness;
- profilo di autorita e autorizzazione umana richiesta;
- venue consentite, egress profile e fallback;
- motivazione verificabile per capability manuali o non disponibili.

`authorize` e `admin` non sono stadi delegabili. L'autorizzazione appartiene a
un umano autenticato; le operazioni amministrative restano fuori dal mandato
agentico iniziale.

Un controllo automatico deve confrontare il manifest con le superfici
OpenAPI, paired e Intelligence Fabric. Una capability nuova o modificata senza
disposizione headless esplicita blocca il gate.

### 2. Sessione agentica distinta

Un agente usa una sessione dedicata, mai il token locale generale o la sola
credenziale paired. La sessione deve essere:

- emessa da una sessione medico valida;
- limitata ad ambulatorio, capability e stadio;
- a durata breve, revocabile e identificata tramite riferimento non segreto;
- separata dalle autorita `clinical_application` ed
  `engineering_operator`;
- negata per default quando il contesto o la policy non coincidono.

La credenziale non conferisce autorita clinica. Permette soltanto di invocare
capability applicative entro il mandato dichiarato.

### 3. Context lease plaintext minimo

Il medico sblocca MediFlow e seleziona il contesto. Il client applicativo
decifra e minimizza solo i dati necessari, quindi crea un **context lease**
effimero in memoria, legato a sessione, paziente, scopo e scadenza.

Il context lease:

- non offre accesso a SQLite, shell, filesystem o chiavi di cifratura;
- nega letture di altri pazienti e query bulk per default;
- non persiste plaintext in log, cache, receipt o manifest;
- scade o viene revocato al cambio paziente, blocco sessione o termine del
  mandato;
- espone solo projection tipizzate con provenienza e freshness.

### 4. Envelope e receipt PHI-safe

Ogni interazione restituisce un envelope versionato con almeno:

- `requestId`, `actionId`, capability, stadio e stato;
- riferimento al context lease, senza dati clinici;
- provenienza, freshness e versione attesa del target;
- issue tipizzate e prossime azioni consentite;
- eventuale digest dell'anteprima.

Le receipt registrano metadati di interazione locali e PHI-safe. Servono ad
audit e osservabilita, non a billing, telemetria o autorizzazione.

### 5. Le scritture restano applicative e review-first

Una futura capability di scrittura deve seguire questo percorso:

1. l'agente prepara una proposta tipizzata;
2. MediFlow mostra l'anteprima esatta e l'impatto;
3. il medico autorizza una sola applicazione;
4. l'autorizzazione lega attore, sessione, context lease, capability, target,
   digest dell'anteprima e versione attesa;
5. il servizio applicativo verifica di nuovo policy e versione, applica e
   registra un audit PHI-safe.

Scadenza, annullamento, primo tentativo, mismatch di digest o conflitto di
versione invalidano l'autorizzazione. L'agente non puo autorizzare se stesso.

La prima slice resta read-only. Qualunque `apply` richiede un ADR o packet
dedicato e il contratto di step-up authorization governato da `WUL-282`.

## Conseguenze

Diventa possibile costruire una superficie headless completa senza duplicare
la logica clinica o trasformare un agente in amministratore. MCP, CLI e REST
possono evolvere con parita misurabile e la UI resta una delle interfacce, non
la fonte esclusiva delle capability.

Il costo e un nuovo piano di contratti: manifest, sessione, context lease,
envelope, receipt e test di drift. L'implementazione iniziale deve restare
piccola e non puo simulare completezza esponendo direttamente le route
esistenti.

Restano fuori scope:

- accesso diretto a database, file, shell o segreti;
- un agente clinico autonomo o scritture cliniche non revisionate;
- egress o provider cloud abilitati per default;
- query bulk o cross-patient nel primo pilot;
- sostituzione della UI e automazione browser come contratto primario;
- billing enterprise o cambi al modello open-source di MediFlow;
- nuovi claim clinici, regolatori o di completezza runtime.

## Pacchetto decisionale owner-visible

Le cinque proposte seguenti sono candidate collegate a `WUL-558`. Restano un
unico gate: il proprietario deve accettarle o correggerle esplicitamente prima
di cambiare lo stato dell'ADR. Fino ad allora vale
`HOLD_CONTRACT — TRUSTED_BROKER_BOUNDARY_UNDECIDED` e nessun runtime e
autorizzato.

### D1. Context broker, chiavi e authority issuance

**Candidato.** Il broker vive in memoria nel processo host locale `home-base`,
nello stesso trust domain dei servizi applicativi. Il client medico conserva la
master key, decifra e minimizza dopo unlock e selezione esplicita, poi consegna
la projection tramite un canale applicativo locale autenticato. Il broker non
riceve la master key e non legge SQLite, filesystem clinico o ciphertext.

Il broker possiede le copie canoniche di sessione, grant, lease, manifest,
clock, revoca e `selectionEpoch`. Emette una credenziale breve e handle opachi.
Sessione, lease, grant, clock, revoca o projection forniti dal chiamante sono
input non fidati e vengono rifiutati tramite allowlist di sole own-key.

**Alternative.** Tenere il broker nel client medico; usare un daemon locale
separato; riusare token `/api/v1` o credenziali paired. L'ultima alternativa e
incompatibile con il mandato minimo perche identifica un client o una sessione
ampia, non concede autorita agentica delimitata.

**Falsificatore.** Il candidato va riaperto se il canale non puo autenticare
origine e lifecycle senza trasferire master key o token generale, oppure se
lock, logout e cambio selezione non possono invalidare lo stato prima della
richiesta successiva.

### D2. Prima projection clinica

**Candidato.** `patient_open_loops.v1`, per un solo paziente selezionato, con
attese deterministiche, riferimenti sorgente tipizzati, provenienza, freshness
e versione attesa. Niente anagrafica completa, note libere o allegati. La
directory minima per `patient search/show` resta distinta e limitata a
riferimento opaco, nome visualizzato, anno di nascita, stato archivio e
versione nello stesso ambulatorio e mandato.

**Alternative.** Iniziare senza projection paziente; usare un riepilogo
clinico generale; esporre direttamente il record applicativo. Le ultime due
aumentano dati e ambiguita prima di provare il confine minimo.

**Falsificatore.** La projection va ridisegnata se non basta a calcolare gli
open loop in modo deterministico o se richiede testo libero, query bulk o dati
non legati alla selezione corrente.

### D3. Ordine degli adapter

**Candidato.** Servizio applicativo condiviso, poi Mini CLI pipe-first, poi MCP
`stdio`. REST agentico richiede un packet successivo su trasporto e threat
model. Ogni adapter resta sottile e non ricostruisce authority.

**Alternative.** MCP prima della CLI; REST come primo adapter; implementazioni
indipendenti per venue. REST e adapter indipendenti ampliano il confine prima
che il contratto condiviso sia verificato.

**Falsificatore.** L'ordine va riaperto se Mini richiede logica clinica o
authority specifica della CLI invece di limitarsi a validazione input, invio e
rendering del contratto comune.

### D4. Sessione, revoca e step-up

**Candidato.** Un mandato breve lega medico, ambulatorio, capability, stadio
massimo, versione manifest e `selectionEpoch`. Il broker usa il proprio clock.
Lock, logout, cambio paziente, revoca, expiry o manifest incompatibile
invalidano sessione e lease. `apply` resta escluso. Un futuro step-up `WUL-282`
e broker-owned, monouso e legato anche a target, digest anteprima e versione.

**Alternative.** Riutilizzare token locale o paired; accettare timestamp e
claim firmati dall'adapter; mantenere grant riutilizzabili. Queste alternative
non danno al broker autorita corrente su freshness, revoca e primo tentativo.

**Falsificatore.** Il contratto va riaperto se una revoca non puo precedere la
richiesta successiva, se un replay sopravvive al cambio selezione o se uno
step-up puo essere riusato dopo mismatch o primo tentativo.

### D5. Pilot senza egress

**Candidato.** `egress=none`, `fallback=denied_by_contract`, fixture solo
sintetiche e nessun adapter di rete, provider cloud, modello esterno o tool con
rete. Un endpoint loopback non prova da solo l'assenza di egress.

**Alternative.** Modello locale loopback; provider esterno con minimizzazione;
tool di rete allowlisted. Restano fuori dal primo pilot e richiedono confini e
prove dedicati.

**Falsificatore.** Il pilot va fermato se una capability dichiarata disponibile
richiede rete, dati reali o dipendenze non dichiarate per produrre il proprio
risultato o la receipt.

### Registrazione della decisione

Il proprietario deve registrare in `WUL-558` una delle seguenti conclusioni:

- accettazione di D1-D5 senza modifiche;
- accettazione con correzioni nominate per ogni decisione interessata;
- rifiuto con alternativa scelta e nuovo falsificatore verificabile.

Solo dopo quella registrazione l'ADR puo passare ad `Accepted`. L'accettazione
autorizza prima il servizio condiviso; Mini resta bloccato finche quel servizio
non e validato.

## First Thin Slice

La prima slice proposta, collegata a `WUL-558`, e solo locale, read-only e
sintetica. Puo iniziare soltanto dopo l'accettazione di D1-D5:

1. definire uno schema macchina per il manifest AIP;
2. classificare le capability esistenti senza renderne disponibili di nuove;
3. introdurre modelli puri per sessione e context lease, senza persistenza o
   route;
4. esporre in un harness sintetico `agent.capabilities.list`,
   `agent.context.describe` e una sola projection paziente esplicitamente
   selezionata;
5. produrre una receipt locale PHI-safe;
6. verificare che token locale, lease scaduto o revocato, paziente differente,
   accesso diretto e tentativo di `apply` siano negati;
7. verificare che plaintext e segreti non compaiano in log, snapshot o
   receipt.

MCP stdio e CLI arrivano solo dopo la validazione del servizio condiviso. La
slice non aggiunge AI, cloud, scritture cliniche o accesso a dati reali.
