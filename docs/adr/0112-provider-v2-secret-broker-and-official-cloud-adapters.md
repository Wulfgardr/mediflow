# ADR 0112: provider v2, secret broker e adapter cloud ufficiali

Date: 2026-09-01
Status: Accepted

Issues: [GitHub #279](https://github.com/Wulfgardr/mediflow/issues/279),
[GitHub #324](https://github.com/Wulfgardr/mediflow/issues/324),
[GitHub #282](https://github.com/Wulfgardr/mediflow/issues/282) e
[GitHub #284](https://github.com/Wulfgardr/mediflow/issues/284).

Related: [ADR 0065](./0065-intended-purpose-and-claims-guard.md),
[ADR 0077](./0077-ai-provider-abstraction-and-egress-anonymization-boundary.md),
[ADR 0089](./0089-intelligence-fabric-provider-control-plane.md),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md) e
[ADR 0110](./0110-riapertura-governata-programma-intelligente-085.md).

## Stato osservato

Il tree di base `1452603ab6f3f53f25bc0788f7c09a8b024a4b59` possiede:

- adapter e registry operativi soltanto per Ollama loopback;
- onboarding, lifecycle, store e disclosure Fabric senza segreti;
- un egress gate deterministico che resta chiuso finche non esiste una lane di
  redazione promossa;
- righe informative OpenAI e Anthropic con esecuzione disabilitata;
- dipendenza OpenAI usata storicamente da un comparatore, non dal runtime di
  prodotto;
- nessun adapter Anthropic.

Questa base e riutilizzabile, ma non soddisfa il lifecycle richiesto da ADR
0110 e non prova autenticazione, trasporto o receipt cloud operativi.

## Problema

Un adapter cloud non puo ricevere direttamente una chiave dalle impostazioni o
dal chiamante clinico. Configurazione, possesso di una credenziale, idoneita
egress ed esecuzione riuscita sono fatti distinti. Senza una separazione
strutturale si rischiano segreti persistiti, provider scelto dal payload,
fallback invisibili e label di provenienza non dimostrate.

La prima slice deve rendere verificabile il trasporto ufficiale con dati
sintetici o non clinici, senza trasformare quel risultato in autorizzazione a
inviare PHI. La promozione clinica richiede separatamente egress, consenso,
retention e accordi applicabili.

## Decisione

Introduciamo un contratto provider v2 server-side, un secret broker a lease
effimero e due adapter HTTP ufficiali. Il cloud resta OFF per default, il
fallback e sempre `none` e il registry locale v1 continua a governare Ollama
finche ogni consumer non e migrato esplicitamente.

### 1. Contratto provider v2

Il contratto chiuso distingue:

- `providerId`: `ollama`, `openai` o `anthropic`;
- `kind`: `local` o `cloud`;
- `operation`: operazione Fabric nominata e host-owned;
- `model`: binding amministrativo allowlisted, mai campo libero del payload;
- `dataClass`: almeno `synthetic_nonclinical`, `redacted_clinical` o
  `clinical_identifiable`;
- `egressProfileRef`, `retentionProfileRef` e `consentRef` host-owned;
- timeout, massimo input/output e cancel signal bounded;
- `fallback: none`.

Il resolver riceve solo un operation handle emesso dall'host. Provider,
modello, endpoint, venue, data class e profili non sono autorita
caller-supplied. Oggetti con campi extra o getter non materializzabili una sola
volta falliscono chiusi.

Il packet #324 completa questo livello con il profilo
`mediflow.ai.provider-instance-profile.v2`. Il profilo separa:

- `providerType` dall'istanza configurata, identificata da un riferimento
  opaco `pvi_*`;
- il riferimento workspace `pws_*` e la policy auth con riferimento `par_*`;
- modello, capability dichiarate, gruppi e binding operation-to-group;
- function allowlist, che resta vuota nella prima slice text-only;
- venue, egress, residency, retention e data use, ciascuno dichiarato insieme
  al proprio riferimento di policy quando previsto.

I riferimenti instance, workspace e auth hanno forma opaca e bounded. Il
profilo non contiene endpoint, chiavi, token, cookie o altri valori di
credenziale. OpenAI e Anthropic accettano soltanto `api_key`; Ollama accetta
soltanto `local_model`. Le classi `provider_oauth` e `host_subscription`
restano distinte ma non sono una credenziale eseguibile per questi provider
nella prima slice.

Modello, capability, classe dato ed egress non vengono validati per forma o
namespace: devono corrispondere a una tupla host-owned exact-allowlist. La
prima slice ammette `document_synthesis` con `gpt-5.4-mini` per OpenAI,
`claude-sonnet-4-6` per Anthropic e `qwen3.5:35b-a3b` per Ollama; i due cloud
usano soltanto `egress.synthetic.v1` con dati sintetici non clinici, mentre
Ollama usa `egress.local.v1` sul dispositivo locale. URL anche senza schema,
nomi di segreto namespaced e riferimenti policy solo sintatticamente validi
restano negati.

Il link host-owned
`mediflow.ai.provider-instance-lifecycle-binding.v2` conserva invariata la
forma byte-exact del lifecycle per-operation. Riceve un solo profilo e un solo
lifecycle, entrambi strict, insieme all'`instanceRef` atteso dall'host. Pubblica
un link immutabile soltanto se instance, provider, modello, operation, venue,
data use, egress e retention coincidono.
Prima del parser lifecycle esistente, il linker valida root e binding nested
come record data-only exact-key e li copia in un valore plain; proxy e accessor
vengono negati senza eseguire trap o getter.
L'output nomina una sola instance, il gruppo dell'operation e la function
allowlist vuota. Il link non e una receipt di esecuzione, non abilita egress e
non autorizza una capability non dichiarata.

### 2. Secret reference e broker

La configurazione persistibile contiene soltanto:

```text
{ providerId, secretRef: { scheme: "env", name }, enabled: false }
```

Nella prima slice i soli nomi ammessi sono `OPENAI_API_KEY` e
`ANTHROPIC_API_KEY`. Non sono ammessi valore inline, path arbitrari, command
substitution, cookie, token consumer, OAuth di account personali o nomi env
scelti dal chiamante.

Il broker:

1. risolve il reference esclusivamente nel processo server locale;
2. valida presenza e forma minima senza registrare il valore;
3. consegna all'adapter una closure di header injection, non una stringa
   serializzabile;
4. mantiene una lease monouso con provider, operation, scadenza e generation;
5. azzera i riferimenti alla fine della request e nega riuso, mismatch,
   scadenza o revoca locale;
6. espone soltanto stato e denial code non sensibili.

La chiave non entra in database clinico, settings JSON, browser, backup,
export, log, exception, receipt, fixture o snapshot. Keychain macOS,
Credential Manager Windows e Secret Service Linux sono backend futuri del
medesimo broker; non vengono simulati dalla prima slice.

### 3. Lifecycle v2

Il lifecycle chiuso e monotono rispetto alla singola configurazione:

`absent -> configured -> validated -> enabled`

Da `enabled` sono ammessi `disabled` o `degraded`; da `degraded` sono ammessi
`enabled` o `disabled`. `revoked_local` e terminale per la generation
corrente. Una nuova configurazione crea una nuova generation e riparte da
`configured`.

- `configured` prova solo che il reference e valido;
- `validated` prova solo una validazione locale o un probe sintetico esplicito;
- `enabled` abilita la candidatura al resolver, non l'egress;
- `degraded` non attiva fallback;
- `revoked_local` elimina reference e lease locali, ma non dichiara revoca
  presso il vendor.

Il lifecycle v1 resta leggibile per i provider locali e non viene reinterpretato
come lifecycle v2.

### 4. Adapter OpenAI

L'adapter usa `POST https://api.openai.com/v1/responses` con header
`Authorization: Bearer <secret>`, content type JSON e identificazione SDK/app
non contenente dati clinici. La request usa il modello risolto, input bounded,
timeout/cancel e `store: false` quando supportato dall'endpoint.

`store: false` limita la persistenza applicativa dell'endpoint ma non viene
descritto come zero retention. Il profilo `zero_data_retention` puo essere
selezionato solo quando l'organizzazione o il progetto possiede evidenza
amministrativa esterna; MediFlow non lo deduce dalla risposta API.

Baseline ufficiali:
[quickstart OpenAI](https://developers.openai.com/api/docs/quickstart) e
[data controls OpenAI](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).

### 5. Adapter Anthropic

L'adapter usa `POST https://api.anthropic.com/v1/messages` con header
`x-api-key: <secret>`, `anthropic-version` pinnata, content type JSON, modello
risolto, input/output bounded e timeout/cancel.

Il workspace resta host-owned. Una API key scoped al singolo workspace puo
omettere `anthropic-workspace-id`; una key multi-workspace deve ricevere il
workspace ID vendor dalla authority server-side. In entrambi i casi una
risposta riuscita viene accettata solo se l'header di risposta
`anthropic-workspace-id` coincide con il workspace atteso. Il riferimento
opaco `pws_*` e il workspace ID vendor non entrano nel payload clinico o nella
receipt.

La prima slice supporta soltanto API key. Workload Identity Federation puo
essere aggiunta quando esiste una workload identity reale; non viene emulata
con login consumer. La retention viene dichiarata dal profilo operativo e non
dedotta dal solo successo HTTP.

Baseline ufficiali:
[autenticazione Anthropic](https://platform.claude.com/docs/en/manage-claude/authentication)
e [retention Anthropic](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention).

### 6. Egress e classi dati

La prima slice ammette esecuzione reale soltanto con
`synthetic_nonclinical`. Per ogni altra classe:

- `redacted_clinical` richiede egress gate promosso, consenso corrente,
  profilo retention eleggibile e receipt di redazione;
- `clinical_identifiable` resta `denied_by_contract` nella 0.8.5;
- assenza o mismatch di qualunque profilo nega prima di risolvere il segreto;
- nessun endpoint custom o proxy e ammesso per i provider cloud ufficiali.

L'operativita del trasporto con fixture sintetiche non prova idoneita clinica.
Questa separazione consente test e smoke ufficiali senza indebolire ADR 0077.

### 7. Receipt e disclosure

Solo una risposta 2xx validata produce una
`mediflow.ai.provider-operation-receipt.v2` con:

- operation reference opaco, provider e modello effettivi;
- venue `cloud`, endpoint class ufficiale e fallback count zero;
- data class, egress profile, retention profile e consent reference hash;
- request ID vendor se presente, conservato come valore non autorevole;
- latenza e conteggi token solo se osservati;
- hash del payload minimizzato e dell'output, mai testo o segreto;
- esito `complete` e timestamp host-owned.

Il label `powered by` deriva esclusivamente da questa receipt. Stato
configured, validated, enabled, health o model list non autorizzano il label.
Errori e denial producono un audit minimizzato separato e nessuna receipt di
successo.

## Error taxonomy

La superficie chiusa distingue almeno:

- `provider_disabled`, `secret_absent`, `secret_ref_invalid`;
- `egress_profile_unsatisfied`, `retention_profile_unsatisfied`,
  `consent_missing`, `data_class_forbidden`;
- `lease_expired`, `lease_revoked`, `provider_mismatch`;
- `request_timeout`, `request_cancelled`, `response_too_large`;
- `auth_rejected`, `rate_limited`, `provider_unavailable`,
  `response_invalid`.

I dettagli vendor restano log tecnici redatti e non attraversano il boundary
clinico. Nessun errore attiva un secondo provider o un modello diverso.

## Split di implementazione

1. **#289**: tipi v2 e lifecycle chiuso, tutti TDD e senza rete.
2. **#290**: secret reference allowlisted e broker a lease effimero.
3. **#288**: policy egress/retention/consent e receipt operation-derived.
4. **#324**: profilo instance/auth completo e link lifecycle host-owned,
   senza modificare il registry v1 o comporre un transport.
5. **#284**: adapter Responses OpenAI, parser, error mapping e optional smoke
   sintetico esplicito.
6. **#282**: adapter Messages Anthropic, parser, error mapping e optional smoke
   sintetico esplicito.
7. Migrazione di una sola operazione Fabric review-only dopo le tre receipt di
   contratto; nessun allargamento laterale dei quattro production root.

Ogni packet resta sotto un solo issue/branch/worktree. #279 coordina i tre
packet comuni; #289, #290 e #288 si chiudono in quest'ordine prima di far
partire #282 e #284 in parallelo.

## Matrice di verifica

| Confine | Prova minima |
| --- | --- |
| Secret broker | allowlist, absent, lease one-shot, expiry, revoke, mismatch, nessun leak |
| Lifecycle | tutte le transizioni lecite e denial delle transizioni inverse |
| Profilo instance | record exact-key, riferimenti opachi, duplicati e mismatch negati, auth disgiunta, function allowlist vuota |
| Link lifecycle | una sola instance e match esatto di provider, modello, operation e policy, senza cambiare il lifecycle byte-exact |
| Policy | synthetic PASS; clinical/redacted senza gate, consenso o retention DENY |
| OpenAI | URL/header/body/parser/errori con transport fake; header mai in snapshot |
| Anthropic | URL/header/version/body/parser/errori con transport fake; header mai in snapshot |
| Receipt | emessa solo dopo successo validato; provider/modello operation-derived |
| Runtime | smoke live opzionale con fixture sintetica e credenziale gia autorizzata |
| Regressione | Ollama e quattro path Fabric locali invariati |

## Conseguenze e stop rule

Il prodotto acquisisce un percorso ufficiale e testabile per i provider cloud,
ma resta local-first e clinicamente fail-closed. La prima dimostrazione live
puo attestare soltanto `SYNTHETIC_OFFICIAL_TRANSPORT_VERIFIED`.

Fermare la lane se compare un segreto serializzato, un endpoint cloud custom,
un provider o modello scelto dal payload, un retry non bounded, fallback,
logging di header/body, PHI nelle fixture, un claim zero-retention non provato,
una receipt prima della validazione della risposta o un allargamento del
registry locale senza migrazione esplicita.

Il completamento del solo packet #324 autorizza al massimo il claim
`PROVIDER_V2_INSTANCE_PROFILE_AND_STRICT_LIFECYCLE_LINK_VERIFIED__CLOUD_COMPOSITION_NOT_DELIVERED`.
Non prova trasporto live, egress clinico, smoke con credenziali, composition
Fabric o release readiness.
