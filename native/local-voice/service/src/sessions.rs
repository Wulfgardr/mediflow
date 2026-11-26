use crate::stream::{self, Feed, Refused};
use mediflow_local_voice::whisper::{AudioSource, WhisperSession};
use mediflow_local_voice::{
    Event, Fault, State, drug_review, recording::Machine, reviewed_text, voices,
};
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

pub const MAX_SUBJECT: usize = 128;
pub const MAX_VOCABULARY: usize = 200;
pub const DRAIN_LIMIT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Dictation,
    Visit,
}

impl Mode {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "dictation" => Some(Self::Dictation),
            "visit" => Some(Self::Visit),
            _ => None,
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::Dictation => "dictation",
            Self::Visit => "visit",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Start,
    Pause,
    Resume,
    Stop,
}

impl Command {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "start" => Some(Self::Start),
            "pause" => Some(Self::Pause),
            "resume" => Some(Self::Resume),
            "stop" => Some(Self::Stop),
            _ => None,
        }
    }
    pub fn event(self) -> Event {
        match self {
            Self::Start => Event::Start,
            Self::Pause => Event::Pause,
            Self::Resume => Event::Resume,
            Self::Stop => Event::Stop,
        }
    }
    pub fn drains(self) -> bool {
        matches!(self, Self::Pause | Self::Stop)
    }
}

pub type Factory =
    Box<dyn Fn(Box<dyn AudioSource>, Zeroizing<String>) -> WhisperSession + Send + Sync>;

pub struct Active {
    pub id: String,
    subject: Zeroizing<String>,
    mode: Mode,
    vocabulary: Zeroizing<Vec<String>>,
    voice: WhisperSession,
    feed: Feed,
}

pub fn valid_subject(subject: &str) -> bool {
    (1..=MAX_SUBJECT).contains(&subject.len())
        && subject
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
}

impl Active {
    pub fn open(
        id: String,
        subject: String,
        mode: Mode,
        vocabulary: Vec<String>,
        factory: &Factory,
    ) -> Self {
        let (feed, source) = stream::channel();
        let prompt =
            mediflow_local_voice::whisper::vocabulary_prompt(vocabulary.iter().map(String::as_str));
        let voice = factory(Box::new(source), prompt);
        if mode == Mode::Visit {
            voice.set_two_voices(true);
        }
        Self {
            id,
            subject: Zeroizing::new(subject),
            mode,
            vocabulary: Zeroizing::new(vocabulary),
            voice,
            feed,
        }
    }
    pub fn state(&self) -> State {
        self.voice.state()
    }
    pub fn replaceable(&self) -> bool {
        let state = self.state();
        state == State::Cancelled || matches!(state, State::Error(_)) && !state.reviewable()
    }
    pub fn feed(&self) -> Feed {
        self.feed.clone()
    }
    pub fn push(&self, pcm: &[u8]) -> Result<usize, Refused> {
        if !matches!(self.state(), State::Preparing | State::Recording) {
            return Err(Refused::Closed);
        }
        self.feed.push(pcm)
    }
    pub fn allows(&self, command: Command) -> bool {
        self.voice.machine().allows(command.event())
    }
    pub fn send(&self, command: Command) {
        match command {
            Command::Pause => self.feed.hold(),
            Command::Resume => self.feed.release(),
            Command::Start | Command::Stop => {}
        }
        self.voice.send(command.event());
    }
    pub fn close(self, limit: Duration) -> bool {
        self.feed.close();
        let Self { voice, .. } = self;
        voice.close(limit)
    }
    fn review(&self, state: State) -> Option<Value> {
        let attributed = self.voice.attributed();
        let (text, lines) = if attributed.is_empty() {
            (
                self.voice
                    .transcript()
                    .and_then(|t| reviewed_text(state, &t))?,
                Vec::new(),
            )
        } else {
            let pairs: Vec<(voices::Speaker, &str)> =
                attributed.iter().map(|(s, t)| (*s, t.as_str())).collect();
            let lines = self
                .voice
                .segments()
                .iter()
                .zip(&pairs)
                .filter(|(_, (_, t))| !t.trim().is_empty())
                .map(|(segment, (speaker, text))| {
                    json!({
                        "speaker": speaker_key(*speaker),
                        "text": text.trim(),
                        "startMs": segment.start * 1_000 / stream::SAMPLE_RATE,
                        "endMs": segment.end * 1_000 / stream::SAMPLE_RATE,
                    })
                })
                .collect();
            (reviewed_text(state, &voices::draft(&pairs))?, lines)
        };
        let suggestions: Vec<Value> =
            drug_review::suggestions(&text, self.vocabulary.iter().map(String::as_str))
                .into_iter()
                .map(|s| {
                    json!({
                        "start": utf16(&text[..s.range.start]),
                        "end": utf16(&text[..s.range.end]),
                        "original": s.original,
                        "replacement": s.replacement,
                    })
                })
                .collect();
        Some(json!({ "text": text.as_str(), "lines": lines, "drugSuggestions": suggestions }))
    }
    pub fn snapshot(&self) -> Value {
        let machine: Machine = self.voice.machine();
        let state = machine.state();
        let live = matches!(
            state,
            State::Preparing | State::Recording | State::Paused | State::Finalizing
        )
        .then(|| {
            let confirmed = self.voice.stable_text();
            let provisional = self.voice.provisional_text();
            json!({ "confirmed": confirmed.as_str(), "provisional": provisional.as_str() })
        });
        let review = if state.reviewable() {
            self.review(state)
        } else {
            None
        };
        let allowed: Vec<&str> = [
            Command::Start,
            Command::Pause,
            Command::Resume,
            Command::Stop,
        ]
        .into_iter()
        .filter(|c| machine.allows(c.event()))
        .map(command_key)
        .collect();
        json!({
            "id": self.id,
            "subject": self.subject.as_str(),
            "mode": self.mode.key(),
            "state": state_key(state),
            "fault": fault_key(state),
            "visible": machine.visible_for(state).key(),
            "elapsedMs": u64::try_from(machine.elapsed(Instant::now()).as_millis()).unwrap_or(u64::MAX),
            "limitReached": self.voice.limit_reached(),
            "allowed": allowed,
            "acceptedSamples": self.feed.accepted(),
            "pendingSamples": self.feed.pending(),
            "live": live,
            "review": review,
        })
    }
}

fn utf16(prefix: &str) -> usize {
    prefix.encode_utf16().count()
}

fn speaker_key(speaker: voices::Speaker) -> &'static str {
    match speaker {
        voices::Speaker::Doctor => "doctor",
        voices::Speaker::Patient => "patient",
    }
}

fn command_key(command: Command) -> &'static str {
    match command {
        Command::Start => "start",
        Command::Pause => "pause",
        Command::Resume => "resume",
        Command::Stop => "stop",
    }
}

pub fn state_key(state: State) -> &'static str {
    match state {
        State::Disclosure => "ready",
        State::Preparing => "preparing",
        State::Recording => "recording",
        State::Paused => "paused",
        State::Finalizing => "finalizing",
        State::Review => "review",
        State::Cancelled => "cancelled",
        State::Error(_) => "error",
    }
}

pub fn fault_key(state: State) -> Option<&'static str> {
    let State::Error(fault) = state else {
        return None;
    };
    Some(match fault {
        Fault::ModelMissing => "model-missing",
        Fault::ModelInvalid => "model-invalid",
        Fault::PermissionDenied => "permission-denied",
        Fault::MicrophoneMissing => "audio-missing",
        Fault::MicrophoneLost => "audio-lost",
        Fault::EngineFailed => "engine-failed",
        Fault::Unsupported => "unsupported",
    })
}
