<!-- Codex: created 2026-05-05 -->
# ADR 0059: fallback OCR Apple Vision solo macOS

Date: 2026-05-05  
Status: Accepted

## Problema

La pipeline OCR-first documentata in ADR 0011 trattava `DeepSeek OCR` via
Ollama come motore OCR locale. WUL-225 ha aggiunto un comportamento nuovo: se il
motore OCR primario restituisce testo vuoto o chiaramente degenerato, il runtime
web locale su macOS puo usare Apple Vision come fallback OCR locale.

Questa scelta va resa esplicita per evitare tre ambiguita:

- far credere che Apple Vision sia una dipendenza cross-platform;
- far credere che Windows abbia gia un fallback equivalente certificato;
- confondere fallback di recognition con promozione automatica di dati clinici.

## Contesto

- [ADR 0011](./0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md)
  resta la fonte storica della pipeline OCR-first.
- [ADR 0040](./0040-document-intelligence-evidence-ledger-and-decision-layers.md)
  separa recognition, source governance, decision layer e render/projection.
- [ADR 0042](./0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md)
  richiede review esplicita nel create-flow document-driven.
- [SECURITY.md](../../SECURITY.md) vieta PHI/PII in log, fixture e repository.

## Opzioni

1. Mantenere solo DeepSeek/Ollama come OCR primario e fallire quando il testo e
   low-signal.
2. Aggiungere Apple Vision come fallback locale certificato solo su macOS.
3. Aggiungere subito fallback diversi per ogni piattaforma, inclusi Windows e
   Linux.

## Trade-off

- Opzione 1:
  - Pro: contratto semplice.
  - Contro: documenti scannerizzati standard possono fallire se il modello OCR
    locale restituisce output degenerato.
- Opzione 2:
  - Pro: resta local-first, usa un framework di sistema disponibile sul nodo
    Mac, migliora la robustezza senza nuove dipendenze cloud.
  - Contro: non e una capability Windows/Linux e va dichiarata come tale.
- Opzione 3:
  - Pro: miglior simmetria cross-platform.
  - Contro: richiede validazione separata di engine, installazione, privacy,
    packaging e failure modes; non e coperta dalla slice corrente.

## Decisione

Adottiamo l'opzione 2.

La filiera OCR certificata corrente e:

1. normalizzazione input locale;
2. OCR primario locale via Ollama/DeepSeek OCR quando disponibile;
3. rilevamento di output blank/low-signal/degenerato;
4. fallback locale Apple Vision **solo su macOS**;
5. parsing deterministico e/o sintesi locale reviewable;
6. persistenza cifrata di snapshot/artifact documentali quando applicabile.

Su Windows e Linux non esiste oggi in MediFlow un fallback OCR platform-specific
equivalente e certificato. Su quelle piattaforme il comportamento supportato
resta: OCR primario locale via Ollama/DeepSeek OCR, eventuale parsing di testo
gia disponibile, oppure failure esplicito se non viene estratto testo utile.

Il fallback Apple Vision non cambia il boundary clinico:

- non introduce cloud OCR;
- non scrive diagnosi o terapie in modo automatico;
- non rende `Smart Import` non-reviewable;
- non autorizza fixture reali o raw OCR in Git;
- non dichiara parity OCR completa tra macOS, Windows e Linux.

## Conseguenze

Positivo:

- i documenti immagine standard hanno una seconda chance locale su Mac;
- gli output patologici del modello OCR primario non vengono trattati come testo
  affidabile;
- la documentazione distingue chiaramente recognition e decision layer.

Negativo:

- il comportamento di resilienza OCR e migliore su macOS rispetto a Windows;
- Windows richiede una futura issue/ADR dedicata prima di poter dichiarare un
  fallback certificato equivalente.

## First Thin Slice

Completata in WUL-225/WUL-226:

1. detection low-signal per output OCR;
2. fallback Apple Vision server-side su macOS;
3. parsing sintetico per Piano Terapeutico/AIFA;
4. aggiornamento documentale della filiera e del boundary platform-specific.

## Fuori Scope

- fallback OCR Windows/Linux certificati;
- nuove dipendenze OCR cloud;
- OCR remoto su `network-home-base`;
- auto-write clinici da testo libero;
- fixture reali o raw OCR persistiti in repository.
