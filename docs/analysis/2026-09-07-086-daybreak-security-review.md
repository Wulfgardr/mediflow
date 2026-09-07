# MediFlow 0.8.6: review di sicurezza Daybreak

Aggiornamento: 7 settembre 2026. Programma WUL-669.

**7 settembre 2026 — correzioni sorgente verificate; CI e pubblicazione pendenti.**
Il blocco contrattuale PIN è chiuso a livello sorgente dall'addendum indipendente
`SOURCE_REVIEW_PASS` su `cefa5c78f43ada28e9d74f2d65e5f2173b15edb8`.
Il finding LOW `csf_e6ea8156c1fde74d61ebf750`, emerso nel primo addendum JSON,
ha esito `FIX_VERIFIED` su `be9233282c0ab18759b0e679b877d9dc30af5a99`.
I due file PIN e i sette file della correzione allegati sono identici nel
candidato integrato `11a42f68effbdc11cd6371bf050a6e2e074de5b3`.
Non restano finding reportabili nel sorgente revisionato; questo non certifica
la sicurezza generale. Il rilascio del pacchetto sorgente è autorizzato ma
attende CI verde. CI finale, PR, merge e tag non sono ancora attestati.

[Verifiche, SHA, ricevute e limiti](./2026-09-07-086-release-verification.md).

## Fotografia storica precedente alle correzioni

Le sintesi seguenti descrivono `1d633d98d0a0`: i blocchi e le azioni allora
aperti sono superati dalle disposizioni sopra. Il report inglese resta intatto.

## Sintesi dei sei ambiti

La review Daybreak (`gpt-daybreak-blue-latest`, ragionamento `xhigh`) esamina
il diff da `b72ac713b624e7d771262e4e01c5c5e1f56f9ae2` a
`1d633d98d0a093623c8c4f488815af804c769a6e` e il codice di supporto
raggiungibile. La ricevuta registra **298 elementi esaminati e chiusi su 298**.
Si tratta della copertura dell'inventario del diff, non di una verifica
esaustiva del prodotto o di 298 test eseguiti.

| Ambito | Esito e confine |
| --- | --- |
| A. Autenticazione, sessioni e PIN | Difetto contrattuale deterministico: dopo il successo o una risposta non osservabile al cambio PIN, il client conserva autorità e presentazione locali. Il modello di minaccia esclude l'abuso dimostrato, limitato allo stesso utente o all'accesso fisico mirato con app sbloccata. Zero vulnerabilità reportabili; blocco di promozione aperto. |
| B. Autorizzazione e isolamento dei dati | Nessun problema rilevato nel perimetro: pairing e sessione operatore distinti, appartenenza del paziente, ambulatorio e controlli di versione. Non attesta un modello multiutente con controllo completo dei ruoli. |
| C. Privacy asincrona nativa | Controllati generazioni, richieste, contesto e pulizia della presentazione. Il difetto PIN resta nell'ambito A; nessun ulteriore percorso di attacco nel perimetro. |
| D. Cifratura, Keychain, cache e backup | Esaminati cifratura dei campi, cache AES-GCM vincolata al contesto e ripristino amministrativo transazionale. ThisDeviceOnly è esplicito per il nuovo inserimento della chiave cache, non per il token paired. Firma ed entitlements di produzione non attestati. |
| E. Documenti, estrazione e comunicazioni esterne | Esaminati autorità delle fonti, attualità dei dati, limiti dei processi locali e destinazioni WHO/provider esplicite. Nessuna esecuzione con servizi o provider live. |
| F. Agenti headless e processi | Esaminati ambiente consentito dei figli, avvio e RPC su IPC ereditato, limiti e revoca. Nessun problema rilevato nel perimetro. |

## Verifiche e limiti

La ricevuta della review registra **13 test Node PASS**, senza dipendenze,
con il comando:

```bash
node --test scripts/check-who-local-sidecar-manifest.test.mjs scripts/mobile-home-base-interop.test.mjs scripts/admin-route-auth-boundary.test.mjs
```

Questi esiti provengono dalla review originale; la preparazione di questa
pagina non riesegue i test. I test mirati TypeScript e il controllo statico
AnyDoc non sono partiti per la dipendenza `typescript` assente. I test Swift
non sono stati eseguiti: volumi Xcode e simulatori erano esclusi dall'incarico.
La conclusione sul PIN deriva dal sorgente e dall'intento dei test esistenti,
non da una nuova esecuzione del ciclo di vita Apple.

La review non usa VM, servizi live, provider autenticati, traffico di rete,
dati clinici reali o segreti. Non comprende una revisione indipendente con
subagenti. La verifica della UI mobile con host reale resta differita al
post-release secondo il [verbale integrato](./2026-09-06-086-integrated-closeout.md).
Non è attestata una validazione completa multipiattaforma; nessun installer
firmato di produzione è attestato da queste prove.

## Esito dell'approfondimento sulle tre domande

L'approfondimento del 7 settembre 2026 riguarda lo stesso SHA della review.
È una lettura statica del sorgente; non aggiunge test, build, esecuzioni del
pacchetto o verifiche del Keychain reale. Le domande originali restano nel
report completo come fotografia della review; le disposizioni successive sono:

| Tema | Evidenza e disposizione |
| --- | --- |
| Limiti del corpo delle richieste | Il proxy fornito inoltra il corpo senza un limite di byte esplicito. È una lacuna attuale di hardening, assegnata a un'attività separata, non un non-goal. Non sono dimostrati impatto runtime, sfruttabilità o bypass dell'autenticazione; non è attestata la correzione. |
| Firma, entitlements e Keychain | Il pacchetto sorgente, senza artefatto finale firmato e con Xcode non disponibile, non attesta la policy effettiva di produzione. Manca una prova di distribuzione, non è dimostrato un difetto di isolamento. |
| Appartenenza operatore–ambulatorio | È un non-goal del modello attuale secondo [ADR 0036](../adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md). Non richiede l'introduzione di RBAC nella 0.8.6. Un futuro isolamento per operatore richiede una scelta prodotto e un contratto dedicato. |

Nel sorgente, `HomeBasePatientCacheStore` imposta
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` quando inserisce una nuova
chiave cache. La lettura di un item preesistente non ne attesta né migra gli
attributi. `HomeBasePairedStore` non imposta esplicitamente quell'attributo
nell'inserimento o aggiornamento del token paired. **Non attribuire
ThisDeviceOnly al token paired.** Questa differenza non dimostra che altri
processi possano leggere il token; l'enforcement del sistema operativo non è
stato provato. La frase sulla cache nel report originale va letta con questi
limiti, non come attestazione di tutti gli item o della firma di produzione.

Il controllo paziente–ambulatorio resta distinto da una membership per
operatore: pairing, sessione, capability e appartenenza del paziente devono
restare verificati anche senza RBAC completo. Per questo limite prevale
ADR 0036; i riferimenti ad `ARCHITECTURE.md` nel report descrivono il confine
non multi-tenant, senza attestare una segregazione multioperatore.

La lane di hardening e il coordinatore devono fornire prove delle rispettive
correzioni; **il blocco PIN resta aperto**. La review non certifica sicurezza
generale, conformità normativa, installabilità o rilascio.

## Provenienza e trasformazioni editoriali

Segue il **report completo in inglese, in forma derivata leggibile e
sanitizzata**. Non è una copia byte per byte dell'originale né una nuova
review. Sono conservati perimetro, modello di minaccia, ipotesi, esiti,
esclusioni e domande aperte.

- Ripristinati titoli, elenchi e tabelle del modello di minaccia, che
  nell'originale occupava una sola riga; adattata la gerarchia dei titoli.
- Corretto il riferimento a `HomeBasePatientCacheStore.swift` secondo la
  nota della ricevuta: il file è in `MediFlowAppleShared`, non nella sua
  sottodirectory `AppleFoundation`. L’approfondimento ha verificato la stessa
  correzione per `HomeBasePairedStore.swift`, applicata anche qui. Il contenuto
  della valutazione originale non cambia.
- I JSON originali restano fonti di provenienza e non sono copiati nella
  pagina: sono esclusi percorsi locali, metadati operativi privati e consumi.
  I riferimenti al codice nel report sono percorsi della repository sullo SHA
  esaminato; i numeri di riga non descrivono revisioni successive.
- Il sorgente richiesto `lib/security/server-session-selection-owner.ts`
  non esiste sullo SHA esaminato; la review dichiara l'implementazione nel
  pacchetto e il test omonimo. Questo limite resta esplicito nel report.

Ricevuta completata il `2026-09-07T08:24:28.493473Z`.
SHA Git originale: `1d633d98d0a093623c8c4f488815af804c769a6e`.
Gli hash SHA-256 seguenti identificano i file originali, non questa pagina.
Gli hash di report e copertura sono ricalcolati e confrontati con la ricevuta;
gli hash della ricevuta e dell'approfondimento sono ricalcolati per identificarli,
senza un'attestazione indipendente del loro contenuto. Dell'approfondimento
sono riportati soltanto gli esiti sanitizzati, non i percorsi locali.

| Fonte originale | SHA-256 |
| --- | --- |
| `report.md` | `06cb6382e198a9fa3f112fa73caa77aff8e6bf36e3687288db0edc13417667df` |
| `coverage.json` | `dfce2a0165f1f0a478ec094cd8ed12d26a0fdfd8904a3a5a2b061b35a7218f60` |
| `review-receipt.json` | `49882c572a1c6fe19d4a8659b713ebef39b36cd4f08c27328e87d97c1fadd7a1` |
| Approfondimento `daybreak-open-questions.md` | `1e44a962b1c5c3220cdd909c6047a2889648a915f3a67b832d24341ceb0dcad9` |

Nel report, “Coverage: complete” riguarda soltanto l’inventario dichiarato;
“Rejected” nell’ambito A riguarda la reportabilità, non la validità del difetto
contrattuale. I riferimenti agli artifact canonici descrivono le fonti originali,
non allegati pubblicati con questa pagina.

## Security Review: medical-record-app

### Scope

Read-only diff security review of MediFlow 0.8.6 at 1d633d98d0a093623c8c4f488815af804c769a6e against b72ac713b624e7d771262e4e01c5c5e1f56f9ae2. All 298 workbench review items were closed across the six requested boundaries and directly reachable supporting code. Promotion is blocked: no vulnerability survived the in-scope attacker policy, but the native PIN-change client intentionally violates the mandatory ADR 0106 local-authority retirement contract.

- Scan mode: branch_diff
- Target kind: git_diff
- Target ID: target_sha256_228499a8e94f976f6bdfa379f0015f4c30d66759004cbe831174dcbadf79c485
- Revision range: b72ac713b624e7d771262e4e01c5c5e1f56f9ae2...1d633d98d0a093623c8c4f488815af804c769a6e
- Snapshot digest: codex-security-snapshot/v1:sha256:4caab8f585d4f080fbb4d3807aad659b2316a9f5dca0d0364f60b16e57987785
- Inventory strategy: diff
- Included paths: .
- Excluded paths: none
- Runtime or test status: 13 dependency-free Node tests passed. TypeScript-based targeted tests and the AnyDoc static test could not start because this worktree has no installed typescript package. Swift tests were not run under the explicit prohibition on Xcode volumes and simulators.
- Artifacts reviewed: AGENTS.md, SECURITY.md, ARCHITECTURE.md, CONTRIBUTING.md, docs/adr/0106-web-auth-logout-pin-setup-lifecycle.md, app/api/auth/change-pin/route.ts, lib/security/pin-change-service.ts, native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift, native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePatientsClient.swift, native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePatientCacheStore.swift, lib/domain/documents, lib/headless, lib/reference-data, scripts/mobile-home-base-interop.mjs
- Scan context: Frozen branch codex/WUL-669-086-daybreak-security-review. Model gpt-daybreak-blue-latest with xhigh reasoning. Threat model generated for this scan from repository sources. No repository mutation or external action.

Limitations and exclusions:
- No VM, Xcode volume, simulator, live service, network provider, production signing/entitlements check, or real data was used.
- No independent subagent review was used by explicit request; the parent reviewed the complete worklist.
- The requested source path lib/security/server-session-selection-owner.ts does not exist at this revision; related implementation is package-backed and lib/security/server-session-selection-owner.test.ts exists.
- Dynamic Apple lifecycle behavior remains unexecuted; the PIN lifecycle conclusion is based on deterministic source and existing test intent.
- Excluded runtime/xcode-vm-simulator-services: Explicit user constraint: no VM, Xcode volume, simulator or live service execution.
- Excluded runtime/real-data-secrets-egress: Explicit user constraint: no real clinical data, secrets, authenticated providers or network egress.
- Excluded delivery/push-pr-merge-release: Explicit user constraint: no push, pull request, merge, tag, release or tracker mutation.

#### Scan Summary

| Field | Value |
| --- | --- |
| Scan outcome | completed |
| Reportable findings | 0 |
| Severity mix | none |
| Confidence mix | none |
| Coverage | complete |
| Validation mode | Static source/control/sink tracing plus bounded dependency-free Node tests; no service or Apple runtime execution. |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

### Threat Model

#### MediFlow 0.8.6 candidate threat model

This model is specific to commit `1d633d98d0a093623c8c4f488815af804c769a6e` and the requested six review areas. It is an architecture and hypothesis map, not a vulnerability list.

##### Summary

MediFlow is a local-first territorial clinical record. A Next.js process owns the Web UI, local APIs, application services, and a single authoritative SQLite database. Browser callers use server sessions; Apple clients connect through a local HTTPS proxy with certificate pinning and require both a paired-device credential and a native operator session for the network clinical plane (`ARCHITECTURE.md:34-64`, `SECURITY.md:91-118`). Sensitive clinical fields are encrypted by the browser or native client before storage; identifiers, metadata, and the complete SQLite/backup artifacts are not claimed to be wholly encrypted (`SECURITY.md:47-69`, `ARCHITECTURE.md:80-95`). The native Apple client keeps the unwrapped master key only in process memory and can maintain an encrypted, context-bound local patient cache for offline read-only presentation. Attachment extraction obtains current host-owned bytes through a Web-session projection owner, runs a fixed local AnyDoc child process, optionally renders bounded PDF pages and invokes Apple Vision, and publishes review-only evidence only after rechecking selection and source currentness (`lib/domain/documents/attachment-extraction-source-authority.ts:118-181`, `lib/domain/documents/anydoc-current-source-composition.ts:92-116`). The WHO ICD-11 adapter is server-only, uses fixed release/language/limits, and permits egress only in an explicitly enabled runtime state (`lib/reference-data/icd11-who-service.ts:4-10`, `lib/reference-data/icd11-who-service.ts:200-242`). The production headless mode uses a trusted Supervisor as parent of distinct Web and MCP processes. Child environments are replacement allowlists, communication uses inherited private IPC, and the host grants bounded patient/ambulatory-scoped read or proposal-only operations (`lib/security/portable-supervisor-child-processes.ts:79-125`, `lib/headless/authenticated-agent-launcher.ts:134-163`, `lib/headless/authenticated-agent-launcher.ts:215-232`).

##### Assets

- Clinical plaintext, ciphertext, attachment bytes, document-derived artifacts, diagnoses, notes, and patient membership.
- Operator identity, paired-device token, Web/native session bearers, PIN-derived KEK, unwrapped master key, provider/WHO secret references, and one-use capability handles.
- Ambulatory and patient selection integrity, version/currentness values, native async generation fences, and denial after logout, lock, PIN change, reselection, expiry, or restart.
- SQLite and backup integrity, encrypted-cache confidentiality and context binding, Keychain access controls, and evidence/audit receipts.
- Process isolation: the MCP/agent child must not inherit browser cookies, database handles, local bearer tokens, master keys, PINs, or provider credentials.
- External-communication policy: default local-only, fixed/allowlisted destinations, explicit operator activation, bounded inputs/outputs, and no silent clinical apply.

##### Trust boundaries

| Boundary | Transfer and expected control | Evidence |
| --- | --- | --- |
| Browser -\> Web API | Untrusted HTTP body, origin, and cookie cross into a server-session boundary. Sensitive and administrative routes must authenticate; destructive Web mutations additionally bind trusted origin/intent. | `SECURITY.md:91-113`; `lib/security/server-auth.ts:315-364` |
| Paired Apple client -\> TLS proxy -\> network API | Untrusted LAN traffic crosses TLS pinning; clinical operations require a valid paired credential plus exact current native operator session. Pairing alone is not operator authority. | `SECURITY.md:120-147`; `docs/adr/0038-network-readonly-data-plane-auth-boundary.md:61-84` |
| Operator PIN -\> credential CAS/session retirement | PIN verification and wrapped-key replacement cross from client to host. On success all same-user Web and current native authority must terminate; the client must synchronously discard local presentation authority. | `docs/adr/0106-web-auth-logout-pin-setup-lifecycle.md:65-121`; `lib/security/pin-change-service.ts:211-232` |
| Server ciphertext -\> Apple plaintext | Host forwards `ENC:` values opaquely; the Apple process decrypts with an in-memory master key. Failed decryptions must not turn presentation placeholders into writes. | `SECURITY.md:61-69`; `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PatientFieldCrypto.swift:1-119` |
| Apple process -\> Keychain/encrypted cache | Paired token and cache key enter Keychain; encrypted cache contents are bound to server, scope, TLS pin, paired identity, operator, and session digest, and expire within a bounded TTL. | `native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePairedStore.swift:95-176`; `native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePatientCacheStore.swift:14-94` |
| Attachment selector -\> host bytes -\> parser children | Caller supplies only an attachment identifier. Host resolves unique active patient membership/currentness, caps source bytes, pins worker paths/hashes, limits output/time, and revalidates before publication. | `lib/domain/documents/attachment-extraction-selection-binding.ts:67-117`; `lib/domain/documents/attachment-extraction-source-authority.ts:84-170`; `lib/domain/documents/anydoc-local-extraction-runner.ts:18-29`, `lib/domain/documents/anydoc-local-extraction-runner.ts:94-175` |
| Web process -\> Supervisor/MCP child | Host sends an opaque one-use bootstrap and authenticated bounded RPC over inherited IPC. Child environment is replaced, not inherited; cleanup revokes scopes, owners, RPC, and terminates the child. | `lib/security/portable-supervisor-child-processes.ts:94-125`; `lib/headless/authenticated-agent-launcher.ts:143-163`; `lib/headless/authenticated-agent-launcher.ts:181-200` |
| Server -\> WHO/cloud provider | Only host-owned fixed targets and explicit egress/credential state may produce external requests. Raw secrets stay inside a one-use broker injection callback and must not enter DB, browser, audit, or child environment. | `lib/reference-data/icd11-who-service.ts:200-242`; `lib/ai-providers/v2/provider-secret-broker.ts:89-147`; `SECURITY.md:182-217` |
| Admin Web session -\> backup restore | A complete backup artifact crosses into preflight/transactional replacement. Authentication, admin role, trusted mutation request, exact artifact validation, and atomic restore are the expected controls. | `app/api/system/backup-restore/route.ts:155-213`; `lib/backup-preflight.ts:1-81`; `lib/backup-restore-executor.ts:71-174` |

##### Attacker capabilities

- A nearby LAN caller may send arbitrary, malformed, repeated, chunked, or oversized requests to a node intentionally placed in `network-home-base`; that caller does not initially possess a confirmed pairing token or operator PIN/session.
- A paired but unauthenticated device may possess its own paired token; it must not gain operator or clinical authority without a fresh native login.
- A current paired operator may control ordinary route payloads, IDs, ambulatory hints, timing, cancellation, and concurrent requests. They do not initially control server-owned currentness, version, selection epochs, provider choice, or another operator's session.
- A local unprivileged process may connect to exposed local listeners or attempt to impersonate a supervised child. It does not initially control the Supervisor's inherited IPC channel, bootstrap, process identity, or Web process memory.
- A malicious attachment, PDF, WHO response, model response, or MCP frame may control parser input and structure but not host-owned executable paths, hashes, destination policy, or clinical apply.
- A filesystem attacker may copy SQLite, backup, cache, or settings artifacts, but is not assumed to own the unlocked OS account, Keychain, active process memory, or operator PIN. A fully compromised host and targeted memory/keylogging attacks are excluded by policy (`SECURITY.md:29-44`).

##### Security objectives

1. Separate device pairing, operator authentication, Web/native session authority, local API bearer authority, and admin authority; reject substitution or widening between them.
2. Bind every clinical read/write to the exact active ambulatory, patient membership, operator/native session, paired credential, version/currentness, and generation captured for the operation.
3. On lock, logout, PIN change, credential rotation, pairing revocation, reselection, expiry, or restart, synchronously clear local authority and prevent late async results from repopulating any prior presentation or writer.
4. Never persist plaintext PIN or master key; keep clinical master keys memory-only and use OS-backed Keychain material plus authenticated encryption and context binding for native cache state.
5. Preserve ciphertext on decrypt failure; prevent caller-controlled writes to host-reserved AI/document provenance and currentness fields.
6. Bound request bodies, decoded attachment bytes, parser work, child output, RPC frames, concurrency, deadlines, and retries at every remotely or locally reachable untrusted boundary.
7. Keep extraction, WHO, provider, headless, and regional handoff workflows review-first and destination-fixed; no caller-selected provider, endpoint, fallback, shell, or silent clinical apply.
8. Keep child process environments minimal, IPC authenticated and replay-resistant, and revocation terminal even if cleanup or audit callbacks fail.
9. Require Web admin plus trusted mutation binding for backup restore and other system mutations; validate artifacts before an atomic replacement and do not overstate bare checksums as authenticity.

##### Assumptions and prioritized attacker stories

The normal default is loopback-only. LAN reachability exists only when an operator enables `network-home-base`; cloud provider and WHO network use remain opt-in. The repository explicitly does not claim multi-tenant or complete per-patient RBAC (`ARCHITECTURE.md:26-30`, `docs/adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md:70-89`). The Apple runtime and OS Keychain enforcement were source-reviewed but not executed; no Xcode volume, simulator, VM, service, live provider, or real data is used in this scan.

| Priority | Hypothesis and capability gain | Prerequisites | Existing controls / review question |
| --- | --- | --- | --- |
| High | A successful or response-ambiguous native PIN change leaves the old local master key/session presentation usable after the server has retired the session. | Current paired operator and a PIN-change success or lost response. | Server retirement is commit-last; verify the Apple client synchronously clears all local authority on both terminal paths. |
| High | A stale async Apple task republishes prior patient/scope data after logout, relogin, credential rotation, or ambulatory reselection. | Delayed network/cache callback and a lifecycle transition. | Verify login/workspace generations, request IDs, context equality, and synchronous presentation clearing on every callback and mutation. |
| High | A paired caller selects or forges another ambulatory/patient and reads or writes outside the effective membership. | Valid paired credential and native session plus controllable cookie/path/body. | Verify server-derived scope, membership joins, exact patient binding, and capability/version checks; ADR 0074 requires membership joins for cross-patient reads (`docs/adr/0074-network-cross-patient-read-boundary.md:35-49`). |
| Medium | A paired profile write modifies host-reserved AI/document provenance fields and corrupts currentness/integrity. | Valid write capability and crafted patient payload. | Compare denylist/allowlist with the full normalization sink and documented paired exclusions (`SECURITY.md:146-147`). |
| Medium | Oversized unauthenticated pairing or authenticated clinical JSON exhausts Web-process memory before schema validation. | LAN or local route reachability and an unbounded body reader. | Inventory `request.json()` entry points and require stream limits before parsing where a trusted upstream limit is not established. |
| Medium | Malicious document/parser output escapes process, network, resource, or currentness controls. | Authenticated attachment access and crafted local document. | Worker hash/path pinning, replacement environment, network denial, byte/page/time caps, exact envelopes, and post-run currentness checks are present; verify every subprocess path. |
| Medium | A local process impersonates the MCP child, replays bootstrap/RPC, or retains authority after Web/MCP disconnect. | Same-user local code and access to an IPC surface. | Inherited private IPC, exact child environment, one-use bootstrap, bounded RPC, scope epochs, revocation, and child termination must all remain enforced. |
| Medium | WHO/provider configuration enables SSRF, secret disclosure, unintended egress, or fallback. | Feature explicitly enabled plus malformed caller/config/response. | Fixed targets, explicit state, secret-ref allowlist, one-use injection, response limits, no fallback; verify production adapters do not reintroduce caller URL or inherited secrets. |
| Low | Concurrent first-use Keychain cache-key creation encrypts data under a losing ephemeral key, causing later cache loss. | Concurrent cache initialization in one OS account. | Confidentiality remains under AES-GCM; verify duplicate-item handling rereads the persisted winner to preserve availability. |

Unresolved deployment questions: whether a reverse proxy or packaged runtime imposes a body limit before all raw `request.json()` routes; whether production signing/entitlements further restrict Keychain items; and whether an operator-to-ambulatory membership policy exists beyond the documented single-local-user default. These prerequisites affect reportability and severity and are not assumed.

### Findings

#### No findings

No reportable findings survived the canonical discovery, validation, and reportability gates.

### Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| A. Authentication, sessions and PIN lifecycle | Session retirement and local clinical authority | Rejected | Candidate candidate-6bc5813e30c51024 is deterministic: after server retirement, the Apple client retains sessionCookie, masterKey, identity, clinical presentation, drafts and cache context on success or response ambiguity, contrary to ADR 0106. Attack-path policy rejects it as a reportable vulnerability because the only evidenced abuse is self-only or targeted physical access while the app is unlocked, which SECURITY.md excludes. Promotion remains blocked until the mandatory contract is restored and reverified. |
| B. Authorization and data isolation | Paired/native scope, patient membership and reserved fields | No issue found | Native clinical routes retain paired credential plus operator-session checks, patient membership joins, scope and version/currentness controls under the documented single-local-user, no-complete-RBAC deployment model. |
| C. Native asynchronous privacy | Late callbacks, logout/relogin/reselection and presentation clearing | No issue found | Generation, request-ID, scope/context and synchronous-clear controls were traced. The PIN-success/ambiguous-response contract defect is recorded and rejected under surface A; no separate in-scope attacker path survived. |
| D. Crypto, Keychain, cache and backup | Field crypto, encrypted native cache and database restore | No issue found | Field crypto remains client-side; cache uses AES-GCM, ThisDeviceOnly Keychain material, context binding and bounded expiry; restore remains Web-admin, trusted-mutation, validated and transactional. |
| E. Documents, extraction and external communication | Attachment authority, parser isolation, WHO/provider destinations | No issue found | Source authority/currentness is host-owned; parser child paths, hashes, bytes/pages/time/output and network are bounded; WHO/provider destinations and secret injection remain host-owned and explicit. |
| F. Headless agents and processes | Supervisor, MCP bootstrap/RPC, environment and revocation | No issue found | Child environments are replacement allowlists; bootstrap/RPC are inherited, bounded and revocable; cleanup removes owners/scopes and terminates the child. |

### Open Questions And Follow Up

- Does the packaged reverse proxy impose a bounded body limit before every raw request.json() route?
  - Follow-up prompt: At commit 1d633d98d0a093623c8c4f488815af804c769a6e, inspect packaged ingress and route-body limits for app/api/auth/native/login/route.ts and changed network routes without launching services.
- Do production signing and entitlements narrow Keychain access beyond the source-visible accessibility class?
  - Follow-up prompt: At commit 1d633d98d0a093623c8c4f488815af804c769a6e, review MediFlow Apple signing and Keychain entitlements for HomeBasePatientCacheStore and HomeBasePairedStore.
- Will a future deployment add per-operator ambulatory membership beyond the documented single-local-user/no-complete-RBAC model?
  - Follow-up prompt: Before introducing multi-operator deployment, define and verify server-side operator-to-ambulatory membership for lib/network-write-context.ts and network patient routes.
