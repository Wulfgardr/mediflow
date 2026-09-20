# Blocco diagnostico CDP del consenso ChatGPT

Aggiornamento: 20 settembre 2026. Perimetro: fixture sintetiche e diagnostica
del percorso ChatGPT in browser; nessun dato clinico o stato di sessione.

## Stato

La base di rilascio resta `d3431dbf0de73c692f560d97c86e4333cdf70db6`.
La [PR 352](https://github.com/Wulfgardr/mediflow/pull/352) è una bozza
diagnostica, non destinata al merge. I cinque commit successivi —
`bf5446f4e170bd0d33d7989f1e0412cae5c86f35`,
`c5397d92e3c9c06d7ba66df960f21c4de8d4ca36`,
`8ecf3c665b7d06af40c2c8b8f7436cb99065f61f`,
`ef8e0b270d4c72901552b9d7b4ac274a4714784e` e
`3dedd9c988040c4ff0d52df98725aa558ca7aa43` — aggiungono soltanto runner,
osservatori passivi, filtro dei metadati e riduttore della sequenza.

La causa dell'errore CDP resta irrisolta. Nessuna cattura dimostra una
correzione del prodotto. Il delta pubblicato non contiene una correzione del runtime. Restano
invariati lettura originale del body, asserzioni dello scenario, cleanup,
fallimento fail-closed e propagazione dell'errore originale.

## Tre catture Linux

| Cattura | GitHub Actions e sorgente | Esito osservato | Gap e limite |
| --- | --- | --- | --- |
| Linux 01 | [35517771771](https://github.com/Wulfgardr/mediflow/actions/runs/35517771771), `c5397d92e3c9c06d7ba66df960f21c4de8d4ca36` | Runner `1`, filtro `0`; sette comandi body, due errori e cinque letture riuscite. I due errori seguono risposta consenso HTTP 200, `loadingFailed` aborted e body CDP non disponibile. | Il replay classifica due `MISSING_CALLER_WITNESS` e cinque `NOT_REPRODUCED`: il chiamante della cancellazione non è identificato. |
| Linux 02 | [35518628206](https://github.com/Wulfgardr/mediflow/actions/runs/35518628206), `8ecf3c665b7d06af40c2c8b8f7436cb99065f61f` | Runner e filtro `0`; nove body, zero errori; sette consensi `NOT_REPRODUCED`. | Il filtro allora non conservava gli eventi pagina: zero testimonianze del chiamante. Il PASS non dimostra un fix. |
| Linux 03 | [35521466119](https://github.com/Wulfgardr/mediflow/actions/runs/35521466119), `3dedd9c988040c4ff0d52df98725aa558ca7aa43` | Runner e filtro `0`; nove body, zero errori, 470 eventi pagina, nessuna perdita, overflow o comando pendente. I sette consensi hanno copertura completa e risultano `NOT_REPRODUCED`: EOF precede il `reader.cancel`, la rete termina e il body CDP resta disponibile. | È una sola esecuzione verde. Esclude il cancel dopo stream chiuso come causa di quei sette tentativi; non spiega i due errori di Linux 01 e non prova una riparazione. |

I file byte-esatti minimizzati sono in
[`cdp-evidence-2026-09-20`](./cdp-evidence-2026-09-20/); il relativo
[`MANIFEST.json`](./cdp-evidence-2026-09-20/MANIFEST.json) registra dimensione
e SHA-256. Sono esclusi log CDP grezzi, directory dati, screenshot, ricevute,
account, coordinate browser e percorsi locali.

## Verifiche del delta diagnostico

Sul commit `3dedd9c98`, Node 24.19.0 supera 73/73 test mirati. Passano anche
typecheck di progetto, ESLint sui sette file del follow-up, `git diff --check`
e l'invariante strutturale: 160 asserzioni, 25 azioni e 20 click originari
invariati; body read e cleanup originari preservati; nove casi di cleanup PASS.
Questi controlli qualificano la diagnostica, non il comportamento del prodotto.

## Contributi 6 Pro

- `c7501e0b2ba146b1b9d7272f56abf7de`: ZIP originale 77.164 byte,
  SHA-256 `bc4410cfd8935ad93786cdb92bb278fa81d79bab80e771b9da77139b041eef30`.
  Ha proposto l'osservatore senza lettura aggiuntiva e i test nei tre file
  pubblici `e2e/chatgpt-response-lifetime-probe.ts`,
  `e2e/chatgpt-synthesis-product.spec.ts` e
  `lib/chatgpt-product/response-lifetime-probe.test.ts`. Era diagnostico e non
  costituiva una diagnosi causale o un fix validato.
- `775fc2f4263045fa9a17fd51c3adf1b9`: ZIP originale 156.818 byte,
  SHA-256 `555a5ec49d7328eab6c7386fd510c89269c6e161ffd98e08f6f5d9fb07a361aa`.
  Ha esteso i tre file precedenti, i due file pubblici
  `scripts/chatgpt-cdp-diagnostic/cdp-metadata-filter.{mjs,test.mjs}` e ha
  aggiunto `scripts/chatgpt-cdp-diagnostic/decide-consent-cancellation.{mjs,test.mjs}`.
  Il contributo produce una decisione limitata per cattura; dichiara
  `product_fix_established: false` e non contiene una correzione del runtime.

Runner e riduttore necessari a riprodurre la raccolta e la classificazione sono
già nel repository. Questo dossier non duplica codice o test e non trasforma
una prova diagnostica sintetica in un gate della consegna 0.8.6.
