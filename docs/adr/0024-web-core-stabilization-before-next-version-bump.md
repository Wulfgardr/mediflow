<!-- Codex: created 2026-03-18 -->
# ADR 0024: Web/core stabilization before the next version bump

Date: 2026-03-18
Status: Proposed

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
- [CONTRIBUTING.md](../../CONTRIBUTING.md) gia tratta `npx tsc --noEmit` come
  controllo consigliato, ma il repository non espone ancora uno script canonico.
- [PLANS.md](../../PLANS.md) identifica gia come aperti la coerenza API <-> UI e
  l'igiene del repository (`typecheck`, allineamento interfacce/schema).
- Le route paziente web e `/api/v1` duplicano oggi normalizzazione e write-path:
  `app/api/patients/route.ts`, `app/api/patients/[id]/route.ts`,
  `app/api/v1/patients/route.ts`, `app/api/v1/patients/[id]/route.ts`.
- `lib/db.ts` e `lib/ai-context.ts` eseguono parsing separato di `diagnoses` e
  `documentInsights`, con revival parziale delle date e typing non allineato.
- `components/security-provider.tsx` accorpa bootstrap auth, restore sessione,
  unlock crypto, inactivity lock, repair flow e shell UI.
- `app/settings/page.tsx` continua a essere un god page con profilo utente,
  AI settings, model pull, AIFA import, diagnostica, backup e launch hooks.

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

1. Estrarre un helper puro condiviso per normalizzazione e shaping dei payload
   paziente nelle quattro route `web` e `/api/v1`.
2. Estrarre un helper puro condiviso per il parsing dei campi strutturati
   paziente (`exemptions`, `diagnoses`, `documentInsights` e relativi revival di
   data) usato sia da `lib/db.ts` sia da `lib/ai-context.ts`.
3. Formalizzare `npm run typecheck` come gate canonico del repository e inserirlo
   nel loop operativo documentato.
4. Continuare lo smontaggio incrementale dei god files web partendo dalla shell:
   `SecurityProvider` e `SettingsPage`, con estrazioni mirate di controller/hook e
   senza cambiare i contratti funzionali.

L'obiettivo non e ridurre la complessita di dominio, ma renderla piu esplicita,
riusabile e verificabile.

## Esplicitamente fuori scope

Questa ADR non include:

- rebuild o parity del client macOS
- merge automatico della review queue Linear gia aperta
- UI refresh ampio, redesign accessibilita o theme work
- nuove dipendenze JS/TS
- riscritture di massa "for cleanliness"

## Conseguenze

- Positivo: diminuisce il rischio di drift tra web e `/api/v1` sui pazienti.
- Positivo: il runtime AI smette di dipendere da un parsing strutturato
  parallelo e poco tipizzato.
- Positivo: il verify loop diventa piu esplicito e meno dipendente da memoria
  locale o comandi ad hoc.
- Positivo: il cleanup dei file piu densi resta compatibile con diff piccoli.
- Negativo: parte del debito visibile restara temporaneamente in piedi finche le
  thin slice non verranno eseguite una per volta.
- Negativo: alcuni hotspot continueranno a sembrare "grandi" anche dopo il primo
  pass, perche l'obiettivo e decomporli, non riscriverli.

## First Thin Slice

1. Introdurre `lib/patient-structured-fields.ts` con parser/revival puri per
   `exemptions`, `diagnoses` e `documentInsights`.
2. Far usare quel modulo a `lib/db.ts` e `lib/ai-context.ts`, con test isolati
   dedicati.
3. Aggiungere `typecheck` a `package.json` come alias stabile di `tsc --noEmit`
   e allineare [CONTRIBUTING.md](../../CONTRIBUTING.md).
4. Solo dopo, estrarre l'helper condiviso delle route paziente e lo split minimo
   dei concern in `SecurityProvider` / `SettingsPage`.
