# Linear Memory Workflow

Stato documento: `CANONICAL` per il check di memoria Linear locale prima di
aprire o manipolare issue.

## Scopo

Linear ha un limite pratico di spazio nel piano gratuito, ma lo storico delle
issue completate resta utile per evitare doppioni, ricordare cosa e gia stato
tentato e capire la direzione del progetto.

La policy operativa e quindi:

1. salvare prima in repo uno snapshot Markdown autosufficiente delle issue
   `Done`;
2. consultare quello snapshot prima di creare o eseguire nuove issue;
3. archiviare o eliminare da Linear solo dopo che la memoria utile e gia su
   disco;
4. usare side effect Linear solo in modo esplicito, batchabile e reversibile
   dove possibile.

Archivio corrente:

- [docs/linear-completed-issues-archive-2026-05-21.md](./linear-completed-issues-archive-2026-05-21.md)

## Strumento Locale

La CLI locale e:

```bash
node scripts/linear-memory-tool.mjs --help
```

Script npm equivalenti:

```bash
npm run linear:memory-check -- "smart import ricette farmaci"
npm run linear:snapshot-done
npm run linear:archive-plan
npm run linear:archive-plan -- --all --format json
npm run linear:archive-done -- --ids WUL-1,WUL-2
```

Il comando `linear:archive-done` e dry-run per default. Per applicare davvero
side effect su Linear serve:

```bash
export LINEAR_API_KEY="<token>"
npm run linear:archive-done -- --ids WUL-1,WUL-2 --execute
```

Per spostare le issue nel trash Linear, usare solo dopo conferma esplicita:

```bash
export LINEAR_API_KEY="<token>"
npm run linear:delete-done -- --ids WUL-1,WUL-2 --execute --confirm-delete
```

`delete-done` usa la mutazione GraphQL `issueArchive(..., trash: true)`. Prima
di usarla, verificare che lo snapshot Markdown contenga obiettivo, outcome,
data, stream, parent e link necessari.

## Check Prima Di Nuove Issue

Prima di creare una issue o iniziare un nuovo workstream:

```bash
npm run linear:memory-check -- "<tema o frase problema>"
```

Nel testo della issue o nel commento operativo aggiungere una riga:

```text
Archive check: nessun duplicato trovato.
```

oppure:

```text
Archive check: correlata a WUL-235 / WUL-231; nuovo scope perche ...
```

Questo evita di riaprire temi gia chiusi e rende esplicito quando una nuova
issue e davvero un follow-up netto.

## Regole Di Uso

- Non eliminare da Linear issue `Done` non ancora salvate in Markdown.
- Non salvare PHI/PII, screenshot clinici o descrizioni paziente nello snapshot.
- Non usare lo snapshot come fonte autoritativa del codice: per quello restano
  Git, PR, ADR e documenti canonici.
- Se una issue vecchia e ancora citata in PR o documenti attivi, archiviala
  solo dopo aver verificato che il riferimento rimanga comprensibile.
- Lo snapshot deve essere compatto ma autosufficiente: ID, titolo, outcome,
  data, stream, parent e link.

## Quando Aggiornare Lo Snapshot

- Prima di un batch di archiviazione/eliminazione Linear.
- Dopo una release o un ciclo di maintenance con molte issue `Done`.
- Quando il piano gratuito torna vicino al limite e serve liberare spazio.
- Prima di una nuova fase di prodotto, se il rischio di doppioni e alto.

Con API key Linear disponibile:

```bash
export LINEAR_API_KEY="<token>"
npm run linear:snapshot-done
```
