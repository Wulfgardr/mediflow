---
summary: "WUL-671: preview OCR Mac e accettazione locale di errori, currentness, interruzione e recupero."
read_when:
  - "Riprendendo il consolidamento OCR 0.8.6 o verificando questa preview."
---

# OCR 0.8.6: preview e recupero verificati localmente

Data: 5 settembre 2026. [WUL-671](https://linear.app/wulfgardr/issue/WUL-671).
Aggiornamento accettazione: 6 settembre 2026.
Stato: **lane locale errori/recupero verificata; distribuzione e altre piattaforme da qualificare**.
Base: `b72ac713b624e7d771262e4e01c5c5e1f56f9ae2`, più baseline documentale
`404f53622`. Branch: `codex/WUL-671-086-ocr`.

## Cambiamento

Il fallback PDF Apple Vision era già eseguibile, ma la preview mostrava sempre
«Anteprima AnyDoc». Il client ora conserva i conteggi OCR soltanto dopo aver
validato il risultato, e la UI mostra «Anteprima OCR locale» con «OCR completato
su questo Mac» e pagine riconosciute sul totale. Senza provenienza OCR resta
l'anteprima AnyDoc. Il testo richiede sempre revisione.

Il motore, il routing, la route, i limiti, la currentness e le scritture non
cambiano. [ADR 0119](../adr/0119-anydoc-apple-vision-current-source.md) chiarisce
la precedenza delle decisioni precedenti per questo percorso già composto.
Non modifica il registro Fabric o la sua capability OCR ritirata.

## Prove eseguite

Ambiente: macOS 27.0 arm64, Node 24.19.0/ABI 137, Swift 6.4, Chromium,
dipendenze locali nel worktree. Nessun database reale o configurazione privata.

| Verifica | Esito |
| --- | --- |
| Test client preview | 6 passati; prima della modifica l'asserzione sui conteggi OCR falliva, dopo passa. Provenienza malformata continua a essere rifiutata. |
| Browser `document-upload-ocr` e `document-upload-anydoc-focus`, sviluppo | 6 passati, un worker, 51,9 secondi; server webpack isolato, database sintetico da migrazioni, copia legacy disabilitata. |
| Stessi test browser, bundle di produzione standalone | 6 passati, un worker, 34,8 secondi; server loopback separato e nuovo database sintetico. La route revision ha restituito `737e22c59006`, branch OCR e stato clean. |
| `test:document-synthesis` | 47 passati. |
| `test:ai-context` | 72 passati. |
| `test:pdf-service` | 20 passati. |
| Materializer, renderer e child process owner PDF | 19 passati, 1 skip: il test engine assente si esegue soltanto quando il renderer target non è disponibile. Nessuna prova engine assente dedotta dallo skip. |
| `test:anydoc-local-only` | 8 passati. |
| `test:fabric-generative-runtime-crosswalk` | 8 passati. |
| `lint`, `typecheck`, `check:never-regress`, `check:claims`, `check:anydoc-local-only`, `check:fabric-generative-runtime-crosswalk` | Tutti passati. |
| `npm run build -- --webpack` | Passata con Node 24.19.0; postbuild e guard del bundle standalone passati. |
| `git diff --check`, inventario Markdown e link locali dei nuovi ADR | Passati. |

La baseline precedente include inoltre 76 test dei contratti, con composizione
AnyDoc/Apple Vision reale e controlli di revoca/currentness, e 8 browser test
di accesso, Fabric, navigazione e AnyDoc. Sono prove sulla base, non nuovi
test dell'intera release ripetuti da questa tranche.

La nuova matrice browser controlla:

1. PDF testuale: parole attese nell'anteprima, assenza di provenienza e messaggio OCR.
2. Scansione: Apple Vision reale, testo atteso, sorgente esatta, una pagina OCR.
3. PDF misto: testo nativo della prima pagina e scansione nell'ultima, ordine
   delle ancore, una pagina OCR su due, nuova indicazione visibile.
4. PNG singolo: `review_required`, nessuna preview di successo, percorso manuale
   esplicito nell'interfaccia. Non viene dichiarato supportato come allegato OCR.

Le fixture contengono soltanto frasi sintetiche. Le asserzioni ammettono la
normalizzazione degli spazi attorno alla punteggiatura operata da AnyDoc,
conservando parole, ordine, digest del risultato e provenienza. Lo screenshot
del PDF misto è stato riletto visivamente; il testo resta in un'anteprima con
scorrimento interno, come prima della modifica.

Le prove browser coprono sia sviluppo webpack sia il bundle standalone prodotto
dalla build, con i suoi asset statici e la directory public. Il secondo server
è stato arrestato dopo la prova e la porta verificata libera. Questo dimostra
il percorso nel bundle locale di produzione; resta distinto dal pacchetto
distribuito, firmato o installato su un altro Mac.

## Allestimento e ripetibilità

I log locali restano in `tmp-086-ocr/`, escluso da Git; screenshot e report
Playwright restano in `test-results/` e `playwright-report/`, esclusi da Git.
Le prove standalone sono in `tmp-086-ocr/standalone-browser.log`,
`standalone-server.log`, `standalone-revision.json` e `standalone-test-results/`.

Eseguire con Node 24 nel PATH e dipendenze realmente sotto il package root.
Il renderer non ammette dipendenze raggiunte attraverso symlink esterni.
Per la prova browser impostare `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`, una directory
dati sintetica dedicata e una porta loopback libera; usare
`E2E_SPECS='e2e/document-upload-ocr.spec.ts e2e/document-upload-anydoc-focus.spec.ts'`
con `E2E_NEXT_BUNDLER=webpack` in `scripts/e2e-smoke.sh`.

Per la prova standalone, dopo la build e la copia degli asset nel bundle,
preparare un nuovo database sintetico con `scripts/prepare-e2e-db.mjs` e avviare
`.next/standalone/server.js` con Node 24, `HOSTNAME=127.0.0.1`, porta libera e
`MEDIFLOW_DATA_DIR` dedicata. Eseguire i due spec Playwright con `E2E_BASE_URL`
verso quel server, un worker, poi arrestare il solo processo creato per la prova.

Il primo tentativo di build usava una directory dati nel lungo percorso del
worktree: il guard del socket PM2 l'ha rifiutata oltre 103 byte. La build valida
usa una nuova directory temporanea breve sotto `/tmp`, senza modificare il
guard. Questo vincolo dovrà essere considerato dal futuro onboarding.

## Residui WUL-671 e consegna

- La tranche del 6 settembre completa l'accettazione locale errori/recupero
  descritta sotto. I guasti engine e di trasporto sono iniettati nei test;
  non costituiscono una prova di disinstallazione o crash di Apple Vision reale.
- Verificare il flusso sul pacchetto target installato e precisare matrice
  Mac Intel/Windows/Linux; la presenza del fallback sul Mac arm64 non dimostra parity.
- Valutare un eventuale percorso applicativo per immagini singole sulla base
  del requisito, senza aggirare routing/currentness o aggiungere egress.
- WUL-674 allineerà la presentazione del registro Fabric; WUL-677 resta la
  decisione utente sul design complessivo.

Nessuna scrittura clinica automatica, inferenza AI, richiesta WHO live,
pubblicazione, merge o release. Nessuna qualifica di accuratezza clinica o
attestazione di conformità da queste fixture.

## Accettazione errori e recupero del 6 settembre

Base verificata: `38e34b65f002fcbdab5da47f38ee302f59ff3181`, worktree
`mediflow-086-wul671-ocr`, branch `codex/WUL-671-086-ocr`, inizialmente pulito.
La prova positiva Apple Vision su UI e standalone della prima tranche resta
acquisita; non è stata ripetuta. Il lavoro è rimasto nella lane OCR, senza
delega, modifiche ai settings Fabric o all'owner server della sorgente.

### Difetto dimostrato e correzione

Con una risposta sospesa la UI disabilitava tutte le estrazioni senza un
comando per interrompere l'attesa. Il test browser falliva cercando quel
comando; il test client pubblicava ancora una risposta valida arrivata dopo
l'interruzione. I log `browser-before.log` e `client-before.log` conservano
questi segnali precedenti alla correzione.

`Interrompi attesa` ora annulla la richiesta browser, scarta le risposte tardive
e riabilita il tentativo esplicito. Il client controlla l'interruzione anche
dopo la lettura/validazione del corpo. La UI associa risultato e rilascio dei
controlli alla singola operazione: la conclusione di una vecchia richiesta non
può sostituire il nuovo risultato o sbloccare un nuovo tentativo ancora attivo.
Eliminazione dell'allegato e uscita dal componente invalidano l'attesa.

L'interruzione riguarda l'attesa e la pubblicazione nel browser. Non attesta
che il processo server sia già terminato: questo conserva i limiti e
l'ammissione esistenti. Un retry mentre il server è ancora occupato può quindi
richiedere revisione manuale. Non sono cambiati engine, routing, digest degli
script, autenticazione, currentness o contratto HTTP; nessun impatto su `/api/v1`.

### Matrice e natura delle prove

| Caso | Prova ed esito | Motore / simulazione |
| --- | --- | --- |
| Engine assente | Errore `ENOENT`, nessun contenuto candidato, cleanup della directory temporanea e retry riuscito. | Solo l'eseguibile di riconoscimento è sostituito con un percorso inesistente. AnyDoc, rendering e finalizzazione reali. |
| Crash | Un child restituisce un envelope di successo ma termina con codice 1: nessuna preview, cleanup e retry riuscito. | Processo Node sintetico al posto del riconoscimento. |
| Timeout | Il child bloccato riceve `SIGKILL`; chiusura e PID non più esistente sono verificati prima del retry. Directory temporanea rimossa e sorgente invariata. | Processo Node sintetico; timer di riconoscimento accelerati a 250 ms solo nel test, limiti production invariati. |
| Sorgente stale / sostituita | Revisione/epoch oppure byte e source-ref cambiano all'avvio del processo OCR: risultato `denied` senza testo, receipt o provenance. Il nuovo tentativo usa soltanto la sorgente corrente. | SQLite e authority reali su dati sintetici; riconoscimento sostituito. |
| Sessione revocata | Revoca all'avvio del processo OCR: risultato scartato; una nuova sessione sintetica può estrarre. | Fixture sessione dedicata nei test Node; nessun bypass nella UI. |
| PDF protetto / corrotto | Parser reale, nessun avvio OCR, esiti `encrypted_document` / `malformed_document`, testo vuoto e `candidateUse=blocked`. Dalla UI, anche il retry conserva il percorso manuale. | Nessun mock nel parser o nella route browser di questi due casi. |
| Raster vuoto / malformato | Apple Vision reale restituisce revisione necessaria. Lo stesso test copre limiti e input invalidi prima del processo. | Test negativo esistente del motore, selezionato singolarmente sul Mac. |
| Errori dalla UI | Assenza engine, timeout, crash, trasporto interrotto e risposta stale non producono preview; apertura manuale e retry restano disponibili. Il retry estrae RTF con AnyDoc reale. | Prima risposta HTTP iniettata con Playwright; autenticazione ordinaria e allegati persistiti sintetici. |
| Interruzione / risposta tardiva | Interrompere, riprovare e consegnare la vecchia risposta mentre il nuovo tentativo è pendente non pubblica la vecchia preview né sblocca il nuovo tentativo. Il rientro nella pagina richiede una nuova estrazione. | Risposte vere trattenute dal test browser; nessun fake di autenticazione. |
| Eliminazione durante l'attesa | DELETE autenticata confermata con GET 404; l'altro allegato torna estraibile e la risposta vecchia non compare. | API reali, risposta di estrazione trattenuta dal test. |

Il riconoscimento sintetico nei test di composizione prova gestione del guasto,
currentness e recupero, non accuratezza OCR. Le due schermate sintetiche di
attesa/interruzione sono state rilette visivamente. Nessuna prova aggiuntiva di
parità Intel/Windows/Linux o di pacchetto installato deriva da questa matrice.

### Comandi e risultati

Node 24.19.0 nel PATH. Server webpack su `127.0.0.1:3286`, directory dati
temporanea `/tmp/mf671-Ops5N3`, inizializzata con migrazioni e
`MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`. La porta 3284 resta riservata al parent;
3290/3291/3292/3000 non sono state usate dalla lane.

| Comando | Risultato |
| --- | --- |
| `node scripts/run-strip-types.mjs --test lib/domain/documents/anydoc-ocr-acceptance.test.ts lib/domain/documents/anydoc-local-extraction-client.test.ts lib/attachment-local-extraction-route.test.ts` | 20 passati, nessuno skip: 8 acceptance, 8 client, 4 route. |
| `E2E_BASE_URL=http://127.0.0.1:3286 node node_modules/@playwright/test/cli.js test e2e/document-upload-ocr-recovery.spec.ts --workers=1` | 9 passati, 58,0 s, nessun retry. |
| `node scripts/run-strip-types.mjs --test --test-name-pattern='fails closed for blank' lib/domain/documents/anydoc-apple-vision-ocr.test.ts` | 1 test passato con motore Apple Vision reale. |
| `npm run test:document-synthesis` | 47 passati. |
| `npm run test:ai-context` | 72 passati. |
| `npm run test:pdf-service` | 20 passati. |
| `npm run check:anydoc-local-only` e `npm run test:anydoc-local-only` | Guard passato e 8 test passati. |
| ESLint sui cinque file TypeScript modificati/aggiunti; `npm run typecheck` | Passati. |
| `npm run check:never-regress` e `npm run check:claims` | Passati, guard invariati. |
| `git diff --check` e `rg --files -g '*.md' \| sort` | Passati; nessun Markdown aggiunto/rimosso, indici non modificati. |
| `qpdf --password=synthetic-open --check e2e/fixtures/ocr-synthetic-protected.pdf` | PDF sintetico valido, AESv3; nessun errore di sintassi/stream rilevato. |

Il PDF protetto è una fixture sintetica generata con `pdf-lib` e cifrata con
`qpdf --encrypt synthetic-open synthetic-owner 256`; SHA-256
`a488b4ebdfdaf394112e63c98138717c879dc3292ad6c0a0569a7d1f8e3acf03`.
I test leggono la fixture committata e non richiedono qpdf durante l'esecuzione.

I log della tranche restano in `tmp-086-ocr/acceptance/`, escluso da Git;
schermate/report rimangono in `test-results/` e `playwright-report/`.
Il server della lane è stato arrestato e la porta 3286 verificata libera.
Directory dati e build temporanee sono state rimosse; le sole voci aggiunte
automaticamente da Next a `tsconfig.json` sono state rimosse, ripristinando il
file iniziale senza modifiche alle altre configurazioni.
Non sono state ripetute build completa, matrice positiva o prova standalone:
questa consegna attesta il delta locale; integrazione e packaging spettano
al parent. Indici globali e ADR restano di competenza del parent.
