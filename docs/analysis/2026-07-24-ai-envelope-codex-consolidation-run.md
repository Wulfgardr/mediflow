---
summary: "Run record for the AI/envelope consolidation, Codex boundary review, and MediFlow 0.8 closeout plan."
read_when:
  - "Reviewing the July 2026 AI/envelope and Codex Operator consolidation program."
  - "Selecting, verifying, or promoting a candidate assembled from the listed worktrees."
---

> [!NOTE]
> Recuperato il 2026-08-06 dal branch storico durante la convergenza su main
> (WUL-481). Percorsi locali sanificati in forma simbolica. Stato storico:
> i verdetti citati riflettono il 2026-07-24, non lo stato corrente.

# Run record: consolidamento AI/envelope e piano MediFlow 0.8

Data avvio: 2026-07-24  
Stato: `CONSOLIDATION_COMPLETE_RELEASE_0_8_SEPARATE`
Ramo manager: `codex/WUL-362-consolidation-closeout`  
Baseline verificata: `origin/main` = `4fbc8ee74d548949166f76d67fb1d419f48230c0`

## Obiettivo

Consolidare due integrazioni ordinate su `main`: prima WUL-519 come gate di
sicurezza, poi la serie AI/envelope ricalcolata sulla nuova base.

Le PR #138, #139 e #140 restano distinte e sono state unite dopo il riesame di
diff, test, documentazione e verifier indipendenti. Il consolidamento è chiuso.
Il piano MediFlow 0.8 resta separato e non esegue ora il version bump.

Il programma copre:

- contratti AI, parsing degli envelope e confidence documentale;
- housekeeping AI già candidato;
- Codex Operator personale, valutato ma escluso dalla promozione;
- WUL-519 come correzione di sicurezza separata e prioritaria.

## Boundary e stop rule

- Non usare PHI, PII, database clinici reali o credenziali.
- Non fare deploy o release. Push, PR e merge sono ammessi solo dopo i
  checkpoint richiesti e con una traccia recuperabile.
- Non modificare o cancellare worktree occupati o dirty.
- Non includere egress, telemetria o AI cloud di default.
- Fermare la promozione se un cambio modifica un confine senza ADR accettato.
- Fermare la promozione se un verifier indipendente restituisce `FINDINGS` o
  `BLOCKED` non risolti.
- Non promuovere diagnosi AI senza un'azione esplicita dell'operatore.
- Non promuovere Codex Operator finché non elimina l'egress di testo clinico.
- Non attribuire alla serie AI/envelope le vulnerabilita ereditarie di
  dipendenza: WUL-519 le tratta in una PR separata.
- Se WUL-519 non passa test o verifier indipendente, fermare la promozione AI.
- Applicare una soluzione minima, diretta e leggibile. Non introdurre
  astrazioni, orchestrazione o documentazione ulteriore senza un finding o una
  dipendenza concreta.
- Mantenere solo la mappa tecnica necessaria per ownership, dipendenze,
  confini e rischi. Un consulto browser/ChatGPT redatto e bounded e opzionale:
  il Chief lo registra solo se cambia una decisione materiale.
- Non implementare una scrittura Codex diretta nel database senza un packet,
  ADR, threat model e verifiche dedicate.

## Inventario iniziale

| Gruppo | Ref live | Stato iniziale | Classificazione iniziale |
| --- | --- | --- | --- |
| AI/envelope | `codex/WUL-362-contract-gates-rebuild` | 8 commit su `main`, worktree pulito | Candidato diretto. |
| Confidence documentale | `codex/WUL-361-explicit-confidence-gate` | 2 commit su `main`, worktree pulito | `BLOCKED_CONTRACT`: ADR 0083 richiede una ratifica prima della promozione. |
| Housekeeping AI | `codex/WUL-353-dead-code-housekeeping` | 1 commit su `main`, worktree pulito | Candidato diretto, da verificare. |
| Codex Operator | `codex/codex-cli-experimental-provider` | 6 commit su `main`, worktree pulito | `BLOCKED`: conflitti con localhost documentato, privacy del prompt, documentazione e boundary da ratificare. |
| Wave 2/3 | `codex/WUL-362-spring-forward-*` | Integrazioni composite | Fonte di inventario. Non è una base di promozione. |
| Backup, network, soft-delete, FHIR e OCR | rami WUL-301, 327, 330, 331, 332, 336 | Candidati separati | Valutazione separata. Nessuna inclusione per prossimità cronologica. |
| WUL-361 foundation | `codex/WUL-361-diagnosis-review-foundation` | 38 commit e worktree dirty | Ownership/integrazione bloccata. Non usare come sorgente di promozione. |
| Candidata ampia | `codex/WUL-362-consolidation-candidate` | 21 commit su `main` | Traccia recuperabile. Non promuovere: il perimetro supera la decisione utente del 24 luglio. |
| Candidata AI/envelope | `codex/WUL-362-ai-envelope-candidate` | 9 commit su `main`, worktree pulito prima delle note di release | Candidata di promozione. Include solo WUL-362 e WUL-353. |
| Gate sicurezza | `codex/WUL-519-security-gate` | 1 commit su `main`, note changelog locali | Candidata separata. Deve precedere la PR AI/envelope. |

## Roadmap e checkpoint

1. **Inventario e selezione — completato**: commit, ownership, esclusioni e
   conflitti sono registrati.
2. **AI/envelope — completato**: contratti e correzioni fail-closed sono
   verificati.
3. **Codex Operator — stop rule attivo**: escluso dalla promozione; richiede
   un nuovo programma senza egress di testo clinico.
4. **WUL-519 — completato**: PR #138 unita e verificata su `main`.
5. **Integrazione AI/envelope — completato**: PR #139 unita sulla base
   post-WUL-519 e verificata su `main`.
6. **Documentazione canonica — completata**: README, topologia e changelog
   descrivono soltanto confini implementati e capacità future non consegnate.
   La PR #140 è unita in `main`; il verifier fresco e i controlli pre-merge e
   post-merge sono verdi.
7. **UI/frontend — audit completato**: nessuna modifica UI entra nel closeout
   senza un finding concreto e un packet separato.
8. **MediFlow 0.8 — pianificato**: il version bump resta fermo fino alla
   chiusura dei contenuti, del changelog e dei gate finali.
9. **Pulizia post-promozione — differita**: branch e worktree restano
   recuperabili per direttiva utente. Nessun target viene eliminato in questo
   passaggio.

## Roadmap futura: assistenza model-agnostic e scrittura autorizzata

Questa roadmap è fuori dalla candidata AI/envelope corrente. Non autorizza
codice, PR o modifica dei contratti attuali.

MediFlow resta uno scaffold intelligente model-agnostic. La pipeline locale
resta disponibile senza Codex o provider esterni. Include dettatura o
trascrizione, stratificazione dei documenti, euristiche e classificazioni
deterministiche.

I modelli locali o esterni sono coadiuvanti opzionali. L'utente li attiva
esplicitamente. Ogni attivazione dichiara confine dati e confine d'azione.

La futura sequenza è:

`pipeline locale -> proposta strutturata -> chiarimento se necessario -> autorizzazione esplicita -> eventuale scrittura auditata`

- La proposta strutturata non modifica il database.
- Se diagnosi, gravità, codice, data, paziente o contesto non sono determinabili,
  il sistema chiede un chiarimento scritto mirato.
- Il sistema non deduce diagnosi, grado o codice per completare un dato ambiguo.
- Per esempio, una descrizione compatibile con BPCO senza diagnosi o grado
  richiede un chiarimento. Non crea una diagnosi.
- La scrittura futura richiede autorizzazione esplicita e contestuale
  dell'utente autorizzato, target e tipo di record inequivocabili, validazione
  di schema e terminologie, conferma dell'azione proposta e audit completo.
- Il livello di chiarimento resta disponibile per ogni modello. Può essere
  testo, card o visualizzatore.

I test futuri devono dimostrare che:

1. la pipeline locale resta operativa senza modello esterno;
2. un input ambiguo produce una richiesta di chiarimento e nessuna scrittura;
3. una proposta non autorizzata non modifica il database;
4. una scrittura autorizzata valida schema, terminologie, target e audit;
5. l'audit collega autorizzazione, utente autorizzato, target, tipo di record e
   risultato della validazione;
6. la stessa regola vale per Codex e per ogni altro modello.

## Piano di consolidamento MediFlow 0.8

La `0.8.0` è una release pianificata. Non è ancora una versione pubblicata.
Il repository usa tag `vMAJOR.MINOR.PATCH`; la versione corrente resta
`0.7.3`.

Superfici canoniche da aggiornare insieme, solo al checkpoint finale:

- `package.json` e le due occorrenze radice di `package-lock.json`;
- badge e intestazione di stato nel `README.md`;
- intestazione di `docs/STATE_OF_THE_SYSTEM.md`;
- sezione datata di `CHANGELOG.md`;
- tag Git `v0.8.0`, dopo merge e verifica del commit finale.

Contenuti già ammessi alla candidata 0.8:

1. WUL-519, già promossa con PR #138;
2. contratti AI/envelope e housekeeping WUL-362/WUL-353, già promossi con
   PR #139;
3. documentazione dei confini local-first e dei provider opzionali, solo dopo
   una PR documentale verificata.

Contenuti non ammessi:

- WUL-361 e persistenza automatica delle diagnosi;
- Codex Operator e scrittura diretta nel database;
- provider cloud, egress clinico o consenso non implementati;
- redesign UI o refactor massivi.

Checkpoint prima del version bump:

1. contenuti effettivi congelati su `main`;
2. changelog 0.8 limitato ai commit promossi;
3. README, topologia e stato del sistema coerenti;
4. Node 24, unit, typecheck, lint, claims, never-regress, build e bundle verdi;
5. workflow remoti verdi sul commit candidato;
6. verifier indipendente `APPROVE`;
7. riesame finale del diff di versione e autorizzazione alla release.

## Definizione di chiusura

`AI/envelope wave closed` richiede tutti questi elementi:

1. I consumer AI usano lo stesso gate envelope o una deroga documentata.
2. Gli envelope moderni, legacy e malformati rispettano i contratti testati.
3. La confidence mancante non abilita autofill clinico.
4. Nessun parser AI rimosso ha importer tracciati.
5. I test mirati, i gate canonici e il verifier indipendente risultano `APPROVE`.
6. La candidata è costruita da `main` aggiornato e ha un diff riesaminato.

Stato finale: **chiusa**. Le PR #138 e #139 sono unite in `main`; il gate
`validate:ai-task-contracts` resta un rischio esterno accettato esplicitamente
per questa promozione e non viene classificato come `PASS`.

## Flussi, modelli e token

La fotografia Codex delle 12:00 CEST comprende il manager e 15 sessioni figlie.
Il comando `model-usage-recap.mjs` misura 223.723.855 token totali. I token
letti dalla cache sono una parte dell'input, non una quantità aggiunta al
totale.

| Flusso | Fornitore, modello e livello | Ruolo | Token e fonte |
| --- | --- | --- | --- |
| Manager, fase iniziale | OpenAI `gpt-5.6-terra/high` | Inventario e consolidamento | 51.253.005; `token_count` |
| Manager, fase finale | OpenAI `gpt-5.6-sol/max` | Decisioni, integrazione, promozione e documentazione | 37.508.514; `token_count` |
| Audit AI/envelope | OpenAI `gpt-5.6-sol`, modalità Ultra, livello non registrato | Audit in sola lettura | 5.524.864; `token_count` |
| Audit Codex Operator | OpenAI `gpt-5.6-sol`, modalità Ultra, livello non registrato | Audit di sicurezza e compatibilità | 6.902.403; `token_count` |
| Audit selezione | OpenAI `gpt-5.6-sol`, modalità Ultra, livello non registrato | Inventario e grafo dei commit | 6.679.519; `token_count` |
| Verifica candidata iniziale | OpenAI `gpt-5.6-sol/max` | Verifica del diff e dei confini | 11.826.968; `token_count` |
| Correzione WUL-519 | OpenAI `gpt-5.6-terra/high` | Implementazione ordinaria del controllo Sharp | 3.340.670; `token_count` |
| Verifica sicurezza WUL-519 | OpenAI `gpt-5.6-sol/max` | Verifica avversaria | 7.424.152; `token_count` |
| Verifica finale WUL-519 V1 | OpenAI `gpt-5.6-sol/max` | Verifica del candidato | 7.369.841; `token_count` |
| Verifica finale WUL-519 V2 | OpenAI `gpt-5.6-sol/max` | Verifica della correzione | 9.026.982; `token_count` |
| Verifica AI/envelope V1 | OpenAI `gpt-5.6-sol/max` | Verifica del primo candidato | 4.739.364; `token_count` |
| Verifica AI/envelope V2 | OpenAI `gpt-5.6-sol/max` | Verifica dopo il primo finding | 7.203.180; `token_count` |
| Verifica AI/envelope V3 | OpenAI `gpt-5.6-sol/max` | Verifica fail-closed | 12.216.225; `token_count` |
| Verifica AI/envelope V4 | OpenAI `gpt-5.6-sol/max` | Matrici avversarie | 15.731.293; `token_count` |
| Verifica AI/envelope V5 | OpenAI `gpt-5.6-sol/max` | Verifica del candidato ristretto | 9.734.567; `token_count` |
| Verifica post-WUL-519 V1 | OpenAI `gpt-5.6-sol/max` | Verifica della candidata ricostruita | 9.147.823; `token_count` |
| Verifica post-WUL-519 V2 | OpenAI `gpt-5.6-sol/max` | Verifica dopo la correzione dell'indice | 18.094.485; `token_count` |
| Verifica documentale fresca | OpenAI `gpt-5.6-sol/max` | Verifica di README, topologia e changelog | 5.517.480; `token_count`, eseguita dopo la fotografia delle 12:00 |

Le lane precedenti hanno contatori separati:

| Flusso | Fornitore e modello | Ruolo | Token e fonte |
| --- | --- | --- | --- |
| Coordinamento strategico precedente | Anthropic `claude-fable-5` | Strategia e acquisizione dei report A e B | 3.687.032; artefatto di provenienza del 22 luglio |
| Sintesi precedente | Anthropic `claude-opus-4-8` | Sintesi dopo il ripiego automatico | 319.743; artefatto di provenienza del 22 luglio |
| Report A | OpenAI `gpt-5.6-terra/high` | Analisi dei flussi | 217.090; artefatto di provenienza del 22 luglio |
| Report B | OpenAI `gpt-5.6-sol/high` | Analisi del nucleo contrattuale | 299.822; artefatto di provenienza del 22 luglio |
| Report C | OpenAI `gpt-5.6-sol/high` | Analisi delle integrazioni e dell'esecuzione | 579.240; artefatto di provenienza del 22 luglio |
| Revisione avversaria | Anthropic `claude-opus-4-8/max` | Contratti AI in sola lettura | 68.978; campo `usage` del risultato CLI |
| Probe Opus UltraCode | Anthropic `claude-opus-4-8/max` | Probe isolato di agenti e workflow | 52.506; metadata del transcript locale |
| Critica UI Anthropic | Anthropic `claude-opus-4-8/max` | Consulto di design su testo redatto | non registrati; nessun risultato finale del fornitore |

L'artefatto del 22 luglio non documenta la formula di somma o l'esclusività
contabile. I cinque valori non formano quindi un totale aggregato.

Refresh finale del 24 luglio 2026 alle 12:47 CEST: 18 sessioni Codex collegate,
256.737.189 token totali. Il manager misura 110.470.240 token; le 17 sessioni
figlie misurano 146.266.949 token. La fonte è l'ultimo evento `token_count` di
ogni transcript collegato al programma. Questa fotografia comprende il merge e
la verifica post-merge; non sostituisce il punto di taglio dichiarato nel
changelog pubblico.

I futuri lookup meccanici usano Luna. I pacchetti deterministici usano Terra.
Sol resta responsabile dei confini, dell'integrazione e della verifica ad alto
rischio.

Fable è esaurito e non è una lane disponibile. Opus 4.8 è stato usato via CLI
come reviewer read-only a effort max, con transcript locale. Un probe isolato
ha verificato la rettifica di routing: la CLI ha accettato
`--settings '{"ultracode":true}'` con Opus, ma la sessione non ha riportato
UltraCode attivo e non ha creato alcun child. Il risultato è quindi
`UNSUPPORTED_NOT_CONFIRMED`; i task reali restano su Opus max standard.

Transcript probe:
`~/.codex/delegate-runs/claude/20260724-111142-opus-ultracode-capability-probe`.
Il probe ha misurato 2 token input, 43,295 token di cache creation e 9,209 token
output, inclusi 8,903 thinking token. Nessun file repository o dato sensibile è
stato fornito e nessun tool è stato invocato.

Il consulto UI Anthropic usa soltanto un packet testuale redatto. Il processo
ospite è terminato dopo 120 secondi prima di una risposta finale. Il transcript
parziale è conservato in
`~/.codex/delegate-runs/claude/20260724-mediflow-ui-critique/20260724-113314-341236`.
Non ha prodotto finding, non ha modificato decisioni e non è un gate.

Sol Ultra resta riservato a un solo fan-out con almeno tre workstream difficili
e indipendenti.

Transcript Opus read-only:
`~/.codex/delegate-runs/claude/20260724-093940-135841`.
Il risultato finale misura 68.978 token: 2 input, 24.726 di creazione cache,
28.307 letti dalla cache e 15.943 output.

## Evidenze consolidate

- L'inventario è partito da `main = origin/main` a `2876c583`. Dopo le due
  promozioni, `origin/main` è
  `1124b1dcf1117e3a26baec847b83e04314882cd9`.
- Il worktree manager era pulito prima della creazione del ramo manager.
- I worktree WUL-361 foundation e WUL-362 contract-gates contengono modifiche
  non committate. Il programma li preserva e non li modifica.
- La candidata ampia ha passato Node 24, 898 unit test, test AI/envelope,
  OCR, document synthesis, backup, network, soft-delete, FHIR, token locale,
  parity terminologica, typecheck, lint, claims, never-regress, build,
  standalone bundle e audit delle dipendenze di produzione. Questo risultato
  non amplia il perimetro della candidata di promozione.
- `validate:ai-task-contracts` resta `BLOCKED_EXTERNAL_MODEL`. In due run,
  `qwen3.5:35b-a3b` ha ottenuto 7/7 (`1.0`) e 6/7 (`0.857`), mentre
  `qwen3:32b` non è installato. La variabilità del modello non sostituisce i
  gate deterministici. Nessun modello è stato installato per aggirare il gate.
  L'utente ha autorizzato esplicitamente il merge della PR #139 con questo
  rischio residuo; il risultato non è registrato come `PASS`.
- Gli audit indipendenti approvano WUL-362 e WUL-353. Bloccano WUL-361 e Codex
  Operator fino a decisioni contrattuali e correzioni dedicate.
- La candidata AI/envelope ha passato i test mirati, 865 unit test, typecheck,
  lint, claims, never-regress, build e bundle su Node 24. Il suo audit di
  produzione ha rilevato tre vulnerabilita alte ereditate dalle dipendenze.
  WUL-519 e quindi un prerequisito separato, non un hunk della candidata AI.
- WUL-519 è al commit `64ed8876c45cc796e4387a2eaba9b896b0de34f6`.
  Il verifier indipendente è `APPROVE`. La PR #138 è stata unita in
  `69ed08b80a3425f16dc6c099613815d82ca1c5b0`.

## Handoff congelato Programma C / WUL-361

Handoff verificato il 2026-07-24:

- file: `~/.codex/state/codex-loop-runtime/projects/mediflow/spring-forward-2026-07-23/PROGRAM_C_WUL361_CODEX_ONLY_HANDOFF_2026-07-24.md`;
- SHA-256: `fac53a0e12671017c41ce3d31bc1366b9a0ea7c6a5cf2c63c343f3e54680939f`;
- stato: `SAFE_CHECKPOINT_HANDOFF_ONLY_NO_PROMOTION`.

Il worktree WUL-361 e `codex/WUL-361-diagnosis-review-foundation` a
`7d8b61fd3e0b33c4453ba15bbcbad724e9bb2a01`. Ha index vuoto e un solo diff
non staged, `lib/document-synthesis-source-bytes.test.ts`, con SHA-256
`409016879cd07129af20fd4205167a1423fbd79d049be9ec3d54c6fc3176c45c`.
Il candidato C2C2b0 V7 resta non promuovibile: un verifier ha dimostrato due
bypass TypeScript whole-program-valid. Il packet V8 e `DRAFT_REVIEW_REQUIRED`.

Classificazione: **programma Codex separato, review-only**. Non viene
archiviato, non viene assorbito dalla candidata AI/envelope e non riceve writer
senza una nuova attivazione esplicita del programma.

## Correzione successiva del confine AI/envelope

Il primo verifier della candidata stretta ha trovato un secondo root JSON
ignorato dopo un envelope valido e una scrittura automatica di diagnosi ad alta
confidenza. La correzione locale:

- rifiuta un secondo root JSON, inclusi array, primitivi e prefissi JSON
  incompleti, dopo il primo envelope;
- considera anche il testo dopo un blocco `json` recintato; il primo verifier
  ha dimostrato che ignorarlo lasciava usabili envelope conflittuali;
- mantiene le diagnosi estratte come materiale di revisione e non aggiorna
  automaticamente `patients.diagnoses`;
- aggiorna test, README e changelog al comportamento reale.

La prima candidata è al commit `5109613d8`. Il verifier finale Sol ha approvato
il fingerprint `fb050360fa6f6034d92420a5aac0c70212e0b613ceb2191ff99e880e7ef3527b`.

La candidata ricostruita parte dal merge WUL-519 `69ed08b80`. I primi dieci
commit applicano soltanto WUL-362/WUL-353. Il primo HEAD ricostruito era
`a675653aa14c1b4f4c5f1210d01d678b98f5fd8c`.

L'unico conflitto era in `CHANGELOG.md`. La risoluzione conserva sia la sezione
WUL-519 `Sicurezza` sia le sezioni AI `Migliorato` e `Confini`.

I gate Node 24 passano: AI contracts 80, AI context 60, Smart Import 21,
document synthesis 35, cockpit 7, unit, typecheck, lint, claims, never-regress,
build, bundle standalone e audit produzione a zero vulnerabilità.

Il verifier fresco V1 ha passato 203 test mirati, 54 probe avversariali,
typecheck, lint, claims, never-regress, build e bundle. Ha restituito
`FINDINGS` per una sola incongruenza documentale: la data di
`docs/markdown-index.md` non era stata aggiornata insieme ad ADR 0084.

La correzione di una riga è nel commit
`d1165f4dadb3f106e36a0ecdf6184722f541ff99`. Il diff binario completo rispetto
a `origin/main` ha SHA-256
`78edaad5d0bbaa82a74bd0f81191572db3b1a7f78c548dbf415c77a5e6f1cb04`.
Il verifier fresco V2 è `APPROVE` e autorizza la PR per questo fingerprint:
203 test mirati, 12 probe avversariali, 875 unit test, typecheck, lint, claims,
never-regress, build e bundle standalone sono passati.

La branch è stata pubblicata senza modifiche. Prima del merge, la PR #139 era
`MERGEABLE/CLEAN` e tutti i sette check remoti erano `success`.

L'utente ha autorizzato esplicitamente il merge con
`validate:ai-task-contracts = BLOCKED_EXTERNAL_MODEL`. La PR #139 è stata unita
il 2026-07-24 alle 09:22:38 UTC con merge commit
`1124b1dcf1117e3a26baec847b83e04314882cd9`. I parent sono la `main`
post-WUL-519 e l'HEAD verificato `d1165f4dadb3f106e36a0ecdf6184722f541ff99`.
Il tree del merge coincide con il tree verificato; il branch sorgente resta
presente.

Un worktree detached sulla nuova `main`, con Node 24.18.0, ha passato 203 test
mirati, 875 unit test, typecheck, lint, claims, never-regress, build, controllo
postbuild e bundle standalone. `npm audit --omit=dev` rileva zero
vulnerabilità. I workflow post-merge Repository Guards, Web Core,
Cross-platform ed E2E Playwright sono terminati con `success`.

Stato: `AI_ENVELOPE_CLOSED`. Il gate modello esterno resta un rischio residuo
esplicito, non un `PASS`.

## Stato WUL-519 separato

Il primo verifier WUL-519 ha trovato un falso verde nel checker standalone
Sharp e un changelog incompleto. La correzione finale è al commit
`64ed8876c45cc796e4387a2eaba9b896b0de34f6`. Il verifier Sol fresco è
`APPROVE`: checker contro binding e libvips reali, falsifier symlink, mapping
Windows dal lockfile e audit produzione a zero vulnerabilità.

La PR #138 era `MERGEABLE/CLEAN`. Tutti i sette check GitHub erano verdi.
`main` non aveva branch protection o ruleset aggiuntivi. La PR è stata unita
con merge commit `69ed08b80a3425f16dc6c099613815d82ca1c5b0`. Il branch sorgente
resta presente.

Un worktree detached sulla nuova `main` ha confermato l'identità del tree.
Unit, typecheck, lint, claims, never-regress, build, bundle e audit produzione
sono passati su Node 24. I quattro workflow post-merge su GitHub, inclusi E2E
Playwright, sono terminati con `success`.

## Audit UI/frontend per il closeout 0.8

Scope: superfici web Lume già esistenti, senza redesign e senza dati clinici
reali.

Evidenze:

- il detector Impeccable non rileva anti-pattern nelle superfici selezionate di
  worklist, scheda, revisione documentale e lock screen;
- il contratto Lume misura 42 coppie di contrasto e tutte superano la soglia
  4,5:1;
- i 30 test dei token e i 9 test del budget di movimento passano;
- le suite E2E esistenti coprono viewport da 390 px, overflow, focus, nomi
  accessibili, registri chiaro/scuro e riduzione del movimento;
- il gate palette conserva 1.437 occorrenze di debito storico allowlisted,
  incluse 189 occorrenze su superfici cliniche. Il debito non è introdotto da
  questa tranche e non viene mascherato come risolto.

Verdetto: `APPROVE_AUDIT_ONLY`. Non emerge una modifica UI minima che giustifichi
rischio e costo di un packet di release. Nessun packet UI viene aperto e nessun
file frontend viene modificato. Il futuro affinamento resta separato e richiede
owner, screenshot sintetici, test responsive/accessibilità e verifier
indipendente.

La critica Anthropic usa Opus 4.8 via CLI su un inventario testuale redatto. Il
processo non produce una risposta finale prima del timeout del processo ospite.
Non cambia il verdetto e non è un gate. La capability Claude/Claudie Design
dell'app Anthropic non è stata usata: non era una superficie callable nella
sessione e non era necessaria per chiudere l'audit locale.

## Candidata documentale di closeout

Branch: `codex/WUL-362-ai-provider-closeout-docs`, basata su
`1124b1dcf1117e3a26baec847b83e04314882cd9`.

Il diff aggiorna soltanto `README.md`, `CHANGELOG.md` e
`docs/repository-topology.md`. Distingue stato implementato e direzione futura:

- le funzioni deterministiche restano disponibili senza un modello;
- il percorso AI locale richiede Ollama configurato;
- Ollama resta l'unico fornitore AI operativo;
- provider esterni, consenso e egress non sono consegnati;
- proposta, chiarimento e scrittura autorizzata restano fasi separate;
- nessun claim di compliance, anonimizzazione garantita o superiorità clinica.

Il primo verifier documentale ha restituito `FINDINGS` sul fingerprint
`506b3741b1fff32df2b6e5f868ed0dcea45a231e4d5ad170c2c7eaa32fab974f`:

- il README negava in modo troppo ampio le scritture AI, mentre Patient Insight
  può aggiornare `patients.aiSummary` quando la funzione è abilitata;
- il changelog estendeva il rifiuto a ogni collegamento simbolico invece di
  limitarlo ai percorsi reali che escono dal pacchetto standalone;
- il testo non distingueva le funzioni deterministiche dal percorso AI locale
  che richiede Ollama;
- il riepilogo dei token ometteva contatori locali disponibili e lane
  precedenti.

La correzione restringe il claim di conferma a diagnosi, terapie e altri dati
clinici strutturati, descrive il controllo reale dei collegamenti simbolici,
semplifica la terminologia e registra perimetro, metodo e limiti dei conteggi.

Con Node 24.18.0 passano `git diff --check`, l'inventario dei 143 file Markdown
e `npm run check:claims` su 466 file, con zero claim ad alto rischio. Il nuovo
diff congelato ha SHA-256
`f73f8c1a744fd61f0f9c5e5d0ea96b3cab927ff9a9287bdd78b25b0aef942c1e`.
Il verifier Sol fresco e read-only è `APPROVE` e autorizza la PR soltanto per
questo fingerprint.

Il commit `de10cbffdd1e9d91165ae4232b78e9228f122c10` conserva lo stesso
fingerprint. Il branch remoto coincide con il commit verificato e resta
recuperabile.

## Promozione documentale e verifica post-merge

Prima del merge, la PR #140 era `MERGEABLE/CLEAN`, con base
`1124b1dcf1117e3a26baec847b83e04314882cd9` e HEAD
`de10cbffdd1e9d91165ae4232b78e9228f122c10`. I sette controlli remoti erano
verdi. La piattaforma non applicava branch protection o ruleset aggiuntivi a
`main`.

La PR #140 è stata unita con merge commit il 24 luglio 2026 alle 12:38 CEST:

- merge: `4fbc8ee74d548949166f76d67fb1d419f48230c0`;
- primo genitore: `1124b1dcf1117e3a26baec847b83e04314882cd9`;
- secondo genitore: `de10cbffdd1e9d91165ae4232b78e9228f122c10`;
- tree: `2a37dac8b802b523107d759dcbf324a9e158a920`, identico al tree del
  commit verificato;
- branch e worktree conservati.

Un worktree detached sulla nuova `main`, con Node 24.18.0, ha passato:

- `git diff --check`;
- inventario di 143 file Markdown;
- claims guard su 466 file, con zero claim ad alto rischio;
- 875 test unitari;
- typecheck e lint;
- `check:never-regress`;
- build Next.js e controllo del bundle standalone.

Il build segnala un warning Turbopack sulla lista NFT di `next.config.ts`. Il
warning non blocca il build e non è introdotto dal diff documentale, che tocca
solo README, changelog e topologia.

Sul merge commit sono terminati con `success` anche i quattro workflow di
`main`: Cross-platform, Repository Guards, Web Core ed E2E Playwright. Il
changelog non richiede un nuovo diff: la PR #140 ha già promosso il testo
verificato e il merge non aggiunge cambiamenti di prodotto.

## Decision audit

| Decisione | Evidenza | Alternativa | Falsificatore | Stato |
| --- | --- | --- | --- | --- |
| Usare `main` come unica base candidata | `main` e `origin/main` coincidono | Integrare una Wave composita | Un commit richiede un predecessore non selezionato | accepted |
| Separare i candidati per boundary | Worktree e commit sono indipendenti | Promuovere la Wave 3 completa | Un diff dimostra dipendenza obbligatoria | accepted |
| Trattare Codex Operator come condizionale | Il diff introduce gateway e contesto clinico | Includerlo per prossimità | Audit trova egress, leakage o auth debole | corrected: excluded |
| Escludere WUL-361 dalla candidata | ADR 0083 conserva un conflitto contrattuale aperto | Promuovere l'autofill ad alta confidence | L'owner ratifica un contratto completo e i gate aggiornati passano | accepted |
| Escludere Codex Operator dalla candidata | Audit indipendente ha trovato quattro blocker | Promuovere una lane personale sperimentale | Correzioni e decisioni owner rendono la lane verificabile | accepted |
| Applicare review-only alle diagnosi AI | Decisione utente del 24 luglio | Autofill automatico ad alta confidence | Qualunque persistenza senza gesto operatore | accepted |
| Ridurre la candidata a WUL-362 e WUL-353 | Decisione utente del 24 luglio | Includere candidati non-AI già testati | Un nuovo candidato richiesto dal perimetro AI/envelope | accepted |
| Promuovere WUL-519 prima della serie AI/envelope | Audit di produzione della candidata AI: 3 vulnerabilita alte ereditarie | Fondere i diff o ignorare l'audit | WUL-519 non passa test o verifier indipendente | accepted |
| Congelare WUL-361 come programma separato | Handoff con SHA verificato e V8 non approvato | Assorbire il diff nella candidata stretta | Qualunque writer o merge senza nuova attivazione esplicita | accepted |
| Rendere le diagnosi documentali review-only | Direttiva utente e finding del verifier su `patients.diagnoses` | Conservare l'autofill ad alta confidenza | Un test o un diff mostra una scrittura automatica | accepted |
| Rifiutare ogni root o fence ambiguo | Falsifier su secondo root, repair-path e resolver | Selezionare il primo envelope | Un input ambiguo resta `usable` | accepted |
| Tenere la scrittura Codex fuori dalla candidata | Nuovo requisito utente e confine privacy | Implementare una scrittura diretta ora | Manca packet, ADR, threat model o consenso contestuale | accepted |
| Unire WUL-519 con merge commit | Check verdi, HEAD verificato, PR pulita | Squash o rebase | Il merge tree differisce dal branch verificato | accepted |
| Ricostruire AI da nuova `main` | Sequenza esplicita dell'utente | Rebase del vecchio worktree | Il diff include WUL-361 o Codex Operator | accepted |
| Conservare entrambe le sezioni changelog | Unico conflitto fra WUL-519 e AI | Scegliere una sola variante | Un claim verificato scompare | accepted |
| Aggiornare la data dell'indice Markdown | Finding V1 e checklist dello stesso indice | Lasciare la data precedente | Il commit modifica più della sola data | accepted |
| Aprire la PR AI come draft | Verifier V2 `APPROVE`, ma gate modello esterno bloccato | Segnarla pronta o unirla subito | I check remoti non passano | accepted, poi superata dall'autorizzazione al merge |
| Unire la PR #139 con un gate esterno residuo | Autorizzazione utente esplicita, sette check verdi e verifier `APPROVE` | Attendere `qwen3:32b` | Il merge tree differisce dall'HEAD verificato | accepted |
| Registrare il gate modello come `BLOCKED_EXTERNAL_MODEL` | `qwen3:32b` assente e `qwen3.5` variabile | Dichiarare `PASS` dai gate deterministici | Un run live stabile supera il gate previsto | accepted |
| Documentare provider opzionali come direzione futura | Il codice implementa solo Ollama e un gate egress chiuso | Presentare il cloud come capability corrente | Un provider esterno operativo appare nel diff | accepted |
| Non modificare la UI nel closeout | Detector mirato, contrasto, token e motion sono verdi | Creare un polish cosmetico | Un finding P0/P1 verificato richiede correzione | accepted |
| Non eseguire ancora il version bump 0.8 | Contenuti e PR documentale non sono ancora chiusi | Aggiornare subito package e badge | Tutti i checkpoint 0.8 risultano chiusi | accepted |
| Limitare il claim sulle scritture AI | `aiSummary` può essere aggiornata quando la funzione è abilitata | Negare ogni scrittura AI automatica | Il runtime aggiorna una diagnosi o terapia senza conferma | corrected |
| Descrivere il controllo symlink reale | Il checker convalida il percorso reale dentro il pacchetto | Dichiarare il rifiuto di ogni symlink | Un symlink interno al pacchetto viene accettato | corrected |
| Separare funzioni deterministiche e Ollama | `AIService.create` usa l'unico connettore Ollama | Dichiarare sempre disponibile tutto il percorso AI | Ollama non configurato rende indisponibile il modello | corrected |
| Congelare i token con un orario | Il record Codex misura 16 sessioni alle 12:00 CEST | Aggiornare numeri senza un punto di taglio | Un conteggio successivo viene presentato come parte della fotografia | accepted |
| Non sommare il report provider del 22 luglio | La fonte non documenta formula o esclusività | Creare un totale aggregato | La fonte certifica una partizione contabile completa | accepted |
| Aprire la documentazione come PR draft | Verifier fresco `APPROVE` sul fingerprint e nessun version bump | Unire subito la documentazione | I controlli remoti falliscono o manca autorizzazione al merge | accepted |
| Unire la PR #140 con merge commit | Autorizzazione utente, identità esatta, stato `MERGEABLE/CLEAN` e sette check verdi | Squash o rebase | Il merge tree differisce dal tree verificato | accepted |
| Chiudere il consolidamento su `main` | Tree identico, gate locali verdi e quattro workflow post-merge verdi | Lasciare il programma candidate-ready | Un gate post-merge fallisce o `origin/main` diverge | accepted |
| Conservare branch e worktree | Direttiva utente e necessità di una traccia recuperabile | Pulire subito dopo i merge | Nuova autorizzazione con target esatti e recuperabili | accepted |

Unverified edges: `qwen3:32b` non installato, variabilità del run
`qwen3.5:35b-a3b` e nove omissioni Markdown pregresse, identiche alla base,
rilevate dal verifier. Il debito palette Lume allowlisted resta fuori dal
closeout UI corrente.

Promozione AI/envelope: **completata**.

Promozione documentazione: **completata con la PR #140 e verificata sulla nuova
`main`**.

Consolidamento: **completato**.

Release 0.8: **pianificata, nessun version bump**.
