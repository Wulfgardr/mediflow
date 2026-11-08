# Catture e prove Apple, 7 novembre 2026

Il ramo integra `origin/main` a `ccc610591ec099fe6aff72309e2a8a132807625f` con un merge. Dopo l'integrazione passano la suite Swift completa (**932 test, 0 fallimenti, 3 saltati**) e le build Debug iOS Simulator e macOS. Passano tutti i **24 controlli npm del job repository-guards**, compreso OpenAPI contro main integrato, con installazione delle dipendenze e controllo dello stato Xcode per utente eseguiti.

L'audit iPad resta rosso: [causa, schermate, misure e limiti](AUDIT-IPAD.md). La PR conserva l'audit completo e raccoglie tutti i rilievi. Le catture Mac e la verifica interattiva Mac restano affidate al coordinatore.

Le verifiche UI dopo il merge coprono una selezione mirata di 17 casi per dispositivo:

| Dispositivo | Passati | Saltati | Falliti |
| --- | --- | --- | --- |
| iPhone 17 Pro | 12 | 5 | 0 |
| iPad Pro 13 pollici | 15 | 1 | 1, audit completo |

Per iPad la tabella riconcilia il primo run (14 passati, 1 saltato, 2 falliti) con la riesecuzione verde del caso allergie dopo la correzione. Non è una seconda esecuzione completa della selezione. Il caso sulle allergie passa anche nel run iPhone finale, così come l'audit completo iPhone. Le prove coprono modifica anagrafica e campi bloccati, nascita, ordinamento, navigazione, riepiloghi, bozza, rotazione e disposizione AX5.

App Debug sul banco sintetico. Codice iOS delle catture: `59e54ac8515534aed9579ad79cfe06741ed32526`. iPhone 17 Pro ed iPad Pro 13 pollici su iOS 27.3, iPad orizzontale, Giorno e Grafite. I cinque PNG qui raccolti sono originali, scelti fra le 28 catture finali, senza elaborazione.

| Schermata | Evidenza |
| --- | --- |
| [Elenco iPad](https://github.com/Wulfgardr/mediflow/raw/5afa7f0f2503abe4549133b8dddd5e865b218498/docs/analysis/2026-11-07-apple-identita/ipad-elenco-giorno.png) | Barra laterale, righe da 44 punti, contenitore e selezione dei filtri con il raggio dei controlli. |
| [Scheda iPad](https://github.com/Wulfgardr/mediflow/raw/5afa7f0f2503abe4549133b8dddd5e865b218498/docs/analysis/2026-11-07-apple-identita/ipad-scheda-giorno.png) | Quattro tabelle nel quadro e diario affiancato. |
| [Impostazioni Grafite](https://github.com/Wulfgardr/mediflow/raw/5afa7f0f2503abe4549133b8dddd5e865b218498/docs/analysis/2026-11-07-apple-identita/ipad-impostazioni-grafite.png) | Inchiostro sul fondo selezionato, senza blu pieno. |
| [Scrittura iPhone](https://github.com/Wulfgardr/mediflow/raw/5afa7f0f2503abe4549133b8dddd5e865b218498/docs/analysis/2026-11-07-apple-identita/iphone-scrittura-grafite.png) | Soglia di registrazione sopra la tastiera. |
| [Errore PIN Grafite](https://github.com/Wulfgardr/mediflow/raw/5afa7f0f2503abe4549133b8dddd5e865b218498/docs/analysis/2026-11-07-apple-identita/iphone-errore-grafite.png) | Croce e critico pieno. |

Il banco condiviso è passato da 42 a 43 pazienti sintetici. Le scene di scheda e diario conservano Rossi Sintetica Maria e Vuoto Sintetico Paolo. Dispositivo, orientamento, temi e sequenza sono invariati. Nessun salvataggio della bozza.

`CaptureTests.swift` verifica le quattro tabelle, l'assenza dell'annuncio di apertura dal testo visibile, la riga iPad di 44 punti, il contenimento della prosa e controlla il bordo della soglia rispetto alla tastiera. Entrambe le catture automatiche del giro precedente passano. Queste 28 catture precedono il merge con main e non sono presentate come nuove catture del ramo integrato.

Il DTO Swift legge il campo cifrato facoltativo `allergies` del contratto introdotto dalla PR #860, lo decifra e conserva nella cache l'involucro ricevuto. Un test UI separato verifica campo assente, Amoxicillina registrata e dato non decifrabile. Il banco delle 28 catture non è stato riavviato né aggiornato per aggiungere il campo: nessuna allergia è stata ricavata dalle note. L'autore non è nel DTO del diario: resta «Registrata», con l'orario di creazione quando disponibile.

Il crash `UIMenu.establishInitialDefaultSingleSelection` proveniva dal Picker nel gruppo della toolbar. Un Menu con due azioni esplicite elimina quella selezione implicita. Il test UI dedicato apre la vista e cambia ordinamento in entrambe le direzioni. La label composta conserva il testo in inchiostro.

Sul Mac sono aggiornati selezione e densità dell'elenco, quadro e diario, bozza, toolbar, soglia, navigazione e titoli. La build macOS del ramo integrato passa. **Le catture Mac e la verifica interattiva Mac mancano:** le eseguirà il coordinatore sullo schermo condiviso.

La suite UI iPad non è dichiarata tutta verde. Il test sulle allergie verifica anche la loro conservazione dopo una modifica anagrafica, compreso il caso del campo protetto non leggibile. Questa nuova asserzione fallisce sul merge `ac1ac600b`, prima della correzione: la fixture usa il valore già decifrato, che è `nil` per il campo non leggibile, e perde l'avviso. La fixture ora conserva l'involucro cifrato nel passaggio allo stesso decoder. Il caso passa su entrambi i dispositivi dopo la correzione. Il percorso di scrittura clinica resta quello integrato da main.

Il confronto OpenAPI con main integrato passa. Il precedente scarto sui campi allergie è chiuso dall'integrazione di #860.
