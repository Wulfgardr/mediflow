# Catture delle analisi

Fino all'8 novembre 2026 le analisi in questa cartella portavano con sé 458
catture PNG, circa 54 MB in ogni checkout e in ogni worktree. Le catture sono
uscite dall'albero ma restano nella storia del repository: nessun dato è
andato perso.

- I link nei documenti puntano ora alla copia nel commit
  `5afa7f0f2503abe4549133b8dddd5e865b218498`, dove le catture sono ancora presenti.
- Manifest e tabelle delle catture (`captures.json`, `catture.csv` e
  simili) conservano percorsi e digest originali: identificano la cattura
  in quel commit.
- Per riaverle tutte in locale:

  ```bash
  git checkout 5afa7f0f2503abe4549133b8dddd5e865b218498 -- docs/analysis
  git restore --staged docs/analysis
  ```

Le catture nuove vanno allegate alla PR o alla issue che le usa, non
committate qui: `.gitignore` esclude i PNG di questa cartella.
