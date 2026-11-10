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
| Vista | `app/src/shell/local_voice.rs` | Mostra durante la registrazione il provvisorio a matita e il confermato in grigio; Review e trasferimento invariati. |

whisper.cpp gira con GPU e flash attention accese, come nel banco (`whisper-rs` la spegne per impostazione;
un test fissa i due parametri). whisper.cpp arriva dal crate `whisper-rs-sys 0.15.0` (whisper.cpp 1.8.3, compilato con CMake, Metal con
shader incorporati) tramite `whisper-rs 0.16.0`, con versione e checksum fissati nel `Cargo.lock`. La dipendenza
è dichiarata solo per `target_os = "macos"`: Windows e Linux non la scaricano né la compilano. Il banco ha misurato
whisper.cpp 1.9.5. **L'app usa whisper.cpp 1.8.3**, quella inclusa in `whisper-rs`: la prova P2 qui sotto misura la
1.8.3, non la versione del banco.

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
5. Il thread pubblica in un `Mutex` lo stato, il testo confermato e il provvisorio; la vista li legge a ogni
   ridisegno e ridisegna quando cambia il contenuto (non la lunghezza: una parola rivista può avere la stessa).
6. «Termina e trascrivi» manda `Stop`: la cattura si ferma, l'ultima frase diventa definitiva, lo stato passa a
   Review con il testo definitivo. Scarta, chiusura o cambio di paziente mandano `Cancel` e tornano subito: l'interfaccia non aspetta il thread, che
   può essere fermo sulla verifica del modello, sul caricamento o su una decodifica. Il testo pubblicato si azzera
   subito; il thread, finito il passo in corso, azzera i buffer audio, chiude e non pubblica più nulla.

L'audio sta in buffer preallocati (`Zeroizing`), mai riallocati: frase in corso fino a 20 s, circa 1 s di contesto
per il rilevatore, buffer del ponte di 30 s. Ogni frase chiusa, l'annullamento e la fine azzerano i campioni.
Il rilevatore di whisper.cpp riparte da zero a ogni chiamata: gli si ripassa 1 s di contesto (31 finestre), circa
50 finestre ogni 0,5 s sulla CPU. I log di whisper.cpp sono spenti.

## Testo mentre si parla

Le parole dei parziali cambiano circa 400 volte ogni 100 parole finali. Si mostrano due inchiostri, nessuno dei due
modificabile o trasferibile, fuori da ogni campo di testo:

- **testo provvisorio**: l'ultimo parziale oltre il prefisso confermato, mostrato subito, a matita (il token
  `pencil`, lo stesso inchiostro della «Proposta»: un tono più chiaro nei due registri);
- **testo confermato**: le frasi definitive e il prefisso che due parziali consecutivi concordano, nel grigio della
  vista (`secondary`). Le parole si confrontano senza maiuscole e punteggiatura; il confermato non torna mai
  indietro, un parziale successivo non lo cambia.

Alla chiusura della frase il provvisorio sparisce e il definitivo entra nel testo da rivedere. `transcript()`
restituisce testo solo in Review, come prima: il provvisorio non è mai trasferibile e in Review entra solo come
parte del definitivo della sua frase. La fine della trascrizione non apre il compositore e non scrive nulla.
Nessuna stringa nuova: il colore distingue i due inchiostri, il testo stesso è l'etichetta.

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
| Recording | invariato, più il testo provvisorio a matita e quello confermato in grigio |
| Unavailable, modello alterato | «Il modello vocale locale è incompleto o diverso da quello atteso. Reinstallalo da Impostazioni, Voce locale.» |
| Unavailable, motore o cattura interrotti | «La dettatura locale si è interrotta e il testo non è stato conservato. Apri una nuova dettatura.» |
| Unavailable, motore Apple senza modello | messaggio di oggi più l'indicazione di installare il modello vocale locale da Impostazioni, Voce locale |

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
- **Installazione** solo dal pulsante «Installa» di Impostazioni, Voce locale (solo macOS). Prima del clic la
  pagina legge soltanto il disco e dice peso (0,57 GB) e host (`huggingface.co`); nessuna connessione parte prima del
  gesto. Lo scaricamento gira sul thread `mediflow-voce-installazione` con il `curl` di sistema (solo HTTPS, anche
  nei redirect, URL fissati, timeout di connessione 30 s, interruzione sotto 1 kB/s per 60 s); ogni file si scarica
  in `NOME.parziale` e si verifica; i file diventano definitivi solo insieme, rinominati quando sono tutti
  verificati e nessuno ha annullato. Quelli già buoni restano e non si riscaricano. «Annulla» torna subito: il
  thread ferma `curl` entro 20 ms e cancella i parziali. Errore, hash diverso o annullamento, anche a metà del
  secondo file, non lasciano file nuovi. All'uscita dall'app (Cmd-Q) il gestore d'uscita ferma il `curl` (SIGKILL
  al suo PID e `wait`) e toglie i parziali in pochi millisecondi, dentro i 200 ms che GPUI concede; all'avvio un
  parziale rimasto da un'uscita brusca si toglie. Un secondo clic non avvia un secondo scaricamento. «Rimuovi» toglie i file e la dettatura torna alla trascrizione Apple. Il comando
  `--installa-modello-voce` della prima fetta è stato tolto: il pulsante è l'unico percorso.
- **Uscite di rete**: `network.mode` governa la LAN e non autorizza Internet (ADR 0125); vale l'interruttore
  `MEDIFLOW_NETWORK_DISABLED` (presente e diverso da `0`), ricontrollato prima di ogni richiesta: con le uscite
  disattivate il pulsante è spento e la pagina dice perché.
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
Eddy, lenta, degradata) e la seduta lunga `s1` (570 s, 31 battute) entrano dalla stessa sorgente del microfono e
dallo stesso ciclo `listen`, a ritmo reale, con 2 s di silenzio in coda ai file. Il modo di riferimento sono i pezzi
da 85 ms, come li consegna il tap del microfono; i blocchi da 0,5 s restano come confronto. WER con la
normalizzazione del banco. Per ogni frase del riferimento, con le definizioni di `latenze` del banco: **primo
parziale** (primo testo a schermo, provvisorio o confermato) dall'inizio della frase, soglia 1,5 s di mediana;
**primo confermato** (prefisso concordato o definitivo), senza soglia; **definitivo** dalla fine della frase, soglia
1,0 s di mediana. Carico medio a un minuto (`vm.loadavg`) campionato ogni 15 s.

### Esito sull'ultimo codice (head della PR)

| Misura | Carico medio | WER app / banco | Primo parziale, mediana (peggiore) | Primo confermato | Definitivo |
|---|---|---|---|---|---|
| 12 file, pezzi da 85 ms | 4,0 | 9,5% / 9,5% | **0,84 s** (0,95) | 2,29 s (5,27) | **0,95 s** (1,11) |
| seduta s1, pezzi da 85 ms | 2,5 | 6,5% (banco 7,5%) | **0,78 s** (1,06) | 1,48 s (2,47) | **0,97 s** (1,13) |
| 12 file, blocchi da 0,5 s (confronto) | 1,5 | 9,5% / 9,5% | 1,25 s (1,27) | 2,25 s (2,76) | 1,10 s (1,42) |

Seduta lunga: **zero frasi inventate nei silenzi**, 31 frasi definitive per 31 battute. Con i pezzi del microfono
le due soglie di mediana sono rispettate sui file e sulla seduta; a blocchi da 0,5 s il definitivo resta oltre il
secondo perché la chiusura della frase aspetta il blocco.

### Tutte le misure, in ordine

Nessuna misura è stata ripetuta a parità di codice per sceglierne una; ogni riga cambia il codice o il modo di
misura, e il motivo è scritto. «-» = non misurato in quella versione dello strumento.

| # | Ora | Che cosa cambia rispetto alla precedente, e perché | Carico medio | Primo parziale | Primo confermato | Definitivo |
|---|---|---|---|---|---|---|
| 1 | 06:00 | primo codice: rilevatore solo a blocchi interi, accordo esatto con la punteggiatura; blocchi da 0,5 s | non registrato, circa 35 (altra lane) | - | 2,27 s (3,27) | 1,13 s (1,43) |
| 2a | 06:08 | rilevatore su ogni campione, parziale sulla griglia da 0,5 s, accordo senza maiuscole e punteggiatura (il primo testo arrivava tardi); blocchi da 0,5 s | circa 35 | - | 2,27 s (3,78) | 1,12 s (1,43) |
| 2b | 06:12 | stesso codice di 2a, pezzi da 85 ms come il microfono | circa 35 | - | 2,32 s (5,34) | 1,00 s (1,25) |
| 3 | 06:33 | due inchiostri (scelta b) e tempi per frase; seduta a ritmo reale (prima era a velocità 4, che gonfiava i tempi) | 3,3 file; 2,8 seduta | 0,87 s (0,90); seduta 0,80 s (1,07) | 2,33 s (5,31); seduta 1,50 s (3,16) | 1,01 s (1,18); seduta 1,01 s (1,19) |
| 4 | 06:58 | silenzio contato come in sherpa-onnx del banco (anche fra 0,35 e 0,5) | 4,3 file; 14,0 seduta | 0,88 s (0,90); seduta 0,86 s (1,07) | 2,34 s (5,31); seduta 1,50 s (3,16) | 1,02 s (1,29); seduta 1,02 s (1,45) |
| 5 | 07:15 | flash attention accesa come nel banco: senza, una decodifica della frase prendeva circa 0,28 s contro 0,15 s di mediana nel banco (tempo dopo la modifica non misurato a parte) | 4,0 | 0,84 s (0,95) | 2,29 s (5,27) | 0,95 s (1,11) |
| 5b | 08:02 | stesso codice di 5 integrato con `main`; seduta e blocchi, interrotti dalla fine della sessione nella 5 | 2,5 seduta; 1,5 blocchi | seduta 0,78 s (1,06) | seduta 1,48 s (2,47) | seduta 0,97 s (1,13) |

Righe 3-5b: pezzi da 85 ms salvo dove indicato; i blocchi da 0,5 s delle misure 3 e 4 (definitivo 1,19 s e 1,13 s)
sono nei dati grezzi. Un tentativo alle 06:54 non ha prodotto numeri (percorso del modello sbagliato nello script).
Le misure 1 e 2 sono state prese sotto il carico di un'altra lane; la 3, a macchina scarica, dà quasi gli stessi
tempi: la decodifica sta sulla GPU e il carico della CPU pesa poco. La differenza vera l'ha fatta la flash attention.

- **WER**: entro 3 punti dal banco. Fino alla misura 4 `d09` aveva due errori in più (10,2% contro 9,5%); con la
  flash attention, come nel banco, gli errori coincidono su tutti i file.
- **Primo testo confermato**: whisper cambia le prime parole fra un parziale e l'altro («pazienti», «paziente di
  80», «di 84», «il paziente di 84 anni», «paciente…»), quindi il confermato arriva in mediana dopo 1,5-2,3 s. Per
  questo si mostra subito il provvisorio.
- **whisper.cpp 1.8.3 contro 1.9.5**: l'app usa la 1.8.3 di `whisper-rs`, il banco la 1.9.5. Con gli stessi
  parametri del banco (flash attention accesa) WER e tempi coincidono con quelli del banco entro i limiti sopra.

## Attribuzioni

Aggiunte al `NOTICE` del pilota, che il pacchetto macOS copia fra le licenze: whisper.cpp 1.8.3 (MIT, The ggml
authors), whisper-rs 0.16.0 (Unlicense), pesi whisper large-v3-turbo (MIT, OpenAI) con conversione ggml del progetto
whisper.cpp, Silero VAD (MIT, Silero Team) con conversione ggml. I testi di licenza dei crate (whisper.cpp incluso,
dentro `whisper-rs-sys`) li raccoglie già `bundle_macos.py`: verificato su 470 pacchetti per `aarch64-apple-darwin`.

## Scelte fatte

- **Testo mentre si parla** (domanda 0 della prima versione): provvisorio a matita subito, confermato in grigio
  quando due parziali concordano. Scelta di Leonardo del 10 novembre; da giudicare con la sua voce nella seconda
  seduta.
- **Installazione del modello** (domanda 2): pulsante in «Impostazioni, Voce locale», come per il catalogo AIFA, in
  una fetta successiva. Fatto: la pagina Impostazioni, Voce locale ha sostituito il comando `--installa-modello-voce`.

## Domande per Leonardo

1. **Due motori o uno.** Proposta: tenere il motore Apple solo come ripiego per chi non installa il modello, per
   una release, e toglierlo nella 0.9.2 se la seconda seduta con la tua voce conferma whisper. Toglierlo subito
   semplifica il ponte Swift (meno 600 righe condivise col client Apple) ma lascia senza voce chi non scarica 0,58 GB.
2. **Aiuto sui farmaci in Review** descritto sopra: lo vuoi nella prossima fetta?
3. **Tetto del testo.** `reviewed_text` accetta 12.000 caratteri: per una dettatura bastano, per l'ascolto
   ambientale di una visita intera no. Consegna a pezzi o tetto più alto?
