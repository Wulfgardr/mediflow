use super::native::{self, Peer};
#[cfg(all(test, target_os = "macos"))]
use mediflow_runtime_client::ChatWriteOutcome;
use mediflow_runtime_client::{
    ChatAccessContext, ChatWriteKind, ChatWriteRecovery, ChatWriteResolution, RuntimeSession,
};
use std::{
    os::unix::net::UnixStream,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

pub(crate) const OPERATION: &str = "mediflow.chat.synthetic-card.v1";
const CHALLENGE: Duration = Duration::from_secs(30);
const VIEW_IDLE: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum State {
    Requested,
    DocumentOpened,
    VoiceOpened,
    Preparing,
    Selecting,
    Challenge,
    Approving,
    Approved,
    Consuming,
    Consumed,
    Withdrawn,
    Write(ChatWriteResolution),
}
impl State {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::DocumentOpened => "document-opened",
            Self::VoiceOpened => "voice-opened",
            Self::Preparing => "preparing",
            Self::Selecting => "selecting",
            Self::Challenge => "challenge",
            Self::Approving => "approving",
            Self::Approved => "approved",
            Self::Consuming => "consuming",
            Self::Consumed => "consumed",
            Self::Withdrawn => "withdrawn",
            Self::Write(resolution) => resolution.wire(),
        }
    }
}

struct Binding {
    session: RuntimeSession,
    context: ChatAccessContext,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Attempt([u8; 32]);
impl Attempt {
    pub(crate) fn biometric(&self) -> Result<(), &'static str> {
        native::biometric(&self.0)
    }
}
pub(crate) struct TherapyWrite {
    pub(crate) target: String,
    view_id: Option<String>,
    pub(crate) rows: Vec<mediflow_runtime_client::Therapy>,
    pub(crate) selected: Option<(usize, String)>,
    pub(crate) result: Option<serde_json::Value>,
    /// Agenda seen when the booking view opened and the instant chosen in the native window.
    pub(crate) booking: Option<BookingDraft>,
}
#[derive(Clone, Default)]
pub(crate) struct BookingDraft {
    pub(crate) agenda: Option<mediflow_runtime_client::ChatBookingView>,
    pub(crate) chosen: Option<String>,
}
impl TherapyWrite {
    pub(crate) fn is_booking(&self) -> bool {
        self.target.starts_with("booking")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BookingDateError {
    Format,
    Range,
    /// Skipped by the move to daylight saving time.
    Nonexistent,
    /// Repeated by the return to standard time.
    Ambiguous,
}
impl BookingDateError {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Format => "Scrivi data e ora come GG/MM/AAAA HH:MM.",
            Self::Range => "Scegli una data da oggi a due anni.",
            Self::Nonexistent => {
                "Quest’ora non esiste: in quella notte gli orologi passano all’ora legale. Scegli un altro orario."
            }
            Self::Ambiguous => {
                "Quest’ora si ripete: in quella notte gli orologi tornano all’ora solare. Scegli un altro orario."
            }
        }
    }
}

/// Parses the physician's local `GG/MM/AAAA HH:MM`: from today (local day) up to two years ahead.
pub(crate) fn booking_instant(
    text: &str,
    now: chrono::DateTime<chrono::Local>,
) -> Result<String, BookingDateError> {
    booking_instant_in(text, now, &chrono::Local)
}
fn booking_instant_in<Tz: chrono::TimeZone>(
    text: &str,
    now: chrono::DateTime<Tz>,
    zone: &Tz,
) -> Result<String, BookingDateError> {
    use chrono::{Duration as Days, LocalResult, NaiveDateTime, Utc};
    let naive = NaiveDateTime::parse_from_str(text.trim(), "%d/%m/%Y %H:%M")
        .map_err(|_| BookingDateError::Format)?;
    let local = match zone.from_local_datetime(&naive) {
        LocalResult::Single(local) => local,
        LocalResult::None => return Err(BookingDateError::Nonexistent),
        LocalResult::Ambiguous(..) => return Err(BookingDateError::Ambiguous),
    };
    if local.date_naive() < now.date_naive() || local > now + Days::days(730) {
        return Err(BookingDateError::Range);
    }
    Ok(local
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}
pub(crate) struct ClinicalSelection {
    pub(crate) copies: std::collections::BTreeMap<usize, String>,
    pub(crate) editing: Option<usize>,
    pub(crate) profile: Option<mediflow_runtime_client::PatientDetail>,
    pub(crate) diagnoses: Vec<String>,
    pub(crate) excerpts: Vec<String>,
    pub(crate) selected: Vec<usize>,
}
pub(crate) struct Request {
    attempt: Attempt,
    state: State,
    peer: Peer,
    stream: UnixStream,
    lock_epoch: u64,
    created: Instant,
    clock: Arc<dyn Fn() -> Instant + Send + Sync>,
    deadline: Option<Instant>,
    binding: Option<Binding>,
    card: Option<super::card::Card>,
    pub(crate) clinical: Option<ClinicalSelection>,
    pub(crate) clinical_denial: Option<String>,
    cancelled: Arc<AtomicBool>,
    therapy: Option<TherapyWrite>,
    document: bool,
    voice: bool,
    recovery: Option<ChatWriteRecovery>,
    catalog: Option<(String, String, String)>,
    catalog_query: Option<String>,
    prosthetics: bool,
    agenda: bool,
    pub(crate) references: super::references::CommandReferences,
}
pub(crate) type Pending = Arc<Mutex<Request>>;

impl Request {
    pub(super) fn new(peer: Peer, stream: UnixStream) -> Option<Pending> {
        Self::with_clock(peer, stream, Arc::new(Instant::now))
    }
    fn with_clock(
        peer: Peer,
        stream: UnixStream,
        clock: Arc<dyn Fn() -> Instant + Send + Sync>,
    ) -> Option<Pending> {
        let mut nonce = [0; 32];
        getrandom::fill(&mut nonce).ok()?;
        Some(Arc::new(Mutex::new(Self {
            attempt: Attempt(nonce),
            state: State::Requested,
            peer,
            stream,
            lock_epoch: native::lock_epoch(),
            created: clock(),
            clock,
            deadline: None,
            binding: None,
            card: None,
            clinical: None,
            clinical_denial: None,
            cancelled: Arc::new(AtomicBool::new(false)),
            therapy: None,
            document: false,
            voice: false,
            recovery: None,
            catalog: None,
            catalog_query: None,
            prosthetics: false,
            agenda: false,
            references: super::references::CommandReferences::default(),
        })))
    }
    pub(super) fn for_drugs(peer: Peer, stream: UnixStream, query: &str) -> Option<Pending> {
        if !(2..=80).contains(&query.chars().count()) || query.chars().any(char::is_control) {
            return None;
        }
        let request = Self::new(peer, stream)?;
        request.lock().ok()?.catalog_query = Some(query.to_owned());
        Some(request)
    }
    pub(super) fn for_prosthetics(peer: Peer, stream: UnixStream, query: &str) -> Option<Pending> {
        let request = Self::for_drugs(peer, stream, query)?;
        request.lock().ok()?.prosthetics = true;
        Some(request)
    }
    pub(super) fn for_agenda(peer: Peer, stream: UnixStream) -> Option<Pending> {
        let request = Self::for_drugs(peer, stream, "agenda")?;
        request.lock().ok()?.agenda = true;
        Some(request)
    }
    pub(crate) fn is_agenda(&self) -> bool {
        self.agenda
    }
    pub(crate) fn is_catalog(&self) -> bool {
        self.catalog_query.is_some()
    }
    pub(crate) fn is_prosthetics_catalog(&self) -> bool {
        self.prosthetics
    }
    pub(super) fn for_document(peer: Peer, stream: UnixStream) -> Option<Pending> {
        let request = Self::new(peer, stream)?;
        request.lock().ok()?.document = true;
        Some(request)
    }
    pub(crate) fn document_requested(&mut self) -> bool {
        self.document && self.status() == State::Requested
    }
    pub(crate) fn finish_document_open(&mut self, opened: bool) {
        if !self.document_requested() || !opened {
            self.withdraw();
            return;
        }
        self.state = State::DocumentOpened;
    }
    pub(super) fn for_voice(peer: Peer, stream: UnixStream) -> Option<Pending> {
        let request = Self::new(peer, stream)?;
        request.lock().ok()?.voice = true;
        Some(request)
    }
    pub(crate) fn voice_requested(&mut self) -> bool {
        self.voice && self.status() == State::Requested
    }
    pub(crate) fn finish_voice_open(&mut self, opened: bool) {
        if !self.voice_requested() || !opened {
            self.withdraw();
            return;
        }
        self.state = State::VoiceOpened;
    }
    pub(super) fn for_therapy(peer: Peer, stream: UnixStream, target: &str) -> Option<Pending> {
        let request = Self::new(peer, stream)?;
        request.lock().ok()?.therapy = Some(TherapyWrite {
            target: target.into(),
            view_id: None,
            rows: Vec::new(),
            selected: None,
            result: None,
            booking: target.starts_with("booking").then(BookingDraft::default),
        });
        Some(request)
    }
    pub(super) fn for_booking(peer: Peer, stream: UnixStream) -> Option<Pending> {
        Self::for_therapy(peer, stream, "booking")
    }
    pub(super) fn for_booking_receipt(peer: Peer, stream: UnixStream, id: &str) -> Option<Pending> {
        let request = Self::for_therapy(peer, stream, "booking-receipt")?;
        request.lock().ok()?.therapy.as_mut()?.selected = Some((0, id.into()));
        Some(request)
    }
    pub(super) fn for_receipt(peer: Peer, stream: UnixStream, id: &str) -> Option<Pending> {
        let request = Self::for_therapy(peer, stream, "receipt")?;
        request.lock().ok()?.therapy.as_mut()?.selected = Some((0, id.into()));
        Some(request)
    }
    pub(crate) fn therapy(&self) -> Option<&TherapyWrite> {
        self.therapy.as_ref()
    }
    pub(crate) fn safe_result(&self) -> Option<serde_json::Value> {
        let therapy = self.therapy.as_ref()?;
        let (_, id) = therapy.selected.as_ref()?;
        let outcome = match self.state {
            State::Write(ChatWriteResolution::Uncertain) => "unknown",
            State::Write(ChatWriteResolution::Confirmed(outcome)) => outcome.wire(),
            State::Consumed => "unknown",
            _ => "pending",
        };
        Some(serde_json::json!({"commandId":id,"outcome":outcome}))
    }
    pub(crate) fn app(&self) -> &'static str {
        self.peer.app()
    }
    pub(crate) fn withdraw(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        native::cancel_biometric(&self.attempt.0);
        self.card = None;
        self.clinical = None;
        self.catalog = None;
        self.attempt.0.fill(0);
        if self.therapy.as_ref().is_some_and(|t| t.selected.is_some()) {
            if !matches!(
                self.state,
                State::Write(ChatWriteResolution::Confirmed(_))
                    | State::Write(ChatWriteResolution::Uncertain)
            ) {
                self.reconcile_therapy();
            }
            if let Some(t) = self.therapy.as_mut() {
                t.rows.clear();
                t.result = None;
            }
        } else {
            self.state = State::Withdrawn;
            self.therapy = None;
        }
        self.binding = None;
    }
    pub(crate) fn detach(&mut self) {
        self.withdraw();
        self.recovery = None;
    }
    pub(crate) fn revoke(&mut self) {
        if self.state == State::Write(ChatWriteResolution::Uncertain) {
            self.reconcile_therapy();
        } else {
            self.withdraw();
        }
    }
    pub(crate) fn reconcile_therapy(&mut self) {
        self.state = State::Write(
            self.recovery
                .as_ref()
                .map_or(ChatWriteResolution::Uncertain, ChatWriteRecovery::reconcile),
        );
        self.deadline = None;
        if let State::Write(ChatWriteResolution::Confirmed(outcome)) = self.state
            && let Some((_, id)) = self.therapy.as_ref().and_then(|t| t.selected.as_ref())
        {
            let _ = self.references.confirm(id, outcome);
        }
    }

    fn current(&self, now: Instant) -> bool {
        now.duration_since(self.created) < VIEW_IDLE
            && !native::screen_locked()
            && native::lock_epoch() == self.lock_epoch
            && self.peer.current(&self.stream)
            && self.deadline.is_none_or(|deadline| now < deadline)
            && self
                .binding
                .as_ref()
                .is_none_or(|b| b.session.check_chat_access_context(&b.context).is_ok())
    }
    pub(crate) fn status(&mut self) -> State {
        if !matches!(
            self.state,
            State::Withdrawn
                | State::Write(ChatWriteResolution::Uncertain)
                | State::Write(ChatWriteResolution::Confirmed(_))
        ) && !self.current((self.clock)())
        {
            self.withdraw();
        }
        self.state
    }
    pub(crate) fn bind(&mut self, session: RuntimeSession, context: ChatAccessContext) -> bool {
        if self.status() != State::Requested || session.check_chat_access_context(&context).is_err()
        {
            self.withdraw();
            return false;
        }
        self.references = self.references.for_session(&session);
        self.binding = Some(Binding { session, context });
        self.state = State::Preparing;
        true
    }
    pub(crate) fn review(&self) -> Option<(&str, &str, &str)> {
        if let Some((payload, digest, source)) = &self.catalog {
            return Some((payload, digest, source));
        }
        let card = self.card.as_ref()?;
        Some((&card.payload, &card.digest, &card.native_source))
    }
    pub(super) fn request_clinical(&mut self) {
        self.clinical = Some(ClinicalSelection {
            copies: Default::default(),
            editing: None,
            profile: None,
            diagnoses: Vec::new(),
            excerpts: Vec::new(),
            selected: Vec::new(),
        });
    }
    pub(crate) fn add_excerpt(&mut self, text: &str) -> bool {
        if self.status() != State::Selecting {
            return false;
        }
        let Some(c) = self.clinical.as_mut() else {
            return false;
        };
        let Some(notes) = c.profile.as_ref().and_then(|p| p.notes.as_deref()) else {
            return false;
        };
        if !super::clinical::valid_excerpt(notes, text, &c.excerpts) {
            return false;
        }
        c.excerpts.push(text.into());
        true
    }
    pub(crate) fn edit_clinical(&mut self, index: usize) -> Option<String> {
        if self.status() != State::Selecting {
            return None;
        }
        let c = self.clinical.as_mut()?;
        let text = c
            .copies
            .get(&index)
            .or_else(|| c.diagnoses.iter().chain(c.excerpts.iter()).nth(index))?
            .clone();
        c.editing = Some(index);
        Some(text)
    }
    pub(crate) fn save_clinical_copy(&mut self, text: &str) -> bool {
        if self.status() != State::Selecting
            || text.trim().is_empty()
            || text.encode_utf16().count() > 2048
        {
            return false;
        }
        let Some(c) = self.clinical.as_mut() else {
            return false;
        };
        let Some(index) = c.editing.take() else {
            return false;
        };
        c.copies.insert(index, text.to_owned());
        self.clinical_denial = None;
        true
    }
    pub(crate) fn toggle_clinical(&mut self, index: usize) {
        if self.status() != State::Selecting {
            return;
        }
        if let Some(c) = self.clinical.as_mut()
            && index < c.diagnoses.len() + c.excerpts.len()
        {
            if c.selected.contains(&index) {
                c.selected.retain(|i| *i != index);
            } else {
                c.selected.push(index);
            }
        }
    }
    pub(crate) fn needs_card(&mut self) -> bool {
        self.status() == State::Preparing
    }
    fn install_card(&mut self, card: Option<super::card::Card>) {
        if self.clinical.is_some() && self.status() == State::Preparing {
            if card.as_ref().is_none_or(|c| c.denial.is_some()) {
                self.clinical_denial = Some(card.as_ref().and_then(|c| c.denial.clone()).unwrap_or_else(|| "Condivisione negata. Togli o riformula una delle righe selezionate: possibili identificativi o rilevatore non disponibile. Nessun byte condiviso.".into()));
                self.state = State::Selecting;
                return;
            }
            self.clinical_denial = None;
        }
        if self.status() != State::Preparing || card.is_none() {
            self.withdraw();
            return;
        }
        self.card = card;
        self.deadline = Some((self.clock)() + CHALLENGE);
        self.state = State::Challenge;
    }
    pub(crate) fn begin_confirmation(
        &mut self,
        with_pin: bool,
    ) -> Option<(RuntimeSession, ChatAccessContext, Attempt)> {
        if self.therapy.is_some() && !with_pin {
            return None;
        }
        self.begin()
    }
    pub(crate) fn begin(&mut self) -> Option<(RuntimeSession, ChatAccessContext, Attempt)> {
        if self.status() != State::Challenge
            || self.therapy.as_ref().is_some_and(|t| t.selected.is_none())
        {
            return None;
        }
        self.state = State::Approving;
        self.binding
            .as_ref()
            .map(|b| (b.session.clone(), b.context.clone(), self.attempt))
    }
    pub(crate) fn finish(&mut self, attempt: Attempt, accepted: bool) {
        if attempt != self.attempt || self.status() != State::Approving {
            self.withdraw();
            return;
        }
        self.state = if accepted {
            State::Approved
        } else {
            State::Challenge
        };
    }
    pub(crate) fn prepare_biometric(&mut self) -> bool {
        self.status() == State::Approving && native::prepare_biometric(&self.attempt.0)
    }
    fn begin_consume(&mut self) -> Option<(RuntimeSession, ChatAccessContext)> {
        if self.status() != State::Approved {
            self.withdraw();
            return None;
        }
        self.state = State::Consuming;
        self.binding
            .as_ref()
            .map(|b| (b.session.clone(), b.context.clone()))
    }
    fn finish_consume(&mut self, valid: bool) -> State {
        if !valid || self.status() != State::Consuming {
            self.withdraw();
            return self.state;
        }
        self.state = State::Consumed;
        self.created = (self.clock)();
        self.deadline = None;
        self.attempt.0.fill(0);
        self.state
    }
}

pub(crate) fn choose_therapy(pending: &Pending, index: usize) {
    let binding = pending.lock().ok().and_then(|mut p| {
        if p.status() != State::Challenge {
            return None;
        }
        let t = p.therapy.as_ref()?;
        if t.selected.is_some() {
            return None;
        }
        let row = t.rows.get(index)?.clone();
        let target = t.target.clone();
        let b = p.binding.as_ref()?;
        let result = (
            b.session.clone(),
            b.context.clone(),
            row,
            target,
            t.view_id.clone()?,
        );
        p.state = State::Preparing;
        Some(result)
    });
    let Some((session, context, row, target, view_id)) = binding else {
        return;
    };
    let result = session
        .preview_chat_therapy(&context, &row, &target, &view_id)
        .and_then(|id| {
            session
                .chat_therapy_recovery(&context, &id)
                .map(|recovery| (id, recovery))
        });
    if let Ok(mut p) = pending.lock() {
        if p.status() != State::Preparing {
            return;
        }
        if let Ok((id, recovery)) = result {
            if p.references
                .remember_kind(&id, ChatWriteKind::TherapyStatus)
                .is_err()
            {
                p.state = State::Write(recovery.reconcile());
                return;
            }
            p.recovery = Some(recovery);
            if let Some(t) = p.therapy.as_mut() {
                t.selected = Some((index, id));
            }
            p.deadline = Some((p.clock)() + CHALLENGE);
            p.state = State::Challenge;
        } else {
            p.withdraw();
        }
    }
}

/// Sends the instant the physician typed to a one-shot server preview bound to the agenda revision.
pub(crate) fn choose_booking(pending: &Pending, text: &str) -> bool {
    let binding = pending.lock().ok().and_then(|mut p| {
        if p.status() != State::Challenge {
            return None;
        }
        let t = p.therapy.as_ref().filter(|t| t.is_booking())?;
        if t.selected.is_some() {
            return None;
        }
        let instant = booking_instant(text, chrono::Local::now()).ok()?;
        let revision = t.booking.as_ref()?.agenda.as_ref()?.revision.clone();
        let view_id = t.view_id.clone()?;
        let b = p.binding.as_ref()?;
        let result = (
            b.session.clone(),
            b.context.clone(),
            revision,
            instant,
            view_id,
        );
        p.state = State::Preparing;
        Some(result)
    });
    let Some((session, context, revision, instant, view_id)) = binding else {
        return false;
    };
    let result = session
        .preview_chat_booking(&context, &revision, &instant, &view_id)
        .and_then(|id| {
            session
                .chat_booking_recovery(&context, &id)
                .map(|recovery| (id, recovery))
        });
    let Ok(mut p) = pending.lock() else {
        return false;
    };
    if p.status() != State::Preparing {
        return false;
    }
    let Ok((id, recovery)) = result else {
        p.withdraw();
        return false;
    };
    if p.references
        .remember_kind(&id, ChatWriteKind::CheckupBooking)
        .is_err()
    {
        p.state = State::Write(recovery.reconcile());
        return false;
    }
    p.recovery = Some(recovery);
    if let Some(t) = p.therapy.as_mut() {
        t.selected = Some((0, id));
        if let Some(booking) = t.booking.as_mut() {
            booking.chosen = Some(text.trim().to_owned());
        }
    }
    p.deadline = Some((p.clock)() + CHALLENGE);
    p.state = State::Challenge;
    true
}

pub(crate) fn execute_therapy(pending: &Pending, attempt: Attempt, pin: &str) -> bool {
    let binding = pending.lock().ok().and_then(|mut p| {
        if attempt != p.attempt || p.status() != State::Approving {
            return None;
        }
        let t = p.therapy.as_ref()?;
        let booking = t.is_booking();
        let (_, id) = t.selected.as_ref()?;
        let b = p.binding.as_ref()?;
        let kind = if booking {
            ChatWriteKind::CheckupBooking
        } else {
            ChatWriteKind::TherapyStatus
        };
        p.references.remember_kind(id, kind).ok()?;
        let result = (b.session.clone(), b.context.clone(), id.clone(), booking);
        p.state = State::Consuming;
        Some(result)
    });
    let Some((session, context, id, booking)) = binding else {
        return false;
    };
    let request = |body: serde_json::Value| {
        if booking {
            session.chat_booking_request(&context, &body)
        } else {
            session.chat_therapy_request(&context, &body)
        }
    };
    let result = request(serde_json::json!({"operation":"execute","commandId":id,"pin":pin}));
    let receipt = request(serde_json::json!({"operation":"receipt","commandId":id})).ok();
    if let Ok(mut p) = pending.lock()
        && p.status() == State::Consuming
    {
        p.reconcile_therapy();
        if let Some(t) = p.therapy.as_mut() {
            t.result = receipt;
        }
    }
    result.is_ok()
}

pub(crate) fn prepare_card(pending: &Pending) {
    if !pending.lock().is_ok_and(|mut p| p.needs_card()) {
        return;
    }
    let Some(cancelled) = pending.lock().ok().map(|p| p.cancelled.clone()) else {
        return;
    };
    let catalog_binding = pending.lock().ok().and_then(|p| {
        let query = p.catalog_query.clone()?;
        let b = p.binding.as_ref()?;
        Some((b.session.clone(), b.context.clone(), query))
    });
    if let Some((session, context, query)) = catalog_binding {
        let prosthetics = pending.lock().is_ok_and(|p| p.prosthetics);
        let agenda = pending.lock().is_ok_and(|p| p.agenda);
        let result = if agenda {
            session.chat_agenda(&context)
        } else if prosthetics {
            session.chat_prosthetics_search(&context, &query)
        } else {
            session.chat_drug_search(&context, &query).map(|rows| serde_json::json!({"rows": rows.iter().map(|r| serde_json::json!({
                "aic":r.aic, "name":r.name, "activePrinciple":r.active_principle, "packaging":r.packaging, "atc":r.atc
            })).collect::<Vec<_>>(), "truncated":rows.len() == 20}))
        };
        if let Ok(mut p) = pending.lock() {
            if p.status() != State::Preparing {
                return;
            }
            if let Ok(rows) = result {
                use sha2::{Digest, Sha256};
                let mut projected = rows["rows"].as_array().cloned().unwrap_or_default();
                for (index, row) in projected.iter_mut().enumerate() {
                    row["sourceRef"] = serde_json::json!(format!(
                        "src_{}",
                        &format!(
                            "{:x}",
                            Sha256::digest([p.attempt.0.as_slice(), &index.to_le_bytes()].concat())
                        )[..32]
                    ));
                }
                let mut value = serde_json::json!({"profile":if agenda {"mediflow.internal-agenda.v1"} else if prosthetics {"mediflow.prosthetics-catalog.v1"} else {"mediflow.drug-catalog.v1"}, "query":query,
                    "freshness":"unverified", "limit":20, "rows":projected});
                if agenda {
                    value["query"] = serde_json::json!("internal");
                }
                if prosthetics || agenda {
                    value["truncated"] = rows["truncated"].clone();
                }
                let payload = value.to_string();
                if payload.len() > 60000 {
                    p.withdraw();
                    return;
                }
                let digest = format!("{:x}", Sha256::digest(payload.as_bytes()));
                p.catalog = Some((payload, digest, if agenda {
                    "Agenda interna MediFlow. Primi 20 controlli per data. Solo date e stati; la lettura non prenota nulla e non include candidati da calendario."
                } else {
                    "Catalogo locale. Data di aggiornamento non verificata. Massimo 20 risultati; affinare la ricerca se il limite è raggiunto."
                }.into()));
                p.deadline = Some((p.clock)() + CHALLENGE);
                p.state = State::Challenge;
            } else {
                p.withdraw();
            }
        }
        return;
    }
    let therapy_binding = pending.lock().ok().and_then(|p| {
        p.therapy.as_ref()?;
        let b = p.binding.as_ref()?;
        Some((b.session.clone(), b.context.clone()))
    });
    if let Some((session, context)) = therapy_binding {
        let recovery = pending.lock().ok().and_then(|p| {
            let t = p.therapy.as_ref()?;
            if !t.target.ends_with("receipt") {
                return None;
            }
            Some((t.selected.as_ref()?.1.clone(), t.is_booking()))
        });
        if let Some((id, booking)) = recovery {
            // The stored kind owns the reference; the button only names it when nothing is stored.
            // A booking reread of a reference stored as another kind asks no route and stays uncertain,
            // so the other route's marker is neither read nor removed here.
            let stored = pending.lock().ok().and_then(|p| p.references.kind(&id));
            let button = booking.then_some(ChatWriteKind::CheckupBooking);
            let kind = stored.or(button);
            let mismatch =
                matches!((stored, button), (Some(stored), Some(button)) if stored != button);
            let recovery = if mismatch {
                Err(mediflow_runtime_client::RuntimeError::Forbidden)
            } else {
                session.chat_write_recovery_for(&context, &id, kind)
            };
            if let Ok(mut p) = pending.lock() {
                if p.status() != State::Preparing {
                    return;
                }
                p.recovery = recovery.ok();
                if !mismatch {
                    let _ = match kind {
                        Some(kind) => p.references.remember_kind(&id, kind),
                        None => p.references.remember(&id),
                    };
                }
                p.reconcile_therapy();
            }
            return;
        }
        if pending
            .lock()
            .is_ok_and(|p| p.therapy.as_ref().is_some_and(TherapyWrite::is_booking))
        {
            let view = session.chat_booking_open(&context);
            if let Ok(mut p) = pending.lock() {
                if p.status() != State::Preparing {
                    return;
                }
                match (view, p.therapy.as_mut()) {
                    (Ok(view), Some(t)) => {
                        t.view_id = Some(view.view_id.clone());
                        t.booking = Some(BookingDraft {
                            agenda: Some(view),
                            chosen: None,
                        });
                        p.state = State::Challenge;
                    }
                    _ => p.withdraw(),
                }
            }
            return;
        }
        let rows = session.chat_therapy_rows(&context);
        if let Ok(mut p) = pending.lock() {
            if p.status() != State::Preparing {
                return;
            }
            if let Ok((rows, view_id)) = rows {
                if let Some(t) = p.therapy.as_mut() {
                    t.rows = rows;
                    t.view_id = Some(view_id);
                }
                p.state = State::Challenge;
            } else {
                p.withdraw();
            }
        }
        return;
    }
    let clinical = pending.lock().ok().and_then(|p| {
        p.clinical.as_ref()?;
        let b = p.binding.as_ref()?;
        Some((b.session.clone(), b.context.clone()))
    });
    if let Some((session, context)) = clinical {
        let profile = session.chat_clinical_profile(&context);
        if let Ok(mut p) = pending.lock() {
            if p.status() != State::Preparing {
                return;
            }
            if let Ok(profile) = profile {
                let c = p.clinical.as_mut().unwrap();
                c.diagnoses = profile
                    .diagnoses
                    .as_deref()
                    .unwrap_or("")
                    .lines()
                    .filter(|t| !t.trim().is_empty())
                    .map(str::to_owned)
                    .collect();
                c.profile = Some(profile);
                p.state = State::Selecting;
            } else {
                p.withdraw();
            }
        }
        return;
    }
    let card = super::card::Card::prepare(cancelled, None);
    if let Ok(mut p) = pending.lock() {
        p.install_card(card);
    }
}

pub(crate) fn prepare_clinical(pending: &Pending) {
    let work = pending.lock().ok().and_then(|mut p| {
        if p.status() != State::Selecting {
            return None;
        }
        let c = p.clinical.as_ref()?;
        let profile = c.profile.as_ref()?;
        let diagnoses: Vec<_> = c
            .diagnoses
            .iter()
            .enumerate()
            .filter(|(i, _)| c.selected.contains(i))
            .map(|(_, t)| t.clone())
            .collect();
        let excerpts: Vec<_> = c
            .excerpts
            .iter()
            .enumerate()
            .filter(|(i, _)| c.selected.contains(&(i + c.diagnoses.len())))
            .map(|(_, t)| t.clone())
            .collect();
        if diagnoses.len() > 16
            || excerpts.len() > 8
            || diagnoses.len() + excerpts.len() == 0
        {
            return None;
        }
        let diagnoses: Vec<_> = c.diagnoses.iter().enumerate().filter(|(i, _)| c.selected.contains(i))
            .map(|(i, t)| c.copies.get(&i).unwrap_or(t).clone()).collect();
        let excerpts: Vec<_> = c.excerpts.iter().enumerate().filter(|(i, _)| c.selected.contains(&(i + c.diagnoses.len())))
            .map(|(i, t)| c.copies.get(&(i + c.diagnoses.len())).unwrap_or(t).clone()).collect();
        // Checked on the outgoing text: an edited copy must not bring the whole note back.
        if !super::clinical::partial_notes(profile.notes.as_deref().unwrap_or(""), &excerpts) {
            return None;
        }
        let b = p.binding.as_ref()?;
        let result = (
            b.session.clone(),
            b.context.clone(),
            profile.version,
            p.cancelled.clone(),
            serde_json::json!({"patient":b.session.chat_selection_mark()?, "selection":{"diagnoses":diagnoses, "noteExcerpts":excerpts}, "knownIdentifiers":super::clinical::known_identifiers(profile)}),
        );
        p.state = State::Preparing;
        Some(result)
    });
    let Some((session, context, revision, cancelled, selection)) = work else {
        return;
    };
    let card = session
        .chat_clinical_profile(&context)
        .ok()
        .filter(|p| p.version == revision)
        .and_then(|_| super::card::Card::prepare(cancelled, Some(selection)));
    if let Ok(mut p) = pending.lock() {
        p.install_card(card);
    }
}

pub(crate) fn consume_card(pending: &Pending) -> (State, Option<String>) {
    let binding = pending.lock().ok().and_then(|mut p| p.begin_consume());
    let agenda = pending.lock().is_ok_and(|p| p.agenda);
    let valid = binding.as_ref().is_some_and(|(s, c)| {
        s.revalidate_chat_access_context(c).is_ok() && (!agenda || s.chat_agenda(c).is_ok())
    });
    let revision = pending.lock().ok().and_then(|p| {
        p.clinical
            .as_ref()
            .and_then(|c| c.profile.as_ref().map(|p| p.version))
    });
    let valid = valid
        && revision.is_none_or(|revision| {
            binding.as_ref().is_some_and(|(s, c)| {
                s.chat_clinical_profile(c)
                    .is_ok_and(|p| p.version == revision)
            })
        });
    let mut payload = None;
    if valid
        && let Ok(mut p) = pending.lock()
        && p.status() == State::Consuming
    {
        payload = if let Some((bytes, _, _)) = p.catalog.take() {
            Some(bytes)
        } else {
            // Read now, not at binding: the clinical owner must see the selection of this moment.
            let selection = binding.as_ref().and_then(|(s, _)| s.chat_selection_mark());
            p.card
                .as_mut()
                .and_then(|c| c.consume(selection.as_deref()))
        };
    }
    let valid = payload.is_some()
        && binding.as_ref().is_some_and(|(s, c)| {
            s.revalidate_chat_access_context(c).is_ok()
                && revision.is_none_or(|revision| {
                    s.chat_clinical_profile(c)
                        .is_ok_and(|p| p.version == revision)
                })
        });
    let state = pending
        .lock()
        .map(|mut p| {
            let state = p.finish_consume(valid);
            p.card = None;
            state
        })
        .unwrap_or(State::Withdrawn);
    (
        state,
        if state == State::Consumed {
            payload
        } else {
            None
        },
    )
}

#[cfg(all(test, target_os = "macos"))]
pub(crate) fn consume(pending: &Pending) -> State {
    let binding = pending.lock().ok().and_then(|mut p| p.begin_consume());
    let valid = binding
        .is_some_and(|(session, context)| session.revalidate_chat_access_context(&context).is_ok());
    pending
        .lock()
        .map(|mut p| p.finish_consume(valid))
        .unwrap_or(State::Withdrawn)
}

impl Drop for Request {
    fn drop(&mut self) {
        self.withdraw();
    }
}

#[cfg(all(test, target_os = "macos"))]
pub(crate) mod tests {
    use super::*;
    use mediflow_runtime_client::{PairingCredentials, RuntimeClient, RuntimeConfig};
    use serde_json::{Value, json};
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::atomic::{AtomicUsize, Ordering},
    };

    pub(crate) struct Host {
        state: Arc<AtomicUsize>,
        /// Paired grant of the chat write routes: 0 both, 1 checkups only, 2 therapies only,
        /// 3 both announced by discovery while the host denies therapies.
        grants: Arc<AtomicUsize>,
        worker: Option<std::thread::JoinHandle<()>>,
    }
    impl Drop for Host {
        fn drop(&mut self) {
            self.state.store(2, Ordering::Release);
            self.worker.take().unwrap().join().unwrap();
        }
    }

    pub(crate) fn native_session() -> (RuntimeSession, Host) {
        native_session_as("synthetic-user")
    }
    pub(crate) fn native_session_as(user: &str) -> (RuntimeSession, Host) {
        let user = user.to_owned();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(AtomicUsize::new(0));
        let current = state.clone();
        let grants = Arc::new(AtomicUsize::new(0));
        let granted = grants.clone();
        let worker = std::thread::spawn(move || {
            let vector: Value = serde_json::from_str(include_str!(
                "../../../../../native/contracts/crypto-golden-vectors.v3.json"
            ))
            .unwrap();
            let ports: Value = serde_json::from_str(include_str!(
                "../../../transport/tests/fixtures/host-ports.json"
            ))
            .unwrap();
            while current.load(Ordering::Acquire) != 2 {
                let Ok((mut socket, _)) = crate::test_loopback::accept(&listener) else {
                    std::thread::sleep(Duration::from_millis(2));
                    continue;
                };
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 1024];
                loop {
                    let n = socket.read(&mut buffer).unwrap();
                    if n == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                        let length = header
                            .lines()
                            .find_map(|s| {
                                s.strip_prefix("content-length: ")
                                    .and_then(|s| s.parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                    assert!(bytes.len() <= 8192);
                }
                let first = String::from_utf8_lossy(&bytes)
                    .lines()
                    .next()
                    .unwrap()
                    .to_owned();
                let (status, body) = if current.load(Ordering::Acquire) == 1 {
                    (409, json!({"code":"ARCHIVE_REPLACED"}))
                } else if first.starts_with("GET /api/auth/check ") {
                    (
                        200,
                        json!({"status":"ok","isSetup":true,"archiveGeneration":"synthetic-generation",
                        "unlock":{"credential":"passphrase","kdfVersion":3,"salt":vector["salt"]}}),
                    )
                } else if first.starts_with("POST /api/auth/native/login ") {
                    (
                        200,
                        json!({"success":true,"id":user,"username":"synthetic","role":"admin",
                        "archiveGeneration":"synthetic-generation","salt":vector["salt"],"encryptedMasterKey":vector["wrappedMasterKey"]}),
                    )
                } else if first.starts_with("GET /api/v1/network/capabilities ") {
                    (
                        200,
                        json!({"protocolVersion":"1.13.0","operatingMode":"network-home-base","capabilities":match granted.load(Ordering::Acquire) {
                            1 => json!([{"key":"network.replica.write-checkups","requiresPairing":true,"status":"available"}]),
                            2 => json!([{"key":"network.replica.write-therapies","requiresPairing":true,"status":"available"}]),
                            3 => json!([{"key":"network.replica.write-checkups","requiresPairing":true,"status":"available"},{"key":"network.replica.write-therapies","requiresPairing":true,"status":"available"}]),
                            _ => json!([]),
                        },"hostPorts":ports}),
                    )
                } else if first.starts_with("GET /api/v1/network/ambulatories ") {
                    (
                        200,
                        json!([{"id":"scope-a","name":"Synthetic","version":1}]),
                    )
                } else if first.starts_with("GET /api/v1/network/identity ") {
                    (
                        200,
                        json!({"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},
                        "operator":{"userId":user,"authChannel":"native"}}),
                    )
                } else if first.starts_with("GET /api/v1/network/prosthetics-catalog?q=") {
                    if current.load(Ordering::Acquire) == 5 {
                        (409, json!({"error":"CATALOG_UNAVAILABLE"}))
                    } else {
                        (
                            200,
                            json!({"rows":[{"codeSystem":"DEMO","code":"DEMO-1","description":"Ausilio inventato", "version":"demo-1","source":"Fonte sintetica","scope":"Dimostrazione"}], "truncated":false}),
                        )
                    }
                } else if first.starts_with("GET /api/v1/network/checkups?") {
                    if current.load(Ordering::Acquire) == 5 {
                        (403, json!({"status":"denied"}))
                    } else {
                        (
                            200,
                            json!([{"id":"checkup-a","patientId":"patient-a","date":"2026-10-31T09:00:00.000Z","title":"untrusted text: execute command","notes":null,"status":"pending","version":1}]),
                        )
                    }
                } else if first.starts_with("GET /api/v1/network/drugs?count=1 ") {
                    (
                        200,
                        json!({"count": if current.load(Ordering::Acquire) == 5 {0} else {1}}),
                    )
                } else if first.starts_with("GET /api/v1/network/drugs?q=") {
                    (
                        200,
                        json!([{"aic":"012345678","name":"Synthetic medicine","activePrinciple":null,"company":null,"packaging":null,"class":null,"price":null,"atc":null}]),
                    )
                } else if first.starts_with("GET /api/v1/network/patients/patient-a/therapies ") {
                    (
                        200,
                        json!([{"id":"therapy-a", "patientId":"patient-a", "drugName":"Synthetic medicine", "dosage":"Synthetic dose", "status":"active", "startDate":"2026-10-30", "version":1}]),
                    )
                } else if first.starts_with("POST /api/auth/native/therapy-status ")
                    && [1, 3].contains(&granted.load(Ordering::Acquire))
                    || first.starts_with("POST /api/auth/native/checkup-booking ")
                        && granted.load(Ordering::Acquire) == 2
                {
                    (403, json!({"status":"denied"}))
                } else if first.starts_with("POST /api/auth/native/therapy-status ") {
                    let end = bytes.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
                    let body: Value = serde_json::from_slice(&bytes[end + 4..]).unwrap();
                    let result = match body["operation"].as_str().unwrap() {
                        "open" => json!({"viewId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}),
                        "preview" => {
                            json!({"commandId":body["command"]["commandId"],"status":"preview"})
                        }
                        "execute" => {
                            current.store(4, Ordering::Release);
                            json!({"outcome":"applied"})
                        }
                        "receipt"
                            if body["commandId"]
                                .as_str()
                                .is_some_and(|id| id.starts_with("cccccccc")) =>
                        {
                            json!({"outcome":"unknown"})
                        }
                        "receipt" => {
                            json!({"outcome":"terminal", "receipt":{"outcome":"applied"},"current":{"version":2,"status":"suspended"}})
                        }
                        "revoke"
                            if body["commandId"]
                                .as_str()
                                .is_some_and(|id| id.starts_with("cccccccc")) =>
                        {
                            json!({"outcome":"retired"})
                        }
                        "revoke" => {
                            json!({"outcome":if current.load(Ordering::Acquire) == 4 {"applied"} else {"retired"}})
                        }
                        _ => panic!("unexpected native test operation"),
                    };
                    (200, result)
                } else if first.starts_with("POST /api/auth/native/checkup-booking ") {
                    // 6: the agenda changes before execution; 7: the response is lost after the commit.
                    let end = bytes.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
                    let body: Value = serde_json::from_slice(&bytes[end + 4..]).unwrap();
                    let state = current.load(Ordering::Acquire);
                    let terminal = |outcome: &str| json!({"outcome":"terminal", "receipt":{"outcome":outcome},"current":null});
                    match body["operation"].as_str().unwrap() {
                        "open" => (
                            200,
                            json!({"viewId":"bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa","agendaRevision":"7".repeat(64),
                                "rows":if state == 9 {json!([{"date":"2026-11-15T09:00:00.000Z","status":"pending","title":"testo libero"}])} else {json!([{"date":"2026-11-15T09:00:00.000Z","status":"pending"},{"date":"2026-10-01T08:30:00.000Z","status":"completed"}])},
                                "omitted":3}),
                        ),
                        "preview" => {
                            let c = &body["command"];
                            if c.as_object().map(|o| o.len()) == Some(7)
                                && c["protocol"] == "checkup.booking.v1"
                                && c["expectedAgendaRevision"] == "7".repeat(64)
                                && c["title"] == "Controllo"
                                && c["patientId"] == "patient-a"
                                && c["date"].as_str().is_some_and(|d| d.ends_with(":00.000Z"))
                            {
                                (200, json!({"commandId":c["commandId"],"status":"preview"}))
                            } else {
                                (403, json!({"status":"denied"}))
                            }
                        }
                        "execute" if state == 6 => {
                            current.store(8, Ordering::Release);
                            (
                                200,
                                json!({"outcome":"rejected","reason":"version_conflict"}),
                            )
                        }
                        "execute" if state == 7 => {
                            current.store(4, Ordering::Release);
                            (503, json!({"status":"denied"}))
                        }
                        "execute" if body["pin"] != "2468" => (403, json!({"status":"denied"})),
                        "execute" => {
                            current.store(4, Ordering::Release);
                            (200, json!({"outcome":"applied"}))
                        }
                        "receipt" if state == 4 => (200, terminal("applied")),
                        "receipt" if state == 10 => (
                            200,
                            json!({"outcome":"terminal", "receipt":{"outcome":"applied","historical":true},"current":null}),
                        ),
                        "receipt" if state == 8 => (200, terminal("rejected")),
                        "receipt" => (200, json!({"outcome":"unknown"})),
                        "revoke" => (
                            200,
                            json!({"outcome":match state { 4 => "applied", 8 => "rejected", _ => "retired" }}),
                        ),
                        _ => panic!("unexpected native test operation"),
                    }
                } else if first.starts_with("GET /api/auth/native/chat-access-confirmation ") {
                    (200, json!({"status":"eligible"}))
                } else if first.starts_with("GET /api/v1/network/patient-profile/selection-epoch ")
                {
                    (
                        200,
                        json!({"contractVersion":1,"selectionEpoch":if current.load(Ordering::Acquire) == 3 {1}else{0}}),
                    )
                } else {
                    (503, json!({"status":"denied"}))
                };
                let body = body.to_string();
                write!(socket, "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nContent-Length: {}\r\nSet-Cookie: mediflow_session={}\r\nConnection: close\r\n\r\n{body}",body.len(), "a".repeat(64)).unwrap();
            }
        });
        let vector: Value = serde_json::from_str(include_str!(
            "../../../../../native/contracts/crypto-golden-vectors.v3.json"
        ))
        .unwrap();
        let session = RuntimeClient::new(RuntimeConfig {
            base_url: url,
            tls_pin_sha256: None,
        })
        .unwrap()
        .login(
            PairingCredentials::new("synthetic-chat-client", "b".repeat(32)).unwrap(),
            "synthetic",
            vector["passphrase"].as_str().unwrap(),
        )
        .unwrap();
        session.list_ambulatories().unwrap();
        session
            .select_profile_patient("scope-a", "patient-a")
            .unwrap();
        (
            session,
            Host {
                state,
                grants,
                worker: Some(worker),
            },
        )
    }

    #[test]
    fn clinical_copy_changes_only_the_local_selection_and_requires_an_edit_target() {
        let (pending, _remote, _session, _host) = clinical_request();
        let mut p = pending.lock().unwrap();
        let original = p.clinical.as_ref().unwrap().diagnoses[0].clone();
        assert!(!p.save_clinical_copy("Diabete mellito"));
        assert_eq!(p.edit_clinical(0), Some(original.clone()));
        assert!(!p.save_clinical_copy(""));
        assert!(p.save_clinical_copy("Diabete mellito"));
        let c = p.clinical.as_ref().unwrap();
        assert_eq!(c.diagnoses[0], original);
        assert_eq!(c.copies[&0], "Diabete mellito");
        assert!(c.selected.is_empty());
        assert!(p.review().is_none());
        assert!(!p.save_clinical_copy("altra copia"));
        assert!(p.edit_clinical(999).is_none());
    }
    #[test]
    fn clinical_denial_keeps_selection_local_and_never_enables_consent() {
        let (pending, _remote, _session, _host) = clinical_request();
        let mut p = pending.lock().unwrap();
        p.state = State::Preparing;
        p.install_card(None);
        assert_eq!(p.status(), State::Selecting);
        assert!(p.card.is_none());
        assert!(
            p.clinical_denial
                .as_ref()
                .unwrap()
                .contains("Nessun byte condiviso")
        );
        assert!(p.begin().is_none());
        assert!(p.clinical.is_some());
    }

    #[test]
    fn approved_clinical_card_is_withheld_when_the_profile_cannot_be_reread() {
        // The synthetic host never answers the profile query: the revision seen
        // at review can no longer be confirmed, so approved bytes must not leave.
        let (pending, _remote, _session, _host) = clinical_request();
        let mut p = pending.lock().unwrap();
        p.state = State::Preparing;
        p.install_card(Some(super::super::card::Card::synthetic()));
        assert_eq!(p.status(), State::Challenge);
        let (_, _, attempt) = p.begin().unwrap();
        p.finish(attempt, true);
        assert_eq!(p.status(), State::Approved);
        drop(p);
        assert_eq!(consume_card(&pending), (State::Withdrawn, None));
    }

    #[test]
    fn clinical_owner_selection_mark_changes_with_every_patient_selection() {
        let (pending, _remote, session, _host) = clinical_request();
        let first = session.chat_selection_mark().unwrap();
        assert_eq!(first.len(), 64);
        assert!(
            first
                .bytes()
                .all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))
        );
        assert!(!first.contains("patient-a") && !first.contains("Amina"));
        assert_eq!(
            session.chat_selection_mark().as_deref(),
            Some(first.as_str())
        );
        session
            .select_profile_patient("scope-a", "patient-b")
            .unwrap();
        let other = session.chat_selection_mark().unwrap();
        session
            .select_profile_patient("scope-a", "patient-a")
            .unwrap();
        let again = session.chat_selection_mark().unwrap();
        assert!(other != first && again != first && again != other);
        session.begin_profile_creation("scope-a").unwrap();
        assert_eq!(session.chat_selection_mark(), None);
        drop(pending);
    }

    pub(crate) fn clinical_request() -> (Pending, UnixStream, RuntimeSession, Host) {
        let (session, host) = native_session();
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (a, remote) = UnixStream::pair().unwrap();
        let request = Request::new(Peer::test_peer(), a).unwrap();
        {
            let mut p = request.lock().unwrap();
            p.request_clinical();
            assert!(p.bind(session.clone(), context));
            let c = p.clinical.as_mut().unwrap();
            c.profile = Some(serde_json::from_value(serde_json::json!({"id":"patient-a", "firstName":"Amina", "lastName":"Sintetica", "taxCode":"SYNTHETIC", "notes":"Passo clinico.\nAltra nota.", "version":1})).unwrap());
            c.diagnoses = vec!["Diagnosi sintetica".into()];
            p.state = State::Selecting;
        }
        (request, remote, session, host)
    }

    pub(crate) fn relogin(previous: &RuntimeSession) -> RuntimeSession {
        let vector: Value = serde_json::from_str(include_str!(
            "../../../../../native/contracts/crypto-golden-vectors.v3.json"
        ))
        .unwrap();
        let session = RuntimeClient::new(RuntimeConfig {
            base_url: previous.base_url().into(),
            tls_pin_sha256: None,
        })
        .unwrap()
        .login(
            PairingCredentials::new("synthetic-chat-client", "b".repeat(32)).unwrap(),
            "synthetic",
            vector["passphrase"].as_str().unwrap(),
        )
        .unwrap();
        session.list_ambulatories().unwrap();
        session
    }

    pub(crate) fn document_request() -> (Pending, UnixStream) {
        let (a, b) = UnixStream::pair().unwrap();
        (Request::for_document(Peer::test_peer(), a).unwrap(), b)
    }

    pub(crate) fn unresolved_request(
        session: RuntimeSession,
        references: super::super::references::CommandReferences,
    ) -> (Pending, UnixStream) {
        let (a, remote) = UnixStream::pair().unwrap();
        let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let pending = Request::for_receipt(Peer::test_peer(), a, id).unwrap();
        {
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            let mut p = pending.lock().unwrap();
            p.references = references;
            assert!(p.bind(session.clone(), context.clone()));
            p.references.remember(id).unwrap();
            p.recovery = Some(session.chat_therapy_recovery(&context, id).unwrap());
            p.state = State::Write(ChatWriteResolution::Uncertain);
        }
        (pending, remote)
    }

    pub(crate) fn voice_request() -> (Pending, UnixStream) {
        let (a, b) = UnixStream::pair().unwrap();
        (Request::for_voice(Peer::test_peer(), a).unwrap(), b)
    }
    #[test]
    fn voice_handoff_never_has_a_transcript_payload_grant_or_writer() {
        for opened in [true, false] {
            let (pending, _remote) = voice_request();
            let mut p = pending.lock().unwrap();
            assert!(p.voice_requested());
            assert!(p.begin_confirmation(true).is_none());
            p.finish_voice_open(opened);
            assert_eq!(
                p.status(),
                if opened {
                    State::VoiceOpened
                } else {
                    State::Withdrawn
                }
            );
            assert!(p.safe_result().is_none());
            assert!(p.review().is_none());
            assert!(p.begin_consume().is_none());
            assert_eq!(p.status(), State::Withdrawn);
        }
    }

    #[test]
    fn document_handoff_has_no_grant_payload_or_receipt_and_cannot_be_consumed() {
        let (a, _remote) = UnixStream::pair().unwrap();
        let request = Request::for_document(Peer::test_peer(), a).unwrap();
        let mut p = request.lock().unwrap();
        assert!(p.document_requested());
        assert!(p.begin_confirmation(true).is_none());
        p.finish_document_open(true);
        assert_eq!(p.status(), State::DocumentOpened);
        assert_eq!(p.status().wire(), "document-opened");
        assert!(!p.document_requested());
        assert!(p.safe_result().is_none());
        assert!(p.review().is_none());
        assert!(p.begin_consume().is_none());
        assert_eq!(p.status(), State::Withdrawn);
    }

    #[test]
    fn agenda_is_app_only_and_requires_current_selection_and_single_consumption() {
        for scenario in [
            "unconfirmed",
            "confirmed",
            "selection",
            "capability",
            "revoked",
            "expired",
        ] {
            let (session, host) = native_session();
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            let (a, _remote) = UnixStream::pair().unwrap();
            let pending = Request::for_agenda(Peer::test_peer(), a).unwrap();
            assert!(pending.lock().unwrap().bind(session.clone(), context));
            prepare_card(&pending);
            {
                let mut p = pending.lock().unwrap();
                assert_eq!(p.status(), State::Challenge);
                let value: Value = serde_json::from_str(p.review().unwrap().0).unwrap();
                assert_eq!(value["profile"], "mediflow.internal-agenda.v1");
                let row = &value["rows"][0];
                assert_eq!(row.as_object().unwrap().len(), 3);
                assert_eq!(row["status"], "pending");
                assert!(row.get("id").is_none());
                assert!(row.get("patientId").is_none());
                assert!(row.get("title").is_none());
                assert!(row.get("notes").is_none());
                if scenario != "unconfirmed" {
                    p.state = State::Approved;
                }
                if scenario == "revoked" {
                    p.revoke();
                }
                if scenario == "expired" {
                    p.deadline = Some(Instant::now() - Duration::from_secs(1));
                }
            }
            if scenario == "selection" {
                session
                    .select_profile_patient("scope-a", "patient-b")
                    .unwrap();
            }
            if scenario == "capability" {
                host.state.store(5, Ordering::Release);
            }
            let result = consume_card(&pending);
            assert_eq!(
                result.0,
                if scenario == "confirmed" {
                    State::Consumed
                } else {
                    State::Withdrawn
                }
            );
            assert_eq!(result.1.is_some(), scenario == "confirmed");
            assert_eq!(consume_card(&pending), (State::Withdrawn, None));
        }
    }

    #[test]
    fn catalog_read_requires_confirmation_and_retires_bytes_on_revoke() {
        for confirm in [false, true] {
            let (session, _host) = native_session();
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            let (a, _remote) = UnixStream::pair().unwrap();
            let pending = Request::for_drugs(Peer::test_peer(), a, "synthetic").unwrap();
            assert!(pending.lock().unwrap().bind(session, context));
            prepare_card(&pending);
            {
                let mut p = pending.lock().unwrap();
                assert_eq!(p.status(), State::Challenge);
                let (payload, digest, _) = p.review().unwrap();
                assert_eq!(digest.len(), 64);
                let payload: Value = serde_json::from_str(payload).unwrap();
                assert_eq!(payload["rows"][0]["aic"], "012345678");
                assert!(payload.get("pseudonym").is_none());
                if confirm {
                    p.state = State::Approved;
                }
            }
            let result = consume_card(&pending);
            assert_eq!(
                result.0,
                if confirm {
                    State::Consumed
                } else {
                    State::Withdrawn
                }
            );
            assert_eq!(result.1.is_some(), confirm);
            assert_eq!(consume_card(&pending), (State::Withdrawn, None));
            let mut p = pending.lock().unwrap();
            p.revoke();
            assert!(p.review().is_none());
        }
    }
    #[test]
    fn catalog_bytes_do_not_survive_revocation_expiry_or_selection_change() {
        for scenario in ["revoked", "expired", "selection"] {
            let (session, _host) = native_session();
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            let (a, _remote) = UnixStream::pair().unwrap();
            let pending = Request::for_drugs(Peer::test_peer(), a, "synthetic").unwrap();
            assert!(pending.lock().unwrap().bind(session.clone(), context));
            prepare_card(&pending);
            {
                let mut p = pending.lock().unwrap();
                assert_eq!(p.status(), State::Challenge);
                p.state = State::Approved;
                match scenario {
                    "revoked" => p.revoke(),
                    "expired" => p.deadline = Some((p.clock)() - Duration::from_millis(1)),
                    _ => session
                        .select_profile_patient("scope-a", "patient-b")
                        .unwrap(),
                }
            }
            assert_eq!(consume_card(&pending), (State::Withdrawn, None));
            assert!(pending.lock().unwrap().review().is_none());
        }
    }

    #[test]
    fn catalog_absent_is_unavailable_instead_of_an_empty_search() {
        let (session, host) = native_session();
        host.state.store(5, Ordering::Release);
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (a, _remote) = UnixStream::pair().unwrap();
        let pending = Request::for_drugs(Peer::test_peer(), a, "synthetic").unwrap();
        assert!(pending.lock().unwrap().bind(session, context));
        prepare_card(&pending);
        assert_eq!(pending.lock().unwrap().status(), State::Withdrawn);
        assert!(pending.lock().unwrap().review().is_none());
        assert_eq!(consume_card(&pending), (State::Withdrawn, None));
    }

    #[test]
    fn native_confirmation_names_the_catalog_it_is_approving() {
        let (a, _) = UnixStream::pair().unwrap();
        let (b, _) = UnixStream::pair().unwrap();
        let drugs = Request::for_drugs(Peer::test_peer(), a, "synthetic").unwrap();
        let prosthetics = Request::for_prosthetics(Peer::test_peer(), b, "synthetic").unwrap();
        assert!(!drugs.lock().unwrap().is_prosthetics_catalog());
        assert!(prosthetics.lock().unwrap().is_prosthetics_catalog());
    }
    #[test]
    fn prosthetics_catalog_read_requires_confirmation_and_retires_bytes_on_revoke() {
        for confirm in [false, true] {
            let (session, _host) = native_session();
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            let (a, _remote) = UnixStream::pair().unwrap();
            let pending = Request::for_prosthetics(Peer::test_peer(), a, "synthetic").unwrap();
            assert!(pending.lock().unwrap().bind(session, context));
            prepare_card(&pending);
            {
                let mut p = pending.lock().unwrap();
                assert_eq!(p.status(), State::Challenge);
                let (payload, digest, _) = p.review().unwrap();
                assert_eq!(digest.len(), 64);
                let payload: Value = serde_json::from_str(payload).unwrap();
                assert_eq!(payload["rows"][0]["code"], "DEMO-1");
                assert_eq!(payload["profile"], "mediflow.prosthetics-catalog.v1");
                assert!(payload.get("pseudonym").is_none());
                if confirm {
                    p.state = State::Approved;
                }
            }
            let result = consume_card(&pending);
            assert_eq!(
                result.0,
                if confirm {
                    State::Consumed
                } else {
                    State::Withdrawn
                }
            );
            assert_eq!(result.1.is_some(), confirm);
            assert_eq!(consume_card(&pending), (State::Withdrawn, None));
            let mut p = pending.lock().unwrap();
            p.revoke();
            assert!(p.review().is_none());
        }
    }
    #[test]
    fn prosthetics_catalog_bytes_do_not_survive_revocation_expiry_or_selection_change() {
        for scenario in ["revoked", "expired", "selection"] {
            let (session, _host) = native_session();
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            let (a, _remote) = UnixStream::pair().unwrap();
            let pending = Request::for_prosthetics(Peer::test_peer(), a, "synthetic").unwrap();
            assert!(pending.lock().unwrap().bind(session.clone(), context));
            prepare_card(&pending);
            {
                let mut p = pending.lock().unwrap();
                assert_eq!(p.status(), State::Challenge);
                p.state = State::Approved;
                match scenario {
                    "revoked" => p.revoke(),
                    "expired" => p.deadline = Some((p.clock)() - Duration::from_millis(1)),
                    _ => session
                        .select_profile_patient("scope-a", "patient-b")
                        .unwrap(),
                }
            }
            assert_eq!(consume_card(&pending), (State::Withdrawn, None));
            assert!(pending.lock().unwrap().review().is_none());
        }
    }

    #[test]
    fn prosthetics_catalog_absent_is_unavailable_instead_of_an_empty_search() {
        let (session, host) = native_session();
        host.state.store(5, Ordering::Release);
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (a, _remote) = UnixStream::pair().unwrap();
        let pending = Request::for_prosthetics(Peer::test_peer(), a, "synthetic").unwrap();
        assert!(pending.lock().unwrap().bind(session, context));
        prepare_card(&pending);
        assert_eq!(pending.lock().unwrap().status(), State::Withdrawn);
        assert!(pending.lock().unwrap().review().is_none());
        assert_eq!(consume_card(&pending), (State::Withdrawn, None));
    }

    #[test]
    fn catalog_queries_are_bounded_before_admission() {
        for query in ["", "a", "bad\nquery", &"x".repeat(81)] {
            let (a, _remote) = UnixStream::pair().unwrap();
            assert!(Request::for_drugs(Peer::test_peer(), a, query).is_none());
        }
    }

    #[test]
    fn document_handoff_denial_and_revocation_never_report_opened() {
        for revoke in [false, true] {
            let (a, _remote) = UnixStream::pair().unwrap();
            let request = Request::for_document(Peer::test_peer(), a).unwrap();
            let mut p = request.lock().unwrap();
            if revoke {
                p.revoke();
            }
            p.finish_document_open(revoke);
            assert_eq!(p.status(), State::Withdrawn);
            assert!(p.safe_result().is_none());
        }
    }

    #[test]
    fn unsupported_therapy_biometric_does_not_consume_the_pin_attempt() {
        let (a, _remote) = UnixStream::pair().unwrap();
        let request = Request::for_therapy(Peer::test_peer(), a, "suspended").unwrap();
        let mut p = request.lock().unwrap();
        p.state = State::Challenge;
        assert!(p.begin_confirmation(false).is_none());
        assert_eq!(p.status(), State::Challenge);
    }

    #[test]
    fn detached_request_cannot_reuse_its_previous_session_for_recovery() {
        let (session, _host) = native_session();
        let (pending, _remote) = unresolved_request(
            session,
            super::super::references::CommandReferences::default(),
        );
        let mut pending = pending.lock().unwrap();
        pending.detach();
        pending.revoke();
        assert_eq!(
            pending.status(),
            State::Write(ChatWriteResolution::Uncertain),
            "detached Request kept the previous recovery session"
        );
        assert!(pending.begin().is_none());
        assert_eq!(pending.safe_result().unwrap()["outcome"], "unknown");
    }

    fn synthetic_request() -> (Pending, UnixStream) {
        let (a, b) = UnixStream::pair().unwrap();
        (Request::new(Peer::test_peer(), a).unwrap(), b)
    }
    #[test]
    fn biometric_result_double_is_bound_to_one_native_attempt_and_one_consumption() {
        let (session, _host) = native_session();
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (first, _remote) = synthetic_request();
        let (other, _remote2) = synthetic_request();
        assert!(first.lock().unwrap().bind(session.clone(), context.clone()));
        assert!(other.lock().unwrap().bind(session, context));
        first.lock().unwrap().state = State::Challenge;
        other.lock().unwrap().state = State::Challenge;
        let (_, _, attempt) = first.lock().unwrap().begin().unwrap();
        other.lock().unwrap().begin().unwrap();
        other.lock().unwrap().finish(attempt, true);
        assert_eq!(other.lock().unwrap().status(), State::Withdrawn);
        first.lock().unwrap().finish(attempt, true);
        assert_eq!(consume(&first), State::Consumed);
        assert_eq!(consume(&first), State::Withdrawn);
    }
    #[test]
    fn therapy_native_selection_preview_pin_receipt_and_replay_use_the_same_bound_request() {
        let (session, _host) = native_session();
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (a, _remote) = UnixStream::pair().unwrap();
        let pending = Request::for_therapy(Peer::test_peer(), a, "suspended").unwrap();
        assert!(pending.lock().unwrap().bind(session, context));
        prepare_card(&pending);
        assert_eq!(pending.lock().unwrap().status(), State::Challenge);
        assert!(pending.lock().unwrap().begin().is_none());
        choose_therapy(&pending, 0);
        assert_eq!(
            pending.lock().unwrap().safe_result().unwrap()["outcome"],
            "pending"
        );
        let (_, _, attempt) = pending.lock().unwrap().begin().unwrap();
        assert!(execute_therapy(&pending, attempt, "2468"));
        assert_eq!(
            pending.lock().unwrap().status(),
            State::Write(ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied))
        );
        let safe = pending.lock().unwrap().safe_result().unwrap();
        assert_eq!(safe["outcome"], "applied");
        assert_eq!(safe.as_object().unwrap().len(), 2);
        assert!(!execute_therapy(&pending, attempt, "2468"));
        assert!(pending.lock().unwrap().begin().is_none());
    }

    #[test]
    fn booking_parses_only_a_local_instant_from_today_to_two_years() {
        use chrono::TimeZone;
        let now = chrono::Local
            .with_ymd_and_hms(2026, 11, 2, 15, 0, 0)
            .single()
            .unwrap();
        let instant = booking_instant(" 03/11/2026 09:30 ", now).unwrap();
        assert!(instant.ends_with(":30:00.000Z"));
        assert_eq!(
            chrono::DateTime::parse_from_rfc3339(&instant).unwrap(),
            chrono::Local
                .with_ymd_and_hms(2026, 11, 3, 9, 30, 0)
                .single()
                .unwrap()
        );
        assert!(booking_instant("02/11/2026 08:00", now).is_ok());
        for (invalid, error) in [
            ("01/11/2026 23:59", BookingDateError::Range),
            ("03/11/2030 09:00", BookingDateError::Range),
            ("2026-11-03 09:00", BookingDateError::Format),
            ("31/02/2027 09:00", BookingDateError::Format),
            ("domani", BookingDateError::Format),
        ] {
            assert_eq!(booking_instant(invalid, now), Err(error), "{invalid}");
        }
    }

    #[test]
    fn booking_names_the_daylight_saving_hour_instead_of_a_format_error() {
        use chrono::TimeZone;
        let zone = chrono_tz::Europe::Rome;
        let now = zone
            .with_ymd_and_hms(2026, 3, 1, 10, 0, 0)
            .single()
            .unwrap();
        assert_eq!(
            booking_instant_in("29/03/2026 02:30", now, &zone),
            Err(BookingDateError::Nonexistent)
        );
        assert_eq!(
            booking_instant_in("25/10/2026 02:30", now, &zone),
            Err(BookingDateError::Ambiguous)
        );
        assert!(booking_instant_in("29/03/2026 03:30", now, &zone).is_ok());
        assert!(
            BookingDateError::Nonexistent
                .message()
                .contains("ora legale")
        );
    }

    fn booking_request(scenario: usize) -> (Pending, UnixStream, RuntimeSession, Host) {
        let (session, host) = native_session();
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (a, remote) = UnixStream::pair().unwrap();
        let pending = Request::for_booking(Peer::test_peer(), a).unwrap();
        assert!(pending.lock().unwrap().bind(session.clone(), context));
        prepare_card(&pending);
        assert_eq!(pending.lock().unwrap().status(), State::Challenge);
        {
            let p = pending.lock().unwrap();
            let booking = p.therapy().unwrap().booking.as_ref().unwrap();
            let agenda = booking.agenda.as_ref().unwrap();
            assert_eq!(agenda.revision, "7".repeat(64));
            assert_eq!(agenda.omitted, 3);
            assert_eq!(
                agenda.rows,
                [
                    ("2026-11-15T09:00:00.000Z".into(), "pending".into()),
                    ("2026-10-01T08:30:00.000Z".into(), "completed".into())
                ]
            );
            assert!(booking.chosen.is_none());
        }
        assert!(pending.lock().unwrap().begin().is_none());
        assert!(!choose_booking(&pending, "31/02/2027 09:00"));
        assert_eq!(pending.lock().unwrap().status(), State::Challenge);
        let day = (chrono::Local::now() + chrono::Duration::days(1)).format("%d/%m/%Y 09:00");
        assert!(choose_booking(&pending, &day.to_string()));
        assert_eq!(pending.lock().unwrap().status(), State::Challenge);
        host.state.store(scenario, Ordering::Release);
        (pending, remote, session, host)
    }

    #[test]
    fn booking_native_date_preview_pin_and_one_execution_on_the_shared_writer() {
        let (pending, _remote, _session, _host) = booking_request(0);
        assert!(!choose_booking(&pending, "04/11/2030 09:00"));
        let (_, _, attempt) = pending.lock().unwrap().begin().unwrap();
        assert!(execute_therapy(&pending, attempt, "2468"));
        assert_eq!(
            pending.lock().unwrap().status(),
            State::Write(ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied))
        );
        let safe = pending.lock().unwrap().safe_result().unwrap();
        assert_eq!(safe["outcome"], "applied");
        assert_eq!(safe.as_object().unwrap().len(), 2);
        assert!(!execute_therapy(&pending, attempt, "2468"));
        assert!(pending.lock().unwrap().begin().is_none());
    }

    #[test]
    fn booking_wrong_pin_retires_and_never_reports_a_booking() {
        let (pending, _remote, _session, _host) = booking_request(0);
        let (_, _, attempt) = pending.lock().unwrap().begin().unwrap();
        assert!(!execute_therapy(&pending, attempt, "0000"));
        assert_eq!(
            pending.lock().unwrap().status(),
            State::Write(ChatWriteResolution::Confirmed(ChatWriteOutcome::Retired))
        );
    }

    #[test]
    fn booking_version_conflict_and_lost_response_have_a_readable_outcome() {
        for (scenario, outcome) in [
            (6, ChatWriteOutcome::Rejected),
            (7, ChatWriteOutcome::Applied),
        ] {
            let (pending, _remote, _session, _host) = booking_request(scenario);
            let (_, _, attempt) = pending.lock().unwrap().begin().unwrap();
            assert_eq!(execute_therapy(&pending, attempt, "2468"), scenario == 6);
            assert_eq!(
                pending.lock().unwrap().status(),
                State::Write(ChatWriteResolution::Confirmed(outcome))
            );
            assert_eq!(
                pending.lock().unwrap().safe_result().unwrap()["outcome"],
                outcome.wire()
            );
        }
    }

    #[test]
    fn booking_view_with_free_text_in_the_agenda_is_withdrawn() {
        let (session, host) = native_session();
        host.state.store(9, Ordering::Release);
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (a, _remote) = UnixStream::pair().unwrap();
        let pending = Request::for_booking(Peer::test_peer(), a).unwrap();
        assert!(pending.lock().unwrap().bind(session, context));
        prepare_card(&pending);
        assert_eq!(pending.lock().unwrap().status(), State::Withdrawn);
    }

    const BOOKED: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    fn card_receipt(session: &RuntimeSession, kind: Option<ChatWriteKind>) -> State {
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (a, _remote) = UnixStream::pair().unwrap();
        let pending = Request::for_receipt(Peer::test_peer(), a, BOOKED).unwrap();
        assert!(pending.lock().unwrap().bind(session.clone(), context));
        if let Some(kind) = kind {
            let p = pending.lock().unwrap();
            p.references.remember_kind(BOOKED, kind).unwrap();
        }
        prepare_card(&pending);
        pending.lock().unwrap().status()
    }

    #[test]
    fn card_reread_of_a_booking_reference_asks_the_booking_route_not_the_therapy_one() {
        let (session, host) = native_session();
        host.state.store(4, Ordering::Release);
        let applied = State::Write(ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied));
        assert_eq!(
            card_receipt(&session, Some(ChatWriteKind::CheckupBooking)),
            applied
        );
        host.grants.store(1, Ordering::Release);
        session.refresh_capabilities().unwrap();
        assert_eq!(card_receipt(&session, None), applied);
    }

    #[test]
    fn booking_reread_never_reads_or_removes_a_reference_stored_as_therapy() {
        let (session, _host) = native_session();
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (a, _remote) = UnixStream::pair().unwrap();
        let pending = Request::for_booking_receipt(Peer::test_peer(), a, BOOKED).unwrap();
        assert!(pending.lock().unwrap().bind(session, context));
        let references = pending.lock().unwrap().references.clone();
        references
            .remember_kind(BOOKED, ChatWriteKind::TherapyStatus)
            .unwrap();
        prepare_card(&pending);
        assert_eq!(
            pending.lock().unwrap().status(),
            State::Write(ChatWriteResolution::Uncertain)
        );
        assert_eq!(references.pending().unwrap(), [BOOKED]);
        assert_eq!(references.kind(BOOKED), Some(ChatWriteKind::TherapyStatus));
    }

    #[test]
    fn restored_booking_without_its_audit_is_read_as_historical_not_audited() {
        let (session, host) = native_session();
        host.state.store(10, Ordering::Release);
        let historical = State::Write(ChatWriteResolution::Confirmed(
            ChatWriteOutcome::AppliedHistorical,
        ));
        assert_eq!(
            card_receipt(&session, Some(ChatWriteKind::CheckupBooking)),
            historical
        );
        assert!(
            !ChatWriteResolution::Confirmed(ChatWriteOutcome::AppliedHistorical)
                .message()
                .contains("auditat")
        );
    }

    #[test]
    fn restart_recovery_uses_the_stored_route_and_skips_a_route_the_client_was_never_granted() {
        let (session, host) = native_session();
        let recover = |kind| {
            session
                .recover_chat_write_command("scope-a", BOOKED, kind)
                .unwrap()
                .reconcile()
        };
        let retired = ChatWriteResolution::Confirmed(ChatWriteOutcome::Retired);
        for grant in [1, 2] {
            host.grants.store(grant, Ordering::Release);
            session.refresh_capabilities().unwrap();
            assert_eq!(recover(None), retired, "grant {grant}");
        }
        // Announced but refused by the host: the refusing route may own the command, so a
        // "no command" from the other route is not a retirement.
        host.grants.store(3, Ordering::Release);
        session.refresh_capabilities().unwrap();
        assert_eq!(recover(None), ChatWriteResolution::Uncertain);
        host.state.store(4, Ordering::Release);
        assert_eq!(
            recover(None),
            ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied)
        );
        host.state.store(0, Ordering::Release);
        host.grants.store(1, Ordering::Release);
        session.refresh_capabilities().unwrap();
        assert_eq!(recover(Some(ChatWriteKind::CheckupBooking)), retired);
        host.state.store(4, Ordering::Release);
        assert_eq!(
            recover(None),
            ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied)
        );
        host.grants.store(2, Ordering::Release);
        session.refresh_capabilities().unwrap();
        assert_eq!(
            recover(Some(ChatWriteKind::CheckupBooking)),
            ChatWriteResolution::Uncertain
        );
    }

    fn assert_card_negative(scenario: &str) {
        let (session, _host) = native_session();
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        for negative in [false, true] {
            let time = Arc::new(Mutex::new(Instant::now()));
            let clock = time.clone();
            let (a, _remote) = UnixStream::pair().unwrap();
            let pending = Request::with_clock(
                Peer::test_peer(),
                a,
                Arc::new(move || *clock.lock().unwrap()),
            )
            .unwrap();
            let mut request = pending.lock().unwrap();
            assert!(request.bind(session.clone(), context.clone()));
            if scenario == "idle" {
                *time.lock().unwrap() += VIEW_IDLE - Duration::from_secs(1);
            }
            request.install_card(Some(super::super::card::Card::synthetic()));
            assert_eq!(request.status(), State::Challenge);
            if !negative || scenario != "absent" {
                let (_, _, attempt) = request.begin().unwrap();
                request.finish(attempt, !negative || scenario != "denied");
            }
            if negative {
                match scenario {
                    "expired" => *time.lock().unwrap() += CHALLENGE,
                    "idle" => {
                        *time.lock().unwrap() += Duration::from_secs(1);
                    }
                    "revoked" => request.withdraw(),
                    "missing-card" => request.card = None,
                    _ => {}
                }
            }
            drop(request);
            let expected = if negative {
                (State::Withdrawn, None)
            } else {
                (State::Consumed, Some("synthetic-redacted-payload".into()))
            };
            assert_eq!(
                consume_card(&pending),
                expected,
                "{scenario}, negative={negative}"
            );
        }
    }
    #[test]
    fn consent_absent_with_valid_card_never_delivers() {
        assert_card_negative("absent");
    }
    #[test]
    fn consent_expired_at_30_seconds_with_valid_card_never_delivers() {
        assert_card_negative("expired");
    }
    #[test]
    fn consent_denied_with_valid_card_never_delivers() {
        assert_card_negative("denied");
    }
    #[test]
    fn consent_revoked_with_valid_card_never_delivers() {
        assert_card_negative("revoked");
    }
    #[test]
    fn view_idle_at_5_minutes_with_fresh_card_never_delivers() {
        assert_card_negative("idle");
    }
    #[test]
    fn missing_card_after_approval_never_delivers() {
        assert_card_negative("missing-card");
    }
    #[test]
    fn session_archive_selection_aba_and_eof_retire_native_approval() {
        for change in [0, 1, 3, 4] {
            let (session, host) = native_session();
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            let (pending, remote) = synthetic_request();
            let mut request = pending.lock().unwrap();
            assert!(request.bind(session.clone(), context));
            request.state = State::Challenge;
            let (_, _, attempt) = request.begin().unwrap();
            request.finish(attempt, true);
            drop(request);
            if change == 0 {
                session.lock();
            } else if change != 4 {
                host.state.store(change, Ordering::Release);
            }
            if change == 4 {
                drop(remote);
            }
            assert_eq!(consume_card(&pending), (State::Withdrawn, None));
        }
    }

    #[test]
    #[ignore = "requires an explicit owned synthetic host, Node 24.18.0 and real GLiNER installation; OS peer is a test double"]
    fn owned_synthetic_host_v3_real_redaction_native_pin_and_single_delivery() {
        let file = std::env::var("MEDIFLOW_CHAT_PIN_TEST_CONFIG")
            .expect("explicit synthetic config required");
        let config: Value = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
        assert_eq!(config["synthetic"], true);
        let base = config["baseUrl"].as_str().unwrap();
        let address = base
            .strip_prefix("http://")
            .unwrap()
            .parse::<std::net::SocketAddr>()
            .unwrap();
        assert_eq!(address.ip(), std::net::Ipv4Addr::LOCALHOST);
        assert_ne!(address.port(), 3000);
        let session = RuntimeClient::new(RuntimeConfig {
            base_url: base.into(),
            tls_pin_sha256: None,
        })
        .unwrap()
        .login(
            PairingCredentials::new(
                config["pairingId"].as_str().unwrap(),
                config["pairingToken"].as_str().unwrap(),
            )
            .unwrap(),
            config["username"].as_str().unwrap(),
            config["passphrase"].as_str().unwrap(),
        )
        .unwrap();
        session.list_ambulatories().unwrap();
        let scope = config["scope"].as_str().unwrap();
        let patient = config["patientId"].as_str().unwrap();
        session.select_profile_patient(scope, patient).unwrap();
        let context = session.chat_access_context(scope, patient).unwrap();
        let (pending, _remote) = synthetic_request();
        assert!(pending.lock().unwrap().bind(session.clone(), context));
        prepare_card(&pending);
        assert_eq!(pending.lock().unwrap().status(), State::Challenge);
        let reviewed = pending.lock().unwrap().review().unwrap().0.to_owned();
        let (bound, context, attempt) = pending.lock().unwrap().begin().unwrap();
        bound
            .confirm_chat_access_pin(
                &context,
                &std::env::var("MEDIFLOW_CHAT_PIN_TEST_PIN").unwrap(),
            )
            .unwrap();
        pending.lock().unwrap().finish(attempt, true);
        let (state, payload) = consume_card(&pending);
        assert_eq!(state, State::Consumed);
        assert_eq!(payload.as_deref(), Some(reviewed.as_str()));
        assert_eq!(consume_card(&pending), (State::Withdrawn, None));
        for scenario in ["absent", "expired", "idle", "revoked"] {
            let context = session.chat_access_context(scope, patient).unwrap();
            let (pending, _remote) = synthetic_request();
            assert!(pending.lock().unwrap().bind(session.clone(), context));
            prepare_card(&pending);
            assert_eq!(pending.lock().unwrap().status(), State::Challenge);
            if scenario != "absent" {
                let (bound, context, attempt) = pending.lock().unwrap().begin().unwrap();
                bound
                    .confirm_chat_access_pin(
                        &context,
                        &std::env::var("MEDIFLOW_CHAT_PIN_TEST_PIN").unwrap(),
                    )
                    .unwrap();
                pending.lock().unwrap().finish(attempt, true);
            }
            {
                let mut p = pending.lock().unwrap();
                match scenario {
                    "expired" => p.deadline = Some(Instant::now() - Duration::from_millis(1)),
                    "idle" => p.created = Instant::now() - VIEW_IDLE,
                    "revoked" => p.withdraw(),
                    _ => {}
                }
            }
            assert_eq!(
                consume_card(&pending),
                (State::Withdrawn, None),
                "{scenario}"
            );
        }
        session.logout().unwrap();
    }

    fn connected() -> (Pending, UnixStream) {
        let (a, b) = UnixStream::pair().unwrap();
        let peer = native::capture(&a, true)
            .expect("kernel peer and signed host ancestry required for this boundary test");
        (Request::new(peer, a).unwrap(), b)
    }

    #[test]
    fn another_same_uid_executable_cannot_impersonate_the_adapter() {
        use std::{
            fs,
            os::unix::{fs::PermissionsExt, net::UnixListener},
            process::{Command, Stdio},
        };
        let mut random = [0; 8];
        getrandom::fill(&mut random).unwrap();
        let path = std::path::PathBuf::from("/private/tmp").join(format!(
            "mf-chat-peer-{}-{}",
            std::process::id(),
            u64::from_ne_bytes(random)
        ));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = path.join("peer.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let mut child = Command::new("/usr/bin/nc")
            .arg("-U")
            .arg(&socket)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let (stream, _) = listener.accept().unwrap();
        assert!(native::capture(&stream, false).is_none());
        assert!(native::capture(&stream, true).is_none());
        child.kill().unwrap();
        child.wait().unwrap();
        drop(stream);
        drop(listener);
        fs::remove_file(socket).unwrap();
        fs::remove_dir(path).unwrap();
    }

    #[test]
    #[ignore = "integration requires a real signed Codex or Claude ancestor on macOS"]
    fn peer_is_captured_from_kernel_and_eof_withdraws_the_request() {
        let (pending, remote) = connected();
        assert_eq!(pending.lock().unwrap().status(), State::Requested);
        drop(remote);
        assert_eq!(pending.lock().unwrap().status(), State::Withdrawn);
    }

    #[test]
    #[ignore = "integration requires a real signed Codex or Claude ancestor on macOS"]
    fn forged_attempt_expiry_and_late_approval_cannot_restore_authority() {
        let (pending, _remote) = connected();
        let mut request = pending.lock().unwrap();
        request.state = State::Approving;
        request.deadline = Some(Instant::now() + CHALLENGE);
        request.finish(Attempt([0; 32]), true);
        assert_eq!(request.status(), State::Withdrawn);
        let original = request.attempt;
        request.finish(original, true);
        assert_eq!(request.status(), State::Withdrawn);

        let (other, _remote2) = connected();
        let mut other = other.lock().unwrap();
        other.state = State::Approving;
        other.deadline = Some(Instant::now());
        let attempt = other.attempt;
        other.finish(attempt, true);
        assert_eq!(other.status(), State::Withdrawn);
    }

    #[test]
    #[ignore = "integration requires a real signed Codex or Claude ancestor on macOS"]
    fn consumption_without_a_native_binding_and_replay_are_denied() {
        let (pending, _remote) = connected();
        pending.lock().unwrap().state = State::Approved;
        assert_eq!(consume(&pending), State::Withdrawn);
        assert_eq!(consume(&pending), State::Withdrawn);
    }

    #[test]
    #[ignore = "integration requires a real signed Codex or Claude ancestor on macOS; presence result is synthetic"]
    fn one_exact_grant_is_consumed_once_and_cannot_move_to_a_second_connection() {
        let (session, _host) = native_session();
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (first, _remote) = connected();
        let (second, _remote2) = connected();
        assert!(first.lock().unwrap().bind(session.clone(), context.clone()));
        assert!(second.lock().unwrap().bind(session, context));
        first.lock().unwrap().state = State::Challenge;
        second.lock().unwrap().state = State::Challenge;
        let (_, _, attempt) = first.lock().unwrap().begin().unwrap();
        second.lock().unwrap().begin().unwrap();
        second.lock().unwrap().finish(attempt, true);
        assert_eq!(second.lock().unwrap().status(), State::Withdrawn);
        first.lock().unwrap().finish(attempt, true);
        assert_eq!(first.lock().unwrap().status(), State::Approved);
        assert_eq!(consume(&first), State::Consumed);
        assert_eq!(consume(&first), State::Withdrawn);
    }

    #[test]
    #[ignore = "integration requires a real signed Codex or Claude ancestor on macOS; presence result is synthetic"]
    fn native_session_lock_and_host_restore_retire_the_captured_grant() {
        for change in [0, 1, 3] {
            let (session, host) = native_session();
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            let (request, _remote) = connected();
            assert!(request.lock().unwrap().bind(session.clone(), context));
            request.lock().unwrap().state = State::Challenge;
            let (_, _, attempt) = request.lock().unwrap().begin().unwrap();
            request.lock().unwrap().finish(attempt, true);
            if change != 0 {
                host.state.store(change, Ordering::Release);
            } else {
                session.lock();
            }
            assert_eq!(consume(&request), State::Withdrawn);
        }
    }

    #[test]
    #[ignore = "integration requires a real signed Codex or Claude ancestor on macOS; no biometric prompt is opened"]
    fn withdrawal_cancels_the_prepared_os_context_before_it_can_prompt() {
        let (request, _remote) = connected();
        let mut request = request.lock().unwrap();
        request.state = State::Approving;
        assert!(request.prepare_biometric());
        let attempt = request.attempt;
        request.withdraw();
        assert!(attempt.biometric().is_err());
        assert_eq!(request.status(), State::Withdrawn);
    }

    #[test]
    #[ignore = "integration requires a real signed Codex or Claude ancestor on macOS; presence result is synthetic"]
    fn eof_retires_an_approved_unconsumed_grant() {
        let (session, _host) = native_session();
        let context = session.chat_access_context("scope-a", "patient-a").unwrap();
        let (request, remote) = connected();
        assert!(request.lock().unwrap().bind(session, context));
        request.lock().unwrap().state = State::Challenge;
        let (_, _, attempt) = request.lock().unwrap().begin().unwrap();
        request.lock().unwrap().finish(attempt, true);
        assert_eq!(request.lock().unwrap().status(), State::Approved);
        drop(remote);
        assert_eq!(request.lock().unwrap().status(), State::Withdrawn);
        assert_eq!(consume(&request), State::Withdrawn);
        assert!(request.lock().unwrap().binding.is_none());
    }
    #[test]
    #[ignore = "requires scripts/check-chat-therapy-withdraw.mjs owned synthetic real route host"]
    fn real_route_withdraw_during_pin() {
        let config: Value = serde_json::from_slice(
            &std::fs::read(std::env::var("REVIEW_CONFIG").unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(config["synthetic"], true);
        let address = config["baseURL"]
            .as_str()
            .unwrap()
            .strip_prefix("http://")
            .unwrap()
            .parse::<std::net::SocketAddr>()
            .unwrap();
        assert_eq!(address.ip(), std::net::Ipv4Addr::LOCALHOST);
        assert_ne!(address.port(), 3000);
        let session = RuntimeClient::new(RuntimeConfig {
            base_url: config["baseURL"].as_str().unwrap().into(),
            tls_pin_sha256: None,
        })
        .unwrap()
        .login(
            PairingCredentials::new(
                config["pairingId"].as_str().unwrap(),
                config["pairingToken"].as_str().unwrap(),
            )
            .unwrap(),
            config["username"].as_str().unwrap(),
            config["passphrase"].as_str().unwrap(),
        )
        .unwrap();
        let scope = config["scope"].as_str().unwrap();
        let patient = config["patientId"].as_str().unwrap();
        session.list_ambulatories().unwrap();
        session.select_profile_patient(scope, patient).unwrap();
        let intent = session.profile_query_intent();
        session
            .open_patient_profile(scope, patient, &intent)
            .unwrap();
        let context = session.chat_access_context(scope, patient).unwrap();
        let (a, _remote) = UnixStream::pair().unwrap();
        let pending = Request::for_therapy(Peer::test_peer(), a, "suspended").unwrap();
        assert!(pending.lock().unwrap().bind(session.clone(), context));
        prepare_card(&pending);
        assert_eq!(pending.lock().unwrap().status(), State::Challenge);
        choose_therapy(&pending, 0);
        let (_, _, attempt) = pending.lock().unwrap().begin().unwrap();
        let executing = pending.clone();
        let worker = std::thread::spawn(move || execute_therapy(&executing, attempt, "2468"));
        let barrier = std::env::var("REVIEW_PIN_BARRIER").unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while !std::path::Path::new(&barrier).exists() {
            assert!(Instant::now() < deadline, "PIN barrier absent");
            std::thread::sleep(Duration::from_millis(5));
        }
        let scenario = std::env::var("MEDIFLOW_CHAT_WITHDRAW_SCENARIO").unwrap();
        if scenario == "after-commit" {
            std::fs::write(std::env::var("REVIEW_PIN_RELEASE").unwrap(), "release").unwrap();
            wait_file("REVIEW_RESULT");
        }
        session.clear_profile_selection();
        let withdrawn = pending.lock().unwrap().status().wire();
        std::fs::write(std::env::var("REVIEW_PIN_RELEASE").unwrap(), "release").unwrap();
        worker.join().unwrap();
        let result = std::env::var("REVIEW_RESULT").unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while !std::path::Path::new(&result).exists() {
            assert!(Instant::now() < deadline, "durable state absent");
            std::thread::sleep(Duration::from_millis(5));
        }
        let result: Value = serde_json::from_slice(&std::fs::read(result).unwrap()).unwrap();
        let expected_audits = if scenario == "before-commit" { 0 } else { 1 };
        assert_eq!(
            result["effects"]["audits"], expected_audits,
            "withdrawal effects: {result}"
        );
        assert_eq!(result["effects"]["therapy"]["version"], 1 + expected_audits);
        assert_eq!(
            result["effects"]["therapy"]["status"],
            if expected_audits == 0 {
                "active"
            } else {
                "suspended"
            }
        );
        let revoked: Value = serde_json::from_slice(
            &std::fs::read(std::env::var("REVIEW_REVOKE_RESULT").unwrap()).unwrap(),
        )
        .unwrap();
        assert!(
            revoked["operations"].as_array().unwrap().iter().any(|op| op
                == if scenario == "after-commit" {
                    "receipt"
                } else {
                    "revoke"
                }),
            "server never received reconciliation"
        );
        assert_eq!(
            withdrawn,
            match scenario.as_str() {
                "before-commit" => "retired",
                "unavailable" => "uncertain",
                _ => "applied",
            }
        );
        if scenario == "unavailable" {
            assert_eq!(pending.lock().unwrap().status().wire(), "uncertain");
            pending.lock().unwrap().revoke();
            assert_eq!(pending.lock().unwrap().status().wire(), "applied");
        }
        let before = pending.lock().unwrap().status().wire();
        pending.lock().unwrap().reconcile_therapy();
        pending.lock().unwrap().reconcile_therapy();
        assert_eq!(pending.lock().unwrap().status().wire(), before);
        let after: Value = serde_json::from_slice(
            &std::fs::read(std::env::var("REVIEW_REVOKE_RESULT").unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(
            after["effects"], result["effects"],
            "double revocation changed durable effects"
        );
        assert!(pending.lock().unwrap().begin().is_none());
    }

    fn wait_file(key: &str) {
        let path = std::env::var(key).unwrap();
        let deadline = Instant::now() + Duration::from_secs(12);
        while !std::path::Path::new(&path).exists() {
            assert!(Instant::now() < deadline, "missing {key}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    #[test]
    #[ignore = "independent owned synthetic crash route"]
    fn crash_recovery_retains_reference_and_true_outcome() {
        let config: Value = serde_json::from_slice(
            &std::fs::read(std::env::var("REVIEW_CONFIG").unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(config["synthetic"], true);
        let address = config["baseURL"]
            .as_str()
            .unwrap()
            .strip_prefix("http://")
            .unwrap()
            .parse::<std::net::SocketAddr>()
            .unwrap();
        assert_eq!(address.ip(), std::net::Ipv4Addr::LOCALHOST);
        assert_ne!(address.port(), 3000);
        let session = RuntimeClient::new(RuntimeConfig {
            base_url: config["baseURL"].as_str().unwrap().into(),
            tls_pin_sha256: None,
        })
        .unwrap()
        .login(
            PairingCredentials::new(
                config["pairingId"].as_str().unwrap(),
                config["pairingToken"].as_str().unwrap(),
            )
            .unwrap(),
            config["username"].as_str().unwrap(),
            config["passphrase"].as_str().unwrap(),
        )
        .unwrap();
        let scope = config["scope"].as_str().unwrap();
        let patient = config["patientId"].as_str().unwrap();
        session.list_ambulatories().unwrap();
        session.select_profile_patient(scope, patient).unwrap();
        let intent = session.profile_query_intent();
        session
            .open_patient_profile(scope, patient, &intent)
            .unwrap();
        let context = session.chat_access_context(scope, patient).unwrap();

        let phase = std::env::var("REVIEW_PHASE").unwrap();
        let directory = std::path::PathBuf::from(std::env::var("REVIEW_CONFIG").unwrap())
            .parent()
            .unwrap()
            .join("pending-commands");
        let references = super::super::references::CommandReferences::new(Some(directory.clone()))
            .for_session(&session);
        let command_file = std::env::var("REVIEW_COMMAND").unwrap();
        if phase == "send" {
            let (a, _remote) = UnixStream::pair().unwrap();
            let pending = Request::for_therapy(Peer::test_peer(), a, "suspended").unwrap();
            pending.lock().unwrap().references = references;
            assert!(pending.lock().unwrap().bind(session.clone(), context));
            prepare_card(&pending);
            choose_therapy(&pending, 0);
            let id = pending
                .lock()
                .unwrap()
                .therapy()
                .unwrap()
                .selected
                .as_ref()
                .unwrap()
                .1
                .clone();
            std::fs::write(&command_file, &id).unwrap();
            let (_, _, attempt) = pending.lock().unwrap().begin().unwrap();
            let executing = pending.clone();
            std::thread::spawn(move || execute_therapy(&executing, attempt, "2468"));
            wait_file("REVIEW_PIN_BARRIER");
            pending.lock().unwrap().withdraw();
            assert_eq!(
                pending.lock().unwrap().status(),
                State::Write(ChatWriteResolution::Uncertain)
            );
            std::fs::write(
                std::env::var("REVIEW_KILL_READY").unwrap(),
                "uncertain, revoke lost before route",
            )
            .unwrap();
            loop {
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        if std::env::var_os("MF_CRASH_DAMAGED_MARKER").is_some() {
            use std::os::unix::fs::PermissionsExt;
            let id = std::fs::read_to_string(&command_file).unwrap();
            let marker = directory
                .join(session.chat_write_reference_namespace())
                .join(&id);
            std::fs::set_permissions(marker, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert_eq!(references.scan().unwrap().invalid.len(), 1);
        }
        let ids = references.pending().unwrap();
        assert_eq!(
            ids.len(),
            1,
            "restart must rediscover unresolved command without a manually retained reference"
        );
        let id = ids[0].clone();
        assert_eq!(id, std::fs::read_to_string(&command_file).unwrap());
        let before = session
            .chat_therapy_request(&context, &json!({"operation":"receipt", "commandId":id}))
            .unwrap();
        assert_eq!(before["outcome"], "unknown");
        let (a, _remote) = UnixStream::pair().unwrap();
        let pending = Request::for_receipt(Peer::test_peer(), a, &id).unwrap();
        pending.lock().unwrap().references = references.clone();
        assert!(
            pending
                .lock()
                .unwrap()
                .bind(session.clone(), context.clone())
        );
        prepare_card(&pending);
        pending.lock().unwrap().revoke();
        let state = pending.lock().unwrap().status();
        let retired = std::env::var("MEDIFLOW_CHAT_WITHDRAW_SCENARIO").unwrap() == "crash-retired";
        assert_eq!(
            state,
            State::Write(if retired {
                ChatWriteResolution::Confirmed(ChatWriteOutcome::Retired)
            } else {
                ChatWriteResolution::Uncertain
            }),
            "unknown receipt must not claim confirmed withdrawal"
        );
        if !retired {
            assert_eq!(
                references.pending().unwrap(),
                std::slice::from_ref(&id),
                "uncertainty erased the reference"
            );
            assert_eq!(
                pending.lock().unwrap().safe_result().unwrap()["outcome"],
                "unknown"
            );
        }
        std::fs::write(std::env::var("REVIEW_PIN_RELEASE").unwrap(), "release").unwrap();
        wait_file("REVIEW_RESULT");
        pending.lock().unwrap().revoke();
        let after = pending.lock().unwrap().safe_result().unwrap();
        assert_eq!(
            after["outcome"],
            if retired { "retired" } else { "applied" }
        );
        assert!(references.pending().unwrap().is_empty());
        let effect: Value = serde_json::from_slice(
            &std::fs::read(std::env::var("REVIEW_RESULT").unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(effect["effects"]["audits"], if retired { 0 } else { 1 });
        assert_eq!(
            effect["effects"]["therapy"]["version"],
            if retired { 1 } else { 2 }
        );
        assert_eq!(
            effect["effects"]["therapy"]["status"],
            if retired { "active" } else { "suspended" }
        );
        let observed = json!({"receiptBefore":before,"stateBeforeCommit":state.wire(),"receiptAfter":after,"durable":effect});
        std::fs::write(
            std::env::var("REVIEW_OBSERVED").unwrap(),
            serde_json::to_vec_pretty(&observed).unwrap(),
        )
        .unwrap();
        println!("CRASH RECOVERY: {observed}");
    }

    #[test]
    fn recovered_unknown_reference_cannot_be_withdrawn_without_server_confirmation() {
        let (a, _remote) = UnixStream::pair().unwrap();
        let request =
            Request::for_receipt(Peer::test_peer(), a, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
                .unwrap();
        let mut request = request.lock().unwrap();
        request.withdraw();
        request.revoke();
        assert_eq!(
            request.status(),
            State::Write(ChatWriteResolution::Uncertain)
        );
        assert_eq!(request.safe_result().unwrap()["outcome"], "unknown");
    }
}
