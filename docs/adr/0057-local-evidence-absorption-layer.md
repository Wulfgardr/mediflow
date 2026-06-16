# ADR 0057: local evidence absorption layer

Date: 2026-05-03
Status: Proposed

---

## Problema

MediFlow ha gia una prima base `artifact-first` per gli allegati: gli
attachment possono persistere snapshot `parse/evidence`, `summarySnapshot` e
projection compatibili verso `patients.documentInsights`. Il passo successivo
non e addestrare modelli o cambiare runtime AI, ma rendere piu affidabile
l'assorbimento locale delle fonti cliniche gia presenti nel sistema.

Il problema da risolvere e duplice:

- gli allegati senza testo utile o senza provenance sufficiente restano fuori
  dai consumer in modo difficile da governare;
- il diario clinico e ancora una sorgente longitudinale importante, ma non e
  trattato come evidenza citabile con lo stesso rigore documentale degli
  allegati.

Senza un layer comune di assorbimento, `Patient Insight`, Smart Import e futuri
decision layer rischiano di duplicare euristiche, usare fonti stale o rendere
difficile spiegare perche una fonte e entrata o e stata esclusa.

## Contesto

Questa decisione estende, senza sostituire, le decisioni gia acquisite:

- ADR 0040 fissa il documento come `evidence ledger`, con separazione tra
  `recognition`, `source governance`, `decision layer` e `render/projection`.
- WUL-152 ha portato il primo artifact runtime `parse/evidence` sugli allegati
  e il primo consumer in `Patient Insight`.
- WUL-202 ha chiuso il gate di artifact governance/backfill; i residui
  `skip_no_usable_text` sono una lane di provenance/reimport separata, non un
  motivo per riaprire write path non governati.
  mai come dipendenza runtime o canale dati clinici.

Vincoli non negoziabili:

- local-first di default;
- nessun training o fine-tuning;
- nessuna dipendenza cloud runtime;
- nessun PHI/PII in repo, prompt, log o fixture;
- nessun auto-write di diagnosi, terapie, problemi o altri campi clinici
  strutturati da testo libero;
- Smart Import e Patient Insight restano reviewable e source-grounded.

## Opzioni

1. Migliorare separatamente `Patient Insight`, Smart Import e i planner
   documentali.
2. Introdurre subito un nuovo schema persistente completo per un evidence
   ledger condiviso.
3. Introdurre un layer locale di assorbimento e retrieval, con contract
   versionato e producer/consumer incrementali.

## Trade-off

- Opzione 1:
  - Pro: diff piccoli nel breve periodo.
  - Contro: moltiplica ranking, staleness, provenance e citation policy nei
    consumer.
- Opzione 2:
  - Pro: modello dati finale piu esplicito.
  - Contro: troppo ampia per una first slice; rischia migrazioni premature e
    regressioni sui flussi clinici esistenti.
- Opzione 3:
  - Pro: crea un punto comune per fonti, citazioni, freshness e motivi di
    inclusione/esclusione senza richiedere un rewrite.
  - Contro: richiede disciplina nel mantenere back-compat con gli artifact
    esistenti e nel non trasformare l'indicizzazione in decisione clinica.

## Decisione

Adottiamo l'opzione 3.

MediFlow introduce come direzione architetturale un **local evidence absorption
layer**: un layer interno, locale e versionato che normalizza le fonti
cliniche disponibili in evidence item citabili, prima che i consumer AI o i
decision layer decidano come usarle.

Il layer deve distinguere quattro responsabilita:

- `recognition`: cosa e stato trovato nella fonte, con anchor verificabili;
- `source governance`: provenance, freshness, priorita, qualita e motivi di
  inclusione o esclusione;
- `decision`: cosa puo diventare suggerimento reviewable, cosa resta blocked,
  stale, low-signal o needs-review;
- `render/projection`: come `Patient Insight`, Smart Import o altri consumer
  presentano l'evidenza all'operatore.

Le prime fonti ammesse sono:

- allegati e artifact documentali gia governati (`summarySnapshot`,
  `parseEvidenceArtifactSnapshot`, projection compatibili);
- diario clinico come sorgente longitudinale citabile, solo in modalita
  indexing/retrieval.

Il diario clinico non diventa un canale di scrittura clinica strutturata. Un
evidence item derivato da diario puo esporre `sourceId`, tipo sorgente, data,
freshness, snippet citabile o span/offset e motivazione di inclusione; non puo
creare o aggiornare diagnosi, terapie, osservazioni o altri record clinici.

## Conseguenze

Diventa piu semplice:

- spiegare perche una fonte entra o non entra in `Patient Insight`;
- bloccare consumer che usano evidenza senza passare dal contract condiviso;
- misurare `citationCorrectness`, leakage da fonti stale e copertura del diario
  con fixture sintetiche;
- tenere separata la remediation degli allegati senza testo utile dal normale
  runtime clinico.

Diventa piu difficile:

- aggiungere scorciatoie direttamente nei prompt o nei render finali;
- trattare `documentInsights` come unico contenitore sufficiente;
- far crescere Smart Import senza un gate esplicito su reviewability e fonti.

Rischi principali:

- schema churn se il contract viene usato prima di essere versionato;
- citation hallucination se i benchmark misurano solo coverage e non
  correttezza dello span;
- confusione tra indicizzazione del diario e promozione clinica;
- leakage PHI-safe se report o telemetry includono testo sorgente.

Mitigazioni:

- introdurre prima il contract versionato della evidence queue;
- aggiungere benchmark synthetic-only con `citationCorrectness`;
- tenere `WUL-215` retrieval-only e coperto da test di zero structured writes;
- rendere telemetry e report solo locali, aggregati e senza testo clinico.

## First Thin Slice

1. Definire il contract/schema versionato della evidence queue locale
   (`WUL-216`), con source id, source type, freshness, priority, inclusion
   reason, exclusion reason e back-compat con gli artifact WUL-152.
2. Aggiungere un benchmark synthetic-only (`WUL-217`) che misuri assorbimento
   da allegati e diario, inclusa `citationCorrectness`.
3. Proiettare il diario clinico in evidence item citabili e retrieval-only
   (`WUL-215`), sopra il contract e senza scritture cliniche strutturate.
4. Migrare i consumer solo dopo il contract: `Patient Insight` prima, Smart
   Import dopo e solo con review gate invariato (`WUL-218`).

## Fuori Scope

- training o fine-tuning;
- embedding o servizi cloud come dipendenza runtime;
- nuova migrazione DB monolitica del ledger completo;
- reimport/apply automatico degli allegati `skip_no_usable_text`;
- auto-write di diagnosi, terapie, osservazioni o problemi da testo libero;
- runtime dependency da Claude/Opus o comparator esterni.

## Stop Rules

- Stop se una slice introduce PHI/PII reale o real-shaped in repo, fixture,
  prompt, log o report.
- Stop se una slice propone training, fine-tuning o cloud runtime dependency.
- Stop se `WUL-215` scrive in tabelle cliniche strutturate.
- Stop se `WUL-214` bypassa il gate WUL-202 per remediation/apply.
- Stop se un consumer usa evidenza senza passare dal contract WUL-216.
- Stop se `WUL-217` non riesce a far fallire una citazione fabbricata o mostra
  `citationCorrectness` sotto soglia per la slice interessata.

## Riferimenti

- ADR 0040 (private)
- [ADR 0051](./0051-patient-import-decision-contract-between-review-and-persistence.md)
- Document Intelligence Lab (private)
- Patient Insight benchmark (private)
- Patient Insight document troubleshooting (private)
