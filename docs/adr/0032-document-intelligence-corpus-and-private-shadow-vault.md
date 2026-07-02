<!-- Codex: created 2026-04-02 -->
# ADR 0032: corpus document intelligence canonico in repo e vault locale privato per shadow evaluation

Date: 2026-04-02  
Status: Accepted

Update 2026-07-02: il secondo giro di hardening dello stack intelligence
promuove questa decisione a `Accepted` e fissa la struttura minima del vault
privato usato dai benchmark documentali. Il repository resta `synthetic-only`;
il vault resta fuori Git e fuori dagli artifact pubblici.

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

### Layout operativo del vault

Il vault vive fuori Git. Il percorso concreto e locale all installazione e deve
essere passato esplicitamente agli script, senza default che punti dentro il
repository.

Layout raccomandato:

```text
document-vault/
  manifests/
    router-manifest.json
  cases/
    <classe>/
      <case-id>/
        source/
        derived/
        notes.md
  reports/
    router/
```

Regole:

- `source/` contiene solo materiale privato locale e non redistribuibile.
- `derived/` contiene estratti minimizzati o redatti usati per failure analysis
  locale, mai per commit.
- `notes.md` deve contenere solo osservazioni operative redatte e non deve
  essere copiato nel repository se deriva da materiale reale.
- `reports/` puo contenere output benchmark PHI-safe, ma la pubblicazione in PR
  richiede review manuale e deve escludere file path reali, testo clinico reale,
  CF, NRE, codici regionali, indirizzi, contatti e altri identificatori.

### Manifest benchmark router

Il router deterministico consuma un manifest JSON fuori Git, passato da CLI.
La forma minima e:

```json
{
  "entries": [
    {
      "file": "2026-01-01__laboratorio__caso-sintetico.pdf",
      "expectedClass": "lab_report",
      "labelSource": "filename"
    }
  ]
}
```

Campi opzionali ammessi per benchmark locale:

- `text`: estratto redatto o sintetico usato come `textSample`
- `producer`: metadato PDF Producer redatto o sintetico
- `creator`: metadato PDF Creator redatto o sintetico

`file` nel manifest privato puo essere un nome relativo o un identificatore di
caso. Nei report condivisi non devono comparire path assoluti del vault.

### Consumo nei benchmark

I benchmark devono:

- leggere il manifest da un percorso CLI esplicito
- usare fixture sintetiche inline per self-test ripetibili in repo
- produrre metriche aggregate per classe e confusioni, non dump del contenuto
  documentale
- fallire in modo esplicito su manifest malformati
- non aprire network, non introdurre cloud e non scrivere nel repository durante
  la valutazione del vault

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

1. Persistire questa decisione come ADR accettata e mantenerla collegata a
   `WUL-131`.
2. Usare `scripts/benchmark-document-router.ts` come primo consumer del manifest
   privato del vault, con `--self-test` sintetico sempre eseguibile in repo.
3. Tenere il vault privato fuori Git e fuori dai flussi automatici del runtime.
4. Usare i report aggregati del router per distillare nuovi archetipi sintetici
   nel corpus canonico, senza promuovere materiale reale nel repository.

## Fuori Scope

- committare documenti reali o quasi reali nel repository
- introdurre cloud storage, telemetry o sync automatico del vault privato
- addestramento/fine-tuning su materiale documentale in questa thin slice
