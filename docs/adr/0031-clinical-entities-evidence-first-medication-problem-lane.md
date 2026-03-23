<!-- Codex: created 2026-03-23 -->
# ADR 0031: `clinical_entities.v1` come lane evidence-first per farmaci e problemi

Date: 2026-03-23  
Status: Proposed

## Problema

Dopo `WUL-96` sulla lane `redaction`, serve una thin slice separata per capire se
una lane spans-first italiana aiuta davvero su `farmaci` e `problemi` clinici,
senza confondere questo lavoro con salience o reasoning generativo.

## Contesto

- [ADR 0030](./0030-openmed-redaction-and-italian-ner-benchmark-lanes.md)
  separa gia `redaction.v1` da `clinical_entities.v1`.
- [docs/ai-stack-execution-plan.md](../ai-stack-execution-plan.md) fissa `AI-06`
  come benchmark NER italiano deterministico con `HUMADEX` primo candidato.
- [docs/openmed-toolkit-evaluation.md](../openmed-toolkit-evaluation.md)
  tiene `OpenMed NER` solo come baseline secondaria.

## Opzioni

1. Usare direttamente la lane generativa attuale per farmaci/problemi.
2. Aprire una lane NER larga subito su molte entity class.
3. Fare una thin slice `clinical_entities.v1` limitata a `medication` e
   `problem`, evidence-first.

## Decisione

Adottiamo l'opzione 3.

Per questa thin slice:

- il contratto locale e `mediflow.clinical_entities.v1`
- le sole entity class richieste sono `medication` e `problem`
- ogni entity deve restare ancorata a uno span esplicito del testo sorgente
- `HUMADEX` e il primo candidato previsto; `OpenMed NER` resta baseline
  secondaria
- non si misura ancora la `salience` clinica come output finale

## First Thin Slice

1. Contratto locale evidence-first con offset UTF-16 allineati a JS/Node.
2. Corpus sintetico italiano per `medication + problem`.
3. Harness benchmark dedicato con gold adapter e metriche minime:
   `spanPrecision`, `spanRecall`, `evidenceCoverage`.
4. Adapter reali `HUMADEX/OpenMed NER` solo nel passo successivo.

## Fuori Scope

- ranking di salience clinica
- decisioni terapeutiche
- coding automatico
- integrazione runtime applicativa
