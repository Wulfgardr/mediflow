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


## Tranche desktop del 7 settembre — WUL-671

Base `1672cb3cc27ee144539d068a435ca149b81bd208`, branch
`codex/WUL-671-086-ocr-desktop`, worktree `mediflow-086-ocr-desktop`.
[ADR 0128](../adr/0128-local-desktop-ocr.md) scritto prima del codice.
Stato: **adapter candidato implementato; equivalenza Windows/Linux aperta**.
Questa sezione registra la prima consegna `7f8441615`; le successive prove
guest e la correzione del preflight sono riportate nella sezione finale.
La candidatura originale e demo4390 non sono state modificate.

### Contratto consegnato

AnyDoc resta il primo passaggio. La stessa composizione materializza e rende
soltanto le pagine `needsOcr`; conserva le altre pagine con AnyDoc, ordine e
controllo finale della sorgente/sessione. macOS conserva Apple Vision;
Windows/Linux selezionano Tesseract WASM localmente. Nessuna route v1, schema,
capability Fabric, account o impostazione viene cambiata. La provenienza
aggiunge l'identita `tesseract_wasm`; la preview dice «su questo dispositivo».
Il controllo delle impostazioni gestito da un'altra lane dovra consumare il
nuovo preflight su Windows/Linux, senza dedurre disponibilita dal solo
sistema operativo; su macOS resta il controllo Apple Vision esistente.
Il preflight Tesseract sul Mac serve soltanto alla smoke di sviluppo.

Il worker PDF esistente gestisce anche il riconoscimento: un processo Node 24,
nessun addon per OCR, rete JavaScript negata, nessun subprocess/worker o
scrittura filesystem. La memoria del core e in WASM/MEMFS. Deadline documento
30 s, massimo 16 pagine, 16 MiB per PNG, 32 MiB per documento, 4096 pixel per
lato e 12 milioni di pixel, 1 MiB di testo per pagina. Heap JS 256 MiB,
memoria lineare WASM 512 MiB; RSS complessiva non limitata da questi due valori.
Il parent attende `close` prima di rilasciare l'ammissione e scarta stdout
parziale, errori, uscita non-zero e superamenti dei budget.

Il renderer mantiene PDF.js 4.10.38 e canvas 0.1.100. Sono ammesse soltanto
macOS arm64, Windows x64 MSVC, Linux glibc x64/arm64, con binari del manifest
`scripts/anydoc-pdf-renderer-profiles.json`. Il worker controlla anche hash e
posizione del binario sui nuovi profili Windows/Linux. macOS mantiene il
controllo di versione preesistente e il packaging Mach-O separato: firma e
normalizzazione cambiano i byte del binario rispetto al pacchetto npm. I pacchetti gia presenti nel lock hanno archivi da
12,4–15,2 MB: sono stati letti e verificati per SHA-512 upstream e SHA-256,
non installati su guest. Linux richiede glibc >=2.18 e, su arm64, CPU
cortex-a57 o successiva secondo [upstream canvas](https://github.com/Brooooooklyn/canvas).
Musl, Windows ARM nativo e Mac Intel restano fuori da questa tranche.

### Provisioning esplicito e controlli

Il runtime non scarica nulla. Il coordinatore puo provisionare in
`node_modules/mediflow-ocr-tesseract/` soltanto i cinque file descritti da
`scripts/anydoc-tesseract-artifacts.json` (nome, dimensione e SHA-256):

- `tesseract-core-lstm.js`, `tesseract-core-lstm.wasm` e `LICENSE` da
  `tesseract.js-core@6.0.0`, variante LSTM senza SIMD;
- `ita.traineddata` e `tessdata-LICENSE` da
  `tesseract-ocr/tessdata_fast` al commit
  `87416418657359cb625c412a48b6e1d6d41c29bd` (`LICENSE` rinominata).

Origini: [pacchetto del port WASM](https://github.com/naptha/tesseract.js-core)
e [modello italiano](https://github.com/tesseract-ocr/tessdata_fast/tree/87416418657359cb625c412a48b6e1d6d41c29bd).
Totale 5.72 MB circa. Core/modello Apache-2.0; conservare notice e licenze delle
dipendenze durante packaging. Nessun artifact opzionale e aggiunto a Git.
Gli artefatti mancanti/alterati danno errore e istruzioni locali:

```bash
npm run check:anydoc-desktop-ocr
npm run test:anydoc-desktop-ocr
```

Entrambi i comandi funzionano anche da PowerShell, senza flag shell aggiuntivi.
Il primo comando restituisce exit 1 se manca un prerequisito controllato;
`artifacts_verified` attesta integrita, con `qualification=pending_target_benchmark`.
Non e una prova di riconoscimento. Il secondo comando impone il motore reale e fallisce se manca. Nella suite
unitaria generale i casi reali sono skip espliciti salvo il flag
`MEDIFLOW_TEST_TESSERACT_REAL=1`; quegli skip non costituiscono qualifica. I test di assenza/alterazione richiedono una
copia isolata degli artifact e vanno eseguiti senza altri consumer.

`e2e/fixtures/ocr-desktop-synthetic.png` e interamente sintetica: canvas
1600x600, sfondo bianco, Arial 48px nero, tre righe alle coordinate x=60,
y=110/210/310: «DOCUMENTO INTERAMENTE SINTETICO», «Qualità locale, nessun dato
personale.», «Data 12/03/2026 quantità 25 mg.». SHA-256
`f597ffdd0516f173310febcae6e33e69f3d854f87f11717af46255b1d4d5962f`.
La fixture fissa elimina la dipendenza dai font del guest nella smoke OCR.
PDF misto e pagina bianca vengono costruiti nei test, senza dati reali.

### Limite delle prove e seguito

Le prove reali di questa tranche sono eseguite su macOS arm64 con Node 24.19.0:
WASM riconosce accenti, data e quantita della fixture; il PDF misto mantiene
la prima pagina nativa e riconosce soltanto l'ultima. Le prove di guasto con
processi sintetici misurano soltanto negazione, deadline, cleanup e retry.
Nessuna accuratezza clinica, superiorita rispetto ad Apple Vision o qualifica
Windows/Linux deriva da questi risultati.

Tracing e guard standalone includono worker e manifest fissati; gli artifact
OCR restano opzionali. Build, pacchetto installato e UI desktop non sono stati
eseguiti dalla lane. Per promuovere servono guest reali, allestimento isolato,
profilo completo OS/arch/libc/Node/CPU/RAM, digest, prova positiva e negativa,
currentness/revoca e UI sul pacchetto target. Il benchmark finale richiede
corpus italiano e soglie fissati dal coordinatore prima della prova, compresi
rotazioni, rumore, tabelle, CER/WER, exact match, latenza e memoria.
Log e report della lane restano in `tmp-ocr-artifacts/`, escluso da Git.
Nessuna delega, VM, push, PR, merge, tracker, tag o release da questa lane.


### Verifiche della consegna desktop

| Verifica | Esito osservato |
| --- | --- |
| Suite focalizzata: desktop reale, current-source, acceptance OCR, child owner, materializer, renderer, client e contratto | 74 passati, 1 skip su 75. Include 9 test desktop senza skip; lo skip e il caso renderer assente sul Mac dove il renderer e presente. |
| `npm run test:anydoc-desktop-ocr` | 9 passati, nessuno skip; wrapper che richiede il motore reale. |
| Guard standalone mirati (`--test-name-pattern='PDF\|AnyDoc\|LF'`) | 5 passati: worker, smoke, manifest, tracing e checkout LF. |
| Suite standalone completa | 9 passati, 2 falliti sul roster/restart dell'owner auth 0.8.7. Due asserzioni obsolete; la receipt isolata del primo caso e rettificata nella sezione finale. Nessuna correzione auth in questa lane. |
| `test:document-synthesis`, `test:ai-context`, `test:pdf-service` | 47, 72 e 20 passati. |
| `check:anydoc-local-only`, `test:anydoc-local-only` | Guard passato, 8 test passati. |
| `typecheck`, ESLint mirato sui file toccati | Passati. Le copie locali delle dipendenze usano l'archivio auth 0.8.7 fissato da questa branch. |
| `check:never-regress`, `check:claims` | Passati. |
| `git diff --check`, inventario Markdown e link relativi ADR | Passati. |

La suite standalone completa non e verde: restano due difetti baseline fuori
ownership. Non sono stati eseguiti build completa, browser/standalone live,
packaging o guest. I comandi Node usano 24.19.0; i test sono stati eseguiti in
sequenza, con dati sintetici e senza server persistenti.

## Qualifica guest del 7 settembre — WUL-671

**Qualifica tecnica parziale; equivalenza desktop ancora aperta.** Linux
supera 5/6 casi sintetici. Windows esegue il motore WASM sul raster italiano,
ma la pipeline PDF e bloccata dal caricamento del binding AnyDoc. Nessuna
prova clinica, comparazione con Apple Vision, build applicativa o qualifica
del pacchetto deriva da questa esecuzione.

Sorgente benchmark `7f84416154002dbc795cc9935a156480e14bcb0e`, trasferita con
`git archive` e allowlist OCR: 87.657 byte compressi, SHA-256
`4bb7a33016ac20fd325e68d362bd9161728743fae4c30407f8ad16fe4823d263`.
Nessun DB, auth, corpus reale o progetto utente nel trasferimento. Dipendenze
minime locali, Node 24.19.0; nessuna installazione globale. I cinque artefatti
OCR gia fissati sono stati trasferiti e riverificati, senza nuovi modelli.
Entrambe le VM risultavano gia RUNNING al primo inventario e sono lasciate
all'utente. Target e test eseguiti in sequenza; nessuna build Next/app.

### Target e provenienza

| Target osservato | Runtime e renderer | Risorse guest osservate |
| --- | --- | --- |
| Omarchy, Arch Linux ARM, kernel `7.1.8-1-aarch64-ARCH`, glibc 2.43 | Node 24.19.0 arm64; `@napi-rs/canvas-linux-arm64-gnu` 0.1.100 | 8 vCPU, 12.516.647.488 byte RAM; modello CPU non esposto da Node (`unknown`). |
| Windows 11 ARM64, build `10.0.26200.9168` | Node 24.19.0 **x64 emulato**; profilo `@napi-rs/canvas-win32-x64-msvc` 0.1.100 presente e digest verificato, rendering PDF non raggiunto | 8 vCPU, 19.320.733.696 byte RAM al primo inventario. |

Non sono prove Windows ARM nativo, Windows su hardware x64, Linux x64/musl
oppure equivalenza tra sistemi. Manifest core/modello SHA-256
`0fb4ed952127bafe84e97f3f3cb43f6f53d5d60984117eed6a550d73508c6978`;
manifest renderer
`41355c1e4360acdc293aa383a07ba2c8216a8a018b0a38ac2a9ec5cc0fe37e41`.
I report privati registrano anche hash di eseguibile Node, singoli artefatti,
binario canvas, sorgenti trasferite, fixture, harness e output.

### Corpus e soglie fissati prima del riconoscimento

Il benchmark canonico `scripts/benchmark-document-router.ts` riguarda la
classificazione documentale; non definisce soglie OCR CER/WER riutilizzabili.
Sono state quindi fissate soglie **tecniche sintetiche**, non cliniche o
causali, alle 20:33:24 UTC, prima delle prove target. Manifest privato
`corpus/manifest.json`, SHA-256
`8d28a283058fb0f0d3853f66d9ff07cdb95e90fe365ad4ae360994aae2e10b8d`.
Non e stato modificato dopo i risultati.

Sei PDF: nativo, scansione della fixture italiana fissa, misto con scansione
solo a pagina 2, rotazioni raster di +5 e +90 gradi, tabella con 3.360 pixel di
rumore grigio deterministico. Nessun font o documento del guest entra nel
corpus; i raster sono generati prima del trasferimento. Il caso tabella
verifica testo e ordine, non una ricostruzione strutturata delle celle.

Normalizzazione NFC e spazi consecutivi; maiuscole, accenti e punteggiatura
restano significativi. CER/WER del misto misurano soltanto la pagina OCR.
CER/WER massimi: 0/0 nativo, 2%/5% scansione e misto, 8%/15% rotazioni,
10%/20% tabella. Tutti i token dichiarati di accento, data e quantita devono
corrispondere esattamente. Exact match dell'intera stringa viene registrato;
fuori dal nativo non sostituisce le soglie CER/WER e i token obbligatori.

Routing 100%, nessuna pagina nativa renderizzata, nessuna pagina omessa,
testo nativo preservato esattamente. Massimo 90 s per caso e 30 s per child
OCR, 1 GiB osservato per processo; concorrenza 1, una misura per caso.
Gli osservatori intercettano passivamente il trasporto dei processi reali,
conservando digest e inoltrando i byte immutati. Latenza comprensiva di
osservatori e controllo di routing aggiuntivo: non e una stima statistica
della latenza applicativa.

### Risultati Linux sul commit 7f8441615

| Caso | CER | WER | Exact match | Latenza caso | Massimo child residente osservato | Gate |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| Nativo | 0% | 0% | Si | 48,4 ms | 49,5 MiB | Passa; nessun OCR |
| Scansione IT | 0% | 0% | Si | 2.563,9 ms | 387,0 MiB | Passa |
| Misto, scansione pagina 2 | 0% | 0% | Si | 771,6 ms | 385,7 MiB | Passa |
| Rotazione +5 gradi | 0,9804% | 7,6923% | No | 891,3 ms | 420,1 MiB | **Fallisce token:** `quantità` diventa `Quantità` |
| Rotazione +90 gradi | 0% | 0% | Si | 875,4 ms | 420,7 MiB | Passa |
| Tabella con rumore | 0% | 0% | Si | 712,4 ms | 387,5 MiB | Passa |

AnyDoc seleziona tutte e sole le 5 pagine da riconoscere; le 2 pagine native
sono conservate. Ricomposizione completa in tutti i casi. Hash sorgente,
raster resi/input OCR e receipt set finale verificati per i cinque casi OCR.
La rotazione +5 conserva l'accento: il difetto e la maiuscola, non un accento
perso. Nessuna soglia e stata allentata per far passare questo risultato.

RSS Linux da `/proc` VmRSS/VmHWM, polling richiesto ogni 20 ms sui soli PID
posseduti. Child OCR campionati 16–20 volte ciascuno, durata massima 444 ms;
parent massimo 183,2 MiB. Il massimo di 420,7 MiB riguarda l'intera catena di
child, compreso il renderer. Sono massimi **osservati**, non limiti RSS imposti
ne prove dei picchi sotto stress. Tutti i child risultano chiusi.

Il report grezzo segna erroneamente il routing nativo come fallito perche
attendeva un envelope anche senza `needsOcr`. Il contratto restituisce `null`
in quel caso. L'overview corregge questa interpretazione usando estrazione
iniziale invariata e assenza di child OCR; il conteggio nell'envelope e non
applicabile al nativo. Report grezzo, correzione e soglie restano conservati.

### Risultati Windows e prerequisito non soddisfatto

Sul commit 7f8441615 tutti i sei PDF terminano `review_required:io_failure`
nel primo passaggio. Nessun rendering o OCR di quelle pagine viene eseguito.
I valori CER/WER=1 ottenuti nel report grezzo confrontando output vuoto non
sono misure di accuratezza OCR: l'overview li marca non applicabili.

Il pacchetto `@firecrawl/anydoc-win32-x64-msvc@0.2.4` e presente; binario
8.275.456 byte, SHA-256
`2883dbec5426f5e438489fef6186e3ced2b6ee1cb5deeb6524342eaf57635d19`.
Il loader fallisce anche con l'ambiente completo. L'inventario PE identifica
la dipendenza `VCRUNTIME140.dll`, assente accanto al binding, a Node e nella
directory di sistema controllata. E un prerequisito mancante da risolvere;
non e stata verificata la ripresa dopo provisioning. I nomi API-set elencati
nel PE non sono trattati come DLL necessariamente mancanti su disco.
[Microsoft documenta le dipendenze e la distribuzione del runtime C++](https://learn.microsoft.com/en-us/cpp/windows/determining-which-dlls-to-redistribute?view=msvc-170).
La scelta di provisioning e manutenzione spetta al coordinatore: nessun
runtime Microsoft installato o copiato da progetti/sessioni utente.

Una prova **separata del solo motore** usa il PNG italiano fissato, non la
pipeline PDF: CER=0, WER=0, exact match e 5/5 token esatti, 1.734,1 ms.
Provenienza Tesseract, digest input/output/core e binding verificati; exit 0,
child chiuso. Working set massimo osservato Windows: child 118,8 MiB,
parent 122,1 MiB; 46 campioni del child. Polling PowerShell richiesto 20 ms,
intervallo effettivo mediano 33,3 ms, massimo 97,4 ms, con WorkingSet64 e
PeakWorkingSet64. Nessuna misura di memoria del renderer Windows riuscito.

### Correzione preflight e test effettivi

Commit `b14f61a1d29df77457993ffd0e1c04cdc2ea3dc6`:
`scripts/check-anydoc-desktop-ocr.ts` aggiunge un PDF nativo sintetico nel
processo AnyDoc esistente. Artifact integri con AnyDoc non caricabile danno
ora exit 1, `reason=anydoc_unavailable`, `anydocFirstPass=failed` e guida al
binding/Visual C++ x64. Il test aggiunto verifica rimozione del loader e
recupero in copia isolata. ADR 0128 chiarisce il controllo; nessun worker,
digest del motore, routing, currentness o impostazione e cambiato.

Il commit e stato archiviato e riverificato per ogni file su entrambi i guest
prima dei nuovi test; archivio SHA-256
`2d25ce79097c552bd2b52aa6f74c751d975de95137064a8f55af4e9269827c8d`.
La funzione sincrona `inspectAnyDocDesktopOcrCapability` resta inventario
artifact: il suo risultato non dimostra caricabilita AnyDoc o renderer.
Il preflight CLI aggiunge la prova AnyDoc, ma resta
`qualification=pending_target_benchmark` anche quando esce 0.

| Verifica realmente eseguita | Mac di sviluppo | Linux guest | Windows guest |
| --- | --- | --- | --- |
| Suite desktop reale su 7f8441615 | Gia nella consegna precedente | 9/9, zero skip | 7/9, zero skip; falliscono misto e nativo AnyDoc |
| Child owner su 7f8441615 | Gia nella consegna precedente | 6/6 | 6/6 |
| Suite desktop reale su b14f61a1d | 10/10, zero skip | 10/10, zero skip | 7/10, zero skip; falliscono i due casi AnyDoc e il nuovo gate che richiede primo passaggio disponibile |
| CLI b14f61a1d | Positivo nei test | Exit 0, primo passaggio verificato, anche dopo i test | Exit 1 e diagnosi AnyDoc attesi e verificati |
| Typecheck dei due file TS modificati e import OCR; ESLint mirato | Passano, Node 24.19.0 | Non ripetuti | Non ripetuti |

Comandi guest: `node scripts/run-strip-types.mjs --test --test-concurrency=1`
con `scripts/anydoc-desktop-ocr-real.test.ts` e, separatamente,
`lib/domain/documents/anydoc-pdf-child-process-owner.test.ts`; CLI con
`node scripts/run-strip-types.mjs scripts/check-anydoc-desktop-ocr.ts`.
Guard AnyDoc local-only, claims e never-regress passati sul Mac con Node 24;
anche diff check, inventario Markdown e link relativi del report passano.

I guasti reali benigni coprono pagina vuota senza successo parziale,
core WASM o renderer mancanti/alterati, rifiuto concorrente e retry dopo
chiusura. Timeout, stdout e rete sono verifiche del child owner con processi
sintetici: non attestano un timeout provocato nel motore OCR reale.

Il primo comando Windows lungo di `prlctl` non ha raggiunto il runner; il
collegamento host posseduto e stato terminato e il retry tramite script
locale ha eseguito il benchmark. Il primo sampler PowerShell ha conservato
il report completo ma letto un ExitCode nullo: errore di orchestrazione
registrato, non successo OCR. La prova separata del motore acquisisce
l'handle prima dell'attesa e registra exit 0. Nessuna VM e stata arrestata.

### Consegna, baseline fuori scope e limite di promozione

Overview, sorgenti archiviate, roster, corpus congelato, generatori, harness,
report grezzi/corretti e log restano privati fuori Git nella directory task
`mediflow-WUL-671-086-ocr-desktop/artifacts/target-20260907` di
ContextContinuity; copia di lavoro ignorata in `tmp-ocr-target/`.
I report di provenienza verificano anche i sorgenti dopo i test. Nessun
processo Node della lane rimane attivo nei guest all'inventario finale.

Restano da coordinare prerequisito AnyDoc Windows e retry della pipeline,
errore di maiuscola a +5 gradi, benchmark finale e packaging. Currentness
DB, revoca/sessione, UI e auth standalone non sono stati provati nelle VM:
la prova di binding dei byte non sostituisce l'authority finale.

Al parent restano inoltre i due fallimenti auth baseline gia riprodotti
prima di questa qualifica, in `scripts/check-standalone-runtime-bundle.test.mjs`:

- riga 119: `standalone checker proves web auth owner physical copy and restart denial`;
- riga 180: `standalone config externalizes and traces the exact web auth owner package roster`.

Riguardano roster/restart dell'owner auth 0.8.7; log baseline conservati,
nessuna modifica auth o nuova esecuzione standalone da questa qualifica.
Nessuna build completa, push, PR, merge, tracker, tag o release. Candidatura
originale, demo4390, sessioni utente e configurazioni VM preservate.

## Follow-up parent review: selezione Mac e tracing desktop

Il preflight Tesseract originario controllava anche i byte grezzi canvas sul
Mac: applicato al pacchetto firmato/ricollocato avrebbe potuto restituire
`unavailable`, senza misurare Apple Vision. Ora
`inspectAnyDocDesktopOcrCapability()` restituisce su macOS `not_applicable`,
`qualification=not_checked`, prima di leggere gli artifact. Il CLI esce 2,
non esegue AnyDoc e indica che il controllo non riguarda la disponibilita
Vision. La selezione runtime Mac continua a usare Apple Vision.

La smoke Tesseract su Mac e esplicita:
`npm run check:anydoc-desktop-ocr -- --development-tesseract-smoke`.
Solo questa modalita usa `checkScope=development_smoke` e conserva i controlli
stretti sul binario npm grezzo. Non usarla sul pacchetto Mac firmato.
I test reali Mac selezionano questa modalita; il comando di test resta uguale.
Windows/Linux mantengono il preflight Tesseract con verifica AnyDoc.
Nessun worker, digest o guard del renderer/packaging Mac e stato indebolito.

`next.config.ts` usa `scripts/anydoc-desktop-renderer-trace.mjs` per aggiungere
il solo profilo Windows/Linux corrispondente a OS/arch del build host,
ricavato dal manifest fissato: `package.json`, il binario `.node` esatto e
README. Nessuna wildcard su tutti i backend. Il roster Mac preesistente e
invariato. La selezione Linux indica il pacchetto glibc, senza qualificare
musl: l'ammissione runtime resta del renderer. Un cross-build con piattaforma
diversa dal build host non e qualificato da questo helper.

Verifiche Node 24.19.0: suite reale desktop e child owner 17/17, due test
configurazione tracing 2/2, sette guard standalone PDF/AnyDoc/canvas/LF 7/7;
typecheck mirato comprensivo di next.config ed ESLint mirato passano.
I test provano anche che renderer mancante/alterato resta negato nella smoke
Mac, mentre il preflight Mac di produzione rimane non applicabile. Non sono
prove di firma o di un bundle Windows/Linux costruito. Nessuna build Next,
Xcode o nuova esecuzione VM durante questo follow-up; qualifica VM gia
registrata sopra e bundle target ancora aperti.

### Rettifica precisa dei due guard auth

Rieseguiti soltanto i due test con `--test-name-pattern='web auth owner'`,
senza build: entrambi falliscono su asserzioni obsolete. Il comando
`node scripts/check-standalone-runtime-bundle.mjs --self-test=web-auth-owner`
esce **0**: non attribuire questi fallimenti a un restart effettivamente negato
in modo errato.

- `scripts/check-standalone-runtime-bundle.test.mjs:124` attende
  `/WEB_AUTH_OWNER_VERSION = '0\.8\.6'/`; il checker a riga 36 dichiara
  `0.8.7`. Anche il successivo assert a riga 126 attende
  `/root is not the frozen exact 21-function API/`, mentre il checker a riga
  599 usa `root is not the frozen exact owner API with native session namespace`
  e il roster API contiene 23 chiavi. Quest'ultimo assert non viene raggiunto
  nella prova corrente, che si arresta sulla versione.
- `scripts/check-standalone-runtime-bundle.test.mjs:195` confronta il roster
  installato con `webAuthOwnerRoster` definito a riga 26. Expected: 12 file;
  actual: gli stessi 12 piu `internal/native-session.cjs` (13 file). Il checker
  lo include gia nel roster fissato. Nessuna modifica a test o codice auth.

Nella receipt precedente `baseline-standalone-auth.log`, la prima prova
isolata falliva invece per `node-runtime-contract.mjs` non copiato: quella
prova non dimostra il difetto auth e resta conservata come errore del harness.
Il log della suite originale e la nuova prova mirata mostrano la versione
obsoleta; `git show` sulla base `1672cb3c` conferma versione checker 0.8.7,
assert 0.8.6 e roster test senza native-session gia presenti prima della lane.
Le nuove prove sono in `auth-exact-review.log`, `auth-selftest-review.log` e
`auth-exact-receipt.json` negli artefatti privati del follow-up.

### Artifact per il provisioning del parent

Manifest canonico `scripts/anydoc-tesseract-artifacts.json`, invariato;
cinque sorgenti locali in `node_modules/mediflow-ocr-tesseract/`, 5.719.862 byte,
nome/dimensione/SHA-256 riverificati. `parent-artifact-paths.json` privato
riporta source assolute e destinazioni relative del manifest. Il parent ha
comunicato copia completa con hash source/dest corrispondenti nella propria
receipt `ocr-parent-artifact-copy.json`: questa lane non ne attesta il bundle
integrato e non esegue ulteriori copie o redistribuzioni automatiche.
