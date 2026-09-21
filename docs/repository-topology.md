---
summary: "Canonical MediFlow repository ownership, publication boundary, and top-level directory map."
read_when:
  - "Deciding which repository, branch, or worktree is authoritative."
  - "Placing code, documentation, publication assets, or private local artifacts."
---

# Dove vive MediFlow: topologia della repository

Ultimo aggiornamento: 2026-09-05

Questa mappa aiuta agenti e contributori a collocare il lavoro senza confondere
ambiti che hanno responsabilità diverse: il **runtime clinico**, cioè il codice
che lavora con i dati paziente, gli **artefatti di pubblicazione e del sito** e
gli **strumenti di sviluppo**.

## Orientarsi prima dei percorsi

Il gestionale si costruisce in questa repository, insieme agli strumenti che
lo verificano e ai documenti che lo spiegano. Il sito
[Get MediFlow](https://getmediflow.dev) presenta invece il prodotto: non ospita
la cartella, non importa i servizi clinici e non riceve dati del runtime.
La separazione deve rimanere riconoscibile anche quando codice, documentazione
e materiali pubblici sono vicini nello stesso albero.

[Inizia qui](./start-here.md) introduce il progetto;
[readiness 0.8.5](./release-085-readiness.md) conserva la valutazione di quella
candidata; il [piano editoriale](./getmediflow-editorial-proposal.md) riguarda
sito e organizzazione della documentazione. La release 0.8.6 distribuisce
sorgenti: né questa mappa né la presenza del codice nativo attestano installer
firmati, notarizzazione o ammissione a un deployment clinico.

## Repository operativa

[`Wulfgardr/mediflow`](https://github.com/Wulfgardr/mediflow) è l'unica
repository operativa per sviluppo, issue, branch, pull request, tag e release.
La precedente `Wulfgardr/mediflow_private` è archiviata: non costituisce una
seconda linea principale e non riceve più lavoro.

Non c'è quindi un flusso di esportazione dal privato all'OSS. Il materiale
pubblicabile nasce e viene revisionato qui, mentre database, PHI/PII,
credenziali, artefatti di esecuzione e fonti riservate rimangono fuori da Git,
secondo [`SECURITY.md`](../SECURITY.md).

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
| `drizzle/` | schema del runtime clinico | Artefatti SQL storici; non sono migrazioni eseguite automaticamente all’avvio. L’allineamento effettivo spetta ai controlli del backend. |
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

Le funzioni deterministiche devono poter funzionare senza provider AI. Nella
topologia della 0.8.5, gli strumenti intelligenti rimangono perciò componenti
facoltativi, governati localmente dall'host, con responsabilità distribuite
tra queste aree:

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

ATHENA è inclusa solo quando runner e modello locali sono configurati.
L'override controllato dall'host `MEDIFLOW_ATHENA_MLX_GENERATE_BIN` accetta un
percorso assoluto all'eseguibile `mlx_lm.generate`, senza argomenti o shell.
Il launcher predefinito `uvx` opera offline e si arresta se la cache richiesta
non è disponibile: la presenza del codice non dimostra che il percorso sia
pronto su qualsiasi macchina.

Il chiamante presenta input applicativo tipizzato. Può esprimere una preferenza,
ma non costruire un percorso di esecuzione: ADR 0129 ammette soltanto un ID
opaco del catalogo host corrente, risolto dal servizio FunctionModelDispatch.
Non può scegliere provider, modello libero, endpoint, sede di esecuzione,
prompt, ripiego o applicazione del risultato, né ammettere provider. Ogni
percorso intelligente restituisce una proposta da rivedere, con ricevuta,
provenienza e validità del contesto; soltanto il production root controllato
dall'host ne compone l'esecuzione.

AnyDoc esegue il primo passaggio. Per i PDF supportati, il tree classifica,
prepara e renderizza soltanto le pagine `needsOcr`; Apple Vision lavora poi
localmente sul Mac e il risultato viene ricomposto con verifica host della
validità del contesto. Il percorso serve soltanto alla revisione e si arresta
se mancano i requisiti. DeepSeek-OCR 2/CUDA rimane
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`: il tree ne conserva contratto e raccordi
sintetici, non una nuova prova operativa. Dopo l'autenticazione, le route OCR
legacy rispondono `410`.

Gli adapter HTTPS ufficiali OpenAI e Anthropic e le probe Document Synthesis
sono limitati alla revisione. Restano `default OFF` e richiedono ciclo di vita,
riferimento al segreto e policy di uscita e conservazione dei dati governati
dall'host. I test qui descritti sostituiscono il trasporto: il tree non contiene
credenziali né prove di rete live. Un login o un abbonamento consumer non
fornisce per questo una credenziale di inferenza.

Il selettore Fabric opera sulle cinque funzionalità nominate: mostra i profili
compatibili, li verifica nello smoke con fixture sintetiche e attiva il
collegamento in modo atomico, versionato e reversibile. Non conserva segreti
e non qualifica il runtime; selezione e ammissione restano passaggi diversi.

Un futuro plug-in non può accedere direttamente al database. Può ricevere
soltanto il contenuto minimo, dopo l'applicazione delle regole, l'attivazione
esplicita, controlli verificati e registrazione. L'oscuramento dei dati
identificativi o la pseudonimizzazione devono essere dimostrati per quel
flusso specifico; MediFlow non dichiara un'anonimizzazione garantita.

La disponibilità delle funzioni deterministiche non dipende dai provider.
Ricevuta e provenienza descrivono l'esecuzione eventualmente richiesta, ma
non autorizzano l'applicazione del risultato né una scrittura clinica.

L'[ADR 0086](./adr/0086-intelligent-scaffold-and-graded-automation-boundary.md)
propone la sequenza comune
`pipeline locale -> proposta -> chiarimento -> anteprima -> autorizzazione ->
eventuale scrittura auditata`. Non aggiunge una nuova area runtime. La inbox
conversazionale e l'automazione graduata restano roadmap.

## Confine Headless 0.8.5

Un launcher fidato avvia un processo figlio autenticato, con un ambiente
limitato alle variabili ammesse e RPC AIP ereditato. MCP `stdio` espone
catalogo, ricerca terminologica, Open Loops nel perimetro del paziente,
proposte di follow-up `proposal_only` e query semantiche limitate in sola
lettura. Mini condivide catalogo e base CLI, ma nel perimetro 0.8.5 qui descritto
non ha un punto di invocazione di produzione del Supervisor e si arresta senza
parent AIP. Gli adapter non importano SQLite, non duplicano regole di dominio
e non aprono listener.

L'host conserva autorità, finalità, selezione, scope, lease, verifica della
validità del contesto e audit. Il Supervisor Node locale svolge il ruolo di
parent fidato e avvia Web standalone e MCP come figli distinti su IPC privato
ereditato, senza broker residente o UDS. La 0.8.5 non dichiara installer,
configurazione iniziale o compatibilità con host MCP esterni.

La transizione di stato del checkup F10 collega un'anteprima MCP a una
conferma nella UI Web fidata. MCP non riceve proof e non può eseguire il
commit: il Web deve rileggere la risorsa e richiedere ruolo medico attivo,
step-up e gesto specifico per l'operazione. CAS, idempotenza, audit e ricevuta
vengono poi applicati atomicamente.

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
- Un clone storico può mantenere remote locali differenti, ma il remote usato
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

La regola nasce da un problema concreto. Il residuo
`codex/WUL-362-contract-gates` era un normale branch di lavoro creato da `main`
il 21 luglio, non un branch d'integrazione. Il 6 agosto aveva ricevuto il
commit `wip: igiene di sessione`, applicato contemporaneamente ad altri quattro
branch. Quel passaggio lo aveva reso indistinguibile da un branch con lavoro
residuo, costringendo ogni revisione successiva a dimostrare di nuovo che non
contenesse nulla da promuovere. Il lease impedisce questa ambiguità: un branch
che non ne dispone non può ricevere neppure una modifica generale di pulizia.

Due avvertenze che il collegio ha ritenuto vincolanti:

- **`git cherry` è un segnale, non l'autorità di cancellazione.** Si fonda
  sull'equivalenza di patch-id, quindi è cieco al lavoro reimplementato invece che
  ricopiato; e se `main` applica una patch e poi la reverte, `git cherry` continua a
  mostrarla come integrata. Usarlo nel closeout, mai come criterio automatico.
- **Il confronto blob-per-blob non lo sostituisce**: fallisce su rename, refactor e
  reimplementazioni semantiche.

Il lease governa però il *ciclo di vita del ref*, non la *completezza del
lavoro*. Un branch può scadere correttamente anche se contiene lavoro mai
promosso e mai riconosciuto: il controllo guarda il riferimento, non l'albero.
Per accorgersi di questa perdita serve un controllo diverso, sulla coerenza
dell'albero, come `npm run check:schema-writers`. La CI può così distinguere
un'assenza decisa da un'assenza dimenticata, che nel solo schema avrebbero lo
stesso aspetto.

## Gate del confine AI → scrittura clinica

Il confine tra proposta AI e scrittura clinica non può dipendere soltanto
dalla disciplina di chi modifica il codice.
`npm run check:ai-clinical-writes` (`scripts/check-ai-clinical-write-gate.mjs`)
rende eseguibili i controlli previsti da
[ADR 0084](./adr/0084-document-diagnoses-review-only.md) e
[ADR 0086](./adr/0086-intelligent-scaffold-and-graded-automation-boundary.md).

Nella 0.8.5 i quattro percorsi intelligenti attraversano route autenticate,
ma la route rimane un adapter. I vincoli devono essere applicati nel
**production root e nel writer del servizio**: controllare soltanto il nome
della route non dimostra che proposta e scrittura siano separate.

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
