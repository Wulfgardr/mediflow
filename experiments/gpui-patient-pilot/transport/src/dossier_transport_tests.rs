use super::tests::{local_host_login, session_at, try_local_host_reply};
use super::*;
use crate::DossierImport;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread;
use std::time::Duration;

#[derive(Default)]
struct Store {
    attachments: Vec<Value>,
    therapies: Vec<Value>,
    records: std::collections::BTreeMap<String, Vec<Value>>,
    updated_patient: Option<Value>,
    lock_after_first: bool,
    writes: usize,
    clinical: usize,
    fail_second: bool,
    deny_after_first: Option<u16>,
}
struct Fixture {
    session: RuntimeSession,
    host: Arc<crate::LocalHostAccess>,
    store: Arc<Mutex<Store>>,
    stop: Arc<AtomicBool>,
    server: Option<thread::JoinHandle<()>>,
    file: std::path::PathBuf,
}
fn request(stream: &mut TcpStream) -> (String, Value) {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut head = vec![];
    let mut b = [0];
    while !head.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut b).unwrap();
        head.push(b[0]);
    }
    let head = String::from_utf8(head).unwrap();
    let n = head
        .lines()
        .find_map(|l| {
            l.to_lowercase()
                .strip_prefix("content-length:")
                .map(|n| n.trim().parse::<usize>().unwrap())
        })
        .unwrap_or(0);
    assert!(n < 25 * 1024 * 1024);
    let mut body = vec![0; n];
    stream.read_exact(&mut body).unwrap();
    let value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    (head, value)
}
fn patient() -> Value {
    json!({"id":"p-a","firstName":"Ada","lastName":"Sintetica","taxCode":"","birthDate":null,"version":1,"diagnoses":[],"exemptions":[],"deletedAt":null,"isArchived":false})
}
impl Fixture {
    fn new(text: &str) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let session = session_at(&format!("http://{}", listener.local_addr().unwrap()));
        session
            .inner
            .scopes
            .lock()
            .unwrap()
            .insert("scope-a".into());
        let server_session = session.clone();
        let store = Arc::new(Mutex::new(Store::default()));
        let server_store = store.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let server_stop = stop.clone();
        let text = text.to_owned();
        let server = thread::spawn(move || {
            local_host_login(&listener);
            listener.set_nonblocking(true).unwrap();
            while !server_stop.load(Ordering::Acquire) {
                let (mut stream, _) = match crate::test_loopback::accept(&listener) {
                    Ok(s) => s,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                let (head, body) = request(&mut stream);
                let first = head.lines().next().unwrap();
                let mut store = server_store.lock().unwrap();
                let mut status = 200;
                let response = if first.starts_with("POST /api/auth/local-client/logout ") {
                    status = 204;
                    Value::Null
                } else if first.starts_with("GET /api/auth/check ") {
                    json!({"status":"ok","archiveGeneration":"synthetic-generation"})
                } else if store.clinical > 0
                    && let Some(denial) = store.deny_after_first
                {
                    status = denial;
                    if status == 409 {
                        json!({"code":"ARCHIVE_REPLACED"})
                    } else {
                        json!({"error":"synthetic revoked"})
                    }
                } else if first.starts_with("GET /api/v1/network/identity ") {
                    json!({"scope":{"effectiveAmbulatoryId":"scope-a","requestBinding":"expected-ambulatory-id-v1"},"operator":{"userId":"synthetic-user","authChannel":"native"}})
                } else if first.starts_with("GET /api/v1/network/patients ") {
                    json!([patient()])
                } else if first.starts_with("GET /api/patients/p-a ") {
                    store.updated_patient.clone().unwrap_or_else(patient)
                } else if first.starts_with("PUT /api/patients/p-a ") {
                    let mut current = store.updated_patient.clone().unwrap_or_else(patient);
                    assert_eq!(body["version"], current["version"]);
                    for field in ["diagnoses", "exemptions"] {
                        if let Some(value) = body.get(field) {
                            assert!(string(value).starts_with("ENC:"));
                            current[field] = value.clone();
                        }
                    }
                    current["version"] = json!(current["version"].as_u64().unwrap() + 1);
                    store.updated_patient = Some(current);
                    store.clinical += 1;
                    store.writes += 1;
                    json!({"success":true})
                } else if first.starts_with("GET /api/exemptions") {
                    // Same shape as app/api/exemptions: the plain list stops at
                    // the first 100 codes in order, only `all=1` returns the
                    // whole catalog. "031" sorts after the 100 filler codes.
                    let mut codes: Vec<String> = (1..=100).map(|n| format!("0{n:03}")).collect();
                    codes.push("031".to_owned());
                    let whole = first.starts_with("GET /api/exemptions?all=1 ");
                    json!(
                        codes
                            .iter()
                            .take(if whole { codes.len() } else { 100 })
                            .map(|code| json!({ "code": code }))
                            .collect::<Vec<_>>()
                    )
                } else if first.starts_with("POST /api/documents/dossier-extraction ") {
                    json!({"status":"extracted","markdown":text,"ocr":null})
                } else if first.starts_with("GET /api/attachments?") {
                    json!(store.attachments)
                } else if first.starts_with("GET /api/attachments/") {
                    let id = first.split('/').nth(3).unwrap().split(' ').next().unwrap();
                    store
                        .attachments
                        .iter()
                        .find(|a| a["id"] == id)
                        .cloned()
                        .unwrap()
                } else if first.starts_with("POST /api/attachments ") {
                    assert!(head.contains(&format!("mediflow_session={}", "b".repeat(64))));
                    assert!(!head.to_lowercase().contains("x-mediflow-paired-client"));
                    assert_eq!(
                        body["expectedCollection"],
                        json!(
                            store
                                .attachments
                                .iter()
                                .map(|a| json!({"id":a["id"],"currentness":a["currentness"]}))
                                .collect::<Vec<_>>()
                        )
                    );
                    for field in ["name", "path", "data", "parseEvidenceArtifactSnapshot"] {
                        assert!(string(&body[field]).starts_with("ENC:"));
                    }
                    let mut row = body.clone();
                    row.as_object_mut().unwrap().remove("expectedCollection");
                    row["currentness"] =
                        json!({"sourceRef":"f".repeat(64),"revision":1,"freshnessEpoch":1});
                    store.attachments.push(row.clone());
                    store.writes += 1;
                    row
                } else if first.starts_with("PUT /api/attachments/") {
                    let id = first.split('/').nth(3).unwrap().split(' ').next().unwrap();
                    let row = store
                        .attachments
                        .iter_mut()
                        .find(|a| a["id"] == id)
                        .unwrap();
                    assert_eq!(body["expected"], row["currentness"]);
                    assert_eq!(body["patientId"], "p-a");
                    assert!(string(&body["parseEvidenceArtifactSnapshot"]).starts_with("ENC:"));
                    row["parseEvidenceArtifactSnapshot"] =
                        body["parseEvidenceArtifactSnapshot"].clone();
                    row["currentness"]["revision"] =
                        json!(row["currentness"]["revision"].as_u64().unwrap() + 1);
                    store.writes += 1;
                    json!({"success":true})
                } else if first.starts_with("POST /api/therapies ") {
                    if store.fail_second && store.clinical == 1 {
                        status = 422;
                        json!({"error":"synthetic failure"})
                    } else {
                        let mut row = body.clone();
                        assert!(string(&row["motivation"]).starts_with("ENC:"));
                        server_session.dossier_open("therapies", &mut row).unwrap();
                        assert_eq!(row["patientId"], "p-a");
                        store.therapies.push(body.clone());
                        store.clinical += 1;
                        store.writes += 1;
                        if store.lock_after_first {
                            server_session.lock();
                        }
                        json!({"id":body["id"]})
                    }
                } else if first.starts_with("GET /api/therapies?") {
                    json!(store.therapies)
                } else if let Some(table) = [
                    "entries",
                    "observations",
                    "service-prescriptions",
                    "service-prescription-items",
                    "prosthetic-prescriptions",
                ]
                .into_iter()
                .find(|p| first.starts_with(&format!("POST /api/{p} ")))
                {
                    let registry: Value = serde_json::from_str(include_str!(
                        "../../../../lib/backup-encrypted-fields.json"
                    ))
                    .unwrap();
                    for field in registry[table.replace('-', "_")].as_array().unwrap() {
                        if let Some(value) = body.get(string(field)).filter(|v| !v.is_null()) {
                            assert!(string(value).starts_with("ENC:"), "{table} {field}");
                        }
                    }
                    store
                        .records
                        .entry(table.to_owned())
                        .or_default()
                        .push(body.clone());
                    store.clinical += 1;
                    store.writes += 1;
                    json!({"id":body["id"]})
                } else if let Some(table) = [
                    "entries",
                    "observations",
                    "service-prescriptions",
                    "service-prescription-items",
                    "prosthetic-prescriptions",
                ]
                .into_iter()
                .find(|p| first.starts_with(&format!("GET /api/{p}?")))
                {
                    json!(store.records.get(table).cloned().unwrap_or_default())
                } else {
                    panic!("unexpected request: {first}")
                };
                drop(store);
                dossier_reply(
                    &mut stream,
                    server_session.is_locked(),
                    status,
                    response,
                    if first.starts_with("GET /api/auth/check ") {
                        "ETag: \"synthetic-retirement\"\r\n"
                    } else {
                        ""
                    },
                )
                .unwrap();
            }
        });
        let host = Arc::new(
            session
                .authenticate_local_host(
                    "Local host synthetic passphrase",
                    crate::RetirementNotice::new(None),
                )
                .unwrap(),
        );
        let file = std::env::temp_dir().join(format!(
            "mediflow-dossier-{}.pdf",
            crate::http::operation_uuid().unwrap()
        ));
        std::fs::write(&file, b"%PDF- synthetic dossier fixture").unwrap();
        Self {
            session,
            host,
            store,
            stop,
            server: Some(server),
            file,
        }
    }
    fn worker(&self) -> DossierImport {
        DossierImport::open(self.host.clone(), "scope-a").unwrap()
    }
    fn review(&self, worker: &DossierImport, dose: &str, patient_name: &str) -> Value {
        let bytes = std::fs::read(&self.file).unwrap();
        use sha2::Digest;
        let sha = format!("{:x}", sha2::Sha256::digest(bytes));
        let prepared = json!({"schema":"mediflow.dossier_prepared_extraction.v1","sources":[{"sha256":sha,"patient":{"firstName":patient_name,"lastName":"Sintetica"},"documentDate":"2026-10-20","coverage":{"complete":true},"facts":[{"kind":"therapy","values":{"drugName":"Ramipril","dosage":dose,"status":"completed"},"quote":"Il paziente assume Ramipril 5 mg al mattino"},{"kind":"therapy","values":{"drugName":"Metformina","dosage":"500 mg","status":"completed"},"quote":"Il paziente assume Metformina 500 mg alla sera"}]}]});
        worker
            .review(prepared.to_string(), vec![self.file.clone()], Some("p-a"))
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(server) = self.server.take() {
            let result = server.join();
            if !std::thread::panicking() {
                result.unwrap();
            }
        }
        let _ = std::fs::remove_file(&self.file);
    }
}
fn string(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
const TEXT: &str = "Data referto: 20/10/2026\nPaziente: Ada Sintetica\nIl paziente assume Ramipril 5 mg al mattino.\nIl paziente assume Metformina 500 mg alla sera.";
#[test]
fn dossier_cancel_identity_name_and_forgery_never_write() {
    for (text, dose, proposed, blocked) in [
        (TEXT, "5 mg", "Ada", false),
        (
            "Data referto: 20/10/2026\nPaziente: Altra Persona\nIl paziente assume Ramipril 5 mg al mattino.",
            "5 mg",
            "Altra",
            true,
        ),
        (TEXT, "50 mg", "Ada", false),
        (
            "Data referto: 20/10/2026\nPaziente: Ada Sintetica CF RSSMRA80A01F205X\nIl paziente assume Ramipril 5 mg al mattino.",
            "5 mg",
            "Ada",
            true,
        ),
    ] {
        let fixture = Fixture::new(text);
        let worker = fixture.worker();
        let preview = fixture.review(&worker, dose, proposed);
        assert_eq!(preview["groups"][0]["identity"]["blocking"], blocked);
        assert_eq!(fixture.store.lock().unwrap().writes, 0);
        if blocked {
            let key = string(&preview["groups"][0]["key"]);
            assert!(worker.apply(key, "p-a", false).is_err());
            assert_eq!(fixture.store.lock().unwrap().writes, 0);
        }
        if dose == "50 mg" {
            assert!(
                preview["groups"][0]["sources"][0]["facts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|f| f["values"]["preparedCheck"] == "value_missing")
            );
        }
        worker.retire();
        assert_eq!(fixture.store.lock().unwrap().writes, 0);
    }
}
#[test]
fn dossier_apply_partial_resume_and_duplicate_follow_the_web_session() {
    let fixture = Fixture::new(TEXT);
    fixture.store.lock().unwrap().fail_second = true;
    let worker = fixture.worker();
    let preview = fixture.review(&worker, "5 mg", "Ada");
    let key = string(&preview["groups"][0]["key"]);
    let result = worker.apply(key, "p-a", false).unwrap();
    assert_eq!(fixture.store.lock().unwrap().clinical, 1);
    assert!(
        result["applied"]["applied"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["partial"] == true)
    );
    fixture.store.lock().unwrap().fail_second = false;
    let result = worker.apply(key, "p-a", false).unwrap();
    assert_eq!(fixture.store.lock().unwrap().clinical, 2);
    assert_eq!(fixture.store.lock().unwrap().attachments.len(), 1);
    assert!(!result["documents"].as_array().unwrap().is_empty());
    worker.retire();
    let worker = fixture.worker();
    let preview = fixture.review(&worker, "5 mg", "Ada");
    worker
        .apply(string(&preview["groups"][0]["key"]), "p-a", false)
        .unwrap();
    assert_eq!(fixture.store.lock().unwrap().clinical, 2);
    assert_eq!(fixture.store.lock().unwrap().attachments.len(), 1);
    worker.retire();
}
#[test]
fn dossier_lock_revocation_archive_replacement_and_host_close_stop_later_writes() {
    for denial in [401, 403, 409] {
        let fixture = Fixture::new(TEXT);
        fixture.store.lock().unwrap().deny_after_first = Some(denial);
        let worker = fixture.worker();
        let preview = fixture.review(&worker, "5 mg", "Ada");
        assert!(
            worker
                .apply(string(&preview["groups"][0]["key"]), "p-a", false)
                .is_err()
        );
        assert_eq!(fixture.store.lock().unwrap().clinical, 1);
        assert!(
            worker
                .apply(string(&preview["groups"][0]["key"]), "p-a", false)
                .is_err()
        );
        assert_eq!(fixture.store.lock().unwrap().clinical, 1);
        worker.retire();
    }
    let fixture = Fixture::new(TEXT);
    fixture.store.lock().unwrap().lock_after_first = true;
    let worker = fixture.worker();
    let preview = fixture.review(&worker, "5 mg", "Ada");
    assert!(
        worker
            .apply(string(&preview["groups"][0]["key"]), "p-a", false)
            .is_err()
    );
    assert_eq!(fixture.store.lock().unwrap().clinical, 1);
    worker.retire();
    let fixture = Fixture::new(TEXT);
    let worker = fixture.worker();
    let preview = fixture.review(&worker, "5 mg", "Ada");
    fixture.session.lock();
    assert!(
        worker
            .apply(string(&preview["groups"][0]["key"]), "p-a", false)
            .is_err()
    );
    assert_eq!(fixture.store.lock().unwrap().writes, 0);
    worker.retire();
    let fixture = Fixture::new(TEXT);
    let worker = fixture.worker();
    fixture.review(&worker, "5 mg", "Ada");
    fixture.host.retire().unwrap();
    assert!(worker.apply(".", "p-a", false).is_err());
    worker.retire();
    assert_eq!(fixture.store.lock().unwrap().writes, 0);
}

#[test]
fn dossier_all_ordinary_writers_read_back_the_same_clinical_fields() {
    let text = "Data referto: 20/10/2026\nPaziente: Ada Sintetica\nDiagnosi: Ipertensione arteriosa ICD-10 I10.\nEsenzione 031 per ipertensione arteriosa.\nCreatinina 0,9 mg/dL nel sangue.\nRichiesta Visita cardiologica ed ECG.\nPrescritta carrozzina leggera ISO 12.22.03.\nLa paziente vive sola nella propria abitazione.";
    let fixture = Fixture::new(text);
    let worker = fixture.worker();
    use sha2::Digest;
    let sha = format!(
        "{:x}",
        sha2::Sha256::digest(std::fs::read(&fixture.file).unwrap())
    );
    let extraction = json!({"schema":"mediflow.dossier_prepared_extraction.v1","sources":[{"sha256":sha,"documentDate":"2026-10-20","patient":{"firstName":"Ada","lastName":"Sintetica"},"summary":{"title":"Sintesi letta","text":"Sintesi sintetica scelta dal medico.","date":"2026-10-20"},"coverage":{"complete":true},"facts":[
        {"kind":"diagnosis","quote":"Diagnosi: Ipertensione arteriosa ICD-10 I10","values":{"description":"Ipertensione arteriosa","code":"I10","system":"ICD-10"}},
        {"kind":"exemption","quote":"Esenzione 031 per ipertensione arteriosa","values":{"code":"031"}},
        {"kind":"observation","quote":"Creatinina 0,9 mg/dL nel sangue","values":{"display":"Creatinina","value":"0,9","unit":"mg/dL"}},
        {"kind":"service_prescription","quote":"Richiesta Visita cardiologica ed ECG","values":{"serviceName":"Visita cardiologica","items":"Visita cardiologica\nECG","category":"visit"}},
        {"kind":"prosthetic","quote":"Prescritta carrozzina leggera ISO 12.22.03","values":{"description":"carrozzina leggera","isoCode":"12.22.03","category":"standard","status":"prescribed"}},
        {"kind":"care_context","values":{"text":"La paziente vive sola nella propria abitazione."}}
    ]}]});
    let preview = worker
        .review(
            extraction.to_string(),
            vec![fixture.file.clone()],
            Some("p-a"),
        )
        .unwrap();
    let outcome = worker
        .apply(string(&preview["groups"][0]["key"]), "p-a", true)
        .unwrap();
    let documents = outcome["documents"].as_array().unwrap();
    assert!(!documents.is_empty());
    let outcomes = outcome["applied"]["applied"].as_array().unwrap();
    assert!(!outcomes.is_empty());
    for result in outcomes {
        assert_eq!(result["partial"], false, "{result}");
        assert!(result["stopped"].is_null(), "{result}");
        for result in result["outcomes"].as_array().unwrap() {
            assert!(
                ["applied", "already_present"].contains(&string(&result["outcome"])),
                "{result}"
            );
        }
    }
    let store = fixture.store.lock().unwrap();
    for table in [
        "entries",
        "observations",
        "service-prescriptions",
        "service-prescription-items",
        "prosthetic-prescriptions",
    ] {
        assert!(!store.records[table].is_empty(), "{table}");
    }
    assert!(store.updated_patient.is_some());
    drop(store);
    worker.retire();
}

fn dossier_reply(
    stream: &mut impl Write,
    cancelled: bool,
    status: u16,
    body: Value,
    extra: &str,
) -> io::Result<()> {
    match try_local_host_reply(stream, status, body, extra) {
        Err(error)
            if cancelled
                && matches!(
                    error.kind(),
                    io::ErrorKind::BrokenPipe
                        | io::ErrorKind::ConnectionReset
                        | io::ErrorKind::ConnectionAborted
                ) =>
        {
            Ok(())
        }
        result => result,
    }
}

#[test]
fn dossier_cancelled_reply_accepts_only_peer_disconnects() {
    struct FailedWrite(io::ErrorKind);
    impl Write for FailedWrite {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::from(self.0))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    for kind in [
        io::ErrorKind::BrokenPipe,
        io::ErrorKind::ConnectionReset,
        io::ErrorKind::ConnectionAborted,
    ] {
        assert!(dossier_reply(&mut FailedWrite(kind), true, 200, json!({}), "").is_ok());
        assert_eq!(
            dossier_reply(&mut FailedWrite(kind), false, 200, json!({}), "")
                .unwrap_err()
                .kind(),
            kind
        );
    }
    assert_eq!(
        dossier_reply(
            &mut FailedWrite(io::ErrorKind::PermissionDenied),
            true,
            200,
            json!({}),
            "",
        )
        .unwrap_err()
        .kind(),
        io::ErrorKind::PermissionDenied
    );
    let mut sent = vec![];
    dossier_reply(&mut sent, false, 201, json!({"id":"synthetic"}), "").unwrap();
    assert!(sent.starts_with(b"HTTP/1.1 201 Synthetic\r\n"));
    assert!(sent.ends_with(br#"{"id":"synthetic"}"#));
}
