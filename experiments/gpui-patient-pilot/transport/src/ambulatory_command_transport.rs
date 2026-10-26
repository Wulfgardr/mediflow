use crate::{
    AMBULATORY_COMMAND_PROTOCOL, AmbulatoryCommandIntent, AmbulatoryCommandMarker,
    AmbulatoryCommandPreview, AmbulatoryCommandRead, AmbulatoryCommandRecoveryStore,
    AmbulatoryCommandRetirement, PairingCredentials, PersistedAmbulatoryCommand, RequestContext,
    Result, RuntimeClient, RuntimeError, RuntimeUser,
    ambulatory_command_recovery::CommandRecoveryBinding,
    ambulatory_commands::{hex64, uuid},
    http::{
        authenticate_web_p3, control_cookie, cookie_header, encode_cookie_value, sensitive_header,
    },
};
use reqwest::{
    Method,
    header::{COOKIE, HeaderMap},
};
use serde::Deserialize;
use serde_json::json;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use zeroize::Zeroizing;

#[derive(Clone)]
pub(crate) enum AmbulatoryCommandPurpose {
    Execute(AmbulatoryCommandIntent),
    Recover(AmbulatoryCommandMarker),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Identity {
    protocol: String,
    command_id: String,
    original_archive_generation: String,
    original_scope_id: String,
    ambulatory_id: String,
    expected_version: u64,
    operation: crate::AmbulatoryCommandOperation,
}
impl Identity {
    fn marker(self) -> AmbulatoryCommandMarker {
        AmbulatoryCommandMarker {
            protocol: self.protocol,
            command_id: self.command_id,
            original_archive_generation: self.original_archive_generation,
            original_scope_id: self.original_scope_id,
            ambulatory_id: self.ambulatory_id,
            expected_version: self.expected_version,
            operation: self.operation,
            plan_digest: "0".repeat(64),
        }
    }
}
/// This transport owns only one named command's dedicated WebP3 cookie/control.
/// Pairing and the native cookie are used at begin and are never stored here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AmbulatoryCommandAuthority {
    Prepared,
    Authorized,
    Unconfirmed,
    LocallyRetired,
    Retired,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AmbulatoryCommandDispatch {
    NotSent,
    Unknown,
    Terminal(AmbulatoryCommandRead),
}
pub struct HostAmbulatoryCommand {
    client: RuntimeClient,
    binding: CommandRecoveryBinding,
    retired: AtomicBool,
    outcome: Mutex<AmbulatoryCommandDispatch>,
    user: RuntimeUser,
    generation: String,
    identity: AmbulatoryCommandMarker,
    recovery: bool,
    reference: Zeroizing<String>,
    control: Zeroizing<String>,
    cookie: Mutex<Zeroizing<String>>,
    marker: Mutex<Option<AmbulatoryCommandMarker>>,
    auth_attempted: AtomicBool,
    authenticated: AtomicBool,
    preview_attempted: AtomicBool,
    sent: AtomicBool,
}
impl HostAmbulatoryCommand {
    pub(crate) fn prepare(
        client: RuntimeClient,
        user: &RuntimeUser,
        pairing: &PairingCredentials,
        native_cookie: &str,
        purpose: AmbulatoryCommandPurpose,
    ) -> Result<Self> {
        if user.role != "admin" || !client.is_local_bootstrap_origin() {
            return Err(RuntimeError::Forbidden);
        }
        let (name, command, scope, recovery_marker) = match purpose {
            AmbulatoryCommandPurpose::Execute(intent) => {
                intent.validate()?;
                let scope = intent.original_scope_id.clone();
                (
                    "execute",
                    serde_json::to_value(intent).map_err(|_| RuntimeError::InvalidInput)?,
                    Some(scope),
                    None,
                )
            }
            AmbulatoryCommandPurpose::Recover(marker) => {
                marker.validate()?;
                (
                    "recover",
                    serde_json::to_value(&marker).map_err(|_| RuntimeError::InvalidInput)?,
                    None,
                    Some(marker),
                )
            }
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-mediflow-paired-client-id",
            sensitive_header(&pairing.id)?,
        );
        headers.insert(
            "x-mediflow-paired-client-token",
            sensitive_header(&pairing.token)?,
        );
        headers.insert(
            COOKIE,
            sensitive_header(&cookie_header(native_cookie, scope.as_deref())?)?,
        );
        headers.insert(
            "x-mediflow-archive-generation",
            sensitive_header(&user.archive_generation)?,
        );
        if let Some(scope) = &scope {
            headers.insert(
                "x-mediflow-expected-ambulatory-id",
                sensitive_header(&encode_cookie_value(scope))?,
            );
        }
        let opened = client
            .dedicated_web_raw(
                Method::POST,
                &["api", "auth", "ambulatory-commands", "begin"],
                headers,
                Some(&json!({"purpose":name,"command":command})),
                false,
            )
            .map_err(|error| {
                if error == RuntimeError::Rejected(401) {
                    RuntimeError::Authentication
                } else {
                    error
                }
            })?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Open {
            protocol: String,
            contract_version: u64,
            purpose: String,
            command: Identity,
            reference: String,
            current_archive_generation: String,
            expires_at: u64,
        }
        let open: Open =
            serde_json::from_slice(&opened.body).map_err(|_| RuntimeError::InvalidResponse)?;
        let identity = open.command.marker();
        identity.validate()?;
        if opened.status != 200
            || open.protocol != AMBULATORY_COMMAND_PROTOCOL
            || open.contract_version != 1
            || open.purpose != name
            || open.current_archive_generation != user.archive_generation
            || !hex64(&open.reference)
            || open.expires_at == 0
            || open.expires_at > crate::MAX_SAFE_VERSION
            || !uuid(&identity.command_id)
            || serde_json::to_value(identity.intent()).map_err(|_| RuntimeError::InvalidResponse)?
                != if name == "execute" {
                    command
                } else {
                    serde_json::to_value(recovery_marker.as_ref().unwrap().intent())
                        .map_err(|_| RuntimeError::InvalidResponse)?
                }
            || (name == "execute"
                && identity.original_archive_generation != user.archive_generation)
            || recovery_marker.as_ref().is_some_and(|marker| {
                marker.command_id != identity.command_id
                    || marker.original_archive_generation != identity.original_archive_generation
            })
        {
            return Err(RuntimeError::InvalidResponse);
        }
        let control = control_cookie(&opened.headers, "mediflow_auth_control", 32, 256)?;
        Ok(Self {
            binding: CommandRecoveryBinding {
                host_origin: client.base_url().into(),
                actor_id: user.id.clone(),
                device_id: pairing.id.clone(),
            },
            retired: AtomicBool::new(false),
            outcome: Mutex::new(AmbulatoryCommandDispatch::NotSent),
            client,
            user: user.clone(),
            generation: user.archive_generation.clone(),
            identity,
            recovery: recovery_marker.is_some(),
            reference: Zeroizing::new(open.reference),
            control,
            cookie: Mutex::new(Zeroizing::new(String::new())),
            marker: Mutex::new(recovery_marker),
            auth_attempted: AtomicBool::new(false),
            authenticated: AtomicBool::new(false),
            preview_attempted: AtomicBool::new(false),
            sent: AtomicBool::new(false),
        })
    }
    fn headers(&self) -> Result<HeaderMap> {
        let cookie = self.cookie.lock().map_err(|_| RuntimeError::Locked)?;
        let value = Zeroizing::new(if cookie.is_empty() {
            format!("mediflow_auth_control={}", *self.control)
        } else {
            format!(
                "mediflow_session={}; mediflow_auth_control={}",
                **cookie, *self.control
            )
        });
        let mut headers = HeaderMap::new();
        headers.insert(COOKIE, sensitive_header(&value)?);
        headers.insert(
            "x-mediflow-ambulatory-command-reference",
            sensitive_header(&self.reference)?,
        );
        headers.insert(
            "x-mediflow-archive-generation",
            sensitive_header(&self.generation)?,
        );
        Ok(headers)
    }
    pub fn authenticate(&self, passphrase: &str) -> Result<()> {
        if passphrase.is_empty() {
            return Err(RuntimeError::InvalidInput);
        }
        if self.auth_attempted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let (cookie, result) =
            authenticate_web_p3(&self.client, &self.user, self.headers()?, passphrase);
        if let Some(cookie) = cookie {
            *self.cookie.lock().map_err(|_| RuntimeError::Locked)? = cookie;
        }
        result?;
        self.client.context.check()?;
        self.authenticated.store(true, Ordering::Release);
        Ok(())
    }
    pub fn preview(&self) -> Result<AmbulatoryCommandPreview> {
        if self.recovery
            || !self.authenticated.load(Ordering::Acquire)
            || self.preview_attempted.swap(true, Ordering::AcqRel)
        {
            return Err(RuntimeError::ReadRequired);
        }
        let raw = self.observe(self.client.dedicated_web_raw(
            Method::POST,
            &["api", "auth", "ambulatory-commands", "preview"],
            self.headers()?,
            Some(&json!({})),
            false,
        ))?;
        let preview = AmbulatoryCommandPreview::parse(&raw.body, &self.identity)?;
        self.client.context.check()?;
        *self.marker.lock().map_err(|_| RuntimeError::Locked)? = Some(preview.marker.clone());
        Ok(preview)
    }
    pub fn execute(
        &self,
        persisted: &PersistedAmbulatoryCommand,
        confirmation: &str,
    ) -> Result<AmbulatoryCommandRead> {
        if self.recovery || !self.authenticated.load(Ordering::Acquire) {
            return Err(RuntimeError::ReadRequired);
        }
        let marker = self
            .marker
            .lock()
            .map_err(|_| RuntimeError::Locked)?
            .clone()
            .ok_or(RuntimeError::ReadRequired)?;
        persisted.verify(&self.binding, &marker)?;
        if confirmation != marker.operation.confirmation() {
            return Err(RuntimeError::InvalidInput);
        }
        self.client.context.check()?;
        if self.sent.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        *self.outcome.lock().map_err(|_| RuntimeError::Locked)? =
            AmbulatoryCommandDispatch::Unknown;
        let raw=self.observe(self.client.dedicated_web_raw(Method::POST,&["api","auth","ambulatory-commands","execute"],self.headers()?,
            Some(&json!({"operation":marker.operation,"planDigest":marker.plan_digest,"confirmation":confirmation})),true))?;
        self.accept_response(&raw.body, &marker, false, true)
    }
    pub fn read_receipt(&self) -> Result<AmbulatoryCommandRead> {
        self.recover(false)
    }
    pub fn close(&self) -> Result<AmbulatoryCommandRead> {
        self.recover(true)
    }
    fn recover(&self, close: bool) -> Result<AmbulatoryCommandRead> {
        if !self.recovery || !self.authenticated.load(Ordering::Acquire) {
            return Err(RuntimeError::ReadRequired);
        }
        self.client.context.check()?;
        if close && self.sent.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let marker = self
            .marker
            .lock()
            .map_err(|_| RuntimeError::Locked)?
            .clone()
            .ok_or(RuntimeError::ReadRequired)?;
        if close {
            *self.outcome.lock().map_err(|_| RuntimeError::Locked)? =
                AmbulatoryCommandDispatch::Unknown;
        }
        let action = if close { "close" } else { "receipt" };
        let raw = self.observe(self.client.dedicated_web_raw(
            Method::POST,
            &["api", "auth", "ambulatory-commands", action],
            self.headers()?,
            Some(&json!({})),
            close,
        ))?;
        self.accept_response(&raw.body, &marker, !close, close)
    }
    pub fn persist_preview(
        &self,
        store: &AmbulatoryCommandRecoveryStore,
    ) -> Result<PersistedAmbulatoryCommand> {
        if !self.authenticated.load(Ordering::Acquire) || !store.matches(&self.binding) {
            return Err(RuntimeError::ReadRequired);
        }
        self.client.context.admit_file_effect()?;
        let marker = self
            .marker
            .lock()
            .map_err(|_| RuntimeError::Locked)?
            .clone()
            .ok_or(RuntimeError::ReadRequired)?;
        let proof = store.persist(&marker)?;
        self.client.context.check()?;
        Ok(proof)
    }
    fn accept_response(
        &self,
        body: &[u8],
        marker: &AmbulatoryCommandMarker,
        allow_unknown: bool,
        mutation: bool,
    ) -> Result<AmbulatoryCommandRead> {
        let result = AmbulatoryCommandRead::parse(body, marker, allow_unknown)?.bind(&self.binding);
        if self.client.context.check().is_err() {
            return Err(if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::ReadRequired
            });
        }
        *self.outcome.lock().map_err(|_| RuntimeError::Locked)? = match &result {
            AmbulatoryCommandRead::Unknown => AmbulatoryCommandDispatch::Unknown,
            AmbulatoryCommandRead::Terminal(_) => {
                AmbulatoryCommandDispatch::Terminal(result.clone())
            }
        };
        Ok(result)
    }
    pub fn authority(&self) -> AmbulatoryCommandAuthority {
        if self.retired.load(Ordering::Acquire) {
            AmbulatoryCommandAuthority::Retired
        } else if self.client.context.check().is_err() {
            AmbulatoryCommandAuthority::LocallyRetired
        } else if self.authenticated.load(Ordering::Acquire) {
            AmbulatoryCommandAuthority::Authorized
        } else if self.auth_attempted.load(Ordering::Acquire) {
            AmbulatoryCommandAuthority::Unconfirmed
        } else {
            AmbulatoryCommandAuthority::Prepared
        }
    }
    pub fn dispatch(&self) -> Result<AmbulatoryCommandDispatch> {
        Ok(self
            .outcome
            .lock()
            .map_err(|_| RuntimeError::Locked)?
            .clone())
    }
    fn observe(
        &self,
        result: Result<crate::http::RawResponse>,
    ) -> Result<crate::http::RawResponse> {
        if result.as_ref().is_err_and(|error| {
            matches!(
                error,
                RuntimeError::Rejected(401)
                    | RuntimeError::Forbidden
                    | RuntimeError::ArchiveReplaced
            )
        }) {
            self.authenticated.store(false, Ordering::Release);
            self.cancel_local();
        }
        result
    }
    pub fn cancel_local(&self) {
        self.client.context.cancel();
    }
    pub fn retire(&self) -> Result<AmbulatoryCommandRetirement> {
        self.cancel_local();
        let raw = self
            .client
            .with_request_context(RequestContext::default())
            .dedicated_web_raw(
                Method::POST,
                &["api", "auth", "ambulatory-commands", "retire"],
                self.headers()?,
                Some(&json!({})),
                false,
            )?;
        if raw.status == 204 && raw.body.is_empty() {
            self.authenticated.store(false, Ordering::Release);
            self.retired.store(true, Ordering::Release);
            Ok(AmbulatoryCommandRetirement {
                binding: self.binding.clone(),
                command_id: self.identity.command_id.clone(),
            })
        } else {
            Err(RuntimeError::InvalidResponse)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AmbulatoryCommandOperation, RuntimeConfig};
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        thread,
        time::{Duration, Instant},
    };
    fn marker() -> AmbulatoryCommandMarker {
        AmbulatoryCommandMarker {
            protocol: AMBULATORY_COMMAND_PROTOCOL.into(),
            command_id: "11111111-1111-4111-8111-111111111111".into(),
            original_archive_generation: "22222222-2222-4222-8222-222222222222".into(),
            original_scope_id: "scope".into(),
            ambulatory_id: "target".into(),
            expected_version: 1,
            operation: AmbulatoryCommandOperation::ClearTest,
            plan_digest: "a".repeat(64),
        }
    }
    fn user() -> RuntimeUser {
        RuntimeUser {
            id: "synthetic-admin".into(),
            username: "synthetic".into(),
            display_name: None,
            role: "admin".into(),
            archive_generation: marker().original_archive_generation,
        }
    }
    fn listener() -> (TcpListener, String) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        (listener, url)
    }
    fn accept(listener: &TcpListener) -> TcpStream {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            match listener.accept() {
                Ok((s, _)) => {
                    s.set_nonblocking(false).unwrap();
                    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                    return s;
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(e) => panic!("synthetic listener: {e}"),
            }
        }
    }
    fn request(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&buffer[..count]);
            assert!(bytes.len() < 16384);
            if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                let h = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let len = h
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length:")
                            .map(|v| v.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if bytes.len() >= end + 4 + len {
                    break;
                }
            }
        }
        String::from_utf8(bytes).unwrap()
    }
    fn reply(stream: &mut TcpStream, status: u16, value: &serde_json::Value, headers: &str) {
        let body = if status == 204 {
            String::new()
        } else {
            value.to_string()
        };
        write!(stream,"HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",body.len()).unwrap();
        stream.flush().unwrap();
    }
    fn preview() -> serde_json::Value {
        json!({"marker":marker(),"target":{"id":"target","version":1,"name":"Test inventato","type":"test","isDefault":false,"parentId":null,"createdAt":1},"fallback":null,"counts":{"tombstonedPatients":0,"unlinkedPatients":0,"preservedLivePatients":0,"removedMembershipRows":0},"challengeExpiresAt":1900000000000u64})
    }
    fn terminal(outcome: &str) -> serde_json::Value {
        let mut receipt = serde_json::to_value(marker()).unwrap();
        receipt.as_object_mut().unwrap().extend(json!({"outcome":outcome,"reason":null,"committedAt":100,"result":if outcome=="applied"{json!({"targetVersion":2,"affectedAmbulatories":[{"id":"target","version":2}],"clear":preview()["counts"]})}else{serde_json::Value::Null}}).as_object().unwrap().clone());
        json!({"outcome":"terminal","historical":false,"receipt":receipt})
    }
    fn client(url: &str) -> RuntimeClient {
        RuntimeClient::new(RuntimeConfig {
            base_url: url.into(),
            tls_pin_sha256: None,
        })
        .unwrap()
    }
    // Transport fault fixture only: authentication is covered separately below.
    fn ready(url: &str, recovery: bool) -> HostAmbulatoryCommand {
        HostAmbulatoryCommand {
            client: client(url),
            binding: CommandRecoveryBinding {
                host_origin: url.into(),
                actor_id: user().id.clone(),
                device_id: "synthetic-device".into(),
            },
            retired: AtomicBool::new(false),
            outcome: Mutex::new(AmbulatoryCommandDispatch::NotSent),
            user: user(),
            generation: user().archive_generation,
            identity: marker(),
            recovery,
            reference: Zeroizing::new("f".repeat(64)),
            control: Zeroizing::new("b".repeat(64)),
            cookie: Mutex::new(Zeroizing::new("d".repeat(64))),
            marker: Mutex::new(Some(marker())),
            auth_attempted: AtomicBool::new(true),
            authenticated: AtomicBool::new(true),
            preview_attempted: AtomicBool::new(true),
            sent: AtomicBool::new(false),
        }
    }
    fn store(flow: &HostAmbulatoryCommand) -> AmbulatoryCommandRecoveryStore {
        store_path(flow).0
    }
    fn store_path(
        flow: &HostAmbulatoryCommand,
    ) -> (AmbulatoryCommandRecoveryStore, std::path::PathBuf) {
        let directory = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "mediflow-command-transport-{}",
            crate::http::operation_uuid().unwrap()
        ));
        (
            AmbulatoryCommandRecoveryStore::new(&directory, flow.binding.clone()).unwrap(),
            directory,
        )
    }
    fn auth_reply(step: usize, stream: &mut TcpStream, body: &str) {
        let lower = body.to_lowercase();
        assert!(!lower.contains("x-mediflow-paired-client-token:"));
        assert!(!lower.contains(&format!("mediflow_session={}", "a".repeat(64))));
        assert!(lower.contains(&format!("mediflow_auth_control={}", "b".repeat(64))));
        if step == 1 {
            assert!(body.starts_with("GET /api/auth/check "));
            assert!(!lower.contains("mediflow_session="));
            reply(
                stream,
                200,
                &json!({"status":"ok","isSetup":true,"archiveGeneration":user().archive_generation,"unlock":{"credential":"passphrase","kdfVersion":3,"salt":"AwMDAwMDAwMDAwMDAwMDAw=="}}),
                &format!("ETag: \"{}\"\r\n", "c".repeat(64)),
            );
        } else {
            assert!(body.starts_with("POST /api/auth/login "));
            assert!(!body.contains("Synthetic scales fixture passphrase"));
            let value: serde_json::Value =
                serde_json::from_str(body.split("\r\n\r\n").nth(1).unwrap()).unwrap();
            assert_eq!(value.as_object().unwrap().len(), 2);
            assert!(value["verifier"].as_str().is_some_and(|v| !v.is_empty()));
            assert!(lower.contains("if-match:"));
            assert!(lower.contains("idempotency-key:"));
            reply(
                stream,
                200,
                &json!({"success":true,"id":user().id,"username":user().username,"role":"admin","archiveGeneration":user().archive_generation}),
                &format!(
                    "Set-Cookie: mediflow_session={}; Path=/; HttpOnly\r\n",
                    "d".repeat(64)
                ),
            );
        }
    }
    #[test]
    fn ambulatory_command_real_auth_transport_uses_new_control_separate_cookies_and_marker_before_execute()
     {
        let (listener, url) = listener();
        let expected = url.clone();
        let worker = thread::spawn(move || {
            for step in 0..6 {
                let mut stream = accept(&listener);
                let body = request(&mut stream);
                let lower = body.to_lowercase();
                assert!(lower.contains(&format!("origin: {expected}\r\n")));
                assert!(lower.contains("sec-fetch-site: same-origin"));
                match step {
                    0 => {
                        assert!(body.starts_with("POST /api/auth/ambulatory-commands/begin "));
                        assert!(lower.contains("x-mediflow-paired-client-token:"));
                        assert!(lower.contains(&format!("mediflow_session={}", "a".repeat(64))));
                        assert!(lower.contains("ambulatory_id=scope"));
                        assert!(lower.contains("expected-ambulatory-id: scope"));
                        let v: serde_json::Value =
                            serde_json::from_str(body.split("\r\n\r\n").nth(1).unwrap()).unwrap();
                        assert_eq!(
                            v["command"],
                            serde_json::to_value(marker().intent()).unwrap()
                        );
                        let mut identity = serde_json::to_value(marker()).unwrap();
                        identity.as_object_mut().unwrap().remove("planDigest");
                        reply(
                            &mut stream,
                            200,
                            &json!({"protocol":AMBULATORY_COMMAND_PROTOCOL,"contractVersion":1,"purpose":"execute","command":identity,"reference":"f".repeat(64),"currentArchiveGeneration":user().archive_generation,"expiresAt":1900000000000u64}),
                            &format!(
                                "Set-Cookie: mediflow_auth_control={}; Path=/; HttpOnly\r\n",
                                "b".repeat(64)
                            ),
                        );
                    }
                    1 | 2 => auth_reply(step, &mut stream, &body),
                    3 => {
                        assert!(body.starts_with("POST /api/auth/ambulatory-commands/preview "));
                        assert!(!lower.contains("x-mediflow-paired-client-token:"));
                        assert!(lower.contains(&format!("mediflow_session={}", "d".repeat(64))));
                        reply(&mut stream, 200, &preview(), "");
                    }
                    4 => {
                        assert!(body.starts_with("POST /api/auth/ambulatory-commands/execute "));
                        let v: serde_json::Value =
                            serde_json::from_str(body.split("\r\n\r\n").nth(1).unwrap()).unwrap();
                        assert_eq!(
                            v,
                            json!({"operation":"ambulatory.clear-test.v1","planDigest":"a".repeat(64),"confirmation":"SVUOTA"})
                        );
                        reply(&mut stream, 200, &terminal("applied"), "");
                    }
                    _ => {
                        assert!(body.starts_with("POST /api/auth/ambulatory-commands/retire "));
                        assert!(!lower.contains("x-mediflow-paired-client-token:"));
                        reply(&mut stream, 204, &serde_json::Value::Null, "");
                    }
                }
            }
        });
        let flow = HostAmbulatoryCommand::prepare(
            client(&url),
            &user(),
            &PairingCredentials::new("synthetic-device", "x".repeat(64)).unwrap(),
            &"a".repeat(64),
            AmbulatoryCommandPurpose::Execute(marker().intent()),
        )
        .unwrap();
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::Prepared);
        flow.authenticate("Synthetic scales fixture passphrase")
            .unwrap();
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::Authorized);
        let preview = flow.preview().unwrap();
        assert_eq!(preview.marker, marker());
        let store = store(&flow);
        let proof = flow.persist_preview(&store).unwrap();
        assert_eq!(store.load(), Ok(Some(marker())));
        let result = flow.execute(&proof, "SVUOTA").unwrap();
        assert!(matches!(result, AmbulatoryCommandRead::Terminal(_)));
        assert!(matches!(
            flow.dispatch(),
            Ok(AmbulatoryCommandDispatch::Terminal(_))
        ));
        assert_eq!(
            flow.execute(&proof, "SVUOTA"),
            Err(RuntimeError::ReadRequired)
        );
        let retirement = flow.retire().unwrap();
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::Retired);
        let AmbulatoryCommandRead::Terminal(terminal) = result else {
            panic!()
        };
        store
            .acknowledge_terminal(&marker(), &terminal, &retirement)
            .unwrap();
        assert_eq!(store.load(), Ok(None));
        worker.join().unwrap();
    }
    #[test]
    fn ambulatory_command_lost_execute_response_burns_dispatch_without_retry_or_forged_cleanup() {
        let (listener, url) = listener();
        let worker = thread::spawn(move || {
            let mut stream = accept(&listener);
            assert!(
                request(&mut stream).starts_with("POST /api/auth/ambulatory-commands/execute ")
            );
            drop(stream);
            let mut stream = accept(&listener);
            assert!(request(&mut stream).starts_with("POST /api/auth/ambulatory-commands/retire "));
            reply(
                &mut stream,
                401,
                &json!({"code":"AMBULATORY_COMMAND_DENIED"}),
                "",
            );
        });
        let flow = ready(&url, false);
        let store = store(&flow);
        let proof = flow.persist_preview(&store).unwrap();
        assert_eq!(
            flow.execute(&proof, "SVUOTA"),
            Err(RuntimeError::Indeterminate)
        );
        assert_eq!(flow.dispatch(), Ok(AmbulatoryCommandDispatch::Unknown));
        assert_eq!(
            flow.execute(&proof, "SVUOTA"),
            Err(RuntimeError::ReadRequired)
        );
        assert!(flow.retire().is_err());
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::LocallyRetired);
        assert_eq!(store.load(), Ok(Some(marker())));
        worker.join().unwrap();
    }
    #[test]
    fn ambulatory_command_recovery_read_close_and_retire_are_distinct_and_never_execute() {
        let (listener, url) = listener();
        let worker = thread::spawn(move || {
            for action in ["receipt", "close", "retire"] {
                let mut stream = accept(&listener);
                let body = request(&mut stream);
                assert!(body.starts_with(&format!("POST /api/auth/ambulatory-commands/{action} ")));
                assert!(!body.to_lowercase().contains("expected-ambulatory-id:"));
                if action == "receipt" {
                    reply(&mut stream, 200, &json!({"outcome":"unknown"}), "");
                } else if action == "close" {
                    reply(&mut stream, 200, &terminal("closed"), "");
                } else {
                    reply(&mut stream, 204, &serde_json::Value::Null, "");
                }
            }
        });
        let flow = ready(&url, true);
        let store = store(&flow);
        let proof = flow.persist_preview(&store).unwrap();
        assert_eq!(
            flow.execute(&proof, "SVUOTA"),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(flow.read_receipt(), Ok(AmbulatoryCommandRead::Unknown));
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::Authorized);
        let closed = flow.close().unwrap();
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::Authorized);
        assert_eq!(flow.close(), Err(RuntimeError::ReadRequired));
        let retirement = flow.retire().unwrap();
        let AmbulatoryCommandRead::Terminal(terminal) = closed else {
            panic!()
        };
        assert_eq!(
            terminal.receipt().outcome,
            crate::AmbulatoryCommandOutcome::Closed
        );
        store
            .acknowledge_terminal(&marker(), &terminal, &retirement)
            .unwrap();
        worker.join().unwrap();
    }
    #[test]
    fn ambulatory_command_cancel_drops_late_success_and_retire_uses_its_fresh_cleanup_context() {
        let (listener, url) = listener();
        let (started, waiting) = std::sync::mpsc::channel();
        let (release, go) = std::sync::mpsc::channel();
        let worker = thread::spawn(move || {
            let mut stream = accept(&listener);
            assert!(
                request(&mut stream).starts_with("POST /api/auth/ambulatory-commands/execute ")
            );
            started.send(()).unwrap();
            go.recv_timeout(Duration::from_secs(3)).unwrap();
            let _ = write!(
                stream,
                "HTTP/1.1 200 Synthetic\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                terminal("applied").to_string().len(),
                terminal("applied")
            );
            drop(stream);
            let mut stream = accept(&listener);
            assert!(request(&mut stream).starts_with("POST /api/auth/ambulatory-commands/retire "));
            reply(&mut stream, 204, &serde_json::Value::Null, "");
        });
        let flow = std::sync::Arc::new(ready(&url, false));
        let store = store(&flow);
        let proof = flow.persist_preview(&store).unwrap();
        let sent = flow.clone();
        let task = thread::spawn(move || sent.execute(&proof, "SVUOTA"));
        waiting.recv_timeout(Duration::from_secs(3)).unwrap();
        flow.cancel_local();
        release.send(()).unwrap();
        assert_eq!(task.join().unwrap(), Err(RuntimeError::Indeterminate));
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::LocallyRetired);
        assert_eq!(flow.dispatch(), Ok(AmbulatoryCommandDispatch::Unknown));
        flow.retire().unwrap();
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::Retired);
        assert_eq!(store.load(), Ok(Some(marker())));
        worker.join().unwrap();
    }
    #[test]
    fn ambulatory_command_pre_dispatch_cancel_damage_or_foreign_marker_never_sends() {
        let flow = ready("http://127.0.0.1:1", false);
        let (store, directory) = store_path(&flow);
        let proof = flow.persist_preview(&store).unwrap();
        assert_eq!(
            flow.execute(&proof, "ELIMINA"),
            Err(RuntimeError::InvalidInput)
        );
        assert_eq!(flow.dispatch(), Ok(AmbulatoryCommandDispatch::NotSent));
        let record = std::fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.extension().is_some_and(|value| value == "json"))
            .unwrap();
        let original = std::fs::read(&record).unwrap();
        std::fs::write(&record, b"{").unwrap();
        assert_eq!(
            flow.execute(&proof, "SVUOTA"),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(flow.dispatch(), Ok(AmbulatoryCommandDispatch::NotSent));
        std::fs::write(&record, original).unwrap();
        flow.cancel_local();
        assert_eq!(
            flow.execute(&proof, "SVUOTA"),
            Err(RuntimeError::ReadRequired)
        );
        assert_eq!(flow.dispatch(), Ok(AmbulatoryCommandDispatch::NotSent));
        assert_eq!(store.load(), Ok(Some(marker())));
    }
    #[test]
    fn ambulatory_command_backend_auth_denial_withdraws_local_authority_but_not_the_unknown_command()
     {
        let (listener, url) = listener();
        let worker = thread::spawn(move || {
            let mut stream = accept(&listener);
            assert!(
                request(&mut stream).starts_with("POST /api/auth/ambulatory-commands/execute ")
            );
            reply(
                &mut stream,
                403,
                &json!({"code":"AMBULATORY_COMMAND_DENIED"}),
                "",
            );
            let mut stream = accept(&listener);
            assert!(request(&mut stream).starts_with("POST /api/auth/ambulatory-commands/retire "));
            reply(
                &mut stream,
                401,
                &json!({"code":"AMBULATORY_COMMAND_DENIED"}),
                "",
            );
        });
        let flow = ready(&url, false);
        let store = store(&flow);
        let proof = flow.persist_preview(&store).unwrap();
        assert_eq!(flow.execute(&proof, "SVUOTA"), Err(RuntimeError::Forbidden));
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::LocallyRetired);
        assert_eq!(flow.dispatch(), Ok(AmbulatoryCommandDispatch::Unknown));
        assert_eq!(
            flow.execute(&proof, "SVUOTA"),
            Err(RuntimeError::ReadRequired)
        );
        assert!(flow.retire().is_err());
        assert_eq!(store.load(), Ok(Some(marker())));
        worker.join().unwrap();
    }
    #[test]
    fn ambulatory_command_cancelled_auth_check_cannot_become_authorized_from_a_late_reply() {
        let (listener, url) = listener();
        let (started, waiting) = std::sync::mpsc::channel();
        let (release, go) = std::sync::mpsc::channel();
        let worker = thread::spawn(move || {
            let mut stream = accept(&listener);
            assert!(request(&mut stream).starts_with("GET /api/auth/check "));
            started.send(()).unwrap();
            go.recv_timeout(Duration::from_secs(3)).unwrap();
            let body=json!({"status":"ok","isSetup":true,"archiveGeneration":user().archive_generation,"unlock":{"credential":"passphrase","kdfVersion":3,"salt":"AwMDAwMDAwMDAwMDAwMDAw=="}}).to_string();
            let _ = write!(
                stream,
                "HTTP/1.1 200 Synthetic\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            drop(stream);
            let mut stream = accept(&listener);
            let request = request(&mut stream);
            assert!(request.starts_with("POST /api/auth/ambulatory-commands/retire "));
            assert!(!request.contains("mediflow_session="));
            reply(
                &mut stream,
                401,
                &json!({"code":"AMBULATORY_COMMAND_DENIED"}),
                "",
            );
        });
        let mut prepared = ready(&url, false);
        prepared.auth_attempted = AtomicBool::new(false);
        prepared.authenticated = AtomicBool::new(false);
        prepared.cookie = Mutex::new(Zeroizing::new(String::new()));
        let flow = std::sync::Arc::new(prepared);
        let sent = flow.clone();
        let task = thread::spawn(move || sent.authenticate("Synthetic scales fixture passphrase"));
        waiting.recv_timeout(Duration::from_secs(3)).unwrap();
        flow.cancel_local();
        release.send(()).unwrap();
        assert!(task.join().unwrap().is_err());
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::LocallyRetired);
        assert_eq!(flow.dispatch(), Ok(AmbulatoryCommandDispatch::NotSent));
        assert!(flow.retire().is_err());
        assert_eq!(flow.authority(), AmbulatoryCommandAuthority::LocallyRetired);
        worker.join().unwrap();
    }
}
