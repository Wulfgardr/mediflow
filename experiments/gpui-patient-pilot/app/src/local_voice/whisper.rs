//! Motore whisper.cpp (Metal) con rilevatore Silero, in un thread di lavoro.
//! Il ponte Swift cattura il microfono e consegna blocchi a 16 kHz; il thread
//! li legge, li passa al ciclo di ascolto e pubblica solo il testo stabile.

use super::State;
use super::listening::{Decoder, Dictation, EngineFailure, SpeechDetector};
use super::model::{self, ModelFile, ModelStatus};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
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
    fn stop(&mut self);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Problem {
    ModelInvalid,
    EngineFailed,
}

#[derive(Default)]
pub(crate) struct Shared {
    /// La sessione è stata ritirata: il thread finisce da solo e non pubblica più nulla.
    retired: bool,
    state: Option<State>,
    problem: Option<Problem>,
    pub(crate) stable: Zeroizing<String>,
    pub(crate) provisional: Zeroizing<String>,
    open_confirmed: usize,
    finals: usize,
    pub(crate) transcript: Option<Zeroizing<String>>,
    #[cfg(test)]
    windows: Vec<(usize, usize, usize)>,
    /// Per le prove: campioni rimasti nel ciclo dopo l'annullamento.
    #[cfg(test)]
    pub(crate) retained_after_cancel: Option<usize>,
}

pub(crate) enum Command {
    Start,
    Stop,
    Cancel,
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
pub(crate) type Listener =
    Box<dyn FnOnce(&mut dyn AudioSource, &Receiver<Command>, &Mutex<Shared>)>;
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
    commands: Sender<Command>,
    worker: Option<JoinHandle<()>>,
}

impl WhisperSession {
    pub(crate) fn new(engine: Engine, source: Box<dyn AudioSource>) -> Self {
        let shared = Arc::new(Mutex::new(Shared {
            state: Some(State::Disclosure),
            ..Shared::default()
        }));
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
    pub(crate) fn start(&self) {
        let _ = self.commands.send(Command::Start);
    }
    pub(crate) fn stop(&self) {
        let _ = self.commands.send(Command::Stop);
    }
    fn read<T>(&self, f: impl FnOnce(&Shared) -> T) -> Option<T> {
        self.shared.lock().ok().map(|s| f(&s))
    }
    pub(crate) fn state(&self) -> State {
        if self.worker.is_none() {
            return State::Unavailable;
        }
        self.read(|s| s.state.unwrap_or(State::Unavailable))
            .unwrap_or(State::Unavailable)
    }
    pub(crate) fn problem(&self) -> Option<Problem> {
        self.read(|s| s.problem).flatten()
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
    pub(crate) fn transcript(&self) -> Option<Zeroizing<String>> {
        self.read(|s| {
            (s.state == Some(State::Review))
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
        let shared = Arc::new(Mutex::new(Shared {
            state: Some(State::Disclosure),
            ..Shared::default()
        }));
        let (commands, receiver) = mpsc::channel();
        let worker_shared = shared.clone();
        let worker = std::thread::spawn(move || {
            let mut source = source;
            if !matches!(receiver.recv(), Ok(Command::Start)) {
                fail(&worker_shared, State::Cancelled, None);
                return;
            }
            publish(&worker_shared, |s| s.state = Some(State::Preparing));
            listen(
                Dictation::new(detector, decoder),
                source.as_mut(),
                &receiver,
                &worker_shared,
            );
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
            s.state.unwrap_or(State::Unavailable),
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
        }
        let _ = self.commands.send(Command::Cancel);
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

fn fail(shared: &Mutex<Shared>, state: State, problem: Option<Problem>) {
    publish(shared, |s| {
        s.state = Some(state);
        s.problem = problem;
        s.stable.zeroize();
        s.provisional.zeroize();
        s.transcript = None;
    });
}

fn run(
    engine: Engine,
    mut source: Box<dyn AudioSource>,
    commands: Receiver<Command>,
    shared: Arc<Mutex<Shared>>,
) {
    match commands.recv() {
        Ok(Command::Start) => {}
        _ => {
            fail(&shared, State::Cancelled, None);
            return;
        }
    }
    publish(&shared, |s| s.state = Some(State::Preparing));
    if model::verify(&engine.directory, &engine.files) != ModelStatus::Verified {
        fail(&shared, State::Unavailable, Some(Problem::ModelInvalid));
        return;
    }
    if retired(&shared) {
        return;
    }
    let Ok(listener) = (engine.load)(&engine.directory, &engine.files, engine.prompt) else {
        fail(&shared, State::Unavailable, Some(Problem::EngineFailed));
        return;
    };
    if retired(&shared) {
        return;
    }
    listener(source.as_mut(), &commands, &shared);
}

/// Ciclo del thread: lo stesso per il microfono e per le prove su file.
pub(crate) fn listen<V: SpeechDetector, D: Decoder>(
    mut dictation: Dictation<V, D>,
    source: &mut dyn AudioSource,
    commands: &Receiver<Command>,
    shared: &Mutex<Shared>,
) {
    if matches!(commands.try_recv(), Ok(Command::Cancel)) {
        fail(shared, State::Cancelled, None);
        return;
    }
    source.start();
    let mut blocks = Zeroizing::new(Vec::with_capacity(super::listening::MAX_UTTERANCE));
    let outcome = loop {
        match commands.try_recv() {
            Ok(Command::Cancel) | Err(TryRecvError::Disconnected) => break Err(State::Cancelled),
            Ok(Command::Stop) => break Ok(()),
            Ok(Command::Start) | Err(TryRecvError::Empty) => {}
        }
        match source.phase() {
            SourcePhase::Starting => {
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
            SourcePhase::PermissionDenied => break Err(State::PermissionDenied),
            SourcePhase::Failed => break Err(State::Unavailable),
            SourcePhase::Stopped => break Ok(()),
            SourcePhase::Running => {}
        }
        publish(shared, |s| {
            if s.state == Some(State::Preparing) {
                s.state = Some(State::Recording);
            }
        });
        source.read(&mut blocks);
        if blocks.is_empty() {
            std::thread::sleep(Duration::from_millis(20));
            continue;
        }
        if dictation.feed(&blocks).is_err() {
            break Err(State::Unavailable);
        }
        blocks.zeroize();
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
    };
    if let Err(state) = outcome {
        source.stop();
        dictation.wipe();
        #[cfg(test)]
        {
            let retained = dictation.retained_samples();
            if let Ok(mut s) = shared.lock() {
                s.retained_after_cancel = Some(retained);
            }
        }
        let problem = (state == State::Unavailable).then_some(Problem::EngineFailed);
        fail(shared, state, problem);
        return;
    }
    publish(shared, |s| s.state = Some(State::Finalizing));
    source.stop();
    source.read(&mut blocks);
    let finished = dictation.feed(&blocks).and_then(|()| dictation.finish());
    blocks.zeroize();
    if finished.is_err() {
        dictation.wipe();
        fail(shared, State::Unavailable, Some(Problem::EngineFailed));
        return;
    }
    let transcript = Zeroizing::new(dictation.transcript().to_owned());
    let finals = dictation.finals_count();
    #[cfg(test)]
    let windows = dictation.windows.clone();
    dictation.wipe();
    publish(shared, |s| {
        s.finals = finals;
        #[cfg(test)]
        {
            s.windows = windows;
        }
        s.stable.zeroize();
        s.provisional.zeroize();
        s.transcript = Some(transcript);
        s.state = Some(State::Review);
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
            }
        }
        pub(crate) fn paced(audio: Vec<f32>, speed: f64) -> Self {
            Self {
                speed,
                ..Self::new(audio)
            }
        }
    }
    impl AudioSource for InjectedSource {
        fn start(&mut self) {
            self.phase = self.after_start;
            self.started = Some(std::time::Instant::now());
        }
        fn phase(&mut self) -> SourcePhase {
            if self.phase == SourcePhase::Running
                && self.position >= self.audio.len()
                && self.speed == 0.0
            {
                return SourcePhase::Stopped;
            }
            self.phase
        }
        fn read(&mut self, out: &mut Vec<f32>) {
            let end = match self.started.filter(|_| self.speed > 0.0) {
                // Pezzi interi arrivati secondo l'orologio.
                Some(started) => {
                    let elapsed = started.elapsed().as_secs_f64() * self.speed;
                    let arrived = (elapsed * 16_000.0) as usize / self.chunk * self.chunk;
                    arrived.min(self.audio.len()).max(self.position)
                }
                None => (self.position + self.chunk).min(self.audio.len()),
            };
            out.extend_from_slice(&self.audio[self.position..end]);
            self.position = end;
        }
        fn stop(&mut self) {
            self.phase = SourcePhase::Stopped;
        }
    }

    fn session_with(
        source: InjectedSource,
    ) -> (Arc<Mutex<Shared>>, Sender<Command>, JoinHandle<()>) {
        let shared = Arc::new(Mutex::new(Shared {
            state: Some(State::Preparing),
            ..Shared::default()
        }));
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
            let state = shared.lock().unwrap().state.unwrap();
            if state == wanted {
                return state;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        shared.lock().unwrap().state.unwrap()
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
        let _ = commands.send(Command::Cancel);
        worker.join().unwrap();
    }

    #[test]
    fn permission_denied_and_capture_failure_keep_no_text() {
        for (phase, state) in [
            (SourcePhase::PermissionDenied, State::PermissionDenied),
            (SourcePhase::Failed, State::Unavailable),
        ] {
            let mut source = InjectedSource::new(tone(2.0));
            source.after_start = phase;
            let (shared, _commands, worker) = session_with(source);
            worker.join().unwrap();
            let s = shared.lock().unwrap();
            assert_eq!(s.state, Some(state));
            assert!(s.transcript.is_none() && s.stable.is_empty());
        }
    }

    #[test]
    fn cancel_while_recording_discards_everything() {
        let mut source = InjectedSource::new(tone(600.0));
        source.after_start = SourcePhase::Running;
        let (shared, commands, worker) = session_with(source);
        assert_eq!(wait(&shared, State::Recording), State::Recording);
        commands.send(Command::Cancel).unwrap();
        worker.join().unwrap();
        let s = shared.lock().unwrap();
        assert_eq!(s.state, Some(State::Cancelled));
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
        assert_eq!(session.wait_for(&[State::Unavailable]), State::Unavailable);
        assert_eq!(session.problem(), Some(Problem::ModelInvalid));
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
            State::Review | State::Unavailable | State::Cancelled
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
