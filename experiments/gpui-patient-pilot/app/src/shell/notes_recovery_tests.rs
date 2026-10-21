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
    replace_after_successful_put: bool,
    archived: bool,
}
struct Host {
    session: RuntimeSession,
    socket: std::net::SocketAddr,
    requests: Arc<Mutex<Vec<(String, Value)>>>,
    state: Arc<Mutex<HostState>>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Host {
    fn new() -> Self {
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
            replace_after_successful_put: false,
            archived: false,
        }));
        let shared = state.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let worker = thread::spawn(move || {
            loop {
                let (mut stream, _) = listener.accept().unwrap();
                if stopping.load(Ordering::Acquire) {
                    break;
                }
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let (route, body) = request(&mut stream);
                captured.lock().unwrap().push((route.clone(), body.clone()));
                let mut state = shared.lock().unwrap();
                let mut status = 200;
                let response = match route.as_str() {
                "GET /api/auth/check" => json!({"status":"ok", "isSetup":true, "archiveGeneration":"synthetic-generation",
                    "unlock":{"credential":"passphrase", "kdfVersion":3, "salt":"AwMDAwMDAwMDAwMDAwMDAw=="}}),
                "POST /api/auth/native/login" => json!({"success":true, "id":"synthetic-user", "username":"synthetic", "role":"admin",
                    "archiveGeneration":"synthetic-generation", "salt":"AwMDAwMDAwMDAwMDAwMDAw==",
                    "encryptedMasterKey":"v3:BQUFBQUFBQUFBQUFAm40aZvQGpityOwyLKhsE40tJdbsjtrugIXzoJ/lk9gjlh5j7pIPeh7DLQ7ikGhA"}),
                "GET /api/v1/network/capabilities" => json!({"protocolVersion":"1.13.0", "operatingMode":"network-home-base",
                    "capabilities":[{"key":"network.replica.write-patient-profile", "requiresPairing":true, "status":"available"}]}),
                "GET /api/v1/network/ambulatories" => json!([{"id":"scope-a", "name":"Ambulatorio sintetico", "isDefault":true, "version":1}]),
                "GET /api/v1/network/identity" => json!({"scope":{"effectiveAmbulatoryId":"scope-a", "requestBinding":"expected-ambulatory-id-v1"},
                    "operator":{"userId":"synthetic-user", "authChannel":"native"}}),
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
                    if status == 0 { continue; }
                    let response = if state.replaced { json!({"code":"ARCHIVE_REPLACED"}) }
                    else if status == 409 { json!({"code":"VERSION_CONFLICT"}) } else { json!({"success":true}) };
                    if status == 200 && state.replace_after_successful_put { state.replaced = true; }
                    response
                }
                "POST /api/auth/native/logout" => json!({"success":true}),
                value if value.starts_with("GET /api/v1/network/patients/") => json!([]),
                value => panic!("unexpected fixture route: {value}"),
            }.to_string();
                drop(state);
                write!(stream, "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nSet-Cookie: mediflow_session={}; Path=/; HttpOnly\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", "a".repeat(64), response.len()).unwrap();
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
        }
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
fn request(stream: &mut TcpStream) -> (String, Value) {
    let mut header = vec![];
    let mut byte = [0];
    while !header.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).unwrap();
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
    stream.read_exact(&mut body).unwrap();
    (
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
    )
}
fn draw(cx: &mut gpui::VisualTestContext) {
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
