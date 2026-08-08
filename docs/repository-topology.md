---
summary: "Canonical MediFlow repository ownership, publication boundary, and top-level directory map."
read_when:
  - "Deciding which repository, branch, or worktree is authoritative."
  - "Placing code, documentation, publication assets, or private local artifacts."
---

# Repository Topology: MediFlow

Ultimo aggiornamento: 2026-08-07

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

## Confine AI e integrazioni opzionali

La topologia AI implementata resta locale:

- `lib/ai-service.ts` è la facciata usata dalle funzioni applicative;
- `lib/ai-providers/` contiene il connettore operativo Ollama;
- `lib/ai-egress-gate.ts` e `lib/ai-egress-audit.ts` applicano una chiusura
  sicura in caso di errore (`fail-closed`) e scrivono un registro locale privo
  di contenuto clinico.

Non esistono fornitori cloud operativi, registri esterni o una superficie di
consenso per l'invio esterno. Il controllo resta
`closed_pending_redaction_lane`.

Un futuro plug-in non può accedere direttamente al database. Può ricevere solo
il contenuto minimo dopo regole, attivazione esplicita, controlli verificati e
registrazione. La redazione o pseudonimizzazione deve essere dimostrata per il
flusso specifico. MediFlow non dichiara anonimizzazione garantita.

Le funzioni deterministiche restano disponibili senza plug-in. Il percorso AI
locale richiede Ollama configurato. L'output esterno resta una proposta:
chiarimento interattivo e scrittura autorizzata sono fasi separate. Questa
regola descrive il confine, non una funzione cloud già consegnata.

L'[ADR 0086](./adr/0086-intelligent-scaffold-and-graded-automation-boundary.md)
propone la sequenza comune
`pipeline locale -> proposta -> chiarimento -> anteprima -> autorizzazione ->
eventuale scrittura auditata`. Non aggiunge una nuova area runtime. La inbox
conversazionale e l'automazione graduata restano roadmap.

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

La lease governa il *ciclo di vita del ref*, non la *completezza del lavoro*. Un branch
può scadere correttamente portandosi via lavoro mai promosso e mai notato — è successo
con il writer di `document_diagnosis_proposals`, mentre la sua tabella era già su
`main`. La contromisura per quel fallimento è di natura diversa: un gate che verifica
la coerenza dell'albero, come `npm run check:schema-writers`.
