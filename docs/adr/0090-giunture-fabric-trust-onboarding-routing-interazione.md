# ADR 0090: giunture della fabric: trust paired, onboarding provider, routing osservabile e interazione clinica

Date: 2026-07-29
Status: Accepted

Issue: WUL-522 (fase "giunture cliniche e multipiattaforma")

Program line: post-0.8
Baseline: branch `codex/WUL-522-intelligence-fabric` a `e147951ed` (nucleo
fabric verificato `GO`; ADR 0089 accettato e non ridisegnato qui)

Related:
[ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md),
[ADR 0075](./0075-paired-account-operations-and-pin-rotation.md),
[ADR 0076](./0076-paired-document-domain-write-policy.md),
[ADR 0086](./0086-intelligent-scaffold-and-graded-automation-boundary.md),
[ADR 0087](./0087-registro-proposte-diagnostiche-documentali.md),
[ADR 0088](./0088-limite-digest-bound-readiness-ai-locale.md),
[ADR 0089](./0089-contratto-intelligence-fabric-e-venue-esecutive.md).

## Problema

Il nucleo fabric definisce capability, venue, profili egress e ricevute, ma
quattro giunture restano senza contratto esplicito:

1. il ciclo di vita del trust tra client paired e home-base (pairing,
   sessione, revoca, riconnessione) vive in piu moduli senza una derivazione
   unica e senza revoca host-side;
2. l'onboarding dei provider non distingue operativamente login consumer,
   abbonamento, API key, OAuth e modello locale;
3. il routing tra venue non e osservabile: offline, degradato e fallback
   negato non producono un record;
4. l'interazione clinica non ha un contratto unico per provenienza,
   incertezza, dati mancanti, lavoro pendente e revisione.

## Fatti verificati (ricognizione 2026-07-29)

| Area | Fatto | Evidenza |
| --- | --- | --- |
| Pairing | Intent `pending-home-base-confirmation` con TTL 10 minuti; conferma via local API token; emesso token 24 byte, persistito solo `tokenHash` SHA-256 in `settings['network.pairing.state']`; nessun campo di revoca o scadenza | `lib/network-pairing-model.ts`, `lib/network-contract.ts` |
| Data plane | Ordine gate: paired auth, poi modalita, capability, sessione operatore, scope; disattivare la modalita rende i token inerti senza revocarli (`403 NETWORK_MODE_DISABLED`) | `lib/network-write-context.ts`, `lib/network-contract.ts` |
| Discovery | `node`, `capabilities`, `ai-runtime` richiedono solo pairing o local token, senza sessione operatore | `lib/network-discovery-auth.ts` |
| Revoca | Nessuna route host di revoca; "Dissocia" pulisce solo il client; logout invalida solo la sessione; il cambio PIN non tocca pairing ne sessioni; il reset admin elimina utenti e sessioni ma non `network.pairing.state` | ricognizione R3 |
| Riconnessione | 401 identico per header mancanti, client sconosciuto e token errato; sessione scaduta produce 401 sul data plane; il client tratta 401 come sessione scaduta | `lib/network-discovery-auth.ts`, sorgenti Swift |
| Confidence | Scala `high/medium/low` con degradazione a `low` su valore assente o invalido; evidence triad `present/absent/unknown` preservata; classificazione documentale ha anche `blocked`; soglie numeriche 0.8 e 0.45 | `lib/ai-task-contracts.ts`, `lib/domain/documents/**` |
| Dati illeggibili | Web: decrypt fallita diventa `[LOCKED DATA]` non persistito; nativo: `lockedFields` distingue vuoto da illeggibile; esistono degradazioni silenziose a vuoto in percorsi secondari | `lib/db.ts`, `lib/security/security.ts`, ricognizione R4 |
| Lavoro pendente | `OpenLoop` (`results_pending`, `series_stalled`) con `sourceRef` e azione suggerita; coda OCR con stati persistiti; registro attese ADR 0082 assente | `lib/patient-open-loops.ts`, `lib/domain/documents/document-ocr-queue.ts` |
| Review | Tabella `document_diagnosis_proposals` (ADR 0087) presente con `status` default `pending` ma senza vocabolario ne transizioni; autofill resta `review_required` anche a confidence alta; treatment reasoning e review-only senza persistenza | `lib/schema.ts`, `drizzle/0024_*`, ricognizione R4 |

## Decisione

Quattro contratti di giuntura, ognuno con modulo dedicato, versionato e
fail-closed. Il nucleo ADR 0089 non viene ridisegnato.

### Giuntura 1: ciclo di vita del trust paired

Modulo `lib/network-pairing-lifecycle.ts`, schema
`mediflow.network.pairing-lifecycle.v1`.

- Derivazione pura dello stato di trust da input espliciti (client noto,
  token valido, modalita, capability, stato sessione, lockout), allineata
  all'ordine dei gate del data plane osservato.
- Il piano discovery e il piano dati sono derivazioni distinte: la discovery
  richiede solo pairing; il data plane richiede tutti i gate.
- Classificazione della riconnessione: `trusted`, `re_login_required`,
  `re_pairing_required`, `wait_mode_enabled`, `locked_out_wait`. Fail-closed:
  input incoerenti degradano a `re_pairing_required`, mai a `trusted`.
- Matrice degli effetti di revoca come dato congelato: logout, cambio PIN,
  disattivazione modalita, dissociazione client, reset admin, revoca host.
  La matrice registra anche cio che ogni evento NON invalida.
- Revoca host-side minima: rimozione del client dallo stato pairing
  (`removePairedClient`) e route dedicata sotto `/api/v1/network`, protetta
  dal local API token come la conferma. Dopo la revoca il token del client
  fallisce l'autenticazione paired (401), senza distruggere altri client.
- Zero grant ereditati: pairing, sessione operatore, capability e chiave
  master restano gate indipendenti; nessuna derivazione li unifica.

Falsificatori: uno stato `trusted` con sessione scaduta; una revoca che
lascia autenticare il token; una derivazione discovery che richieda la
sessione; una matrice che dichiari invalidato cio che il runtime non
invalida.

### Giuntura 2: onboarding provider e classi di credenziale

Modulo `lib/ai-providers/fabric/onboarding.ts`, schema
`mediflow.ai.provider-onboarding.v1`.

- Passi ordinati e fail-closed: `declared`, `configured`, `credentialed`,
  `attested`, `enabled`. Nessun passo implica il successivo; ogni transizione
  richiede un evento esplicito e valido.
- Matrice congelata delle classi di credenziale (ADR 0089): `local_model`
  senza credenziale ma con attestazione richiesta; `api_key` e `oauth` come
  grant API espliciti; `consumer_login` e `subscription` NON concedono accesso
  API e non possono superare `configured` per un uso API.
- Oggi solo `local_model` su Ollama loopback puo raggiungere `enabled`, con
  attestazione limitata a `available_unqualified` (ADR 0088: mai `verified`,
  `ready` o `qualified`). Ogni classe cloud si ferma prima di `enabled`
  finche il profilo egress resta insoddisfatto.
- La fabric non custodisce segreti: lo stato di onboarding referenzia la
  classe di credenziale, mai il valore.

Falsificatori: un `consumer_login` che raggiunge `enabled`; un provider
cloud `enabled` con gate egress chiuso; un'attestazione locale espressa come
`verified`; una transizione implicita di due passi.

### Giuntura 3: routing osservabile tra venue

Modulo `lib/ai-providers/fabric/routing-observability.ts`, schema
`mediflow.ai.routing-decision.v1`, piu route read-only
`/api/ai/fabric/observability`.

- Osservazione per venue: `available`, `degraded`, `offline`, `unknown`, con
  motivo enumerato (`target_invalid`, `daemon_unreachable`, `mode_disabled`,
  `egress_profile_closed`, `not_implemented`, `not_probed`). Nessun endpoint
  o credenziale nel payload.
- Record di decisione di routing congelato: richiesta, capability, venue
  richiesta, esito (`resolved` o `denied`), codice di negazione (i codici
  fabric piu `venue_offline` e `venue_degraded`), osservazioni al momento
  della decisione e ricevuta quando risolta.
- Fallback negato esplicito: ogni decisione porta
  `fallback: 'denied_by_contract'`. Una venue offline produce una negazione
  osservabile, mai un cambio di venue implicito.
- Il wrapper osservato e additivo: `resolveFabricCapability` resta invariato;
  il wrapper produce il record e non inghiotte errori.
- La route di osservabilita usa la stessa autenticazione di
  `/api/ai/models`; le sonde restano loopback-only e best-effort
  (l'irraggiungibilita del daemon e un'osservazione, non un errore della
  route).

Falsificatori: un cambio di venue dopo una negazione; un record senza
motivo per una venue offline; un payload con endpoint o segreti; una sonda
non loopback.

### Giuntura 4: contratto di interazione clinica

Modulo `lib/ai-providers/fabric/clinical-interaction.ts`, schema
`mediflow.ai.clinical-interaction.v1`.

- Incertezza esplicita a due dimensioni: livello (`high`, `medium`, `low`)
  e origine (`declared` o `degraded_default`). La degradazione per valore
  assente o invalido resta `low` ma deve dichiararsi `degraded_default`:
  una confidence degradata non e mai presentata come dichiarata (linea
  WUL-361).
- Completezza dell'input a tre stati: `present`, `absent`, `unreadable`.
  Un campo illeggibile (cifrato non decifrabile) non e mai piegato ad
  assente; la proposta elenca `unreadableFields` e `missingFields` separati.
- Lavoro pendente collegato: riferimenti compatibili con gli open loop e la
  coda OCR (`results_pending`, `series_stalled`, `ocr_pending`,
  `manual_review`), con `sourceRef` tipizzato.
- Vocabolario di revisione per le proposte (allineato alla tabella ADR 0087,
  default `pending`): `pending`, `clarification_requested`, `previewed`,
  `accepted`, `rejected`, `superseded`. Transizioni deny-by-default:
  `accept` e `reject` solo con attore `physician`; `supersede` solo
  `application`; l'accettazione richiede provenienza presente e
  riconoscimento esplicito dell'incertezza. Non esiste uno stato `applied`:
  la scrittura applicativa resta un comando successivo e separato
  (ADR 0086), e questo contratto non aggiunge writer, route o UI.
- Ogni proposta referenzia la provenienza fabric (ADR 0089) e non contiene
  contenuto clinico nei metadati di provenienza.

Falsificatori: una proposta accettata da attore `application`; una
confidence degradata presentata come dichiarata; un campo illeggibile
conteggiato come assente; una transizione doppia implicita; uno stato
`applied` nel vocabolario.

## DAG e ownership

| Packet | Lane | File di proprieta esclusiva |
| --- | --- | --- |
| P1 trust paired | Sol high, worktree `mediflow-if-f1-wt` | `lib/network-pairing-lifecycle.ts` + test; edit bounded a `lib/network-pairing-model.ts`; nuova route di revoca sotto `app/api/v1/network/` + test |
| P2 onboarding | Terra high, worktree `mediflow-if-f2-wt` | `lib/ai-providers/fabric/onboarding.ts` + test |
| P3 routing osservabile | Sol high, worktree `mediflow-if-f3-wt` | `lib/ai-providers/fabric/routing-observability.ts` + test; `app/api/ai/fabric/observability/route.ts` |
| P4 interazione clinica | Sol high, worktree `mediflow-if-f4-wt` | `lib/ai-providers/fabric/clinical-interaction.ts` + test |
| Integrazione e docs | manager (Fable) | run record, changelog, indici |
| Verifica terminale | lane fresca indipendente | worktree `mediflow-if-verify-wt` |

Un solo writer per file. Nessun file `native/` viene toccato: l'adozione
client delle giunture resta un packet successivo. Nessuna UI nuova in questa
fase.

## Non-obiettivi

- Nessun provider nuovo, credenziale reale, consenso o egress.
- Nessun writer, route o UI per le proposte ADR 0087 oltre il vocabolario.
- Nessuna modifica al nucleo ADR 0089 (resolver, cataloghi, status).
- Nessuna modifica ai client nativi o alla parity Apple.
- Nessuna promozione di lane o modelli (WUL-418 invariata; A3 invariato).

## Regole di arresto

Fermare un packet se: una derivazione di trust degrada aperta invece che
chiusa; una revoca lascia un percorso autenticabile; un onboarding salta un
passo; una negazione di routing cambia venue; una proposta clinica diventa
scrivibile senza attore medico; compare PHI/PII o un segreto in stato, record
o payload.

## First Thin Slice

1. Questo ADR e i quattro moduli contrattuali con test.
2. Revoca host-side minima con prova negativa post-revoca.
3. Route di osservabilita read-only.
4. Aggiornamento di run record, changelog e indici.
5. Verifica terminale indipendente sul risultato integrato.
