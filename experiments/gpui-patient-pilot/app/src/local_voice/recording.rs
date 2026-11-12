//! Macchina a stati della registrazione. Cinque stati visibili (pronta, in
//! registrazione, in pausa, ferma, errore) e una sola tabella di passaggi:
//! un evento che la tabella non prevede è illegale e lascia lo stato com'è.
//!
//! Il tempo trascorso conta solo i tratti in registrazione: la pausa lo
//! ferma, la ripresa lo fa ripartire da dove era.

// Fuori da macOS non c'è motore: la macchina resta in errore e gli eventi
// del microfono non nascono mai.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::time::{Duration, Instant};

/// Perché la registrazione manca o si è fermata.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Fault {
    /// Modello vocale non installato.
    ModelMissing,
    /// File del modello presenti ma diversi da quelli attesi.
    ModelInvalid,
    PermissionDenied,
    /// Il microfono non si apre all'avvio.
    MicrophoneMissing,
    /// Il microfono si chiude o smette di consegnare audio dopo l'avvio.
    MicrophoneLost,
    /// Il motore di trascrizione si è fermato.
    EngineFailed,
    /// Sistema senza cattura per whisper.
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum State {
    /// Consenso e avvio: microfono chiuso.
    Disclosure,
    /// Verifica del modello e apertura del microfono, all'avvio o alla ripresa.
    Preparing,
    Recording,
    /// Microfono chiuso; si riprende con un gesto.
    Paused,
    /// Microfono chiuso, ultime frasi in trascrizione.
    Finalizing,
    Review,
    Cancelled,
    Error(Fault),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Event {
    Start,
    /// Il microfono consegna audio.
    CaptureRunning,
    Pause,
    Resume,
    Stop,
    /// Trascrizione delle ultime frasi completata.
    Finished,
    Cancel,
    PermissionDenied,
    /// Il microfono non si apre, si chiude o smette di consegnare audio.
    CaptureFailed,
    ModelInvalid,
    EngineFailed,
}

#[cfg(test)]
impl Event {
    pub(crate) const ALL: [Self; 11] = [
        Self::Start,
        Self::CaptureRunning,
        Self::Pause,
        Self::Resume,
        Self::Stop,
        Self::Finished,
        Self::Cancel,
        Self::PermissionDenied,
        Self::CaptureFailed,
        Self::ModelInvalid,
        Self::EngineFailed,
    ];
}

/// I cinque stati che la vista mostra sempre.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Visible {
    Ready,
    Recording,
    Paused,
    Stopped,
    Error,
}

/// Forma dell'indicatore: ogni stato visibile ne ha una sua, oltre al colore.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Shape {
    /// Cerchio vuoto.
    Ring,
    /// Cerchio pieno.
    Dot,
    /// Due barre verticali.
    Bars,
    /// Quadrato pieno.
    Square,
    /// Punto esclamativo in un riquadro.
    Alert,
}

impl Visible {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Ready => "Pronta",
            Self::Recording => "In registrazione",
            Self::Paused => "In pausa",
            Self::Stopped => "Ferma",
            Self::Error => "Errore",
        }
    }
    pub(crate) fn shape(self) -> Shape {
        match self {
            Self::Ready => Shape::Ring,
            Self::Recording => Shape::Dot,
            Self::Paused => Shape::Bars,
            Self::Stopped => Shape::Square,
            Self::Error => Shape::Alert,
        }
    }
    /// Nome stabile per i selettori delle prove.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Recording => "recording",
            Self::Paused => "paused",
            Self::Stopped => "stopped",
            Self::Error => "error",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Illegal {
    pub(crate) state: State,
    pub(crate) event: Event,
}

/// Tabella dei passaggi. `recorded`: c'è già stato almeno un tratto in
/// registrazione (decide fra microfono assente e microfono perso, e se si può
/// terminare mentre il microfono si riapre).
pub(crate) fn next(state: State, event: Event, recorded: bool) -> Option<State> {
    use Event as E;
    use State::*;
    Some(match (state, event) {
        (Disclosure, E::Start) => Preparing,
        (Preparing, E::CaptureRunning) => Recording,
        (Recording, E::Pause) => Paused,
        (Paused, E::Resume) => Preparing,
        (Recording | Paused, E::Stop) => Finalizing,
        (Preparing, E::Stop) if recorded => Finalizing,
        (Finalizing, E::Finished) => Review,
        (
            Disclosure | Preparing | Recording | Paused | Finalizing | Review | Error(_),
            E::Cancel,
        ) => Cancelled,
        (Preparing, E::PermissionDenied) => Error(Fault::PermissionDenied),
        (Preparing, E::CaptureFailed) if !recorded => Error(Fault::MicrophoneMissing),
        (Preparing | Recording, E::CaptureFailed) => Error(Fault::MicrophoneLost),
        (Preparing, E::ModelInvalid) if !recorded => Error(Fault::ModelInvalid),
        // Anche in pausa: la frase aperta alla pausa si trascrive dopo il gesto.
        (Preparing | Recording | Paused | Finalizing, E::EngineFailed) => {
            Error(Fault::EngineFailed)
        }
        _ => return None,
    })
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Machine {
    state: State,
    /// Tempo in registrazione dei tratti già chiusi.
    recorded: Duration,
    /// Inizio del tratto in corso.
    since: Option<Instant>,
    /// Almeno un tratto è stato in registrazione.
    has_recorded: bool,
}

impl Default for Machine {
    fn default() -> Self {
        Self::new()
    }
}

impl Machine {
    pub(crate) fn new() -> Self {
        Self {
            state: State::Disclosure,
            recorded: Duration::ZERO,
            since: None,
            has_recorded: false,
        }
    }
    /// Sessione che non può partire: modello assente, sistema non supportato.
    pub(crate) fn failed(fault: Fault) -> Self {
        Self {
            state: State::Error(fault),
            ..Self::new()
        }
    }
    /// Per le prove: macchina già in `state`, con `elapsed` di registrazione.
    #[cfg(test)]
    pub(crate) fn at(state: State, elapsed: Duration, now: Instant) -> Self {
        let running = state == State::Recording;
        Self {
            state,
            recorded: if running { Duration::ZERO } else { elapsed },
            since: running.then(|| now.checked_sub(elapsed).unwrap_or(now)),
            has_recorded: running
                || !elapsed.is_zero()
                || matches!(state, State::Paused | State::Finalizing | State::Review),
        }
    }
    pub(crate) fn state(&self) -> State {
        self.state
    }
    pub(crate) fn has_recorded(&self) -> bool {
        self.has_recorded
    }
    pub(crate) fn allows(&self, event: Event) -> bool {
        next(self.state, event, self.has_recorded).is_some()
    }
    pub(crate) fn apply(&mut self, event: Event, now: Instant) -> Result<State, Illegal> {
        let Some(state) = next(self.state, event, self.has_recorded) else {
            return Err(Illegal {
                state: self.state,
                event,
            });
        };
        if let Some(since) = self.since.take() {
            self.recorded += now.saturating_duration_since(since);
        }
        if state == State::Recording {
            self.since = Some(now);
            self.has_recorded = true;
        }
        self.state = state;
        Ok(state)
    }
    /// Tempo in registrazione fino a `now`, pause escluse.
    pub(crate) fn elapsed(&self, now: Instant) -> Duration {
        self.recorded
            + self
                .since
                .map_or(Duration::ZERO, |since| now.saturating_duration_since(since))
    }
    #[cfg(test)]
    pub(crate) fn visible(&self) -> Visible {
        self.visible_for(self.state)
    }
    /// Stato visibile di `state` con la storia di questa macchina: la vista
    /// può mostrare un errore al posto di una fine senza testo.
    pub(crate) fn visible_for(&self, state: State) -> Visible {
        match state {
            State::Disclosure => Visible::Ready,
            // Il microfono non consegna ancora audio: prima dell'avvio la
            // registrazione è pronta, alla ripresa resta in pausa.
            State::Preparing if self.has_recorded => Visible::Paused,
            State::Preparing => Visible::Ready,
            State::Recording => Visible::Recording,
            State::Paused => Visible::Paused,
            State::Finalizing | State::Review | State::Cancelled => Visible::Stopped,
            State::Error(_) => Visible::Error,
        }
    }
}

/// Tempo trascorso come lo mostra l'indicatore: «03:12», «1:05:09».
pub(crate) fn clock(elapsed: Duration) -> String {
    let seconds = elapsed.as_secs();
    let (hours, minutes, seconds) = (seconds / 3600, seconds / 60 % 60, seconds % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_STATES: [State; 14] = [
        State::Disclosure,
        State::Preparing,
        State::Recording,
        State::Paused,
        State::Finalizing,
        State::Review,
        State::Cancelled,
        State::Error(Fault::ModelMissing),
        State::Error(Fault::ModelInvalid),
        State::Error(Fault::PermissionDenied),
        State::Error(Fault::MicrophoneMissing),
        State::Error(Fault::MicrophoneLost),
        State::Error(Fault::EngineFailed),
        State::Error(Fault::Unsupported),
    ];

    /// Ogni coppia stato-evento, con e senza un tratto già registrato: i
    /// passaggi legali sono esattamente questi, tutto il resto è illegale.
    #[test]
    fn every_transition_is_listed_and_everything_else_is_illegal() {
        use Event as E;
        use State::*;
        let legal = |state: State, event: Event, recorded: bool| -> Option<State> {
            Some(match (state, event, recorded) {
                (Disclosure, E::Start, _) => Preparing,
                (Preparing, E::CaptureRunning, _) => Recording,
                (Recording, E::Pause, _) => Paused,
                (Paused, E::Resume, _) => Preparing,
                (Recording, E::Stop, _) | (Paused, E::Stop, _) | (Preparing, E::Stop, true) => {
                    Finalizing
                }
                (Finalizing, E::Finished, _) => Review,
                (Cancelled, E::Cancel, _) => return None,
                (_, E::Cancel, _) => Cancelled,
                (Preparing, E::PermissionDenied, _) => Error(Fault::PermissionDenied),
                (Preparing, E::CaptureFailed, false) => Error(Fault::MicrophoneMissing),
                (Preparing, E::CaptureFailed, true) | (Recording, E::CaptureFailed, _) => {
                    Error(Fault::MicrophoneLost)
                }
                (Preparing, E::ModelInvalid, false) => Error(Fault::ModelInvalid),
                (Preparing | Recording | Paused | Finalizing, E::EngineFailed, _) => {
                    Error(Fault::EngineFailed)
                }
                _ => return None,
            })
        };
        let mut checked = 0;
        let mut allowed = 0;
        for state in ALL_STATES {
            for event in Event::ALL {
                for recorded in [false, true] {
                    let expected = legal(state, event, recorded);
                    assert_eq!(
                        next(state, event, recorded),
                        expected,
                        "{state:?} + {event:?} (recorded: {recorded})"
                    );
                    checked += 1;
                    allowed += usize::from(expected.is_some());
                }
            }
        }
        assert_eq!(checked, 14 * 11 * 2);
        // Per ciascun valore di `recorded`: pronta 2, apertura 6, registrazione 5,
        // pausa 4, completamento 3, revisione 1, scartata 0, sette errori 1.
        assert_eq!(allowed, 2 * (2 + 6 + 5 + 4 + 3 + 1 + 7));
    }

    #[test]
    fn illegal_events_leave_state_and_clock_untouched() {
        let t0 = Instant::now();
        let at = |s: u64| t0 + Duration::from_secs(s);
        let mut machine = Machine::new();
        for event in [Event::Pause, Event::Resume, Event::Stop, Event::Finished] {
            assert_eq!(
                machine.apply(event, at(1)),
                Err(Illegal {
                    state: State::Disclosure,
                    event
                })
            );
        }
        machine.apply(Event::Start, at(1)).unwrap();
        machine.apply(Event::CaptureRunning, at(2)).unwrap();
        machine.apply(Event::Stop, at(12)).unwrap();
        machine.apply(Event::Finished, at(13)).unwrap();
        assert_eq!(machine.state(), State::Review);
        // Pausa, ripresa e nuovo avvio da ferma: illegali, il tempo resta 10 s.
        for event in [Event::Pause, Event::Resume, Event::Start, Event::Stop] {
            assert!(machine.apply(event, at(30)).is_err(), "{event:?}");
            assert_eq!(machine.state(), State::Review);
            assert_eq!(machine.elapsed(at(40)), Duration::from_secs(10));
        }
        assert_eq!(machine.visible(), Visible::Stopped);
    }

    #[test]
    fn the_clock_runs_only_while_recording() {
        let t0 = Instant::now();
        let at = |s: u64| t0 + Duration::from_secs(s);
        let mut machine = Machine::new();
        machine.apply(Event::Start, at(0)).unwrap();
        assert_eq!(machine.visible(), Visible::Ready);
        assert_eq!(machine.elapsed(at(5)), Duration::ZERO, "mic not open yet");
        machine.apply(Event::CaptureRunning, at(5)).unwrap();
        assert_eq!(machine.visible(), Visible::Recording);
        assert_eq!(clock(machine.elapsed(at(65))), "01:00");
        machine.apply(Event::Pause, at(65)).unwrap();
        assert_eq!(machine.visible(), Visible::Paused);
        assert_eq!(clock(machine.elapsed(at(600))), "01:00", "pause stops it");
        machine.apply(Event::Resume, at(600)).unwrap();
        assert_eq!(
            machine.visible(),
            Visible::Paused,
            "still paused until audio flows"
        );
        assert_eq!(clock(machine.elapsed(at(601))), "01:00");
        machine.apply(Event::CaptureRunning, at(601)).unwrap();
        assert_eq!(clock(machine.elapsed(at(601 + 3_909))), "1:06:09");
        machine.apply(Event::CaptureFailed, at(661)).unwrap();
        assert_eq!(machine.state(), State::Error(Fault::MicrophoneLost));
        assert_eq!(clock(machine.elapsed(at(9_999))), "02:00", "frozen at loss");
    }

    #[test]
    fn microphone_missing_before_recording_and_lost_after() {
        let now = Instant::now();
        let mut opening = Machine::new();
        opening.apply(Event::Start, now).unwrap();
        assert_eq!(
            opening.apply(Event::CaptureFailed, now),
            Ok(State::Error(Fault::MicrophoneMissing))
        );
        let mut midway = Machine::new();
        midway.apply(Event::Start, now).unwrap();
        midway.apply(Event::CaptureRunning, now).unwrap();
        assert_eq!(
            midway.apply(Event::CaptureFailed, now),
            Ok(State::Error(Fault::MicrophoneLost))
        );
        // Alla ripresa dopo una pausa il microfono che non si riapre è perso,
        // non assente: c'è già testo registrato.
        let mut resumed = Machine::new();
        resumed.apply(Event::Start, now).unwrap();
        resumed.apply(Event::CaptureRunning, now).unwrap();
        resumed.apply(Event::Pause, now).unwrap();
        resumed.apply(Event::Resume, now).unwrap();
        assert!(resumed.allows(Event::Stop));
        assert!(!resumed.allows(Event::ModelInvalid));
        assert_eq!(
            resumed.apply(Event::CaptureFailed, now),
            Ok(State::Error(Fault::MicrophoneLost))
        );
        assert_eq!(resumed.visible(), Visible::Error);
    }

    #[test]
    fn five_visible_states_have_distinct_shapes_and_labels() {
        let all = [
            Visible::Ready,
            Visible::Recording,
            Visible::Paused,
            Visible::Stopped,
            Visible::Error,
        ];
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a.shape(), b.shape(), "{a:?} {b:?}");
                assert_ne!(a.label(), b.label(), "{a:?} {b:?}");
                assert_ne!(a.key(), b.key(), "{a:?} {b:?}");
            }
        }
        // Ogni stato della macchina ricade in uno dei cinque.
        let failed = Machine::failed(Fault::ModelMissing);
        assert_eq!(failed.visible(), Visible::Error);
        assert!(!failed.allows(Event::Start));
        assert!(failed.allows(Event::Cancel));
    }

    #[test]
    fn clock_format() {
        assert_eq!(clock(Duration::ZERO), "00:00");
        assert_eq!(clock(Duration::from_millis(59_999)), "00:59");
        assert_eq!(clock(Duration::from_secs(600)), "10:00");
        assert_eq!(clock(Duration::from_secs(3_599)), "59:59");
        assert_eq!(clock(Duration::from_secs(3_600)), "1:00:00");
    }
}
