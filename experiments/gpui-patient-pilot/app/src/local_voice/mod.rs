use zeroize::Zeroizing;

#[cfg(unix)]
pub(crate) mod drug_review;

#[cfg(target_os = "macos")]
pub(crate) mod listening;
#[cfg(target_os = "macos")]
pub(crate) mod model;
#[cfg(target_os = "macos")]
pub(crate) mod whisper;

pub(crate) mod recording;

pub(crate) use recording::{Event, Fault, State, Visible};

impl State {
    /// Messaggio dello stato: che cosa succede e, in errore, come rimediare.
    /// In registrazione l'indicatore basta.
    pub(crate) fn message(self) -> Option<&'static str> {
        Some(match self {
            Self::Disclosure => {
                "L'audio viene trascritto sul Mac. Il testo resta qui da rivedere, anche se pronunci nomi o altri identificativi. Nessun invio alla chat o al modello."
            }
            Self::Preparing => "Verifica del permesso microfono e del modello vocale locale…",
            Self::Recording => return None,
            Self::Paused => "Microfono chiuso fino alla ripresa.",
            Self::Finalizing => "Completamento della trascrizione locale…",
            Self::Cancelled => "Registrazione scartata.",
            Self::Review => {
                "Rileggi e correggi il testo. Il trasferimento prepara una bozza; il salvataggio richiede un'altra conferma nella cartella selezionata."
            }
            Self::Error(fault) => fault.message(),
        })
    }
    /// Stati in cui il testo già trascritto si rivede: la fine normale e
    /// l'interruzione del microfono dopo l'avvio, che ferma la registrazione ma
    /// non butta il testo.
    pub(crate) fn reviewable(self) -> bool {
        matches!(
            self,
            Self::Review | Self::Error(Fault::MicrophoneLost | Fault::PermissionDenied)
        )
    }
}

impl Fault {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::ModelMissing => "Modello vocale non installato.",
            Self::ModelInvalid => {
                "Il modello vocale locale è incompleto o diverso da quello atteso."
            }
            Self::PermissionDenied => {
                "Permesso microfono negato. Puoi abilitarlo nelle Impostazioni di Sistema, Privacy e sicurezza, Microfono, e aprire una nuova richiesta."
            }
            Self::MicrophoneMissing => {
                "Nessun microfono disponibile. Collegane uno e apri una nuova richiesta."
            }
            Self::MicrophoneLost => {
                "Il microfono si è interrotto e la registrazione si è fermata. Ricollegalo e apri una nuova richiesta."
            }
            Self::EngineFailed => {
                "La dettatura locale si è interrotta e il testo non è stato conservato. Apri una nuova dettatura."
            }
            Self::Unsupported => "La dettatura locale non è disponibile su questo computer.",
        }
    }
}

/// Testo mentre si parla, in due inchiostri: confermato (frasi definitive e
/// prefisso confermato) e provvisorio (l'ultimo parziale oltre quel prefisso).
/// Nessuno dei due è modificabile o trasferibile.
pub(crate) struct LiveText {
    pub(crate) confirmed: Zeroizing<String>,
    pub(crate) provisional: Zeroizing<String>,
}
impl LiveText {
    /// Testo intero e intervallo in byte del provvisorio.
    pub(crate) fn joined(&self) -> (Zeroizing<String>, std::ops::Range<usize>) {
        let mut text = Zeroizing::new(self.confirmed.as_str().to_owned());
        if !text.is_empty() && !self.provisional.is_empty() {
            text.push(' ');
        }
        let start = text.len();
        text.push_str(&self.provisional);
        let end = text.len();
        (text, start..end)
    }
}

/// L'unico motore è whisper, e solo con il modello installato.
enum Backend {
    #[cfg(target_os = "macos")]
    Whisper(whisper::WhisperSession),
    /// Nessun file del modello nella cartella.
    #[cfg(target_os = "macos")]
    ModelMissing,
    /// Sistema senza cattura del microfono per whisper.
    Unsupported,
}

pub(crate) struct Session {
    #[cfg(test)]
    synthetic: Option<(recording::Machine, Zeroizing<String>)>,
    /// Per le prove: testo dal vivo (confermato, provvisorio) deciso dal test.
    #[cfg(test)]
    synthetic_live: Option<std::sync::Arc<std::sync::Mutex<(String, String)>>>,
    backend: Backend,
}
impl Session {
    fn with_backend(backend: Backend) -> Self {
        Self {
            #[cfg(test)]
            synthetic: None,
            #[cfg(test)]
            synthetic_live: None,
            backend,
        }
    }
    /// `prompt`: nomi dei farmaci del paziente aperto.
    pub(crate) fn new(prompt: Zeroizing<String>) -> Self {
        #[cfg(local_voice_capture)]
        if let Some(directory) = model::directory() {
            return Self::open(
                whisper::Engine {
                    directory,
                    files: model::FILES,
                    prompt,
                    load: whisper::load_whisper,
                },
                || {
                    whisper::swift::SwiftCapture::new()
                        .map(|capture| Box::new(capture) as Box<dyn whisper::AudioSource>)
                },
            );
        }
        #[cfg(not(local_voice_capture))]
        drop(prompt);
        Self::with_backend(Backend::Unsupported)
    }
    /// Senza file del modello la dettatura manca e si porta all'installazione;
    /// un file presente ma alterato si scopre alla verifica completa, all'avvio.
    #[cfg(target_os = "macos")]
    #[cfg_attr(not(any(test, local_voice_capture)), allow(dead_code))]
    pub(crate) fn open(
        engine: whisper::Engine,
        capture: impl FnOnce() -> Option<Box<dyn whisper::AudioSource>>,
    ) -> Self {
        if model::quick_status(&engine.directory, &engine.files) == model::ModelStatus::Missing {
            return Self::with_backend(Backend::ModelMissing);
        }
        Self::with_backend(match capture() {
            Some(source) => Backend::Whisper(whisper::WhisperSession::new(engine, source)),
            None => Backend::Unsupported,
        })
    }
    /// Sessione di prova ferma in `state`; in registrazione o in pausa il
    /// tempo trascorso parte da `elapsed`.
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn synthetic_at(state: State, elapsed: std::time::Duration, text: &str) -> Self {
        Self {
            synthetic: Some((
                recording::Machine::at(state, elapsed, std::time::Instant::now()),
                Zeroizing::new(text.to_owned()),
            )),
            ..Self::with_backend(Backend::Unsupported)
        }
    }
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn synthetic(state: State, text: &str) -> Self {
        Self::synthetic_at(state, std::time::Duration::ZERO, text)
    }
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn with_whisper(session: whisper::WhisperSession) -> Self {
        Self::with_backend(Backend::Whisper(session))
    }
    fn send(&self, command: Event) {
        #[cfg(target_os = "macos")]
        if let Backend::Whisper(whisper) = &self.backend {
            whisper.send(command);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = command;
    }
    pub(crate) fn start(&self) {
        self.send(Event::Start);
    }
    pub(crate) fn pause(&self) {
        self.send(Event::Pause);
    }
    pub(crate) fn resume(&self) {
        self.send(Event::Resume);
    }
    pub(crate) fn stop(&self) {
        self.send(Event::Stop);
    }
    /// Dove la dettatura manca per il modello, assente o alterato, il gesto
    /// che porta a Impostazioni, Voce locale.
    pub(crate) fn model_action(&self, state: State) -> Option<&'static str> {
        match state {
            State::Error(Fault::ModelMissing) => Some("Installa il modello"),
            State::Error(Fault::ModelInvalid) => Some("Reinstalla il modello"),
            _ => None,
        }
    }
    /// Testo mentre si parla (solo whisper): da mostrare, mai modificabile né
    /// trasferibile.
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn synthetic_live(
        state: State,
        live: std::sync::Arc<std::sync::Mutex<(String, String)>>,
    ) -> Self {
        Self {
            synthetic_live: Some(live),
            ..Self::synthetic(state, "")
        }
    }
    pub(crate) fn live_text(&self) -> Option<LiveText> {
        #[cfg(test)]
        if let Some(live) = &self.synthetic_live {
            let (confirmed, provisional) = live.lock().unwrap().clone();
            return Some(LiveText {
                confirmed: Zeroizing::new(confirmed),
                provisional: Zeroizing::new(provisional),
            });
        }
        #[cfg(target_os = "macos")]
        if let Backend::Whisper(whisper) = &self.backend {
            return matches!(
                self.state(),
                State::Preparing | State::Recording | State::Paused | State::Finalizing
            )
            .then(|| LiveText {
                confirmed: whisper.stable_text(),
                provisional: whisper.provisional_text(),
            })
            .filter(|live| !live.confirmed.is_empty() || !live.provisional.is_empty());
        }
        None
    }
    /// Stato, tempo trascorso e passaggi possibili della registrazione.
    pub(crate) fn machine(&self) -> recording::Machine {
        #[cfg(test)]
        if let Some((machine, _)) = &self.synthetic {
            return *machine;
        }
        match &self.backend {
            #[cfg(target_os = "macos")]
            Backend::Whisper(whisper) => whisper.machine(),
            #[cfg(target_os = "macos")]
            Backend::ModelMissing => recording::Machine::failed(Fault::ModelMissing),
            Backend::Unsupported => recording::Machine::failed(Fault::Unsupported),
        }
    }
    pub(crate) fn state(&self) -> State {
        self.machine().state()
    }
    pub(crate) fn transcript(&self) -> Option<Zeroizing<String>> {
        #[cfg(test)]
        if let Some((machine, text)) = &self.synthetic {
            return reviewed_text(machine.state(), text);
        }
        #[cfg(target_os = "macos")]
        if let Backend::Whisper(whisper) = &self.backend {
            return whisper
                .transcript()
                .and_then(|text| reviewed_text(whisper.state(), &text));
        }
        None
    }
}

pub(crate) fn reviewed_text(state: State, text: &str) -> Option<Zeroizing<String>> {
    (state.reviewable()
        && !text.trim().is_empty()
        && text.chars().count() <= 12_000
        && text.len() <= 256 * 1024)
        .then(|| Zeroizing::new(text.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_explicit_review_can_prepare_a_draft_and_identifiers_stay_native() {
        let text = "Nome inventato Ada Esempio, codice fiscale sintetico, controllo stabile.";
        for state in [
            State::Error(Fault::ModelMissing),
            State::Error(Fault::ModelInvalid),
            State::Error(Fault::MicrophoneMissing),
            State::Error(Fault::EngineFailed),
            State::Error(Fault::Unsupported),
            State::Disclosure,
            State::Preparing,
            State::Recording,
            State::Paused,
            State::Finalizing,
            State::Cancelled,
        ] {
            assert!(reviewed_text(state, text).is_none(), "{state:?}");
        }
        for state in [
            State::Review,
            State::Error(Fault::MicrophoneLost),
            State::Error(Fault::PermissionDenied),
        ] {
            assert_eq!(
                reviewed_text(state, text).as_deref().map(String::as_str),
                Some(text)
            );
        }
        assert!(reviewed_text(State::Review, "  ").is_none());
        assert!(reviewed_text(State::Review, &"è".repeat(12_001)).is_none());
    }

    /// Ogni stato ha un messaggio, salvo la registrazione in corso, dove parla
    /// l'indicatore; ogni errore dice perché e come rimediare.
    #[test]
    fn every_error_says_why_and_what_to_do() {
        for fault in [
            Fault::ModelMissing,
            Fault::ModelInvalid,
            Fault::PermissionDenied,
            Fault::MicrophoneMissing,
            Fault::MicrophoneLost,
            Fault::EngineFailed,
            Fault::Unsupported,
        ] {
            let message = State::Error(fault).message().unwrap();
            assert!(!message.contains('\u{2014}'), "{message}");
            assert!(message.ends_with('.'), "{message}");
        }
        assert_eq!(State::Recording.message(), None);
        assert!(
            State::Paused
                .message()
                .unwrap()
                .contains("Microfono chiuso")
        );
    }
}
