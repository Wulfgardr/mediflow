//! Motore whisper.cpp (Metal) con rilevatore Silero, in un thread di lavoro.
//! Il ponte Swift cattura il microfono e consegna blocchi a 16 kHz; il thread
//! li legge, li passa al ciclo di ascolto e pubblica solo il testo stabile.

use super::listening::{Decoder, Dictation, EngineFailure, Segment, SpeechDetector};
use super::model::{self, ModelFile, ModelStatus};
use super::recording::Machine;
use super::voices::{self, Speaker};
use super::{Event, State};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
    WhisperVadContext, WhisperVadContextParams,
};
use zeroize::{Zeroize, Zeroizing};

/// Whisper tiene circa 220 token di prompt: con i nomi dei farmaci italiani
/// 600 caratteri restano sotto il limite.
const PROMPT_CHARACTERS: usize = 600;

/// Prompt iniziale con i nomi dei farmaci delle terapie del paziente aperto.
/// Nessuna sostituzione successiva: il prompt orienta il modello e basta.
pub(crate) fn vocabulary_prompt<'a>(names: impl IntoIterator<Item = &'a str>) -> Zeroizing<String> {
    let mut prompt = Zeroizing::new(String::new());
    let mut seen: Vec<String> = Vec::new();
    for name in names {
        let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
        if name.is_empty() || seen.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let extra = if prompt.is_empty() { 0 } else { 2 };
        if prompt.chars().count() + extra + name.chars().count() > PROMPT_CHARACTERS {
            break;
        }
        if !prompt.is_empty() {
            prompt.push_str(", ");
        }
        prompt.push_str(&name);
        seen.push(name);
    }
    seen.iter_mut().for_each(Zeroize::zeroize);
    prompt
}

/// Parametri del contesto come quelli del banco (whisper.cpp con i valori
/// predefiniti della libreria C): GPU e flash attention. `whisper-rs` spegne la
/// flash attention per impostazione, e la decodifica raddoppiava.
fn context_parameters() -> WhisperContextParameters<'static> {
    let mut parameters = WhisperContextParameters::default();
    parameters.use_gpu(true);
    parameters.flash_attn(true);
    parameters
}

pub(crate) struct WhisperDecoder {
    state: WhisperState,
    prompt: Zeroizing<String>,
}

impl WhisperDecoder {
    pub(crate) fn load(path: &Path, prompt: Zeroizing<String>) -> Result<Self, EngineFailure> {
        whisper_rs::install_logging_hooks();
        let context = WhisperContext::new_with_params(path, context_parameters())
            .map_err(|_| EngineFailure)?;
        let state = context.create_state().map_err(|_| EngineFailure)?;
        Ok(Self { state, prompt })
    }
}

impl Decoder for WhisperDecoder {
    fn decode(&mut self, audio: &[f32]) -> Result<Zeroizing<String>, EngineFailure> {
        // Come il banco: greedy, niente contesto fra frasi, almeno 1 s di audio.
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 5 });
        params.set_language(Some("it"));
        params.set_n_threads(4);
        params.set_no_context(true);
        params.set_no_timestamps(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        if !self.prompt.is_empty() {
            params.set_initial_prompt(&self.prompt);
        }
        let padded;
        let audio = if audio.len() < super::listening::SAMPLE_RATE {
            let mut buffer = Zeroizing::new(vec![0.0; super::listening::SAMPLE_RATE]);
            buffer[..audio.len()].copy_from_slice(audio);
            padded = buffer;
            &padded[..]
        } else {
            audio
        };
        self.state.full(params, audio).map_err(|_| EngineFailure)?;
        let mut text = Zeroizing::new(String::new());
        for segment in self.state.as_iter() {
            text.push_str(&segment.to_str_lossy().map_err(|_| EngineFailure)?);
        }
        Ok(Zeroizing::new(text.trim().to_owned()))
    }
}

pub(crate) struct SileroDetector {
    context: WhisperVadContext,
}

impl SileroDetector {
    pub(crate) fn load(path: &Path) -> Result<Self, EngineFailure> {
        whisper_rs::install_logging_hooks();
        let mut parameters = WhisperVadContextParams::new();
        parameters.set_n_threads(1);
        parameters.set_use_gpu(false);
        let context = WhisperVadContext::new(path.to_str().ok_or(EngineFailure)?, parameters)
            .map_err(|_| EngineFailure)?;
        Ok(Self { context })
    }
}

impl SpeechDetector for SileroDetector {
    fn probabilities(&mut self, samples: &[f32]) -> Result<Vec<f32>, EngineFailure> {
        self.context
            .detect_speech(samples)
            .map_err(|_| EngineFailure)?;
        Ok(self.context.probabilities().to_vec())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourcePhase {
    Starting,
    Running,
    PermissionDenied,
    Failed,
    Stopped,
}

/// Sorgente dei blocchi audio: il microfono tramite il ponte Swift, oppure,
/// nelle prove, file letti da disco e iniettati a blocchi da 0,5 s.
pub(crate) trait AudioSource: Send {
    fn start(&mut self);
    fn phase(&mut self) -> SourcePhase;
    /// Aggiunge a `out` i campioni a 16 kHz arrivati dall'ultima lettura.
    fn read(&mut self, out: &mut Vec<f32>);
    /// Chiude il microfono per la pausa: nessun campione finché non riprende.
    fn pause(&mut self);
    /// Riapre il microfono dopo la pausa.
    fn resume(&mut self);
    fn stop(&mut self);
}

/// Microfono aperto che non consegna audio per questo tempo: è perso, e la
/// registrazione si ferma invece di restare «in registrazione» a vuoto. Il
/// microfono consegna un pezzo ogni 85 ms circa.
pub(crate) const STALL: Duration = Duration::from_secs(2);

#[derive(Default)]
pub(crate) struct Shared {
    /// La sessione è stata ritirata: il thread finisce da solo e non pubblica più nulla.
    retired: bool,
    pub(crate) machine: Machine,
    pub(crate) stable: Zeroizing<String>,
    pub(crate) provisional: Zeroizing<String>,
    open_confirmed: usize,
    finals: usize,
    pub(crate) transcript: Option<Zeroizing<String>>,
    /// Frasi definitive con i loro tempi: pubblicate con il testo da rivedere.
    pub(crate) segments: Vec<Segment>,
    /// La registrazione si è fermata da sola alla durata massima.
    pub(crate) limit_reached: bool,
    /// Ascolto della visita: le frasi si attribuiscono a medico e paziente.
    pub(crate) two_voices: bool,
    /// Voce di ogni frase, nell'ordine di `segments`, con il testo da rivedere.
    pub(crate) speakers: Vec<Speaker>,
    /// Per le misure: millisecondi di ogni impronta e dell'attribuzione.
    #[cfg(test)]
    pub(crate) print_ms: Vec<f64>,
    #[cfg(test)]
    pub(crate) attribution_ms: f64,
    #[cfg(test)]
    windows: Vec<(usize, usize, usize)>,
    /// Per le prove: massimo di campioni audio trattenuti dal ciclo.
    #[cfg(test)]
    pub(crate) max_retained: usize,
    /// Per le prove: campioni rimasti nel ciclo dopo l'annullamento.
    #[cfg(test)]
    pub(crate) retained_after_cancel: Option<usize>,
    /// Per le prove: pause la cui ultima frase è già trascritta.
    #[cfg(test)]
    pub(crate) pauses_flushed: usize,
}

pub(crate) struct Engine {
    pub(crate) directory: PathBuf,
    pub(crate) files: [&'static ModelFile; 2],
    pub(crate) prompt: Zeroizing<String>,
    /// In produzione [`load_whisper`]; nelle prove un motore finto sugli
    /// stessi file verificati.
    pub(crate) load: Loader,
}

/// Ciclo di ascolto con rilevatore e decodificatore già caricati.
pub(crate) type Listener = Box<dyn FnOnce(&mut dyn AudioSource, &Receiver<Event>, &Mutex<Shared>)>;
/// Carica il motore dai file della cartella, dopo la verifica dello SHA-256.
pub(crate) type Loader =
    fn(&Path, &[&'static ModelFile; 2], Zeroizing<String>) -> Result<Listener, EngineFailure>;

/// whisper.cpp con Metal e Silero sulla CPU.
pub(crate) fn load_whisper(
    directory: &Path,
    files: &[&'static ModelFile; 2],
    prompt: Zeroizing<String>,
) -> Result<Listener, EngineFailure> {
    let detector = SileroDetector::load(&directory.join(files[1].name))?;
    let decoder = WhisperDecoder::load(&directory.join(files[0].name), prompt)?;
    let dictation = Dictation::new(detector, decoder);
    Ok(Box::new(move |source, commands, shared| {
        listen(dictation, source, commands, shared)
    }))
}

/// Per le prove: stato, lunghezza del provvisorio e del confermato della
/// frase aperta, definitivi e finestre (inizio, fine, parole).
#[cfg(test)]
pub(crate) type Snapshot = (State, usize, usize, usize, Vec<(usize, usize, usize)>);

/// Sessione di dettatura con whisper: comandi verso il thread di lavoro e
/// lettura dello stato pubblicato.
pub(crate) struct WhisperSession {
    shared: Arc<Mutex<Shared>>,
    commands: Sender<Event>,
    worker: Option<JoinHandle<()>>,
}

impl WhisperSession {
    pub(crate) fn new(engine: Engine, source: Box<dyn AudioSource>) -> Self {
        let shared = Arc::new(Mutex::new(Shared::default()));
        let (commands, receiver) = mpsc::channel();
        let worker_shared = shared.clone();
        let worker = std::thread::Builder::new()
            .name("mediflow-voce-locale".into())
            .spawn(move || run(engine, source, receiver, worker_shared))
            .ok();
        Self {
            shared,
            commands,
            worker,
        }
    }
    /// Comando del medico: il thread lo esegue solo se la macchina lo
    /// ammette nello stato in cui lo trova.
    pub(crate) fn send(&self, command: Event) {
        let _ = self.commands.send(command);
    }
    #[cfg(test)]
    pub(crate) fn start(&self) {
        self.send(Event::Start);
    }
    #[cfg(test)]
    pub(crate) fn stop(&self) {
        self.send(Event::Stop);
    }
    fn read<T>(&self, f: impl FnOnce(&Shared) -> T) -> Option<T> {
        self.shared.lock().ok().map(|s| f(&s))
    }
    pub(crate) fn machine(&self) -> Machine {
        let broken = Machine::failed(super::Fault::EngineFailed);
        if self.worker.is_none() {
            return broken;
        }
        self.read(|s| s.machine).unwrap_or(broken)
    }
    pub(crate) fn state(&self) -> State {
        self.machine().state()
    }
    /// Testo stabile mentre si parla: solo da mostrare, mai da trasferire.
    pub(crate) fn stable_text(&self) -> Zeroizing<String> {
        self.read(|s| Zeroizing::new(s.stable.as_str().to_owned()))
            .unwrap_or_default()
    }
    /// Testo provvisorio della frase in corso: solo da mostrare.
    pub(crate) fn provisional_text(&self) -> Zeroizing<String> {
        self.read(|s| Zeroizing::new(s.provisional.as_str().to_owned()))
            .unwrap_or_default()
    }
    /// Frasi con i loro tempi, solo con il testo da rivedere.
    #[cfg(test)]
    pub(crate) fn segments(&self) -> Vec<Segment> {
        self.read(|s| {
            if s.machine.state().reviewable() && s.transcript.is_some() {
                s.segments.clone()
            } else {
                Vec::new()
            }
        })
        .unwrap_or_default()
    }
    pub(crate) fn limit_reached(&self) -> bool {
        self.read(|s| s.limit_reached).unwrap_or(false)
    }
    /// Ascolto della visita a due voci; vale solo prima dell'avvio.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn set_two_voices(&self, two_voices: bool) {
        publish(&self.shared, |s| {
            if s.machine.state() == State::Disclosure {
                s.two_voices = two_voices;
            }
        });
    }
    /// Frasi attribuite a medico o paziente, solo con il testo da rivedere
    /// dell'ascolto a due voci.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn attributed(&self) -> Vec<(Speaker, Zeroizing<String>)> {
        self.read(|s| {
            if !(s.two_voices && s.machine.state().reviewable() && s.transcript.is_some()) {
                return Vec::new();
            }
            s.speakers
                .iter()
                .zip(&s.segments)
                .map(|(speaker, segment)| (*speaker, segment.text.clone()))
                .collect()
        })
        .unwrap_or_default()
    }
    pub(crate) fn transcript(&self) -> Option<Zeroizing<String>> {
        self.read(|s| {
            s.machine
                .state()
                .reviewable()
                .then(|| s.transcript.clone())
                .flatten()
        })
        .flatten()
    }
    /// Sessione di prova: rilevatore, decodificatore e sorgente dati dal test.
    #[cfg(test)]
    pub(crate) fn with_parts<V, D>(detector: V, decoder: D, source: Box<dyn AudioSource>) -> Self
    where
        V: SpeechDetector + Send + 'static,
        D: Decoder + Send + 'static,
    {
        Self::with_dictation(Dictation::new(detector, decoder), source)
    }
    /// Sessione di prova con una dettatura già configurata dal test.
    #[cfg(test)]
    pub(crate) fn with_dictation<V, D>(
        dictation: Dictation<V, D>,
        source: Box<dyn AudioSource>,
    ) -> Self
    where
        V: SpeechDetector + Send + 'static,
        D: Decoder + Send + 'static,
    {
        let shared = Arc::new(Mutex::new(Shared::default()));
        let (commands, receiver) = mpsc::channel();
        let worker_shared = shared.clone();
        let worker = std::thread::spawn(move || {
            let mut source = source;
            if !wait_for_start(&receiver, &worker_shared) {
                return;
            }
            listen(dictation, source.as_mut(), &receiver, &worker_shared);
        });
        Self {
            shared,
            commands,
            worker: Some(worker),
        }
    }
    #[cfg(test)]
    pub(crate) fn shared_for_test(&self) -> Arc<Mutex<Shared>> {
        self.shared.clone()
    }
    /// Stato pubblicato, per le misure delle prove.
    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> Snapshot {
        let s = self.shared.lock().unwrap();
        (
            s.machine.state(),
            s.provisional.len(),
            s.open_confirmed,
            s.finals,
            s.windows.clone(),
        )
    }
    /// Attende che il thread arrivi a uno stato finale (solo per le prove).
    #[cfg(test)]
    pub(crate) fn wait_for(&self, wanted: &[State]) -> State {
        for _ in 0..12_000 {
            let state = self.state();
            if wanted.contains(&state) {
                return state;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        self.state()
    }
}

/// Il ritiro torna subito: non aspetta il thread, che può essere fermo sulla
/// verifica del modello, sul caricamento o su una decodifica. Il thread vede
/// l'annullamento appena finisce il passo in corso, azzera i buffer e chiude;
/// da qui in poi non pubblica più testo.
impl Drop for WhisperSession {
    fn drop(&mut self) {
        if let Ok(mut s) = self.shared.lock() {
            s.retired = true;
            s.stable.zeroize();
            s.provisional.zeroize();
            s.transcript = None;
            for segment in &mut s.segments {
                segment.text.zeroize();
            }
            s.segments.clear();
            s.speakers.clear();
        }
        let _ = self.commands.send(Event::Cancel);
        drop(self.worker.take());
    }
}

fn retired(shared: &Mutex<Shared>) -> bool {
    shared.lock().map_or(true, |s| s.retired)
}

fn publish(shared: &Mutex<Shared>, f: impl FnOnce(&mut Shared)) {
    if let Ok(mut s) = shared.lock()
        && !s.retired
    {
        f(&mut s);
    }
}

/// Applica un evento alla macchina pubblicata. Un evento illegale nello
/// stato corrente non cambia nulla e restituisce `false`.
fn transition(shared: &Mutex<Shared>, event: Event) -> bool {
    let mut legal = false;
    publish(shared, |s| {
        legal = s.machine.apply(event, Instant::now()).is_ok()
    });
    legal
}

fn current(shared: &Mutex<Shared>) -> State {
    shared
        .lock()
        .map_or(State::Cancelled, |s| s.machine.state())
}

/// Passa allo stato d'errore o di scarto e butta ogni testo. Il thread esce
/// dopo: se l'evento non è ammesso, la sessione si chiude come scartata e non
/// resta mai in uno stato di registrazione senza nessuno che ascolti.
fn fail(shared: &Mutex<Shared>, event: Event) {
    publish(shared, |s| {
        let now = Instant::now();
        if s.machine.apply(event, now).is_err() {
            let _ = s.machine.apply(Event::Cancel, now);
        }
        s.stable.zeroize();
        s.provisional.zeroize();
        s.transcript = None;
        s.segments.clear();
        s.speakers.clear();
    });
}

/// Attende il gesto «Consenti e avvia». Pausa, ripresa e fine prima
/// dell'avvio sono illegali e si ignorano; l'annullamento chiude.
fn wait_for_start(commands: &Receiver<Event>, shared: &Mutex<Shared>) -> bool {
    loop {
        match commands.recv() {
            Ok(Event::Start) if transition(shared, Event::Start) => return true,
            Ok(Event::Cancel) | Err(_) => {
                fail(shared, Event::Cancel);
                return false;
            }
            Ok(_) => {}
        }
    }
}

fn run(
    engine: Engine,
    mut source: Box<dyn AudioSource>,
    commands: Receiver<Event>,
    shared: Arc<Mutex<Shared>>,
) {
    if !wait_for_start(&commands, &shared) {
        return;
    }
    if model::verify(&engine.directory, &engine.files) != ModelStatus::Verified {
        fail(&shared, Event::ModelInvalid);
        return;
    }
    if retired(&shared) {
        return;
    }
    let Ok(listener) = (engine.load)(&engine.directory, &engine.files, engine.prompt) else {
        fail(&shared, Event::EngineFailed);
        return;
    };
    if retired(&shared) {
        return;
    }
    listener(source.as_mut(), &commands, &shared);
}

/// Nell'ascolto a due voci, la voce di ogni frase definitiva.
fn attribute<V: SpeechDetector, D: Decoder>(
    shared: &Mutex<Shared>,
    dictation: &Dictation<V, D>,
) -> Vec<Speaker> {
    if !shared.lock().is_ok_and(|s| s.two_voices) {
        return Vec::new();
    }
    #[cfg(test)]
    let started = Instant::now();
    let prints: Vec<_> = dictation.segments().iter().map(|s| s.voice).collect();
    let speakers = voices::attribute(&prints);
    #[cfg(test)]
    {
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let print_ms = dictation.print_ms.clone();
        publish(shared, |s| {
            s.attribution_ms = elapsed;
            s.print_ms = print_ms;
        });
    }
    speakers
}

/// Oltre la durata massima l'audio non entra: si azzera e si scarta.
fn keep_room<V: SpeechDetector, D: Decoder>(blocks: &mut Vec<f32>, dictation: &Dictation<V, D>) {
    let room = dictation.room();
    if blocks.len() > room {
        blocks[room..].zeroize();
        blocks.truncate(room);
    }
}

/// Testo dal vivo della dettatura, pubblicato per la vista.
fn publish_live<V: SpeechDetector, D: Decoder>(
    shared: &Mutex<Shared>,
    dictation: &Dictation<V, D>,
) {
    let stable = dictation.confirmed_text();
    let provisional = dictation.provisional_text();
    let open_confirmed = dictation.open_confirmed_len();
    let finals = dictation.finals_count();
    publish(shared, |s| {
        s.stable = stable;
        s.provisional = provisional;
        s.open_confirmed = open_confirmed;
        s.finals = finals;
    });
}

/// Ciclo del thread: lo stesso per il microfono e per le prove su file.
///
/// La vista mostra lo stato della macchina, e la macchina segue il
/// microfono: in registrazione solo mentre arriva audio; in pausa e dopo la
/// fine il microfono è chiuso; se il microfono manca, si chiude o tace oltre
/// [`STALL`], la registrazione si ferma subito in errore.
pub(crate) fn listen<V: SpeechDetector, D: Decoder>(
    mut dictation: Dictation<V, D>,
    source: &mut dyn AudioSource,
    commands: &Receiver<Event>,
    shared: &Mutex<Shared>,
) {
    if matches!(commands.try_recv(), Ok(Event::Cancel)) {
        fail(shared, Event::Cancel);
        return;
    }
    if shared.lock().is_ok_and(|s| s.two_voices) {
        dictation.set_two_voices(true);
    }
    source.start();
    let mut blocks = Zeroizing::new(Vec::with_capacity(super::listening::MAX_UTTERANCE));
    let mut last_audio = Instant::now();
    let outcome = loop {
        let paused = current(shared) == State::Paused;
        let command = if paused {
            match commands.recv_timeout(Duration::from_millis(50)) {
                Ok(command) => Ok(command),
                Err(RecvTimeoutError::Timeout) => Err(TryRecvError::Empty),
                Err(RecvTimeoutError::Disconnected) => Err(TryRecvError::Disconnected),
            }
        } else {
            commands.try_recv()
        };
        match command {
            Ok(Event::Cancel) | Err(TryRecvError::Disconnected) => break Event::Cancel,
            Ok(Event::Stop) if shared.lock().is_ok_and(|s| s.machine.allows(Event::Stop)) => {
                break Event::Stop;
            }
            Ok(Event::Pause) if transition(shared, Event::Pause) => {
                // Il microfono si chiude al gesto; l'audio arrivato fin qui si
                // trascrive e la frase aperta diventa definitiva.
                source.pause();
                source.read(&mut blocks);
                keep_room(&mut blocks, &dictation);
                let flushed = dictation.feed(&blocks).and_then(|()| dictation.finish());
                blocks.zeroize();
                if flushed.is_err() {
                    break Event::EngineFailed;
                }
                publish_live(shared, &dictation);
                #[cfg(test)]
                publish(shared, |s| s.pauses_flushed += 1);
                continue;
            }
            Ok(Event::Resume) if transition(shared, Event::Resume) => {
                source.resume();
                last_audio = Instant::now();
                continue;
            }
            Ok(_) | Err(TryRecvError::Empty) => {}
        }
        if paused {
            continue;
        }
        match source.phase() {
            SourcePhase::Starting => {
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
            SourcePhase::PermissionDenied => break Event::PermissionDenied,
            SourcePhase::Failed => break Event::CaptureFailed,
            SourcePhase::Stopped => break Event::Stop,
            SourcePhase::Running => {}
        }
        if current(shared) == State::Preparing {
            transition(shared, Event::CaptureRunning);
            last_audio = Instant::now();
        }
        source.read(&mut blocks);
        if blocks.is_empty() {
            if last_audio.elapsed() >= STALL {
                break Event::CaptureFailed;
            }
            std::thread::sleep(Duration::from_millis(20));
            continue;
        }
        last_audio = Instant::now();
        keep_room(&mut blocks, &dictation);
        if dictation.feed(&blocks).is_err() {
            break Event::EngineFailed;
        }
        blocks.zeroize();
        #[cfg(test)]
        {
            let retained = dictation.retained_samples();
            publish(shared, |s| s.max_retained = s.max_retained.max(retained));
        }
        publish_live(shared, &dictation);
        if dictation.room() == 0 {
            publish(shared, |s| s.limit_reached = true);
            break Event::Stop;
        }
    };
    // Una sorgente che finisce prima di consegnare audio non ha nulla da
    // trascrivere: si chiude come uno scarto.
    let stoppable = shared.lock().is_ok_and(|s| s.machine.allows(Event::Stop));
    match outcome {
        Event::Stop if stoppable => {}
        Event::PermissionDenied | Event::CaptureFailed
            if shared.lock().is_ok_and(|s| s.machine.has_recorded()) =>
        {
            // Il microfono si è fermato dopo l'avvio: lo stato lo dice subito,
            // la registrazione non continua e il testo trascritto fin qui resta
            // da rivedere. Nessun salvataggio senza il gesto del medico.
            source.stop();
            if !transition(shared, outcome) {
                transition(shared, Event::CaptureFailed);
            }
            source.read(&mut blocks);
            keep_room(&mut blocks, &dictation);
            let finished = dictation.feed(&blocks).and_then(|()| dictation.finish());
            blocks.zeroize();
            let transcript = Zeroizing::new(dictation.transcript().to_owned());
            let segments = dictation.segments().to_vec();
            let speakers = attribute(shared, &dictation);
            dictation.wipe();
            publish(shared, |s| {
                s.stable.zeroize();
                s.provisional.zeroize();
                let kept = finished.is_ok() && !transcript.trim().is_empty();
                s.segments = if kept { segments } else { Vec::new() };
                s.speakers = if kept { speakers } else { Vec::new() };
                s.transcript = kept.then_some(transcript);
            });
            return;
        }
        _ => {
            source.stop();
            dictation.wipe();
            #[cfg(test)]
            {
                let retained = dictation.retained_samples();
                if let Ok(mut s) = shared.lock() {
                    s.retained_after_cancel = Some(retained);
                }
            }
            fail(shared, outcome);
            return;
        }
    }
    transition(shared, Event::Stop);
    source.stop();
    source.read(&mut blocks);
    keep_room(&mut blocks, &dictation);
    let finished = dictation.feed(&blocks).and_then(|()| dictation.finish());
    blocks.zeroize();
    if finished.is_err() {
        dictation.wipe();
        fail(shared, Event::EngineFailed);
        return;
    }
    let transcript = Zeroizing::new(dictation.transcript().to_owned());
    let segments = dictation.segments().to_vec();
    let speakers = attribute(shared, &dictation);
    let finals = dictation.finals_count();
    #[cfg(test)]
    let windows = dictation.windows.clone();
    dictation.wipe();
    publish(shared, |s| {
        s.finals = finals;
        s.segments = segments;
        s.speakers = speakers;
        #[cfg(test)]
        {
            s.windows = windows;
        }
        s.stable.zeroize();
        s.provisional.zeroize();
        s.transcript = Some(transcript);
        let _ = s.machine.apply(Event::Finished, Instant::now());
    });
    // Resta in attesa solo per l'annullamento; nessun altro lavoro.
    let _ = commands.recv();
}

#[cfg(local_voice_capture)]
pub(crate) mod swift {
    use super::{AudioSource, SourcePhase};
    use std::ffi::c_void;

    unsafe extern "C" {
        fn MFVoiceCaptureCreate() -> *mut c_void;
        fn MFVoiceCaptureStart(pointer: *mut c_void);
        fn MFVoiceCapturePoll(pointer: *mut c_void) -> i32;
        fn MFVoiceCaptureRead(pointer: *mut c_void, output: *mut f32, capacity: usize) -> usize;
        fn MFVoiceCaptureStop(pointer: *mut c_void);
        fn MFVoiceCaptureRelease(pointer: *mut c_void);
    }

    /// Cattura del microfono nel ponte Swift: conversione a 16 kHz mono e
    /// consegna dei campioni a Rust. Nessun file audio.
    pub(crate) struct SwiftCapture(*mut c_void);
    // SAFETY: il ponte protegge stato e campioni con un lock; il puntatore si
    // usa da un solo thread alla volta (quello di lavoro) e si rilascia una volta.
    unsafe impl Send for SwiftCapture {}

    impl SwiftCapture {
        pub(crate) fn new() -> Option<Self> {
            let pointer = unsafe { MFVoiceCaptureCreate() };
            (!pointer.is_null()).then_some(Self(pointer))
        }
    }
    impl AudioSource for SwiftCapture {
        fn start(&mut self) {
            unsafe { MFVoiceCaptureStart(self.0) }
        }
        fn phase(&mut self) -> SourcePhase {
            match unsafe { MFVoiceCapturePoll(self.0) } {
                0 => SourcePhase::Starting,
                1 => SourcePhase::Running,
                2 => SourcePhase::PermissionDenied,
                4 => SourcePhase::Stopped,
                _ => SourcePhase::Failed,
            }
        }
        fn read(&mut self, out: &mut Vec<f32>) {
            let room = out.capacity() - out.len();
            if room == 0 {
                return;
            }
            let start = out.len();
            out.resize(start + room, 0.0);
            let count = unsafe { MFVoiceCaptureRead(self.0, out[start..].as_mut_ptr(), room) };
            out[start + count.min(room)..].fill(0.0);
            out.truncate(start + count.min(room));
        }
        fn pause(&mut self) {
            unsafe { MFVoiceCaptureStop(self.0) }
        }
        /// Il ponte apre il microfono una volta sola per cattura: alla ripresa
        /// se ne apre una nuova e si rilascia la vecchia, già letta e ferma.
        fn resume(&mut self) {
            let next = unsafe { MFVoiceCaptureCreate() };
            if next.is_null() {
                return;
            }
            let previous = std::mem::replace(&mut self.0, next);
            unsafe {
                MFVoiceCaptureRelease(previous);
                MFVoiceCaptureStart(self.0);
            }
        }
        fn stop(&mut self) {
            unsafe { MFVoiceCaptureStop(self.0) }
        }
    }
    impl Drop for SwiftCapture {
        fn drop(&mut self) {
            unsafe { MFVoiceCaptureRelease(self.0) }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::listening::tests::{CountingDecoder, LoudnessDetector, silence, tone};
    use super::super::listening::{BLOCK, Dictation};
    use super::*;

    /// Decodificatore che resta fermo finché il test non lo sblocca.
    pub(crate) struct BlockingDecoder {
        entered: Option<Sender<()>>,
        release: Arc<(Mutex<bool>, std::sync::Condvar)>,
        finished: Sender<()>,
    }
    pub(crate) struct Gate {
        pub(crate) entered: Receiver<()>,
        pub(crate) release: Arc<(Mutex<bool>, std::sync::Condvar)>,
        pub(crate) finished: Receiver<()>,
    }
    impl BlockingDecoder {
        pub(crate) fn new() -> (Self, Gate) {
            let (entered, entered_rx) = mpsc::channel();
            let (finished, finished_rx) = mpsc::channel();
            let release = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
            (
                Self {
                    entered: Some(entered),
                    release: release.clone(),
                    finished,
                },
                Gate {
                    entered: entered_rx,
                    release,
                    finished: finished_rx,
                },
            )
        }
        pub(crate) fn open(release: &Arc<(Mutex<bool>, std::sync::Condvar)>) {
            *release.0.lock().unwrap() = true;
            release.1.notify_all();
        }
    }
    impl Decoder for BlockingDecoder {
        fn decode(&mut self, _: &[f32]) -> Result<Zeroizing<String>, EngineFailure> {
            if let Some(entered) = self.entered.take() {
                let _ = entered.send(());
            }
            let mut open = self.release.0.lock().unwrap();
            while !*open {
                open = self.release.1.wait(open).unwrap();
            }
            Ok(Zeroizing::new("parola riservata".into()))
        }
    }
    impl Drop for BlockingDecoder {
        fn drop(&mut self) {
            let _ = self.finished.send(());
        }
    }

    /// Sorgente che consegna un file già in memoria a blocchi da 0,5 s, come
    /// farebbe il microfono.
    pub(crate) struct InjectedSource {
        pub(crate) audio: Vec<f32>,
        pub(crate) position: usize,
        pub(crate) phase: SourcePhase,
        pub(crate) after_start: SourcePhase,
        /// Velocità rispetto al tempo reale (1,0 = come il microfono); 0 = senza attese.
        pub(crate) speed: f64,
        pub(crate) started: Option<std::time::Instant>,
        /// Campioni consegnati alla volta: 0,5 s, o circa 85 ms come il tap
        /// del microfono (4096 campioni a 48 kHz).
        pub(crate) chunk: usize,
        /// Posizione da cui l'orologio conta l'arrivo (dopo una ripresa).
        pub(crate) base: usize,
        /// Microfono chiuso (pausa o fine): oltre questa posizione non arriva nulla.
        pub(crate) closed_at: Option<usize>,
        /// Il microfono si stacca a questa posizione.
        pub(crate) fail_at: Option<usize>,
        /// Il microfono resta aperto ma tace da questa posizione.
        pub(crate) silent_from: Option<usize>,
        /// Il microfono non si riapre dopo la pausa.
        pub(crate) fail_on_resume: bool,
        /// Gesti ricevuti dalla sorgente, in ordine: per le prove.
        pub(crate) log: Arc<Mutex<Vec<&'static str>>>,
    }
    impl InjectedSource {
        pub(crate) fn new(audio: Vec<f32>) -> Self {
            Self {
                audio,
                position: 0,
                phase: SourcePhase::Starting,
                after_start: SourcePhase::Running,
                speed: 0.0,
                started: None,
                chunk: BLOCK,
                base: 0,
                closed_at: None,
                fail_at: None,
                silent_from: None,
                fail_on_resume: false,
                log: Arc::default(),
            }
        }
        pub(crate) fn paced(audio: Vec<f32>, speed: f64) -> Self {
            Self {
                speed,
                ..Self::new(audio)
            }
        }
        /// Campioni arrivati finora secondo l'orologio (o il prossimo pezzo).
        fn arrived(&self) -> usize {
            let end = match self.started.filter(|_| self.speed > 0.0) {
                // Pezzi interi arrivati secondo l'orologio.
                Some(started) => {
                    let elapsed = started.elapsed().as_secs_f64() * self.speed;
                    self.base + (elapsed * 16_000.0) as usize / self.chunk * self.chunk
                }
                None => self.position + self.chunk,
            };
            let end = [Some(end), self.closed_at, self.fail_at, self.silent_from]
                .into_iter()
                .flatten()
                .min()
                .unwrap_or(end);
            end.min(self.audio.len()).max(self.position)
        }
        fn close(&mut self) {
            if self.closed_at.is_none() && self.phase == SourcePhase::Running {
                self.closed_at = Some(self.arrived());
            }
        }
    }
    impl AudioSource for InjectedSource {
        fn start(&mut self) {
            self.log.lock().unwrap().push("start");
            self.phase = self.after_start;
            self.started = Some(std::time::Instant::now());
        }
        fn phase(&mut self) -> SourcePhase {
            if self.phase == SourcePhase::Running
                && self.fail_at.is_some_and(|at| self.position >= at)
            {
                self.phase = SourcePhase::Failed;
            }
            if self.phase == SourcePhase::Running
                && self.position >= self.audio.len()
                && self.speed == 0.0
            {
                return SourcePhase::Stopped;
            }
            self.phase
        }
        fn read(&mut self, out: &mut Vec<f32>) {
            let end = self.arrived();
            out.extend_from_slice(&self.audio[self.position..end]);
            self.position = end;
        }
        fn pause(&mut self) {
            self.log.lock().unwrap().push("pause");
            self.close();
            self.phase = SourcePhase::Stopped;
        }
        fn resume(&mut self) {
            self.log.lock().unwrap().push("resume");
            // L'audio rimasto fuori durante la pausa non arriva mai.
            self.position = self.closed_at.take().unwrap_or(self.position);
            self.base = self.position;
            self.started = Some(std::time::Instant::now());
            self.phase = if self.fail_on_resume {
                SourcePhase::Failed
            } else {
                SourcePhase::Running
            };
        }
        fn stop(&mut self) {
            self.log.lock().unwrap().push("stop");
            self.close();
            self.phase = SourcePhase::Stopped;
        }
    }

    /// Visita sintetica generata mentre la si legge, senza tenerla in
    /// memoria: ogni minuto dieci frasi da 2 s con 1 s di pausa, un monologo
    /// da 25 s (più lungo di una frase) e 5 s di silenzio.
    pub(crate) struct SyntheticVisit {
        pub(crate) total: usize,
        position: usize,
        phase: SourcePhase,
        pub(crate) log: Arc<Mutex<Vec<&'static str>>>,
    }
    impl SyntheticVisit {
        pub(crate) fn minutes(minutes: usize) -> Self {
            Self {
                total: minutes * 60 * 16_000,
                position: 0,
                phase: SourcePhase::Starting,
                log: Arc::default(),
            }
        }
        fn sample(index: usize) -> f32 {
            const SECOND: usize = 16_000;
            let cycle = index % (60 * SECOND);
            let voiced = if cycle < 30 * SECOND {
                cycle % (3 * SECOND) < 2 * SECOND
            } else {
                cycle < 55 * SECOND
            };
            if voiced {
                0.3 * (index as f32 * 0.07).sin().signum()
            } else {
                0.0
            }
        }
    }
    impl AudioSource for SyntheticVisit {
        fn start(&mut self) {
            self.log.lock().unwrap().push("start");
            self.phase = SourcePhase::Running;
        }
        fn phase(&mut self) -> SourcePhase {
            if self.phase == SourcePhase::Running && self.position >= self.total {
                return SourcePhase::Stopped;
            }
            self.phase
        }
        fn read(&mut self, out: &mut Vec<f32>) {
            if self.phase != SourcePhase::Running {
                return;
            }
            let end = (self.position + 4 * BLOCK).min(self.total);
            out.extend((self.position..end).map(Self::sample));
            self.position = end;
        }
        fn pause(&mut self) {
            self.phase = SourcePhase::Stopped;
        }
        fn resume(&mut self) {
            self.phase = SourcePhase::Running;
        }
        fn stop(&mut self) {
            self.log.lock().unwrap().push("stop");
            self.phase = SourcePhase::Stopped;
        }
    }

    /// Campioni che il ciclo può trattenere in qualunque momento: la frase
    /// aperta, il contesto del rilevatore e il resto di una finestra.
    const RETAINED_BOUND: usize = super::super::listening::MAX_UTTERANCE + 33 * 512 + 512;

    #[test]
    fn a_long_recording_keeps_audio_bounded_and_reaches_review_in_segments() {
        use super::super::listening::SAMPLE_RATE;
        let source = SyntheticVisit::minutes(12);
        let log = source.log.clone();
        let session = WhisperSession::with_parts(
            LoudnessDetector,
            CountingDecoder::default(),
            Box::new(source),
        );
        session.start();
        assert_eq!(session.wait_for(&[State::Review]), State::Review);
        assert_eq!(*log.lock().unwrap(), ["start", "stop"]);
        let shared = session.shared_for_test();
        let s = shared.lock().unwrap();
        assert!(
            s.max_retained <= RETAINED_BOUND,
            "audio retained grew to {} samples",
            s.max_retained
        );
        assert!(!s.limit_reached);
        // Dodici frasi al minuto: dieci brevi e il monologo diviso in due.
        let segments = &s.segments;
        assert_eq!(segments.len(), 12 * 12);
        // In ordine; due frasi si toccano solo nel margine di 0,2 s, quando un
        // monologo oltre i 20 s si divide.
        let mut previous_end = 0;
        for segment in segments {
            assert!(segment.start < segment.end);
            assert!(segment.start + SAMPLE_RATE / 5 >= previous_end);
            previous_end = segment.end;
        }
        assert!(previous_end <= 12 * 60 * SAMPLE_RATE);
        let joined: Vec<&str> = segments.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(s.transcript.as_deref().unwrap().as_str(), joined.join(" "));
        // Il monologo del settimo minuto parte a 6:30, con 0,2 s di margine.
        let monologue = &segments[6 * 12 + 10];
        let at = monologue.start as f64 / SAMPLE_RATE as f64;
        assert!((389.7..390.0).contains(&at), "monologue at {at} s");
    }

    #[test]
    fn the_recording_stops_by_itself_at_sixty_minutes() {
        use super::super::listening::{MAX_RECORDING, SAMPLE_RATE};
        let source = SyntheticVisit::minutes(61);
        let log = source.log.clone();
        let session = WhisperSession::with_parts(
            LoudnessDetector,
            CountingDecoder::default(),
            Box::new(source),
        );
        session.start();
        assert_eq!(session.wait_for(&[State::Review]), State::Review);
        assert_eq!(*log.lock().unwrap(), ["start", "stop"]);
        assert!(session.limit_reached());
        let segments = session.segments();
        let last = segments.last().unwrap();
        assert!(last.end <= MAX_RECORDING, "{} s", last.end / SAMPLE_RATE);
        // L'ultima frase prima del limite è nel testo, niente dopo i 60 minuti.
        assert!(last.start >= 59 * 60 * SAMPLE_RATE);
        assert_eq!(MAX_RECORDING, 60 * 60 * SAMPLE_RATE);
        assert!(super::super::LIMIT_REACHED.contains("60 minuti"));
    }

    /// Visita sintetica a due voci: frasi alternate fra una voce grave che
    /// apre e una acuta, con silenzi; ogni frase va alla persona giusta e il
    /// testo da rivedere le tiene nell'ordine in cui sono state dette.
    #[test]
    fn a_two_voice_visit_attributes_each_sentence_to_doctor_or_patient() {
        use super::super::voices::tests::synthetic_voice;
        let mut audio = silence(0.5);
        let mut truth = Vec::new();
        for turn in 0..10u32 {
            let seconds = 1.0 + (turn % 3) as f32 * 0.5;
            if turn % 2 == 0 {
                audio.extend(synthetic_voice(seconds, 115.0, 600.0, 1_100.0, turn));
                truth.push(Speaker::Doctor);
            } else {
                audio.extend(synthetic_voice(seconds, 210.0, 850.0, 1_900.0, turn));
                truth.push(Speaker::Patient);
            }
            audio.extend(silence(1.0));
        }
        let session = WhisperSession::with_parts(
            LoudnessDetector,
            CountingDecoder::default(),
            Box::new(InjectedSource::new(audio)),
        );
        session.set_two_voices(true);
        session.start();
        assert_eq!(session.wait_for(&[State::Review]), State::Review);
        let attributed = session.attributed();
        let speakers: Vec<Speaker> = attributed.iter().map(|(s, _)| *s).collect();
        assert_eq!(speakers, truth);
        let joined: Vec<&str> = attributed.iter().map(|(_, t)| t.as_str()).collect();
        assert_eq!(session.transcript().unwrap().as_str(), joined.join(" "));
        // Dopo l'avvio la modalità non cambia più.
        session.set_two_voices(false);
        assert_eq!(session.attributed().len(), 10);
    }

    /// La dettatura a una voce non calcola impronte né attribuisce frasi.
    #[test]
    fn dictation_keeps_one_voice_and_computes_no_print() {
        use super::super::voices::tests::synthetic_voice;
        let mut audio = synthetic_voice(1.5, 115.0, 600.0, 1_100.0, 1);
        audio.extend(silence(1.0));
        audio.extend(synthetic_voice(1.5, 210.0, 850.0, 1_900.0, 2));
        audio.extend(silence(1.0));
        let session = WhisperSession::with_parts(
            LoudnessDetector,
            CountingDecoder::default(),
            Box::new(InjectedSource::new(audio)),
        );
        session.start();
        assert_eq!(session.wait_for(&[State::Review]), State::Review);
        assert!(session.attributed().is_empty());
        let shared = session.shared_for_test();
        let s = shared.lock().unwrap();
        assert_eq!(s.segments.len(), 2);
        assert!(s.segments.iter().all(|segment| segment.voice.is_none()));
        assert!(s.print_ms.is_empty());
    }

    fn session_with(source: InjectedSource) -> (Arc<Mutex<Shared>>, Sender<Event>, JoinHandle<()>) {
        let shared = Arc::new(Mutex::new(Shared::default()));
        assert!(transition(&shared, Event::Start));
        let (commands, receiver) = mpsc::channel();
        let worker_shared = shared.clone();
        let worker = std::thread::spawn(move || {
            let mut source = source;
            let dictation = Dictation::new(LoudnessDetector, CountingDecoder::default());
            listen(dictation, &mut source, &receiver, &worker_shared);
        });
        (shared, commands, worker)
    }

    fn wait(shared: &Mutex<Shared>, wanted: State) -> State {
        for _ in 0..4_000 {
            let state = shared.lock().unwrap().machine.state();
            if state == wanted {
                return state;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        shared.lock().unwrap().machine.state()
    }

    #[test]
    fn worker_reaches_review_with_final_text_only() {
        let mut audio = silence(0.5);
        audio.extend(tone(2.0));
        audio.extend(silence(1.0));
        audio.extend(tone(1.0));
        let (shared, commands, worker) = session_with(InjectedSource::new(audio));
        assert_eq!(wait(&shared, State::Review), State::Review);
        let text = shared.lock().unwrap().transcript.clone().unwrap();
        assert_eq!(text.matches("parola").count(), 4 + 2, "{}", text.as_str());
        assert!(shared.lock().unwrap().stable.is_empty());
        assert!(shared.lock().unwrap().provisional.is_empty());
        let _ = commands.send(Event::Cancel);
        worker.join().unwrap();
    }

    #[test]
    fn permission_denied_and_missing_microphone_keep_no_text() {
        use super::super::Fault;
        for (phase, state) in [
            (
                SourcePhase::PermissionDenied,
                State::Error(Fault::PermissionDenied),
            ),
            (SourcePhase::Failed, State::Error(Fault::MicrophoneMissing)),
        ] {
            let mut source = InjectedSource::new(tone(2.0));
            source.after_start = phase;
            let log = source.log.clone();
            let (shared, _commands, worker) = session_with(source);
            worker.join().unwrap();
            let s = shared.lock().unwrap();
            assert_eq!(s.machine.state(), state);
            assert!(!s.machine.has_recorded());
            assert!(s.transcript.is_none() && s.stable.is_empty());
            assert_eq!(*log.lock().unwrap(), ["start", "stop"]);
        }
    }

    /// Alternanza di 2 s di voce e 1 s di silenzio: una frase ogni 3 s.
    fn speech(seconds: usize) -> Vec<f32> {
        let mut audio = Vec::new();
        for _ in 0..seconds / 3 {
            audio.extend(tone(2.0));
            audio.extend(silence(1.0));
        }
        audio
    }

    #[test]
    fn microphone_lost_midway_stops_at_once_and_keeps_the_text_for_review() {
        use super::super::Fault;
        let mut source = InjectedSource::new(speech(30));
        source.fail_at = Some(9 * 16_000);
        let log = source.log.clone();
        let (shared, _commands, worker) = session_with(source);
        worker.join().unwrap();
        let s = shared.lock().unwrap();
        assert_eq!(s.machine.state(), State::Error(Fault::MicrophoneLost));
        assert_eq!(s.machine.visible(), super::super::Visible::Error);
        assert_eq!(*log.lock().unwrap(), ["start", "stop"], "microphone closed");
        // Tre frasi da 2 s prima del distacco, nessuna dopo.
        let text = s.transcript.clone().expect("text kept for review");
        assert_eq!(text.matches("parola").count(), 3 * 4, "{}", text.as_str());
        assert!(s.stable.is_empty() && s.provisional.is_empty());
        assert!(s.machine.state().reviewable());
    }

    #[test]
    fn a_silent_microphone_is_lost_after_the_stall_not_shown_as_recording() {
        use super::super::Fault;
        let mut source = InjectedSource::new(speech(30));
        source.silent_from = Some(6 * 16_000);
        let log = source.log.clone();
        let (shared, _commands, worker) = session_with(source);
        assert_eq!(wait(&shared, State::Recording), State::Recording);
        // Il microfono resta aperto ma tace: entro STALL la registrazione si
        // ferma in errore invece di restare «in registrazione» a vuoto.
        let quiet = Instant::now();
        let mut state = State::Recording;
        while quiet.elapsed() < STALL + Duration::from_secs(2) {
            state = shared.lock().unwrap().machine.state();
            if state != State::Recording {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let detected = quiet.elapsed();
        worker.join().unwrap();
        assert_eq!(state, State::Error(Fault::MicrophoneLost));
        assert!(
            detected <= STALL + Duration::from_millis(500),
            "{detected:?}"
        );
        assert_eq!(*log.lock().unwrap(), ["start", "stop"]);
        let s = shared.lock().unwrap();
        let text = s.transcript.clone().expect("text kept for review");
        assert_eq!(text.matches("parola").count(), 2 * 4, "{}", text.as_str());
    }

    #[test]
    fn pause_closes_the_microphone_and_resume_continues_the_same_text() {
        let source = InjectedSource::paced(speech(600), 20.0);
        let log = source.log.clone();
        let session = WhisperSession::with_parts(
            LoudnessDetector,
            CountingDecoder::default(),
            Box::new(source),
        );
        session.start();
        assert_eq!(session.wait_for(&[State::Recording]), State::Recording);
        let recording_seen = Instant::now();
        while session.snapshot().3 < 2 {
            std::thread::sleep(Duration::from_millis(5));
        }
        session.send(Event::Pause);
        assert_eq!(session.wait_for(&[State::Paused]), State::Paused);
        assert_eq!(*log.lock().unwrap(), ["start", "pause"]);
        // Lo stato cambia al gesto; la frase aperta si trascrive subito dopo.
        while session.shared_for_test().lock().unwrap().pauses_flushed < 1 {
            std::thread::sleep(Duration::from_millis(5));
        }
        // In pausa: niente audio, niente testo nuovo, orologio fermo.
        let before = (
            session.stable_text(),
            session.machine().elapsed(Instant::now()),
        );
        std::thread::sleep(Duration::from_millis(300));
        let after = (
            session.stable_text(),
            session.machine().elapsed(Instant::now()),
        );
        assert_eq!(before.0.as_str(), after.0.as_str());
        assert_eq!(before.1, after.1, "clock runs in pause");
        assert!(
            session.provisional_text().is_empty(),
            "open sentence flushed"
        );
        let paused_words = before.0.matches("parola").count();
        assert!(paused_words >= 8, "{}", before.0.as_str());
        // Comandi illegali in pausa: ignorati.
        session.send(Event::Pause);
        session.send(Event::Start);
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(session.state(), State::Paused);
        session.send(Event::Resume);
        assert_eq!(session.wait_for(&[State::Recording]), State::Recording);
        while session.stable_text().matches("parola").count() < paused_words + 8 {
            std::thread::sleep(Duration::from_millis(5));
        }
        session.send(Event::Resume);
        session.stop();
        assert_eq!(session.wait_for(&[State::Review]), State::Review);
        assert_eq!(*log.lock().unwrap(), ["start", "pause", "resume", "stop"]);
        let text = session.transcript().unwrap();
        assert!(text.starts_with(before.0.as_str()), "{}", text.as_str());
        assert!(text.matches("parola").count() >= paused_words + 8);
        // Il tempo trascorso esclude gli almeno 0,4 s di pausa e resta fermo
        // dopo la fine.
        let wall = recording_seen.elapsed();
        let machine = session.machine();
        let elapsed = machine.elapsed(Instant::now());
        assert!(
            elapsed + Duration::from_millis(250) < wall,
            "{elapsed:?} {wall:?}"
        );
        assert_eq!(elapsed, machine.elapsed(Instant::now() + STALL));
    }

    #[test]
    fn a_microphone_that_does_not_reopen_after_pause_is_lost_not_missing() {
        use super::super::Fault;
        let mut source = InjectedSource::paced(speech(30), 20.0);
        source.fail_on_resume = true;
        let log = source.log.clone();
        let session = WhisperSession::with_parts(
            LoudnessDetector,
            CountingDecoder::default(),
            Box::new(source),
        );
        session.start();
        assert_eq!(session.wait_for(&[State::Recording]), State::Recording);
        while session.snapshot().3 < 1 {
            std::thread::sleep(Duration::from_millis(5));
        }
        session.send(Event::Pause);
        assert_eq!(session.wait_for(&[State::Paused]), State::Paused);
        while session.shared_for_test().lock().unwrap().pauses_flushed < 1 {
            std::thread::sleep(Duration::from_millis(5));
        }
        let kept = session.stable_text();
        assert!(!kept.is_empty());
        session.send(Event::Resume);
        let lost = State::Error(Fault::MicrophoneLost);
        assert_eq!(session.wait_for(&[lost]), lost);
        assert_eq!(*log.lock().unwrap(), ["start", "pause", "resume", "stop"]);
        // Lo stato d'errore arriva subito; il testo conservato subito dopo.
        let mut text = None;
        for _ in 0..1_000 {
            text = session.transcript();
            if text.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let text = text.expect("text before the pause kept");
        assert_eq!(text.as_str(), kept.as_str());
    }

    #[test]
    fn cancel_while_recording_discards_everything() {
        let mut source = InjectedSource::new(tone(600.0));
        source.after_start = SourcePhase::Running;
        let (shared, commands, worker) = session_with(source);
        assert_eq!(wait(&shared, State::Recording), State::Recording);
        commands.send(Event::Cancel).unwrap();
        worker.join().unwrap();
        let s = shared.lock().unwrap();
        assert_eq!(s.machine.state(), State::Cancelled);
        assert!(s.transcript.is_none() && s.stable.is_empty() && s.provisional.is_empty());
    }

    #[test]
    fn invalid_model_is_unavailable_before_any_capture() {
        let directory =
            std::env::temp_dir().join(format!("mediflow-voce-assente-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join(model::VAD.name), b"alterato").unwrap();
        let session = WhisperSession::new(
            Engine {
                directory: directory.clone(),
                files: model::FILES,
                prompt: Zeroizing::default(),
                load: load_whisper,
            },
            Box::new(InjectedSource::new(tone(1.0))),
        );
        assert_eq!(session.state(), State::Disclosure);
        session.start();
        let invalid = State::Error(super::super::Fault::ModelInvalid);
        assert_eq!(session.wait_for(&[invalid]), invalid);
        assert!(session.transcript().is_none());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn context_matches_the_bench_gpu_and_flash_attention() {
        let parameters = context_parameters();
        assert!(parameters.use_gpu);
        assert!(
            parameters.flash_attn,
            "whisper-rs default would halve the decoding speed"
        );
    }

    #[test]
    fn vocabulary_prompt_is_deduplicated_and_bounded() {
        let names = ["Ramipril", "  ramipril ", "Furosemide  25", "", "Eutirox"];
        assert_eq!(
            vocabulary_prompt(names).as_str(),
            "Ramipril, Furosemide 25, Eutirox"
        );
        let many: Vec<String> = (0..200).map(|n| format!("Farmaco{n}")).collect();
        let prompt = vocabulary_prompt(many.iter().map(String::as_str));
        assert!(prompt.chars().count() <= PROMPT_CHARACTERS);
        assert!(prompt.starts_with("Farmaco0, Farmaco1"));
    }

    fn read_wav(path: &str) -> Vec<f32> {
        let bytes = std::fs::read(path).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        let mut at = 12;
        let mut format = None;
        while at + 8 <= bytes.len() {
            let id = &bytes[at..at + 4];
            let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
            let body = &bytes[at + 8..(at + 8 + size).min(bytes.len())];
            if id == b"fmt " {
                format = Some((
                    u16::from_le_bytes([body[2], body[3]]),
                    u32::from_le_bytes(body[4..8].try_into().unwrap()),
                    u16::from_le_bytes([body[14], body[15]]),
                ));
            }
            if id == b"data" {
                assert_eq!(format, Some((1, 16_000, 16)), "16 kHz mono 16 bit");
                return body
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|b| f32::from(i16::from_le_bytes(*b)) / 32768.0)
                    .collect();
            }
            at += 8 + size + size % 2;
        }
        panic!("no data chunk in {path}");
    }

    /// Dettatura vera dal modello installato: un file del banco al posto del
    /// microfono, attraverso la sessione che sceglie whisper e verifica lo
    /// SHA-256 dei file. Solo a mano: in CI il modello non c'è e i test non
    /// scaricano nulla.
    #[test]
    #[ignore = "richiede MEDIFLOW_VOCE_WHISPER, MEDIFLOW_VOCE_VAD, MEDIFLOW_VOCE_FILE, MEDIFLOW_VOCE_EXPECT"]
    fn real_model_dictates_through_the_session() {
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name}"));
        let directory = std::env::temp_dir().join(format!(
            "mediflow-voce-vera-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        for (path, file) in [
            (var("MEDIFLOW_VOCE_WHISPER"), &model::WHISPER),
            (var("MEDIFLOW_VOCE_VAD"), &model::VAD),
        ] {
            std::os::unix::fs::symlink(path, directory.join(file.name)).unwrap();
        }
        let mut audio = read_wav(&var("MEDIFLOW_VOCE_FILE"));
        audio.extend(silence(2.0));
        let session = super::super::Session::open(
            Engine {
                directory: directory.clone(),
                files: model::FILES,
                prompt: Zeroizing::default(),
                load: load_whisper,
            },
            move || Some(Box::new(InjectedSource::new(audio)) as Box<dyn AudioSource>),
        );
        assert_eq!(session.state(), State::Disclosure, "whisper chosen");
        session.start();
        let started = std::time::Instant::now();
        while !matches!(
            session.state(),
            State::Review | State::Error(_) | State::Cancelled
        ) {
            assert!(started.elapsed() < Duration::from_secs(300), "no review");
            std::thread::sleep(Duration::from_millis(20));
        }
        let text = session.transcript().expect("review text");
        println!("trascrizione ({:?}): {}", started.elapsed(), text.as_str());
        let lower = text.to_lowercase();
        for word in var("MEDIFLOW_VOCE_EXPECT").split(',') {
            assert!(
                lower.contains(&word.to_lowercase()),
                "{word:?} missing: {lower}"
            );
        }
        drop(session);
        std::fs::remove_dir_all(directory).unwrap();
    }

    /// Registrazione lunga col modello vero (WUL-828 punto 3): i file WAV
    /// indicati, uno dopo l'altro, entrano nel ciclo `listen` a blocchi da
    /// 0,5 s senza attese. Misura tempo di calcolo, memoria del processo nel
    /// tempo (RSS da `ps` ogni 2 s), frasi con i tempi e testo. Solo a mano.
    #[test]
    #[ignore = "richiede MEDIFLOW_VOCE_WHISPER, MEDIFLOW_VOCE_VAD, MEDIFLOW_VOCE_FILES, MEDIFLOW_VOCE_OUT"]
    fn real_model_long_session_in_segments() {
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name}"));
        let whisper_path = PathBuf::from(var("MEDIFLOW_VOCE_WHISPER"));
        let vad_path = PathBuf::from(var("MEDIFLOW_VOCE_VAD"));
        for (path, file) in [(&whisper_path, &model::WHISPER), (&vad_path, &model::VAD)] {
            assert_eq!(
                model::sha256_file(path).unwrap(),
                file.sha256,
                "pinned hash"
            );
        }
        let rss = || -> u64 {
            let out = std::process::Command::new("ps")
                .args(["-o", "rss=", "-p", &std::process::id().to_string()])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout)
                .trim()
                .parse::<u64>()
                .unwrap_or(0)
                / 1024
        };
        let mut audio = Vec::new();
        for file in var("MEDIFLOW_VOCE_FILES").split(',') {
            audio.extend(read_wav(file));
        }
        let seconds = audio.len() as f64 / 16_000.0;
        let prompt = std::env::var("MEDIFLOW_VOCE_PROMPT").unwrap_or_default();
        let two_voices = std::env::var("MEDIFLOW_VOCE_DUE").is_ok_and(|v| v == "1");
        let rss_before_model = rss();
        let session = WhisperSession::with_parts(
            SileroDetector::load(&vad_path).unwrap(),
            WhisperDecoder::load(&whisper_path, Zeroizing::new(prompt)).unwrap(),
            Box::new(InjectedSource::new(audio)),
        );
        let rss_loaded = rss();
        session.set_two_voices(two_voices);
        let started = Instant::now();
        session.start();
        let mut samples: Vec<(f64, u64)> = Vec::new();
        let mut last = Instant::now() - Duration::from_secs(10);
        while !matches!(
            session.state(),
            State::Review | State::Error(_) | State::Cancelled
        ) {
            if last.elapsed() >= Duration::from_secs(2) {
                samples.push((started.elapsed().as_secs_f64(), rss()));
                last = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let wall = started.elapsed().as_secs_f64();
        assert_eq!(session.state(), State::Review);
        let text = session.transcript().unwrap();
        let speakers: Vec<&str> = session
            .attributed()
            .iter()
            .map(|(s, _)| s.label())
            .collect();
        let segments: Vec<serde_json::Value> = session
            .segments()
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let mut row = serde_json::json!([
                    s.start as f64 / 16_000.0,
                    s.end as f64 / 16_000.0,
                    s.text.as_str()
                ]);
                if let Some(speaker) = speakers.get(i) {
                    row.as_array_mut().unwrap().push((*speaker).into());
                }
                row
            })
            .collect();
        let (print_ms, attribution_ms) = {
            let shared = session.shared_for_test();
            let s = shared.lock().unwrap();
            (s.print_ms.clone(), s.attribution_ms)
        };
        let mut sorted = print_ms.clone();
        sorted.sort_by(f64::total_cmp);
        let percentile = |q: f64| {
            sorted
                .get(((sorted.len() as f64 - 1.0) * q).round() as usize)
                .copied()
        };
        let max_rss = samples.iter().map(|s| s.1).max().unwrap_or(0);
        let shared = session.shared_for_test();
        let max_retained = shared.lock().unwrap().max_retained;
        let report = serde_json::json!({
            "file": var("MEDIFLOW_VOCE_FILES"), "durata_audio_s": seconds, "calcolo_s": wall,
            "rtf": wall / seconds, "rss_mb_prima_del_modello": rss_before_model,
            "rss_mb_modello_caricato": rss_loaded, "rss_mb_massimo": max_rss,
            "rss_mb_nel_tempo": samples, "campioni_audio_trattenuti_max": max_retained,
            "caratteri": text.chars().count(), "caratteri_al_minuto": text.chars().count() as f64 / (seconds / 60.0),
            "frasi": segments, "testo": text.as_str(),
        });
        let mut report = report;
        if two_voices {
            report["tempi_impronta_ms"] = serde_json::json!({
                "frasi": print_ms.len(), "mediana": percentile(0.5), "p95": percentile(0.95),
                "massimo": sorted.last(), "totale": print_ms.iter().sum::<f64>(),
            });
            report["tempo_attribuzione_ms"] = attribution_ms.into();
        }
        std::fs::write(
            var("MEDIFLOW_VOCE_OUT"),
            serde_json::to_string_pretty(&report).unwrap(),
        )
        .unwrap();
        println!(
            "audio {seconds:.0} s, calcolo {wall:.0} s, RSS massimo {max_rss} MB, {} caratteri",
            text.chars().count()
        );
        // Il thread di lavoro libera il contesto Metal prima dell'uscita del
        // processo di prova.
        drop(session);
        std::thread::sleep(Duration::from_secs(2));
        assert!(max_retained <= RETAINED_BOUND);
    }

    /// P2: modello vero, file del banco iniettati a blocchi da 0,5 s al posto
    /// del microfono, con lo stesso ciclo `listen`. Senza le variabili
    /// d'ambiente non gira (in CI non c'è il modello).
    #[test]
    #[ignore = "richiede MEDIFLOW_VOCE_WHISPER, MEDIFLOW_VOCE_VAD, MEDIFLOW_VOCE_FILES, MEDIFLOW_VOCE_OUT"]
    fn real_model_on_bench_files_through_the_microphone_path() {
        use std::io::Write;
        use std::time::Instant;
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name}"));
        let whisper_path = PathBuf::from(var("MEDIFLOW_VOCE_WHISPER"));
        let vad_path = PathBuf::from(var("MEDIFLOW_VOCE_VAD"));
        for (path, file) in [(&whisper_path, &model::WHISPER), (&vad_path, &model::VAD)] {
            assert_eq!(
                model::sha256_file(path).unwrap(),
                file.sha256,
                "pinned hash"
            );
        }
        let speed: f64 = std::env::var("MEDIFLOW_VOCE_SPEED")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1.0);
        let prompt = std::env::var("MEDIFLOW_VOCE_PROMPT").unwrap_or_default();
        let chunk: usize = std::env::var("MEDIFLOW_VOCE_CHUNK")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(BLOCK);
        let mut out = std::fs::File::create(var("MEDIFLOW_VOCE_OUT")).unwrap();
        for file in var("MEDIFLOW_VOCE_FILES").split(',') {
            let mut audio = read_wav(file);
            let duration = audio.len() as f64 / 16_000.0;
            audio.extend(silence(2.0));
            let total = audio.len() as f64 / 16_000.0;
            let session = WhisperSession::with_parts(
                SileroDetector::load(&vad_path).unwrap(),
                WhisperDecoder::load(&whisper_path, Zeroizing::new(prompt.clone())).unwrap(),
                Box::new(InjectedSource {
                    chunk,
                    ..InjectedSource::paced(audio, speed)
                }),
            );
            session.start();
            let mut started = None;
            let mut partials: Vec<Option<f64>> = Vec::new();
            let mut confirmed: Vec<Option<f64>> = Vec::new();
            let mut finals: Vec<f64> = Vec::new();
            let mut stopped = false;
            let review = loop {
                std::thread::sleep(Duration::from_millis(2));
                let (state, provisional, open_confirmed, count, windows) = session.snapshot();
                if state == State::Recording && started.is_none() {
                    started = Some(Instant::now());
                }
                let Some(t0) = started else { continue };
                let now = t0.elapsed().as_secs_f64() * speed;
                while finals.len() < count {
                    finals.push(now);
                }
                // Frase aperta = indice del prossimo definitivo.
                partials.resize(count + 1, None);
                confirmed.resize(count + 1, None);
                if (provisional > 0 || open_confirmed > 0) && partials[count].is_none() {
                    partials[count] = Some(now);
                }
                if open_confirmed > 0 && confirmed[count].is_none() {
                    confirmed[count] = Some(now);
                }
                if !stopped && now >= total + 0.3 * speed {
                    session.stop();
                    stopped = true;
                }
                if state == State::Review {
                    break windows;
                }
                assert!(
                    matches!(state, State::Recording | State::Finalizing),
                    "{state:?}"
                );
            };
            let text = session.transcript().unwrap_or_default();
            let windows: Vec<(f64, f64, usize)> = review
                .iter()
                .map(|(a, b, w)| (*a as f64 / 16_000.0, *b as f64 / 16_000.0, *w))
                .collect();
            writeln!(
                out,
                "{}",
                serde_json::json!({
                    "file": file, "durata_s": duration, "velocita": speed, "pezzo": chunk,
                    "parziali_s": partials, "confermati_s": confirmed, "definitivi_s": finals,
                    "finestre": windows, "testo": text.as_str(),
                })
            )
            .unwrap();
        }
    }
}
