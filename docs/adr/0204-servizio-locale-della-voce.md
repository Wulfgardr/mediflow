# ADR 0204: Servizio locale della voce

Date: 2026-11-26
Status: Proposed

Refs: WUL-828
Attua: [ADR 0200](./0200-web-standard-launcher-e-ritiro-app-desktop.md), passo 2 del piano di ritiro.

## Problema

La voce locale (whisper.cpp con Metal, rilevatore Silero, attribuzione delle frasi a medico e paziente, aiuto sui nomi dei farmaci, ascolto dell'intera visita) viveva solo in `experiments/gpui-patient-pilot/app/src/local_voice/`. ADR 0200 toglie GPUI e lascia il Web come unica applicazione desktop: prima di togliere GPUI la voce deve diventare raggiungibile dall'app Web locale, con lo stesso comportamento già provato.

L'audio di una visita è un dato clinico. Il confine nuovo (un processo che ascolta su una porta) non deve aprire uscite di rete, non deve lasciare audio o testo su disco e deve rispondere solo all'app locale autorizzata.

## Decisione

### Pacchetto

`native/local-voice/` è un workspace Cargo autonomo con due pacchetti:

- `engine` (`mediflow-local-voice`, libreria): i moduli spostati senza riscritture da GPUI (`recording`, `listening`, `voices`, `whisper`, `model`, `drug_review`, ponte Swift del microfono) e la sessione che GPUI usava. GPUI lo usa come dipendenza (`app/src/local_voice.rs` riesporta il pacchetto): una sola copia del codice.
- `service` (`mediflow-voice`, eseguibile): il servizio sul loopback. Non dipende da librerie di rete: HTTP/1.1 minimo su `std::net`.

Il servizio non apre il microfono. Il microfono lo apre la pagina Web (permesso del browser, uguale su macOS, Windows e Linux) e manda al servizio blocchi PCM. Il ponte Swift resta nel motore per GPUI finché GPUI esiste.

### Processo e fiducia

- Il launcher genera a ogni avvio un segreto di 32 byte e lo passa per ambiente al servizio (`MEDIFLOW_LOCAL_VOICE_SECRET`) e al server Web, come già fa per `MEDIFLOW_LOCAL_UI_WEB_SECRET` (`scripts/local-ui-web-identity.mjs`). Il segreto non va su disco.
- Il servizio si lega a `127.0.0.1` su una porta scelta dal sistema e la comunica sullo stdout al processo che l'ha avviato (`MEDIFLOW_LOCAL_VOICE_READY {"port":N}`). Esce quando il suo stdin si chiude, cioè quando muore chi l'ha avviato.
- Su macOS il servizio gira sotto `sandbox-exec`, come i processi dei documenti (ADR 0198): `(deny network*)` con le sole eccezioni di bind e ingresso su `localhost`, `(deny file-write*)`, `(deny process-fork)`. Il profilo è `LOCAL_VOICE_SANDBOX_PROFILE` in `scripts/local-voice-service.mjs`.
- Ogni richiesta porta `X-MediFlow-Voice-Auth: <ms>.<nonce>.<hmac>`, con HMAC-SHA256 del segreto su `mediflow.local-voice.v1:request:<METODO> <percorso>:<ms>:<nonce>`; il servizio rifiuta firme sbagliate, orari oltre 30 secondi e nonce già visti. Ogni risposta firmata porta `X-MediFlow-Voice-Proof`, HMAC di `mediflow.local-voice.v1:response:<nonce>:<stato>`: il client scarta risposte senza prova, così un processo che occupasse la porta dopo la morte del servizio non riceve il segreto né viene creduto. Le richieste con `Origin`, `Sec-Fetch-Site` o `Sec-Fetch-Mode` (cioè partite da un browser) e quelle con `Host` diverso da `127.0.0.1:<porta>` sono rifiutate. Il browser quindi non parla mai col servizio: ci parla il server Web, con `lib/local-voice/client.mjs`.

### Messaggi

| Richiesta | Risposta |
|---|---|
| `GET /v1/status` | servizio, versione, formato audio, stato del modello (`missing`, `incomplete`, `ready`), sessione in corso (`id`, `subject`, `mode`, `state`) o `null` |
| `POST /v1/sessions` `{mode: "dictation" \| "visit", subject, vocabulary?}` | `201` con la fotografia della sessione; `409 session-active` se una sessione ha ancora testo da rivedere; `503 model-missing` |
| `GET /v1/sessions/{id}` | fotografia |
| `POST /v1/sessions/{id}/commands` `{command: "start" \| "pause" \| "resume" \| "stop"}` | `202` con la fotografia; `409 not-allowed` se la macchina non ammette il comando nello stato corrente |
| `POST /v1/sessions/{id}/audio` (PCM s16le, mono, 16 kHz, al massimo 1 MiB) | `202` con campioni accettati e in attesa; `429 backlog` oltre 120 secondi di audio in attesa; `409 paused` o `not-recording` |
| `DELETE /v1/sessions/{id}` | `204`: sessione annullata, testo azzerato, motore rilasciato |

`subject` è un identificativo opaco scelto dal Web (lettere, cifre, `. _ : -`, al massimo 128 caratteri): il servizio non sa di quale paziente si tratti e lo restituisce in ogni fotografia. `vocabulary` sono i nomi dei farmaci del paziente (al massimo 200): orientano whisper e producono i suggerimenti in revisione.

La fotografia contiene `state`, `fault`, `visible`, `elapsedMs`, `limitReached`, `allowed`, `acceptedSamples`, `pendingSamples`, `live` (testo confermato e provvisorio, solo mentre si registra, mai trasferibile) e `review` (solo negli stati da rivedere: `text`, `lines` con `speaker`, `text`, `startMs`, `endMs`, e `drugSuggestions` con offset UTF-16).

### Stati

La macchina è quella di GPUI (PR #964-#968, `engine/src/recording.rs`), invariata: `ready` (Disclosure), `preparing`, `recording`, `paused`, `finalizing`, `review`, `cancelled`, `error`. Il servizio aggiunge tre regole sul confine:

1. **Nessun audio perso.** Il servizio non scarta mai audio arrivato: oltre 120 secondi in attesa risponde `429` e il client ritenta gli stessi byte. `pause` e `stop` aspettano che l'audio già arrivato sia trascritto (al massimo 120 secondi) prima di arrivare alla macchina, che alla pausa e alla fine legge un solo blocco.
2. **Nessuna bozza sul paziente sbagliato.** Una sessione con testo da rivedere (`review`, oppure `error` con `audio-lost` o `permission-denied`) blocca la creazione di un'altra finché il Web non la scarta con `DELETE`. Il Web confronta `subject` con il paziente o la prima visita aperta prima di preparare una bozza.
3. **Audio che smette di arrivare** (pagina chiusa, rete del browser ferma): dopo 2 secondi senza audio in registrazione la sessione va in `error` con `audio-lost` e il testo fin lì resta da rivedere; senza alcun audio entro 15 secondi dall'avvio va in `error` con `audio-missing`.

### Errori

`fault`: `model-missing`, `model-invalid` (file presenti ma con SHA-256 diverso, scoperto all'avvio), `audio-missing`, `audio-lost`, `engine-failed` (testo non conservato), `permission-denied`, `unsupported`. Le risposte di errore sono `{error: <codice>}`. Il servizio spento si vede come connessione rifiutata (`LocalVoiceError` con codice `unreachable`); una risposta senza prova valida come `identity`.

### Limiti

60 minuti di registrazione o 80.000 caratteri di trascrizione (il motore si ferma da solo e `limitReached` diventa vero); testo da rivedere al massimo 120.000 caratteri e 256 KiB; 1 MiB per richiesta; 16 connessioni contemporanee; una sola sessione per servizio.

### Dove vivono audio e testo

Solo nella memoria del servizio, in buffer azzerati dopo l'uso (`zeroize`): l'audio fino alla trascrizione della frase, il testo fino a `DELETE`, a una nuova sessione dopo la fine o all'uscita del servizio. Nessun file: il profilo Seatbelt nega ogni scrittura su disco. Come in GPUI, il testo trascritto non si salva da solo; la bozza nasce solo dal gesto del medico nel Web. I modelli si leggono dalla cartella installata da GPUI (`~/Library/Application Support/MediFlow GPUI/modelli-voce`) o da `MEDIFLOW_LOCAL_VOICE_MODELS`.

### Modello assente o servizio spento

Con il modello assente il servizio parte e risponde `model: "missing"`; la creazione di una sessione risponde `503 model-missing`. Il servizio non scarica nulla: l'installazione del modello resta oggi in GPUI e passerà al launcher (giro successivo). Con il servizio spento il Web lo dice e non offre la registrazione locale. Fuori da macOS il servizio non parte (uscita 3).

## Conseguenze

- GPUI usa il motore estratto con una riga (`pub(crate) use mediflow_local_voice::*;`) e il collegamento della libreria Swift; il comportamento resta quello provato, con i suoi test spostati nel pacchetto nuovo.
- La prova `scripts/prove-ascolto-visita.mjs` passa ora dal servizio: avvia `mediflow-voice`, gli manda la visita sintetica di oltre dieci minuti e misura attribuzione, errore di parola e velocità.
- Il kit delle visite registra ancora con whisper per conto suo; riunire le due strade richiede che il kit parli con questo servizio (Quaderno).
- La cattura del microfono e il motore su Windows e Linux restano da fare in un giro dedicato.
