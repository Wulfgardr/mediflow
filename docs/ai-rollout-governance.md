> [!IMPORTANT]
> **Stato documento: CANONICAL (runbook governance rollout AI).**
> Questo file governa `shadow mode`, fallback, rollback e kill-switch delle
> lane AI locali. Se altri documenti secondari divergono su questi punti,
> prevale questo runbook.

# Runbook governance rollout AI

Ultimo aggiornamento: 2026-04-02

## Scopo

Trasformare `AI-08` da outline a policy operativa minima.

Questo runbook definisce:

- quando una lane puo dirsi `shadow-ready`
- come una lane deve degradare in modo sicuro
- quali stop-rules bloccano rollout o shadow mode
- chi puo azionare i kill-switch operativi finche non esistono controlli di
  prodotto dedicati

Riferimenti:

- [SECURITY.md](../SECURITY.md)
- [docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md)
- [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md)
- [docs/adr/0028-stack-aware-ai-model-evaluation-matrix.md](./adr/0028-stack-aware-ai-model-evaluation-matrix.md)
- [docs/adr/0029-ai-model-parliament-and-local-retention-policy.md](./adr/0029-ai-model-parliament-and-local-retention-policy.md)
- [docs/adr/0033-ai-rollout-governance-lane-aware-shadow-mode.md](./adr/0033-ai-rollout-governance-lane-aware-shadow-mode.md)

## Non obiettivi

- non promuove automaticamente nessuna lane
- non cambia il modello di default
- non introduce telemetria cloud o raccolta remota
- non rende le lane reviewable silenziosamente applicative

## Stati lane-aware

| Stato | Significato operativo | Consentito |
| --- | --- | --- |
| `benchmark-only` | Lane misurabile solo tramite corpus/CLI, fuori dal runtime operativo. | Benchmark, confronto, analisi. |
| `hold` | Lane o challenger con segnali promettenti ma ancora bloccata da metriche, sizing, licensing o fallback insufficienti. | Nessun rollout; solo hardening. |
| `shadow-ready` | Lane con benchmark recente, fallback scritto e stop-rules esplicite. | Puo essere preparata a confronto passivo, non a effetto utente. |
| `shadow-active` | Lane osservata in parallelo o su sampling controllato, senza effetti automatici sui dati clinici. | Confronto, auditing redatto, raccolta failure. |
| `active-with-fallback` | Lane usabile in un flusso reale solo se esiste degradazione deterministica documentata. | Uso prudente e reversibile. |
| `rollback-required` | Lane da fermare o regredire immediatamente al baseline. | Stop del rollout, ritorno a baseline. |

Regola forte:

- nessuna lane passa direttamente da `benchmark-only` a `active-with-fallback`

## Prerequisiti minimi per `shadow-ready`

Una lane puo entrare in `shadow-ready` solo se esistono tutti questi artifact:

1. benchmark lane-specific recente e ripetibile da CLI
2. corpus sintetico versionato o riferimento canonico al corpus
3. fallback deterministico scritto su disco
4. stop-rules esplicite e verificabili
5. ownership chiara del kill-switch operativo
6. prova che il comportamento resta `PHI-safe` nei log e negli artifact

Se manca anche solo uno di questi punti, la lane resta `benchmark-only` oppure
`hold`.

## Fallback deterministici per lane

| Lane | Fallback minimo obbligatorio | Comportamento vietato |
| --- | --- | --- |
| `patient_insight` | Nessuna nuova insight o mantenimento dell'ultima insight gia accettata; mai claim o citazioni inventate. | Inventare insight “degradata” o testo libero non supportato. |
| `smart_import` | Tutti i suggerimenti dubbi degradano a `manual` / `blocked` / `uncertain`; nessun apply silenzioso. | Auto-write di diagnosi o terapie. |
| `document_synthesis` | Conservare OCR/testo sorgente e bloccare scritture strutturate non reviewate. | Creare o aggiornare dati clinici senza review. |
| `redaction.v1` | `Fail-closed`: se la lane non e affidabile, non e pronta per uso operativo o export. | Redazione “best effort” usata come se fosse sicura. |
| `clinical_entities.v1` | Nessuna entity strutturata fuori dal benchmark finche il gate non e passato. | Promozione implicita nel runtime applicativo. |

## Stop-rules comuni

Queste stop-rules prevalgono su qualsiasi entusiasmo di benchmark:

| Trigger | Effetto minimo |
| --- | --- |
| codice `ICD-11` fuori dalla candidate list del resolver | `hold` o `rollback-required` immediato |
| `therapyState` su switch sotto soglia concordata | niente rollout; hardening obbligatorio |
| `forbiddenLeakRate` sopra soglia lane-specific | blocco `shadow mode` o rollback |
| `jsonValidRate` / `contractValidRate` sotto `0.95` per lane generative di base | no `shadow-ready` |
| licenza non chiara per uso locale operativo | lane bloccata in `benchmark-only` |
| benchmark non aggiornato o corpus non versionato | nessuna promozione |

Nota:

- per le lane privacy-first la soglia pratica resta molto piu severa; in
  mancanza di un gate passato, la lane resta fuori dall'operativo

## Criteri minimi di rollback

Una lane entra in `rollback-required` se:

- viola una stop-rule durante shadow mode o uso prudente
- perde il fallback deterministico
- introduce leak o output clinicamente non confinati
- smette di superare il benchmark lane-specific che aveva giustificato la sua
  promozione

Rollback significa sempre:

1. fermare subito la lane o il challenger
2. tornare al baseline documentato
3. registrare il motivo su issue/PR/doc
4. non riattivare la lane senza nuovo benchmark e nuova review

## Kill-switch operativi attuali

Finche il prodotto non espone kill-switch dedicati, i kill-switch sono
**operativi**, non UI-driven.

Owner iniziale:

- Leonardo come final approver
- maintainer del workstream come esecutore tecnico

Azioni minime ammesse:

1. ripristinare il baseline generativo attivo (`qwen3.5:35b-a3b`) nei settings
   locali se un challenger viene provato manualmente
2. non avviare o fermare sidecar opzionali non promossi
3. riportare la lane a `benchmark-only` / `hold` nella documentazione e nel
   tracking prima di qualsiasi nuova promozione
4. revertare il commit o la branch che introduceva la promozione prudente

Comportamento vietato:

- lasciare una lane in stato ambiguo “forse attiva” senza baseline esplicita

## Evidence package minimo per una richiesta di promozione

Ogni futura proposta `hold -> shadow-ready` o `shadow-ready -> active-with-fallback`
deve portare con se:

- issue Linear dedicata
- branch/PR dedicata
- benchmark report o riferimento al report persistito
- corpus canonico usato
- fallback e stop-rules citate esplicitamente
- nota chiara su cosa e stato verificato e cosa no

## Snapshot corrente

Al `2026-04-02`, il quadro prudente e questo:

- `qwen3.5:35b-a3b`: baseline generativa protetta
- `gemma4:e4b`: challenger promettente ma ancora `hold`
- `gemma4:e2b`: riferimento di robustezza/latenza, non candidato operativo
- `OpenMed redaction`: `benchmark-only / not shadow-ready`
- `clinical_entities.v1`: `benchmark-only`

## Cosa non fare

- non promuovere una lane per intuizione o per singolo esempio riuscito
- non trasformare `Smart Import` in autofill silenzioso
- non trattare benchmark e shadow mode come se fossero produzione
- non usare documenti reali o PHI per giustificare una promozione non
  versionata
