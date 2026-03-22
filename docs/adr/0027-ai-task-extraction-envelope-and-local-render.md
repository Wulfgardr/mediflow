<!-- Codex: created 2026-03-21 -->
# ADR 0027: Shared AI extraction envelope and local render separation

Date: 2026-03-21
Status: Proposed

## Problema

Le tre lane AI locali piu sensibili del web stack usano oggi contratti diversi e
mescolano in modo non uniforme estrazione machine-readable e rendering finale:

- `AI Patient Insight` chiede markdown finale direttamente al modello
- `smart import` usa un JSON task-specific ad hoc
- `document synthesis` usa un altro JSON ad hoc

Questo rende piu fragile il benchmark cross-task su:

- `valid JSON rate`
- latenza per task/modello
- confronto coerente tra modelli text-only

Inoltre il render markdown dell'insight oggi dipende direttamente dall'output
del modello, mentre il repository ha gia guardrail locali forti su citazioni,
source hierarchy e fallback prudente.

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) richiede contratti espliciti, diff
  piccoli e niente astrazioni speculative.
- [SECURITY.md](../../SECURITY.md) richiede local-first, logging PHI-safe e
  output AI trattato come non fidato.
- [docs/adr/0012-operator-reviewed-smart-import-from-patient-context.md](./0012-operator-reviewed-smart-import-from-patient-context.md)
  mantiene lo smart import reviewable e non silenzioso.
- [docs/adr/0013-qwen35-default-text-only-medgemma-specialist.md](./0013-qwen35-default-text-only-medgemma-specialist.md)
  governa il default operativo text-only, ma non il benchmark contrattuale.
- [docs/adr/0018-ai-insight-full-auto-and-pro-settings.md](./0018-ai-insight-full-auto-and-pro-settings.md)
  governa i budget runtime dell'insight, non la forma dell'output del modello.
- [docs/adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md](./0020-ai-insight-source-hierarchy-and-conflict-rules.md)
  fissa le regole cliniche dell'insight che il nuovo contratto non deve
  regredire.

## Opzioni

1. Lasciare i tre contratti separati e benchmarkare ogni lane con prompt/parser
   dedicati senza envelope comune.
2. Unificare da subito tutte le lane sotto un unico schema clinico ricco e
   identico per ogni task.
3. Introdurre un envelope minimo condiviso per l'estrazione (`schemaVersion`,
   `task`, `summary`, `data`) e separare il render compatto locale dove serve.

## Trade-off

- Opzione 1:
  - Pro: nessun lavoro contrattuale upfront.
  - Contro: benchmark e validazione restano poco comparabili; il drift
    continua a crescere.
- Opzione 2:
  - Pro: uniformita massima teorica.
  - Contro: schema troppo largo per una thin slice; rischio di forzare falsi
    punti comuni tra task clinicamente diversi.
- Opzione 3:
  - Pro: minima base condivisa sufficiente per benchmark/validator e
    hardening JSON, lasciando task-specific il dominio clinico.
  - Contro: resta una piccola duplicazione task-specific dentro `data`.

## Decisione

Adottiamo l'opzione 3.

Introduciamo un contratto minimo condiviso per l'estrazione AI:

```json
{
  "schemaVersion": "mediflow.ai.extract.v1",
  "task": "patient_insight|smart_import|document_synthesis",
  "summary": "stringa breve oppure vuota",
  "data": {}
}
```

Regole:

- il modello deve produrre solo JSON valido, senza markdown finale o testo extra
- `data` resta task-specific ma dentro lo stesso envelope
- `AI Patient Insight` non salva piu direttamente markdown generato dal modello:
  il modello produce extraction JSON e il web renderizza localmente un contratto
  compatto di sezioni/claim prima di passare nei guardrail esistenti
- `smart import` e `document synthesis` restano task-specific nel payload
  clinico, ma usano lo stesso envelope/shared parser surface
- il benchmark/validator contrattuale di questa thin slice testa solo
  `qwen2.5:32b` e `qwen3:32b`

Nota esplicita:

- questa ADR non cambia il default operativo text-only fissato da ADR 0013
- questa ADR non introduce nuovi endpoint `/api/v1`
- questa ADR non cambia la semantica reviewable dello smart import

## First Thin Slice

1. Aggiungere un modulo condiviso `lib/ai-task-contracts.ts` con envelope v1,
   prompt builders, parser/validator minimi e render locale compatto per
   `AI Patient Insight`.
2. Riallineare `lib/ai-summary-service.ts`,
   `lib/patient-smart-import-service.ts` e
   `lib/document-synthesis-service.ts` al nuovo envelope.
3. Aggiungere test puri sul contratto condiviso.
4. Aggiungere un benchmark headless locale su corpus sintetico che misuri
   `valid JSON rate`, `contract-valid rate` e latenza per `qwen2.5:32b` e
   `qwen3:32b`.

## Fuori Scope

- cambio del default runtime da `qwen3.5:35b-a3b`
- estensione del contratto a macOS/iOS nella shell storica congelata
- valutazione clinica di accuratezza semantica full-task oltre la validita del
  contratto
- uso di servizi cloud, telemetry o egress non documentato
