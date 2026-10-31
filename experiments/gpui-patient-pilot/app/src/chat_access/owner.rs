use super::native::{self, Peer};
#[cfg(all(test, target_os = "macos"))]
use mediflow_runtime_client::ChatWriteOutcome;
use mediflow_runtime_client::{
    ChatAccessContext, ChatWriteRecovery, ChatWriteResolution, RuntimeSession,
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
    cancelled: Arc<AtomicBool>,
    therapy: Option<TherapyWrite>,
    document: bool,
    voice: bool,
    recovery: Option<ChatWriteRecovery>,
    catalog: Option<(String, String, String)>,
    catalog_query: Option<String>,
    prosthetics: bool,
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
            cancelled: Arc::new(AtomicBool::new(false)),
            therapy: None,
            document: false,
            voice: false,
            recovery: None,
            catalog: None,
            catalog_query: None,
            prosthetics: false,
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
    pub(crate) fn is_catalog(&self) -> bool {
        self.catalog_query.is_some()
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
        });
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
    pub(crate) fn needs_card(&mut self) -> bool {
        self.status() == State::Preparing
    }
    fn install_card(&mut self, card: Option<super::card::Card>) {
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
            if p.references.remember(&id).is_err() {
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

pub(crate) fn execute_therapy(pending: &Pending, attempt: Attempt, pin: &str) -> bool {
    let binding = pending.lock().ok().and_then(|mut p| {
        if attempt != p.attempt || p.status() != State::Approving {
            return None;
        }
        let (_, id) = p.therapy.as_ref()?.selected.as_ref()?;
        let b = p.binding.as_ref()?;
        p.references.remember(id).ok()?;
        let result = (b.session.clone(), b.context.clone(), id.clone());
        p.state = State::Consuming;
        Some(result)
    });
    let Some((session, context, id)) = binding else {
        return false;
    };
    let result = session.chat_therapy_request(
        &context,
        &serde_json::json!({"operation":"execute","commandId":id,"pin":pin}),
    );
    let receipt = session
        .chat_therapy_request(
            &context,
            &serde_json::json!({"operation":"receipt","commandId":id}),
        )
        .ok();
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
        let result = if prosthetics {
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
                let mut value = serde_json::json!({"profile":if prosthetics {"mediflow.prosthetics-catalog.v1"} else {"mediflow.drug-catalog.v1"}, "query":query,
                    "freshness":"unverified", "limit":20, "rows":projected});
                if prosthetics {
                    value["truncated"] = rows["truncated"].clone();
                }
                let payload = value.to_string();
                if payload.len() > 60000 {
                    p.withdraw();
                    return;
                }
                let digest = format!("{:x}", Sha256::digest(payload.as_bytes()));
                p.catalog = Some((payload, digest, "Catalogo locale. Data di aggiornamento non verificata. Massimo 20 risultati; affinare la ricerca se il limite è raggiunto.".into()));
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
            if t.target != "receipt" {
                return None;
            }
            Some(t.selected.as_ref()?.1.clone())
        });
        if let Some(id) = recovery {
            let recovery = session.chat_therapy_recovery(&context, &id);
            if let Ok(mut p) = pending.lock() {
                if p.status() != State::Preparing {
                    return;
                }
                p.recovery = recovery.ok();
                let _ = p.references.remember(&id);
                p.reconcile_therapy();
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
    let card = super::card::Card::prepare(cancelled);
    if let Ok(mut p) = pending.lock() {
        p.install_card(card);
    }
}

pub(crate) fn consume_card(pending: &Pending) -> (State, Option<String>) {
    let binding = pending.lock().ok().and_then(|mut p| p.begin_consume());
    let valid = binding
        .as_ref()
        .is_some_and(|(s, c)| s.revalidate_chat_access_context(c).is_ok());
    let mut payload = None;
    if valid
        && let Ok(mut p) = pending.lock()
        && p.status() == State::Consuming
    {
        payload = if let Some((bytes, _, _)) = p.catalog.take() {
            Some(bytes)
        } else {
            p.card.as_mut().and_then(|c| c.consume())
        };
    }
    let valid = payload.is_some()
        && binding.is_some_and(|(s, c)| s.revalidate_chat_access_context(&c).is_ok());
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
                let Ok((mut socket, _)) = listener.accept() else {
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
                        json!({"protocolVersion":"1.13.0","operatingMode":"network-home-base","capabilities":[],"hostPorts":ports}),
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
                        "receipt" => {
                            json!({"outcome":"terminal", "receipt":{"outcome":"applied"},"current":{"version":2,"status":"suspended"}})
                        }
                        "revoke" => {
                            json!({"outcome":if current.load(Ordering::Acquire) == 4 {"applied"} else {"retired"}})
                        }
                        _ => panic!("unexpected native test operation"),
                    };
                    (200, result)
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
                worker: Some(worker),
            },
        )
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
