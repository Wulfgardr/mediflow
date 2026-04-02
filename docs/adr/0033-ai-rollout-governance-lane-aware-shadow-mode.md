<!-- Codex: created 2026-04-02 -->
# ADR 0033: governance rollout AI lane-aware con shadow mode, fallback, rollback e kill-switch

Date: 2026-04-02
Status: Proposed

## Problema

MediFlow ha gia benchmark, corpora sintetici, registry candidati e policy
separate per:

- lane generative locali
- retention dei modelli
- lane benchmark-only (`redaction`, `clinical_entities`)
- document intelligence lab

Manca pero ancora una decisione unica su come una lane AI puo passare da
`benchmark-only` a uso prudente senza promozioni implicite o regressioni
silenziose.

Il rischio attuale e triplo:

- promuovere una lane per intuizione o entusiasmo locale
- lasciare fallback e rollback come conoscenza implicita di chat/issue
- introdurre shadow mode senza criteri minimi lane-aware

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) richiede diff piccoli, contratti
  espliciti e niente scorciatoie architetturali.
- [SECURITY.md](../../SECURITY.md) richiede output AI non fidato, no PHI/PII in
  repo e no egress implicito.
- [ADR 0012](./0012-operator-reviewed-smart-import-from-patient-context.md)
  impone che `Smart Import` resti reviewable.
- [ADR 0028](./0028-stack-aware-ai-model-evaluation-matrix.md) separa le lane
  per tipo e vieta benchmark impropri tra `LLM`, `PII`, `NER` ed `encoder`.
- [ADR 0029](./0029-ai-model-parliament-and-local-retention-policy.md) governa
  benchmark e retention dei generativi, ma non il rollout operativo delle lane.
- [ADR 0032](./0032-document-intelligence-corpus-and-private-shadow-vault.md)
  aggiunge il livello di shadow evaluation privata, ma non la policy di
  promozione/rollback.
- [docs/ai-stack-execution-plan.md](../ai-stack-execution-plan.md) identifica
  `AI-08` come fase finale, ma oggi lo lascia come outline piu che come
  runbook.

## Opzioni

1. Lasciare la governance distribuita tra `PLANS`, issue Linear e note tecniche.
2. Spingere subito la governance nel runtime/UI con flag e automazioni.
3. Introdurre prima una policy documentata e lane-aware, con runbook operativo
   separato dal prodotto.

## Trade-off

- Opzione 1:
  - Pro: zero lavoro aggiuntivo nel breve.
  - Contro: regole implicite, review difficile, rischio forte di drift.
- Opzione 2:
  - Pro: percorso potenzialmente piu comodo per l'operatore.
  - Contro: troppo presto; cristallizza nel prodotto una governance ancora in
    evoluzione e aumenta il rischio di automazioni premature.
- Opzione 3:
  - Pro: rende la governance versionabile, reviewabile e citabile senza
    modificare ancora il runtime.
  - Contro: aggiunge un artifact operativo in piu e richiede disciplina manuale
    finche i kill-switch non saranno productized.

## Decisione

Adottiamo l'opzione 3.

MediFlow introduce una governance di rollout AI lane-aware con queste regole:

- nessuna lane passa oltre `benchmark-only` senza:
  - benchmark lane-specific recente
  - fallback deterministico scritto su disco
  - stop-rules esplicite
  - owner e kill-switch operativi nominati
- nessuna lane reviewable puo degradare in auto-write silenzioso
- le lane privacy-first degradano `fail-closed`
- i challenger generativi non cambiano il baseline operativo senza superare le
  metriche della loro lane e senza decisione esplicita documentata
- shadow mode e rollout attivo restano concetti distinti:
  - shadow mode puo osservare o confrontare
  - rollout attivo puo influenzare un flusso operatore

Stati operativi minimi ammessi:

- `benchmark-only`
- `hold`
- `shadow-ready`
- `shadow-active`
- `active-with-fallback`
- `rollback-required`

## Conseguenze

Diventa piu semplice:

- motivare perche una lane resta `hold` o puo entrare in `shadow mode`
- confrontare benchmark, fallback e stop-rules nello stesso luogo
- evitare promozioni per intuizione su modelli o sidecar appena benchmarkati

Diventa piu difficile:

- saltare direttamente da benchmark a runtime operativo
- giustificare kill-switch o rollback solo a parole

## First Thin Slice

1. Aprire un child issue dedicato (`WUL-133`) sotto `WUL-111`.
2. Aggiungere un runbook canonico con:
   - stati lane-aware
   - prerequisiti `shadow-ready`
   - fallback per lane
   - stop-rules e rollback
   - kill-switch operativi attuali
3. Aggiornare `PLANS.md` e gli indici documentali per puntare al runbook.
4. Lasciare fuori dal diff qualunque cambio a UI, settings o runtime.

## Fuori Scope

- feature flag UI o toggle runtime per il rollout
- promozione immediata di `Gemma 4` o di altre lane benchmark-only
- telemetria cloud o raccolta remota dati
- automazioni di pruning, rollback o sampling nel prodotto
