# WUL-787: Per data candidato e rimozione della sola dichiarazione

R7 prepara due invocazioni Playwright / tre casi originali completi. Prima la candidata `50b292674330a95143c57c6c873982cf0c7aa18a` (tree `ed33e4f147a83eea3011d7f4abf19b44d16700b0`): Giorno320 e Grafite320 insieme. Solo dopo esito interamente valido e cleanup si passa alla variante `265a046cbe9c26df74be05367cb7915e658cb1f1` (tree `0ba6211297afc1eab3f7f1ef3bdda5cc9335dc39`): soltanto Giorno320.

La variante è figlia diretta della candidata e rimuove esclusivamente `table-layout: auto;` dalla regola `.observationDayTable`, lasciando la regola vuota, la classe JSX e tutti gli altri blob invariati. Non modifica fixture, soglie, testo, selezioni, CSS condiviso o controlli di autenticazione. Le revisioni e i ref tecnici degli input sono fissati nel manifest; la loro pubblicazione precede un eventuale push diagnostico ed è una decisione separata.

## Esiti e STOP

I due casi candidati devono essere entrambi passed, senza errori primari, secondari o globali, skip, flaky o retry. Non basta arrivare al tratto Per data: devono terminare tutte le assertion originali, compresi i rami successivi form/menu/conferma/vuoto.

Sulla rimozione, il solo esito qualificante è exit1/status failed dovuto alla **sola assertion originale di overflow su Misure per data**, con soglia originale <=1. Non è richiesto ritrovare esattamente 11 px: il delta deve essere finito, intero e maggiore di 1. Il primario deve avere messaggio e stack della famiglia esplicita, helper `e2e/utils.ts:47:69` e caller originale `e2e/measures-composition.spec.ts:209:17`. Il singolo errore formattato deve coincidere con quello prodotto dal formatter PW1.58.2 reale sul primario. Cause aggiunte, errori extra/duplicati/hook/fixture/teardown, altri assert, timeout o errori globali non sono una falsificazione. Mutante PASS significa falsificazione mancata, mai successo diagnostico.

Il report grezzo e tutti gli errori rimangono conservati; outcome viene scritto prima del guard. Ogni errore tecnico, di selezione, build, qualifica, caso o cleanup ferma la sequenza senza retry/repair o nuova invocazione. Cleanup tenta sempre stop dei soli processi posseduti e verifica sorgenti/hash/Git clean. Il secondo invio è raggiungibile solo dopo completa riuscita del primo e del suo cleanup.

Gli esiti dell'oracolo riguardano soltanto questo nuovo contratto controllato. Le funzioni pregresse R1-01/R1-02/R4-01 restano byte-identiche; il nuovo oracolo non ammette un teardown o errore aggiuntivo come overflow. Nessuna riclassificazione degli artifact storici.

## Due sorgenti pulite, due build qualificate

Stesso ingresso push limitato al branch diagnostico `codex/WUL-787-linux-diagnostics-20261024`, `contents: read`, nessuna PR/dispatch o modifica dei gate esistenti. Un job Ubuntu24.04 x64 nativo contiene due checkout applicative distinte e fissate per SHA, oltre alla diagnostica. Entrambe escludono la fixture DB nativa. La checkout della rimozione include il parent con fetch-depth2 per il solo ripristino finale.

Per ciascuna revisione, in ordine seriale: Node24.21.0/ABI137, npm ci, installazione/identità del browser bloccato PW1.58.2/Chromium, build completa con prebuild/build/postbuild e guard/smoke bundled obbligatori invariati, static-routes e verifySourceRuntime/ledger. Prima del test si registrano SHA/tree/clean, BuildID, ledger e identità HTTP effettivi. Nessun override identità, dirty mascherato o sorgente modificata sopra un payload già ammesso. Non si riusa il payload R6 o quello della candidata per la rimozione.

Si eseguono le spec originali della revisione, senza alcun overlay geometrico o observer aggiunto. Worker1/retry0/repeat1, timeout originali45s, reporter line,json. Nessun flag baseline. `W11_CAPTURES` e `PLAYWRIGHT_JSON_OUTPUT_FILE` puntano alle directory nuove esterne della variante. Il driver conserva e verifica i PNG/metadata Per data originali, senza interpretare la resa: l'ispezione visiva successiva rimane distinta dal PASS delle assertion.

Dati sintetici build/test separati per variante, legacy-copy disabilitato, log/argv/report/catture separati. Upload della sola evidence; nessun DB, payload, cache, dipendenza o export indiscriminato dell'ambiente. Ownership e limiti SIGKILL/finally sono quelli del driver precedente, nessun kill per porta.

Dopo il test e cleanup della rimozione, solo con sorgente ancora pulita e byte attesi, la sua checkout viene riportata alla SHA candidata. Si confrontano nuovamente tree, hash e Git clean in una ricevuta separata. Questo ripristino non qualifica il payload mutante come candidato, non è un nuovo GREEN e non avvia test di conferma. Nessun runtime viene usato o esportato dopo il ripristino. Un conflitto impedisce overwrite e rimane errore.

## Riuso storico delimitato

[Run R6 40114756690/attempt1](https://github.com/Wulfgardr/mediflow/actions/runs/40114756690), diagnostica817b690, app W347: consumer2PASS, Per data Giorno320FAIL11px/causalRed:false, AnyDocPASS e cleanup validi; globale FAILURE. La misura sulle otto intestazioni RIFERIMENTO è coerente con l'eccedenza, ma non prova il fix50. Non viene riclassificata come RED causale.

R3 resta FAILURE. R5 resta FAILURE globale/di fase, accepted=false/complete=false/truncated=true: è riusata soltanto la proposizione Official già accettata, non completezza globale, atomicità, tutti gli interleaving o quiete futura. Official, consumer e AnyDoc non vengono ripetuti in R7. E1/E2, CI storica e gate PR632/633 restano separati. Il manifest distingue queste provenienze dai soli nuovi outcomes; non esiste alcun payload storico riusabile.

I tre sorgenti Official e i cinque overlay W/shared restano nel pacchetto come storia inattiva. Non vengono copiati o eseguiti. R7 non modifica prodotto, auth/UI/writer o soglie per far passare un test. Preparazione assistita da GPT-6.1 Sol High/default, Refs WUL-787. Nessun GREEN applicativo o resa anticipati: nuova FULL, pubblicazione, run e accettazione spettano al coordinatore.
