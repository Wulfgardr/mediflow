# ADR 0110: riapertura governata del programma intelligente 0.8.5

Date: 2026-09-01
Status: Proposed

Issue: [GitHub #276](https://github.com/Wulfgardr/mediflow/issues/276) come
programma di integrazione; WUL-564 resta il verificatore finale. Ogni lane
riceve un issue e un worktree dedicati prima del runtime.

Program line: candidata `0.8.5`

Related: [ADR 0065](./0065-intended-purpose-and-claims-guard.md),
[ADR 0072](./0072-voice-visit-capture-fluid-boundary.md),
[ADR 0077](./0077-ai-provider-abstraction-and-egress-anonymization-boundary.md),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md),
[ADR 0097](./0097-active-role-session-and-step-up-authorization.md),
[ADR 0099](./0099-ocr-document-locator-and-source-currentness.md),
[ADR 0100](./0100-fabric-vs-headless-semantic-plane.md),
[ADR 0103](./0103-headless-clinician-authorized-soap-entry-write.md),
[ADR 0105](./0105-web-auth-process-integrity-assumption.md),
[ADR 0107](./0107-anydoc-local-attachment-extraction.md),
[ADR 0108](./0108-piano-canonico-headless-read-only-085.md) e
[ADR 0109](./0109-confini-programma-intelligence-fabric-headless-085.md).

## Problema

Il candidato locale verificato a `36fb33d105c80ce7627f13b1cdbb50abbab751e5`
aveva deliberatamente escluso dalla patch DeepSeek-OCR 2, OpenAI, Anthropic,
MCP, registrazione visita, planner semantico e operazioni agentiche generali.
Quella fotografia resta vera per quel tree, ma non descrive piu il requisito
di prodotto approvato per la `0.8.5`.

Integrare tutte le funzioni in un unico diff trasformerebbe una decisione di
perimetro in una mega-patch non revisionabile. Occorre riaprire il programma
senza riaprire implicitamente egress, authority clinica, storage audio o
accesso diretto ai dati.

## Decisione unica

La `0.8.5` include nuovamente, come programma governato da packet indipendenti:

- OCR selettivo locale con DeepSeek-OCR 2;
- esecuzione OpenAI e Anthropic tramite API e autenticazione ufficiali;
- MediFlow come capability di un host intelligente tramite MCP locale;
- runtime agentico governato con letture nominate e almeno una scrittura
  nominata oltre la SOAP;
- registrazione visita local-first con transcript e bozza reviewable;
- planner semantico read-only sopra Application Services allowlisted.

Questa decisione cambia il perimetro della patch, non lo stato di delivery.
Ogni lane parte da `NOT_STARTED`; una feature diventa `PASS` soltanto con
contratto accettato, runtime integrato, test sintetici sull'esatto tree e
receipt finale. Configurazione, discovery, compilazione o test isolati non
equivalgono a consegna.

## Precedenza puntuale e storia preservata

Questo ADR prevale soltanto sulle clausole incompatibili seguenti:

- ADR 0107: DeepSeek-OCR 2 non e piu escluso dalla patch. AnyDoc resta il
  percorso primario per testo estraibile; l'OCR e una nuova capability
  versionata e selettiva, non la riattivazione delle route legacy;
- ADR 0108: il piano `66/66` resta evidence, ma packet separati possono
  promuovere operazioni nominate sopra Application Services;
- ADR 0109: F6-B, F7-B, MCP, recording, planner e runtime agentico generale
  non sono piu `RELEASE_SCOPE_EXCLUDED`; entrano nel ledger con stato iniziale
  `NOT_STARTED` o `HOLD`.

Restano invariati local-first, cloud spento per default, zero fallback
silenzioso, separazione Fabric/authority, currentness host-owned, review
clinica, nessun accesso diretto a SQLite e nessuna PHI/PII reale nei test.
Le evidenze e i claim dei tree precedenti restano storici; non vengono
riscritti come ancestry o prova del candidato futuro.

ADR 0105 resta accettato per il boundary corrente. MCP, nuovi provider e nuovi
consumer ampliano il threat model: prima dell'integrazione finale un ADR
security separato deve confermare l'assunzione process-global oppure isolare
il boundary di authority. La sola equivalenza storica dei blob H1a/H1b non e
prova del tree finale.

## Invarianti per lane

### OCR selettivo

- AnyDoc decide deterministicamente se una pagina possiede testo utile; solo
  le pagine `needsOcr` possono raggiungere DeepSeek-OCR 2.
- Modello, codice e pesi restano locali e pin-by-digest. Nessuna inference API
  remota o `trust_remote_code` non revisionato appartiene al runtime.
- Ogni pagina conserva source ref, revision, freshness epoch, hash input,
  provider/model digest, qualità e motivo di ammissione.
- Ricomposizione incompleta, qualità sotto soglia, timeout o mismatch di
  currentness falliscono chiusi verso revisione manuale.
- La promozione richiede benchmark sintetico italiano, soglie dichiarate e
  misure bounded di tempo, memoria e dimensione.

La baseline upstream e il repository ufficiale
[DeepSeek-OCR-2](https://github.com/deepseek-ai/DeepSeek-OCR-2); licenza,
modello e codice importato devono essere verificati sul digest scelto.

### OpenAI e Anthropic

- Sono ammessi soltanto endpoint e metodi di autenticazione ufficiali.
  Login, cookie, token consumer e reverse engineering sono vietati.
- La prima slice host usa secret reference, mai il segreto nel database,
  payload, log, receipt, backup o client paired. Il lifecycle distingue
  `absent`, `configured`, `validated`, `enabled`, `disabled`, `degraded` e
  `revoked_local`; la revoca vendor resta un atto distinto e dichiarato.
- OpenAI usa un API key Bearer ufficiale; Anthropic usa API key ufficiale o
  Workload Identity Federation quando esiste una workload identity reale.
- Ogni invocazione richiede opt-in provider, profilo egress esplicito,
  data class ammessa, minimizzazione, retention dichiarata e fallback `none`.
- Il label `powered by` deriva solo dalla receipt dell'operazione riuscita e
  nomina provider e modello effettivi. Registry, configurazione e readiness
  non autorizzano quel label.
- Un account privo di controllo di retention adeguato resta configurabile ma
  non eleggibile per dati clinici. `store: false` non viene presentato come
  zero retention.

Le baseline normative sono il
[quickstart OpenAI](https://developers.openai.com/api/docs/quickstart), i
[data controls OpenAI](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint),
l'[autenticazione Anthropic](https://platform.claude.com/docs/en/manage-claude/authentication)
e la [retention Anthropic](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention).

### Intelligent Host, MCP e operazioni agentiche

- La prima slice usa MCP `stdio` locale. Non apre listener LAN/Internet e
  recupera la credenziale dal proprio ambiente, come previsto dalla
  specifica MCP per `stdio`.
- Il server MCP e un adapter sottile sopra AIP e Application Services. Non
  importa database, provider control, master key o business logic duplicata.
- Discovery e `tools/list` descrivono possibilita, non grant. Ogni call usa un
  owner figlio, lease, budget, scadenza, revoca e receipt host-owned.
- Le letture sono nominate, minimizzate e scope-bound. Il packet agentico deve
  consegnare almeno una scrittura non-SOAP a rischio limitato, con preview,
  conferma esplicita, expected revision, idempotenza e audit; nessuna
  authority viene riusata dalla SOAP.
- Prompt, chat, voce, provider output e assenso conversazionale non sono
  proof di scrittura.

La baseline protocollo e la
[specifica MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28);
per `stdio` e HTTP si applica il relativo
[contratto di autorizzazione](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

### Registrazione visita

- Start e stop sono espliciti, con permesso OS, indicatore persistente e
  recupero chiaro dopo denial o interruzione.
- L'audio grezzo e effimero per default e viene eliminato dopo la
  trascrizione o l'annullamento. Ogni persistenza richiede scelta separata,
  retention e cancellazione verificabile.
- Transcript, speaker labels e draft sono PHI. Se salvati usano storage
  cifrato, currentness e audit; non entrano in log, fixture o telemetria.
- Trascrizione on-device e il default. Qualunque trascrizione cloud richiede
  un futuro profilo egress specifico e non viene ereditata dai provider testo.
- Il risultato massimo e una bozza revisionabile. Un append attraversa un
  writer nominato e un nuovo proof; la trascrizione non e authority.

### Planner semantico

- Il planner produce soltanto piani read-only composti da operazioni nominate
  e allowlisted. Non produce SQL e non accede a SQLite.
- Il piano dichiara finalita, scope, limiti, budget, currentness, fonti,
  spiegazione e receipt. Ambiguita, ampiezza eccessiva o operazioni mancanti
  negano prima dell'esecuzione.
- Il modello puo proporre un piano, ma validazione ed esecuzione restano
  deterministiche e host-owned. Provider e venue non sono caller fields.

## DAG dei packet

| Packet | Owner boundary | Dipendenze | Stato iniziale | Gate terminale |
| --- | --- | --- | --- | --- |
| `P0` | ADR, threat model, issue e worktree split | nessuna | `IN_PROGRESS` | fonti canoniche e stop rule allineati |
| `F6` | DeepSeek-OCR 2 selettivo | `P0` | `NOT_STARTED` | benchmark + E2E page-level |
| `F7-C` | provider contract e secret broker | `P0` | `NOT_STARTED` | lifecycle e egress denial |
| `F7-O` | adapter OpenAI | `F7-C` | `NOT_STARTED` | smoke sintetico opt-in + receipt |
| `F7-A` | adapter Anthropic | `F7-C` | `NOT_STARTED` | smoke sintetico opt-in + receipt |
| `MCP` | server `stdio` e intelligent-host adapter | `P0` | `NOT_STARTED` | discovery/call/revoca senza DB diretto |
| `AG` | read/write agentici nominati | `MCP` | `NOT_STARTED` | denial + preview/confirm/CAS/audit |
| `QP` | planner semantico read-only | `MCP`, read `AG` | `NOT_STARTED` | allowlist + no-SQL + budget |
| `VC` | recording, transcript e draft | `P0` | `NOT_STARTED` | permessi, retention e review |
| `INT` | integrazione, security, Apple e release | tutti | `NOT_STARTED` | exact-SHA matrix e claim sync |

`F6`, `F7-C`, `MCP` e `VC` possono partire in parallelo dopo `P0`.
`F7-O` e `F7-A` possono partire in parallelo dopo il contratto comune.
Ogni packet usa un issue, branch `codex/<issue>-<slug>`, worktree dedicato e
un solo owner dei file; supera circa 300 LOC o un secondo boundary soltanto
dopo ulteriore split.

## Gate di pubblicazione

La pubblicazione `0.8.5` resta terminale e separata. Richiede:

1. integrazione su un SHA esatto senza modifiche estranee;
2. unit, typecheck, lint, build, E2E e guard canonici verdi;
3. test Apple nativi sull'esatto SHA e disclosure esplicita di ogni HOLD
   Windows/Linux non risolto;
4. security review del boundary completo, non del solo ultimo packet;
5. smoke provider soltanto con credenziali autorizzate e fixture sintetiche;
6. README, sito, stato, limitazioni, crosswalk e changelog coerenti con le
   sole evidenze ottenute;
7. tag, release e verifica server-side eseguiti come atti distinti.

## Stop rule e claim ceiling

Fermare la lane se compare egress implicito, fallback provider, segreto
persistito, audio trattenuto senza scelta, SQL diretto, accesso SQLite da un
adapter, authority caller-supplied, proof riusabile, auto-apply clinico,
PHI/PII reale nei test o un diff multi-boundary non splittato.

Fino al gate `INT`, il claim massimo e: **programma 0.8.5 riaperto e governato,
con feature ancora misurate per packet; nessuna nuova feature e release-ready
per effetto del solo ADR**.
