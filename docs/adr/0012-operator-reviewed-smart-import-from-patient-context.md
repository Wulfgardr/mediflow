# ADR 0012: Smart import reviewable da note, diario e documenti nel profilo paziente

Date: 2026-03-17  
Status: Accepted

---

## Problema

MediFlow ha gia una pipeline OCR-first che produce insight e proposte
diagnostiche da revisionare. La sintesi documentale non scrive diagnosi nella
scheda, come stabilito da ADR 0084. Nel profilo paziente manca ancora un
percorso unico e revisionabile per trasformare in dati strutturati:

- patologie citate in testo libero nelle note paziente o nel diario clinico
- terapie menzionate per farmaco, principio attivo o posologia
- informazioni gia presenti nei document insights

Senza questo passaggio, il modello puo solo sintetizzare o riempire casi molto
ristretti, ma non aiuta l'operatore a popolare in modo sicuro diagnosi e terapie.

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` impongono local-first, nessun egress cloud e
  logging PHI-safe.
- ADR 0006 richiede un uso coerente delle terminologie e dei cataloghi locali.
- ADR 0010 governa `/api/v1` con processo spec-first, ma questa slice non ha
  bisogno di estendere subito il contratto stabile shared.
- ADR 0084 sostituisce l'autofill diagnostico da documento con proposte
  review-only. Nessun codice, anche se esplicito, viene scritto dalla sintesi.

## Opzioni

1. Estendere l'autofill automatico silenzioso a note, diario e documenti.
2. Introdurre uno smart import reviewable, web-first, con suggerimenti
   strutturati e applicazione manuale selettiva.
3. Bloccare la feature finche non esiste un endpoint `/api/v1` dedicato condiviso
   con il client macOS.

## Trade-off

- Opzione 1:
  - Pro: massima automazione percepita.
  - Contro: rischio clinico troppo alto, dedupe opaco, maggiore probabilita di
    introdurre patologie/terapie non confermate.
- Opzione 2:
  - Pro: preserva controllo umano, riusa modelli e cataloghi locali esistenti,
    diff piccolo, nessuna nuova tabella, nessun impatto immediato su OpenAPI.
  - Contro: la feature resta inizialmente web-only e richiede un click esplicito
    dell'operatore.
- Opzione 3:
  - Pro: parita futura piu pulita fin dal primo giorno.
  - Contro: rallenta inutilmente la thin slice e forza lavoro contrattuale `/api/v1`
    prima di validare il flusso clinico.

## Decisione

Adottiamo l'opzione 2.

Regole operative:

- nel profilo paziente compare una CTA persistente solo se esistono fonti utili
  (note, diario clinico, document insights o summary di allegati)
- il modello clinico locale piu capace configurato produce suggerimenti
  strutturati per diagnosi e terapie con evidenze testuali locali
- le diagnosi da free text non vengono applicate in modo silenzioso:
  devono prima ottenere un match ICD-11 locale e poi essere confermate
  dall'operatore
- le terapie possono essere proposte come match catalogato (AIFA/ATC) oppure
  come inserimento manuale reviewable quando il catalogo non risolve
  in modo affidabile
- ADR 0084 resta vincolante: la sintesi documentale produce solo proposte da
  revisionare; l'eventuale scrittura avviene in Smart Import dopo selezione e
  conferma esplicite
- nessun nuovo endpoint `/api/v1` in questa first thin slice; eventuale
  estensione shared web/macOS richiedera update spec/ADR successivo

Decisione approvata dal Lead Architect il 2026-03-17.

## Conseguenze

- Positivo: il profilo paziente guadagna un percorso operativo unico per
  convertire testo clinico locale in dati strutturati.
- Positivo: l'uso di ICD-11 e catalogo farmaci resta governato da match locali
  reviewable, senza introdurre cloud o nuove dipendenze.
- Positivo: il rischio clinico resta piu basso rispetto a un autofill esteso.
- Negativo: nella prima slice la capability resta web-first e non ancora esposta
  come contratto stabile per macOS.

## First Thin Slice

1. Aggiungere una card persistente nel profilo paziente per generare suggerimenti
   da note, diario e documenti gia analizzati.
2. Estrarre suggerimenti strutturati reviewable per diagnosi e terapie usando il
   modello clinico locale e matching locale ICD/AIFA.
3. Applicare in modo selettivo i suggerimenti a `patients.diagnoses` e `therapies`
   con dedupe esplicito.
4. Aggiornare walkthrough, piano attivo e documentazione canonica per riflettere
   il nuovo flusso reviewable.
