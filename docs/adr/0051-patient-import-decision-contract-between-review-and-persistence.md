# ADR 0051: patient import decision contract tra review documentale e persistenza prudente

Date: 2026-05-01
Status: Accepted

## Problema

MediFlow ha gia una pipeline document-driven utile nel create-flow:

- OCR locale + analisi documentale
- review esplicita di anagrafica, diagnosi e terapie
- persistenza prudente delle sole write abbastanza confermate

Quello che manca e un contratto esplicito tra:

- il draft reviewable presentato all operatore
- la decisione finale su cosa diventa write strutturata, nota o materiale escluso

Oggi questa semantica esiste soprattutto nel comportamento del codice e nella
pratica operativa, ma non ancora come artifact canonico riusabile da lane AI
locali e logica deterministica di merge/create.

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) richiede contratti espliciti e diff piccoli.
- [SECURITY.md](../../SECURITY.md) impone che l output AI resti non fidato finche non reviewato.
- ADR 0040 (private) fissa come north star la separazione tra `recognition`, `source governance`, `decision` e `render/projection`.
- [ADR 0042](./0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md) governa il create-flow reviewable della nuova anagrafica, ma non formalizza ancora un artifact decisionale intermedio.

## Opzioni

1. Lasciare la decisione implicita nel codice del create-flow.
2. Introdurre un contratto minimo `patient import decision` tra review e apply, senza cambiare ancora il runtime documentale largo.
3. Aspettare il ledger documentale completo e risolvere tutto in un refactor piu ampio.

## Trade-off

- Opzione 1:
  - Pro: nessun nuovo artifact.
  - Contro: la semantica prudente resta difficile da distillare, testare e riusare.
- Opzione 2:
  - Pro: rende esplicita la decisione reviewable con diff piccolo e subito utile per i modelli locali.
  - Contro: il primo slice resta centrato sul create-flow e non copre ancora tutta la document intelligence.
- Opzione 3:
  - Pro: massima pulizia teorica.
  - Contro: rimanda un miglioramento pratico e reviewable gia disponibile oggi.

## Decisione

Adottiamo l opzione 2.

Introduciamo un contratto minimo `mediflow.patient_import_decision.v1` che separa:

- target dell import: `create_new_patient`, `merge_existing_patient`, `review_identity`
- decisioni field-by-field
- decisioni sulle diagnosi: `apply_structured`, `review_only`, `ignore`
- decisioni sulle terapie: `persist_structured`, `append_note`, `ignore`

Regole forti della thin slice:

- il review draft resta l interfaccia operatore
- la persistenza prudente del create-flow deriva dal nuovo artifact decisionale
- le terapie non abbastanza confermate restano nota documentale invece di forzare una write strutturata
- il merge automatico e ammesso solo su match forte di codice fiscale; i match anagrafici degradano a review identitaria

## Conseguenze

Diventa piu semplice:

- distillare il comportamento pratico dell import in un contratto misurabile
- confrontare modelli locali su un artifact piu vicino alla decisione reale
- riusare la stessa semantica in future lane `create/merge/update`

Diventa piu difficile:

- mantenere implicita la logica di apply prudente nel solo codice UI
- trattare il create-flow come un prefill opaco senza write-set esplicito

## First Thin Slice

1. Introdurre `lib/patient-import-decision.ts` con schema, helper target-aware e apply deterministico.
2. Far derivare `applyPatientDocumentReview(...)` dal nuovo `ImportDecision`.
3. Aggiungere test puri su merge vs create vs review identity e su write strutturate vs note-only.
4. Aggiornare walkthrough e piano attivo con la nuova slice.

## Fuori Scope

- migrazioni DB o persistenza dedicata dell artifact
- auto-merge su match deboli
- estensione immediata a smart import sul profilo paziente gia esistente
- promozione di nuove lane AI o cambio modello
