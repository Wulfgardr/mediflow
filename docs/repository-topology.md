---
summary: "Canonical MediFlow repository ownership, publication boundary, and top-level directory map."
read_when:
  - "Deciding which repository, branch, or worktree is authoritative."
  - "Placing code, documentation, publication assets, or private local artifacts."
---

# Dove vive MediFlow: topologia della repository

Ultimo aggiornamento: 2026-09-05

Mappa concisa delle aree top-level del repository, pensata per orientare agent e
contributor: distingue il **runtime clinico** (codice che gira con dati paziente)
dagli **artefatti di pubblicazione/sito** e dagli **strumenti di sviluppo**.

## Orientarsi prima dei percorsi

Il gestionale si costruisce qui. Per orientarsi, conviene distinguere tre aree: il prodotto che lavora sulla
cartella, gli strumenti che lo costruiscono e verificano, e i documenti che lo
spiegano. Il sito [Get MediFlow](https://getmediflow.dev) è il riferimento di presentazione del prodotto: non
ospita la cartella, non importa i servizi clinici e non riceve dati del runtime.

Per chi arriva al progetto: [Inizia qui](./start-here.md). Per la candidatura
in esame: [readiness 0.8.5](./release-085-readiness.md). Per il sito e l'ordine della documentazione: [piano editoriale](./getmediflow-editorial-proposal.md).

## Repository operativa

[`Wulfgardr/mediflow`](https://github.com/Wulfgardr/mediflow) e l'unica
repository canonica per sviluppo, issue, branch, pull request, tag e release.
La precedente repository privata `Wulfgardr/mediflow_private` e archiviata: non
e una seconda mainline e non riceve piu lavoro operativo.

Non esiste un flusso di export private-to-OSS. Tutto cio che puo essere
pubblicato nasce e viene revisionato qui; database, PHI/PII, credenziali,
runtime artifact e fonti riservate restano fuori da Git secondo
[`SECURITY.md`](../SECURITY.md).

> [!IMPORTANT]
> Le directory di **publication/site** non vanno trattate come parte del runtime
> clinico: non contengono PHI, non vengono caricate dal server Next.js e non
> devono essere referenziate da codice di produzione.

## 🧱 Aree

| Path | Categoria | Note |
| --- | --- | --- |
| `app/` | runtime clinico | App Router Next.js (UI + API). |
| `components/` | runtime clinico | Componenti React condivisi. |
| `lib/` | runtime clinico | Logica di dominio, accesso DB, servizi AI. |
| `hooks/` | runtime clinico | Custom React hooks. |
| `drizzle/` | runtime clinico | Schema e migrazioni database locale. |
| `native/` | runtime clinico (client) | Client macOS/iOS/iPadOS. |
| `e2e/` | qualità | Test end-to-end Playwright. |
| `scripts/` | tooling | Script di build, test, benchmark, smoke. |
| `public/` | runtime clinico (asset) | Asset statici serviti dall'app. |
| `docs/` | documentazione | Documentazione canonica del progetto. |
| **`whitepaper/`** | **publication/site** | **Whitepaper/sito di pubblicazione. Non è runtime clinico, non importare da `app/`, `components/`, `lib/`.** |
| `oss-assets/` | publication/site | Asset pubblici storicamente raccolti per la distribuzione open source. |
| `tmp-*/` | tooling effimero | Output di test e build temporanei (in `.gitignore` o esclusi dal typecheck). |
| `tmp/` | tooling effimero | Scratchpad locale. |
| `Farmaci/` | dati di riferimento | Dataset farmaceutici di riferimento. |
| `certs/` | dev tooling | Certificati TLS locali per dev. |

## Confine Application Services, Fabric e integrazioni opzionali

La topologia intelligente della 0.8.5 resta
host-owned e locale:

- `app/api/ai/{patient-insight,smart-import,document-synthesis,treatment-reasoning}/`
  contiene gli adapter HTTP autenticati dei quattro smart path generativi;
- `lib/ai-providers/fabric/` contiene resolver, production root, lifecycle,
  receipt, selector guidato e binding atomici governati dall'host;
- `lib/ai-providers/v2/` contiene contratto provider, secret broker, adapter
  HTTPS ufficiali e probe review-only OpenAI/Anthropic `default OFF`;
- `packages/aip/`, `packages/mcp/` e `packages/mini/` contengono il broker
  portabile e le superfici figlie candidate, senza import diretti del database;
- quando configurato, Ollama serve Patient Insight, Smart Import e Document
  Synthesis;
- quando configurata, ATHENA su MLX serve soltanto Treatment Reasoning, con
  lifecycle separato da Ollama;
- AnyDoc esegue l'unica estrazione automatica deterministica locale degli
  allegati e non è un provider o una venue Fabric;
- `lib/ai-egress-gate.ts` e `lib/ai-egress-audit.ts` mantengono la chiusura
  sicura in caso di errore (`fail-closed`) e un registro locale privo di
  contenuto clinico.

ATHENA è inclusa soltanto con runner e modello locali configurati. L'override
host-owned `MEDIFLOW_ATHENA_MLX_GENERATE_BIN` accetta un eseguibile assoluto
`mlx_lm.generate`, senza argomenti o shell. Il launcher `uvx` predefinito opera
offline e fallisce chiuso se la cache richiesta non è disponibile; non prova
readiness universale.

Il caller presenta soltanto input applicativo tipizzato. Non sceglie provider,
modello, endpoint, venue, prompt, fallback o apply. Ogni smart path restituisce
una proposta review-only con receipt, provenienza e currentness; il production
root host-owned resta l'unico punto di composizione.

AnyDoc resta il primo passaggio. Per i PDF supportati, il tree classifica,
materializza e renderizza soltanto le pagine `needsOcr`, quindi usa Apple
Vision localmente sul Mac e ricompone il risultato sotto currentness
host-owned. Il percorso è review-only e fallisce chiuso. DeepSeek-OCR 2/CUDA
resta `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`; il tree ne conserva soltanto il
contratto e seam sintetiche. Le route OCR legacy, dopo l'autenticazione,
rispondono `410`.

OpenAI e Anthropic hanno adapter HTTPS ufficiali e probe Document Synthesis
review-only. Restano `default OFF` e richiedono lifecycle, secret reference e
policy egress/retention host-owned. I test usano transport fake: il tree non
contiene credenziali o prove di rete live. Login consumer e subscription non
equivalgono a una credenziale di inferenza.

Il selector Fabric opera sulle cinque capability nominate. La discovery mostra
profili compatibili, lo smoke usa fixture sintetiche e l'attivazione del binding
è atomica, versionata e reversibile. Non persiste segreti e non qualifica il
runtime.

Un futuro plug-in non può accedere direttamente al database. Può ricevere solo
il contenuto minimo dopo regole, attivazione esplicita, controlli verificati e
registrazione. La redazione o pseudonimizzazione deve essere dimostrata per il
flusso specifico. MediFlow non dichiara anonimizzazione garantita.

Le funzioni deterministiche restano disponibili senza provider. Receipt e
provenienza descrivono l'esecuzione, ma non autorizzano un apply o una scrittura
clinica.

L'[ADR 0086](./adr/0086-intelligent-scaffold-and-graded-automation-boundary.md)
propone la sequenza comune
`pipeline locale -> proposta -> chiarimento -> anteprima -> autorizzazione ->
eventuale scrittura auditata`. Non aggiunge una nuova area runtime. La inbox
conversazionale e l'automazione graduata restano roadmap.

## Confine Headless 0.8.5

Un launcher trusted avvia un processo figlio autenticato con ambiente
allowlisted e RPC AIP ereditato. MCP `stdio` espone catalogo, terminology
search, Open Loops patient-scoped, proposta follow-up `proposal_only` e query
semantica bounded read-only. Mini condivide catalogo e foundation CLI ma non ha
un callsite production del Supervisor e fallisce chiuso senza parent AIP. Gli
adapter non importano SQLite, non duplicano regole di dominio e non aprono
listener.

Authority, purpose, selezione, scope, lease, currentness e audit restano
host-owned. Il Supervisor Node locale è il parent trusted e avvia Web
standalone e MCP come figli distinti su IPC privato ereditato. Il percorso non
usa broker residente o UDS. La 0.8.5 non dichiara installer, onboarding o
compatibilità con host MCP esterni.

La transizione stato checkup F10 collega la preview MCP al commit nella UI Web
trusted. MCP non riceve proof e non può eseguire il commit. Il Web rilegge la
risorsa e richiede ruolo medico attivo, step-up e gesto operation-specific,
quindi applica CAS, idempotenza, audit e receipt atomici.

La topologia distingue due modalità e non le unisce:

- **provider-in-MediFlow**: il Fabric governa il provider che esegue una
  capability MediFlow; i quattro path locali appartengono a questa modalità;
- **MediFlow-in-intelligent-host**: MCP usa RPC AIP ereditato sopra gli stessi
  Application Services; Mini resta una foundation CLI non collegata in
  production.

La seconda modalità ha un entrypoint locale tramite Supervisor. Il
tree non promette installer, onboarding, compatibilità con host MCP esterni o
integrazione con sessioni consumer. Qualunque OAuth provider futuro deve usare
soltanto un contratto ufficiale, senza token privati o flussi ricostruiti.

Il planner semantico è collegato al Supervisor e resta read-only. Compone al
massimo due operazioni allowlisted, non produce SQL libero e non scrive dati.
La shell macOS integra la registrazione visita con API Apple on-device su
macOS 26 o successivo, consenso esplicito, audio bounded solo in RAM e review
del transcript. Non esiste writer clinico automatico; prova con microfono reale
e validazione clinica restano fuori dal claim della 0.8.5.

## ⚠️ Regole operative

- Modifiche a `whitepaper/` **non** richiedono test del runtime clinico né
  rebuild dei moduli nativi: è un artefatto di pubblicazione.
- Codice in `app/`, `components/`, `lib/`, `hooks/` non deve importare da
  `whitepaper/` o `oss-assets/`.
- I path `tmp-*/` sono esclusi da `tsconfig.typecheck.json` (vedi `exclude`).
- Non creare mirror operativi o pipeline di export verso la repository privata
  archiviata.
- Un clone storico puo mantenere remote locali differenti, ma il remote usato
  per branch, push e release deve puntare alla repository pubblica canonica.
- Per la lista completa dei `.md` tracciati, vedi
  [docs/markdown-index.md](./markdown-index.md).

## Ciclo di vita dei branch — lease di promozione

Regola adottata il 2026-08-07, dopo il collegio sul residuo `WUL-362`.

> Ogni branch diverso da `main` deve essere **o** il branch attivo di un worktree
> dedicato a un'issue aperta, **o** la head di esattamente una pull request aperta
> verso `main`. Quando nessuna delle due condizioni vale, il branch è **senza lease**:
> non può ricevere altri commit.

Chiudere un branch richiede una **disposizione terminale esplicita**, registrata
nell'issue o nel run record, e solo dopo si rimuove il ref:

| disposizione | quando | cosa registrare |
|---|---|---|
| `merged` | il lavoro è entrato via PR | il numero di PR |
| `superseded-by <PR o SHA>` | il lavoro è arrivato su `main` per altra via, o è stato reimplementato | la destinazione verificabile |
| `abandoned` | il lavoro non serve più | il motivo |

Il motivo della regola. Il residuo `codex/WUL-362-contract-gates` non era un branch
d'integrazione: era un branch di lavoro ordinario creato da `main` il 21 luglio, a cui
il 6 agosto è stato aggiunto un commit `wip: igiene di sessione` — la stessa spazzata
applicata in contemporanea ad altri quattro branch. Quel commit ha reso il branch
indistinguibile da uno con lavoro residuo, e ogni triage successivo ha dovuto
ridimostrare da zero che non contenesse nulla. La lease impedisce esattamente questo:
un branch senza lease non può essere contaminato da una spazzata.

Due avvertenze che il collegio ha ritenuto vincolanti:

- **`git cherry` è un segnale, non l'autorità di cancellazione.** Si fonda
  sull'equivalenza di patch-id, quindi è cieco al lavoro reimplementato invece che
  ricopiato; e se `main` applica una patch e poi la reverte, `git cherry` continua a
  mostrarla come integrata. Usarlo nel closeout, mai come criterio automatico.
- **Il confronto blob-per-blob non lo sostituisce**: fallisce su rename, refactor e
  reimplementazioni semantiche.

La lease governa il *ciclo di vita del ref*, non la *completezza del lavoro*: un branch
può scadere correttamente portandosi via lavoro mai promosso e mai notato. La lease non
se ne accorge, perché guarda il ref e non l'albero. La contromisura per quel fallimento
è di natura diversa — un gate che verifica la coerenza dell'albero, come
`npm run check:schema-writers`, che rende visibile in CI la differenza fra un'assenza
decisa e un'assenza dimenticata: nello schema hanno lo stesso aspetto.

## Gate del confine AI → scrittura clinica

`npm run check:ai-clinical-writes` (`scripts/check-ai-clinical-write-gate.mjs`) è la
traduzione eseguibile di [ADR 0084](./adr/0084-document-diagnoses-review-only.md) e
[ADR 0086](./adr/0086-intelligent-scaffold-and-graded-automation-boundary.md), fino a
oggi affidate alla sola disciplina.

Nella 0.8.5 i quattro smart path attraversano route autenticate. La
route resta un adapter: il punto di enforcement è il **production root e il
writer del servizio**. Un controllo limitato ai nomi delle route non dimostra
la separazione tra proposta e scrittura.

Il confine ha due lati e il gate controlla entrambi:

1. **Il percorso AI scrive solo proiezioni derivate.** Ogni scrittura in un
   modulo scansionato del percorso AI dev'essere dichiarata, e i campi scritti
   devono stare nell'allowlist della lane: `documentInsights` per la sintesi
   documentale, `aiSummary` e i suoi metadati per Patient Insight. Il guard
   riporta a ogni esecuzione il conteggio corrente dei file analizzati, senza
   fissarlo nella documentazione. L'allowlist è a sua volta verificata:
   ammettere `diagnoses` fa fallire il gate, quindi non si aggira allargandola.
2. **La lane che può scrivere dati clinici non importa il percorso AI.** È ciò che rende
   la revisione umana una proprietà strutturale invece che una convenzione: proporre e
   applicare restano due percorsi separati, e l'operatore che seleziona i candidati sta
   in mezzo. Se `commitPatientSmartImport` potesse chiamare un modello per riempire
   `diagnoses`, la selezione esplicita diventerebbe decorativa senza che nessun test se
   ne accorga.

Come `check:schema-writers`, l'allowlist è stale-sensitive nelle due direzioni: un
contratto che non descrive più una scrittura reale fa fallire il gate tanto quanto una
scrittura non dichiarata. `--self-test` verifica che il gate sappia distinguere le forme
di scrittura dai casi leciti che gli somigliano — un `Map.delete` ha la stessa forma di
`tx.delete(<table>)`, e il divieto di `auto_apply` non deve segnalare sé stesso.
