use super::*;
use mediflow_patient_client::Phase;
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

const DRAFT: &str = "B: ricontattare lunedì. Caffè e perché. 👩🏽‍⚕️";
const CONCURRENT: &str = "C: controllo anticipato a venerdì";
const PUT: &str = "PUT /api/v1/network/patients/patient-a";

struct HostState {
    notes: Value,
    version: u64,
    epoch: u64,
    outcome: u16,
    replaced: bool,
    identity_replaced: bool,
    replace_after_successful_put: bool,
    archived: bool,
}
type PlannedResponse = (String, std::sync::mpsc::Receiver<(u16, Value)>);

pub(super) struct Host {
    pub(super) session: RuntimeSession,
    socket: std::net::SocketAddr,
    requests: Arc<Mutex<Vec<(String, Value)>>>,
    state: Arc<Mutex<HostState>>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
    responses: Arc<Mutex<std::collections::VecDeque<PlannedResponse>>>,
}
impl Host {
    pub(super) fn new() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let socket = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let state = Arc::new(Mutex::new(HostState {
            notes: json!("A: note iniziali"),
            version: 1,
            epoch: 1,
            outcome: 200,
            replaced: false,
            identity_replaced: false,
            replace_after_successful_put: false,
            archived: false,
        }));
        let shared = state.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let responses = Arc::new(Mutex::new(
            std::collections::VecDeque::<PlannedResponse>::new(),
        ));
        let planned = responses.clone();
        let worker = thread::spawn(move || {
            let mut workers = Vec::new();
            loop {
                let (mut stream, _) = listener.accept().unwrap();
                if stopping.load(Ordering::Acquire) {
                    break;
                }
                let captured = captured.clone();
                let shared = shared.clone();
                let planned = planned.clone();
                workers.push(thread::spawn(move || {
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let Some((route, body)) = request(&mut stream) else { return; };
                captured.lock().unwrap().push((route.clone(), body.clone()));
                let response = {
                    let mut planned = planned.lock().unwrap();
                    planned.iter().position(|(prefix,_)| route.starts_with(prefix)).and_then(|index| planned.remove(index)).map(|(_, response)| response)
                };
                if let Some(response) = response {
                    let (status, body) = response.recv_timeout(Duration::from_secs(15)).expect("planned fixture response released");
                    let body = body.to_string();
                    let _ = write!(stream, "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    return;
                }
                let mut state = shared.lock().unwrap();
                let mut status = 200;
                let response = match route.as_str() {
                "GET /api/auth/check" => json!({"status":"ok", "isSetup":true, "archiveGeneration":"synthetic-generation",
                    "unlock":{"credential":"passphrase", "kdfVersion":3, "salt":"AwMDAwMDAwMDAwMDAwMDAw=="}}),
                "POST /api/auth/native/login" => json!({"success":true, "id":"synthetic-user", "username":"synthetic", "role":"admin",
                    "archiveGeneration":"synthetic-generation", "salt":"AwMDAwMDAwMDAwMDAwMDAw==",
                    "encryptedMasterKey":"v3:BQUFBQUFBQUFBQUFAm40aZvQGpityOwyLKhsE40tJdbsjtrugIXzoJ/lk9gjlh5j7pIPeh7DLQ7ikGhA"}),
                "GET /api/v1/network/capabilities" => json!({"protocolVersion":"1.14.0", "hostPorts": serde_json::from_str::<serde_json::Value>(include_str!("../../../transport/tests/fixtures/host-ports.json")).unwrap(), "operatingMode":"network-home-base",
                    "capabilities":(["write-patient-profile", "write-therapies", "write-clinical-diary", "write-observations", "write-documents", "write-checkups", "write-patient-lifecycle"].map(|key| json!({"key":format!("network.replica.{key}"), "requiresPairing":true, "status":"available"}))) }),
                "GET /api/v1/network/ambulatories" => json!([{"id":"scope-a", "name":"Ambulatorio sintetico", "isDefault":true, "version":1}]),
                "GET /api/v1/network/identity" => {
                    if state.identity_replaced { status = 409; json!({"code":"ARCHIVE_REPLACED"}) }
                    else { json!({"scope":{"effectiveAmbulatoryId":"scope-a", "requestBinding":"expected-ambulatory-id-v1"},
                        "operator":{"userId":"synthetic-user", "authChannel":"native"}}) }
                },
                "GET /api/v1/network/patient-profile/selection-epoch" => {
                    if state.replaced { status = 409; json!({"code":"ARCHIVE_REPLACED"}) }
                    else { json!({"contractVersion":1,"selectionEpoch":state.epoch}) }
                }
                value if value.starts_with("POST /api/v1/network/patients/") && value.ends_with("/profile-query") => {
                    if state.replaced { status = 409; json!({"code":"ARCHIVE_REPLACED"}) }
                    else {
                        assert_eq!(body["kind"], "open");
                        assert_eq!(body["expectedSelectionEpoch"], state.epoch);
                        state.epoch += 1;
                        json!({"schemaVersion":"mediflow.patient.profile-view.v1", "operationId":"patient-profile.read.v1", "contractVersion":1,
                            "handle":format!("pph_{}", "a".repeat(64)), "projection":"profile",
                            "currentness":{"revision":state.version,"selectionEpoch":state.epoch,"observedAt":1000,"expiresAt":61000},
                            "profile":{"firstName":"Amina","lastName":"Sintetica","taxCode":"SYNTHETIC","birthDate":null,
                                "address":null,"phone":null,"caregiver":null,"diagnoses":null,"exemptions":null,"notes":state.notes,
                                "isAdi":false,"isArchived":state.archived,"statusReason":null,"archiveReason":null,"archiveNote":null}})
                    }
                }
                PUT => {
                    status = if state.replaced { 409 } else { state.outcome };
                    state.outcome = 200;
                    if status != 409 {
                        assert_eq!(body["version"], state.version);
                        assert!(body["notes"].as_str().unwrap().starts_with("ENC:"));
                        state.notes = body["notes"].clone();
                        state.version += 1;
                    }
                    if status == 0 { return; }
                    let response = if state.replaced { json!({"code":"ARCHIVE_REPLACED"}) }
                    else if status == 409 { json!({"code":"VERSION_CONFLICT"}) } else { json!({"success":true}) };
                    if status == 200 && state.replace_after_successful_put { state.replaced = true; }
                    response
                }
                "GET /api/v1/network/patients" => json!([]),
                value if value.starts_with("GET /api/v1/network/checkups?") => json!([]),
                "POST /api/auth/native/logout" => json!({"success":true}),
                value if value.starts_with("GET /api/v1/network/patients/") => json!([]),
                value => panic!("unexpected fixture route: {value}"),
            }.to_string();
                drop(state);
                let _ = write!(stream, "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nSet-Cookie: mediflow_session={}; Path=/; HttpOnly\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", "a".repeat(64), response.len());
                }));
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        let client = RuntimeClient::new(RuntimeConfig {
            base_url: format!("http://{socket}"),
            tls_pin_sha256: None,
        })
        .unwrap();
        let session = client
            .login(
                PairingCredentials::new("synthetic-device", "x".repeat(64)).unwrap(),
                "synthetic",
                "Synthetic scales fixture passphrase",
            )
            .unwrap();
        session.list_ambulatories().unwrap();
        Self {
            session,
            socket,
            requests,
            state,
            stop,
            worker: Some(worker),
            responses,
        }
    }
    pub(super) fn plan(&self, prefix: &str) -> std::sync::mpsc::Sender<(u16, Value)> {
        let (sender, receiver) = std::sync::mpsc::channel();
        self.responses
            .lock()
            .unwrap()
            .push_back((prefix.into(), receiver));
        sender
    }

    pub(super) fn routes(&self) -> Vec<String> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .map(|(route, _)| route.clone())
            .collect()
    }

    pub(super) fn replace_archive(&self) {
        self.state.lock().unwrap().identity_replaced = true;
    }

    pub(super) fn request_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }

    fn writes(&self) -> Vec<Value> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(route, _)| route == PUT)
            .map(|(_, body)| body.clone())
            .collect()
    }
}
impl Drop for Host {
    fn drop(&mut self) {
        self.session.lock();
        self.stop.store(true, Ordering::Release);
        let _ = TcpStream::connect(self.socket);
        self.worker.take().unwrap().join().unwrap();
    }
}
fn request(stream: &mut TcpStream) -> Option<(String, Value)> {
    let mut header = vec![];
    let mut byte = [0];
    while !header.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).ok()?;
        header.push(byte[0]);
        assert!(header.len() < 16384);
    }
    let header = String::from_utf8(header).unwrap();
    let size = header
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .map(|s| s.trim().parse::<usize>().unwrap())
        })
        .unwrap_or(0);
    assert!(size < 128 * 1024);
    let mut body = vec![0; size];
    stream.read_exact(&mut body).ok()?;
    Some((
        header
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" "),
        if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body).unwrap()
        },
    ))
}
pub(super) fn draw(cx: &mut gpui::VisualTestContext) {
    for _ in 0..8 {
        let pending = cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
            window.simulate_next_frame(cx)
        });
        cx.run_until_parked();
        if pending == 0 {
            return;
        }
    }
    panic!("notes render did not settle");
}
fn open(view: &Entity<ClinicalApp>, host: &Host, cx: &mut gpui::VisualTestContext) {
    cx.simulate_resize(gpui::size(px(1200.), px(1100.)));
    view.update(cx, |app, cx| {
        app.session = Some(host.session.clone());
        app.scope = Some("scope-a".into());
        app.select_patient("patient-a", true, cx);
    });
    cx.run_until_parked();
    cx.update_window_entity(view, |app, window, cx| {
        assert_eq!(
            app.patient.detail.ready().unwrap().notes.as_deref(),
            Some("A: note iniziali")
        );
        app.open_form(FormKind::Notes, window, cx);
    });
    draw(cx);
    cx.update_window_entity(view, |app, window, cx| {
        let editor = app.form.as_ref().unwrap().fields[0].editor.clone();
        editor.update(cx, |input, cx| input.focus_and_select(window, cx));
    });
    cx.simulate_input(DRAFT);
    cx.run_until_parked();
    view.read_with(cx, |app, _| assert_eq!(app.core.draft_notes(), DRAFT));
}
fn confirm(view: &Entity<ClinicalApp>, cx: &mut gpui::VisualTestContext) {
    cx.update_window_entity(view, |app, window, cx| app.review_form(window, cx));
    draw(cx);
    let button = cx.debug_bounds("clinical-workspace-confirm-save").unwrap();
    cx.simulate_click(button.center(), gpui::Modifiers::default());
    cx.run_until_parked();
}
fn reread(view: &Entity<ClinicalApp>, cx: &mut gpui::VisualTestContext) {
    draw(cx);
    let button = cx.debug_bounds("clinical-notes-recovery-command").unwrap();
    cx.simulate_click(button.center(), gpui::Modifiers::default());
    cx.run_until_parked();
    view.read_with(cx, |app, _| {
        assert!(app.discard.is_none(), "rereading must not ask to discard")
    });
}

#[gpui::test]
fn notes_conflict_rereads_c_preserves_b_and_only_a_new_confirmation_writes_on_c(
    cx: &mut gpui::TestAppContext,
) {
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    let editor = view.read_with(cx, |app, _| {
        app.form.as_ref().unwrap().fields[0].editor.clone()
    });
    {
        let mut state = host.state.lock().unwrap();
        state.version = 2;
        state.notes = json!(CONCURRENT);
        state.outcome = 409;
    }
    confirm(&view, cx);
    view.read_with(cx, |app, _| {
        assert!(app.form.as_ref().unwrap().state == FormState::Conflict)
    });
    assert_eq!(host.writes().len(), 1);
    reread(&view, cx);
    view.read_with(cx, |app, cx| {
        assert_eq!(
            app.patient.detail.ready().unwrap().notes.as_deref(),
            Some(CONCURRENT)
        );
        assert_eq!(app.patient.detail.ready().unwrap().version, 2);
        assert_eq!(app.core.draft_notes(), DRAFT);
        assert_eq!(app.form.as_ref().unwrap().fields[0].value(cx), DRAFT);
        assert_eq!(app.form.as_ref().unwrap().fields[0].editor, editor);
        assert!(app.form.as_ref().unwrap().state == FormState::Draft);
    });
    assert_eq!(
        host.writes().len(),
        1,
        "reread must not dispatch a second PUT"
    );
    for dark in [false, true] {
        for width in [1200., 390.] {
            view.update(cx, |app, cx| {
                app.dark_override = Some(dark);
                cx.notify();
            });
            cx.simulate_resize(gpui::size(px(width), px(1100.)));
            draw(cx);
            let registered = cx.debug_bounds("clinical-notes-recorded").unwrap();
            let draft = cx.debug_bounds("clinical-notes-your-draft").unwrap();
            assert!(registered.bottom() <= draft.top());
            assert!(registered.right() <= px(width) && draft.right() <= px(width));
        }
    }
    cx.simulate_resize(gpui::size(px(1200.), px(1100.)));
    cx.update(|window, cx| editor.update(cx, |input, cx| input.focus_and_select(window, cx)));
    cx.simulate_input("B: bozza rivista dopo il confronto");
    cx.run_until_parked();
    view.read_with(cx, |app, _| {
        assert_eq!(app.core.draft_notes(), "B: bozza rivista dopo il confronto");
        assert_eq!(
            app.patient.detail.ready().unwrap().notes.as_deref(),
            Some(CONCURRENT)
        );
    });
    assert_eq!(host.writes().len(), 1);
    cx.update(|window, cx| editor.update(cx, |input, cx| input.focus_and_select(window, cx)));
    cx.simulate_input(DRAFT);
    cx.run_until_parked();
    confirm(&view, cx);
    let writes = host.writes();
    assert_eq!(writes.len(), 2);
    assert_eq!(writes[1]["version"], 2);
    view.read_with(cx, |app, _| {
        assert!(app.form.is_none());
        assert_eq!(app.core.phase(), Phase::Saved);
        assert_eq!(
            app.patient.detail.ready().unwrap().notes.as_deref(),
            Some(DRAFT)
        );
    });
}

#[gpui::test]
fn notes_lost_response_blocks_resend_then_rereads_saved_b_or_compares_other_content(
    cx: &mut gpui::TestAppContext,
) {
    for same in [true, false] {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        open(&view, &host, cx);
        host.state.lock().unwrap().outcome = 0;
        confirm(&view, cx);
        view.read_with(cx, |app, _| {
            assert!(app.form.as_ref().unwrap().state == FormState::Uncertain);
            assert_eq!(app.core.phase(), Phase::Indeterminate);
        });
        cx.update_window_entity(&view, |app, window, cx| {
            app.review_form(window, cx);
            app.confirm_form(cx);
        });
        cx.run_until_parked();
        draw(cx);
        assert!(cx.debug_bounds("clinical-workspace-confirm-save").is_none());
        assert_eq!(
            host.writes().len(),
            1,
            "uncertain outcomes must never resend"
        );
        if !same {
            host.state.lock().unwrap().notes = json!(CONCURRENT);
        }
        reread(&view, cx);
        assert_eq!(
            host.writes().len(),
            1,
            "verification is a read, never a second PUT"
        );
        view.read_with(cx, |app, cx| {
            assert_eq!(app.core.draft_notes(), DRAFT);
            if same {
                assert!(app.form.is_none());
                assert_eq!(app.core.phase(), Phase::Saved);
                assert!(app.verified.as_ref().unwrap().starts_with("Registrata"));
            } else {
                assert!(app.core.has_notes_comparison());
                assert_eq!(app.form.as_ref().unwrap().fields[0].value(cx), DRAFT);
                assert_eq!(
                    app.patient.detail.ready().unwrap().notes.as_deref(),
                    Some(CONCURRENT)
                );
            }
        });
    }
}

#[gpui::test]
fn notes_patient_change_requires_explicit_discard_and_retires_previous_authority(
    cx: &mut gpui::TestAppContext,
) {
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    host.state.lock().unwrap().outcome = 409;
    confirm(&view, cx);
    view.update(cx, |app, cx| {
        app.select_patient("patient-b", true, cx);
        assert_eq!(app.selected_id.as_deref(), Some("patient-a"));
        app.finish_discard(Discard::Form, cx);
        app.select_patient("patient-b", true, cx);
    });
    cx.run_until_parked();
    view.update(cx, |app, cx| {
        app.reread_notes(cx);
        app.confirm_form(cx);
    });
    cx.run_until_parked();
    assert_eq!(host.writes().len(), 1);
    view.read_with(cx, |app, _| {
        assert!(app.form.is_none());
        assert!(!app.core.has_notes_comparison());
        assert_eq!(app.selected_id.as_deref(), Some("patient-b"));
        assert_eq!(app.core.selected_id(), Some("patient-b"));
        assert_ne!(app.core.draft_notes(), DRAFT);
    });
}

#[gpui::test]
fn notes_archive_replacement_during_put_disconnects_without_resending_draft(
    cx: &mut gpui::TestAppContext,
) {
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    host.state.lock().unwrap().replaced = true;
    confirm(&view, cx);
    assert_archive_disconnected(&view, &host, cx);
    let state = host.state.lock().unwrap();
    assert_eq!(state.notes, json!("A: note iniziali"));
    assert_eq!(state.version, 1);
}

#[gpui::test]
fn notes_archive_replacement_during_automatic_readback_disconnects_without_further_reads_or_writes(
    cx: &mut gpui::TestAppContext,
) {
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    let editor = view.read_with(cx, |app, _| {
        app.form.as_ref().unwrap().fields[0].editor.clone()
    });
    host.state.lock().unwrap().replace_after_successful_put = true;
    let requests_before = host.requests.lock().unwrap().len();
    confirm(&view, cx);
    {
        let state = host.state.lock().unwrap();
        assert_eq!(
            state.version, 2,
            "the PUT must succeed before the archive changes"
        );
        assert_eq!(state.notes, host.writes()[0]["notes"]);
        assert!(state.replaced);
    }
    let routes: Vec<_> = host.requests.lock().unwrap()[requests_before..]
        .iter()
        .filter(|(route, _)| route != "POST /api/auth/native/logout")
        .map(|(route, _)| route.clone())
        .collect();
    assert_eq!(
        routes,
        [
            "GET /api/v1/network/identity",
            PUT,
            "GET /api/v1/network/identity",
            "GET /api/v1/network/patient-profile/selection-epoch",
        ],
        "the automatic readback's 409 must stop profile and section reads"
    );
    assert_archive_disconnected(&view, &host, cx);
    editor.read_with(cx, |input, _| assert!(input.value().is_empty()));
    let requests_before = host.requests.lock().unwrap().len();
    assert!(matches!(
        host.session.list_entries("scope-a", "patient-a"),
        Err(RuntimeError::Locked)
    ));
    assert_eq!(host.requests.lock().unwrap().len(), requests_before);
}

#[gpui::test]
fn notes_archive_replacement_during_recovery_disconnects_without_resending_draft(
    cx: &mut gpui::TestAppContext,
) {
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    host.state.lock().unwrap().outcome = 409;
    confirm(&view, cx);
    view.read_with(cx, |app, _| {
        assert_eq!(app.core.phase(), Phase::Conflict);
        assert!(app.form.as_ref().unwrap().state == FormState::Conflict);
        assert_eq!(app.core.draft_notes(), DRAFT);
    });
    let editor = view.read_with(cx, |app, _| {
        app.form.as_ref().unwrap().fields[0].editor.clone()
    });
    host.state.lock().unwrap().replaced = true;
    reread(&view, cx);
    assert_archive_disconnected(&view, &host, cx);
    editor.read_with(cx, |input, _| assert!(input.value().is_empty()));
}

fn assert_archive_disconnected(
    view: &Entity<ClinicalApp>,
    host: &Host,
    cx: &mut gpui::VisualTestContext,
) {
    draw(cx);
    assert!(cx.debug_bounds("clinical-notes-recovery-command").is_none());
    assert!(cx.debug_bounds("clinical-workspace-confirm-save").is_none());
    view.update(cx, |app, cx| {
        assert!(app.session.is_none());
        assert!(app.scope.is_none());
        assert!(app.selected_id.is_none());
        assert!(app.patient.detail.ready().is_none());
        assert!(app.form.is_none());
        assert_eq!(app.core.phase(), Phase::Locked);
        let (message, error) = app.message.as_ref().unwrap();
        assert!(*error);
        assert!(message.contains("Riapri l'archivio prima di continuare"));
        app.reread_notes(cx);
        app.confirm_form(cx);
    });
    cx.run_until_parked();
    assert!(host.session.is_locked());
    let requests_before = host.requests.lock().unwrap().len();
    assert_eq!(
        host.session
            .update_patient_notes("scope-a", "patient-a", 1, DRAFT),
        Err(RuntimeError::Locked),
    );
    assert_eq!(host.requests.lock().unwrap().len(), requests_before);
    assert_eq!(
        host.writes().len(),
        1,
        "old authority must never resend the draft"
    );
}

fn notes_form_presentation(
    view: &Entity<ClinicalApp>,
    cx: &mut gpui::VisualTestContext,
) -> (String, &'static str) {
    draw(cx);
    view.read_with(cx, |app, cx| {
        let form = app.form.as_ref().unwrap();
        (
            app.form_subject(form, &app.patient.detail.ready().unwrap().display_name()),
            form.fields[0].editor.read(cx).accessible_label(),
        )
    })
}

#[gpui::test]
fn notes_comparison_explains_replacement_and_keeps_only_the_accessible_field_label(
    cx: &mut gpui::TestAppContext,
) {
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    let (threshold, label) = notes_form_presentation(&view, cx);
    assert!(cx.debug_bounds("clinical-workspace-field-label").is_some());
    assert_eq!(label, "Note della scheda");
    assert!(threshold.contains("Amina Sintetica · Note della scheda"));
    assert!(!threshold.contains("La tua bozza sostituirà il testo registrato ora."));

    {
        let mut state = host.state.lock().unwrap();
        state.version = 2;
        state.notes = json!(CONCURRENT);
        state.outcome = 409;
    }
    confirm(&view, cx);
    reread(&view, cx);
    let (threshold, label) = notes_form_presentation(&view, cx);
    assert!(cx.debug_bounds("clinical-workspace-field-label").is_none());
    assert_eq!(label, "Note della scheda, la tua bozza");
    assert!(threshold.contains(
        "Amina Sintetica · Note della scheda. La tua bozza sostituirà il testo registrato ora."
    ));

    let editor = view.read_with(cx, |app, _| {
        app.form.as_ref().unwrap().fields[0].editor.clone()
    });
    cx.update(|window, cx| editor.update(cx, |input, cx| input.focus_and_select(window, cx)));
    cx.simulate_input(CONCURRENT);
    cx.run_until_parked();
    let (threshold, label) = notes_form_presentation(&view, cx);
    assert!(threshold.contains("Amina Sintetica · Note della scheda"));
    assert!(!threshold.contains("La tua bozza sostituirà il testo registrato ora."));
    assert!(cx.debug_bounds("clinical-workspace-field-label").is_none());
    assert_eq!(label, "Note della scheda, la tua bozza");

    cx.update(|window, cx| editor.update(cx, |input, cx| input.focus_and_select(window, cx)));
    cx.simulate_input(DRAFT);
    cx.run_until_parked();
    cx.update_window_entity(&view, |app, window, cx| app.review_form(window, cx));
    let (threshold, label) = notes_form_presentation(&view, cx);
    assert!(threshold.contains(
        "Amina Sintetica · Note della scheda. La tua bozza sostituirà il testo registrato ora."
    ));
    assert!(cx.debug_bounds("clinical-workspace-field-label").is_none());
    assert_eq!(label, "Note della scheda, la tua bozza");
    assert_eq!(
        host.writes().len(),
        1,
        "rendering and review must not send the draft"
    );
}

#[gpui::test]
fn notes_nonwritable_recovery_offers_copy_and_discard_and_releases_navigation(
    cx: &mut gpui::TestAppContext,
) {
    for deleted in [false, true] {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        open(&view, &host, cx);
        host.state.lock().unwrap().outcome = 409;
        confirm(&view, cx);
        if deleted {
            view.update(cx, |app, cx| {
                let mut patient = app.patient.detail.ready().unwrap().clone();
                patient.deleted_at = Some("2026-10-21T10:00:00Z".into());
                patient.version += 1;
                let request = app.core.reread_preserving_draft().unwrap();
                app.form.as_mut().unwrap().state = FormState::Saving;
                app.apply_notes_reread(&request, FormState::Conflict, patient, cx);
                cx.notify();
            });
        } else {
            host.state.lock().unwrap().archived = true;
            reread(&view, cx);
        }
        draw(cx);
        view.read_with(cx, |app, cx| {
            assert!(app.form.as_ref().unwrap().state == FormState::Rejected);
            assert_eq!(app.core.phase(), Phase::Locked);
            assert_eq!(app.form.as_ref().unwrap().fields[0].value(cx), DRAFT);
            assert!(!app.navigation_shortcuts_available());
        });
        assert!(cx.debug_bounds("clinical-notes-recovery-command").is_none());
        assert!(cx.debug_bounds("clinical-workspace-reconcile").is_none());
        assert!(cx.debug_bounds("clinical-workspace-review-save").is_none());
        assert!(cx.debug_bounds("clinical-workspace-confirm-save").is_none());
        let copy = cx.debug_bounds("Copia la bozza").unwrap();
        let discard = cx.debug_bounds("Scarta la bozza").unwrap();
        cx.simulate_click(copy.center(), gpui::Modifiers::default());
        cx.run_until_parked();
        cx.update(|_, cx| {
            assert_eq!(
                cx.read_from_clipboard().unwrap().text().as_deref(),
                Some(format!("Note della scheda\n{DRAFT}").as_str())
            );
        });
        view.read_with(cx, |app, cx| {
            assert_eq!(app.form.as_ref().unwrap().fields[0].value(cx), DRAFT);
        });
        let before = host.requests.lock().unwrap().len();
        cx.simulate_click(discard.center(), gpui::Modifiers::default());
        cx.run_until_parked();
        draw(cx);
        view.read_with(cx, |app, _| {
            assert!(app.form.is_none());
            assert!(app.discard.is_none());
            assert!(app.navigation_shortcuts_available());
            assert!(app.patient.detail.ready().is_some());
            assert!(
                app.patient
                    .detail
                    .ready()
                    .is_some_and(|patient| patient.is_archived || patient.deleted_at.is_some())
            );
        });
        assert_eq!(
            host.requests.lock().unwrap().len(),
            before,
            "discard must not send any request"
        );
        view.update(cx, |app, cx| app.select_patient("patient-b", true, cx));
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert_eq!(app.selected_id.as_deref(), Some("patient-b"));
            assert_eq!(app.core.selected_id(), Some("patient-b"));
        });
        assert_eq!(
            host.writes().len(),
            1,
            "recovery, copy, discard and navigation must not write"
        );
    }
}

#[gpui::test]
fn confirmation_full_plane_preserves_keyboard_order_inside_the_complete_shell(
    cx: &mut gpui::TestAppContext,
) {
    cx.update(bind_keys);
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    cx.simulate_resize(gpui::size(px(390.), px(700.)));
    cx.update_window_entity(&view, |app, window, cx| {
        app.text_scale = 4.;
        app.review_form(window, cx);
    });
    draw(cx);
    view.read_with(cx, |app, _| {
        assert_eq!(app.threshold_mode.get(), ThresholdMode::FullPlane)
    });
    let region = cx.debug_bounds("threshold-full-plane").unwrap();
    assert!(region.size.height > px(0.) && region.bottom() <= px(700.));
    cx.update(|window, cx| assert!(view.read(cx).threshold_question.focus.is_focused(window)));
    cx.simulate_keystrokes("tab");
    draw(cx);
    cx.update(|window, cx| assert!(view.read(cx).form_actions[2].focus.is_focused(window)));
    cx.simulate_keystrokes("tab");
    draw(cx);
    cx.update(|window, cx| assert!(view.read(cx).form_actions[3].focus.is_focused(window)));
    let command = cx.debug_bounds("clinical-workspace-confirm-save").unwrap();
    assert!(command.top() >= region.top() && command.bottom() <= region.bottom());
    cx.simulate_keystrokes("escape");
    draw(cx);
    view.read_with(cx, |app, _| {
        assert!(app.form.as_ref().unwrap().state == FormState::Draft)
    });
    let content = cx.debug_bounds("threshold-scroll").unwrap();
    assert_eq!(content.size.height, region.size.height);
    assert!(view.read_with(cx, |app, _| app.threshold_scrolls_with_content.get()));
    assert!(
        host.writes().is_empty(),
        "layout and keyboard navigation must not write"
    );
}

#[gpui::test]
fn threshold_rendered_commands_bind_recipient_order_and_callbacks(cx: &mut gpui::TestAppContext) {
    cx.update(bind_keys);
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    cx.simulate_resize(gpui::size(px(390.), px(700.)));
    cx.update_window_entity(&view, |app, window, cx| {
        app.text_scale = 4.;
        app.review_form(window, cx);
    });
    draw(cx);
    for confirm_second in [false, true] {
        cx.simulate_keystrokes("tab");
        draw(cx);
        cx.simulate_keystrokes("tab");
        draw(cx);
        if !confirm_second {
            cx.simulate_keystrokes("shift-tab");
            draw(cx);
        }
        let first = cx.debug_bounds("threshold-back").unwrap();
        let second = cx.debug_bounds("clinical-workspace-confirm-save").unwrap();
        assert!(
            first.bottom() <= second.top(),
            "rendered commands must not overlap"
        );
        for (id, label, bounds) in [
            (
                "clinical-workspace-cancel-review",
                "Torna alla bozza",
                first,
            ),
            (
                "clinical-workspace-confirm-save",
                "Conferma e registra nella scheda di Amina Sintetica",
                second,
            ),
        ] {
            let (node, rendered_bounds) = rendered_command::node(id);
            assert_eq!(node.role(), Role::Button);
            assert_eq!(
                node.label(),
                Some(label),
                "accessible name on rendered {id}"
            );
            assert_eq!(
                rendered_bounds, bounds,
                "name and bounds belong to the same rendered element"
            );
        }
        for (label, bounds) in [
            ("control-label:Torna alla bozza", first),
            ("control-label:Conferma e registra", second),
        ] {
            let text = cx
                .debug_bounds(label)
                .expect("actual visible command label");
            assert!(
                text.top() >= bounds.top()
                    && text.bottom() <= bounds.bottom()
                    && text.left() >= bounds.left()
                    && text.right() <= bounds.right(),
                "visible label inside its command"
            );
        }
        let target = if confirm_second { second } else { first };
        let viewport = cx.debug_bounds("threshold-full-plane").unwrap();
        assert!(
            target.top() >= viewport.top() && target.bottom() <= viewport.bottom(),
            "click target must be visible in the prepainted frame: {target:?} in {viewport:?}"
        );
        cx.simulate_click(target.center(), gpui::Modifiers::default());
        cx.run_until_parked();
        if confirm_second {
            assert_eq!(host.writes().len(), 1);
            view.read_with(cx, |app, _| assert!(app.form.is_none()));
        } else {
            assert!(host.writes().is_empty());
            view.read_with(cx, |app, _| {
                assert!(app.form.as_ref().unwrap().state == FormState::Draft)
            });
            cx.update_window_entity(&view, |app, window, cx| app.review_form(window, cx));
            draw(cx);
        }
    }
}

#[gpui::test]
fn threshold_notes_comparison_full_plane_keeps_warning_before_return_detail(
    cx: &mut gpui::TestAppContext,
) {
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    {
        let mut state = host.state.lock().unwrap();
        state.version = 2;
        state.notes = json!(CONCURRENT);
        state.outcome = 409;
    }
    confirm(&view, cx);
    reread(&view, cx);
    cx.simulate_resize(gpui::size(px(390.), px(700.)));
    cx.update_window_entity(&view, |app, window, cx| {
        app.text_scale = 4.;
        app.review_form(window, cx);
    });
    draw(cx);
    view.read_with(cx,|app,_| {
        assert_eq!(app.threshold_mode.get(),ThresholdMode::FullPlane);
        assert!(app.core.has_notes_comparison());
        assert_eq!(app.threshold_detail_text(ThresholdMode::FullPlane), "La tua bozza sostituirà il testo registrato ora. Per rivedere il contenuto torna alla bozza. La registrazione sarà confermata soltanto dopo la rilettura.");
    });
    let back = cx.debug_bounds("threshold-back").unwrap();
    let confirm = cx.debug_bounds("clinical-workspace-confirm-save").unwrap();
    let detail = cx.debug_bounds("threshold-detail").unwrap();
    assert!(back.bottom() <= confirm.top() && confirm.bottom() <= detail.top());
}

pub(super) fn assert_minimum_geometry(
    view: &Entity<ClinicalApp>,
    cx: &mut gpui::VisualTestContext,
    kind: &str,
    body: f32,
) {
    let content = cx.debug_bounds("threshold-scroll").unwrap();
    let bar = cx.debug_bounds("threshold-bar").unwrap();
    let region = cx.debug_bounds("threshold-recovery-region").unwrap();
    let id = view.read_with(cx, |app, _| {
        if app.form.as_ref().unwrap().state == FormState::Draft {
            "clinical-workspace-review-save"
        } else {
            "clinical-workspace-reconcile"
        }
    });
    let primary = cx.debug_bounds(id).unwrap();
    let clip = rendered_command::clip("threshold-other-actions");
    assert!(
        clip.top() >= region.top() && clip.bottom() <= region.bottom(),
        "scrollable children must be clipped to the region: {clip:?} in {region:?}"
    );
    let label = cx
        .debug_bounds(if id.ends_with("reconcile") {
            "control-label:Rileggi e verifica"
        } else {
            "control-label:Registra 1 elemento"
        })
        .unwrap();
    eprintln!(
        "{kind} base={body}: content={content:?} bar={bar:?} region={region:?} primary={primary:?} label={label:?}"
    );
    assert!(content.size.height >= px((body * 4. * 1.5).ceil()));
    assert!(content.top() >= px(0.) && content.bottom() <= bar.top());
    assert!(bar.top() >= px(0.) && bar.bottom() <= px(640.));
    assert!(
        region.size.height >= px(0.)
            && region.top() >= bar.top()
            && region.bottom() <= primary.top()
    );
    assert!(
        primary.top() >= bar.top()
            && primary.bottom() <= px(640.)
            && primary.left() >= px(0.)
            && primary.right() <= px(390.)
    );
    assert!(
        label.top() >= primary.top()
            && label.bottom() <= primary.bottom()
            && label.left() >= primary.left()
            && label.right() <= primary.right()
    );
    view.read_with(cx, |app, _| {
        assert_eq!(app.threshold_mode.get(), ThresholdMode::Compact)
    });
}

#[gpui::test]
fn threshold_minimum_shell_drafts_scroll_to_their_commands(cx: &mut gpui::TestAppContext) {
    cx.update(bind_keys);
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&view, &host, cx);
    for body in [14., 16.] {
        for kind in [FormKind::Notes, FormKind::Therapy, FormKind::PatientNew] {
            cx.simulate_resize(gpui::size(px(390.), px(640.)));
            cx.update_window_entity(&view, |app, window, cx| {
                app.form = None;
                app.text_scale = 4.;
                app.test_body_size = Some(body);
                if kind == FormKind::PatientNew {
                    app.stage_fields(kind, patient_forms::fields(None), None, cx);
                } else {
                    app.open_form(kind, window, cx);
                }
                app.focus_first_field = false;
                app.focus_after_render = false;
                cx.notify();
            });
            draw(cx);
            let content = cx.debug_bounds("threshold-scroll").unwrap();
            assert!(
                content.size.height >= px(500.),
                "{} base={body}: {content:?}",
                kind.title()
            );
            assert!(view.read_with(cx, |app, _| app.threshold_scrolls_with_content.get()));
            cx.update_window_entity(&view, |app, window, cx| {
                window.focus(&app.form_actions[0].focus, cx);
                app.reveal_focused(window, cx);
            });
            draw(cx);
            cx.simulate_keystrokes("tab");
            draw(cx);
            cx.update(|window, cx| assert!(view.read(cx).form_actions[1].focus.is_focused(window)));
            let command = cx.debug_bounds("clinical-workspace-review-save").unwrap();
            assert!(
                command.top() >= content.top() && command.bottom() <= content.bottom(),
                "{} base={body}: {command:?}",
                kind.title()
            );
        }
    }
    assert!(host.writes().is_empty());
}

#[gpui::test]
fn threshold_all_primary_labels_fit_three_lines_in_minimum_shell(cx: &mut gpui::TestAppContext) {
    use super::threshold_actions::{Command, PRIMARY_LABELS};
    for body in [14., 16.] {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        open(&view, &host, cx);
        for &(command, specific_kind, label) in PRIMARY_LABELS {
            let label_selector: &'static str =
                Box::leak(format!("control-label:{label}").into_boxed_str());
            cx.update_window_entity(&view, |app, window, cx| {
                app.form = None;
                app.area = Area::Patients;
                app.open_form(FormKind::Notes, window, cx);
            });
            let mut checked_cases = 0;
            for kind in [
                FormKind::Notes,
                FormKind::Entry,
                FormKind::Scale,
                FormKind::Therapy,
                FormKind::Observation,
                FormKind::Checkup,
                FormKind::Document,
                FormKind::PatientNew,
                FormKind::PatientProfile,
            ] {
                if specific_kind.is_some_and(|specific| specific != kind)
                    || command.primary_label(kind) != label
                    || (command == Command::Copy && kind != FormKind::Notes)
                {
                    continue;
                }
                let states: &[FormState] = match command {
                    Command::Review => &[FormState::Draft],
                    Command::Reread => &[
                        FormState::Conflict,
                        FormState::Uncertain,
                        FormState::Rejected,
                    ],
                    Command::Copy => &[FormState::Rejected],
                    _ => panic!("unexpected primary: {label}"),
                };
                for &state in states {
                    cx.simulate_resize(gpui::size(px(390.), px(640.)));
                    cx.update_window_entity(&view, |app, window, cx| {
                        if kind == FormKind::Scale && app.form.as_ref().unwrap().scale.is_none() {
                            super::scales::tests::stage_primary_label_fixture(app, cx);
                        }
                        let form = app.form.as_mut().unwrap();
                        form.kind = kind;
                        form.state = state;
                        if command == Command::Copy {
                            app.core.lock();
                            let mut patient = app.patient.detail.ready().unwrap().clone();
                            patient.is_archived = true;
                            app.patient.detail = ReadLoad::Ready(patient);
                        }
                        app.text_scale = 4.;
                        app.test_body_size = Some(body);
                        app.focus_first_field = false;
                        app.focus_after_render = false;
                        window.focus(&app.form_actions[command.id_and_action().1].focus, cx);
                        cx.notify();
                    });
                    draw(cx);
                    cx.update_window_entity(&view, |app, window, cx| {
                        window.focus(&app.form_actions[command.id_and_action().1].focus, cx);
                        app.reveal_focused(window, cx);
                    });
                    draw(cx);
                    cx.update(|window, cx| {
                        assert!(
                            view.read(cx).form_actions[command.id_and_action().1]
                                .focus
                                .is_focused(window),
                            "primary must be focused: {label}"
                        )
                    });
                    checked_cases += 1;
                    let text = cx.debug_bounds(label_selector).unwrap_or_else(|| {
                        panic!("missing primary label {label:?} for {}", kind.title())
                    });
                    let lines = f32::from(text.size.height) / (body * 4. * 1.5);
                    let context =
                        format!("{label:?}, {}, base={body}, lines={lines}", kind.title());
                    eprintln!("primary {context}");
                    assert!(
                        lines <= 3.,
                        "{context}: primary exceeds 3 lines; shorten its label"
                    );
                    let primary = cx.debug_bounds(command.id_and_action().0).unwrap();
                    let content = cx.debug_bounds("threshold-scroll").unwrap();
                    let bar = cx.debug_bounds("threshold-bar").unwrap();
                    let region = cx.debug_bounds("threshold-recovery-region");
                    if view.read_with(cx, |app, _| app.threshold_scrolls_with_content.get()) {
                        assert!(content.size.height >= px(500.), "{context}: {content:?}");
                        assert!(
                            primary.top() >= content.top() && primary.bottom() <= content.bottom(),
                            "{context}: {primary:?}"
                        );
                        continue;
                    }
                    let remaining_region = 640.
                        - f32::from(content.top())
                        - (body * 4. * 1.5).ceil()
                        - f32::from(primary.size.height)
                        - 25.
                        - 8.;
                    assert!(
                        remaining_region >= 0.,
                        "{context}: remaining region={remaining_region}"
                    );
                    assert!(
                        content.size.height >= px((body * 4. * 1.5).ceil()),
                        "{context}: content={content:?}"
                    );
                    assert!(
                        content.top() >= px(0.) && content.bottom() <= bar.top(),
                        "{context}"
                    );
                    if let Some(region) = region {
                        assert!(
                            region.size.height >= px(0.)
                                && region.top() >= bar.top()
                                && region.bottom() <= primary.top(),
                            "{context}: region={region:?}"
                        );
                    }
                    eprintln!(
                        "geometry {context}: content={content:?} region={region:?} primary={primary:?}"
                    );
                    assert!(
                        bar.top() >= px(0.) && bar.bottom() <= px(640.),
                        "{context}: bar={bar:?}"
                    );
                    assert!(
                        primary.top() >= bar.top()
                            && primary.bottom() <= px(640.)
                            && primary.left() >= px(0.)
                            && primary.right() <= px(390.),
                        "{context}: primary={primary:?}"
                    );
                    assert!(
                        text.top() >= primary.top()
                            && text.bottom() <= primary.bottom()
                            && text.left() >= primary.left()
                            && text.right() <= primary.right(),
                        "{context}: text={text:?}"
                    );
                    view.read_with(cx, |app, _| {
                        assert_eq!(app.threshold_mode.get(), ThresholdMode::Compact)
                    });
                }
            }
            assert!(
                checked_cases > 0,
                "uncovered production primary label: {label:?}"
            );
        }
    }
}

#[gpui::test]
fn g1a2_restore_retires_real_forms_and_retained_editors(cx: &mut gpui::TestAppContext) {
    for kind in [
        FormKind::Notes,
        FormKind::Entry,
        FormKind::Therapy,
        FormKind::Observation,
        FormKind::Checkup,
        FormKind::PatientNew,
        FormKind::PatientProfile,
    ] {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.select_patient("patient-a", false, cx);
        });
        cx.run_until_parked();
        cx.update_window_entity(&view, |app, window, cx| match kind {
            FormKind::PatientNew => app.new_patient(cx),
            FormKind::PatientProfile => {
                let row = app.patient.detail.ready().unwrap().clone();
                app.stage_fields(kind, patient_forms::fields(Some(&row)), None, cx);
            }
            _ => app.open_form(kind, window, cx),
        });
        let editors = view.update(cx, |app, cx| {
            let form = app.form.as_ref().expect("real form opened");
            assert!(form.kind == kind);
            let editors: Vec<_> = form
                .fields
                .iter()
                .map(|field| field.editor.clone())
                .collect();
            for editor in &editors {
                editor.update(cx, |input, cx| {
                    input.set_content("Bozza sintetica da ritirare", cx)
                });
            }
            app.save_error(RuntimeError::ArchiveReplaced, cx);
            assert!(
                app.session.is_none(),
                "restore retained session for {}",
                kind.title()
            );
            assert!(app.form.is_none(), "restore retained form {}", kind.title());
            assert!(app.selected_id.is_none());
            assert!(app.scope.is_none());
            assert_eq!(app.core.phase(), Phase::Locked);
            editors
        });
        for editor in editors {
            editor.read_with(cx, |input, _| {
                assert!(input.value().is_empty());
                assert!(input.read_only);
            });
        }
        assert!(host.session.is_locked());
        assert!(host.session.request_context().check().is_err());
    }
}

#[gpui::test]
fn g1a2_restore_from_old_workspace_callback_retires_current_authority(
    cx: &mut gpui::TestAppContext,
) {
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    view.update(cx, |app, cx| {
        app.session = Some(host.session.clone());
        app.scope = Some("scope-a".into());
        app.run(
            || Err::<(), _>(RuntimeError::ArchiveReplaced),
            |_, _, _| panic!("retired callback applied"),
            cx,
        );
        app.next_epoch();
    });
    cx.run_until_parked();
    view.read_with(cx, |app, _| {
        assert!(
            app.session.is_none(),
            "old workspace hid current session retirement"
        );
        assert!(app.scope.is_none());
    });
    assert!(host.session.is_locked());
}

#[gpui::test]
fn g1a2_restore_retires_document_upload_and_late_upload_callback(cx: &mut gpui::TestAppContext) {
    let host = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    let upload = || documents::Upload {
        name: "Documento sintetico.txt".into(),
        mime_type: "text/plain".into(),
        bytes: std::sync::Arc::new(Zeroizing::new(b"synthetic document".to_vec())),
    };
    view.update(cx, |app, cx| {
        app.session = Some(host.session.clone());
        app.scope = Some("scope-a".into());
        app.select_patient("patient-a", false, cx);
    });
    cx.run_until_parked();
    view.update(cx, |app, cx| {
        app.receive_document_upload(Ok(Ok(upload())), cx);
        assert!(
            app.form
                .as_ref()
                .is_some_and(|form| form.kind == FormKind::Document && form.upload.is_some())
        );
        app.run(
            move || Ok(Ok(upload())),
            ClinicalApp::receive_document_upload,
            cx,
        );
        app.save_error(RuntimeError::ArchiveReplaced, cx);
    });
    cx.run_until_parked();
    view.read_with(cx, |app, _| {
        assert!(app.session.is_none());
        assert!(
            app.form.is_none(),
            "late upload reattached retired clinical bytes"
        );
        assert!(app.patient.attachments.ready().is_none());
        assert!(!app.document_busy);
    });
}

#[gpui::test]
fn g1a2_old_authority_callback_preserves_new_session_form_and_writer_fence(
    cx: &mut gpui::TestAppContext,
) {
    let old = Host::new();
    let fresh = Host::new();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    let editor = view.update(cx, |app, cx| {
        app.session = Some(old.session.clone());
        app.run(
            || Err::<(), _>(RuntimeError::ArchiveReplaced),
            |_, _, _| panic!("old callback applied"),
            cx,
        );
        app.disconnect(cx);
        app.session = Some(fresh.session.clone());
        app.scope = Some("scope-a".into());
        super::tests::synthetic_notes_form(app, FormState::Draft, cx)
    });
    cx.run_until_parked();
    view.read_with(cx, |app, cx| {
        assert!(
            app.session
                .as_ref()
                .is_some_and(|session| !session.is_locked())
        );
        assert!(app.form.is_some());
        assert!(!editor.read(cx).value().is_empty());
        assert_eq!(app.scope.as_deref(), Some("scope-a"));
    });
    let requests = old.requests.lock().unwrap().len();
    assert_eq!(
        old.session
            .update_patient_notes("scope-a", "patient-a", 1, "late synthetic write"),
        Err(RuntimeError::Locked)
    );
    assert_eq!(
        old.requests.lock().unwrap().len(),
        requests,
        "retired session reached writer"
    );
    assert!(
        fresh
            .session
            .can_write("network.replica.write-patient-profile")
    );
    assert!(fresh.writes().is_empty());
}

#[gpui::test]
fn enlarged_draft_keeps_a_readable_editor_and_reaches_review_in_the_same_scroll(
    cx: &mut gpui::TestAppContext,
) {
    cx.update(bind_keys);
    let host = Host::new();
    let (app, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    open(&app, &host, cx);
    for dark in [false, true] {
        for (width, scale) in [390., 768., 1440.]
            .into_iter()
            .flat_map(|width| [1., 2., 4.].map(|scale| (width, scale)))
        {
            cx.simulate_resize(gpui::size(px(width), px(640.)));
            app.update(cx, |app, cx| {
                app.text_scale = scale;
                app.dark_override = Some(dark);
                app.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
                cx.notify();
            });
            draw(cx);
            let viewport = cx.debug_bounds("threshold-scroll").unwrap();
            assert!(
                scale < 4. || viewport.size.height >= px(400.),
                "draft needs room to read: {width}/{scale}/{dark}: {viewport:?}"
            );
            let editor = cx
                .debug_bounds("clinical-workspace-form-field-0-scroll-target")
                .unwrap();
            let line = app.read_with(cx, |app, _| app.theme.role(TypeRole::Prose).line_height);
            assert!(
                f32::from(editor.size.height) >= 3. * line,
                "at least three prose lines: {editor:?}"
            );
            cx.update_window_entity(&app, |app, window, cx| {
                window.focus(&app.form_actions[0].focus, cx);
                app.reveal_focused(window, cx);
            });
            draw(cx);
            cx.simulate_keystrokes("tab");
            draw(cx);
            cx.update(|window, cx| assert!(app.read(cx).form_actions[1].focus.is_focused(window)));
            let review = cx.debug_bounds("clinical-workspace-review-save").unwrap();
            assert!(
                review.top() >= viewport.top()
                    && review.bottom()
                        <= if app.read_with(cx, |app, _| app.threshold_scrolls_with_content.get()) {
                            viewport.bottom()
                        } else {
                            px(640.)
                        },
                "review reached by Tab: {review:?}"
            );
            app.read_with(cx, |app, cx| {
                assert_eq!(app.form.as_ref().unwrap().fields[0].value(cx), DRAFT)
            });
        }
    }
    assert!(
        host.writes().is_empty(),
        "navigation must not register the draft"
    );
}
