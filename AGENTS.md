# AGENTS.md: MediFlow

## Missione

MediFlow e una cartella clinica territoriale local-first. Gli agent devono
preservare privacy, sicurezza, semplicita e verificabilita, con diff piccoli e
revisionabili.

## Orientamento proporzionato

Leggere `AGENTS.md`, verificare branch e stato del worktree, poi consultare
le parti di `README.md` e `docs/STATE_OF_THE_SYSTEM.md` pertinenti al compito.
Verificare data e checkout delle fotografie documentali: non attestano da sole
lo stato della release corrente.

- Per trovare la fonte canonica: `docs/README.md` e `docs/markdown-index.md`.
- Per repository, branch e consegna: `docs/repository-topology.md`.
- Prima di modificare codice: `CONTRIBUTING.md` e i contratti del componente.
- Per dati, sicurezza o architettura: `SECURITY.md`, `ARCHITECTURE.md` e gli
  ADR del confine interessato, non tutti gli ADR recenti.
- Per una vista end-to-end: `docs/walkthrough.md`.

Non caricare documenti estranei al compito e non dedurre intenti architetturali
dal solo codice quando esiste una fonte canonica pertinente.

## Repository canonica

- `https://github.com/Wulfgardr/mediflow` e l'unica repository operativa e
  canonica del progetto.
- La precedente repository privata `Wulfgardr/mediflow_private` e archiviata e
  non e una fonte di sviluppo, pianificazione o rilascio.
- Non esiste piu un flusso private-to-OSS, una doppia mainline o un passaggio di
  export prima della pubblicazione.
- Branch, commit, pull request, issue, tag e release appartengono alla
  repository pubblica.
- Database, PHI/PII, credenziali, output runtime, corpus autenticati e altri
  artefatti riservati restano fuori da Git; non vanno spostati nella vecchia
  repository privata.

La fonte canonica per questa decisione e
[`docs/repository-topology.md`](./docs/repository-topology.md).

## Sicurezza e privacy

- Non committare PHI/PII, database reali, screenshot o log con dati clinici.
- Usare solo fixture sintetiche.
- Nessun cloud, telemetria o egress dati e attivo per default.
- Prima di cambiare confini di sicurezza, contratti dei dati/API o decisioni
  architetturali durevoli, scrivere o aggiornare l'ADR pertinente secondo
  `CONTRIBUTING.md`. Correzioni che rispettano il contratto esistente non
  richiedono un nuovo ADR per il solo fatto di toccarne l'implementazione.

## Disciplina operativa

- Un workstream di implementazione usa un issue, un branch
  `codex/<issue>-<slug>` e un worktree dedicato. Non creare issue o PR senza
  autorizzazione; un collegamento mancante va dichiarato, non inventato.
- La checkout primaria resta una superficie di coordinamento, non di sviluppo
  runtime. Ispezioni e correzioni solo documentali, esplicitamente richieste e
  isolate dalle modifiche altrui, non richiedono nuovi worktree.
- Preferire un solo cambiamento logico per commit e nessun refactor laterale.
- Suddividere quando obiettivi indipendenti, ownership concorrente o impatto
  rendono difficile verificare e ripristinare il cambiamento. Il numero di
  righe, da solo, non e uno stop; fermarsi per un conflitto o una decisione di
  contratto non risolta.
- Prima del commit verificare branch corrente, scope del diff e stato del
  worktree.

## Igiene documentale

- Se un file Markdown viene aggiunto, rimosso o rinominato, aggiornare
  `docs/markdown-index.md`.
- Se cambia la fonte autorevole di un tema, aggiornare `docs/README.md`.
- Allineare prima la fonte canonica, poi le sintesi secondarie.
- Stato reale, direzione e fuori-scope devono restare distinguibili.

## Verifica minima

Per modifiche solo documentali:

```bash
git diff --check
rg --files -g '*.md' | sort
```

Per modifiche runtime, seguire i comandi e la Definition of Done in
`CONTRIBUTING.md`. Dichiarare sempre cosa e stato verificato e cosa non lo e.

## Attribuzione Codex

Il codice specificamente prodotto da Codex usa `/* @Codex */` per i blocchi o
`// @Codex` inline. La regola non richiede marcatori nei soli documenti.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
