use zeroize::Zeroizing;

#[cfg(target_os = "macos")]
pub(crate) mod listening;
#[cfg(target_os = "macos")]
pub(crate) mod model;
#[cfg(target_os = "macos")]
pub(crate) mod whisper;

#[cfg(target_os = "macos")]
const MODEL_INVALID: &str = "Il modello vocale locale è incompleto o diverso da quello atteso. Reinstallalo avviando MediFlow GPUI con --installa-modello-voce.";
#[cfg(target_os = "macos")]
const ENGINE_FAILED: &str = "La dettatura locale si è interrotta e il testo non è stato conservato. Apri una nuova dettatura.";
#[cfg(target_os = "macos")]
const WHISPER_PREPARING: &str = "Verifica del permesso microfono e del modello vocale locale…";
#[cfg(target_os = "macos")]
const APPLE_UNAVAILABLE_WITH_MODEL_HINT: &str = "Trascrizione Apple locale non disponibile. Servono macOS 26 o successivo e le risorse italiane già installate, oppure il modello vocale locale: avvia MediFlow GPUI con --installa-modello-voce. Non viene usato alcun servizio remoto.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum State {
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
    fn decode(code: i32) -> Self {
        match code {
            0 => Self::Disclosure,
            1 => Self::Preparing,
            2 => Self::Recording,
            3 => Self::Finalizing,
            4 => Self::PermissionDenied,
            6 => Self::Cancelled,
            7 => Self::Review,
            _ => Self::Unavailable,
        }
    }
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Disclosure => {
                "L'audio viene trascritto sul Mac. Il testo resta qui da rivedere, anche se pronunci nomi o altri identificativi. Nessun invio alla chat o al modello."
            }
            Self::Preparing => "Verifica del permesso microfono e delle risorse Apple locali…",
            Self::Recording => "Registrazione in corso sul Mac.",
            Self::Finalizing => "Completamento della trascrizione locale…",
            Self::PermissionDenied => {
                "Permesso microfono negato. Puoi abilitarlo nelle Impostazioni di Sistema, Privacy e sicurezza, Microfono, e aprire una nuova richiesta."
            }
            Self::Unavailable => {
                "Trascrizione Apple locale non disponibile. Servono macOS 26 o successivo e le risorse italiane già installate. Non viene usato alcun servizio remoto."
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

pub(crate) struct Session {
    #[cfg(test)]
    synthetic: Option<(State, Zeroizing<String>)>,
    #[cfg(local_voice_apple)]
    pointer: *mut std::ffi::c_void,
    /// Motore whisper: si usa solo se il modello è installato.
    #[cfg(target_os = "macos")]
    whisper: Option<whisper::WhisperSession>,
}
#[cfg(local_voice_apple)]
unsafe extern "C" {
    fn MFVoiceCreate() -> *mut std::ffi::c_void;
    fn MFVoiceCommand(pointer: *mut std::ffi::c_void, command: i32);
    fn MFVoicePoll(pointer: *mut std::ffi::c_void) -> i32;
    fn MFVoiceCopyText(pointer: *mut std::ffi::c_void, output: *mut u8, capacity: usize) -> usize;
    fn MFVoiceRelease(pointer: *mut std::ffi::c_void);
}
impl Session {
    /// `prompt`: nomi dei farmaci del paziente aperto, solo per il motore whisper.
    pub(crate) fn new(prompt: Zeroizing<String>) -> Self {
        #[cfg(local_voice_apple)]
        if let Some(whisper) = Self::whisper(prompt) {
            return Self {
                #[cfg(test)]
                synthetic: None,
                pointer: std::ptr::null_mut(),
                whisper: Some(whisper),
            };
        }
        #[cfg(not(local_voice_apple))]
        drop(prompt);
        Self {
            #[cfg(test)]
            synthetic: None,
            #[cfg(local_voice_apple)]
            pointer: unsafe { MFVoiceCreate() },
            #[cfg(target_os = "macos")]
            whisper: None,
        }
    }
    /// Se nella cartella dei modelli c'è un file del modello whisper si usa
    /// whisper (e un file alterato rende la voce non disponibile); se la
    /// cartella è vuota resta il motore Apple.
    #[cfg(local_voice_apple)]
    fn whisper(prompt: Zeroizing<String>) -> Option<whisper::WhisperSession> {
        let directory = model::directory()?;
        if model::quick_status(&directory, &model::FILES) == model::ModelStatus::Missing {
            return None;
        }
        let capture = whisper::swift::SwiftCapture::new()?;
        Some(whisper::WhisperSession::new(
            whisper::Engine {
                directory,
                files: model::FILES,
                prompt,
            },
            Box::new(capture),
        ))
    }
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn synthetic(state: State, text: &str) -> Self {
        Self {
            synthetic: Some((state, Zeroizing::new(text.to_owned()))),
            #[cfg(local_voice_apple)]
            pointer: std::ptr::null_mut(),
            whisper: None,
        }
    }
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn with_whisper(session: whisper::WhisperSession) -> Self {
        Self {
            synthetic: None,
            #[cfg(local_voice_apple)]
            pointer: std::ptr::null_mut(),
            whisper: Some(session),
        }
    }
    pub(crate) fn start(&self) {
        #[cfg(target_os = "macos")]
        if let Some(whisper) = &self.whisper {
            whisper.start();
            return;
        }
        #[cfg(local_voice_apple)]
        unsafe {
            MFVoiceCommand(self.pointer, 1)
        }
    }
    pub(crate) fn stop(&self) {
        #[cfg(target_os = "macos")]
        if let Some(whisper) = &self.whisper {
            whisper.stop();
            return;
        }
        #[cfg(local_voice_apple)]
        unsafe {
            MFVoiceCommand(self.pointer, 2)
        }
    }
    /// Messaggio dello stato per il motore in uso.
    pub(crate) fn message(&self, state: State) -> &'static str {
        #[cfg(target_os = "macos")]
        match (&self.whisper, state) {
            (Some(_), State::Preparing) => return WHISPER_PREPARING,
            (Some(whisper), State::Unavailable) => {
                return match whisper.problem() {
                    Some(whisper::Problem::ModelInvalid) => MODEL_INVALID,
                    _ => ENGINE_FAILED,
                };
            }
            (None, State::Unavailable) => return APPLE_UNAVAILABLE_WITH_MODEL_HINT,
            _ => {}
        }
        state.message()
    }
    /// Testo mentre si parla (solo whisper): da mostrare, mai modificabile né
    /// trasferibile.
    pub(crate) fn live_text(&self) -> Option<LiveText> {
        #[cfg(target_os = "macos")]
        if let Some(whisper) = &self.whisper {
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
        #[cfg(target_os = "macos")]
        if let Some(whisper) = &self.whisper {
            return whisper.state();
        }
        #[cfg(local_voice_apple)]
        {
            State::decode(unsafe { MFVoicePoll(self.pointer) })
        }
        #[cfg(not(local_voice_apple))]
        {
            State::decode(5)
        }
    }
    pub(crate) fn transcript(&self) -> Option<Zeroizing<String>> {
        #[cfg(test)]
        if let Some((state, text)) = &self.synthetic {
            return reviewed_text(*state, text);
        }
        #[cfg(target_os = "macos")]
        if let Some(whisper) = &self.whisper {
            return whisper
                .transcript()
                .and_then(|text| reviewed_text(whisper.state(), &text));
        }
        #[cfg(local_voice_apple)]
        {
            if self.state() != State::Review {
                return None;
            }
            let mut bytes = Zeroizing::new(vec![0; 256 * 1024]);
            let count = unsafe { MFVoiceCopyText(self.pointer, bytes.as_mut_ptr(), bytes.len()) };
            if count == 0 || count > bytes.len() {
                return None;
            }
            Some(Zeroizing::new(
                std::str::from_utf8(&bytes[..count]).ok()?.to_owned(),
            ))
        }
        #[cfg(not(local_voice_apple))]
        {
            None
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        #[cfg(local_voice_apple)]
        if !self.pointer.is_null() {
            unsafe { MFVoiceRelease(self.pointer) }
        }
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
