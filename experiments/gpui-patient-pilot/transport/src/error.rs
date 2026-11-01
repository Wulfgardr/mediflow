use std::{error::Error, fmt};

pub type Result<T> = std::result::Result<T, RuntimeError>;

/// Sanitized errors: never contain a URL, credential, server body or clinical text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeError {
    InvalidInput,
    UnsupportedUnlock,
    PinConfirmationRequired,
    LegacyAccessNeedsWeb,
    UnsupportedProtocol,
    Authentication,
    Forbidden,
    Missing,
    Conflict,
    ArchiveReplaced,
    AnalyticsCancelled,
    Locked,
    LockedField,
    ReadRequired,
    Busy,
    TooLarge,
    ProfileTooLarge,
    Crypto,
    InvalidResponse,
    Transport,
    Indeterminate,
    Rejected(u16),
}

impl RuntimeError {
    pub fn is_conflict(&self) -> bool {
        matches!(self, Self::Conflict)
    }
    pub fn is_indeterminate(&self) -> bool {
        matches!(self, Self::Indeterminate)
    }
    pub fn is_auth_failure(&self) -> bool {
        matches!(self, Self::Authentication | Self::Locked)
    }
    pub fn retires_session(&self) -> bool {
        self.is_auth_failure() || *self == Self::ArchiveReplaced
    }
    pub fn status_code(&self) -> Option<u16> {
        match self {
            Self::Authentication => Some(401),
            Self::Forbidden => Some(403),
            Self::Missing => Some(404),
            Self::Conflict | Self::ArchiveReplaced => Some(409),
            Self::AnalyticsCancelled => Some(409),
            Self::Rejected(status) => Some(*status),
            Self::ProfileTooLarge => Some(413),
            _ => None,
        }
    }
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "Configurazione o dati non validi.",
            Self::PinConfirmationRequired => "Questo archivio usa il PIN. Il testo inserito è lungo come una frase di accesso: inseriscilo di nuovo e scegli Accedi con il PIN precedente solo se è il tuo PIN.",
            Self::UnsupportedUnlock => "Aggiorna MediFlow sul computer dell’ambulatorio e su questo dispositivo, poi riapri l’archivio. Questa versione non riconosce il metodo di accesso.",
            Self::LegacyAccessNeedsWeb => "Per gestire questo metodo di accesso, apri MediFlow nel browser sul computer dell’ambulatorio, accedi con il PIN e scegli Impostazioni, Accesso, Passa dal PIN alla passphrase. Salva il kit e la chiave di recupero, conferma e torna qui usando la nuova frase di accesso.",
            Self::UnsupportedProtocol => "Aggiorna Mediflow sul computer che ospita l’archivio per usare questa versione.",
            Self::Authentication => "Accesso non valido o sessione scaduta. Accedi di nuovo.",
            Self::Forbidden => "L'operatore o il dispositivo non è autorizzato a questa operazione.",
            Self::Missing => "La risorsa non è disponibile in questo ambulatorio.",
            Self::Conflict => "La versione è cambiata. Rileggi i dati prima di confermare una nuova modifica.",
            Self::ArchiveReplaced => "L'archivio è stato ripristinato da una copia. Riapri l'archivio prima di continuare.",
            Self::AnalyticsCancelled => "La lettura della popolazione è stata annullata.",
            Self::Locked => "Sessione bloccata. Accedi di nuovo.",
            Self::LockedField => "Un campo cifrato non è leggibile. La modifica è bloccata.",
            Self::ReadRequired => "Ricarica la scheda prima di modificarla.",
            Self::Busy => "Un salvataggio è già in corso. Attendi il suo esito.",
            Self::TooLarge => "Il contenuto supera la dimensione consentita.",
            Self::ProfileTooLarge => "Il profilo supera il limite di lettura di questo pilota.",
            Self::Crypto => "Impossibile verificare o proteggere i dati cifrati.",
            Self::InvalidResponse => "Non è stato possibile verificare la risposta dell’archivio.",
            Self::Transport => "Impossibile contattare il computer che ospita l’archivio o verificare la connessione.",
            Self::Indeterminate => "Esito del salvataggio da verificare. Ricarica i dati dall’archivio prima di inviare un’altra modifica.",
            Self::Rejected(_) => "Mediflow ha rifiutato l'operazione. Nessun salvataggio è confermato.",
        })
    }
}
impl Error for RuntimeError {}
