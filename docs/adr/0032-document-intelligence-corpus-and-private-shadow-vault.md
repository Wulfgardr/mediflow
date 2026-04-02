<!-- Codex: created 2026-04-02 -->
# ADR 0032: corpus document intelligence canonico in repo e vault locale privato per shadow evaluation

Date: 2026-04-02  
Status: Proposed

## Problema

Dopo `WUL-129`, MediFlow ha un primo corpus documentale multi-archetipo
versionato in repo, ma manca ancora una decisione esplicita su come
continuare a far crescere l'intelligenza documentale senza violare i vincoli
`synthetic-only` e `no PHI/PII in repo`.

Il rischio attuale e doppio:

- usare una semplice raccolta di documenti assortiti, poco confrontabile e
  difficile da governare
- far scivolare nel repository materiali troppo realistici o non abbastanza
  redatti, introducendo rischio privacy e drift metodologico

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) e [SECURITY.md](../../SECURITY.md)
  mantengono `local-first`, `no cloud`, `no PHI/PII in repo`.
- [PLANS.md](../../PLANS.md) richiede corpus sintetici e benchmark dedicati per
  ogni nuova lane o sidecar AI.
- [ADR 0030](./0030-openmed-redaction-and-italian-ner-benchmark-lanes.md) e
  [ADR 0031](./0031-clinical-entities-evidence-first-medication-problem-lane.md)
  separano gia le lane benchmark-only e fissano corpus dedicati come prerequisito.
- `WUL-129` ha aperto il corpus documentale multi-archetipo in repo, ma non ha
  ancora formalizzato il rapporto con un eventuale materiale privato di shadow
  evaluation.
- `WUL-111` richiede governance operativa di shadow mode, stop-rules e
  kill-switch; un corpus realistico ma privato puo servire come ponte tra
  benchmark sintetico e uso operativo.

## Opzioni

1. Tenere tutto in repo come corpus sintetico sempre piu grande.
2. Creare una repository locale di documenti sanitari assortiti e usarla come
   base principale di lavoro.
3. Separare il lavoro in due livelli: corpus canonico `synthetic-only` in repo
   e vault locale privato fuori Git per shadow evaluation e failure analysis.

## Trade-off

- Opzione 1:
  - Pro: massima semplicita operativa e versioning lineare.
  - Contro: rischia di fermarsi troppo presto su casi poco realistici e di
    spingere corpus lane-specific scollegati tra loro.
- Opzione 2:
  - Pro: piu realismo apparente e piu materiale grezzo da studiare.
  - Contro: governance debole, rischio privacy/compliance, casi poco
    confrontabili, difficile riuso nei benchmark automatici.
- Opzione 3:
  - Pro: mantiene il repository sicuro e benchmarkabile, ma lascia spazio a
    shadow evaluation piu realistica senza contaminare Git.
  - Contro: richiede disciplina in piu su struttura casi, naming e confine tra
    materiale canonico e materiale privato.

## Decisione

Adottiamo l'opzione 3.

MediFlow usera due livelli distinti:

- **Corpus canonico in repo**:
  - solo `synthetic-only`
  - versionato
  - benchmarkabile
  - pensato come fonte di verita per regressioni, confronti modello e review di
    PR
- **Vault locale privato fuori Git**:
  - non canonico
  - opzionale
  - usato per shadow evaluation, failure analysis, OCR noise studies e
    progettazione di nuovi archetipi sintetici
  - non va committato, allegato a PR o trattato come dataset operativo

Ogni caso documentale canonico deve essere pensato come **pacchetto di caso** e
non come semplice testo sorgente. La shape minima da preservare e:

- `archetype`
- `sourceText`
- `ocrVariant` o rumore equivalente quando rilevante
- `goldFacts`
- `expectedEvidencePack`
- `expectedSmartImport`
- `negativeAssertions`

Le lane che consumano questi casi possono differire nell'output atteso
(`Patient Insight`, `Smart Import`, resolver ICD/AIFA, lane benchmark-only), ma
non devono divergere sulla semantica del caso sorgente.

## Conseguenze

Diventa piu semplice:

- far crescere il corpus in modo auditabile e confrontabile
- trasformare failure reali in nuovi casi sintetici ripetibili
- tenere separati benchmark canonici e materiale privato di esplorazione

Diventa piu difficile:

- usare in modo pigro un archivio grezzo di documenti come se fosse gia un
  benchmark
- introdurre materiale ambiguo o poco redatto nel repository
- confondere shadow evaluation locale con training/finetuning operativo

## First Thin Slice

1. Persistire questa decisione come ADR proposta e collegarla a `WUL-131`.
2. Aggiungere una nota operativa con struttura minima dei casi documentali e
   policy `repo canonico vs vault privato`.
3. Tenere il vault privato fuori Git e fuori dai flussi automatici del runtime.
4. Usare `WUL-131` come ponte tra il corpus multi-archetipo chiuso in `WUL-129`
   e la governance AI di `WUL-111`.

## Fuori Scope

- committare documenti reali o quasi reali nel repository
- introdurre cloud storage, telemetry o sync automatico del vault privato
- addestramento/fine-tuning su materiale documentale in questa thin slice
