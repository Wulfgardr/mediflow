# Audit esterno V2 (architetturale, regolatorio, semantico): triage e residuo azionabile

<!-- @Codex WUL-481 -->
> [!NOTE]
> Questo documento conserva il triage eseguito il 5 luglio 2026 e la relativa
> provenienza. Al recupero sulla `main` pubblica dell'11 luglio 2026, il finding
> sul drift dei write paired risulta superato dagli ADR 0052-0056 e 0076 già
> presenti nel canone. Le altre issue restano un backlog da rivalutare contro
> lo stato corrente, non una fotografia automaticamente valida dell'11 luglio.

- **Data**: 2026-07-05
- **Fonte**: documento esterno "MediFlow: Comprehensive Architectural, Regulatory, and Semantic Audit Report V2" (PDF, 5 obiezioni)
- **Metodo di verifica**: workflow di adjudicazione multi-agente contro il codice reale. Due agenti di recon (sonnet-5) su nature/posture e ADR/codice, adjudicazione indipendente cross-model via gpt-5.5 (Codex, read-only) con citazioni file:line, sintesi finale opus-4.8. I cinque verificatori fable-5 dedicati sono caduti su usage-cap e sono stati rimpiazzati dall'adjudicazione diretta opus incrociata con la recon e con gpt-5.5 (doppia base indipendente).
- **Verdetto sintetico**: tre obiezioni su cinque (O1, O3, e il movente di O4) attaccano architetture o intenzioni che il repo documenta esplicitamente di NON aver costruito, o ne invertono lo scopo. Il residuo reale e utile e' concentrato su O5 (crypto), O2 (fedelta' codifiche FHIR) e la cautela regolatoria di fondo di O4.
- **Tracker Linear** (filato 2026-07-05): WUL-470 (padre) + figlie WUL-471 (O5), WUL-472 (O2), WUL-473 (O4), WUL-474 (O1), WUL-475 (drift ADR). Dettaglio ed esito read-back in fondo.

## Nota di scoping (il punto che il report salta)

MediFlow e' un'app locale-first, single-writer, single-practice: un Mac "home-base" con Next.js + SQLite locale (better-sqlite3/drizzle-orm), campi clinici cifrati client-side, e client "paired" (macOS nativo, iPadOS/iOS) che parlano solo a una API locale versionata dopo pairing esplicito, mai al DB. Fixtures sintetiche (nessun PHI nel repo), OSS MIT, self-hosted dal medico-autore per la propria pratica. Non e' un SaaS multi-tenant, non e' un dispositivo CE, non e' un gateway SISS/FSE certificato. Diversi ADR citati dall'audit sono `Status: Proposed` e mettono la feature temuta *fuori scope* per iscritto. Il report legge i nomi delle colonne e i titoli degli ADR, non il loro contenuto: e' la firma di un audit generato da un LLM (confident, strutturato, citation-shaped, ma contro uno strawman).

## Verdetti per obiezione

| # | Obiezione (sintesi) | Verdetto | Rischio reale |
|---|---------------------|----------|---------------|
| O1 | Collasso della concurrency ottimistica in mesh offline multi-autore | Misframed / esagerata | Basso ora; alto solo se si costruisce il multi-writer sync |
| O2 | FHIR export-only, "perdita semantica permanente" | Parzialmente valida | Basso ora; medio se l'export serve per interop reale |
| O3 | Gap FSE 2.0 / SISS = "bypass" dell'integrazione | Fatti accurati, framing sbagliato | Basso ora (fuori scope, documentato); alto solo se ci si spaccia per "integrato" |
| O4 | "Claims Guard" = evasione MDR; sei Classe IIa non certificata | Movente invertito (falso), cautela di fondo valida | Alto quando/se si distribuisce ad altri clinici per uso su pazienti reali |
| O5 | PIN a bassa entropia + audit trail non isolato | Largamente valida (la migliore delle cinque) | Medio-alto (brute-force offline PIN) / basso-medio (isolamento audit) |

### O1 - Concurrency "matematicamente inviabile" -> misframed

Vero: le colonne `version` esistono su `patients`, `entries`, `therapies`, `observations`, `checkups` (`lib/schema.ts`). Ma non esiste nessun CRDT / vector-clock / merge-engine (grep = 0 hit). Lo scenario dell'audit (Nodo A offline scrive `aiSummary`, Nodo B offline scrive `isAdi`, collisione irrisolvibile al reconnect Bonjour, overwrite silenzioso, doppio dosaggio fatale) descrive un'architettura che non esiste:

- ADR 0034/0035/0036 (`Proposed`) mettono esplicitamente fuori scope multi-master, peer-to-peer mesh, write queue offline e merge automatico. ADR 0035 rifiuta per iscritto l'opzione "sync record-level con conflitti" e sceglie uno snapshot mirror governato: "nessun merge automatico, nessuna write queue nascosta".
- Le scritture di rete sono online, sincrone, session-bound, capability-gated, con compare-and-swap su `version` che ritorna HTTP 409 con detection (`lib/network-entry-write.ts`, `lib/entry-concurrency.ts`). Last-writer-con-rilevamento, non overwrite cieco.
- `aiSummary` e `documentInsights` sono vietati alle scritture di rete (`NETWORK_FORBIDDEN_ENTRY_WRITE_FIELDS`). Lo scenario "double-authoring su aiSummary" e' letteralmente impossibile nel codice attuale.

Steelman valido: il lock ottimistico e' a livello di riga intera, non di campo. Se un giorno arriva il sync bidirezionale offline (e' nella visione tri-OS), il conflitto diventa reale e serve conflict-resolution field-level o event-sourcing progettati dall'inizio. Vincolo di design futuro, non bug catastrofico attuale.

### O2 - FHIR "decapitazione strutturale" -> parzialmente valida

Vero: FHIR e' export-only (`generatePatientBundle` -> Bundle `collection`, `lib/fhir/bundle-generator.ts`), senza validazione (nessuna libreria FHIR, nessun XSD/Schematron). Il mapping e' lossy: `MedicationStatement` emette il nome farmaco testuale ma scarta `aic`/`atc`/`activePrinciple` che esistono gia' nello schema (`lib/fhir/clinical-adapter.ts` vs `lib/schema.ts`). Provenance/extensions non modellate.

Esagerato: "blob di stringhe piatte" e "perdita semantica permanente" sono imprecisi. Le diagnosi non sono testo libero: sono un array JSON di oggetti codificati (`system`/`code`/`description`/`date`) in una colonna TEXT (`lib/schema.ts`), pattern normale. Storage nativo + proiezione a FHIR in uscita e' come lavorano quasi tutti gli EHR. La "perdita" morde solo se qualcuno usa quei bundle per interop reale, cosa che oggi non avviene (GTW/FSE non implementati).

Azionabile e a basso costo: mappare `aic`/`atc`/`activePrinciple` in `medicationCodeableConcept.coding`, e aggiungere validazione del bundle quando l'export servira' davvero.

### O3 - Gap FSE 2.0 / SISS -> fatti giusti, framing sbagliato

Il report cita il documento stesso del progetto contro il progetto. `docs/fse-gtw-baseline-alignment.md` elenca gia' come Missing/Partial: nessun client GTW, nessun provisioning certificati, niente mTLS+JWT, niente validazione CDA. ADR 0045/0046 (Accepted) impongono un canale SSI/A2A qualificato o il path webapp-assisted, e vietano di costruire UI custom contro SISS senza qualificazione. Il README dichiara nessuna integrazione regionale certificata nativa.

Quindi i gap sono reali ma non sono difetti: sono integrazioni correttamente fuori scope, dichiarate apertamente, e la claims-guard impedisce attivamente di mentirci sopra. "Bypass" e' la parola sbagliata per una scelta architetturale esplicita e governata da ADR. Diventa un problema solo se MediFlow si presentasse come "FSE integrato".

### O4 - MDR Rule 11 + "Claims Guard" -> movente falso, cautela vera

Il movente e' invertito. ADR 0065 / `scripts/check-claims-guard.mjs` non "strippa termini clinici per eludere la certificazione". Fa l'opposto: e' un check CI deterministico (`npm run check:claims`) che blocca docs/UI dal rivendicare diagnosi autonoma, triage, prescrizione o integrazione SISS/FSE certificata, e dichiara per iscritto che non sostituisce la revisione umana/regolatoria. E' disciplina anti-overclaim, non evasione. Chiamarla evasione e' il contrario della verita'.

La cautela di fondo pero' e' valida: rinominare le parole non cambia la classe di un dispositivo sotto MDR, conta la funzione. `aiSummary` e `documentInsights` sono feature AI reali su dati clinici. La sfumatura che il report ignora: gli obblighi MDR (CE, ISO 13485, conformita' IIa) scattano quando un dispositivo e' immesso sul mercato o messo in servizio. Oggi MediFlow e' software OSS self-hosted con fixtures sintetiche: zona genuinamente grigia (in-house / non "making available"). Non affermiamo "sicuramente esente" piu' di quanto il report possa affermare "sicuramente dispositivo IIa illegale". Posizione onesta: il momento in cui MediFlow viene distribuito ad altri clinici come strumento d'uso su pazienti reali, la Rule 11 diventa un obbligo serio e serve una determinazione regolatoria formale (notified body), non una code review. Le scelte "assistivo / review-first / non autonomo" sono esattamente le mitigazioni che possono sostenere un intended-purpose argument in una classe piu' bassa.

### O5 - PIN + isolamento audit -> largamente valida (la migliore)

Entropia PIN, vera. KDF = PBKDF2-HMAC-SHA256, `KDF_ITERATIONS = { 1: 100k (legacy, solo byte-parity), 2: 600k (corrente) }`, `CURRENT_KDF_VERSION = 2` (`lib/security/security.ts`). Master key AES-256 casuale, wrappata sotto KEK derivata dal PIN, RAM-only sul client, server senza chiave in chiaro (`app/api/auth/login/route.ts`). Lockout a tempo (HTTP 423, `lib/security/auth-lockout.ts`), nessun wipe. Ma un PIN numerico corto e' intrinsecamente brute-forceabile offline a prescindere dalle iterazioni se `medical.db` viene rubato: il lockout a tempo non protegge l'attacco offline (l'attaccante ha il file e bypassa l'app). Nota: descrizione neutra e coerente con il claim zero-knowledge gia' congelato (WUL-342/354), da non rafforzare ne' indebolire qui. Leve reali in ordine di costo: passphrase alfanumerica opzionale (l'entropia e' il vero problema, non la KDF), pepper, binding hardware (Secure Enclave/TPM). Argon2id era gia' stato declinato in review precedente.

Isolamento audit, vero ma proporzionato. Append-only enforced da trigger SQLite `RAISE(ABORT)` su UPDATE/DELETE (`drizzle/0005_audit_events_append_only.sql`), meglio di app-only. Ma stessa istanza = un root puo' editare il file sotto l'app; `SECURITY.md` mette gia' l'host-compromise fuori dal threat model. Replicare l'audit su logging isolato e' un requisito enterprise-multi-tenant applicato a un tool mono-utente dove l'admin e' il medico. Osservazione corretta, con il giusto caveat di proporzionalita': conta solo se un giorno si va multi-utente/istituzionale.

## Finding aggiuntivo (storico, poi superato)

Il 5 luglio la recon rilevò un drift documentale: il write-path di rete
(`network.replica.write-clinical-diary` in `lib/network-entry-write.ts`, montato
su `app/api/v1/network/patients/[id]/entries/route.ts` POST) permetteva già ai
client paired di creare/aggiornare voci di diario clinico da remoto, oltre la
"read-only first slice" descritta in ADR 0034/0035.

Nella `main` pubblica riconciliata il finding non è più corrente: ADR 0052-0056
formalizzano i write paired versionati per profilo, diario, terapie, controlli e
osservazioni; ADR 0076 governa inoltre le scritture del dominio documentale.
WUL-475 può quindi essere chiusa come superseded dopo il merge di WUL-481,
salvo emergano nuovi scostamenti puntuali tra capability manifest, codice e ADR.

## Working hypothesis (da mettere alla prova)

> **H (2026-07-05)**: la superficie di esposizione reale di MediFlow non e' la correttezza distributed-systems (deliberatamente non costruita e messa fuori scope dagli ADR), ma due assi concreti: (a) l'entropia della chiave offline se il dispositivo viene perso/rubato, e (b) la soglia regolatoria che scatta al momento della distribuzione a terzi. I rischi di interoperabilita' (FHIR) e di sync sono latenti: diventano reali solo attraversando soglie precise della roadmap, cioe' "export FHIR usato per interop vera", "sync multi-writer effettivamente costruito", "app distribuita ad altri clinici per uso su pazienti reali". Corollario operativo: gli investimenti di robustezza vanno legati a quelle soglie, non anticipati sulla base di un audit che immagina l'architettura di destinazione al posto di quella attuale.

Falsificabile: se emergesse che (i) esiste gia' un percorso di scrittura offline multi-nodo non gated, o (ii) l'export FHIR e' gia' consumato da un sistema esterno reale, o (iii) MediFlow e' gia' distribuito/usato da clinici diversi dall'autore su pazienti reali, allora l'ipotesi cade e le priorita' cambiano.

## Linear filing spec

Team `Wulfgardr` (WUL, id `104ce024-b808-48c7-9aa2-7cfa3dbb26fd`), progetto `Mediflow` (id `c2e777cd-6280-48f8-bc5c-5ad811b56f97`). Un solo label Area per issue + tag flat. Ogni figlia ha `parentId` = il tracker padre. Relazioni relates-to solo se il target esiste (altrimenti skip e annota).

**PADRE (tracker)** - titolo: "Audit esterno V2 (architetturale/regolatorio/semantico): triage e residuo azionabile". Label: `macro`, `bucket/tracker`, Area `Process`. Stato: Todo. Descrizione: sintesi del verdetto (3/5 strawman, residuo reale O5/O2 + cautela O4) e link a questo doc (`docs/analysis/2026-07-05-audit-esterno-v2-triage.md`).

**FIGLIA 1 [O5] - PIN entropy** - titolo: "Entropia PIN: opzione passphrase alfanumerica + valutare binding hardware; chiarire limite lockout offline". Label: `improvement`, `security`, Area `Data`. Priorita': High. Stato: Todo. relates-to: WUL-342, WUL-354. Descrizione: opzione passphrase alfanumerica accanto al PIN numerico; valutare Secure Enclave/TPM come step successivo; documentare in SECURITY.md che il lockout a tempo non protegge il brute-force offline se `medical.db` e' sottratto. KDF gia' a PBKDF2 600k (non e' quello il problema, e' l'entropia dell'input).

**FIGLIA 2 [O2] - FHIR codings** - titolo: "FHIR MedicationStatement scarta aic/atc/activePrinciple: mappare in medicationCodeableConcept.coding + validazione bundle". Label: `improvement`, `fhir`, Area `Integrations`. Priorita': Medium. Stato: Backlog. relates-to: WUL-451. Descrizione: il generatore export-only perde codifiche gia' presenti in schema; mapparle; aggiungere validazione del bundle quando l'export sara' usato per interop reale.

**FIGLIA 3 [O4] - MDR determination** - titolo: "Determinazione regolatoria MDR Rule 11 prima della distribuzione a terzi". Label: `improvement`, `decision`, `review-first`, Area `Process`. Priorita': Medium. Stato: Backlog. relates-to: WUL-387, WUL-467. Descrizione: la Claims Guard (ADR 0065) e' anti-overclaim, non uno scudo di conformita' (lo dice l'ADR stesso). Se/quando MediFlow viene distribuito ad altri clinici per uso su pazienti reali, serve una determinazione formale di classe (Rule 11) e QMS/CE se applicabile. Gating decision, non urgente allo stato attuale (self-use OSS).

**FIGLIA 4 [O1] - sync design note** - titolo: "Design futuro sync: conflict-resolution field-level / event-sourcing se si costruisce il multi-writer". Label: `improvement`, `sync`, Area `Data`. Priorita': Low. Stato: Backlog. relates-to: WUL-452. Descrizione: il lock ottimistico attuale e' a livello di riga; se arriva il sync bidirezionale offline, progettare merge field-level o event-sourcing dall'inizio. Collegare al lab CRDT / PoC PowerSync-Electric gia' in roadmap.

**FIGLIA 5 [drift] - ADR vs codice** - titolo: "Allineare ADR 0034/0035 (read-only first slice) al write-path di rete gia' implementato". Label: `improvement`, `api-v1`, Area `Platform`. Priorita': Medium. Stato: Todo. Descrizione: `network.replica.write-clinical-diary` implementa scritture paired oltre lo slice read-only descritto negli ADR 0034/0035 (`Proposed`). Promuovere/superare gli ADR o documentare formalmente la capability.

### Esito filing (2026-07-05, via Codex + Linear MCP, read-back da query fresca)

| identifier | titolo | stato | priorita' | label | relates-to |
|---|---|---|---|---|---|
| WUL-470 | Audit esterno V2: triage e residuo azionabile (padre) | Todo | None | macro, bucket/tracker, Process | (tracker) |
| WUL-471 | O5 Entropia PIN + passphrase/hardware | Todo | High | improvement, security, Data | WUL-342, WUL-354 |
| WUL-472 | O2 FHIR MedicationStatement scarta aic/atc/activePrinciple | Backlog | Medium | improvement, fhir, Integrations | WUL-451 |
| WUL-473 | O4 Determinazione MDR Rule 11 pre-distribuzione | Backlog | Medium | improvement, decision, review-first, Process | WUL-387, WUL-467 |
| WUL-474 | O1 Design futuro sync field-level / event-sourcing | Backlog | Low | improvement, sync, Data | WUL-452 |
| WUL-475 | Drift ADR 0034/0035 vs write-path di rete | Todo | Medium | improvement, api-v1, Platform | (nessuna) |

Nota: read-back confermato da Codex via Linear API (`get_issue` con `includeRelations`); la verifica indipendente lato Claude non e' possibile finche' il connector Linear di Claude non e' autenticato.

## Provenienza / affidabilita'

- Ground truth dal codice: due agenti recon sonnet-5 (file-cited).
- Adjudicazione indipendente cross-model: gpt-5.5 via Codex read-only, verdetti per obiezione con citazioni file:line, in accordo con la recon.
- Sintesi e priorita': opus-4.8.
- Limite noto: i 5 verificatori fable-5 dedicati sono caduti su usage-cap; l'adjudicazione finale poggia su recon + gpt-5.5 + opus (doppia base indipendente, cross-model), non su un terzo giro Claude.
