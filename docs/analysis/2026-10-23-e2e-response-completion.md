# Stabilità e2e: completamento della risposta nel browser

La base della verifica è `18c0a179bd98a8c53c13b77653aed6fc682f75b4`.
Le modifiche riguardano gli strumenti di prova e la CI. Il prodotto, `no-store`,
i limiti dei lettori, i timeout, i retry configurati e le condizioni di skip
restano invariati. Tutte le misure usano dati sintetici.

## Causa e correzione

Le run main [39903959697](https://github.com/Wulfgardr/mediflow/actions/runs/39903959697)
e [39910438672](https://github.com/Wulfgardr/mediflow/actions/runs/39910438672)
mostrano le firme `ERR_ABORTED` sia in AnyDoc sia nel browser harness ChatGPT.
È il difetto Chromium del completamento di un corpo `no-store` consumato come
stream, descritto in [Playwright #42742](https://github.com/microsoft/playwright/issues/42742)
e [Chromium 568852319](https://issues.chromium.org/issues/568852319).
Il lettore può raggiungere EOF naturale mentre DevTools dichiara annullata
la richiesta. Un evento negativo di DevTools, da solo, non distingue questo
caso da un annullamento effettivo.

L'oracolo mantiene l'identità della richiesta originale e richiede un solo
lettore applicativo, EOF naturale, assenza di abort o cancellazione anticipata,
nessuna lettura pendente e rispetto del limite di byte. Il solo terminale
`ERR_ABORTED`, con la risposta `no-store` prevista, può essere accompagnato da
questa prova indipendente; gli altri errori restano bloccanti. AnyDoc confronta
inoltre tutti i byte del lettore con quelli del medesimo request ID CDP,
compresi prefisso e grant. Nessuna richiesta sostitutiva, `clone`, `tee`,
lettura aggiuntiva o accesso a `Network.getResponseBody`.

La prova HTTP controllata usa gli helper originali estratti dalla base e poi
gli helper corretti: il server invia due blocchi; il browser autorizza il
secondo dopo aver letto il primo e avviato la lettura successiva. Non vi sono
sleep. Ogni operazione ha 30 richieste e 30 completamenti server, senza chiusure
premature:

- consent 200: **30/30 rossi prima; 0/30 dopo**;
- login/complete 409: **29/30 rossi prima; 0/30 dopo**;
- project AnyDoc 200: **27/30 rossi prima; 0/30 dopo**.

Ambiente: Node 24.22.0, Playwright 1.58.2, Chromium 145.0.7632.6 su macOS arm64.
La candidata Playwright `1.65.0-alpha-2026-10-22`, Chromium 156.0.8078.12,
mostra ancora annullamenti nel probe locale: non è stata adottata.

## Profilo e disclosure

Per [#625](https://github.com/Wulfgardr/mediflow/issues/625) il test dipendeva
anche dalla conservazione del corpo nella cache dell'inspector. Ora osserva
lo stato HTTP e le conseguenze applicative: blocco del salvataggio, bozza
conservata, zero letture o scritture involontarie e rilettura esplicita.
L'errore spontaneo non è ricomparso nei 15 casi di baseline. Iniettando soltanto
l'indisponibilità di `Response.json()` nell'oggetto Playwright, il vecchio test
fallisce **1/1** e quello corretto passa **1/1**. Una risposta applicativa con
`hasSession: false` continua invece a far fallire il test corretto **1/1**.

Il test della risposta di salvataggio persa usava una bozza costante. Due
ripetizioni originali passavano anche se il secondo PUT era un no-op
(`changed=false`). Ogni ripetizione ora usa una bozza distinta e prova che
il primo PUT abbia scritto prima di perdere la risposta. Il contatore resta
attivo durante la rilettura e ammette un secondo PUT solo dopo il comando
manuale finale.

Profilo e disclosure: **160/160** casi di baseline nei quattro spec coinvolti;
altri **30/30** su profilo e Giorno 390 prima della modifica. Dopo: **90/90**
nei due spec, cinque ripetizioni senza retry. Giorno 390 non è ricomparso:
nessuna modifica CSS o dichiarazione di causa risolta per questo caso.

## AnyDoc nelle due piattaforme

Nel bundle standalone production della base, su Mac, i quattro spec iniziali
passano 160/160. In Omarchy arm64, usando i sorgenti della stessa base e Next
dev, 40 casi mirati con `--repeat-each=10 --retries=0` danno **8/40** errori
con la firma `ERR_ABORTED`: protected 2/10, corrupt 4/10, image 2/10, text 0/10.
Un nono errore è HTTP 409 sul primo project dev, separato dalla firma;
la sua causa non è stabilita da questo confronto. Chromium Linux bloccato: 145.0.7632.0.

Dopo la modifica Linux passa **40/40**, senza retry. Il run production Mac
conclusivo dà **68/70**: restano un caso scan e uno mixed con
`review_required/resource_limit`, senza errori di osservazione della risposta.
Questo percorso nativo Mac non è dichiarato completamente stabilizzato.

Durante un run Mac sovrapposto alla suite unit, scan/mixed hanno dato
**5/10** risultati `review_required` invece di `extracted` (65/70 casi totali
verdi). Sono risposte applicative complete, non errori dell'oracolo.
Nella stessa esecuzione unit quattro prove Apple Vision hanno raggiunto il
limite esistente di 30 secondi. Il runner avvia Swift sotto sandbox a ogni
richiesta. L'associazione con il carico è osservata; non prova da sola che il
carico sia l'unica causa. Ripetuti separatamente, scan/mixed passano **10/10**.
Un probe del solo script Swift sotto il medesimo sandbox supera il limite
di 30 secondi alla prima invocazione, impiega 18,3 secondi alla seconda e
0,42–0,82 secondi nelle sei successive. Il probe documenta il costo di avvio;
non isola compilazione, framework e servizio Vision né dimostra da solo la
causa di tutti i `resource_limit`. Il timeout e l'asserzione `extracted` restano
invariati.

## Falsificazione e gate

Tre copie isolate dei sorgenti effettivi vengono mutate e ripristinate byte
per byte: ripristinare l'oracolo ChatGPT originale fa fallire il nuovo positivo;
ripristinare quello AnyDoc fa fallire il suo positivo; rimuovere i controlli
EOF/abort fa fallire il negativo. Tutti e tre i mutanti sono rossi.
I test coprono anche cancellazione, abort, errore di lettura, byte discordanti,
header assente, navigazione e altri errori di rete.

Le shard passano a tre. La lista reale di Playwright contiene 385 casi:
129, 160 e 96 per shard, con unione completa e senza duplicati, confrontata
tramite gli ID effettivi dei test. Nessun filtro viene aggiunto alla CI.
`fail-fast: false` e l'aggregato `e2e` che richiede `success` di tutte le shard
sono conservati. Il guard nega anche matrice a due shard e denominatore `/2`.
La protezione di main richiede `e2e`, non i nomi delle singole shard.
La riduzione del tempo remoto resta da misurare nella nuova CI.

Due loop aggiuntivi sono invalidati da errori di avvio del browser durante
l'installazione della candidata (76 e 38 errori): non entrano nelle frequenze.
Il browser bloccato è stato ripristinato prima dei confronti conclusivi.

I log grezzi, i dati e gli esperimenti restano fuori dal repository. La PR
riporta separatamente i check verdi, quelli rossi e le prove sulla base.

## Controlli prima del push

- Test degli oracoli: **58/58** verdi. Browser harness canonico ChatGPT:
  prima due comandi rossi su cinque; dopo **10/10 comandi**, **260/260 casi**.
- `test:inventory-browser`: tutti e quattro i comandi verdi.
- Lint, typecheck e tutti i 14 gruppi di Repository Guards verdi.
  Test-selection: **COMPLETE**, 1151 file, 1119 selezionati, 32 esclusioni motivate.
- Prima unit completa: 7774 casi, 7757 verdi, tre errori per prerequisiti
  sorgente Mac assenti e 14 skip previsti. Gli stessi tre errori sono riprodotti
  sulla base. Configurati gli artefatti congelati, i relativi pin passano.
- Seconda unit completa con i prerequisiti: **7774 casi, 7752 verdi, otto rossi,
  14 skip**. I rossi sono due prove in `anydoc-apple-vision-ocr.test.ts`, due
  in `anydoc-current-source-composition.test.ts`, il caso di cancellazione
  in `exemption-import-followup.test.ts` e tre casi Mini (reselection, eof,
  empty_eof). Questi file sono invariati nel diff. In una selezione sulla base
  sono rossi Mini reselection ed empty_eof; non si presenta ogni errore in
  ogni esecuzione. Non si dichiara la unit completa verde.
- I due gruppi unit seriali, non raggiunti dal runner dopo il primo gruppo
  rosso, sono stati eseguiti separatamente: **61/61** e **66/66** verdi.

Restano aperti il limite nativo scan/mixed sul Mac e i rossi della unit sopra
elencati. Per Giorno 390 non è stata riprodotta una firma di errore. La
consegna non certifica questi punti come risolti. La CI remota della PR resta
da valutare; nessun merge è incluso.
