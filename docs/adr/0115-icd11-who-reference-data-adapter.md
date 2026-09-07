# ADR 0115: Application Service ICD-11 WHO e sidecar locale opt-in

Date: 2026-09-01
Status: Accepted

Amendment: 2026-09-06, WUL-672, candidato locale da `07725c7`.

## Decisione vigente per il candidato 0.8.6 — prima del codice

L'utente ha scelto il **sidecar WHO locale** il 6 settembre, come registrato
nel [packet WUL-672](../analysis/2026-09-05-086-who-decision.md#1-decisione-utente-catalogo-who-con-sidecar-locale).
Questa revisione sostituisce il target online della decisione del 1 settembre
per il production root del candidato. Le sezioni storiche sotto descrivono
quel percorso precedente e i relativi packet, non autorizzano fallback online.
Il vecchio container MediFlow, la porta 8888 e i suoi launcher restano ritirati.

### Confine e contratto Search

- La route autenticata `/api/icd/proxy` resta sottile: senza parametri legge
  soltanto readiness, con il solo `q` esegue Search. Nessun nuovo endpoint,
  lookup, cross-check, autocode o cambiamento alle altre API.
- Un nuovo transport interno usa solo `http://127.0.0.1:8382` e il path
  `/icd/release/11/2026-01/mms/search`. Il caller non sceglie URL, host, porta,
  header, release, lingua o policy. Nessun redirect, proxy, OAuth, token,
  risoluzione segreti o fallback remoto. Il listener deve essere confinato
  al loopback in provisioning; questo non autentica altri processi dell'host.
- Il production root seleziona esclusivamente il locale. I componenti online
  precedenti possono restare come codice storico coperto da test, senza essere
  composti nel percorso production. Non si simula una credenziale OAuth per
  superare i vecchi gate.
- Binding `v2 / 2026-01 / mms / en`; query massima 160 byte UTF-8, massimo 25
  risultati, risposta upstream massima 64 KiB, deadline transport 5 secondi e
  audit 1 secondo. Nessun retry o pubblicazione tardiva. La query contiene
  soltanto termini, senza contesto paziente. Audit e receipt non includono
  query, codice, titolo, URI, percorsi host o segreti.
  L'audit persistito usa la whitelist esistente: `counts=resultCount` e flag
  espliciti per schema, operazione, deployment, fonte, release, lingua, binding,
  immagine, dataset, latenza e i tre timestamp della receipt validata. Le chiavi
  `image` e `dataset` mantengono i digest SHA-256 interi entro gli 80 caratteri
  per token del sanitizer; nessuna estensione dello schema audit generale.
- Search locale pubblica un envelope `icd11-search-response.v2`, con voce
  `code`, `description` (titolo WHO), `system` e `canonicalUri`, più `partial`
  e receipt versionata. L'URI deve appartenere al namespace MMS/release fissato;
  viene conservato come dato, mai dereferenziato. Il limite di 25 riguarda
  l'output, non la cardinalita upstream: entro i 64 KiB si validano tutte le
  voci a blocchi di 25 con il parser ufficiale esistente, si restituiscono le
  prime 25 in ordine WHO e si imposta `partial=true` se altre sono omesse o WHO
  dichiara `resultChopped`. Una voce malformata anche dopo la venticinquesima,
  URI/codici duplicati o body oltre il limite negano la risposta. Nessuna
  modifica al vecchio parser/trasporto online, paginazione remota o ordinamento.
- Il client riconosce separatamente v1 e v2 a campi chiusi; non modifica
  silenziosamente v1. Il risultato v2 conserva la provenienza nella ricerca
  e nella selezione. La revisione parent del 6 settembre richiede che codice,
  titolo e URI sopravvivano al salvataggio/rilettura effettivi del paziente,
  coerentemente con il §1.2.3 dei termini WHO. Il campo JSON `diagnoses` gia
  cifrato ammette i due campi opzionali `canonicalUri` e `reference` (binding,
  lingua/release, immagine e dataset dichiarati da MediFlow, non WHO).
  Modulo, schema client e proiezione della sessione di modifica li conservano;
  nessuna nuova colonna, route o policy di cifratura. Record storici/manuali
  senza metadati restano leggibili, senza ricostruire URI o certificare codici.
  Il codice di una selezione WHO resta in sola lettura finche la selezione non
  viene sostituita/cancellata; una nuova ricerca libera azzera codice e fonte.
  La compatibilita del medesimo JSON include `MediFlowCore.DiagnosesCodec`:
  `ClinicalDiagnosis` ed `Entry` conservano URI opzionale e `reference` come
  valore JSON opaco nel decode/encode gia usato dall'editor nativo. Il codec
  non interpreta o verifica la fonte, non ricostruisce URI e non avvia Search.
  Campi assenti/null diventano opzionali nil e non aggiungono chiavi ai record
  di forma precedente; sistemi sconosciuti e riferimenti JSON non WHO restano
  leggibili. Solo codec Core e test di round-trip, nessuna modifica Shared/UI,
  Search nativa, cifratura o FHIR.
  Anche la proiezione del modulo web normalizza `canonicalUri/reference: null`
  come assenza: apertura e salvataggio invariato non riscrivono diagnosi, e una
  modifica effettiva omette tali chiavi vuote. I campi opachi estranei conservano
  i vincoli esistenti contro la perdita o la riassociazione incerta dei metadati.
  Export e migrazione dei record storici restano un gate separato: il candidato
  non attesta conformita dell'intero ciclo di utilizzo ICD.

### Compatibilita Search osservata il 7 settembre 2026 — WUL-673

La prima prova locale reale della release WHO 2026-01 restituisce anche
combinazioni di codici: `theCode` contiene i separatori ICD `&` o `/`, mentre
`id` contiene i rispettivi URI MMS separati dallo stesso operatore. Non e un
singolo URI. Rifiutare l'intera risposta per questo formato rende inutilizzabile
anche una ricerca ordinaria come `cholera`.

Per queste voci il lettore verifica ogni URI componente nel namespace fissato,
numero e ordine dei separatori rispetto al codice ricevuto. Conserva codice e
titolo WHO e usa come `canonicalUri` l'endpoint ufficiale
`http://id.who.int/icd/release/11/2026-01/mms/codeinfo/<codice percent-encoded>`.
E un riferimento formato secondo il contratto WHO, non l'URI di un solo
componente: una chiamata locale di verifica ha confermato lo stesso `@id` per
`1A00&XN8P1`. Non viene introdotta una chiamata CodeInfo per ogni risultato,
ne dereferenziazione automatica, interpretazione o validazione clinica della
combinazione. I riferimenti a entita singole e i record storici restano invariati.
Il client verifica anche la corrispondenza tra codice e URI CodeInfo; la
serializzazione percent-encoded deve essere canonica. Formati non riconosciuti
continuano a negare l'intera risposta, senza scartare silenziosamente voci.

Fonte: [WHO API v2, CodeInfo e combinazioni](https://icd.who.int/docs/icd-api/WhatsNewAPIVersion2/).
Questa estensione del riferimento non abilita cross-check, autocode o export
FHIR e non qualifica l'uso clinico della classificazione.

### Verifica esplicita del codice — integrazione 0.8.6, WUL-673

Search per termini e verifica del codice sono operazioni distinte. La nuova
route autenticata `GET /api/icd/code-check?code=...&release=2026-01` usa soltanto
il CodeInfo ufficiale sul medesimo sidecar e, per il codice trovato, legge il
titolo dell'entita base indicata da WHO. La release richiesta e obbligatoria e
deve coincidere con quella fissa; un'altra release viene rifiutata prima di
contattare il servizio. Nessuna conversione a codici terminali o flexible mode.

Il codice e ASCII maiuscolo, massimo 32 caratteri, con separatori `&` e `/`
espliciti. Ogni path e costruito sul server: l'URI dell'entita base e prima
validato nel namespace MMS/release fissati e non viene seguito come URL.
Le due letture condividono il budget di 5 secondi, 64 KiB per risposta e la
cancellazione; redirect, risposta incoerente e fallimento negano il risultato.
Il 404 CodeInfo produce `not_found`, distinto da indisponibilita. Per una
combinazione il titolo e dichiaratamente quello del codice base: non viene
presentato come descrizione dell'intera combinazione.

Il DTO conserva codice richiesto, esito, riferimento WHO, release, lingua e
identita di immagine/dataset. La receipt dedicata riporta istante, latenza ed
esito senza codice, titolo o query nell'audit. La verifica e sempre diretta:
nessuna cache o validita futura implicita. Prima della risposta il server
ricontrolla configurazione, generazione e autorita della sessione; disattivazione,
lock o cambio binding non possono pubblicare un risultato tardivo.

Il controllo non modifica la cartella, non attesta correttezza della diagnosi,
eleggibilita o adeguatezza clinica, e non abilita automaticamente export/FHIR.
I risultati con release storica non vengono riscritti. La nuova UI puo rendere
visibile la verifica accanto al codice e offrire una scelta esplicita successiva.

Contratto verificato su OpenAPI WHO `GetCodeInfo` e risposte locali del 7
settembre 2026: codice singolo e combinazione 200, codice inesistente 404,
entita base con titolo inglese. Le prove HTTP/UI integrate restano gate separati.

### Attivazione del servizio

- `MEDIFLOW_ICD_WHO_ENABLED=1` e opt-in server esplicito; senza di esso zero
  richieste e nessuna lettura delle credenziali. Il trasporto locale non legge
  `MEDIFLOW_ICD_WHO_NETWORK` o le variabili OAuth precedenti.
- L'attivazione richiede anche `MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST` e
  `MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID`, entrambi `sha256:<64 hex>`, forniti
  dall'inventario di provisioning. Valori assenti o invalidi bloccano Search.
  Sono identificatori dichiarati dall'host, non attestazioni ottenute dall'API.
- Readiness v2 distingue `disabled`, `configuration_required`, `configured`,
  `available` e `unavailable`; indica deployment locale, binding e ultimo
  successo diretto distinto dall'ultima restituzione cache. Leggere readiness
  non interroga WHO. `available` descrive un successo recente osservato, non
  prova integrita del dataset, licenze, installabilita o disponibilita futura.
- Cache soltanto RAM, massimo 256 chiavi/4 MiB, TTL assoluto massimo 24 ore
  dall'acquisizione, senza rinnovo su hit. Chiave legata a query normalizzata,
  binding e identita immagine/dataset. Receipt distingue `deployment=local`,
  `source=live|cache`, `fetchedAt`, `expiresAt` e `completedAt`.
- I gate precedono la cache. Disable, cambio identita/configurazione, dispose
  o clock regressivo invalidano cache e risultati pendenti. Configurazione
  riletta al confine di ogni operazione e prima della pubblicazione; nessuna
  promessa di osservare istantaneamente cambi esterni fra due letture.

### Setup guidato locale — WUL-673, 7 settembre 2026

Il percorso guidato aggiunge una CLI locale a operazioni nominate e una guida
interattiva nelle impostazioni. Non introduce API di provisioning, accesso Docker
nel server Web, writer clinici o modifiche al contratto Search/CodeInfo.

- `init` prepara un manifesto privato incompleto; non accetta termini o inventa
  evidenze. `plan` valida le registrazioni senza rete. `status` legge soltanto
  metadati selezionati del contesto Docker locale e del container nominato;
  non legge variabili d'ambiente del container o credenziali. Il contesto deve
  usare un socket Unix locale; nessun cambio del contesto globale o gestione VM.
- `install` richiede manifesto valido per provisioning e conferma esatta
  `install-who-2.6.0-2026-01_en`. Solo questa azione puo scaricare l'immagine
  ufficiale al digest registrato e avviare un nuovo container a nome fisso.
  Binding loopback 8382:80, piattaforma ARM64, release/lingua fissate,
  `acceptLicense=true` dopo registrazione dell'accettazione, analytics,
  DORIS e FHIR disabilitati, zero mount, restart automatico disabilitato.
  Nessuna shell, argomenti Docker liberi, esecuzione da query Web, sostituzione,
  arresto o rimozione di container esistenti. Il manifesto per una nuova
  installazione non puo ereditare snapshot/prove di un altro deployment.
  Un fallimento conserva gli
  artefatti creati e indica la fase da recuperare manualmente.
- `configure` richiede manifesto valido per attivazione, container nominato
  in esecuzione con immagine e listener coerenti, e conferma esatta
  `enable-who-2026-01_en`. Scrive esclusivamente le tre variabili del contratto
  server in un nuovo file privato, senza sovrascrivere file o ambiente esistenti.
  Non avvia/riavvia MediFlow; l'operatore carica il file nel successivo avvio
  autorizzato. Configurazione generata non significa processo gia configurato.
- Inventario, snapshot, prove offline/ripristino e consenso restano dichiarazioni
  host-owned da verificare sul target, non attestazioni della CLI. Il percorso
  di qualifica esistente resta obbligatorio; nessun download, VM o nuova prova
  distruttiva sul deployment gia qualificato per verificare il wizard.
- La UI mostra prerequisiti, termini/versione, comandi fissi, blocchi e recupero;
  nessuna chiave OAuth per il deployment locale. La verifica finale riusa la
  ricerca esplicita di esempio gia presente, distinguendo cache e risposta live.
  Un checkbox nella guida non concede autorita al server o prova un'installazione.

I test usano Docker fake e fixture sintetiche, con directory dati temporanea
esplicita. Il read-only sul deployment qualificato e la fixture UI sono prove
separate da un'installazione nuova end-to-end. Nessuna modifica `/api/v1`.

### Revisione del percorso ordinario — WUL-673, prima del codice

La prima guida CLI richiedeva editing JSON, hash e qualifica manuale: non
soddisfa il percorso ordinario richiesto e non viene promossa a onboarding
completo. La revisione conserva la CLI tecnica per il gestore e aggiunge
`Setup_WHO.command`, solo host macOS ARM64, senza endpoint Web privilegiati.

- Un release-lock distribuito contiene soltanto metadati pubblici del registry
  ufficiale verificato il 7 settembre: immagine 2.6.0/ARM64, digest e hash delle
  evidenze primarie. Non include licenza dell'operatore, identita dataset o prove
  di un deployment. La procedura prepara automaticamente il manifesto privato.
- Il gesto interattivo di licenza riguarda esattamente software/versione/dataset
  mostrati; e registrato localmente con data e identificatore dell'installazione.
  Prima di rete o mutazioni Docker l'utente autorizza installazione e qualifica
  del nuovo servizio. Nessuna accettazione implicita da copia del comando.
- Rilevamento e scelta del contesto Docker locale non modificano VM o contesto
  globale. Host diversi da macOS ARM64, runtime assente o porta occupata hanno
  uno stato leggibile e negano l'installazione. Windows/Linux restano un gap.
- La procedura possiede soltanto container/network creati con ID e label della
  propria installazione. Non adotta servizi altrui tramite un nome o manifesto.
  Qualifica e recupero verificano ownership prima delle mutazioni; nessun input
  Web, shell o argomento Docker arbitrario. `Config.Env` e segreti non si leggono.
- `qualify` calcola davvero inventario e hash dei cinque file dataset osservati
  per questa release, copiati dal proprio container fermo in una directory
  privata. Non copia l'intera `/tmp`. Le prove richiedono nuova Search pubblica
  dopo riavvio su network Docker interno senza default route, quindi ripristino
  dello snapshot in un secondo container della stessa immagine e nuova Search
  senza route esterna. Hash e metadati 0:0/0644 vengono confrontati sul ripristino.
- Gli esiti legano installazione, container originale e di ripristino, immagine,
  network, inventario, timestamp e risposta bounded. Solo entrambe le prove
  riuscite consentono di scrivere i gate di attivazione. Checkbox o dichiarazioni
  dell'utente non sostituiscono prove e non si ereditano receipt altrui.
- Un fallimento conserva snapshot e receipt incompleta, nega la configurazione
  e tenta il recupero del solo container originale posseduto. Nessuna rimozione
  automatica. La qualifica documenta un network Docker interno senza route
  esterna, non un isolamento generale dell'host. Le prove sintetiche della CLI
  non sono qualifica live del nuovo installer.
- A qualifica completa viene generata la configurazione privata e un avvio host
  nominato carica le tre variabili esistenti nel launcher MediFlow, senza editing
  di ambiente o JSON. L'avvio dell'app richiede una scelta separata dell'utente;
  la procedura non interrompe il server attivo. La UI ordinaria espone tre passi
  brevi e stato del servizio; l'ispezione tecnica rimane in disclosure dedicata.

### Fonti primarie rilette il 2026-09-06

- [WHO local deployment](https://icd.who.int/docs/icd-api/ICDAPI-LocalDeployment/):
  API locale senza OAuth, path equivalenti, URI canonici WHO conservati.
- [WHO Docker](https://icd.who.int/docs/icd-api/ICDAPI-DockerContainer/): supporto
  ARM, provisioning iniziale con rete, `include`, consenso licenza e analytics.
- [Release/lingue](https://icd.who.int/docs/icd-api/SupportedClassifications/):
  MMS 2026-01 inglese disponibile; italiano non disponibile per questo binding.
- [Termini WHO](https://icd.who.int/en/docs/icd11-license.pdf), §§1.2.3, 2:
  codice/titolo/URI e licenza distinta del software. Nessuna accettazione o
  certificazione legale e prodotta da questo ADR.

## Decisione storica del 1 settembre — target online superato nel candidato

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
