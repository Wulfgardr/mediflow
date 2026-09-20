# UI06 — test isolati

Dati interamente inventati. Questi file non aggiungono funzioni all'applicazione.
Non sono una suite E2E completa e non qualificano accesso, privacy, Fabric, OCR o scritture reali.
Non cambiano package.json, lockfile, validatori o configurazioni dei gate esistenti.

## Contratti puri (moduli di produzione reali)

Nel checkout completo, con le dipendenze del lock già installate:

```sh
node tests/ui06/run-domain-tests.mjs
```

Il runner crea e rimuove una propria directory temporanea; `MEDIFLOW_DATA_DIR` del processo figlio punta a una directory nuova.
Traspila con il TypeScript disponibile nel checkout e avvia i test Node, senza sostituire funzioni di produzione.
Non è un typecheck. Il solo writer è uno spy esplicito: una chiamata allo spy NON dimostra una scrittura DB.
Include 24 nuovi casi e i 2 test preesistenti di `lib/patient-workspace.test.ts`.
La fixture dei contatori contiene esclusivamente i campi letti dalla proiezione: NON è un payload API valido.

## Componenti React reali in Chromium

```sh
node --test tests/ui06/component-browser.test.mjs
```

Requisiti: Node 24.x, dipendenze già presenti secondo package-lock.json, Chromium Playwright già disponibile.
Il runner non installa pacchetti/browser, non modifica il lockfile e non usa sessioni esistenti.
`esbuild` è già presente nel lock come dipendenza transitiva (0.25.12); `@playwright/test` è 1.58.2.
Un requisito mancante fa FALLIRE l'hook iniziale; non viene convertito in skip o PASS.

Il server HTTP si lega solo a `127.0.0.1` su porta assegnata dal sistema. Ogni caso usa un contesto browser nuovo;
qualsiasi richiesta a `/api/`, metodo non GET o origine diversa fallisce il test. Nessun backend viene avviato.

Sono reali: ScaleEngine, validatori, ConfirmProvider/useDialogA11y, RuntimeTwinDesignProvider,
PatientClinicalSignals, PatientIdentityLens, SettingsLayout, DocumentSynthesisFabricReviewCard e CSS module.
Sono doppi dichiarati in `browser-boundaries.tsx`: Next Link/pathname, shell/sidebar/search,
PrivacyBlur/security, picker e trasporti/controller Fabric. La lista esatta dei rimpiazzi è in `browser-harness.mjs`.
Il cambio URL della fixture NON prova il router Next; lock e currentness simulati NON provano l'autorità dell'host.
La pubblicazione inventata viene controllata dal parser reale del DTO, ma hash e receipt sono segnaposto:
non sono una generazione o un'estrazione autentica e non possono autorizzare alcun uso clinico.

I 19 casi coprono tastiera, risposte mancanti/zero, invio pendente, annullamento e recupero errore,
continuità della bozza nel cambio composizione, reflow, contatori, ritorno alle impostazioni,
separazione dei tre domini, disclosure, indisponibilità, annullamento e smontaggio di una sintesi in corso.
La prova con font-size 32px è un proxy di ingrandimento testo 200%, NON lo zoom del menu browser.
Il canvas e il layout del dialogo sono minimi, non il tema globale/Tailwind dell'applicazione.

## Gate e QA ancora necessari

Nel checkout completo: lint sui file modificati e sui test, typecheck, check:claims,
check:never-regress e check:fabric-generative-runtime-crosswalk, senza ignorare gli errori.
Eseguire inoltre i test preesistenti integrali e i flussi reali autorizzati con dati sintetici:
upload → archivio → sintesi manuale; compilazione scala → salvataggio → riapertura;
settings deep-link → ritorno; lettori anagrafica/clinica/amministrazione.
Controllare Chromium/WebKit, temi chiaro/scuro, tastiera, zoom browser 200%, 320/390px e layout con sidebar.
Il superamento dei test qui descritti non sostituisce questi gate.
