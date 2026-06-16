<!-- Codex: WUL-295 -->
# ADR 0067: Agentic development operating loop

Date: 2026-06-01
Status: Proposed

Status note: `Proposed` while the `WUL-295` PR is under review. If merged, this
becomes the accepted internal operating loop unless superseded by a later ADR.

Related: [docs/linear-codex-playbook.md](../linear-codex-playbook.md),
[docs/codex-workflow-monitor.md](../codex-workflow-monitor.md),
[docs/codex-opus-dialogue.md](../codex-opus-dialogue.md),
[docs/adr/0063-local-workflow-monitor-control-plane.md](./0063-local-workflow-monitor-control-plane.md),
[SECURITY.md](../../SECURITY.md),
[AGENTS.md](../../AGENTS.md)

## Problema

MediFlow dispone gia di Codex, RepoPrompt, Linear, workflow monitor, skill di
delega Claude/Gemini e agenti specializzati. Senza un contratto operativo
scritto, questi strumenti rischiano due fallimenti opposti:

- restare sottoutilizzati, con lavoro che si ferma in chat o in decisioni non
  persistite;
- diventare un control plane troppo ampio, capace di confondere revisione,
  implementazione, tracker, Git e dati clinici.

Serve un operating loop che faccia fruttare il pool agentico mantenendo Codex
controller-of-record e rispettando i boundary local-first, privacy e
review-first di MediFlow.

## Contesto

I vincoli esistenti restano invariati:

- una issue Linear per ogni lavoro non banale;
- un branch dedicato per ogni workstream;
- decisioni persistenti in ADR, `PLANS.md` o documenti canonici;
- nessun PHI/PII in prompt, repo, log, delegate transcript o artifact;
- nessun side effect esterno sensibile senza conferma esplicita nel turno;
- il workflow monitor legge solo metadati Git/check redatti;
- Claude/Opus e Gemini sono fonti di proposta, review o discussione, non fonti
  di verita o autorita finale.

Nel contesto Codex, gli strumenti esterni devono restare deleghe bounded: Codex
riconcilia, verifica localmente, implementa o rifiuta, aggiorna Linear e porta
la responsabilita finale del delivery.

## Opzioni

1. Continuare con deleghe ad hoc e decisioni in chat.
2. Costruire un manager agentico autonomo con side effect diretti su Git,
   Linear e documenti.
3. Formalizzare un operating loop governato: Codex dirige, RepoPrompt cura il
   contesto, Linear contiene il lavoro, `/goal` governa i workstream lunghi,
   Claude/Gemini/agent pool operano come delegate bounded e il monitor locale
   intercetta drift.

## Trade-off

- Opzione 1:
  - Pro: zero overhead nuovo.
  - Contro: spreca gli strumenti installati e lascia decisioni importanti fuori
    dal repo.
- Opzione 2:
  - Pro: massima ambizione operativa.
  - Contro: troppo rischiosa per un progetto sanitario local-first; confonde
    review, action authority e privacy boundary.
- Opzione 3:
  - Pro: sfrutta il pool senza cedere il controllo; produce traccia
    verificabile; scala per issue, branch e PR.
  - Contro: richiede disciplina di triage, prompt packet piccoli e gestione
    esplicita dei blocker.

## Decisione

Adottiamo l'opzione 3.

L'operating loop ha questi ruoli:

- **Codex**: chief software officer operativo nel contesto della sessione Codex,
  implementatore quando opportuno, reviewer finale, owner di scope, verifiche,
  Linear, Git e handoff.
- **RepoPrompt**: layer di contesto e token discipline. Va bindato alla root
  reale del progetto prima di lavoro sostanziale e usato per selezionare file,
  generare export e delegare agenti quando riduce pressione di contesto. Non e
  il luogo in cui assumere l'esecuzione di modelli web-only.
- **Linear**: sistema operativo del lavoro. Ogni slice non banale deve avere
  issue, branch, acceptance criteria, evidenza e stato.
- **`/goal`**: contratto di completamento per workstream multi-step. Il goal
  deve dichiarare end state, evidenza, vincoli, strumenti ammessi, stop rule e
  handoff.
- **Claude/Opus**: chief design/product proposer e senior reviewer UI/UX. Nel
  Parlamento settimanale porta una tesi originale: proposta ambiziosa, slice
  prudente, rischio da non ignorare e prompt di cross-exam per Gemini. Non e
  semplicemente un agente a cui "chiedere" idee. ChatGPT/Codex produce una
  tesi originale parallela sullo stesso packet prima della sintesi, non solo una
  valutazione dopo Claude. Codex resta il capo operativo: mette in conflitto le
  tesi, decide cosa promuovere, riformulare, sospendere o rifiutare e verifica
  localmente. Come escalation Claude puo usare `workflow` o `ultracode` solo
  per lavori larghi, paralleli o adversarial; resta read-only, redatto e con
  transcript.
- **Gemini**: adversarial scout e cross-exam reviewer. Di norma risponde a un
  dossier Codex/Claude, cerca assunzioni fragili, alternative piu piccole,
  rischi nascosti e verifiche locali concrete. Le sue conclusioni sono lead da
  verificare localmente.
- **RepoPrompt agent pool**: puo esplorare, progettare o implementare slice
  bounded, ma Codex deve aspettare gli agenti avviati, risolvere eventuali
  richieste di input e verificare prima di chiudere il turno.
- **Workflow monitor / codexbar-style guard**: freno deterministico su branch,
  issue, scope, path sensibili e check dichiarati. Non legge contenuti clinici.
- **ChatGPT web 5.5 Pro / Extended Pro**: canale web per ragionamento puro,
  discussione prospettica, sintesi difficile e confronto di opzioni quando la
  richiesta supera il ruolo di context pack di RepoPrompt. Si avvia tramite
  Chrome/Computer Use o skill dedicata, con prompt costruito da Codex e
  contesto minimizzato.
- **ChatGPT Deep Search / Deep Research**: canale web per reperimento fonti
  esterne quando il lavoro dipende da letteratura, documentazione web, norme,
  benchmark pubblici o confronto con stato dell'arte non presente nel repo.
  Non riceve PHI/PII o materiale privato senza autorizzazione esplicita e usa
  heartbeat di controllo ogni 30 minuti durante run lunghi.
- **OpenClaw**: possibile sidecar locale di workflow per brief, preview
  sintetiche, pattern redatti e futuri `review_candidate`. Non entra nel
  runtime clinico, non legge SQLite, non chiama API MediFlow, non applica
  cambi, non usa dati reali o modelli esterni senza gate esplicito. L'apply
  resta in una superficie MediFlow con decisione Codex e conferma operatore.

Claude/Gemini CLI non sono prerequisiti per avanzare se una delega va in
timeout o manca l'autenticazione. In quel caso Codex riduce il pacchetto una
volta, prova un fallback ragionevole o continua con evidenza locale dichiarando
il blocker della lane delegata.

Ogni proposta non banale deve rispettare la costituzione di proposta:

- dichiarare il problema e perche e interessante adesso;
- mostrare almeno un mini mock visuale o una mappa leggibile quando la proposta
  riguarda UI, UX, flusso, architettura, ruoli agentici o esperienza operatore;
- per le proposte generate da Claude, includere sempre una tesi originale con
  versione ambiziosa, versione prudente, rischio e prompt di cross-exam per
  Gemini;
- per ChatGPT/Codex, includere sempre una tesi originale parallela generata dal
  medesimo packet prima della sintesi, valutazione autonoma,
  accordi/disaccordi con Claude, decisione provvisoria e verifica locale
  richiesta;
- per il report del run, dichiarare l'ordine operativo: packet, tesi indipendenti
  o motivo della mancata indipendenza, matrice di conflitto, cross-exam Gemini e
  decisione finale Codex;
- per le risposte Gemini, produrre sempre assunzioni fragili, alternativa piu
  piccola, rischi nascosti e verifica locale concreta;
- per OpenClaw, limitarsi a brief/preview/candidate sidecar e dichiarare il
  gate che impedisce apply o accesso runtime;
- separare esplorazione immaginativa da commitment implementativo;
- indicare fonti gia disponibili, fonti da cercare e incertezza residua;
- usare RepoPrompt per costruire il pacchetto di contesto e ridurre token prima
  dei confronti complessi multi-file/multi-opzione;
- usare ChatGPT web 5.5 Pro / Extended Pro per ragionamento puro quando serve
  quel modello web-only, passando da Chrome/Computer Use o skill dedicata;
- usare ChatGPT Deep Search/Deep Research per reperimento esterno source-heavy,
  con heartbeat ogni 30 minuti e risultato preservato come artifact prima di
  trasformarlo in backlog o decisioni;
- chiudere con una first thin slice verificabile, non con una roadmap generica.

## Conseguenze

Diventa piu facile:

- evitare stalli quando un delegate fallisce o resta senza output;
- distinguere decisione, implementazione e review;
- mantenere issue, branch, PR e verifiche coerenti;
- usare modelli costosi solo quando il valore giustifica il costo.
- rendere visibili idee, trade-off e alternative prima di impegnare codice.

Diventa piu difficile:

- avviare lavori generici senza contenitore;
- fare side effect opachi su Linear, Git, mail, calendario o sistemi esterni;
- trattare output di delegate come decisione gia verificata.
- accettare proposte puramente verbali su superfici visive o flussi complessi.

Stop rule obbligatorie:

- PHI/PII o materiali clinici reali in prompt/deleghe;
- branch senza issue per lavoro non banale;
- delegate che richiede write access non autorizzato;
- modifica di runtime clinico, API, schema o security boundary senza ADR/issue
  adeguati;
- tre iterazioni `/goal` con lo stesso blocker senza nuovo percorso praticabile.

## First Thin Slice

1. Creare questa ADR proposta.
2. Aggiungere un runbook operativo interno per il ciclo settimanale e
   per-workstream.
3. Aggiornare mappa documentale, indice Markdown e attribution.
4. Escludere il runbook e questa ADR dall'export OSS se contengono riferimenti a
   coordinamento interno, Linear o agenti.
5. Verificare con `git diff --check` e workflow monitor su `WUL-295`.
