# ADR 0089: contratto Intelligence Fabric e venue esecutive

Date: 2026-07-29
Status: Accepted

Issue: WUL-522

Program line: post-0.8
Baseline: `v0.8.0` piu lo stack provider consolidato WUL-269/418/502

Related:
[ADR 0077](./0077-ai-provider-abstraction-and-egress-anonymization-boundary.md),
[ADR 0086](./0086-intelligent-scaffold-and-graded-automation-boundary.md),
[ADR 0088](./0088-limite-digest-bound-readiness-ai-locale.md),
[Audit OpenMinis](../analysis/2026-07-26-openminis-intelligent-scaffold-audit.md) e
[Matrice serving](../ai-runtime-serving-matrix.md).

## Problema

ADR 0088 richiede un ADR distinto che definisca il contratto Intelligence
Fabric. Dopo il consolidamento dello stack provider post-0.8 esistono:

- un registry locale per task generativi, limitato a Ollama loopback;
- un gate egress deterministico sempre chiuso;
- una matrice serving che separa stato operativo e readiness;
- undici pipeline deterministiche in-house senza registrazione comune;
- quattro superfici (web, macOS, iPhone, iPad) che leggono stato intelligente
  con contratti diversi e senza una nozione condivisa di venue.

Manca il livello che unifichi capability generative e deterministiche sotto un
solo modello di routing, venue, egress e provenienza. Senza questo livello ogni
nuova integrazione ridefinisce i confini da zero e i client non possono
descrivere in modo onesto dove avviene il calcolo.

La sezione "Policy di esecuzione e ricevuta del resolver" elaborata in
WUL-499 e le correzioni P2 dell'audit OpenMinis non sono mai confluite in un
contratto normativo sul ramo consolidato. Questo ADR le assorbe; l'ADR 0086
accettato resta invariato.

## Quadro decisionale

- **Esito:** adottare un contratto fabric a tre superfici: descrittori di
  capability, policy di esecuzione immutabile, ricevuta di risoluzione con
  venue e profilo egress versionato.
- **Ambito:** contratto piu scaffold locale (tipi, catalogo, resolver
  fail-closed, route di stato read-only). Nessun provider nuovo, nessun
  egress, nessuna promozione di modelli.
- **Orizzonte:** programma post-0.8; i packet cloud, broker credenziali e UX
  di consenso restano separati.
- **Vincoli:** local-first, fixture sintetiche, review-first, provenienza
  obbligatoria, fail-closed su policy, identita, sessione e connettivita.
- **Stop immediato:** egress implicito, fallback silenzioso, capability
  dedotta dal nome del modello, scrittura clinica autonoma.

## Fatti verificati sulla baseline consolidata

| Area | Stato | Evidenza |
| --- | --- | --- |
| Registry generativo | `LocalProviderRegistry.resolve` accetta solo Ollama loopback, fallback `none`, receipt `mediflow.ai.provider-selection.v1` | `lib/ai-providers/registry.ts` |
| Gate egress | `isEgressGateOpen()` restituisce sempre `false`; layer 1 deterministico con audit hash-only | `lib/ai-egress-gate.ts`, `lib/ai-egress-audit.ts` |
| Capability deterministiche | Undici moduli in-house con test dedicati; il registro attese persistente di ADR 0082 non ha runtime | Inventario run WUL-522 |
| Superfici | Web usa `requireSession()`/`requireSessionOrLocalToken()`; i client paired leggono `aiSummary` e `documentInsights` da `/api/v1/network/patients`; nessun adapter provider in `native/` | Route `app/api/ai/*`, `HomeBasePatientsClient.swift` |
| Readiness | A3 resta `observed_not_causal`; qualified readiness `HOLD`; annotazione `available_unqualified` | ADR 0088 |

## Decisione

### 1. Capability come unita di routing

Ogni funzione intelligente e una capability dichiarata con identificatore
stabile, classe (`generative` o `deterministic`), operazione, classe dati,
policy di review, kill switch collegato quando esiste e schema di contratto
versionato quando esiste. Il routing avviene per capability, mai per brand del
provider. Le capability generative riusano gli identificatori delle lane
esistenti; le deterministiche registrano le pipeline in-house gia presenti.

### 2. Venue esplicite

Ogni risoluzione dichiara la venue effettiva:

- `local_process`: processo host localhost, incluso il daemon loopback;
- `home_base`: nodo host che esegue per conto di un client paired;
- `on_device`: esecuzione locale del client; oggi nessuna capability la
  dichiara (Foundation Models resta `hold`);
- `cloud`: provider remoto esplicitamente autorizzato; oggi nessuna capability
  la dichiara.

L'assenza di `on_device` e `cloud` descrive lo stato corrente, non un vincolo
permanente: la loro apertura richiede ADR dedicati (ADR 0088).

### 3. Profili egress versionati

L'egress e descritto solo da profili versionati
(`mediflow.ai.egress-profile.v1`):

- `local_only`: egress `none`, nessun requisito; profilo di default di ogni
  capability;
- `cloud_authorized_redacted`: richiede lane redaction promossa, consenso
  esplicito, retention dichiarata e provider autorizzato. Oggi nessun runtime
  soddisfa questi requisiti: il profilo e chiuso per costruzione e
  `isEgressGateOpen()` resta l'autorita runtime.

Un profilo non soddisfatto produce un errore fail-closed, mai un degrado. Il
passaggio di profilo non e mai implicito e non avviene mai dopo anteprima o
autorizzazione.

### 4. Policy di esecuzione immutabile e ricevuta

La lane applicativa costruisce una policy immutabile prima della risoluzione:
identificatore richiesta, capability, piano di autorita, operazione, classe
dati, venue ammesse, profilo egress, riferimento al consenso quando richiesto,
retention, review, provenienza obbligatoria e fallback `none`.

Il resolver fallisce prima dell'inferenza se capability, classe, venue o
profilo non sono compatibili. La ricevuta di risoluzione riporta capability,
classe, venue effettiva, profilo egress con versione, provider effettivo
(`in_house` per le pipeline deterministiche), modello quando esiste e la
ricevuta del registry provider per le capability generative con binding
registry. Le lane generative autogestite fuori dal registry (oggi il
treatment reasoning su runtime MLX, provider `athena_mlx`) dichiarano il
provider effettivo nella ricevuta fabric senza ricevuta registry e senza
modello statico: il modello resta risolto dalla lane. La ricevuta non
autorizza alcun consumer e non contiene endpoint, prompt, credenziali o dati
clinici.

### 5. Classi di credenziale dichiarative

Il contratto distingue `local_model`, `consumer_login`, `subscription`,
`api_key` e `oauth`. Nessuna classe implica un'altra: un login consumer non e
un grant API e un abbonamento non e una credenziale clinica. La fabric non
custodisce segreti; il broker credenziali resta un packet separato.

### 6. Superfici e piani di autorita

- Web localhost: consuma la fabric nel processo host; la route di stato
  read-only usa `requireSessionOrLocalToken()` come `/api/ai/models`.
- macOS home-base: stesso processo host; la superficie host-admin puo leggere
  lo stato fabric per diagnostica.
- iPhone e iPad: restano client paired senza adapter provider e senza grant
  ereditati; leggono proiezioni gia prodotte dall'home-base. L'esposizione
  dello stato fabric sul data plane `network` e un packet successivo.
- `engineering_operator` resta fuori dalla fabric clinica: piani, credenziali
  e grant disgiunti (ADR 0086, ADR 0088).

### 7. Provenienza

Ogni output di capability puo allegare un record di provenienza con
capability, venue, provider, modello e nomi dei passi di preprocessing, senza
contenuto clinico. Le superfici che mostrano output intelligente devono poter
risalire a provider, preprocessing e venue.

## Conseguenze

- Il routing per capability rende il brand del provider un dettaglio di
  binding, come richiesto da ADR 0077.
- Le pipeline deterministiche diventano visibili nello stesso contratto delle
  lane generative, senza cambiare il loro comportamento.
- I client possono descrivere onestamente dove avviene il calcolo.
- Il percorso cloud resta visibile e chiuso: esiste come profilo, fallisce
  come runtime.
- La superficie settings futura potra leggere uno stato unico invece di
  ricostruirlo da chiavi sparse.

## Non-obiettivi

Questo ADR non:

- aggiunge provider, modelli, consensi o credenziali;
- apre egress o modifica il gate esistente;
- promuove lane oltre la matrice WUL-418;
- modifica i client nativi o il data plane `network`;
- implementa il registro attese persistente di ADR 0082;
- cambia il finding A3, che resta `observed_not_causal`.

## Regole di arresto

Fermare un packet fabric se:

- una risoluzione degrada invece di fallire;
- una ricevuta o un tipo vengono usati come autorizzazione;
- una capability viene dedotta dal nome del modello;
- un profilo egress viene cambiato senza atto esplicito;
- un client paired riceve un grant provider o una credenziale;
- compare PHI/PII reale in fixture, log o ricevute.

## First Thin Slice

1. Contratto congelato in `lib/ai-providers/fabric/contract.ts`.
2. Catalogo capability (generative e deterministiche) con test.
3. Resolver fail-closed che riusa `LocalProviderRegistry` per le generative.
4. Route di stato read-only `/api/ai/fabric/status`.
5. Aggiornamento di matrice serving, stato di sistema e run record.
