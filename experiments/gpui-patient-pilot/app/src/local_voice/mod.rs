use zeroize::Zeroizing;

#[cfg(target_os = "macos")]
pub(crate) mod listening;
#[cfg(target_os = "macos")]
pub(crate) mod model;
#[cfg(target_os = "macos")]
pub(crate) mod whisper;

/// Il modello c'è ma i file non coincidono con quelli attesi.
#[cfg(target_os = "macos")]
const MODEL_INVALID: &str = "Il modello vocale locale è incompleto o diverso da quello atteso.";
const UNSUPPORTED: &str = "La dettatura locale non è disponibile su questo computer.";

/// Fuori da macOS la sessione resta sempre non disponibile: gli altri stati
/// nascono solo dal motore whisper.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum State {
    /// Modello vocale non installato: nessuna dettatura finché non si installa.
    ModelMissing,
    Disclosure,
    Preparing,
    Recording,
    Finalizing,
    PermissionDenied,
    Unavailable,
    Cancelled,
    Review,
}
impl State {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::ModelMissing => "Modello vocale non installato.",
            Self::Disclosure => {
                "L'audio viene trascritto sul Mac. Il testo resta qui da rivedere, anche se pronunci nomi o altri identificativi. Nessun invio alla chat o al modello."
            }
            Self::Preparing => "Verifica del permesso microfono e del modello vocale locale…",
            Self::Recording => "Registrazione in corso sul Mac.",
            Self::Finalizing => "Completamento della trascrizione locale…",
            Self::PermissionDenied => {
                "Permesso microfono negato. Puoi abilitarlo nelle Impostazioni di Sistema, Privacy e sicurezza, Microfono, e aprire una nuova richiesta."
            }
            Self::Unavailable => {
                "La dettatura locale si è interrotta e il testo non è stato conservato. Apri una nuova dettatura."
            }
            Self::Cancelled => "Registrazione scartata.",
            Self::Review => {
                "Rileggi e correggi il testo. Il trasferimento prepara una bozza; il salvataggio richiede un'altra conferma nella cartella selezionata."
            }
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
    synthetic: Option<(State, Zeroizing<String>)>,
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
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn synthetic(state: State, text: &str) -> Self {
        Self {
            synthetic: Some((state, Zeroizing::new(text.to_owned()))),
            ..Self::with_backend(Backend::Unsupported)
        }
    }
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn with_whisper(session: whisper::WhisperSession) -> Self {
        Self::with_backend(Backend::Whisper(session))
    }
    pub(crate) fn start(&self) {
        #[cfg(target_os = "macos")]
        if let Backend::Whisper(whisper) = &self.backend {
            whisper.start();
        }
    }
    pub(crate) fn stop(&self) {
        #[cfg(target_os = "macos")]
        if let Backend::Whisper(whisper) = &self.backend {
            whisper.stop();
        }
    }
    #[cfg(target_os = "macos")]
    fn model_invalid(&self) -> bool {
        matches!(&self.backend, Backend::Whisper(whisper)
            if whisper.problem() == Some(whisper::Problem::ModelInvalid))
    }
    /// Messaggio dello stato.
    pub(crate) fn message(&self, state: State) -> &'static str {
        if state != State::Unavailable {
            return state.message();
        }
        #[cfg(target_os = "macos")]
        if self.model_invalid() {
            return MODEL_INVALID;
        }
        match self.backend {
            Backend::Unsupported => UNSUPPORTED,
            #[cfg(target_os = "macos")]
            _ => state.message(),
        }
    }
    /// Dove la dettatura manca per il modello, assente o alterato, il gesto
    /// che porta a Impostazioni, Voce locale.
    pub(crate) fn model_action(&self, state: State) -> Option<&'static str> {
        match state {
            State::ModelMissing => Some("Installa il modello"),
            #[cfg(target_os = "macos")]
            State::Unavailable if self.model_invalid() => Some("Reinstalla il modello"),
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
            synthetic: Some((state, Zeroizing::default())),
            synthetic_live: Some(live),
            ..Self::with_backend(Backend::Unsupported)
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
            return matches!(self.state(), State::Recording | State::Finalizing)
                .then(|| LiveText {
                    confirmed: whisper.stable_text(),
                    provisional: whisper.provisional_text(),
                })
                .filter(|live| !live.confirmed.is_empty() || !live.provisional.is_empty());
        }
        None
    }
    pub(crate) fn state(&self) -> State {
        #[cfg(test)]
        if let Some((state, _)) = &self.synthetic {
            return *state;
        }
        match &self.backend {
            #[cfg(target_os = "macos")]
            Backend::Whisper(whisper) => whisper.state(),
            #[cfg(target_os = "macos")]
            Backend::ModelMissing => State::ModelMissing,
            Backend::Unsupported => State::Unavailable,
        }
    }
    pub(crate) fn transcript(&self) -> Option<Zeroizing<String>> {
        #[cfg(test)]
        if let Some((state, text)) = &self.synthetic {
            return reviewed_text(*state, text);
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
    (state == State::Review
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
            State::ModelMissing,
            State::Disclosure,
            State::Preparing,
            State::Recording,
            State::Finalizing,
            State::PermissionDenied,
            State::Unavailable,
            State::Cancelled,
        ] {
            assert!(reviewed_text(state, text).is_none());
        }
        assert_eq!(
            reviewed_text(State::Review, text)
                .as_deref()
                .map(String::as_str),
            Some(text)
        );
        assert!(reviewed_text(State::Review, "  ").is_none());
        assert!(reviewed_text(State::Review, &"è".repeat(12_001)).is_none());
    }
}
