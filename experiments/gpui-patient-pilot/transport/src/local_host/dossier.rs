use super::*;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

const MAX_CHANNEL_BYTES: u64 = 64 * 1024 * 1024;
const WORKER: &str = include_str!("../../../worker/dossier.bundle.mjs");
struct Channel {
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
/// Processo deterministico locale: stessa sessione del Web, chiavi e HTTP restano in Rust.
pub struct DossierImport {
    host: Arc<LocalHostAccess>,
    scope: String,
    epoch: u64,
    active: AtomicBool,
    child: Mutex<Child>,
    channel: Mutex<Channel>,
    files: Mutex<Vec<PathBuf>>,
    script: PathBuf,
}
impl Drop for DossierImport {
    fn drop(&mut self) {
        self.retire();
    }
}
impl DossierImport {
    pub fn open(host: Arc<LocalHostAccess>, scope: &str) -> Result<Self> {
        validate_id(scope)?;
        host.headers()?;
        let epoch = host.native.document_archive_epoch();
        host.native.dossier_check(epoch)?;
        let node = std::env::var_os("MEDIFLOW_NODE_BINARY")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("PATH").and_then(|paths| {
                    std::env::split_paths(&paths)
                        .map(|p| p.join(if cfg!(windows) { "node.exe" } else { "node" }))
                        .find(|p| p.is_absolute() && p.is_file())
                })
            })
            .or_else(|| {
                ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
                    .into_iter()
                    .map(PathBuf::from)
                    .find(|p| p.is_file())
            })
            .ok_or(RuntimeError::Missing)?;
        if !node.is_absolute() {
            return Err(RuntimeError::InvalidInput);
        }
        let version = Command::new(&node)
            .arg("--version")
            .env_clear()
            .output()
            .map_err(|_| RuntimeError::Transport)?;
        if !version.status.success() || !version.stdout.starts_with(b"v24.") {
            return Err(RuntimeError::UnsupportedProtocol);
        }
        let script =
            std::env::temp_dir().join(format!("mediflow-dossier-worker-{}.mjs", operation_uuid()?));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(&script)
            .and_then(|mut file| file.write_all(WORKER.as_bytes()))
            .map_err(|_| RuntimeError::Transport)?;
        let script = std::fs::canonicalize(script).map_err(|_| RuntimeError::Transport)?;
        let launched = Command::new(node)
            .arg("--permission")
            .arg(format!("--allow-fs-read={}", script.display()))
            .arg(&script)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let mut child = match launched {
            Ok(child) => child,
            Err(_) => {
                let _ = std::fs::remove_file(&script);
                return Err(RuntimeError::Transport);
            }
        };
        let input = child.stdin.take().ok_or(RuntimeError::Transport)?;
        let output = BufReader::new(child.stdout.take().ok_or(RuntimeError::Transport)?);
        Ok(Self {
            host,
            scope: scope.into(),
            epoch,
            active: AtomicBool::new(true),
            child: Mutex::new(child),
            channel: Mutex::new(Channel { input, output }),
            files: Mutex::new(vec![]),
            script,
        })
    }
    pub fn retire(&self) {
        self.active.store(false, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::fs::remove_file(&self.script);
    }
    fn live(&self) -> Result<()> {
        if !self.active.load(Ordering::Acquire) {
            return Err(RuntimeError::ReadRequired);
        }
        self.host.headers()?;
        self.host.native.dossier_check(self.epoch)
    }
    pub fn review(
        &self,
        prepared: String,
        paths: Vec<PathBuf>,
        patient: Option<&str>,
    ) -> Result<Value> {
        self.live()?;
        if paths.is_empty() || paths.len() > 100 || prepared.len() > 20 * 1024 * 1024 {
            return Err(RuntimeError::TooLarge);
        }
        let mut files = vec![];
        for (key, path) in paths.iter().enumerate() {
            let metadata = std::fs::metadata(path).map_err(|_| RuntimeError::InvalidInput)?;
            if !metadata.is_file() || metadata.len() > 25 * 1024 * 1024 {
                return Err(RuntimeError::TooLarge);
            }
            let name = path
                .file_name()
                .and_then(|v| v.to_str())
                .ok_or(RuntimeError::InvalidInput)?;
            files.push(json!({"key":key,"name":name,"relativePath":name,"size":metadata.len(),"type":"application/octet-stream"}));
        }
        *self.files.lock().map_err(|_| RuntimeError::Locked)? = paths;
        self.command(
            json!({"op":"review","prepared":prepared,"files":files,"patientId":patient}),
            None,
        )
    }
    pub fn apply(&self, group: &str, patient: &str, include_summaries: bool) -> Result<Value> {
        self.live()?;
        validate_id(patient)?;
        self.host
            .native
            .check_document_membership(&self.scope, patient)?;
        self.command(json!({"op":"apply","group":group,"patientId":patient,"includeSummaries":include_summaries}),Some(patient))
    }
    fn command(&self, command: Value, write_patient: Option<&str>) -> Result<Value> {
        self.live()?;
        let mut channel = self.channel.lock().map_err(|_| RuntimeError::Locked)?;
        send(&mut channel.input, &command)?;
        loop {
            self.live()?;
            let mut line = Zeroizing::new(String::new());
            let read = channel
                .output
                .by_ref()
                .take(MAX_CHANNEL_BYTES + 1)
                .read_line(&mut line)
                .map_err(|_| RuntimeError::Transport)?;
            if read == 0 || read as u64 > MAX_CHANNEL_BYTES {
                return Err(RuntimeError::TooLarge);
            }
            let value = InsightsValue(
                serde_json::from_str(&line).map_err(|_| RuntimeError::InvalidResponse)?,
            );
            if let Some(result) = value.get("result") {
                self.live()?;
                return Ok(result.clone());
            }
            if value.get("failure").is_some() {
                #[cfg(test)]
                eprintln!("synthetic worker failure: {}", value["failure"]);
                return Err(if value["retired"] == true {
                    RuntimeError::ReadRequired
                } else {
                    RuntimeError::Indeterminate
                });
            }
            let port = value["port"]
                .as_str()
                .ok_or(RuntimeError::InvalidResponse)?;
            let args = value["args"]
                .as_array()
                .ok_or(RuntimeError::InvalidResponse)?;
            let response = match self.port(port, args, write_patient) {
                Ok(value) => json!({"value":value}),
                Err(error) => {
                    #[cfg(test)]
                    eprintln!("synthetic dossier port {port}: {error:?}");
                    if error.retires_session()
                        || matches!(
                            error,
                            RuntimeError::Rejected(401 | 403)
                                | RuntimeError::ReadRequired
                                | RuntimeError::Forbidden
                        )
                    {
                        self.active.store(false, Ordering::Release);
                        json!({"error":"retired"})
                    } else if error == RuntimeError::Conflict
                        && ["createAttachment", "updateArtifact", "patientCodes"].contains(&port)
                    {
                        json!({"error":if port=="createAttachment"{"collection"}else{"version"}})
                    } else {
                        json!({"error":"rejected","status":error.status_code()})
                    }
                }
            };
            send(&mut channel.input, &response)?;
        }
    }
    fn patient(&self, id: &str) -> Result<Value> {
        validate_id(id)?;
        self.host
            .native
            .check_document_membership(&self.scope, id)?;
        let mut value =
            InsightsValue(self.request(Method::GET, &["api", "patients", id], None, &[])?);
        if value["id"] != id || !value["deletedAt"].is_null() {
            return Err(RuntimeError::Missing);
        }
        self.host.native.dossier_open("patients", &mut value)?;
        if value["diagnoses"].is_null() {
            value["diagnoses"] = json!([]);
        }
        if value["exemptions"].is_null() {
            value["exemptions"] = json!([]);
        }
        let mut projected = json!({});
        for key in [
            "id",
            "firstName",
            "lastName",
            "taxCode",
            "birthDate",
            "version",
            "diagnoses",
            "exemptions",
            "isArchived",
        ] {
            if let Some(field) = value.get(key) {
                projected[key] = field.clone();
            }
        }
        Ok(projected)
    }
    fn request(
        &self,
        method: Method,
        path: &[&str],
        body: Option<&Value>,
        query: &[(&str, &str)],
    ) -> Result<Value> {
        self.live()?;
        let mutation = method != Method::GET;
        let response = self.host.client.dossier_web_json(
            method,
            path,
            self.host.headers()?,
            body,
            mutation,
            query,
        )?;
        self.live()?;
        serde_json::from_slice(&response.body).map_err(|_| {
            if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::InvalidResponse
            }
        })
    }
    fn check_write(&self, patient: &str, allowed: Option<&str>) -> Result<()> {
        self.live()?;
        if allowed != Some(patient) {
            return Err(RuntimeError::Forbidden);
        }
        self.host
            .native
            .check_document_membership(&self.scope, patient)
    }
    fn attachment_payload(&self, input: &Value) -> Result<Value> {
        let bytes = BASE64
            .decode(string(&input["bytes"]))
            .map_err(|_| RuntimeError::InvalidInput)?;
        let mime = string(&input["type"]);
        let mut body = json!({"name":input["name"],"path":format!("uploads/{}",string(&input["name"])),"type":mime,"size":bytes.len(),"data":format!("data:{};base64,{}",if mime.is_empty(){"application/octet-stream"}else{mime},BASE64.encode(&bytes)),"parseEvidenceArtifactSnapshot":input["parseEvidenceArtifactSnapshot"]});
        body = self.host.native.dossier_seal("attachments", body)?;
        Ok(body)
    }
    fn port(&self, port: &str, args: &[Value], allowed: Option<&str>) -> Result<Value> {
        self.live()?;
        let arg = |i: usize| args.get(i).ok_or(RuntimeError::InvalidResponse);
        let s = |i| arg(i).map(string);
        match port {
            "verify" => {
                let actual = InsightsValue(crate::dossier::verify_call(arg(0)?));
                if actual.0 != *arg(1)? {
                    return Err(RuntimeError::ReadRequired);
                }
                Ok(Value::Null)
            }
            "file" => {
                let key = arg(0)?.as_u64().ok_or(RuntimeError::InvalidInput)? as usize;
                let files = self.files.lock().map_err(|_| RuntimeError::Locked)?;
                let path = files.get(key).ok_or(RuntimeError::InvalidInput)?;
                let mut bytes = Zeroizing::new(vec![]);
                std::fs::File::open(path)
                    .map_err(|_| RuntimeError::InvalidInput)?
                    .take(25 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| RuntimeError::InvalidInput)?;
                if bytes.len() > 25 * 1024 * 1024 {
                    return Err(RuntimeError::TooLarge);
                }
                Ok(json!(BASE64.encode(&*bytes)))
            }
            "extract" => {
                let bytes = BASE64
                    .decode(s(0)?)
                    .map_err(|_| RuntimeError::InvalidInput)?;
                let response = self
                    .host
                    .client
                    .dossier_extract(self.host.headers()?, bytes)?;
                self.live()?;
                if response.status == 503 {
                    Ok(json!({"status":"busy"}))
                } else {
                    serde_json::from_slice(&response.body)
                        .map_err(|_| RuntimeError::InvalidResponse)
                }
            }
            "patients" => {
                let mut patients = vec![];
                for row in self.host.native.list_patients(&self.scope, false)? {
                    let patient = self.patient(&row.id)?;
                    if patient["isArchived"] != true {
                        patients.push(patient);
                    }
                }
                Ok(json!(patients))
            }
            "patient" => self.patient(s(0)?),
            "patientCodes" => {
                self.check_write(s(0)?, allowed)?;
                let mut body = arg(1)?.clone();
                if !body.is_object()
                    || body
                        .as_object()
                        .unwrap()
                        .keys()
                        .any(|k| !["version", "diagnoses", "exemptions"].contains(&k.as_str()))
                {
                    return Err(RuntimeError::InvalidInput);
                }
                body = self.host.native.dossier_seal("patients", body)?;
                self.request(Method::PUT, &["api", "patients", s(0)?], Some(&body), &[])?;
                Ok(Value::Null)
            }
            "attachments" => {
                let patient = s(0)?;
                self.host
                    .native
                    .check_document_membership(&self.scope, patient)?;
                let mut value = InsightsValue(self.request(
                    Method::GET,
                    &["api", "attachments"],
                    None,
                    &[("patientId", patient), ("metadata", "true")],
                )?);
                for row in value.as_array_mut().ok_or(RuntimeError::InvalidResponse)? {
                    if row["patientId"] != patient {
                        return Err(RuntimeError::InvalidResponse);
                    }
                    self.host.native.dossier_open("attachments", row)?;
                }
                Ok(value.0.clone())
            }
            "attachmentBytes" => {
                let patient = s(1)?;
                self.host
                    .native
                    .check_document_membership(&self.scope, patient)?;
                validate_id(s(0)?)?;
                let mut value = InsightsValue(self.request(
                    Method::GET,
                    &["api", "attachments", s(0)?],
                    None,
                    &[],
                )?);
                if value["patientId"] != patient {
                    return Err(RuntimeError::Forbidden);
                }
                self.host.native.dossier_open("attachments", &mut value)?;
                let data = string(&value["data"]);
                let (_, bytes) = data
                    .split_once(";base64,")
                    .filter(|_| data.starts_with("data:"))
                    .ok_or(RuntimeError::InvalidResponse)?;
                Ok(json!(bytes))
            }
            "createAttachment" => {
                let input = arg(0)?;
                self.check_write(string(&input["patientId"]), allowed)?;
                let mut body = self.attachment_payload(input)?;
                body["id"] = input["id"].clone();
                body["patientId"] = input["patientId"].clone();
                body["expectedCollection"] = json!(
                    arg(1)?
                        .as_array()
                        .ok_or(RuntimeError::InvalidInput)?
                        .iter()
                        .map(|a| json!({"id":a["id"],"currentness":a["currentness"]}))
                        .collect::<Vec<_>>()
                );
                self.request(Method::POST, &["api", "attachments"], Some(&body), &[])?;
                Ok(Value::Null)
            }
            "updateArtifact" => {
                let attachment = arg(0)?;
                self.check_write(string(&attachment["patientId"]), allowed)?;
                let id = string(&attachment["id"]);
                validate_id(id)?;
                let mut body = self.host.native.dossier_seal(
                    "attachments",
                    json!({"parseEvidenceArtifactSnapshot":arg(1)?}),
                )?;
                body["patientId"] = attachment["patientId"].clone();
                body["expected"] = attachment["currentness"].clone();
                self.request(Method::PUT, &["api", "attachments", id], Some(&body), &[])?;
                Ok(Value::Null)
            }
            "measureCreate" => {
                let body = self.attachment_payload(arg(0)?)?;
                let original = string(&body["data"]).len();
                let artifact = string(&body["parseEvidenceArtifactSnapshot"]).len();
                Ok(
                    json!({"original":original,"artifact":artifact,"request":original+artifact+string(&body["name"]).len()+string(&body["path"]).len()+4096}),
                )
            }
            "measureArtifact" => {
                let body = self.host.native.dossier_seal(
                    "attachments",
                    json!({"parseEvidenceArtifactSnapshot":arg(0)?}),
                )?;
                Ok(json!(
                    string(&body["parseEvidenceArtifactSnapshot"]).len() + 1024
                ))
            }
            "records" => {
                let table = s(0)?;
                let path = table_path(table)?;
                let patient = s(1)?;
                self.host
                    .native
                    .check_document_membership(&self.scope, patient)?;
                let mut value = InsightsValue(self.request(
                    Method::GET,
                    &["api", path],
                    None,
                    &[("patientId", patient)],
                )?);
                for row in value.as_array_mut().ok_or(RuntimeError::InvalidResponse)? {
                    if row["patientId"] != patient {
                        return Err(RuntimeError::InvalidResponse);
                    }
                    self.host.native.dossier_open(table, row)?;
                }
                Ok(value.0.clone())
            }
            "createRecord" => {
                let table = s(0)?;
                let path = table_path(table)?;
                let record = arg(1)?;
                self.check_write(string(&record["patientId"]), allowed)?;
                let body = self.host.native.dossier_seal(table, record.clone())?;
                self.request(Method::POST, &["api", path], Some(&body), &[])?;
                Ok(Value::Null)
            }
            "exemptions" => {
                let value = self.request(Method::GET, &["api", "exemptions"], None, &[])?;
                Ok(json!(
                    value
                        .as_array()
                        .ok_or(RuntimeError::InvalidResponse)?
                        .iter()
                        .filter_map(|r| r["code"].as_str())
                        .map(str::to_uppercase)
                        .collect::<Vec<_>>()
                ))
            }
            _ => Err(RuntimeError::Forbidden),
        }
    }
}
fn string(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}
fn table_path(table: &str) -> Result<&'static str> {
    match table {
        "entries" => Ok("entries"),
        "therapies" => Ok("therapies"),
        "observations" => Ok("observations"),
        "service_prescriptions" => Ok("service-prescriptions"),
        "service_prescription_items" => Ok("service-prescription-items"),
        "prosthetic_prescriptions" => Ok("prosthetic-prescriptions"),
        _ => Err(RuntimeError::InvalidInput),
    }
}
fn send(input: &mut ChildStdin, value: &Value) -> Result<()> {
    let mut line =
        Zeroizing::new(serde_json::to_vec(value).map_err(|_| RuntimeError::InvalidInput)?);
    line.push(b'\n');
    input
        .write_all(&line)
        .map_err(|_| RuntimeError::Transport)?;
    input.flush().map_err(|_| RuntimeError::Transport)
}
