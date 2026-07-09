# AGENTS.md: MediFlow

## Missione

MediFlow e una cartella clinica territoriale local-first. Gli agent devono
preservare privacy, sicurezza, semplicita e verificabilita, con diff piccoli e
revisionabili.

## Avvio obbligatorio

Prima di ogni attivita nel repository, leggere nell'ordine:

1. `AGENTS.md`
2. `README.md`
3. `docs/README.md`
4. `docs/markdown-index.md`
5. `ARCHITECTURE.md`
6. `CONTRIBUTING.md`
7. `SECURITY.md`
8. gli ADR piu recenti in `docs/adr/`
9. `docs/walkthrough.md` quando serve una vista end-to-end

Non dedurre intenti architetturali dal solo codice quando esiste una fonte
documentale canonica.

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
- Le modifiche a confini di sicurezza, dati o architettura richiedono un ADR
  prima dell'implementazione.

## Disciplina operativa

- Un workstream usa un issue, un branch `codex/<issue>-<slug>` e un worktree
  dedicato.
- La checkout primaria e una superficie di coordinamento, non di sviluppo.
- Preferire un solo cambiamento logico per commit e nessun refactor laterale.
- Se la modifica supera circa 300 LOC o coinvolge piu confini architetturali,
  fermarsi e proporre una suddivisione.
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
