# Potatura dei flow ambulatoriali e sessione web P3 dedicata

Modella la promessa violata nel rilievo P2 della PR #943 (`806336149`): un flow
scaduto del comando distruttivo ambulatoriale puo' lasciare la tabella in memoria
solo quando il suo controllo Web dedicato non ha alcuna sessione attiva ne' un
login pendente capace di aprirne una dopo la potatura.

Se la promessa si rompe, una sessione admin web nata sul controllo dedicato
prima della prima anteprima perde il proprio flow (`retire` risponde 401 e la
sessione resta aperta), oppure un login rimasto a meta' completa dopo la potatura.

| Stato o azione | Codice |
| --- | --- |
| `BeginLogin`, `IssueSession` | `beginWebAuthControl`, `issueWebAuthControl` in `lib/security/web-auth-control-transport.ts` |
| `RecordWebId` | `web()` in `lib/security/ambulatory-destructive-service.ts` |
| `Expire` | finestra `AMBULATORY_COMMAND_PREPARATION_MS` in `lib/security/ambulatory-destructive-service.ts` |
| `PruneExpired` | `controlIsIdle()` e `pruneExpired()` in `lib/security/ambulatory-destructive-service.ts` |
| `Retire` | `retire()` in `lib/security/ambulatory-destructive-service.ts` |

## Limiti e assunzioni

Il modello copre un singolo flow e il suo controllo Web dedicato; la capienza
di 128 voci e le scritture SQLite del comando distruttivo sono verificate dalle
suite runtime (`lib/security/ambulatory-destructive-capacity.test.ts` e
`lib/security/ambulatory-destructive-process.test.ts`). Le operazioni dell'owner
di controllo e la tabella `flows` sono sincrone nel processo Web.

## Esecuzione

Eseguito in CI da `npm run verify:formal-models` con TLA+ `v1.7.4` (TLC `2.19`):

- `CheckFlowWebIdOnly = TRUE` riproduce la prima versione della PR #943 e viola
  `NoOrphanedActiveSession` (`BeginLogin -> IssueSession -> Expire -> PruneExpired`).
- `SkipControlLockOnPrune = TRUE` viola `NoSessionBornAfterPrune` (un login in
  corso sopravvive alla potatura).
- `NoActiveRetireWitness` e `NoPruneAfterPendingLoginWitness` provano la non
  vacuita' dei due percorsi attesi.
- `scripts/verify-formal-models.mjs` applica inoltre una mutazione isolata a
  `lib/security/ambulatory-destructive-service.ts` e verifica che
  `lib/security/ambulatory-destructive-capacity.test.ts` fallisca sul codice mutato.
