# ADR 0206: operatore locale da riga di comando

Data: 2026-11-28. Stato: **Accepted** (richiesta di Leonardo del 27 e 28/11/2026).
Riferimenti: WUL-978, [ADR 0190](./0190-mandato-agenti-e-cassetta-della-visita.md), [ADR 0199](./0199-web-session-client-proof.md), [ADR 0205](./0205-documenti-dal-fascicolo.md).

## Contesto

Il medico che sviluppa e usa MediFlow sulla propria postazione affida agli agenti lavori lunghi: importare un arretrato di documenti, creare le schede dei pazienti mancanti, ripetere un lotto dopo una correzione. Finora ogni passo passava dall'interfaccia Web: un agente doveva guidare Chrome, chiedere al medico di digitare il PIN nella pagina e aspettare che MediFlow fosse aperto e sbloccato dal launcher. Un lotto restava fermo per ore in attesa di un gesto, anche quando il medico non era al computer.

Il mandato degli agenti (ADR 0190) non basta: deposita cassette cifrate ma non legge l'archivio, non crea schede e non applica fatti. È giusto così per un agente qualunque; non serve al proprietario che lavora sul proprio archivio.

## Decisione

1. **Un client Web senza browser.** `scripts/mediflow-operatore.mjs` costruisce ed esegue `tools/operatore/`. L'operatore carica in Node gli stessi moduli che girano nel browser (`lib/db`, `lib/security/client-auth-api`, `lib/document-dossier-session`, `lib/dossier-batch-patient-client`) sopra un ambiente minimo: finestra con eventi, `location` sull'origine loopback, storage e `fetch` same-origin con i cookie della sessione. Non ci sono rotte nuove né permessi nuovi sul server: l'operatore fa le stesse richieste della scheda Web, con la stessa prova del client (ADR 0199), la stessa generazione d'archivio e gli stessi writer.

2. **Le credenziali del medico, nel Portachiavi.** La passphrase (o il PIN di accesso, negli archivi non ancora migrati) e il PIN di conferma stanno nel Portachiavi di macOS dell'utente, servizio `it.mediflow.operatore`, mai in file, variabili d'ambiente, argomenti di processo, log o chat. `configura` li legge dallo standard input, prova l'accesso e solo allora li salva. Con la passphrase la chiave maestra si apre in memoria nel processo dell'operatore, come nella scheda Web, e il server riceve solo il verificatore. Il PIN di conferma serve ai passaggi che nell'interfaccia lo chiedono, per esempio la conferma di un lotto di schede nuove.

3. **Acceso finché il medico non lo spegne.** Non c'è scadenza: l'operatore lavora anche con lo schermo bloccato. Lo spengono `spegni` (rimuove le credenziali), un cambio di passphrase o di PIN (le credenziali salvate non aprono più) e un accesso rifiutato: in quel caso l'operatore scrive `credenziali-rifiutate` nella sua cartella di stato e non riprova finché il medico non ripete `configura`, così non consuma i tentativi e non blocca l'account.

4. **Stesse regole dell'interfaccia.** L'operatore crea un lotto di schede con il PIN di conferma, ma è il server a rifiutare le righe senza nome, con codice fiscale non valido, con data di nascita assente o diversa da quella del codice fiscale, con identità mista o doppia. Per il collegamento automatico ogni originale da acquisire deve indicare esplicitamente lo stesso codice fiscale paziente della scheda. Per creare una scheda, nome, cognome e data di nascita devono trovare riscontro nel PDF selezionato. I gruppi di attribuzione incerta restano da confermare nel Dossier Web. Applica il verificato solo agli originali riletti nel lotto. La dichiarazione «Ho letto le sintesi» resta del medico. Non decide le voci di «Da decidere». Il client rifiuta, prima di chiamare il server, ogni richiesta che colleghi, scolleghi o modifichi agenti (salvo il rinnovo allo sblocco), usi il canale degli agenti, cambi credenziali, blocchi le schede, ripristini, migri, ripari o cancelli (`gestoRiservato` in `tools/operatore/ambiente.ts`).

5. **Riconoscibile nell'audit.** Ogni richiesta dell'operatore porta `x-request-id` con prefisso `mfop-<esecuzione>`; le righe d'audit che registrano l'identificativo di richiesta, a cominciare da `auth.login.succeeded`, lo conservano. L'esito per scheda va in una ricevuta locale (`--ricevuta`, permessi 0600) con le sole ultime quattro cifre del codice fiscale; lo standard output porta solo conteggi.

6. **Avvio senza launcher.** `avvia` (o `--avvia` prima di un comando) esegue lo stesso comando non interattivo del launcher, `scripts/mediflow.mjs --scelta web --senza-browser`, solo se MediFlow non risponde già. Non riavvia né arresta un MediFlow in uso: se risponde, non avvia nulla.

7. **Agenti rinnovati.** Se l'accesso dell'operatore riceve il ticket di rinnovo, lo conferma come fa lo sblocco Web: i mandati degli agenti collegati (ADR 0190) si rinnovano per 24 ore a ogni accesso dell'operatore.

## Uso

```sh
printf '{"segreto":"…","pin":"…"}' | node scripts/mediflow-operatore.mjs configura
node scripts/mediflow-operatore.mjs stato
node scripts/mediflow-operatore.mjs dossier --cartella <cartella> --estrazione <estrazione-preparata.json> --ricevuta <ricevuta.json>
node scripts/mediflow-operatore.mjs spegni
```

`--url` sceglie un MediFlow su un'altra porta del loopback; `--credenziali-stdin` sostituisce il Portachiavi (prove e sistemi senza Portachiavi).

## Conseguenze

- La protezione dell'archivio mentre l'operatore è acceso coincide con quella dell'utente macOS: un processo dello stesso utente può leggere le credenziali dal Portachiavi. È la stessa frontiera che [SECURITY.md](../../SECURITY.md) lascia fuori dal perimetro (sistema operativo compromesso o sessione sbloccata). Un altro account dello stesso computer (T3) non le legge.
- Nessuna modifica del server: il confine delle rotte Web, il roster delle scritture cliniche e l'audit restano quelli di oggi. Un cambio di quelle rotte vale anche per l'operatore, perché usa lo stesso codice client.
- Prova: `e2e/operatore-locale.spec.ts` su un runtime isolato con dati sintetici crea due schede da un lotto con un solo PIN preso dalle credenziali, riconosce gli originali, applica il verificato, non duplica alla seconda esecuzione, marca l'audit e si ferma dopo un accesso rifiutato. `tools/operatore/operatore.test.ts` prova loopback, cookie e intestazioni, il rifiuto dei gesti riservati senza alcuna richiesta al server e l'avvio che non tocca un MediFlow già attivo.
- Restano fuori da questa prima consegna il backup cifrato dall'operatore e la lettura di una singola scheda: si aggiungono come comandi sullo stesso client quando servono.
