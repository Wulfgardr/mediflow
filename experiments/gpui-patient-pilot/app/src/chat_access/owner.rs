use super::native::{self, Peer};
use mediflow_runtime_client::{ChatAccessContext, RuntimeSession};
use std::{
    os::unix::net::UnixStream,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub(crate) const OPERATION: &str = "mediflow.chat.access-status.v1";
const CHALLENGE: Duration = Duration::from_secs(30);
const VIEW_IDLE: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum State {
    Requested,
    Challenge,
    Approving,
    Approved,
    Consuming,
    Consumed,
    Withdrawn,
}
impl State {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::Challenge => "challenge",
            Self::Approving => "approving",
            Self::Approved => "approved",
            Self::Consuming => "consuming",
            Self::Consumed => "consumed",
            Self::Withdrawn => "withdrawn",
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
pub(crate) struct Request {
    attempt: Attempt,
    state: State,
    peer: Peer,
    stream: UnixStream,
    lock_epoch: u64,
    created: Instant,
    deadline: Option<Instant>,
    binding: Option<Binding>,
}
pub(crate) type Pending = Arc<Mutex<Request>>;

impl Request {
    pub(super) fn new(peer: Peer, stream: UnixStream) -> Option<Pending> {
        let mut nonce = [0; 32];
        getrandom::fill(&mut nonce).ok()?;
        Some(Arc::new(Mutex::new(Self {
            attempt: Attempt(nonce),
            state: State::Requested,
            peer,
            stream,
            lock_epoch: native::lock_epoch(),
            created: Instant::now(),
            deadline: None,
            binding: None,
        })))
    }
    pub(crate) fn app(&self) -> &'static str {
        self.peer.app()
    }
    pub(crate) fn withdraw(&mut self) {
        native::cancel_biometric(&self.attempt.0);
        self.state = State::Withdrawn;
        self.binding = None;
        self.attempt.0.fill(0);
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
        if !matches!(self.state, State::Consumed | State::Withdrawn)
            && !self.current(Instant::now())
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
        self.binding = Some(Binding { session, context });
        self.deadline = Some(Instant::now() + CHALLENGE);
        self.state = State::Challenge;
        true
    }
    pub(crate) fn begin(&mut self) -> Option<(RuntimeSession, ChatAccessContext, Attempt)> {
        if self.status() != State::Challenge {
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
        self.attempt.0.fill(0);
        self.binding = None;
        self.state
    }
}

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
mod tests {
    use super::*;
    use mediflow_runtime_client::{PairingCredentials, RuntimeClient, RuntimeConfig};
    use serde_json::{Value, json};
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::atomic::{AtomicUsize, Ordering},
    };

    struct Host {
        state: Arc<AtomicUsize>,
        worker: Option<std::thread::JoinHandle<()>>,
    }
    impl Drop for Host {
        fn drop(&mut self) {
            self.state.store(2, Ordering::Release);
            self.worker.take().unwrap().join().unwrap();
        }
    }

    fn native_session() -> (RuntimeSession, Host) {
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
                        json!({"success":true,"id":"synthetic-user","username":"synthetic","role":"admin",
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
                        "operator":{"userId":"synthetic-user","authChannel":"native"}}),
                    )
                } else if first.starts_with("GET /api/auth/native/chat-access-confirmation ") {
                    (200, json!({"status":"eligible"}))
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
        for restore in [false, true] {
            let (session, host) = native_session();
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            let (request, _remote) = connected();
            assert!(request.lock().unwrap().bind(session.clone(), context));
            let (_, _, attempt) = request.lock().unwrap().begin().unwrap();
            request.lock().unwrap().finish(attempt, true);
            if restore {
                host.state.store(1, Ordering::Release);
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
}
