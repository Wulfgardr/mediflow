# Prove dei giri GPUI

Fino al 10 novembre 2026 questa cartella conteneva 173 file di prova dei giri
del client GPUI (ricevute e manifest JSON, schermate, log), circa 4,8 MB in
ogni checkout e in ogni worktree. Ne sono usciti 171, che restano nella
storia del repository: nessun dato è andato perso.

- I link nei documenti puntano ora alla copia nel commit
  `ec4be829929f5c26e39a45676a9faf603931095e`, dove le prove sono ancora presenti.
- Restano qui i due risultati che `comparison/protocol.md` usa come ingresso
  del confronto di compatibilità con la release 0.9.0:
  `connected/release-v0.9.0-web-readonly.json` e
  `connected/candidate-v1-readonly.json`.
- Per riaverle tutte in locale:

  ```bash
  git checkout ec4be829929f5c26e39a45676a9faf603931095e -- experiments/gpui-patient-pilot/evidence
  git restore --staged experiments/gpui-patient-pilot/evidence
  ```

Le prove nuove vanno allegate alla PR o alla issue che le usa, non committate
qui: `.gitignore` esclude il resto di questa cartella.
