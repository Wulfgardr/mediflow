# Diagnostica Linux WUL-787: una osservazione Official

Ingresso push limitato a `codex/WUL-787-linux-diagnostics-20261024`, con un solo job diagnostico distinto dai gate PR. Nessun evento PR o dispatch. Il commit dei test è distinto dall'applicazione costruita: `347699434b321d5576d4e9debd706cc142d1f9fe`, tree `34b50b7940e4e59466f3c67fa31b2c87412ef8c9` (W347).

La revisione R3 programma **una sola invocazione**: Official UI originale con interleaving controllato RED, timeout originale 45000 ms, worker1 e retry0, poi classificazione, cleanup e STOP per qualunque esito. Non prosegue a GREEN, rimozione, consumer, Per data o AnyDoc, neppure se il RED è ammissibile. Il piano R2 a sei invocazioni resta storico; i suoi overlay W, classifier baseline e metadati `inactiveR2History` sono conservati per provenienza, senza essere invocati dal driver R3.

## Build e identità

Ubuntu24.04 x64 nativo, Node24.21.0/ABI137, una npm ci dal lock W347, Playwright1.58.2 e Chromium bloccato con versione effettiva verificata. Una build completa esegue prebuild/postbuild e guard originali; static-routes, source-runtime e payload/ledger sono verificati **prima** degli overlay test-only. Non vengono allargati permission o guard. Runtime e test usano la stessa installazione, senza seconda build. L'identità HTTP revision/sourceFingerprint e l'hash ledger devono restare quelli qualificati. Il BuildID di una run precedente non è un payload riutilizzabile né qualifica una nuova build.

Dati sintetici distinti per build e singolo runtime, esterni alle checkout; entrambe le variabili anti legacy-copy restano impostate. La fixture DB nativa tracciata è esclusa dal checkout runtime. Nessun database reale viene letto o copiato.

## Interleaving e osservazione

Il listener `page.request` originale conta **tutti** i POST lock/login finché rimane registrato; il guard finale resta `lockRequests === 1`. Il checkpoint prima di isEnabled e il conteggio finale sono dati distinti. Le receipt sono autentiche: route.fetch verifica status200, body di conferma e presenza ETag, poi route.fulfill inoltra la risposta originale. L'evento `real-receipt-delivered` significa completamento di fulfill, non dimostra da solo che React abbia consumato la receipt; le assertion PIN enabled/vuoto e renew assente precedono il checkpoint osservabile. Non vengono fermati tick, richieste, auth o timer e non si filtrano POST tardivi.

La fixture aggiunge solo un osservatore passivo al `_protocolLogger` della connessione Chromium già usata da Playwright. Richiede versioni e hash esatti delle tre fonti PW nel modulo. Il wrapper delega il logger precedente con gli stessi this, argomenti, valore/Promise restituita ed eccezione; non attende il logger. Non crea CDPSession, non invia enable/send, non modifica async stack depth, fetch o DOM e non recupera parent o sourcemap.

Sono conservati soltanto Network.requestWillBeSent già ricevuti per GET `/api/auth/check` e POST `/api/auth/lock` della stessa origine: metodo/path senza query, ID tecnici request/session/frame, appartenenza alla pagina e sessione iniziale/corrente, timestamp CDP, initiator disponibile e parent già incluso. Gli stack esportano solo funzione filtrata, pathname locale `/_next/*.js` o `.mjs`, riga/colonna zero-based. Non esportano header, cookie, PIN, payload, ETag, idempotency key, URL arbitrari o query. Gli eventi fixture già esistenti, ingresso dispose e fine dispose hanno sequenza e tempo monotono Node relativo all'installazione. Il clock Node e quello CDP restano domini distinti, senza sottrarli fra loro.

Limiti: 128 eventi, profondità stack4, 12 frame per stack, testo192 caratteri, 32768 byte per evento e 131072 byte nel journal. Dropped, truncated, errori del collector, parent non disponibile, stack/initiator mancanti, script omessi e cambio/indisponibilità del contesto sono espliciti. Restauro tramite descrittore originale solo se il wrapper è ancora posseduto; un wrapper altrui non viene sovrascritto. Errori, troncamento, cambio contesto o restauro incompleto impediscono EXPECTED_RED. La completezza del journal non significa completezza degli stack né attribuzione del caller.

`official-observation.json` viene salvato dal driver **prima** del guard finale del classifier. La cattura originale, il report PW completo e gli errori secondari rimangono disponibili anche se il conteggio è tre o la classificazione fallisce. Si distinguono qualità/compatibilità/restauro dell'osservazione, classificazione, cleanup server e fasi non raggiunte. Un errore del driver o cleanup non viene trasformato in PASS.

## Significato degli esiti

EXPECTED_RED richiede l'intero contratto: selezione esatta, una sola esecuzione retry0, receipt e conteggio finale1, screenshot e sequenza osservabile, cleanup valido, osservatore completo e **esattamente due errori**: timeout test45000 ms e una sola eccezione nativa isEnabled/nativeEnabled sul selettore Rinnova esatto. Posizione strutturata, frame fixture e callsite del manifest devono coincidere; unlockIfNeeded resta sulla linea151 dell'helper immutabile verificato tramite hash. Extra, duplicati, errori hook/fixture/teardown e cause aggiunte sono respinti conservando primario e intero array. Exit1 o timeout generico non bastano. Un PASS inatteso del caso originale non è un EXPECTED_RED.

La forma nativeEnabled è compatibile col nome dell'alias nella seam e col rendering della libreria bloccata; non indica una diversa operazione DOM. La variante isEnabled ammessa è una famiglia chiusa dello stesso errore. La correzione dell'oracolo non ammette la cattura della run40096513802 con tre lock e non le attribuisce un nuovo esito.

Un percorso checkAuthStatus/reconcile→lock è compatibile col sorgente, ma i due POST successivi di quella run non hanno un'origine storica stabilita. Nuovi frame/funzioni discriminanti potrebbero delimitare il caller nella futura osservazione. Stack minificati, mancanti o tagliati possono lasciare l'origine non stabilita: cadenza15/30 e vicinanza al dispose non bastano. Il classifier non attribuisce automaticamente il caller. Nessuna sonda ulteriore viene avviata automaticamente.

## Output e cleanup

Log/argv/identità, JSON PW e HTML, screenshot/video sintetici e catture sono separati sotto evidence/. Del ledger viene pubblicato solo l'hash. Non si caricano database, dati build/runtime, cache, dipendenze, payload, checkout o dump ambiente. Il driver salva code/signal/spawnError e conserva fallimenti fase e cleanup. Rimuove solo fixture aggiunte e possedute con hash noto, ripristina il caller originale e verifica Git clean. Arresta solo gruppi di processi propri, senza kill per porta; SIGKILL può impedire finally e upload.

Questa preparazione non prova l'esecuzione integrata, l'origine dei POST o il prodotto. La precedente qualificazione Linux vale solo per la sua run/BuildID. Nuova review, accettazione, pubblicazione e futura singola esecuzione restano decisioni del coordinatore.

Refs WUL-787. Preparazione e revisione R3 assistite da GPT-6.1 Sol, effort High. Le copie W corrette in R2 per R1-02 e i relativi hash sono conservati senza nuove modifiche o prove. Nessuna esecuzione E2E è attestata da questi sorgenti.
