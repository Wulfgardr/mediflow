---
summary: "How the repository guarantees that every test file is taken by a suite, and how to add or exclude one."
read_when:
  - "Adding, renaming or moving a test file or a test helper."
  - "Changing a suite selector or the CI job that runs it."
---

# Selezione dei test

Un file di test che nessuna suite esegue è una garanzia che sembra esserci e
non c'è. Il controllo di selezione lo impedisce: ogni file di test deve essere
preso da una suite, oppure stare in un elenco di esclusi con un motivo.

```sh
npm run check:test-selection
npm run test:test-selection
```

Il primo esegue il controllo su questa copia del repository; il secondo ne
prova il comportamento su casi sintetici. Gira nei Repository Guards a ogni PR e
su `main`.

## Come decide

1. **Trova i file di test**: per nome (`*.test.*`, `*.spec.*`, `*Tests.swift` e
   le convenzioni di Python, shell e Rust) oppure perché il sorgente carica un
   framework di test. Non importa né esegue nulla.
2. **Chiede ai selettori** quali file prende ciascuna suite: unit, Playwright,
   headless, Swift, gli script npm espliciti e le suite locali. Sono i moduli
   `scripts/*-selection.mjs`; unit, headless e locali sono gli stessi che usano
   i runner.
3. **Confronta.** Fallisce se un file di test non è preso da nessuna suite e non
   è escluso, se un escluso non esiste più o è preso da una suite, se un
   selettore è vuoto o in errore.

## Aggiungere un test

- In `lib/` o `components/`, con nome `*.test.ts`: lo prende la suite unit.
- In `e2e/`, con nome `*.spec.ts`: lo prende Playwright.
- In `scripts/`: va aggiunto a `UNIT_SCRIPT_TESTS` in
  `scripts/unit-test-selection.mjs`, oppure allo script npm che lo esegue.

## Escludere un file che non è un test

Un helper che il controllo scambia per un test, perché importa `node:test` o
`assert`, va in `test-selection-exclusions.json` con `path`, `reason` e
`owner`. L'elenco si tiene a mano e resta corto: è il posto dove si vede che
cosa non viene eseguito e perché.

## Che cosa non prova

Che i test siano stati eseguiti, che le loro asserzioni bastino, o che una
release sia qualificata. Dice solo che nessun file di test è rimasto fuori da
ogni suite.
