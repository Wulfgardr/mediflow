# ADR 0093: Agent Interface Plane headless

Date: 2026-08-19
Accepted: 2026-08-21
Status: Accepted

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

## Decisione

Si adotta l'opzione 3: un **Agent Interface Plane (AIP)** locale, applicativo e
fail-closed. L'accettazione autorizza solo le slice che rispettano i contratti
di questo ADR. Non autorizza scritture cliniche, accesso diretto ai dati o
adapter che ricostruiscono autorita da contenuto fornito dal chiamante.

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

## Decisioni chiuse per l'accettazione

### 1. Context broker e confine delle chiavi

Il context broker vive nel processo host locale del Mac `home-base`, nello
stesso trust domain dei servizi applicativi. Mantiene stato solo in memoria e
non espone un'API dati generica.

Il client medico conserva la master key. Dopo unlock e selezione esplicita, il
client decifra e minimizza la projection necessaria, quindi la consegna una
sola volta al broker tramite un canale applicativo locale autenticato. Il
broker non riceve la master key e non legge SQLite, filesystem clinico o
ciphertext per conto dell'agente.

Il broker crea copie canoniche, validate tramite allowlist di own-key, di:

- sessione agentica e grant risolti dal manifest corrente;
- context lease e projection minimizzata;
- clock, scadenza, revoca e `selectionEpoch` corrente;
- eventuale autorizzazione step-up futura.

L'adapter riceve una credenziale breve e handle opachi generati dal broker.
Ogni richiesta dell'agente contiene solo handle e argomenti operativi. Sessione,
lease, grant, manifest, clock, revoca, projection e selection epoch forniti dal
chiamante non costituiscono autorita e devono essere ignorati o rifiutati.

### 2. Prima projection clinica

La prima projection clinica e `patient_open_loops.v1` per un solo paziente
selezionato. Contiene soltanto attese deterministiche, riferimenti sorgente
tipizzati, provenienza, freshness e versione attesa. Non contiene anagrafica
completa, note libere, allegati o output generativi.

`patient search` e `patient show` nel pilot usano una directory minima distinta,
costruita dal broker per il solo ambulatorio e mandato correnti. I campi ammessi
sono riferimento opaco, nome visualizzato, anno di nascita, stato archivio e
versione. La ricerca bulk, cross-ambulatorio o senza mandato resta negata.

### 3. Ordine degli adapter

L'ordine vincolante e:

1. contratto e servizio applicativo condiviso;
2. **MediFlow Mini**, CLI pipe-first con JSON/NDJSON deterministici;
3. MCP `stdio` come adapter successivo dello stesso servizio;
4. REST agentico solo dopo un packet dedicato su trasporto e threat model.

Nessun adapter puo importare database writer, ridefinire policy cliniche o
validare in autonomia contenuto authority-bearing.

### 4. Sessione, revoca e step-up

Una sessione medico valida crea un mandato agentico breve. Il broker lega il
mandato a medico, ambulatorio, capability, stadio massimo, manifest version e
selection epoch. Un lock, logout, cambio paziente, revoca esplicita, scadenza o
manifest incompatibile invalida sessione e lease prima della prossima azione.
Il broker usa il proprio clock; timestamp del chiamante non hanno autorita.

Il pilot non include `apply`. Un futuro `apply` richiede `WUL-282` e una
autorizzazione step-up broker-owned, monouso, con attore medico, sessione,
lease, capability, target, digest dell'anteprima, versione attesa, scadenza e
selection epoch. Ogni mismatch o primo tentativo consuma o invalida il grant.

### 5. Pilot senza egress

Il primo pilot usa `egress=none`, `fallback=denied_by_contract` e sole fixture
sintetiche nelle prove. Adapter di rete, provider cloud, modelli esterni e tool
con rete sono disabilitati. Un endpoint loopback, da solo, non dimostra questo
confine: il gate deve negare ogni configurazione o dipendenza non dichiarata.

L'accettazione dell'ADR non promuove un broker live. Fino alla consegna del
canale applicativo autenticato, Mini puo eseguire solo il pilot sintetico e
deve negare l'accesso a dati reali con un errore stabile.

## First Thin Slice

La prima slice proposta, collegata a `WUL-518`, e solo locale, read-only e
sintetica:

1. pubblicare schema macchina AIP e manifest parity Mini;
2. classificare ogni capability web senza concedere autorita implicita;
3. implementare un broker e un servizio condiviso in memoria, con stato
   canonico broker-owned e fixture sintetiche;
4. esporre `whoami`, `capabilities`, `patient search`, `patient show`,
   `open-loops` e draft/preview solo dove il manifest li autorizza;
5. aggiungere Mini come adapter pipe-first sottile, con output deterministico,
   exit code stabili e receipt PHI-safe;
6. negare contenuto authority caller-supplied, token locale, lease scaduti o
   revocati, cross-patient, egress, accesso diretto e ogni `apply`;
7. aggiungere MCP `stdio` solo dopo la validazione indipendente del servizio e
   di Mini.

La slice non aggiunge AI, cloud, scritture cliniche o accesso a dati reali.
