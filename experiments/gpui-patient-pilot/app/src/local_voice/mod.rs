use zeroize::Zeroizing;

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

pub(crate) struct Session {
    #[cfg(test)]
    synthetic: Option<(State, Zeroizing<String>)>,
    #[cfg(local_voice_apple)]
    pointer: *mut std::ffi::c_void,
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
    pub(crate) fn new() -> Self {
        Self {
            #[cfg(test)]
            synthetic: None,
            #[cfg(local_voice_apple)]
            pointer: unsafe { MFVoiceCreate() },
        }
    }
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn synthetic(state: State, text: &str) -> Self {
        Self {
            synthetic: Some((state, Zeroizing::new(text.to_owned()))),
            #[cfg(local_voice_apple)]
            pointer: std::ptr::null_mut(),
        }
    }
    pub(crate) fn start(&self) {
        #[cfg(local_voice_apple)]
        unsafe {
            MFVoiceCommand(self.pointer, 1)
        }
    }
    pub(crate) fn stop(&self) {
        #[cfg(local_voice_apple)]
        unsafe {
            MFVoiceCommand(self.pointer, 2)
        }
    }
    pub(crate) fn state(&self) -> State {
        #[cfg(test)]
        if let Some((state, _)) = &self.synthetic {
            return *state;
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
