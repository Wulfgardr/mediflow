# Document Intelligence Lab

Stato documento: `SECONDARY`  
Ultimo aggiornamento: 2026-04-02

Questa nota traduce [ADR 0032](./adr/0032-document-intelligence-corpus-and-private-shadow-vault.md)
in una struttura operativa minima per i prossimi cicli AI documentali.

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

### Resolver ICD/AIFA

Serve verificare:

- query candidate corrette
- top-k utili
- casi ambigui
- mismatch tra testo, evidence pack e coding suggerito

### Lane benchmark-only

Per `redaction`, `clinical_entities` o sidecar futuri, il caso va proiettato in
modo lane-specific senza riscrivere la semantica del documento sorgente.

## Regola pratica

Quando emerge un fallimento su materiale realistico locale:

1. analizzarlo nel vault privato
2. astrarne il pattern clinico/documentale
3. trasformarlo in un nuovo caso sintetico canonico
4. aggiungerlo ai benchmark pertinenti

Il vault privato serve quindi a **generare nuovi archetipi sintetici migliori**,
non a sostituire il corpus canonico.
