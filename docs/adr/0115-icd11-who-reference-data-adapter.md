# ADR 0115: adapter ICD-11 WHO governato senza Docker

Date: 2026-09-01
Status: Accepted

Issue: [GitHub #306](https://github.com/Wulfgardr/mediflow/issues/306)

Program line: candidata `0.8.5`

Related: [ADR 0021](./0021-terminology-registry-in-settings-json.md),
[ADR 0070](./0070-in-house-first-for-buildable-logic.md),
[ADR 0110](./0110-riapertura-governata-programma-intelligente-085.md),
[ADR 0114](./0114-intelligent-host-aip-mcp-isolation.md),
[ARCHITECTURE.md](../../ARCHITECTURE.md) e
[SECURITY.md](../../SECURITY.md).

## Problema

La ricerca ICD-11 corrente passa da `/api/icd/proxy` a un container locale
configurato di default su `127.0.0.1:8888`. Il browser e alcuni Application
Services dipendono quindi da Docker e la route possiede endpoint, release,
query e parsing del provider.

La `0.8.5` deve rimuovere Docker dal percorso applicativo e usare l'API
ufficiale WHO senza trasferire endpoint, credenziali o authority a UI,
Intelligence Fabric, AIP o MCP. Il nuovo egress non puo diventare una chiamata
cloud implicita o un fallback invisibile.

## Evidenza ufficiale osservata

Al `2026-09-01`, la documentazione WHO dichiara:

- ICD API v2 come API REST ufficiale sotto `https://id.who.int/`, con header
  `API-Version: v2` e linearizzazione `mms` per i codici ICD-11;
- OAuth 2.0 `client_credentials`, scope `icdapi_access`, client ID e client
  secret registrati sul portale WHO;
- release `2026-01` disponibile per MMS in inglese; l'italiano non compare
  tra le lingue MMS di quella release.

Fonti primarie:
[API v2](https://icd.who.int/docs/icd-api/APIDoc-Version2/),
[autenticazione](https://icd.who.int/docs/icd-api/API-Authentication/) e
[release supportate](https://icd.who.int/docs/icd-api/SupportedClassifications/).
Lo [Swagger v2](https://id.who.int/swagger/v2/swagger.json) definisce il path
Search e gli schemi `ISearchResult` e `ISimpleEntity` osservati dal parser.

Questi sono fatti upstream osservati, non una prova live MediFlow. Release,
lingue e compatibilita devono essere ricontrollate prima di cambiare binding.

## Opzioni

1. Conservare il container WHO locale come dipendenza runtime.
2. Chiamare l'API WHO direttamente dalla route e lasciare ai caller release e
   parametri.
3. Introdurre un Application Service di reference data con binding host-owned,
   transport ufficiale separato e cache governata.

## Decisione

Adottiamo l'opzione 3. ADR 0070 continua a governare la logica e il contratto
in-house; questa decisione sostituisce il container Docker come percorso ICD-11
di destinazione. Fino alla migrazione dei caller, la route corrente resta
stato osservato e non viene descritta come gia rimossa.

### Application Service unico

Il seam pubblico e `mediflow.reference_data.icd11.search.v1`. Il caller passa
soltanto una query terminologica breve. Non puo fornire endpoint, header,
credenziali, release, lingua, provider, cache mode, timeout, signal o authority.

Il servizio normalizza e limita la query, risolve cache e runtime state
host-owned, invoca una porta transport nominata e restituisce risultati ICD-11
tipizzati con receipt PHI-safe. Non importa database, sessioni Web, Fabric,
AIP, MCP o writer clinici.

Intelligence Fabric e futuri tool AIP/MCP possono riusare il servizio soltanto
tramite un proprio Application Service e i propri gate. Discovery, query o
risultato terminologico non sono un grant e non autorizzano scritture.

### Binding e allowlist

Il primo binding e immutabile:

- provider `who`, API `v2`, linearizzazione `mms`;
- release `2026-01`, lingua `en`;
- massimo 160 byte UTF-8 di query, 25 risultati, 64 KiB di risposta;
- timeout transport 5 secondi e timeout audit 1 secondo, nessun retry e nessun
  fallback.

Il core usa soltanto un target opaco WHO. Il live transport successivo puo
risolverlo esclusivamente verso i due host HTTPS ufficiali documentati:
`id.who.int` per ICD e `icdaccessmanagement.who.int` per il token. Redirect,
DNS/IP literal, endpoint custom, proxy, HTTP e host aggiuntivi sono negati.
Un cambio release o API richiede un nuovo binding revisionato, non `latest`.

### Credenziali ed egress

Il cloud resta OFF per default. L'egress live richiede insieme:

- feature WHO esplicitamente abilitata dall'operatore;
- stato credenziale host-owned `enabled`;
- rete disponibile e binding esatto;
- gesto di ricerca o operazione nominata gia autorizzata dal proprio boundary.

Client ID, client secret e bearer token restano nel processo server. La
configurazione persistibile contiene solo secret reference allowlisted; i
valori non entrano in DB, settings, browser, backup, receipt, audit o log. Il
token OAuth vive in RAM, e legato alla generation credenziale e scade prima
del tempo vendor dichiarato. `revoked_local` invalida token e lease locali ma
non dichiara revoca WHO.

Il packet credenziali fissa un solo reference logico host-owned:
`host_secret/mediflow.who.icd-api.oauth-client.v1`. Il resolver e l'issuer
ricevono target opachi. I timeout e la cancellazione limitano le `Promise`
native ancora pendenti dopo il ritorno delle callback; lavoro JavaScript
sincrono dentro resolver, presenter o issuer resta cooperativo e non e
preemptable nello stesso processo. La lease bearer e monouso, dura al massimo
30 secondi e riusa tramite single-flight soltanto un token RAM della stessa
generation. Il token viene ritirato almeno 60 secondi prima della scadenza
vendor e viene invalidato su disable, revoca locale, restart o dispose. Il
packet lease usa soltanto resolver e issuer fake: non introduce URL, HTTP,
fetch, rete o smoke live.

Il packet issuer ufficiale #322 aggiunge un adapter separato con binding
immutabile `POST https://icdaccessmanagement.who.int/connect/token`, HTTP Basic
per client ID e secret, form esatta `grant_type=client_credentials` e
`scope=icdapi_access`. Request e response hanno entrambe cap 8 KiB; la risposta
accettata contiene soltanto `access_token`, `expires_in`, `token_type=Bearer` e
`scope=icdapi_access`. Header e form sono facciate effimere ritirate su settle o
abort. Il client HTTP resta obbligatoriamente iniettato e fake nei test: il
packet non aggiunge `fetch`, rete live, composition root o smoke OAuth.

Il packet Search ufficiale #323 aggiunge un adapter separato con binding
immutabile `GET https://id.who.int/icd/release/11/2026-01/mms/search`. La query
contiene soltanto `q`, `flatResults=true`, `highlightingEnabled=false`,
`medicalCodingMode=true` e `includeKeywordResult=false`. Gli header sono
`API-Version: v2`, `Accept: application/json`, `Accept-Language: en` e il
bearer fornito da una lease monouso. Lo Swagger WHO non espone un parametro
per il limite dei risultati: MediFlow applica il limite locale di 25 elementi
dopo il limite raw di 64 KiB e fallisce chiuso se il risultato lo supera.

L'adapter accetta soltanto un envelope HTTP data-only e i campi opzionali
documentati di `ISearchResult`, `ISimpleEntity` e `ISimplePropertyValue`.
Richiede `theCode` e `title`, rifiuta highlighting, duplicati, discendenti
nidificati, campi aggiuntivi e valori non conformi, e pubblica soltanto lo
schema transport esistente. Il client HTTP resta iniettato e fake. Il packet
non aggiunge `fetch`, rete live, route, migrazione caller o smoke Search.

Il timeout di 5 secondi appartiene al servizio e abortisce il transport
pending. Cancellazione e restart impediscono la pubblicazione e ritirano la
lease. Come per le altre porte nello stesso processo, il lavoro JavaScript
sincrono dentro il client HTTP iniettato resta cooperativo e non e preemptable;
il limite interrompe soltanto una `Promise` nativa ancora pendente dopo il
ritorno della callback.

La query in uscita contiene soltanto i termini necessari alla ricerca ICD-11:
nessun patient ID, nome, codice fiscale, documento, nota, prompt o contesto
clinico. Il servizio non dichiara anonimizzazione: una query diagnostica puo
restare dato sanitario e l'opt-in deve dirlo chiaramente.

### Cache e offline

La prima slice usa solo cache process-local. La chiave grezza non viene
persistita. Una hit e riusabile soltanto con binding esatto e scadenza non
superata; il TTL massimo e 24 ore.

Offline, egress disabilitato, credenziale assente o upstream fallito non
attivano Docker, codici legacy, release diversa o altro provider. Una hit
fresca exact-binding puo essere restituita come `cache`; altrimenti il servizio
fallisce chiuso. Un catalogo bundle o una cache persistente richiedono
provenienza, licenza, cifratura/retention e invalidazione definite in un packet
separato.

### Receipt e audit

Ogni successo produce una receipt con operation, release, lingua, sorgente
`live|cache`, conteggio, durata e timestamp host-owned. Receipt e audit non
contengono query, codici cercati, descrizioni, patient ID, URL, header, token o
segreti. Un errore audit nega la pubblicazione del risultato.

Denial ed errori usano codici chiusi: input invalido, offline/cache miss,
egress disabilitato, credenziale non pronta, timeout, cancellazione, upstream
non disponibile, risposta invalida e audit non disponibile. Dettagli vendor e
payload non attraversano il boundary.

## First Thin Slice

1. Aggiungere questo ADR e i riferimenti canonici.
2. Implementare il core Application Service con binding fisso, cache RAM,
   receipt/audit PHI-safe e transport fake.
3. Verificare query bounded, lifecycle/egress denial, cache exact-binding,
   timeout/cancel, risposta hostile e nessun endpoint/secret/DB nel core.
4. Lasciare fuori live transport, OAuth, cache persistente, route e caller.

## Packet successivi

1. Composition root host-owned e cache/reference snapshot governata.
2. Migrazione atomica di route, UI e Application Services, poi rimozione del
   percorso Docker e aggiornamento di launcher, docs e guard.
3. Smoke live con credenziali fuori Git e verifica exact-candidate.

## Stop rule e claim ceiling

Fermare la lane se compare URL o credenziale caller-supplied, endpoint non WHO,
HTTP, redirect, retry/fallback, query o risultato nei log, cache stale o di
release diversa, DB diretto, authority agentica, write clinico, PHI/PII reale
nei test o migrazione caller nello stesso packet del core.

Fino ai packet successivi, il claim massimo e: **contratto, core, lease
secret/token generation-bound, issuer OAuth e transport Search ufficiali
ICD-11 WHO verificati con client HTTP fake; nessun client HTTP live, OAuth o
Search end-to-end, caller migrato, Docker rimosso dal runtime o smoke WHO
consegnato**.
