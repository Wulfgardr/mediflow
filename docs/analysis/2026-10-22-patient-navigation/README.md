# Navigazione della cartella: prove sintetiche

Attuazione di [D8 dell’addendum compositivo](../../design/punto-inchiostro/02-addendum-composizione.md#d8-le-destinazioni-non-si-muovono-con-i-conteggi), 22 ottobre 2026.

Prima: `cb389bcf3b9878787f0adcb1be89a2754f46cdb2`. Dopo: `9d748026ba871d546b560e210b0b1089fa606ae9`. Ogni serie usa un solo SHA di prodotto. Il commit successivo aggiunge soltanto queste evidenze. Tutti i dati sono inventati; la checkout primaria e gli archivi reali non sono stati usati per compilare o eseguire le prove.

La fixture contiene 12 terapie attive, 12 misure e 12 documenti sintetici. La stessa composizione viene fotografata in entrambi i registri e a ogni larghezza. Il codice identificativo sintetico cambia fra le esecuzioni; non è un dato reale.

| Registro e vista | Prima | Dopo |
| --- | --- | --- |
| Giorno, 1440 × 960 | [PNG](before/giorno-1440.png) | [PNG](after/giorno-1440.png) |
| Grafite, 1440 × 960 | [PNG](before/grafite-1440.png) | [PNG](after/grafite-1440.png) |
| Giorno, 768 × 960 | [PNG](before/giorno-768.png) | [PNG](after/giorno-768.png) |
| Grafite, 768 × 960 | [PNG](before/grafite-768.png) | [PNG](after/grafite-768.png) |
| Giorno, 390 × 960 | [PNG](before/giorno-390.png) | [PNG](after/giorno-390.png) |
| Grafite, 390 × 960 | [PNG](before/grafite-390.png) | [PNG](after/grafite-390.png) |
| Giorno, browser 200%, finestra 1440 × 960 | [PNG](before/giorno-1440-zoom-200.png) | [PNG](after/giorno-1440-zoom-200.png) |
| Grafite, browser 200%, finestra 1440 × 960 | [PNG](before/grafite-1440-zoom-200.png) | [PNG](after/grafite-1440-zoom-200.png) |

Lo zoom è quello nativo di Chromium, impostato con `chrome.tabs.setZoom(2)` da un’estensione temporanea nel test Playwright. Le asserzioni verificano il fattore 2, il passaggio da 1440 a 720 CSS px e da devicePixelRatio 1 a 2. Non è uno zoom CSS né un semplice cambio di viewport. Le misure del menu sono in [before/measurements.json](before/measurements.json), [after/measurements.json](after/measurements.json) e nei JSON dello zoom [Giorno](after/giorno-1440-zoom-200.json) e [Grafite](after/grafite-1440-zoom-200.json). [sha256.json](sha256.json) identifica i file fotografici e metrici.

Prima del fix, il test sui segmenti con zero record attendeva `Riepilogo, Terapie, Misure, Documenti` e riceveva `Riepilogo, Diario`. A 768 px il test geometrico rilevava il bordo sinistro coperto dal contenitore: le sole coordinate del rettangolo entro lo schermo non bastavano. Al 200% il bordo inferiore arrivava a 640,09375 CSS px con viewport alta 480 px, in entrambi i registri. Le prove corrispondenti fallivano sulla base.

Dopo il fix, [patient-navigation.spec.ts](../../../e2e/patient-navigation.spec.ts) verifica:

- I quattro segmenti e il loro ordine con 0, 1 e 12 terapie, misure e documenti; accesso a tutte le quindici destinazioni e destinazione corrente riconoscibile in «Altro».
- Menu entro il viewport a 768 e 390 px, comprese le verifiche con `elementFromPoint` sui bordi per rilevare il taglio da contenitore; chiusura alla scelta, Esc e ritorno del fuoco, frecce, Home ed End.
- Form Terapie aperto, testo della bozza, selezione del testo e scelta del farmaco manuale conservati dopo il passaggio a Documenti e ritorno; navigazione generale presente.
- Menu entro il viewport con zoom browser reale al 200%, in entrambi i registri.

La prova di componente copre inoltre l’aggiornamento asincrono dei conteggi mentre il menu è aperto: gli ingressi, il menu e il fuoco sulla voce non cambiano. Le prove delle azioni della testata verificano anche il consumatore preesistente del menu condiviso.

Falsificazione: è stato sostituito temporaneamente il criterio fisso con il filtro originale che promuoveva Terapie, Misure e Documenti soltanto con conteggio positivo, mantenendo Diario fra gli ingressi principali. La prova di componente è fallita nei due casi a 1280 e 390 px, con `Riepilogo, Diario` al posto dei quattro segmenti. Il file corretto è stato ripristinato byte per byte; gli 8 test di componente sono poi tornati verdi. La mutazione non è inclusa nel commit.

Verifiche locali: 8 test di componente verdi; 25 E2E comportamentali verdi fra navigazione, azioni testata, Scheda e Quadro; 2 prove di raccolta catture e zoom verdi sulla revisione indicata. La raccolta catture è normalmente disattivata quando `PATIENT_NAV_EVIDENCE_DIR` è assente. La prova storica delle quindici destinazioni è stata adeguata al menu ARIA e rieseguita dopo aver corretto il gesto Esc del test.

Lint, typecheck, `check:lume-tokens`, `check:test-selection` (1142 test censiti, 1111 selezionati, 31 esclusioni motivate), `check:never-regress` e `check:claims` verdi. Nessuna modifica alle rotte o ai contratti API.

Build di produzione `npm run build -- --webpack` verde sullo SHA del prodotto, in una worktree pulita con `npm ci` reale. Il solo database di fixture nativo tracciato non è stato materializzato tramite sparse checkout, per rispettare il controllo degli input di build. La worktree di sviluppo e la fixture originale sono rimaste intatte. Postbuild, controllo del bundle standalone e baseline delle 29 rotte statiche verdi.

Le prove Web e le catture sono state eseguite soltanto con l’harness `scripts/e2e-smoke.sh` e Playwright del repository, con directory dati sintetiche temporanee e copia legacy disabilitata. Per riprodurre le catture:

```sh
MEDIFLOW_E2E_DATA_DIR="$(mktemp -d)" \
MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1 \
E2E_BASE_URL=http://127.0.0.1:3164 \
E2E_SPECS='e2e/patient-navigation.spec.ts --grep catture|zoom --retries=0' \
PATIENT_NAV_EVIDENCE_DIR=/percorso/locale/evidenze \
bash scripts/e2e-smoke.sh
```

Prerequisiti: Node 24, `npm ci` reale nella worktree e Chromium di Playwright installato. Le prove attestano il comportamento Web su fixture sintetiche; non costituiscono validazione clinica.
