# Document Intelligence Lab

Stato documento: `SECONDARY`  
Ultimo aggiornamento: 2026-05-27

Questa nota traduce [ADR 0032](./adr/0032-document-intelligence-corpus-and-private-shadow-vault.md)
in una struttura operativa minima per i prossimi cicli AI documentali.

Direzione architetturale aggiornata:

- [ADR 0040](./adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md)
  fissa la north star del prossimo ciclo: trattare il documento come
  `evidence ledger`, con separazione tra recognition, source governance,
  decision layer e render/projection.

Prima baseline concreta di questa policy:

- contratto condiviso: [lib/document-intelligence-case-pack.ts](../lib/document-intelligence-case-pack.ts)
- fixture esempio: [scripts/fixtures/document-intelligence-case-pack.example.json](../scripts/fixtures/document-intelligence-case-pack.example.json)

## Obiettivo

Far crescere la document intelligence di MediFlow senza perdere:

- benchmark ripetibili
- policy `synthetic-only` in repo
- confine chiaro tra materiale canonico e materiale privato di esplorazione

## Strategia a due livelli

### 1. Corpus canonico in repo

Va usato per:

- benchmark automatici
- regressioni
- confronti tra modelli
- review di PR e runbook ripetibili

Vincoli:

- solo `synthetic-only`
- nessun PHI/PII reale
- ogni caso deve essere abbastanza strutturato da alimentare piu lane

### 2. Vault locale privato fuori Git

Va usato per:

- shadow evaluation locale
- failure analysis
- studio di OCR rumoroso o layout difficili
- ispirazione controllata per creare nuovi casi sintetici

Vincoli:

- mai committarlo
- mai allegarlo a PR o issue pubbliche
- non usarlo come training dataset operativo senza una nuova ADR esplicita

Per la lane opzionale `cloud comparator shadow eval`, il vault privato ospita
anche i `case pack` redatti/minimizzati dedicati al confronto `local vs GPT-5.4`
descritti in
[docs/cloud-comparator-shadow-eval.md](./cloud-comparator-shadow-eval.md) e
governati da
[ADR 0039](./adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md).
Questi pack restano fuori Git e non diventano corpus canonico; possono pero
portare `learningObjectives` e `hypothesisTags` per guidare la distillazione
tecnica verso nuove euristiche e benchmark sintetici.

## Pacchetto di caso minimo

Ogni caso documentale canonico dovrebbe poter rispondere almeno a queste
domande:

- che tipo di documento e?
- quali fatti clinici dovrebbero essere estratti?
- quali elementi non devono essere estratti?
- che cosa dovrebbe vedere `Smart Import`?
- che cosa dovrebbe vedere `Patient Insight`?

Shape minima consigliata:

```json
{
  "id": "doc-case-discharge-001",
  "archetype": "discharge-letter",
  "sourceText": "Testo clinico sintetico...",
  "ocrVariant": "Testo rumoroso/OCR degradato...",
  "goldFacts": {
    "problems": [],
    "therapies": [],
    "followUp": [],
    "careSetting": [],
    "functionalStatus": []
  },
  "expectedEvidencePack": {},
  "expectedSmartImport": {
    "diagnoses": [],
    "therapies": [],
    "forbidden": []
  },
  "negativeAssertions": []
}
```

La shape sopra non sostituisce i corpora lane-specific attuali: serve come
pacchetto sorgente canonico da cui derivare benchmark piu specializzati.

## Archetipi minimi da coprire

- lettera di dimissione
- referto di pronto soccorso
- relazione specialistica
- relazione clinica lunga
- impegnativa / referral
- documento riabilitativo o ADI
- caso con negazioni rilevanti
- caso con familiarita o anamnesi remota non da promuovere
- caso con terapia sospesa o in transizione
- caso con OCR sporco o layout difficile

## Uso per lane

### Smart Import

Serve verificare:

- recall di diagnosi e terapie
- gestione `new|already-present|update|uncertain|inactive|transition`
- leakage di candidati vietati o gia presenti

### Patient Insight

Serve verificare:

- recency
- focus clinico
- gerarchia fonti
- citazioni e stale leakage
- recupero locale di fonti attese che un input curato manualmente potrebbe
  omettere

### Resolver ICD/AIFA

Serve verificare:

- query candidate corrette
- top-k utili
- casi ambigui
- mismatch tra testo, evidence pack e coding suggerito

### Lane benchmark-only

Per `redaction`, `clinical_entities` o sidecar futuri, il caso va proiettato in
modo lane-specific senza riscrivere la semantica del documento sorgente.

Il probe `WUL-286` aggiunge al benchmark di assorbimento evidenze una
comparazione dichiarativa `curatedSourceIds` vs queue locale: serve a misurare il
pattern "prima cerco le fonti, poi sintetizzo" senza importare ClinSeekAgent nel
runtime. Restano fuori scope codice ClinSeekAgent, dati MIMIC, browser/cloud
tooling, modelli ClinSeek, SQL generato dal modello e qualunque dato paziente
reale.

## Regola pratica

Quando emerge un fallimento su materiale realistico locale:

1. analizzarlo nel vault privato
2. astrarne il pattern clinico/documentale
3. trasformarlo in un nuovo caso sintetico canonico
4. aggiungerlo ai benchmark pertinenti

Il vault privato serve quindi a **generare nuovi archetipi sintetici migliori**,
non a sostituire il corpus canonico.

Per il diario clinico e per raccolte locali sensibili come `Downloads` /
`Sanita Personale`, la stessa regola vale in modo stretto: i documenti possono
ispirare solo pattern redatti e fixture sintetiche. Non vanno copiati in repo,
prompt, issue, report, log, corpus benchmark o input Claude; eventuali esempi
operativi devono essere ricreati come casi sintetici senza PHI/PII o
identificativi real-shaped.
