---
summary: "Post-bug-hunt MediFlow development push proposal for 2026-06-16."
read_when:
  - "Planning the next MediFlow stabilization push after WUL-341 and WUL-356."
  - "Reconciling Linear backlog, open PRs, roadmap, and public copy before new delivery work."
---

# Proposta push sviluppo MediFlow - 2026-06-16

Stato: proposta operativa per `WUL-373`.

Questa nota mette un punto fermo temporaneo dopo la review lean del
2026-06-13 (`WUL-341`) e il bug hunt AI/euristica del 2026-06-16
(`WUL-356`). Non e una release note e non autorizza merge automatici: serve a
decidere l'ordine del prossimo push di sviluppo, separando cio che e gia
verificabile da cio che resta backlog, ricerca o claim da riallineare.

Fonti canoniche: [README.md](../README.md),
[ARCHITECTURE.md](../ARCHITECTURE.md), [SECURITY.md](../SECURITY.md),
[CONTRIBUTING.md](../CONTRIBUTING.md), [PLANS.md](../PLANS.md),
[docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md),
[docs/ROADMAP.md](./ROADMAP.md),
[docs/linear-codex-playbook.md](./linear-codex-playbook.md),
[docs/adr/0060-kree8-cockpit-live-root-entry.md](./adr/0060-kree8-cockpit-live-root-entry.md)
e [docs/adr/0065-intended-purpose-and-claims-guard.md](./adr/0065-intended-purpose-and-claims-guard.md).

## Snapshot riconciliato

- `main` osservato il 2026-06-16: `a60bc47a` (`WUL-334 fix legacy patient membership cleanup`).
- PR aperte osservate: `#228`, `#251`, `#252`, `#253`, `#254`, `#255`,
  `#256`. Le PR `#253`..`#256` sono clean lato GitHub checks ma alcune
  restano draft e richiedono review/decisione prima di entrare in `main`.
- `#218` e una vecchia PR draft WUL-295 con merge state dirty; `#254`
  sembra la tranche WUL-295 corrente da trattare come candidata attiva.
- `WUL-355` e `WUL-358` hanno gia PR draft in review e rappresentano la prima
  risposta locale al bug hunt, ma non chiudono la macro `WUL-356`.
- `PLANS.md` era fermo al 2026-06-10: da ora il piano operativo deve trattare
  `WUL-341`, `WUL-356` e questa proposta come nuova coda attiva.
- `docs/ROADMAP.md` raccontava ancora la shell ufficiale come Graphite nella
  sezione post-v0.6; ADR 0060 rende invece Kree8 la root live su `/`.
- La cartella separata `../leonardopegollo.dev` e un input di posizionamento,
  non parte di questo branch. Il copy pubblico e coerente su review-first,
  no cloud di default e nessuna promessa diagnostica, ma i claim forti su
  cifratura/zero-knowledge vanno riallineati con `WUL-342` e `WUL-354`.

## Non obiettivi

- Non fondere tutte le PR aperte in un unico push.
- Non cambiare runtime clinico, schema SQLite, API o dati.
- Non modificare il sito pubblico dentro il branch MediFlow.
- Non promuovere AI, SISS/FSE, cloud, diagnosi, triage o prescrizione oltre i
  limiti di ADR 0065.
- Non usare il bug hunt come prova automatica: ogni finding resta da verificare
  nella propria issue, con test o repro locale.

## Stabilization exit package

Il punto fermo e raggiunto quando il repo ha un pacchetto di uscita verificato,
non quando tutte le idee del bug hunt sono state implementate.

Output richiesto:

1. Una tabella merge/hold per tutte le PR aperte note il 2026-06-16, con
   refresh obbligatorio prima di qualunque merge.
2. Un ledger delle fix selezionate dal bug hunt, separando:
   - fix landed o pronte per review;
   - finding verificati ma deferiti;
   - lane future intenzionali.
3. Una freeze note sui claim sicurezza/privacy:
   - niente claim zero-knowledge forte finche `WUL-342`/`WUL-354` non sono
     risolti o attenuati;
   - sito pubblico tracciato separatamente da `WUL-374`;
   - nessun claim AI autonomo o SISS/FSE nativo fuori ADR 0065.
4. Entrypoint documentali aggiornati:
   - `PLANS.md`;
   - `docs/ROADMAP.md`;
   - `docs/README.md`;
   - `docs/markdown-index.md`;
   - `CHANGELOG.md` solo dopo merge reali, non in questo commit iniziale.
5. Credito Kree8 esplicito per la linea visuale:
   - app/design system: credito diretto a Kree8 come ispirazione esterna e
     grammatica visuale di riferimento;
   - sito/pubblico: credito piu leggero ma presente quando si descrive il look
     corrente di MediFlow;
   - nessuna confusione tra ispirazione visiva e implementazione/prodotto
     clinico MediFlow.
6. Checkpoint di sistema/topologia: verificare se `docs/STATE_OF_THE_SYSTEM.md`,
   `docs/topologia-dati-flussi.md`, `docs/system_architecture.md`,
   `docs/walkthrough.md` e README devono essere riallineati dopo la merge
   train; se il riallineamento non e piccolo, aprire issue dedicata invece di
   allargare `WUL-373`.
7. Nota di verifica finale con:
   - evidenza CI usata;
   - check locali eseguiti;
   - blocker locali noti;
   - check rinviati con motivo.

## Criteri per fix selezionate

Un finding Claude/Oracle entra nel push di stabilizzazione solo se tutte queste
condizioni sono vere:

- ha impatto concreto su sicurezza paziente, data integrity, claim di
  sicurezza/privacy o stabilita della prossima versione;
- il fix e stretto e reviewable in una PR;
- esiste evidenza diretta: caso failing, repro, test o prova chiara del code
  path;
- non richiede migrazione schema, redesign ampio o modifica del sito pubblico
  dentro il branch MediFlow;
- puo essere verificato nonostante i blocker locali, usando CI, test mirati o
  review manuale dichiarata.

Il resto non e scarto: diventa backlog intenzionale per la fase successiva.

## Claim freeze matrix

| Area claim | Ammesso ora | Vietato finche non risolto | Owner/follow-up |
| --- | --- | --- | --- |
| Local-first | Workflow locale/private-by-default, se collegato a comportamento reale | Zero-knowledge come garanzia assoluta | `WUL-354`, `WUL-374` |
| Cifratura a riposo | Dichiarare il gap noto sugli identificatori se necessario | Tutti gli identificatori cifrati a riposo | `WUL-342` |
| Sito pubblico | Audit e attenuazione separati | Modificare `leonardopegollo.dev` dentro `WUL-373` | `WUL-374` |
| AI | Review-first, controlli locali, readiness gates | Scrittura clinica autonoma, triage, diagnosi o prescrizione | `WUL-355`, `WUL-358`, `WUL-356` |
| SISS/FSE | Handoff/webapp-assisted e corpus locale | Integrazione nativa certificata o writeback regionale | `WUL-180`, ADR 0065 |

## Proposta di ordine

### 1. Congelare la base di revisione

Obiettivo: evitare che il lavoro nuovo continui sopra una mappa mobile.

- Tenere `main` come base per nuove branch di issue.
- Riconfermare hash `main`, stato merge e checks PR prima di ogni merge: i dati
  di questa nota sono una fotografia del 2026-06-16.
- Tenere `WUL-373` come documento guida per il push, non come macro runtime.
- Non chiudere `WUL-295` finche la nuova proposta, la PR associata e il
  playbook operativo non sono almeno linkati e verificati.
- Trattare `WUL-374` come issue separata per il sito e per i claim pubblici.

### 2. Smaltire le PR pulite per tema

Obiettivo: ridurre rumore prima di aggredire i critical.

| PR | Issue | Stato osservato | Disposizione proposta | Evidenza richiesta |
| --- | --- | --- | --- | --- |
| `#251` | `WUL-339` | Ready, clean, checks success | Review/land candidate | Diff stretto, smoke UI mirato se tocca rendering |
| `#252` | `WUL-340` | Ready, clean, checks success | Review/land candidate | Diff stretto, verifica overflow/settings |
| `#228` | `WUL-320` | Ready, clean, checks success | Review/land candidate | Confermare che resta toolchain/test hygiene |
| `#253` | `WUL-345` | Draft, clean, checks success | Land candidate dopo safety review | Test mirati su write legacy/version guard/tombstone |
| `#254` | `WUL-295` | Draft, clean, checks success | Branch WUL-295 preferita | Verificare che sostituisca `#218` |
| `#255` | `WUL-355` | Draft, clean, checks success | Land candidate dopo AI readiness review | Test readiness/validator o blocker dichiarato |
| `#256` | `WUL-358` | Draft, clean, checks success | Land candidate dopo AI safety review | Test kill-switch/governance o blocker dichiarato |
| `#219` | `WUL-296` | Draft, clean, checks success | Hold salvo bisogno exit package | Serve solo se il ledger dual-thesis diventa prerequisito |
| `#218` | `WUL-295` | Draft, dirty | Close/supersede dopo `#254` | Conferma di copertura scope utile |

Merge train consigliata:

1. PR ready e strette: `#251`, `#252`, `#228`, se ancora clean.
2. Safety/runtime hardening: `#253`, poi `#254` come WUL-295 corrente.
3. Selected AI/readiness hardening: `#255`, `#256`, reviewate insieme ma
   mergiate separatamente.
4. Draft non essenziali: `#219` resta hold; `#218` si chiude solo dopo `#254`.
5. Patch notes e documenti di sistema si aggiornano dopo gli esiti reali della
   merge train, non prima.

### 3. Safety floor prima del prodotto nuovo

Obiettivo: non costruire roadmap sopra invarianti fragili.

- `WUL-342`: gap zero-knowledge/identificatori a riposo. Questo blocca claim
  pubblici forti e va trattato come priorita prodotto/sicurezza, non come sola
  pulizia docs.
- `WUL-344` e `WUL-335`: CI/DoD e smoke e2e. Finche questi restano aperti, le
  PR possono avanzare solo con evidenza locale dichiarata.
- `WUL-357`..`WUL-361`: critical AI/euristica dal bug hunt. Vanno ordinati per
  rischio clinico: PHI/redaction, identity wrong-patient, matching ICD/farmaci,
  e ogni altro critical figlio di `WUL-356`.
- `WUL-354`: doc vs realta. Deve seguire le decisioni tecniche, non anticiparle
  con copy ottimistico.

### 4. Coda AI e document intelligence

Obiettivo: convertire le annotazioni Claude/Oracle in slice verificabili.

- Usare `WUL-356` come tracker macro, non come branch implementation.
- Tenere i figli high/medium (`WUL-362`..`WUL-372`) separati per modulo e
  superficie: contratti AI, document decision, smart import, patient import,
  insight/context, terminology/ICD, route API.
- Per ogni figlio: leggere il finding originale, riprodurre o refutare, poi
  implementare solo il fix necessario con test dedicato.
- Se un finding richiede policy invece di codice, aprire ADR o nota in
  `PLANS.md` prima di modificare runtime.
- Lasciare lavoro futuro intenzionale: la stabilizzazione non deve assorbire
  tutti i finding Claude/Oracle, ma solo quelli che passano i criteri sopra.

### 5. Roadmap futura senza overclaim

Obiettivo: conservare la direzione Apple/home-base/document intelligence senza
promettere cio che non e stato verificato.

- Kree8 e la shell web live di `main`; Graphite resta storico/architetturale
  solo dove serve il principio no-selector.
- Home-base resta Mac autorevole + client paired, non sync cloud e non accesso
  SQLite diretto dai client.
- AI resta review-first e locale di default; comparator/cloud e lane
  benchmark-only restano strumenti interni, non claim prodotto.
- SISS/FSE resta `portal-handoff` / `webapp-assisted` finche non esiste un
  percorso qualificato `SSI/A2A` documentato e approvato.
- La pagina pubblica `leonardopegollo.dev` deve essere allineata a questi
  confini tramite `WUL-374`, separatamente da questa PR.

## Checkpoint documenti sistema/topologia

La fase successiva alla merge train deve aggiornare o aprire issue dedicate per
queste superfici, in base a cio che sara davvero entrato su `main`:

- `CHANGELOG.md`: patch notes solo per merge reali, mantenendo `Unreleased`
  coerente con la prossima versione.
- `docs/STATE_OF_THE_SYSTEM.md`: stato reale di Kree8, safety floor AI,
  document intelligence e home-base dopo merge.
- `docs/design/wul-271-kree8-visual-translation.md`: credito Kree8 mantenuto
  come ispirazione esterna della grammatica visuale app, separando reference
  estetico da prodotto/implementazione MediFlow.
- `docs/topologia-dati-flussi.md`: caveat sugli identificatori a riposo,
  boundary AI/documenti e SISS/FSE se il contenuto risulta stale.
- `docs/system_architecture.md` e `ARCHITECTURE.md`: solo se cambia la lettura
  architetturale stabile, non per ogni fix.
- `docs/walkthrough.md`: aggiornare flussi utente solo dopo cambi runtime/UI
  entrati.
- `README.md` e `oss-assets/README.md`: aggiornare in una passata pubblicabile,
  senza claim zero-knowledge forte finche `WUL-342`/`WUL-354` sono aperti.
- `../leonardopegollo.dev`: passa da `WUL-374`, separatamente, dopo audit copy;
  la pagina pubblica deve includere un credito Kree8 leggero se usa o racconta
  la linea visuale attuale.

## Issue formalizzate o da riusare

- `WUL-373`: questa proposta di push e consolidamento documentale.
- `WUL-374`: audit/aggiornamento copy pubblico `leonardopegollo.dev` rispetto
  a zero-knowledge, claim sicurezza, credito Kree8 e post-v0.6.
- Riusare, non duplicare: `WUL-342`, `WUL-344`, `WUL-354`, `WUL-356`.
- Riusare per direzione prodotto: `WUL-233`.
- Riusare per operating loop: `WUL-295`.

## Gate prima di un nuovo push

- Branch dedicata per ogni issue: `codex/<issue-id>-<slug>`.
- PR draft quando una tranche supera un commit, una sessione o ha bisogno di
  review asincrona.
- Check minimi per docs/process: `git diff --check`, `npm run check:claims` e
  controllo manuale dei link Markdown toccati.
- Check minimi per runtime: test mirati, guard repo-locali, e dichiarazione
  esplicita se `typecheck`, `build` o smoke non sono stati eseguiti.
- Stato locale da non nascondere: il file untracked `-source.ts` e il blocco
  Node `--experimental-strip-types` su alcune prove restano problemi separati,
  non evidenza contro questa proposta docs-only.

## Prossimo push consigliato

1. Merge/review delle PR clean e strette gia aperte, senza mescolare temi.
2. Safety floor: completare o almeno rendere reviewable le tranche critical
   AI/gate gia partite (`WUL-355`, `WUL-358`) e poi passare ai critical
   remaining di `WUL-356`.
3. Aprire il lavoro `WUL-342` o una decisione esplicita di claims freeze prima
   di aggiornare materiale pubblico zero-knowledge.
4. Fare la passata patch notes/documenti sistema/topologia solo dopo la merge
   train, per non cristallizzare stati non ancora entrati su `main`.
5. Portare `WUL-374` nel repo sito solo dopo aver deciso se attenuare il copy o
   aspettare la correzione tecnica.
6. Solo dopo questi passaggi, riprendere filoni futuri piu ampi: Apple/home-base
   packaging, document intelligence avanzata, e scenari SISS/FSE oltre handoff.
