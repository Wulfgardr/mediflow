# Catture e prove Apple, 7 novembre 2026

App Debug sul banco sintetico. Codice iOS delle catture: `59e54ac8515534aed9579ad79cfe06741ed32526`. iPhone 17 Pro ed iPad Pro 13 pollici su iOS 27.3, iPad orizzontale, Giorno e Grafite. I cinque PNG qui raccolti sono originali, scelti fra le 28 catture finali, senza elaborazione.

| Schermata | Evidenza |
| --- | --- |
| [Elenco iPad](ipad-elenco-giorno.png) | Barra laterale, righe da 44 punti, contenitore e selezione dei filtri con il raggio dei controlli. |
| [Scheda iPad](ipad-scheda-giorno.png) | Quattro tabelle nel quadro e diario affiancato. |
| [Impostazioni Grafite](ipad-impostazioni-grafite.png) | Inchiostro sul fondo selezionato, senza blu pieno. |
| [Scrittura iPhone](iphone-scrittura-grafite.png) | Soglia di registrazione sopra la tastiera. |
| [Errore PIN Grafite](iphone-errore-grafite.png) | Croce e critico pieno. |

Il banco condiviso è passato da 42 a 43 pazienti sintetici. Le scene di scheda e diario conservano Rossi Sintetica Maria e Vuoto Sintetico Paolo. Dispositivo, orientamento, temi e sequenza sono invariati. Nessun salvataggio della bozza.

`CaptureTests.swift` verifica le quattro tabelle, l'assenza dell'annuncio di apertura dal testo visibile, la riga iPad di 44 punti, il contenimento della prosa e controlla il bordo della soglia rispetto alla tastiera. Entrambe le catture automatiche finali passano. L'unico cambiamento successivo nei sorgenti del prodotto riguarda il file della navigazione Mac, interamente escluso dalla compilazione iOS.

Il DTO Swift legge il campo cifrato facoltativo `allergies` del contratto introdotto dalla PR #860, lo decifra e conserva nella cache l'involucro ricevuto. Un test UI separato verifica campo assente, Amoxicillina registrata e dato non decifrabile. Il banco delle 28 catture non è stato riavviato né aggiornato per aggiungere il campo: nessuna allergia è stata ricavata dalle note. L'autore non è nel DTO del diario: resta «Registrata», con l'orario di creazione quando disponibile.

Il crash `UIMenu.establishInitialDefaultSingleSelection` proveniva dal Picker nel gruppo della toolbar. Un Menu con due azioni esplicite elimina quella selezione implicita. Il test UI dedicato apre la vista e cambia ordinamento in entrambe le direzioni. La label composta conserva il testo in inchiostro.

Sul Mac sono aggiornati selezione e densità dell'elenco, quadro e diario, bozza, toolbar, soglia, navigazione e titoli. La suite Swift passa con **922 test, 0 fallimenti e 3 saltati**. La build macOS passa. **Le catture Mac e la verifica interattiva Mac mancano:** le eseguirà il coordinatore sullo schermo condiviso.

La suite UI iPad non è dichiarata tutta verde. Resta il controllo Dynamic Type dell'audit, riprodotto anche sulla base con una verifica isolata dello stesso tipo di audit. Il confronto OpenAPI con la base assegnata passa. Quello con main avanzato segnala i campi allergie aggiunti dopo la base. Questi limiti sono distinti dalle prove di cattura e dal test del crash.
