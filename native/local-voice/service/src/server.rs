use crate::auth::{self, Secret, Verifier};
use crate::http::{self, Request, Response};
use crate::sessions::{self, Active, Command, Factory, Mode};
use crate::stream::Refused;
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const READY: &str = "MEDIFLOW_LOCAL_VOICE_READY";
pub const MAX_CONNECTIONS: usize = 16;
const SOCKET_TIMEOUT: Duration = Duration::from_secs(10);
const RELEASE: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelState {
    Missing,
    Incomplete,
    Ready,
}

impl ModelState {
    fn key(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Incomplete => "incomplete",
            Self::Ready => "ready",
        }
    }
}

pub struct Service {
    port: u16,
    verifier: Mutex<Verifier>,
    active: Mutex<Option<Active>>,
    factory: Factory,
    model: ModelProbe,
}

fn error(status: u16, code: &str) -> Response {
    Response::json(status, &json!({ "error": code }))
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    let filled = std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .is_ok();
    if !filled {
        let seed = Instant::now().elapsed().as_nanos() ^ u128::from(std::process::id());
        bytes = seed.to_le_bytes();
    }
    auth::encode_hex(&bytes)
}

impl Service {
    pub fn new(port: u16, secret: Secret, factory: Factory, model: ModelProbe) -> Self {
        Self {
            port,
            verifier: Mutex::new(Verifier::new(secret)),
            active: Mutex::new(None),
            factory,
            model,
        }
    }

    pub fn handle(&self, request: &Request) -> Response {
        if request.header("origin").is_some()
            || request.header("sec-fetch-site").is_some()
            || request.header("sec-fetch-mode").is_some()
        {
            return error(403, "browser-request");
        }
        if request.header("host") != Some(format!("127.0.0.1:{}", self.port).as_str()) {
            return error(403, "host");
        }
        let checked = {
            let Ok(mut verifier) = self.verifier.lock() else {
                return error(503, "unavailable");
            };
            request
                .header("x-mediflow-voice-auth")
                .ok_or(auth::Refusal::Malformed)
                .and_then(|h| verifier.check(&request.method, &request.path, h))
        };
        let Ok(nonce) = checked else {
            return error(401, "unauthorized");
        };
        let mut response = self.route(request);
        let proof = self
            .verifier
            .lock()
            .map(|v| {
                v.secret()
                    .mac(&auth::response_message(&nonce, response.status))
            })
            .ok();
        response.proof = proof;
        response
    }

    fn route(&self, request: &Request) -> Response {
        let segments: Vec<&str> = request.path.split('/').collect();
        match (request.method.as_str(), segments.as_slice()) {
            ("GET", ["", "v1", "status"]) => self.status(),
            ("POST", ["", "v1", "sessions"]) => self.create(&request.body),
            ("GET", ["", "v1", "sessions", id]) => {
                self.with(id, |a| Response::json(200, &a.snapshot()))
            }
            ("DELETE", ["", "v1", "sessions", id]) => self.discard(id),
            ("POST", ["", "v1", "sessions", id, "audio"]) => self.audio(id, &request.body),
            ("POST", ["", "v1", "sessions", id, "commands"]) => self.command(id, &request.body),
            (_, ["", "v1", "status"] | ["", "v1", "sessions", ..]) => error(405, "method"),
            _ => error(404, "not-found"),
        }
    }

    fn status(&self) -> Response {
        let session = self.active.lock().ok().and_then(|active| {
            active.as_ref().map(|a| {
                let snapshot = a.snapshot();
                json!({ "id": snapshot["id"], "subject": snapshot["subject"], "mode": snapshot["mode"], "state": snapshot["state"] })
            })
        });
        Response::json(
            200,
            &json!({
                "service": "mediflow-voice",
                "version": env!("CARGO_PKG_VERSION"),
                "audio": { "encoding": "pcm_s16le", "sampleRate": 16_000, "channels": 1, "maxRequestBytes": http::MAX_BODY },
                "model": (self.model)().key(),
                "session": session,
            }),
        )
    }

    fn with(&self, id: &str, f: impl FnOnce(&Active) -> Response) -> Response {
        let Ok(active) = self.active.lock() else {
            return error(503, "unavailable");
        };
        match active.as_ref() {
            Some(a) if a.id == id => f(a),
            _ => error(404, "session-not-found"),
        }
    }

    fn create(&self, body: &[u8]) -> Response {
        let Ok(Value::Object(fields)) = serde_json::from_slice::<Value>(body) else {
            return error(400, "body");
        };
        let Some(mode) = fields
            .get("mode")
            .and_then(Value::as_str)
            .and_then(Mode::parse)
        else {
            return error(400, "mode");
        };
        let Some(subject) = fields
            .get("subject")
            .and_then(Value::as_str)
            .filter(|s| sessions::valid_subject(s))
        else {
            return error(400, "subject");
        };
        let vocabulary: Option<Vec<String>> = match fields.get("vocabulary") {
            None => Some(Vec::new()),
            Some(Value::Array(items)) if items.len() <= sessions::MAX_VOCABULARY => items
                .iter()
                .map(|v| v.as_str().filter(|s| s.len() <= 200).map(str::to_owned))
                .collect(),
            Some(_) => None,
        };
        let Some(vocabulary) = vocabulary else {
            return error(400, "vocabulary");
        };
        if (self.model)() == ModelState::Missing {
            return error(503, "model-missing");
        }
        let Ok(mut active) = self.active.lock() else {
            return error(503, "unavailable");
        };
        if let Some(current) = active.as_ref()
            && !current.replaceable()
        {
            return Response::json(
                409,
                &json!({ "error": "session-active", "session": { "id": current.id, "state": sessions::state_key(current.state()) } }),
            );
        }
        if let Some(previous) = active.take() {
            previous.close(RELEASE);
        }
        let session = Active::open(
            random_id(),
            subject.to_owned(),
            mode,
            vocabulary,
            &self.factory,
        );
        let snapshot = session.snapshot();
        active.replace(session);
        Response::json(201, &snapshot)
    }

    fn audio(&self, id: &str, body: &[u8]) -> Response {
        self.with(id, |a| match a.push(body) {
            Ok(_) => Response::json(
                202,
                &json!({ "acceptedSamples": a.feed().accepted(), "pendingSamples": a.feed().pending(), "state": sessions::state_key(a.state()) }),
            ),
            Err(Refused::OddLength) => error(400, "odd-length"),
            Err(Refused::Full) => error(429, "backlog"),
            Err(Refused::Paused) => error(409, "paused"),
            Err(Refused::Closed) => Response::json(
                409,
                &json!({ "error": "not-recording", "state": sessions::state_key(a.state()) }),
            ),
        })
    }

    fn command(&self, id: &str, body: &[u8]) -> Response {
        let command = serde_json::from_slice::<Value>(body).ok().and_then(|v| {
            v.get("command")
                .and_then(Value::as_str)
                .and_then(Command::parse)
        });
        let Some(command) = command else {
            return error(400, "command");
        };
        let feed = {
            let Ok(active) = self.active.lock() else {
                return error(503, "unavailable");
            };
            let Some(a) = active.as_ref().filter(|a| a.id == id) else {
                return error(404, "session-not-found");
            };
            if !a.allows(command) {
                return Response::json(
                    409,
                    &json!({ "error": "not-allowed", "state": sessions::state_key(a.state()) }),
                );
            }
            let feed = a.feed();
            match command {
                Command::Stop => feed.close(),
                Command::Pause => feed.hold(),
                Command::Start | Command::Resume => {}
            }
            feed
        };
        if command.drains() {
            let until = Instant::now() + sessions::DRAIN_LIMIT;
            while feed.pending() > 0 && Instant::now() < until {
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        self.with(id, |a| {
            a.send(command);
            Response::json(202, &a.snapshot())
        })
    }

    fn discard(&self, id: &str) -> Response {
        let taken = {
            let Ok(mut active) = self.active.lock() else {
                return error(503, "unavailable");
            };
            match active.as_ref() {
                Some(a) if a.id == id => active.take(),
                _ => return error(404, "session-not-found"),
            }
        };
        if let Some(session) = taken {
            session.close(RELEASE);
        }
        Response::empty(204)
    }

    pub fn shutdown(&self) {
        let taken = self.active.lock().ok().and_then(|mut a| a.take());
        if let Some(session) = taken {
            session.close(mediflow_local_voice::RELEASE_BEFORE_EXIT);
        }
    }
}

fn serve_connection(service: &Service, mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(SOCKET_TIMEOUT));
    let _ = stream.set_write_timeout(Some(SOCKET_TIMEOUT));
    let response = match http::read_request(&mut stream) {
        Ok(request) => service.handle(&request),
        Err(http::ReadError::TooLarge) => error(413, "too-large"),
        Err(_) => error(400, "request"),
    };
    let _ = http::write_response(&mut stream, &response);
    let _ = stream.shutdown(std::net::Shutdown::Both);
}

pub fn serve(service: Arc<Service>, listener: TcpListener) {
    let open = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else {
            continue;
        };
        if !stream.peer_addr().is_ok_and(|a| a.ip().is_loopback()) {
            continue;
        }
        if open.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
            open.fetch_sub(1, Ordering::SeqCst);
            let _ = http::write_response(&mut stream, &error(503, "busy"));
            continue;
        }
        let service = service.clone();
        let open = open.clone();
        std::thread::spawn(move || {
            serve_connection(&service, stream);
            open.fetch_sub(1, Ordering::SeqCst);
        });
    }
}

type ModelProbe = Box<dyn Fn() -> ModelState + Send + Sync>;

fn engine(directory: PathBuf) -> (Factory, ModelProbe) {
    use mediflow_local_voice::model::{self, ModelStatus};
    use mediflow_local_voice::whisper::{Engine, WhisperSession, load_whisper};
    let probe = directory.clone();
    let factory: Factory = Box::new(move |source, prompt| {
        WhisperSession::new(
            Engine {
                directory: directory.clone(),
                files: model::FILES,
                prompt,
                load: load_whisper,
            },
            source,
        )
    });
    let model = Box::new(move || match model::quick_status(&probe, &model::FILES) {
        ModelStatus::Missing => ModelState::Missing,
        ModelStatus::Invalid => ModelState::Incomplete,
        ModelStatus::Verified => ModelState::Ready,
    });
    (factory, model)
}

fn models_directory() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("MEDIFLOW_LOCAL_VOICE_MODELS") {
        let dir = PathBuf::from(dir);
        return dir.is_absolute().then_some(dir);
    }
    let home = PathBuf::from(std::env::var_os("HOME")?);
    home.is_absolute()
        .then(|| home.join("Library/Application Support/MediFlow GPUI/modelli-voce"))
}

pub fn run_from_env() -> i32 {
    let Some(secret) = std::env::var("MEDIFLOW_LOCAL_VOICE_SECRET")
        .ok()
        .and_then(|s| Secret::from_hex(&s))
    else {
        eprintln!(
            "mediflow-voice: MEDIFLOW_LOCAL_VOICE_SECRET deve essere di 64 cifre esadecimali"
        );
        return 2;
    };
    let Some(directory) = models_directory() else {
        eprintln!("mediflow-voice: cartella del modello non valida");
        return 2;
    };
    let Ok(listener) = TcpListener::bind(("127.0.0.1", 0)) else {
        eprintln!("mediflow-voice: porta sul loopback non disponibile");
        return 1;
    };
    let Ok(port) = listener.local_addr().map(|a| a.port()) else {
        return 1;
    };
    let (factory, model) = engine(directory);
    let service = Arc::new(Service::new(port, secret, factory, model));
    let watcher = service.clone();
    std::thread::spawn(move || {
        let mut sink = [0u8; 256];
        let mut stdin = std::io::stdin();
        while stdin.read(&mut sink).is_ok_and(|n| n > 0) {}
        watcher.shutdown();
        std::process::exit(0);
    });
    let mut stdout = std::io::stdout();
    if writeln!(stdout, "{READY} {}", json!({ "port": port })).is_err() || stdout.flush().is_err() {
        return 1;
    }
    serve(service, listener);
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use mediflow_local_voice::listening::tests::{
        CountingDecoder, LoudnessDetector, silence, tone,
    };
    use mediflow_local_voice::whisper::WhisperSession;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zeroize::Zeroizing;

    const KEY: &str = "5f5e5d5c5b5a595857565554535251504f4e4d4c4b4a49484746454443424140";
    const PORT: u16 = 41_000;

    fn service(model: ModelState) -> Service {
        let factory: Factory = Box::new(|source, _prompt| {
            WhisperSession::with_parts(LoudnessDetector, CountingDecoder::default(), source)
        });
        Service::new(
            PORT,
            Secret::from_hex(KEY).unwrap(),
            factory,
            Box::new(move || model),
        )
    }

    fn signed(method: &str, path: &str, body: &[u8]) -> (Request, String) {
        let secret = Secret::from_hex(KEY).unwrap();
        let nonce = random_id();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .to_string();
        let mac = secret.mac(&auth::request_message(method, path, &timestamp, &nonce));
        let request = Request {
            method: method.into(),
            path: path.into(),
            headers: vec![
                ("host".into(), format!("127.0.0.1:{PORT}")),
                (
                    "x-mediflow-voice-auth".into(),
                    format!("{timestamp}.{nonce}.{mac}"),
                ),
            ],
            body: Zeroizing::new(body.to_vec()),
        };
        (request, nonce)
    }

    fn call(service: &Service, method: &str, path: &str, body: &[u8]) -> (u16, Value) {
        let (request, nonce) = signed(method, path, body);
        let response = service.handle(&request);
        let expected = Secret::from_hex(KEY)
            .unwrap()
            .mac(&auth::response_message(&nonce, response.status));
        assert_eq!(response.proof.as_deref(), Some(expected.as_str()));
        let value = serde_json::from_slice(&response.body).unwrap_or(Value::Null);
        (response.status, value)
    }

    fn pcm(samples: &[f32]) -> Vec<u8> {
        samples
            .iter()
            .flat_map(|s| ((s * 32_767.0) as i16).to_le_bytes())
            .collect()
    }

    fn wait_state(service: &Service, id: &str, wanted: &str) -> Value {
        for _ in 0..2_000 {
            let (_, snapshot) = call(service, "GET", &format!("/v1/sessions/{id}"), b"");
            if snapshot["state"] == wanted {
                return snapshot;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("state {wanted} not reached");
    }

    #[test]
    fn streamed_audio_becomes_reviewable_text_only_after_stop() {
        let service = service(ModelState::Ready);
        let (status, created) = call(
            &service,
            "POST",
            "/v1/sessions",
            br#"{"mode":"visit","subject":"paziente-sintetico-1","vocabulary":["Metformina"]}"#,
        );
        assert_eq!(status, 201);
        assert_eq!(created["state"], "ready");
        assert_eq!(created["subject"], "paziente-sintetico-1");
        let id = created["id"].as_str().unwrap().to_owned();
        let audio_path = format!("/v1/sessions/{id}/audio");
        assert_eq!(call(&service, "POST", &audio_path, &pcm(&tone(0.5))).0, 409);
        let (status, _) = call(
            &service,
            "POST",
            &format!("/v1/sessions/{id}/commands"),
            br#"{"command":"start"}"#,
        );
        assert_eq!(status, 202);
        let mut audio = tone(3.0);
        audio.extend(silence(1.0));
        audio.extend(tone(2.0));
        for chunk in pcm(&audio).chunks(16_000) {
            assert_eq!(call(&service, "POST", &audio_path, chunk).0, 202);
        }
        let recording = wait_state(&service, &id, "recording");
        assert!(recording["review"].is_null());
        let (status, stopped) = call(
            &service,
            "POST",
            &format!("/v1/sessions/{id}/commands"),
            br#"{"command":"stop"}"#,
        );
        assert_eq!(status, 202, "{stopped}");
        assert_eq!(stopped["pendingSamples"], 0);
        let review = wait_state(&service, &id, "review");
        let text = review["review"]["text"].as_str().unwrap();
        assert!(text.contains("parola"), "{text}");
        assert_eq!(review["acceptedSamples"], audio.len());
        assert_eq!(call(&service, "POST", &audio_path, &pcm(&tone(0.5))).0, 409);
        let (status, busy) = call(
            &service,
            "POST",
            "/v1/sessions",
            br#"{"mode":"dictation","subject":"altro"}"#,
        );
        assert_eq!(
            (status, busy["error"].as_str()),
            (409, Some("session-active"))
        );
        let (_, current) = call(&service, "GET", "/v1/status", b"");
        assert_eq!(current["session"]["id"], id.as_str());
        assert_eq!(
            call(&service, "DELETE", &format!("/v1/sessions/{id}"), b"").0,
            204
        );
        assert_eq!(
            call(&service, "GET", &format!("/v1/sessions/{id}"), b"").0,
            404
        );
        assert_eq!(
            call(
                &service,
                "POST",
                "/v1/sessions",
                br#"{"mode":"dictation","subject":"altro"}"#
            )
            .0,
            201
        );
    }

    #[test]
    fn audio_that_stops_arriving_keeps_the_text_for_review() {
        let service = service(ModelState::Ready);
        let (_, created) = call(
            &service,
            "POST",
            "/v1/sessions",
            br#"{"mode":"dictation","subject":"s"}"#,
        );
        let id = created["id"].as_str().unwrap().to_owned();
        call(
            &service,
            "POST",
            &format!("/v1/sessions/{id}/commands"),
            br#"{"command":"start"}"#,
        );
        let mut audio = tone(2.0);
        audio.extend(silence(1.0));
        call(
            &service,
            "POST",
            &format!("/v1/sessions/{id}/audio"),
            &pcm(&audio),
        );
        let lost = wait_state(&service, &id, "error");
        assert_eq!(lost["fault"], "audio-lost");
        assert!(lost["review"]["text"].as_str().unwrap().contains("parola"));
        assert_eq!(
            call(
                &service,
                "POST",
                "/v1/sessions",
                br#"{"mode":"dictation","subject":"s"}"#
            )
            .0,
            409
        );
    }

    #[test]
    fn missing_model_bad_input_and_illegal_commands_are_refused() {
        let missing = service(ModelState::Missing);
        let (status, body) = call(
            &missing,
            "POST",
            "/v1/sessions",
            br#"{"mode":"visit","subject":"s"}"#,
        );
        assert_eq!(
            (status, body["error"].as_str()),
            (503, Some("model-missing"))
        );
        let (_, status_body) = call(&missing, "GET", "/v1/status", b"");
        assert_eq!(status_body["model"], "missing");
        let service = service(ModelState::Ready);
        for body in [
            &br#"{"mode":"altro","subject":"s"}"#[..],
            br#"{"mode":"visit","subject":"con spazio"}"#,
            br#"{"mode":"visit"}"#,
            br#"{"mode":"visit","subject":"s","vocabulary":"x"}"#,
            b"non json",
        ] {
            assert_eq!(call(&service, "POST", "/v1/sessions", body).0, 400);
        }
        let (_, created) = call(
            &service,
            "POST",
            "/v1/sessions",
            br#"{"mode":"visit","subject":"s"}"#,
        );
        let id = created["id"].as_str().unwrap();
        let (status, refused) = call(
            &service,
            "POST",
            &format!("/v1/sessions/{id}/commands"),
            br#"{"command":"stop"}"#,
        );
        assert_eq!(
            (status, refused["error"].as_str()),
            (409, Some("not-allowed"))
        );
        assert_eq!(
            call(
                &service,
                "POST",
                &format!("/v1/sessions/{id}/commands"),
                br#"{"command":"x"}"#
            )
            .0,
            400
        );
        assert_eq!(call(&service, "GET", "/v1/sessions/altro", b"").0, 404);
        assert_eq!(call(&service, "PUT", "/v1/status", b"").0, 405);
    }

    #[test]
    fn unsigned_browser_and_foreign_host_requests_get_no_proof() {
        let service = service(ModelState::Ready);
        let (mut request, _) = signed("GET", "/v1/status", b"");
        request
            .headers
            .retain(|(k, _)| k != "x-mediflow-voice-auth");
        let response = service.handle(&request);
        assert_eq!((response.status, response.proof.is_none()), (401, true));
        for (name, value) in [
            ("origin", "http://127.0.0.1:3000"),
            ("sec-fetch-site", "cross-site"),
        ] {
            let (mut request, _) = signed("GET", "/v1/status", b"");
            request.headers.push((name.into(), value.into()));
            let response = service.handle(&request);
            assert_eq!((response.status, response.proof.is_none()), (403, true));
        }
        let (mut request, _) = signed("GET", "/v1/status", b"");
        request.headers[0].1 = format!("evil.example:{PORT}");
        assert_eq!(service.handle(&request).status, 403);
        let (request, _) = signed("GET", "/v1/status", b"");
        assert_eq!(service.handle(&request).status, 200);
        assert_eq!(service.handle(&request).status, 401);
    }
}
