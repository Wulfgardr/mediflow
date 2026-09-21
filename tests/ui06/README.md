# UI06 — test isolati

Questi test usano dati interamente inventati per verificare aspetti isolati dell'applicazione, senza aggiungerle funzioni. Non costituiscono una suite E2E completa e non qualificano accesso, privacy, Fabric, OCR o scritture reali; mantengono inoltre invariati package.json, lockfile, validatori e configurazioni dei gate esistenti.

## Contratti puri (moduli di produzione reali)

Il runner richiede il checkout completo e le dipendenze già installate secondo il lock:

```sh
node tests/ui06/run-domain-tests.mjs
```

Per isolare i dati, il runner crea una directory temporanea propria, dirige `MEDIFLOW_DATA_DIR` del processo figlio a una directory nuova e rimuove al termine l'area temporanea. Traspila con il TypeScript disponibile nel checkout e avvia i test Node senza sostituire le funzioni di produzione, ma non esegue un typecheck. Il solo writer è uno spy dichiarato: una sua chiamata NON dimostra una scrittura sul DB. Sono inclusi 24 nuovi casi e i 2 test preesistenti di `lib/patient-workspace.test.ts`. La fixture dei contatori contiene soltanto i campi letti dalla proiezione e NON è un payload API valido.

## Componenti React reali in Chromium

```sh
node --test tests/ui06/component-browser.test.mjs
```

Servono Node 24.x, dipendenze già presenti secondo package-lock.json e Chromium Playwright disponibile. Il runner non installa pacchetti o browser, non modifica il lockfile e non riusa sessioni esistenti. Nel lock sono già presenti `esbuild` 0.25.12 come dipendenza transitiva e `@playwright/test` 1.58.2. Se manca un requisito, l'hook iniziale deve FALLIRE: il risultato non viene convertito in skip o PASS.

Il server HTTP ascolta soltanto su `127.0.0.1`, con porta assegnata dal sistema, e ogni caso usa un nuovo contesto browser. Qualsiasi richiesta a `/api/`, con metodo diverso da GET o verso un'altra origine fa fallire il test; non viene avviato alcun backend.

La prova usa realmente ScaleEngine, validatori, ConfirmProvider/useDialogA11y, RuntimeTwinDesignProvider, PatientClinicalSignals, PatientIdentityLens, SettingsLayout, DocumentSynthesisFabricReviewCard e CSS module. Sono invece doppi dichiarati in `browser-boundaries.tsx` Next Link/pathname, shell/sidebar/search, PrivacyBlur/security, picker e trasporti/controller Fabric; l'elenco esatto dei rimpiazzi è in `browser-harness.mjs`. Questa distinzione limita ciò che si può concludere: un cambio URL della fixture NON prova il router Next, così come lock e currentness simulati NON provano l'autorità dell'host. Il parser reale del DTO controlla la pubblicazione inventata, ma hash e receipt restano segnaposto: non documentano una generazione o un'estrazione autentica e non possono autorizzare alcun uso clinico.

I 19 casi coprono tastiera, risposte mancanti o zero, invio pendente, annullamento e recupero dall'errore; verificano inoltre continuità della bozza al cambio di composizione, reflow, contatori, ritorno alle impostazioni, separazione dei tre domini, disclosure, indisponibilità, annullamento e smontaggio di una sintesi in corso. Il font-size 32px simula l'ingrandimento del testo al 200%, NON lo zoom dal menu del browser. Canvas e layout del dialogo sono minimi: non riproducono il tema globale/Tailwind dell'applicazione.

## Gate e QA ancora necessari

Nel checkout completo devono ancora essere eseguiti, senza ignorare gli errori, lint sui file modificati e sui test, typecheck, check:claims, check:never-regress e check:fabric-generative-runtime-crosswalk. Servono inoltre tutti i test preesistenti e i flussi reali autorizzati con dati sintetici: upload → archivio → sintesi manuale; compilazione scala → salvataggio → riapertura; settings deep-link → ritorno; lettori anagrafica/clinica/amministrazione. La verifica deve comprendere Chromium/WebKit, temi chiaro/scuro, tastiera, zoom browser 200%, 320/390px e layout con sidebar. Il successo dei test isolati qui descritti non sostituisce nessuno di questi gate.