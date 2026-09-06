# MediFlow 0.8.6: verifica locale della UI integrata

Data: 6 settembre 2026. Lane WUL-669, design WUL-676.
Worktree: `mediflow-086-integrated-candidate`.
Branch: `codex/WUL-669-086-integrated-candidate`.
Sorgenti verificati: `28b2cbddca6872eb65be67c1cc54c5e95a927c35`.
Base funzionale: `07725c7ebd73524ef081a7b6b94f85b5de5627ce`.

Questo verbale riguarda la promozione web. Il verbale del
[closeout funzionale](./2026-09-06-086-functional-closeout.md) fotografa la base
precedente; le sue prove e quelle del [twin](../design/2026-09-05-086-runtime-twin.md)
restano distinte. Non attesta integrazione delle successive lane native/WHO,
CI remota, PR, distribuzione o release.

## Contratto e integrazione

[ADR 0123](../adr/0123-official-web-ui-navigation-compositions.md) e gli
aggiornamenti a 0047/0050/0060 sono stati committati per primi, in `88217f7d0`.
Una sola UI ufficiale: B predefinita, A selezionabile in Aspetto e conservata
nel browser. `MEDIFLOW_RUNTIME_TWIN=1` abilita solo il confronto locale con
Originale e la sua barra. Il runtime ordinario non mostra tale confronto e
non riserva spazio alla barra.

Nove cherry-pick UI, in ordine: `76c250cff`, `273eefb44`, `85f5a6630`,
`14aa6fb25`, `f7efd50a4`, `dbfee14c0`, `8ba470acb`, `c105f750d`, `02505b6ee`.
L'equivalente auth `5993a0b5b` e escluso: il closeout contiene gia `5f5fb874d`.
Gli indici documentali conservano entrambe le serie di aggiunte.

La promozione separa provider e confronto, abilita la preferenza ordinaria,
aggiunge l'inset CSS zero ed esclude gli strumenti sintetici dal tracing del
bundle. Il controllo Lume ha inoltre richiesto di sostituire due ombre `#0002`
dello slider con `color-mix` basato su `--lume-ink`.

Diff vuoto rispetto alla base per `native/`, `app/api/`, `lib/security/`,
`components/security-provider.tsx`, `components/lock-screen.tsx`, `app/page.tsx`
ed `e2e/utils.ts`. Il form paziente conserva la sola registrazione della bozza
pendente importata dal twin: le aggiunte WHO della lane parent restano da
integrare su quel possibile punto di sovrapposizione.

## Ambiente e comandi eseguiti

Node `24.19.0`, ABI `137`, Next `16.3.4` webpack, Chromium Playwright su macOS.
Ogni test/build ha ricevuto un ambiente `env -i` con PATH esplicito a
`/Users/leonardopegollo/.nvm/versions/node/v24.19.0/bin`, HOME/USER/LANG,
`NEXT_TELEMETRY_DISABLED=1` e `MEDIFLOW_DATA_DIR` sintetica esplicita.
`MEDIFLOW_RUNTIME_TWIN` e assente sia dalla build sia dal server/test ordinari.

Directory dati finale, nuova e marcata `SYNTHETIC-PROTOTYPE`:
`/tmp/mediflow-ui086-LAPsc3/{checks-data,runtime-data}`.
Preparazione tramite `node scripts/prepare-e2e-db.mjs` con
`MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1 E2E_PIN=086086 E2E_USERNAME=demo086` e nome
operatore/ambulatorio esplicitamente sintetici. Nessuna copia del database di
default. Le schede di prova sono create tramite API dal browser dopo il PIN.

| Comando, con l'ambiente esplicito sopra | Risultato |
| --- | --- |
| `npm run lint` | PASS, ripetuto dopo la stabilizzazione dei test. |
| `npm run typecheck` | PASS, ripetuto dopo la stabilizzazione dei test. |
| `node scripts/run-strip-types.mjs --test lib/settings-navigation.test.ts components/security-provider-h4.test.ts` | 13/13 PASS. |
| `node scripts/run-strip-types.mjs --test lib/security/client-application-lock.test.ts` | 15/15 PASS. |
| `npm run check:never-regress` | PASS. |
| `npm run check:claims` | PASS. |
| `npm run check:lume-tokens` | PASS dopo correzione delle due ombre; 42 coppie di contrasto sopra soglia. Non e una verifica WCAG completa. |
| `npm run build -- --webpack` | PASS, incluso `check:standalone-runtime-bundle`, con dipendenze fisiche locali. |
| `node .next/standalone/server.js` | Avvio ordinario con `NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3286` e dati `runtime-data`. Asset statici/public copiati nel solo bundle locale. |
| `node node_modules/@playwright/test/cli.js test e2e/official-ui.spec.ts --workers=1 --retries=0 --reporter=list --output=<tmp>/logs/playwright-official-4` | 5/5 PASS, 20,7 s; `MEDIFLOW_TEST_OFFICIAL_UI=1`, `E2E_PIN=086086`, `E2E_BASE_URL=http://127.0.0.1:3286`. |
| `node node_modules/@playwright/test/cli.js test e2e/work-profile-onboarding.spec.ts e2e/function-status.spec.ts --workers=1 --retries=0 --reporter=list --output=<tmp>/logs/playwright-regression` | 3/3 PASS, 19,1 s; stesso nodo sintetico, PIN e base URL. |
| `git diff --check` | PASS. |

Due tentativi di build hanno evidenziato vincoli di preparazione risolti:
il percorso temporaneo macOS lungo superava il limite socket PM2; il symlink
di `node_modules` produceva un bundle non fisico, rifiutato dal guard.
La directory dati corta e la copia locale delle dipendenze risolvono entrambi.
Nessuna modifica dei controlli PM2, di auth o del guard standalone.

Il bundle e stato costruito prima del commit dei medesimi contenuti runtime:
la sua fingerprint Git puo indicare il parent `ae0b14de6`. La verifica attesta
i sorgenti poi committati in `28b2cbddc`, non una build riprodotta dopo il commit.

## Copertura osservata e limiti

- PIN e ingresso manuale conservano la destinazione Agenda del profilo non
  configurato. Il default B riguarda l'ingresso nella cartella paziente.
- Un clic apre il paziente corretto; due cartelle restano richiamabili. Tutti
  i tredici moduli e le ancore restano raggiungibili, con i moduli secondari
  sotto Altre sezioni. La bozza terapia sopravvive al cambio di sezione.
- Il resoconto sopravvive ai disclosure, al cambio layout da una seconda
  scheda e alla navigazione annullata. Salvataggio reale `201`, contenuto
  riletto via API con prefisso `ENC:`, testo riletto e visibile nel diario.
- La seconda scheda ha usato il recupero esistente Rinnova accesso seguito
  dal PIN. Non si attesta accesso multitab trasparente senza quel gesto.
- A/B dopo reload, nessun confronto ordinario e nessun overflow della pagina
  a 1440x960, 390x844, 320x760 e 900x620. Dodici screenshot; osservazione visiva
  mirata di B e A desktop, B a 390 e composer a 320. Non e browser zoom reale.
- Blocco ordinario rimuove le cartelle aperte. Il test di storage indisponibile
  simula soltanto il rifiuto di scrittura della chiave della disposizione;
  lo storage auth resta operativo. Il cambio e transitorio fino al reload.

UI, API cliniche, SQLite e cifratura della voce sono reali su fixture sintetiche.
Sono simulati il rifiuto della preferenza, gli errori transport dell'onboarding,
il `503` dello stato funzioni e tutte le risposte WHO del test relativo.
Nessuna inferenza, qualifica WHO/OCR live o prova native e attestata da questa lane.
I controlli browser osservano errori e richieste nelle pagine dichiarate dai
test; non costituiscono una prova generale di assenza di egress.

Log e screenshot restano fuori Git nella directory temporanea
`mediflow-086-integrated-E9emWf/logs`; non sono asset di prodotto. Restano da
verificare Safari/Firefox, dispositivi fisici e il candidato finale dopo
l'integrazione parent delle altre lane. La conferma per bozze pendenti conserva
i limiti del twin su storia browser, comandi programmatici e blocco sessione.
