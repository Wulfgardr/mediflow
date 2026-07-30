---
summary: "Run record del checkpoint Horizon WUL-522: giudizio congelato, slice di prima adozione reale del Fabric su document_synthesis, DAG, ownership, falsificatori e regole di arresto."
read_when:
  - "Si riprende, verifica o estende il checkpoint Horizon della Intelligence Fabric."
  - "Si valuta la prima adozione reale del Fabric in un call path AI locale."
---

# Intelligence Fabric: checkpoint Horizon

Stato documento: `SECONDARY / RUN RECORD`

Run ID: `MFP-IF-HORIZON-20260730-01`

Data: 2026-07-30

Controller: Fable 5 (giudizio, integrazione, closeout); lane delegate GPT-5.6.

Quota Fable: 18% residua, fornita come dato operativo dal controller umano;
spesa prioritaria su giudizio, confini e closeout; esecuzione delegata.

## 1. Evidenza acquisita dal checkpoint precedente

- Verdetto Fable: `CONFIRM_LOCAL_CANDIDATE`; stato confermato:
  `INTELLIGENCE_FABRIC_LOCAL_CANDIDATE_READY / HOLD_REMOTE_PROMOTION`.
- Branch sorgente: `codex/WUL-522-intelligence-fabric-cos-local`;
  baseline `54040f2e8`; snapshot verificato `afacefcb9`; HEAD documentale
  `ee22399a4` (delta solo run record).
- V2 indipendente: GO, 111/111 mirati, 993/993 unit, gate Node e web verdi;
  SwiftPM `BLOCKED_TOOLCHAIN`; checksum V2
  `c1652387e226c62bb9a530470adbcdda55f1294dc626d90f9d73c7270fbc8f50`.
- Preflight Horizon: identita, ancestry e pulizia confermate; target branch e
  worktree Horizon liberi; worktree Fable congelato intatto a `54040f2e8`.
- 82% base tecnica e 54% prodotto restano indicatori narrativi.

## 2. Mappa di stato (ricognizione H-R1, Luna high read-only)

| Area | Classificazione |
| --- | --- |
| Adozione Fabric nei call path AI reali | harness-solo (8 call site reali ancora su `AIService` diretto) |
| Lifecycle provider persistito | assente-ma-locale |
| Provenance/review collegate ai risultati reali | harness-solo |
| Paired AI | contrattuale (`status_only`, nessun grant) |
| Cloud | dipendente-esterno (egress chiuso) |
| On-device | assente-ma-locale / dipendente-esterno |
| Apple runtime | contrattuale / dipendente-esterno (toolchain) |

## 3. Giudizio Horizon (congelato)

Prossimo orizzonte tecnico: **prima adozione reale del Fabric in un call path
AI esistente**, host-local e review-first. Risultato locale verificabile: una
sintesi documentale che passa dall'ammissione Fabric prima di ogni invocazione
generativa, con receipt, provenance e proposta review-first collegate al
risultato, contratto applicativo invariato e core non-AI intatto.

### Slice selezionata

`FIRST_REAL_LOCAL_CALL_PATH_FABRIC_ADOPTION` su **`document_synthesis`**
(`lib/domain/documents/document-synthesis-service.ts`,
`analyzeDocumentContent()`).

Motivi (raccomandazione H-R2, Sol high, adottata dal controller):
`analyzeDocumentContent` non persiste dati; descrittore gia a catalogo;
binding `reasoning -> Ollama loopback` gia derivato dalle impostazioni; i
consumer (pdf-importer, create-flow diario) assorbono gia l'errore AI senza
bloccare il core; un solo confine architetturale; test sintetici esistenti.

### Design del seam (vincolante per il writer)

- Nuovo adapter `lib/domain/documents/document-synthesis-fabric.ts`.
- Ammissione DOPO la riduzione del testo e PRIMA di `ai.generate()`.
- Input di ammissione derivati SOLO da stato locale reale: kill switch gia
  letto; snapshot singolo di `ai.getModelInfo()` (receipt del registry
  inclusa); venue `local_process`; sonda `ai.getHealth()` -> observation
  `available` oppure `offline/daemon_unreachable`; onboarding derivato
  `ollama + local_model` fino a `enabled`; lifecycle `available_unqualified`
  solo con configurazione valida e sonda positiva; egress `local_only`;
  requestId UUID senza dati clinici.
- Negazione: errore tecnico dedicato che attraversa i `catch` esistenti,
  prima di `generate()`, receipt null, `fallback: denied_by_contract`, MAI
  provider alternativo e MAI sintesi deterministica come recupero.
- Metadato interno congelato (routing + provenance + proposta
  `review: pending`, `writesPerformed: 0`) allegato via proprieta Symbol non
  enumerabile con getter dedicato: campi pubblici, `JSON.stringify`,
  `documentInsights` persistiti e schema INVARIATI. La stessa istanza di
  receipt compare in routing e provenance.
- Incertezza conservativa `low / degraded_default`; nessuna derivazione dalla
  qualita documentale (sarebbe una nuova decisione clinica).
- Nessuna nuova impostazione, tabella, persistenza, route, UI o file nativo.

### Alternative respinte

| Alternativa | Motivo |
| --- | --- |
| Patient insight | coalescing, rerun e auto-persistenza di `aiSummary`: accoppiamento maggiore |
| Smart import | servizio >1000 righe, adiacente al percorso di applicazione clinica |
| OCR | fallback Apple Vision richiederebbe una decisione dedicata sul fallback |
| Treatment reasoning | receipt self-managed con `model: null` non ancora legata alla risposta |
| Adozione globale in `AIService.create` | piu capability e piu confini in una sola slice |
| Capability deterministica | non dimostrerebbe l'adozione in un call path AI reale |

## 4. Roadmap e DAG

```text
H-R1 (DONE) ─┐
             ├─ giudizio congelato ─ H-W1 (writer unico) ─ integrazione Fable ─ gate ─ H-V1 (verifica fresca) ─ closeout
H-R2 (DONE) ─┘
```

DAG successivo (post-Horizon, non promesso in questa sessione): migrazione
degli altri call path (insight, smart import, OCR, treatment reasoning),
lifecycle persistito, persistenza review, superfici paired oltre lo status.

## 5. Lane e ownership

| Lane | Modello/effort | Modalita | Ownership esatta |
| --- | --- | --- | --- |
| H-R1 inventario | Luna high | read-only | nessuna (DONE) |
| H-R2 giudizio | Sol high | read-only | nessuna (DONE) |
| H-W1 writer unico | Terra high | worktree dedicato | SOLO: `lib/domain/documents/document-synthesis-fabric.ts` (nuovo), `lib/domain/documents/document-synthesis-service.ts`, `lib/domain/documents/document-synthesis-service.test.ts`, `lib/ai-context.test.ts` |
| H-V1 verifica | Sol high | contesto fresco read-only | nessuna |

Fable possiede i documenti Horizon e l'integrazione locale. Ogni correzione
runtime torna a H-W1 dentro l'ownership congelata. Nessun nesting; nessun Sol
Ultra in questa sessione.

## 6. Falsificatori della slice (da provare in H-W1 e H-V1)

1. Lifecycle `revoked` o `degraded` produce receipt o invoca il modello.
2. Venue offline/unknown cambia venue o invoca il modello.
3. Descriptor fabbricato accettato.
4. Getter stateful cambia esito tra ammissione e receipt (ogni input letto
   una volta).
5. Receipt Fabric incoerente con la receipt del registry ma invocazione
   eseguita.
6. Risultato valido senza provenance, o `routing.receipt` diversa da
   `provenance.receipt`.
7. Review nata non-`pending` o che autorizza una scrittura.
8. Metadati Fabric persistiti in `documentInsights` o visibili in
   `JSON.stringify`.
9. Negazione Fabric che attiva provider alternativo o sintesi deterministica
   come recupero.
10. Negazione Fabric che blocca OCR, allegato o voce clinica (core non-AI).
11. Endpoint non loopback o egress diverso da `none` ammessi.
12. Tentativo di scrittura clinica autonoma dal percorso adottato.

## 7. Regole di arresto della wave

Interrompere se: serve persistenza di revoca/receipt/review; serve una nuova
impostazione, migrazione, UI, API o client Apple; serve un fallback
automatico; la slice supera circa 300 LOC; `available` dovrebbe certificare
readiness qualificata; emergono piu call path o piu confini; una decisione
contrattuale si apre; la verifica indipendente non puo essere completata.
In caso di arresto: commit locali piccoli, worktree puliti, nessuna
cancellazione, packet residuo coeso.

## 8. Controlli di accettazione e promozione

Gate della wave: test mirati document-synthesis + fabric; suite unit
completa; typecheck; lint; build; claims; never-regress; OpenAPI drift (non
deve cambiare); schema drift (non deve cambiare); `git diff --check` e
diff-check dalla base; prova che il core non-AI resta disponibile; controllo
chiamate esterne (solo loopback). Poi H-V1 a contesto fresco: un P0-P2
produce `HOLD_FIX` e torna a H-W1. Promozione locale solo dopo GO di H-V1.
Promozione remota: sempre `HOLD` (fuori autorita di questa sessione).

## 9. Decision audit

| Decisione | Stato | Falsificatore |
| --- | --- | --- |
| Slice su document_synthesis invece di patient insight | Accettata (argomento persistenza/accoppiamento di H-R2, verificato sul codice) | Un accoppiamento di document_synthesis superiore a quello stimato |
| Metadato via Symbol non enumerabile invece di campo additivo | Accettata: preserva bit-a-bit contratto pubblico e payload persistito | Un consumer che richieda il metadato nel payload serializzato |
| Sonda getHealth pre-invocazione | Accettata: converte un fallimento di generate in negazione osservabile | Una latenza o un falso-offline che degradi il flusso reale |
| Incertezza fissa `low/degraded_default` | Accettata: evitare mapping qualita->confidence (decisione clinica) | Una richiesta prodotto di confidence dichiarata |
| Quota 18% come dato operativo senza verifica di sessione | Accettata (mandato del controller umano) | |

Nessuna decisione contrattuale aperta blocca la slice. Restano aperte fuori
contratto (non bloccanti, non promesse): lifecycle persistito, review
persistita, altri call path, cloud/on-device/paired, runtime Apple.

## 10. Blocker esterni

- SwiftPM/XCBuild `BLOCKED_TOOLCHAIN` (CommandLineTools; serve Xcode
  funzionante): nessuna prova runtime Apple in questa sessione.
- Cloud e provider reali: egress chiuso per contratto; fuori scope.

## 11. Criterio di handoff

Se la quota Fable si esaurisce realmente: interrompere nuove lane, conservare
commit locali, worktree puliti, stato esatto in questo run record, verdetto
`FABLE_CAPACITY_BLOCKED`; solo dopo, il residuo puo passare a un unico CoS
Sol Ultra esterno. Nessun avvio autonomo del CoS successivo.

## 12. Verdetto intermedio

`HORIZON_PLAN_FROZEN / WAVE_1_AUTHORIZED`: margine sufficiente per una sola
wave bounded (H-W1 Terra high) con verifica H-V1, entro le quattro lane
complessive.

## 13. Esito della wave

Wave H-W1 consegnata e verificata.

- Commit wave: `be482b7d1` (4 file, +357/-15: adapter
  `document-synthesis-fabric.ts`, seam nel servizio, test, fixture
  ai-context). Sforamento LOC dichiarato: interamente nei test.
- Battery del controller sul branch integrato: typecheck, lint, claims,
  never-regress, OpenAPI drift, schema drift, `git diff --check
  ee22399a4..HEAD` tutti PASS; suite unit `999/999`.
- H-V1 (Sol high, contesto fresco): `GO`. Falsificatori a-j tutti chiusi con
  prove live (lifecycle degraded/revoked, venue offline, receipt divergente,
  getter stateful, metadato non enumerabile, review pending/zero write,
  negazione senza update db e senza recupero deterministico, nessun nuovo IO,
  contratti pubblici byte-identici via SHA-256).
- Finding: nessun P0-P2. Un P3 residuo solo-ostile same-process: il confronto
  receipt rilegge `receipt.provider`/`receipt.model` dall'oggetto originale
  invece che da uno snapshot profondo; getter ostili producono comunque
  negazione fail-closed e zero invocazioni. Registrato come hardening futuro
  non bloccante.
- Non eseguiti (fuori battery e fuori scope): build production in H-V1
  (eseguita verde nelle fasi precedenti), SwiftPM (`BLOCKED_TOOLCHAIN`
  invariato), prove su device/LAN/provider reali.

Verdetto intermedio della wave:
`HORIZON_LOCAL_SLICE_READY / HOLD_REMOTE_PROMOTION`.

## 14. Micro-wave di chiusura del P3

Autorizzata dal controller umano dopo la verifica indipendente Codex del
checkpoint (46/46, 60/60, 64/64, 999/999, build e standalone bundle verdi
su `af0a4c303`). Condizioni rispettate: solo adapter + test, contratto
Horizon invariato, nessun payload o dato persistito toccato, nessuna
dipendenza nuova.

- Writer H-W1b (Terra high, stesso worktree e ownership della wave): commit
  `aa3de4c46`; lo snapshot di `modelInfo` conserva le copie primitive
  `receiptProvider`/`receiptModel` catturate alla validazione e il confronto
  usa solo quelle; regressione stateful dedicata nel test.
- Battery del controller sul branch integrato: claims, never-regress, lint,
  `git diff --check ee22399a4..HEAD`, suite unit `1000/1000`, build
  production PASS.
- H-V1b (Sol high, contesto fresco): `GO — VERIFIED`. Probe reali: una
  lettura per proprieta, ammissione coerente con la prima lettura,
  divergenza -> `provider_receipt_mismatch` e zero generazioni; diff limitato
  ai due file autorizzati; sei simboli esportati identici; nessun finding.

Il P3 della wave e' chiuso. Nessun residuo P0-P3 noto sul candidato Horizon.

Verdetto terminale della sessione:
`HORIZON_HARDENED_LOCAL_CANDIDATE_READY / HOLD_REMOTE_PROMOTION`.

Next permitted action: restituire il packet a Codex per verifica e closeout;
nessun push, PR, merge remoto, tag, release o mutazione Linear.
