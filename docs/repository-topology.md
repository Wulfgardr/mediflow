---
summary: "Canonical MediFlow repository ownership, publication boundary, and top-level directory map."
read_when:
  - "Deciding which repository, branch, or worktree is authoritative."
  - "Placing code, documentation, publication assets, or private local artifacts."
---

# Repository Topology: MediFlow

Ultimo aggiornamento: 2026-09-01

Mappa concisa delle aree top-level del repository, pensata per orientare agent e
contributor: distingue il **runtime clinico** (codice che gira con dati paziente)
dagli **artefatti di pubblicazione/sito** e dagli **strumenti di sviluppo**.

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

La topologia intelligente del candidato sorgente locale 0.8.5 resta
host-owned e locale:

- `app/api/ai/{patient-insight,smart-import,document-synthesis,treatment-reasoning}/`
  contiene gli adapter HTTP autenticati dei quattro smart path generativi;
- `lib/ai-providers/fabric/` contiene resolver, production root, lifecycle,
  receipt e provenienza governati dall'host;
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

La capability `ocr` resta `unavailable` nel runtime corrente. AnyDoc fallisce
chiusa per immagini o PDF scansionati senza text layer e le route OCR legacy,
dopo l'autenticazione, rispondono `410`. DeepSeek-OCR 2 è
`RELEASE_SCOPE_EXCLUDED`: mancano adapter, E2E e benchmark. Un workstream
post-0.8.5 può ricevere soltanto pagine `needsOcr` e deve ricomporle con
provenienza, hash e qualità per pagina. Benchmark sintetico italiano, soglie
dichiarate e prova che nessun dato lascia il processo locale devono precedere
ogni abilitazione. Apple Vision non appartiene al target.

Non esistono provider cloud operativi o una superficie di consenso per l'invio
esterno. OpenAI e Anthropic compaiono soltanto nel registro informativo e hanno
esecuzione disabilitata. Il controllo resta `closed_pending_redaction_lane`.

La disclosure implementata non chiude F7. Il modello provider completo non è
implementato ed è `RELEASE_SCOPE_EXCLUDED`. Un contratto post-0.8.5 dovrà
separare provider type, istanza, autenticazione, modello, capability, gruppi,
binding e function allowlist. Le classi `local_model`, `api_key`,
`provider_oauth` ufficiale e `host_subscription` restano distinte. Login
consumer e subscription non equivalgono a una credenziale di inferenza.

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

La foundation Headless non espone un runtime agentico generale esterno. Non
espone listener, installer, onboarding o operazioni Headless eseguibili
generalizzate. Gli adapter non importano SQLite e non duplicano regole di
dominio: invocano solo Application Services host-owned.

L'unica eccezione di scrittura accettata è
`mediflow.clinical_diary.append_soap.v1` con
`clinician_confirmed_single_use.v1`. Il chiamante non fornisce authority, dati
di sessione, idempotenza o binding clinici. L'Application Service ricontrolla
la currentness e delega il commit atomico al solo owner SQLite. L'eccezione non
autorizza altre capability, il Fabric o un canale Headless generale esterno.

La topologia distingue due modalità e non le unisce:

- **provider-in-MediFlow**: il Fabric governa il provider che esegue una
  capability MediFlow; i quattro path locali appartengono a questa modalità;
- **MediFlow-in-intelligent-host**: un host futuro usa un adapter MCP, App o
  Headless sopra gli stessi Application Services.

La seconda modalità è `RELEASE_SCOPE_EXCLUDED`. Il tree corrente non promette
server MCP, installer, onboarding o integrazione con sessioni consumer.
Qualunque OAuth provider futuro deve usare soltanto un contratto ufficiale,
senza token privati o flussi ricostruiti.

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

Nel candidato 0.8.5 i quattro smart path attraversano route autenticate. La
route resta un adapter: il punto di enforcement è il **production root e il
writer del servizio**. Un controllo limitato ai nomi delle route non dimostra
la separazione tra proposta e scrittura.

Il confine ha due lati e il gate controlla entrambi:

1. **Il percorso AI scrive solo proiezioni derivate.** Ogni scrittura in uno dei 75 moduli
   del percorso AI dev'essere dichiarata, e i campi scritti devono stare nell'allowlist
   della lane: `documentInsights` per la sintesi documentale, `aiSummary` e i suoi
   metadati per Patient Insight. L'allowlist è a sua volta verificata: ammettere
   `diagnoses` fa fallire il gate, quindi non si aggira allargandola.
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
