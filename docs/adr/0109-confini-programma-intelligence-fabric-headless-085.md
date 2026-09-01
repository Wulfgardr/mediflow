# ADR 0109: confini del programma Intelligence Fabric e Headless 0.8.5

Date: 2026-09-01
Status: Accepted

Issue: WUL-522, WUL-564
Program line: candidato sorgente locale `0.8.5`

Related: [ADR 0072](./0072-voice-visit-capture-fluid-boundary.md),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0100](./0100-fabric-vs-headless-semantic-plane.md),
[ADR 0103](./0103-headless-clinician-authorized-soap-entry-write.md),
[ADR 0107](./0107-anydoc-local-attachment-extraction.md) e
[ADR 0108](./0108-piano-canonico-headless-read-only-085.md).

## Problema

Il candidato 0.8.5 integra quattro percorsi generativi nel Fabric e conserva
una foundation Headless. Queste due evidenze non autorizzano un agente
generale, un trasporto MCP, un planner semantico operativo o un nuovo canale di
scrittura clinica.

Serve un confine unico per distinguere:

- ciò che appartiene al candidato sorgente locale;
- la sola eccezione SOAP stretta;
- le direzioni future che richiedono una nuova decisione e un packet separato.

Senza questo confine, un catalogo, un adapter o una receipt potrebbero essere
presentati come runtime, authority o conformità che il tree non dimostra.

## Ledger F6-F7: incluso ed escluso dalla 0.8.5

Il ledger separa requisito, implementazione, verifica e perimetro di release.
`RELEASE_SCOPE_EXCLUDED` non è un blocco nascosto: indica che il requisito è
deciso ma non appartiene alla patch 0.8.5. `HOLD` resta riservato a un confine
nominato che blocca una feature inclusa.

| Gate | Requisito | Implementato | Verificato | Stato, owner e blocker | Prossimo risultato e claim ceiling |
| --- | --- | --- | --- | --- | --- |
| F6-A · estrazione inclusa | AnyDoc è primario per file con testo estraibile. Input senza testo utile deve fallire chiuso verso revisione manuale. Le route legacy non devono eseguire OCR. | AnyDoc usa la sorgente host-owned corrente; `/api/ocr/extract` e `/api/pdf-extract` terminano auth-first con `410`; la capability `ocr` non ha entrypoint. | Evidenza: `lib/domain/documents/anydoc-current-source-composition.test.ts`, `lib/attachment-local-extraction-route.test.ts`, `lib/ocr-production-retirement.test.ts` e crosswalk. I test di contratto coprono estrazione, denial e retirement; non sono la prova E2E/prestazionale richiesta per promuovere. | `INCLUDED_SOURCE_CANDIDATE` · owner: document intelligence. Per la promozione restano necessarie prove E2E sintetiche sull'esatto tree e misure bounded di tempo, memoria e limiti di risorsa. | Eseguire una matrice E2E sui formati inclusi e sui failure mode, più una prova prestazionale ripetibile. Claim ceiling: **estrazione AnyDoc locale per testo estraibile; review manuale fail-closed negli altri casi**. |
| F6-B · fallback selettivo | DeepSeek-OCR 2 può ricevere soltanto pagine classificate `needsOcr`; la ricomposizione deve conservare provenienza, hash e qualità per pagina. Prima dell'enable servono benchmark sintetico italiano e soglie fissate. Il percorso deve restare fail-closed, proposal-only, zero-write e senza cloud egress. | Nessun adapter, classificatore page-level, ricompositore o fallback è collegato. | Evidenza positiva assente: nessun E2E o benchmark di promozione è stato eseguito per DeepSeek-OCR 2. Il crosswalk corrente registra `ocr` come `unavailable`. | `RELEASE_SCOPE_EXCLUDED` · owner futuro: document intelligence. Mancano contratto versionato, adapter, corpus, metriche, soglie ed evidenza prestazionale. | Aprire un packet separato dopo la 0.8.5. Claim ceiling: **requisito deciso, non implementato, non benchmarkato e non abilitato**. |
| F7-A · provider inclusi | Il runtime incluso usa provider locali host-owned e mostra una disclosure read-only distinta dall'osservazione di una singola operazione. | Ollama serve Patient Insight, Smart Import e Document Synthesis; ATHENA serve Treatment Reasoning quando configurati. La disclosure v1 elenca anche OpenAI e Anthropic come righe informative disabilitate e dichiara che la subscription consumer non è accesso API. ATHENA richiede modello e runner locali preprovisioned; il default non configurato fallisce chiuso. | Evidenza: `docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json`, `lib/ai-providers/fabric/provider-disclosure.test.ts` e test dei production root. Il checkpoint `2574cf5fc` registra 6/6 test mirati, typecheck ed ESLint verdi e uno smoke BF16 locale sintetico da 10,6 s, 64 token e 211 caratteri, senza output grezzo. Non prova i quattro E2E o le prestazioni sulla macchina di destinazione. | `INCLUDED_SOURCE_CANDIDATE` · owner: Fabric provider governance. Disponibilità e prestazioni dei modelli restano dipendenti dalla macchina; per la promozione servono E2E sintetici e misure bounded sull'esatto tree. | Eseguire i quattro E2E proposal-only e registrare tempi, timeout e risorse senza dati reali. Claim ceiling: **Ollama e ATHENA locali dove configurati e preprovisioned; disclosure provider read-only**. |
| F7-B · provider esterni | Il modello futuro deve separare `providerType`, `providerInstance`, `auth`, `model`, `capabilities`, `groups`, `bindings` e `functionAllowlist`. Le classi credenziale ammesse sono `local_model`, `api_key`, `provider_oauth` tramite flusso ufficiale e `host_subscription`. OpenAI e Anthropic entrano prima nel registry; un runtime richiede contratto ufficiale ed egress esplicito. | Esistono solo registry e disclosure informativa. Non esistono configurazione credenziali, auth, provider binding o esecuzione cloud. | Evidenza negativa: `lib/ai-providers/fabric/provider-disclosure.ts` descrive righe informative disabilitate; non esiste prova di runtime OpenAI/Anthropic, OAuth o egress. | `RELEASE_SCOPE_EXCLUDED` · owner futuro: Fabric provider governance. La disclosure v1 non modella ancora le entità richieste e non esiste un contratto ufficiale abilitato. | Progettare un provider contract v2 in un packet separato, con fixture senza credenziali. Claim ceiling: **nessuna esecuzione OpenAI/Anthropic; un abbonamento consumer o host non conferisce inference o accesso API**. |

Per F6 e F7 sono vietati codice GPL incorporato, OAuth privato o reverse
engineering di flussi consumer. Ogni dipendenza e ogni integrazione futura
richiedono licenza compatibile e contratto ufficiale verificato.

## Decisione

### Intelligence Fabric nel candidato 0.8.5

Il Fabric governa quattro capability generative:

- `patient_insight`;
- `smart_import`;
- `document_synthesis`;
- `treatment_reasoning`.

Ogni percorso usa una route autenticata e un production root host-owned. Il
production root risolve provider e venue, verifica currentness e lifecycle e
pubblica receipt e provenienza prive di contenuto clinico. Il chiamante non
sceglie provider, modello, endpoint, prompt, fallback o apply.

Lo stadio massimo è `proposal_only`. Ogni risultato dichiara
`writesPerformed=0` e `applyPolicy=none`. Una receipt descrive una risoluzione;
non è un grant e non autorizza una scrittura.

Ollama serve Patient Insight, Smart Import e Document Synthesis. ATHENA su MLX
serve soltanto Treatment Reasoning. I lifecycle restano separati. Cloud,
egress, fallback silenzioso e invocazione AI dai client paired non sono
autorizzati.

Il crosswalk corrente conserva
`docs/capability-mapping/fabric-product-crosswalk-receipt.v1.json` tra gli
artifact storici, con il suo stato `candidate_not_integrated` e il digest
registrato. Non lo riscrive come prova dell'integrazione corrente. La nuova
evidenza runtime resta distinta dalle receipt storiche.

### Foundation Headless e sola eccezione SOAP

La foundation Headless generale conserva zero operazioni eseguibili. Il piano
`66/66` di ADR 0108 contiene esiti terminali e candidati di lettura; non
contiene 66 endpoint, grant o Application Service pronti all'uso.

Il candidato non include listener, servizio agente, installer, onboarding,
discovery operativa, CLI generalizzata o bridge LAN. Un adapter non accede a
SQLite e non replica regole applicative.

La sola eccezione locale è
`mediflow.clinical_diary.append_soap.v1`, regolata da ADR 0103. Richiede la
conferma esplicita del medico, uno step-up fresco, proof e comando monouso,
currentness host-owned e commit atomico dell'unico owner SQLite. Le evidenze
H1-H10 coprono il percorso locale integrato e i suoi denial. Non creano un
trasporto Headless generale e non trasferiscono authority al Fabric, a Mini, a
chat o ad altre capability.

### MCP resta una direzione futura sopra AIP

Un eventuale adapter Model Context Protocol (MCP) potrà esistere soltanto sopra
l'Agent Interface Plane (AIP) e gli stessi Application Services host-owned.
Non potrà scegliere provider, interrogare SQLite, ricostruire sessioni o
incorporare regole di dominio.

Il candidato 0.8.5 non contiene un server MCP, un installer, onboarding,
manifest operativo o una sessione agente abilitata. La presenza di cataloghi o
schemi non prova discovery o interoperabilità MCP.

La governance futura considera due modalità distinte:

1. provider eseguiti dentro MediFlow e governati dal Fabric;
2. MediFlow governato come capability dentro un host intelligente tramite App,
   MCP o Headless.

La seconda modalità non trasferisce authority all'host. Richiede gli stessi
Application Services, binding e receipt. Il candidato non promette server,
installazione o onboarding per nessuna delle due modalità.

### AnyDoc separa estrazione, proposta e applicazione

AnyDoc è l'unica estrazione automatica locale degli allegati. Produce Markdown
normalizzato, evidenza e provenienza dalla sorgente host-owned corrente. Non è
OCR, provider, venue o autorità clinica.

I servizi downstream possono trasformare l'evidenza in proposte tipizzate. Un
eventuale apply resta un percorso applicativo distinto, con selezione
esplicita, authority, versione attesa, idempotenza, audit e receipt propri.
L'estrazione o la proposta non autorizzano l'apply.

Nel runtime corrente la capability `ocr` e `unavailable`. Immagini e PDF
scansionati senza text layer falliscono chiusi e richiedono revisione manuale.
Questo stato descrive l'identita 0.8.5, non un divieto permanente. F6-B non lo
riattiva nella patch: il fallback selettivo DeepSeek-OCR 2 è
`RELEASE_SCOPE_EXCLUDED` e richiede un nuovo contratto versionato dopo la
patch.

### Registrazione della visita resta futura

La registrazione di una visita resta nel perimetro futuro di ADR 0072. Il
candidato non aggiunge cattura audio, permessi microfono, upload, raw audio,
trascrizione, diarizzazione, storage o sidecar audio.

Una futura bozza SOAP derivata da audio non potrà usare la trascrizione come
authority. Dovrà attraversare gli stessi confini di revisione e, per un
eventuale append, l'esatta eccezione di ADR 0103.

### Inventario di evidenze, non attestazione legale

Una superficie di compliance può elencare evidenze tecniche, limiti e owner.
L'inventario aiuta la revisione, ma non certifica conformità GDPR, AI Act,
FHIR, MDR o altra disciplina.

Applicabilità normativa, intended purpose finale, classificazione,
valutazione del rischio e decisioni organizzative appartengono agli owner
legali, privacy e clinici competenti. Il codice e i test non sostituiscono tali
valutazioni.

### Query planner semantico resta futuro e read-only

Un futuro query planner semantico dovrà comporre soltanto letture nominate e
allowlisted sopra Application Services host-owned. Ogni richiesta dovrà
dichiarare scope, limiti, budget, currentness e finalità. Il risultato dovrà
includere spiegazione del piano, audit PHI-safe e receipt.

Il planner non potrà emettere SQL, accedere direttamente a SQLite, inventare
authority, scegliere provider o trasformare una lettura in write. Query non
allowlisted, ambigue, troppo ampie o prive di budget dovranno negare in modo
fail-closed.

Il candidato 0.8.5 non implementa questo planner.

## Conseguenze

- Il Fabric può avanzare sui quattro percorsi senza diventare un'interfaccia
  agente generale.
- Il piano Headless resta misurabile senza gonfiare il numero di operazioni
  eseguibili.
- SOAP conserva un solo percorso di commit dimostrabile, senza creare authority
  per analogia.
- MCP, recording visita, compliance assessment e query planner richiedono
  decisioni e verifiche proprie.
- AnyDoc e i servizi generativi restano separati dai writer clinici.

## Verifica del confine

Il candidato deve dimostrare almeno:

1. quattro percorsi Fabric con route autenticate, production root host-owned,
   receipt/provenienza e zero write;
2. capability `ocr` senza entrypoint eseguibile;
3. 66 esiti Headless con zero operation grant generali;
4. integrazione SOAP H1-H10 limitata all'operazione nominata;
5. assenza di server/installer/onboarding MCP, audio runtime, query SQL
   agentiche, cloud ed egress;
6. separazione strutturale tra proposal e writer clinici.

Le verifiche usano soltanto fixture sintetiche. Una suite locale verde è
evidenza del tree esatto; non prova deployment, uso clinico, pubblicazione o
conformità legale.

## Regole di arresto

Fermare il packet se:

- un caller sceglie provider, modello, venue, prompt, fallback o apply;
- una receipt, proposta, trascrizione o selezione viene usata come authority;
- compare un'operazione Headless generale eseguibile senza contratto dedicato;
- un adapter MCP, planner o agente accede a SQLite o accetta SQL diretto;
- AnyDoc viene trattato come OCR o applica dati clinici;
- nel packet 0.8.5 la capability `ocr` riceve route, provider, venue, fallback
  o kill switch;
- una funzione futura viene descritta come disponibile nel candidato;
- un inventario tecnico viene presentato come certificazione o parere legale;
- compare cloud execution, egress o authority agentica generale.

## Claim ceiling

Il claim massimo è: **candidato sorgente locale 0.8.5 con quattro percorsi
Fabric review-only, AnyDoc deterministico, foundation Headless non eseguibile e
una sola append SOAP locale confermata dal medico con evidenza H1-H10**.

Il claim non include release readiness, tag, release, pubblicazione,
deployment, cloud, AI paired, MCP operativo, planner semantico, registrazione
visita, autonomia clinica, authority agentica generale, certificazione o
conformità legale.
