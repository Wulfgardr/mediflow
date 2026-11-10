# Dettatura locale con whisper in GPUI (C-9a, prima fetta)

Nota di progetto della lane voce, 10 novembre 2026. Attua la riga C-9a del
contratto 0.9.1 e l'emendamento del 9 novembre: la 0.9.1 aspetta la voce con
un modello locale integrato. Il motore scelto dalla misura su dieci motori è
**whisper large-v3-turbo q5_0 con whisper.cpp** (MIT, 0,57 GB), con il
rilevatore di voce **Silero** obbligatorio.

## Componenti

| Parte | Dove | Che cosa fa |
|---|---|---|
| Cattura | `app/src/local_voice/bridge.swift`, classe `WhisperVoiceCapture` | Microfono con `AVAudioEngine`, conversione a 16 kHz mono Float32, campioni in un buffer preallocato di 30 s protetto da lock. Nessun file audio. |
| Ciclo di ascolto | `app/src/local_voice/listening.rs` | Rilevatore di voce finestra per finestra (512 campioni), frase aperta e chiusa dal rilevatore, parziale sulla griglia da 0,5 s, definitivo alla chiusura, accordo locale dei parziali. Codice puro, provato senza modello. |
| Motore | `app/src/local_voice/whisper.rs` | `WhisperDecoder` (whisper.cpp con Metal) e `SileroDetector` (Silero VAD di whisper.cpp, sulla CPU) dietro le due interfacce del ciclo; thread di lavoro; sorgente audio Swift. |
| Modello | `app/src/local_voice/model.rs` | Nomi, URL con revisione fissata, SHA-256 e dimensione dei due file; verifica; installazione esplicita. |
| Sessione | `app/src/local_voice/mod.rs` | Sceglie il motore, espone gli stati di sempre e i messaggi del motore in uso. |
| Vista | `app/src/shell/local_voice.rs` | Mostra in grigio il testo stabile durante la registrazione; Review e trasferimento invariati. |

whisper.cpp arriva dal crate `whisper-rs-sys 0.15.0` (whisper.cpp 1.8.3, compilato con CMake, Metal con
shader incorporati) tramite `whisper-rs 0.16.0`, con versione e checksum fissati nel `Cargo.lock`. La dipendenza
è dichiarata solo per `target_os = "macos"`: Windows e Linux non la scaricano né la compilano. Il banco ha misurato
whisper.cpp 1.9.5; la prova P2 qui sotto misura la 1.8.3 inclusa nel crate.

## Thread e percorso dell'audio

1. Il gesto «Consenti e avvia» manda `Start` al thread di lavoro `mediflow-voce-locale`.
2. Il thread verifica dimensione e SHA-256 dei due file (stato Preparing), carica whisper e Silero, poi avvia la
   cattura Swift. Il permesso del microfono usa la stessa richiesta del motore Apple
   (`AVAudioApplication.requestRecordPermission`); il flusso dei permessi esistente non cambia.
3. Il tap di `AVAudioEngine` consegna circa 85 ms alla volta; Swift converte a 16 kHz e accoda.
4. Ogni 20 ms il thread legge i campioni arrivati (`MFVoiceCaptureRead`) e li passa al ciclo: il rilevatore li
   guarda tutti; una frase chiusa (0,5 s di silenzio, o 20 s di durata) si decodifica subito e si accoda al testo
   da rivedere; la frase aperta si ridecodifica a ogni passo della griglia da 0,5 s, un solo parziale sull'audio più
   recente.
5. Il thread pubblica in un `Mutex` lo stato e il testo stabile; la vista lo legge a ogni ridisegno e ridisegna solo
   quando il testo stabile cambia.
6. «Termina e trascrivi» manda `Stop`: la cattura si ferma, l'ultima frase diventa definitiva, lo stato passa a
   Review con il testo definitivo. Scarta o chiusura mandano `Cancel`: audio e testo si azzerano.

L'audio sta in buffer preallocati (`Zeroizing`), mai riallocati: frase in corso fino a 20 s, circa 1 s di contesto
per il rilevatore, buffer del ponte di 30 s. Ogni frase chiusa, l'annullamento e la fine azzerano i campioni.
Il rilevatore di whisper.cpp riparte da zero a ogni chiamata: gli si ripassa 1 s di contesto (31 finestre), circa
50 finestre ogni 0,5 s sulla CPU. I log di whisper.cpp sono spenti.

## Testo mentre si parla

Le parole dei parziali cambiano circa 400 volte ogni 100 parole finali. A schermo va solo il prefisso che due parziali
consecutivi confermano (accordo locale): le parole si confrontano senza maiuscole e punteggiatura, il prefisso
mostrato non arretra, il definitivo lo sostituisce alla chiusura della frase. Il testo è in grigio, fuori da ogni
campo di testo, non modificabile e non trasferibile: `transcript()` restituisce testo solo in Review, come prima.
La fine della trascrizione non apre il compositore e non scrive nulla.

## Vocabolario

Il prompt iniziale contiene i nomi dei farmaci e i principi attivi delle terapie del paziente aperto, senza
doppioni, fino a 600 caratteri (whisper tiene circa 220 token). Il prompt resta nel processo e si azzera con la
sessione. Nessuna parola trascritta viene sostituita con un nome di catalogo.

Aiuto proposto per Review, non costruito: sottolineare le parole che somigliano a un farmaco delle terapie del
paziente ma non coincidono (per esempio «Ramipli» accanto a «Ramipril»), con la correzione offerta come gesto del
medico, mai applicata da sola.

## Stati e messaggi

Gli stati restano quelli di oggi. Cambiano solo i messaggi diventati falsi con whisper.

| Stato | Messaggio con whisper |
|---|---|
| Disclosure | invariato: «L'audio viene trascritto sul Mac…» |
| Preparing | «Verifica del permesso microfono e del modello vocale locale…» |
| Recording | invariato, più il testo stabile in grigio |
| Unavailable, modello alterato | «Il modello vocale locale è incompleto o diverso da quello atteso. Reinstallalo avviando MediFlow GPUI con --installa-modello-voce.» |
| Unavailable, motore o cattura interrotti | «La dettatura locale si è interrotta e il testo non è stato conservato. Apri una nuova dettatura.» |
| Unavailable, motore Apple senza modello | messaggio di oggi più l'indicazione di installare il modello vocale locale |

## Dove sta il modello e come si verifica

Cartella: `~/Library/Application Support/MediFlow GPUI/modelli-voce/`, accanto alle preferenze GPUI.

| File | Byte | SHA-256 | Revisione Hugging Face |
|---|---|---|---|
| `ggml-large-v3-turbo-q5_0.bin` | 574.041.195 | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` | `ggerganov/whisper.cpp@5359861c739e955e79d9a303bcbc70fb988958b1` |
| `ggml-silero-v6.2.0.bin` | 885.098 | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` | `ggml-org/whisper-vad@9ffd54a1e1ee413ddf265af9913beaf518d1639b` |

Gli hash coincidono con l'oid LFS di Hugging Face e con `motori/INVENTARIO.md` del banco.

- **Scelta del motore** all'apertura della dettatura, con un controllo rapido di presenza e dimensione: cartella
  vuota, motore Apple come oggi; almeno un file presente, whisper.
- **Verifica completa** dello SHA-256 nel thread di lavoro a ogni avvio (Preparing). Un file mancante, troncato o
  con hash diverso dà Unavailable con il messaggio che dice come reinstallarlo.
- **Installazione** solo con il comando esplicito `mediflow-gpui-patient-pilot --installa-modello-voce`: `curl` di
  sistema, solo HTTPS, URL fissati; ogni file si scarica in `NOME.parziale`, si verifica e solo allora si rinomina;
  se l'hash non coincide il file si cancella. In questa fetta non c'è la pagina «Impostazioni, Voce locale» con il
  pulsante: il comando la sostituisce finché Leonardo non sceglie dove metterla.
- Nessun file di modello nel repository o nel pacchetto. Il rilevatore Silero (885 kB) si installa con il modello;
  le prove in CI usano un rilevatore finto.

## Peso e tempi

- **Binario macOS**: le librerie statiche di whisper.cpp e ggml (Metal con shader incorporati, CPU, BLAS di
  Accelerate) pesano 2,7 MB senza simboli di debug; è il limite superiore di ciò che entra nel binario. Non ho
  rifatto la build release completa per misurare il binario finito.
- **Compilazione**: whisper.cpp più i binding da zero in 34 s su questo Mac con 6 job. Sul runner macOS della CI
  (meno core) mi aspetto uno o due minuti in più sul job macOS; Windows e Linux invariati, non risolvono la
  dipendenza (`cargo metadata --filter-platform` lo conferma). Serve `cmake`, presente sui runner macOS; `bindgen`
  usa il libclang di Xcode e, se manca, i binding inclusi nel crate.
- **Memoria in uso**: il banco misura circa 0,9 GB di picco con il modello caricato. La sessione carica il modello
  all'avvio della dettatura e lo libera alla chiusura.

## Misure con il modello (P2)

Test ignorato in CI `real_model_on_bench_files_through_the_microphone_path`: 12 WAV del banco (`d01`-`d12`, voce
Eddy, lenta, degradata) entrano dalla stessa sorgente del microfono e dallo stesso ciclo `listen`, a ritmo reale,
con 2 s di silenzio in coda. WER con la normalizzazione del banco; tempi rispetto a inizio e fine del parlato.

| Variante | WER app | WER banco | Primo testo stabile, mediana (max) | Definitivo, mediana (max) |
|---|---|---|---|---|
| pezzi da 85 ms, come il tap del microfono | 10,2% (31/304) | 9,5% (29/304) | 2,32 s (5,34 s) | 1,00 s (1,25 s) |
| blocchi da 0,5 s | 10,2% | 9,5% | 2,27 s (3,78 s) | 1,12 s (1,43 s) |

Seduta lunga `s1` (570 s, velocità 4, pezzi da 85 ms): 31 frasi definitive, **zero frasi inventate nei silenzi**,
WER 6,5% (banco 7,5%).

- **WER**: entro 3 punti dal banco (0,7 punti). Undici file su dodici hanno gli stessi errori; `d09` ne ha due in
  più (whisper.cpp 1.8.3 contro 1.9.5 del banco).
- **Definitivo**: la mediana sta alla soglia di 1,0 s solo se il rilevatore vede l'audio a pezzi piccoli, come
  arriva dal microfono; a blocchi da 0,5 s la chiusura della frase aspetta il blocco e si perde un quarto di secondo.
- **Primo testo stabile: la soglia di 1,5 s non è rispettata.** Il primo parziale arriva come nel banco (circa
  0,6 s), ma whisper cambia le prime parole fra un parziale e l'altro («pazienti», «paziente di 80», «di 84», «il
  paziente di 84 anni», «paciente…»): con la regola dell'accordo fra due parziali consecutivi il testo compare solo
  quando l'inizio smette di cambiare, in mediana dopo 2,3 s. Il banco misurava il primo parziale, non il primo testo
  stabile. Le strade sono nelle domande qui sotto.

## Attribuzioni

Aggiunte al `NOTICE` del pilota, che il pacchetto macOS copia fra le licenze: whisper.cpp 1.8.3 (MIT, The ggml
authors), whisper-rs 0.16.0 (Unlicense), pesi whisper large-v3-turbo (MIT, OpenAI) con conversione ggml del progetto
whisper.cpp, Silero VAD (MIT, Silero Team) con conversione ggml. I testi di licenza dei crate (whisper.cpp incluso,
dentro `whisper-rs-sys`) li raccoglie già `bundle_macos.py`: verificato su 470 pacchetti per `aarch64-apple-darwin`.

## Domande per Leonardo

0. **Primo testo stabile.** Con la regola di oggi compare in mediana dopo 2,3 s. Tre strade: (a) accettare il
   ritardo, il testo comunque non lampeggia; (b) mostrare subito il primo parziale in un grigio più chiaro e
   fissarlo quando due parziali concordano; (c) accordo fra il parziale nuovo e uno qualsiasi dei due precedenti
   (più rapido, un po' meno stabile). Proposta: (b), da misurare con la tua voce nella seconda seduta.

1. **Due motori o uno.** Proposta: tenere il motore Apple solo come ripiego per chi non installa il modello, per
   una release, e toglierlo nella 0.9.2 se la seconda seduta con la tua voce conferma whisper. Toglierlo subito
   semplifica il ponte Swift (meno 600 righe condivise col client Apple) ma lascia senza voce chi non scarica 0,58 GB.
2. **Dove si installa il modello.** Pulsante in «Impostazioni, Voce locale» come per il catalogo AIFA (ADR 0125),
   oppure modello dentro il pacchetto firmato (0,58 GB in più per tutti). Proposta: il pulsante.
3. **Aiuto sui farmaci in Review** descritto sopra: lo vuoi nella prossima fetta?
4. **Tetto del testo.** `reviewed_text` accetta 12.000 caratteri: per una dettatura bastano, per l'ascolto
   ambientale di una visita intera no. Consegna a pezzi o tetto più alto?
