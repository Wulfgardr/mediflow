---
summary: "Prima tranche WUL-671: esito OCR visibile, precedenza ADR e prove sintetiche Mac."
read_when:
  - "Riprendendo il consolidamento OCR 0.8.6 o verificando questa preview."
---

# OCR 0.8.6: prima tranche verificata

Data: 5 settembre 2026. [WUL-671](https://linear.app/wulfgardr/issue/WUL-671).
Stato: **candidato locale verificato; issue complessiva ancora parziale**.
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
| Browser `document-upload-ocr` e `document-upload-anydoc-focus` | 6 passati, un worker, 51,9 secondi; server webpack isolato, database sintetico da migrazioni, copia legacy disabilitata. |
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

Le prove browser usano sviluppo webpack. La build è stata verificata
separatamente; questo non è un test E2E del pacchetto installato.

## Allestimento e ripetibilità

I log locali restano in `tmp-086-ocr/`, escluso da Git; screenshot e report
Playwright restano in `test-results/` e `playwright-report/`, esclusi da Git.

Eseguire con Node 24 nel PATH e dipendenze realmente sotto il package root.
Il renderer non ammette dipendenze raggiunte attraverso symlink esterni.
Per la prova browser impostare `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`, una directory
dati sintetica dedicata e una porta loopback libera; usare
`E2E_SPECS='e2e/document-upload-ocr.spec.ts e2e/document-upload-anydoc-focus.spec.ts'`
con `E2E_NEXT_BUNDLER=webpack` in `scripts/e2e-smoke.sh`.

Il primo tentativo di build usava una directory dati nel lungo percorso del
worktree: il guard del socket PM2 l'ha rifiutata oltre 103 byte. La build valida
usa una nuova directory temporanea breve sotto `/tmp`, senza modificare il
guard. Questo vincolo dovrà essere considerato dal futuro onboarding.

## Residui WUL-671 e consegna

- Completare dalla UI motore assente, timeout/crash, retry e ripresa, documenti
  protetti/corrotti e interruzioni, senza successo apparente o perdita del percorso manuale.
- Verificare il flusso sul pacchetto target installato e precisare matrice
  Mac Intel/Windows/Linux; la presenza del fallback sul Mac arm64 non dimostra parity.
- Valutare un eventuale percorso applicativo per immagini singole sulla base
  del requisito, senza aggirare routing/currentness o aggiungere egress.
- WUL-674 allineerà la presentazione del registro Fabric; WUL-677 resta la
  decisione utente sul design complessivo.

Nessuna scrittura clinica automatica, inferenza AI, richiesta WHO live,
pubblicazione, merge o release. Nessuna qualifica di accuratezza clinica o
attestazione di conformità da queste fixture.
