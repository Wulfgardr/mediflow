<!-- Codex: created 2026-03-18 -->
# ADR 0024: Web/core stabilization before the next version bump

Date: 2026-03-18
Status: Accepted

## Problema

Prima del prossimo version bump importante, il web/core di MediFlow ha bisogno di
una base piu serena e meno fragile. Il rischio oggi non e una singola regressione
grave, ma il combinato di quattro fattori:

- drift tra le superfici paziente `web` e `/api/v1`
- parsing duplicato dei campi strutturati paziente lato client/runtime AI
- componenti shell troppo carichi (`SecurityProvider`, `SettingsPage`)
- loop di verifica incompleto, senza uno script `typecheck` stabile

Se questi punti restano impliciti nel codice, ogni nuova slice aumenta il costo di
review e la probabilita di divergenza tra comportamento, typing e documentazione.

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) richiede diff piccoli, contratti stabili
  e manutenibilita esplicita.
- [SECURITY.md](../../SECURITY.md) vieta espansioni non necessarie delle superfici
  dati e impone cautela sui flussi auth/session e sui campi clinici sensibili.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) tratta il typecheck come controllo
  consigliato e il repository espone ora lo script canonico `npm run typecheck`.
- [PLANS.md](../../PLANS.md) identifica gia come aperti la coerenza API <-> UI e
  l'igiene del repository (`typecheck`, allineamento interfacce/schema).
- Le route paziente web e `/api/v1` duplicano oggi normalizzazione e write-path:
  `app/api/patients/route.ts`, `app/api/patients/[id]/route.ts`,
  `app/api/v1/patients/route.ts`, `app/api/v1/patients/[id]/route.ts`.
- La duplicazione sui write-path non e solo teorica: oggi `PUT /api/patients/[id]`
  tratta `birthDate === ''` come `null` e valida la data prima del salvataggio,
  mentre `PUT /api/v1/patients/[id]` non applica esattamente la stessa semantica.
- `lib/db.ts` e `lib/ai-context.ts` eseguono parsing separato di `diagnoses` e
  `documentInsights`, con revival parziale delle date e typing non allineato.
- `components/security-provider.tsx` accorpa bootstrap auth, restore sessione,
  unlock crypto, inactivity lock, repair flow e shell UI.
- `app/settings/page.tsx` continua a essere un god page con profilo utente,
  AI settings, model pull, AIFA import, diagnostica, backup e launch hooks.
- `tsconfig.json` include ancora alberi generati `.next*`, quindi promuovere
  `tsc --noEmit` a gate canonico richiede prima una stabilizzazione minima
  dell'input TypeScript.

## Opzioni

1. Fare un refactor ampio prima del version bump.
2. Lasciare l'assetto attuale e correggere i punti deboli solo caso per caso.
3. Adottare una sequenza di stabilizzazione a thin slice, con helper condivisi e
   verify gate minimi, senza riscrivere la UI o il dominio.

## Trade-off

- Opzione 1:
  - Pro: affronta subito gran parte del debito tecnico percepito.
  - Contro: diff troppo largo, piu difficile da verificare, alto rischio di
    mischiare manutenzione, feature e cleanup estetico.
- Opzione 2:
  - Pro: nessun costo upfront.
  - Contro: il drift continua a crescere e ogni nuova issue paga di piu in review,
    typing e regressioni indirette.
- Opzione 3:
  - Pro: riduce i punti di fragilita reali con diff piccoli e testabili.
  - Contro: non "ripulisce tutto" subito; richiede disciplina di sequenziamento.

## Decisione

Adottiamo l'opzione 3.

Prima del prossimo version bump importante, la manutenzione web/core va trattata
come una sequenza di consolidamento, non come un refactor generale.

La sequenza canonica e:

1. Estrarre un helper puro server-side per la normalizzazione dei write-path
   paziente (`POST`/`PUT`) condiviso tra route `web` e `/api/v1`, mantenendo
   separate auth, scoping e shape delle `GET`.
2. Estrarre un helper puro condiviso per il parsing dei campi strutturati
   paziente (`exemptions`, `diagnoses`, `documentInsights` e relativi revival di
   data) usato sia da `lib/db.ts` sia da `lib/ai-context.ts`.
3. Stabilizzare l'input TypeScript e solo dopo formalizzare `npm run typecheck`
   come gate canonico del repository e inserirlo nel loop operativo documentato.
4. Continuare lo smontaggio incrementale di `SecurityProvider` partendo da
   `useInactivityLock` e da un piccolo modulo client auth/session, senza
   cambiare il contratto server.
5. Continuare lo smontaggio incrementale di `SettingsPage` partendo da un
   controller dedicato per AI/settings, prima di separare altre card.

L'obiettivo non e ridurre la complessita di dominio, ma renderla piu esplicita,
riusabile e verificabile.

## Esplicitamente fuori scope

Questa ADR non include:

- rebuild o parity del client macOS
- merge automatico della review queue Linear gia aperta
- UI refresh ampio, redesign accessibilita o theme work
- nuove dipendenze JS/TS
- unificazione delle semantics `GET` web vs `/api/v1` sui pazienti
- unificazione dei layer auth/session tra web e native API
- riscritture di massa "for cleanliness"

## Conseguenze

- Positivo: diminuisce il rischio di drift tra web e `/api/v1` sui pazienti.
- Positivo: riallinea un drift gia reale sul trattamento di `birthDate` nei
  write-path paziente.
- Positivo: il runtime AI smette di dipendere da un parsing strutturato
  parallelo e poco tipizzato.
- Positivo: il verify loop diventa piu esplicito e meno dipendente da memoria
  locale o comandi ad hoc, ma solo dopo aver reso stabile il perimetro del
  `typecheck`.
- Positivo: il cleanup dei file piu densi resta compatibile con diff piccoli.
- Negativo: parte del debito visibile restara temporaneamente in piedi finche le
  thin slice non verranno eseguite una per volta.
- Negativo: alcuni hotspot continueranno a sembrare "grandi" anche dopo il primo
  pass, perche l'obiettivo e decomporli, non riscriverli.

## First Thin Slice

1. Introdurre un helper server-side per la normalizzazione dei payload paziente
   in scrittura (`normalizePatientCreateInput`, `normalizePatientUpdateInput` o
   equivalente), riusabile da route `web` e `/api/v1`.
2. Spostare su quel modulo i `POST` e `PUT` paziente, lasciando in route auth,
   audit actor resolution, scoping e shape di risposta.
3. Coprire con test isolati i punti di drift reali: `birthDate`, structured
   fields `null/undefined`, `version` increment e detection di payload vuoti.
4. Lasciare `GET`, `SecurityProvider`, `SettingsPage` e `typecheck` come thin
   slice successive, gia ordinate da questa ADR.
