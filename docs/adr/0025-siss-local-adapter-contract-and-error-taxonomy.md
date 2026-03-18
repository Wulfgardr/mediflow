<!-- Codex: created 2026-03-18 -->
# ADR 0025: Contratto locale SISS, taxonomy errori e retry transienti

Date: 2026-03-18  
Status: Accepted

---

## Problema

Oggi MediFlow espone SISS solo come quick-link browser-side: apre il portale e
copia il codice fiscale negli appunti. Questo basta per l'handoff manuale, ma
non lascia nessun contratto locale riusabile per una futura integrazione piu
solida nel pannello prescrizioni o in un adapter certificato.

Senza un contratto locale, i prossimi step rischiano di mescolare UI,
window-opening, error handling, retry policy e audit metadata nello stesso
punto, con comportamento fragile e poco testabile.

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` richiedono local-first, no egress implicito
  e logging PHI-safe.
- La taxonomy audit minima (`ADR 0015`) esiste gia, ma non c'e ancora una
  convenzione SISS per correlation ID, reason code e retry transienti.
- Nel codice attuale `lib/siss.ts` e solo un helper browser-side per handoff al
  portale `operatorisiss`.
- La sequenza corretta del filone SISS e:
  1. baseline/contesto operativo
  2. adapter locale con error taxonomy e retry
  3. integrazione UI nel pannello prescrizioni

## Opzioni

1. Continuare con helper UI/browser ad hoc e aggiungere altro comportamento
   direttamente nel pannello prescrizioni.
2. Collegare subito la UI a una futura integrazione SISS senza uno strato
   adapter locale esplicito.
3. Definire prima un contratto locale minimale dell'adapter SISS con operazioni
   tipizzate, error taxonomy stabile, retry sui failure transienti e metadata
   audit redatti.

## Trade-off

- Opzione 1:
  - Pro: nessun lavoro strutturale iniziale.
  - Contro: UI accoppiata ai dettagli del trasporto e impossibile da evolvere in
    modo pulito verso un adapter certificato.
- Opzione 2:
  - Pro: apparentemente piu veloce.
  - Contro: sposta complessita e drift in componenti user-facing prima che il
    dominio sia stabilizzato.
- Opzione 3:
  - Pro: separa il dominio SISS dalla UI, rende i failure mode testabili e
    preserva la possibilita di partire da handoff browser o da backend
    certificato senza cambiare il chiamante.
  - Contro: la prima slice non aggiunge ancora valore visibile all'utente finale.

## Decisione

Adottiamo l'opzione 3.

Introduciamo un modulo locale `lib/siss-adapter.ts` con queste responsabilita:

- azioni tipizzate minime (`prescription.create`, `fse.lookup`)
- correlation ID locale per ogni richiesta adapter
- error taxonomy stabile (`SISS_INVALID_INPUT`, `SISS_AUTH_REQUIRED`,
  `SISS_DENIED`, `SISS_RATE_LIMITED`, `SISS_UNAVAILABLE`, `SISS_UPSTREAM`,
  `SISS_CONFIGURATION`)
- retry automatico solo sui failure transienti
- metadata audit PHI-safe, basati su flag strutturati, conteggio tentativi e
  `reasonCode`
- primo transport dimostrativo `portal-handoff`, ancora coerente con lo stato
  reale del prodotto

Questo modulo non apre finestre, non copia negli appunti e non parla ancora a un
backend certificato. Rimane un foundation layer locale, pronto per essere usato
da future route o UI.

## Conseguenze

- Positivo: `WUL-44` potra integrare il pannello prescrizioni contro un
  contratto locale, senza hardcodare retry/error handling nella UI.
- Positivo: i future failure mode SISS diventano documentati e unit-testable.
- Positivo: il transport `portal-handoff` consente di restare aderenti allo
  stato attuale senza fingere un'integrazione certificata gia esistente.
- Negativo: serve un follow-up per collegare davvero la UI o eventuali route al
  nuovo adapter.
- Negativo: la taxonomy audit SISS resta solo metadata-level finche non esiste
  un write path dedicato.

## First Thin Slice

1. Aggiungere `lib/siss-adapter.ts` come foundation pura e testabile.
2. Coprire i casi minimi:
   - input invalido
   - handoff browser/portal riuscito
   - errore transiente con retry e successivo recupero
   - errore auth non retryable
3. Registrare la decisione nei documenti canonici.
4. Lasciare la UI/pannello prescrizioni come follow-up separato.
