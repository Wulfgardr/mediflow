//! Scale questionnaires are host descriptors, never a second scoring engine.
//! The ordinary FormState/threshold owns review and confirmation; transport owns
//! the retained encrypted attempt and the ordinary diary's complete readback.

use super::*;
use crate::theme::{TypeRole, TypeStyle};
use mediflow_runtime_client::{
    PreparedScale, ScaleAnswers, ScaleCatalog, ScaleDescriptor, ScaleEntryAttempt,
    ScaleEntryReadback, ScaleId, ScalePreparationRequest,
};

pub(super) struct ScaleArea {
    catalog: Load<ScaleCatalog>,
    patients: Load<Vec<PatientSummary>>,
    search: Entity<TextInput>,
    query: String,
    search_target: ScrollTarget,
    targets: HashMap<String, ScrollTarget>,
    _subscription: Subscription,
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, AtomicU16, Ordering},
        },
        thread,
        time::Duration,
    };

    fn catalog_wire() -> Value {
        json!({"contractVersion":1, "preparationVersion":"mediflow.scales.prepare.v1",
            "catalogRevision":format!("sha256:{}", "a".repeat(64)),
            "scales":ScaleId::ALL.iter().map(|id| json!({"id":id, "title":format!("Strumento sintetico {}", id.as_str()),
                "description":"Descrizione sintetica: questa fixture non contiene regole cliniche.",
                "questions":[{"id":"synthetic-choice", "text":"Domanda sintetica", "type":"choice",
                    "options":[{"label":"Prima risposta", "value":0}, {"label":"Seconda risposta", "value":1}]}],
                "useContract":{"evidenceCheckedOn":"2026-10-19", "evidenceReference":"synthetic-reference", "language":"it-IT",
                    "missingAnswers":"reject-incomplete-no-imputation", "clinicalReviewer":null, "rightsReviewer":null,
                    "permissionReference":null, "permissionAttestation":"synthetic-attestation", "newUseDecision":"hold-proposed-not-enforced",
                    "definitionVersion":"synthetic-v1", "sourceId":"synthetic-source", "sourceBinding":"synthetic-binding",
                    "population":"synthetic", "scoring":"synthetic-host-only", "interpretation":"synthetic-host-only",
                    "interpretationVersion":"synthetic-interpretation-v1", "translation":"synthetic", "rights":"synthetic", "reviewGap":"synthetic"}})).collect::<Vec<_>>()})
    }
    pub(in crate::shell) fn stage_primary_label_fixture(
        app: &mut ClinicalApp,
        cx: &mut Context<ClinicalApp>,
    ) {
        app.form = None;
        app.area = Area::Scales;
        app.scales.catalog = Load::Ready(serde_json::from_value(catalog_wire()).unwrap());
        app.open_scale_form(ScaleId::Adl, cx);
        app.choose_scale_answer(0, 1, cx);
    }

    fn profile_wire(epoch: u64) -> Value {
        json!({"schemaVersion":"mediflow.patient.profile-view.v1", "operationId":"patient-profile.read.v1", "contractVersion":1,
            "handle":format!("pph_{}", "a".repeat(64)), "projection":"profile",
            "currentness":{"revision":7, "selectionEpoch":epoch, "observedAt":1000, "expiresAt":61000},
            "profile":{"firstName":"Amina", "lastName":"Sintetica", "taxCode":"SYNTHETIC", "birthDate":null,
                "address":null, "phone":null, "caregiver":null, "diagnoses":null, "exemptions":null, "notes":null,
                "isAdi":false, "isArchived":false, "statusReason":null, "archiveReason":null, "archiveNote":null}})
    }
    struct SyntheticHost {
        session: RuntimeSession,
        socket: std::net::SocketAddr,
        requests: Arc<Mutex<Vec<(String, Value)>>>,
        next_write: Arc<AtomicU16>,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }
    impl SyntheticHost {
        fn new() -> Self {
            Self::with_catalog(catalog_wire())
        }
        fn with_catalog(catalog: Value) -> Self {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let socket = listener.local_addr().unwrap();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let captured = requests.clone();
            let next_write = Arc::new(AtomicU16::new(201));
            let write_status = next_write.clone();
            let stop = Arc::new(AtomicBool::new(false));
            let stopping = stop.clone();
            let worker = thread::spawn(move || {
                let mut entries = HashMap::<String, Value>::new();
                let mut epoch = 2;
                loop {
                    let (mut stream, _) = listener.accept().unwrap();
                    if stopping.load(Ordering::Acquire) {
                        break;
                    }
                    stream
                        .set_read_timeout(Some(Duration::from_secs(10)))
                        .unwrap();
                    let mut header = vec![];
                    let mut byte = [0];
                    while !header.ends_with(b"\r\n\r\n") {
                        stream.read_exact(&mut byte).unwrap();
                        header.push(byte[0]);
                        assert!(header.len() < 16 * 1024);
                    }
                    let header = String::from_utf8(header).unwrap();
                    let size = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    assert!(size < 128 * 1024);
                    let mut body = vec![0; size];
                    stream.read_exact(&mut body).unwrap();
                    let body = if body.is_empty() {
                        Value::Null
                    } else {
                        serde_json::from_slice(&body).unwrap()
                    };
                    let route = header
                        .lines()
                        .next()
                        .unwrap()
                        .split_whitespace()
                        .take(2)
                        .collect::<Vec<_>>()
                        .join(" ");
                    // All fixtures, including unlock material below, are synthetic.
                    captured.lock().unwrap().push((route.clone(), body.clone()));
                    let mut status = 200;
                    let response = match route.as_str() {
                        "GET /api/auth/check" => json!({"status":"ok", "isSetup":true, "archiveGeneration":"synthetic-generation",
                            "unlock":{"credential":"passphrase", "kdfVersion":3, "salt":"AwMDAwMDAwMDAwMDAwMDAw=="}}),
                        "POST /api/auth/native/login" => json!({"success":true, "id":"synthetic-user", "username":"synthetic", "role":"admin",
                            "archiveGeneration":"synthetic-generation", "salt":"AwMDAwMDAwMDAwMDAwMDAw==",
                            "encryptedMasterKey":"v3:BQUFBQUFBQUFBQUFAm40aZvQGpityOwyLKhsE40tJdbsjtrugIXzoJ/lk9gjlh5j7pIPeh7DLQ7ikGhA"}),
                        "GET /api/v1/network/capabilities" => json!({"protocolVersion":"1.14.0", "hostPorts": serde_json::from_str::<serde_json::Value>(include_str!("../../../transport/tests/fixtures/host-ports.json")).unwrap(), "operatingMode":"network-home-base",
                            "capabilities":[{"key":"network.replica.write-clinical-diary", "requiresPairing":true, "status":"available"},
                                {"key":"network.replica.readonly-clinical-diary", "requiresPairing":true, "status":"available"}]}),
                        "GET /api/v1/network/ambulatories" => json!([{"id":"scope-a", "name":"Ambulatorio sintetico", "isDefault":true, "version":1}]),
                        "GET /api/v1/network/identity" => json!({"scope":{"effectiveAmbulatoryId":"scope-a", "requestBinding":"expected-ambulatory-id-v1"},
                            "operator":{"userId":"synthetic-user", "authChannel":"native"}}),
                        "GET /api/v1/network/scales" => catalog.clone(),
                        "GET /api/v1/network/patients" => json!([{"id":"patient-a", "firstName":"Amina", "lastName":"Sintetica", "taxCode":"SYNTHETIC", "version":7}]),
                        "GET /api/v1/network/patient-profile/selection-epoch" => json!({"contractVersion":1, "selectionEpoch":epoch}),
                        "POST /api/v1/network/patients/patient-a/profile-query" => {
                            if body["kind"] == "open" { assert_eq!(body["expectedSelectionEpoch"], epoch); epoch += 1; }
                            else { assert_eq!(body["kind"], "read"); assert_eq!(body["expectedRevision"], 7); }
                            profile_wire(epoch)
                        }
                        "POST /api/v1/network/patients/patient-a/scales/prepare" => {
                            assert_eq!(body.as_object().unwrap().len(), 6); assert_eq!(body["expectedSelectionEpoch"], epoch);
                            json!({"contractVersion":1, "preparationVersion":"mediflow.scales.prepare.v1", "catalogRevision":catalog["catalogRevision"],
                                "status":"draft", "context":{"patientId":"patient-a", "ambulatoryId":"scope-a", "patientVersion":7, "selectionEpoch":epoch},
                                "submission":{"title":"Strumento sintetico adl", "content":"Contenuto canonico sintetico dall'host.",
                                    "metadata":{"title":"Strumento sintetico adl", "scaleId":"adl", "score":97, "interpretation":"Interpretazione sintetica dall'host.",
                                        "interpretationVersion":"synthetic-interpretation-v1", "answers":body["answers"]}}})
                        }
                        "POST /api/v1/network/patients/patient-a/entries" => {
                            status = write_status.swap(201, Ordering::AcqRel);
                            if status < 300 { let mut entry = body.clone(); entry["patientId"] = json!("patient-a"); entry["version"] = json!(1);
                                entries.insert(body["id"].as_str().unwrap().into(), entry); }
                            json!({"id":body["id"], "version":1})
                        }
                        "POST /api/auth/native/logout" => json!({"success":true}),
                        value if value.starts_with("GET /api/v1/network/patients/patient-a/entries/") => {
                            let id = value.rsplit('/').next().unwrap();
                            entries.get(id).cloned().unwrap_or_else(|| { status = 404; json!({}) })
                        }
                        _ => panic!("unexpected synthetic UI route: {route}"),
                    }.to_string();
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
                next_write,
                stop,
                worker: Some(worker),
            }
        }
        fn writes(&self) -> Vec<Value> {
            self.requests
                .lock()
                .unwrap()
                .iter()
                .filter(|(route, _)| route == "POST /api/v1/network/patients/patient-a/entries")
                .map(|(_, body)| body.clone())
                .collect()
        }
    }
    impl Drop for SyntheticHost {
        fn drop(&mut self) {
            self.session.lock();
            self.stop.store(true, Ordering::Release);
            let _ = TcpStream::connect(self.socket);
            if let Some(worker) = self.worker.take() {
                worker.join().unwrap();
            }
        }
    }
    fn enter_scales(
        view: &Entity<ClinicalApp>,
        host: &SyntheticHost,
        cx: &mut gpui::VisualTestContext,
    ) {
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.area = Area::Scales;
            app.load_scales(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(app.scales.catalog.ready().is_some());
            app.select_patient("patient-a", true, cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert_eq!(app.patient.detail.ready().unwrap().version, 7);
        });
    }
    fn prepare(view: &Entity<ClinicalApp>, cx: &mut gpui::VisualTestContext) {
        view.update(cx, |app, cx| {
            app.open_scale_form(ScaleId::Adl, cx);
            app.review_scale(cx);
            assert!(
                app.form.as_ref().unwrap().state == FormState::Draft,
                "missing answers cannot prepare"
            );
            app.choose_scale_answer(0, 1, cx);
            app.review_scale(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            let form = app.form.as_ref().unwrap();
            assert!(form.state == FormState::Review);
            assert!(form.scale.as_ref().unwrap().attempt.is_none());
            assert_eq!(
                form.scale
                    .as_ref()
                    .unwrap()
                    .prepared
                    .as_ref()
                    .unwrap()
                    .submission()
                    .metadata
                    .score
                    .as_u64(),
                Some(97)
            );
        });
    }

    fn catalog_text_ids(cx: &mut gpui::VisualTestContext) -> Vec<gpui::GlobalElementId> {
        rendered_command::take_text_nodes();
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        let nodes = rendered_command::take_text_nodes();
        let count = ScaleId::ALL.len();
        assert!(count >= 3);
        assert_eq!(
            nodes.len(),
            count * 3,
            "all catalog texts remain accessible"
        );
        let mut ids = HashSet::new();
        for (id, node) in &nodes {
            assert_eq!(node.role(), Role::Label);
            assert!(node.value().is_some_and(|value| !value.is_empty()));
            assert!(
                ids.insert(id.clone()),
                "duplicate accessible text ID: {id:?}, {node:?}"
            );
        }
        nodes.into_iter().map(|(id, _)| id).collect()
    }

    #[gpui::test]
    fn scale_review_answers_accessible_ids(cx: &mut gpui::TestAppContext) {
        let mut catalog = catalog_wire();
        let questions = catalog["scales"][0]["questions"].as_array_mut().unwrap();
        let mut second = questions[0].clone();
        second["id"] = json!("synthetic-second");
        questions.push(second);
        let host = SyntheticHost::with_catalog(catalog);
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        enter_scales(&view, &host, cx);
        view.update(cx, |app, cx| {
            app.open_scale_form(ScaleId::Adl, cx);
            app.choose_scale_answer(0, 1, cx);
            app.move_scale_question(true, cx);
            app.choose_scale_answer(1, 0, cx);
            app.review_scale(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.form.as_ref().unwrap().state == FormState::Review);
        });
        rendered_command::take_text_nodes();
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        let nodes = rendered_command::take_text_nodes();
        assert_eq!(
            nodes.len(),
            4,
            "both questions and answers remain accessible"
        );
        let mut ids = HashSet::new();
        for (id, node) in nodes {
            assert_eq!(node.role(), Role::Label);
            assert!(node.value().is_some_and(|value| !value.is_empty()));
            assert!(
                ids.insert(id.clone()),
                "duplicate accessible text ID: {id:?}"
            );
        }
    }

    #[gpui::test]
    fn scale_catalog_accessible_text_ids_are_unique_and_stable(cx: &mut gpui::TestAppContext) {
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        enter_scales(&view, &host, cx);
        let before = catalog_text_ids(cx);
        assert_eq!(before, catalog_text_ids(cx), "IDs survive redraw");
        view.update(cx, |app, cx| {
            if let Load::Ready(catalog) = &mut app.scales.catalog {
                catalog.scales.reverse();
            }
            cx.notify();
        });
        let after = catalog_text_ids(cx);
        let expected: Vec<_> = before
            .as_chunks::<3>()
            .0
            .iter()
            .rev()
            .flatten()
            .cloned()
            .collect();
        assert_eq!(after, expected, "IDs follow instruments when reordered");
    }

    #[gpui::test]
    fn scale_verified_result_returns_to_catalog_with_unique_accessible_text_ids(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        enter_scales(&view, &host, cx);
        prepare(&view, cx);
        view.update(cx, |app, cx| app.confirm_scale(cx));
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.form.is_none());
            assert!(
                app.verified
                    .as_ref()
                    .unwrap()
                    .contains("riletta integralmente")
            );
            assert!(app.area == Area::Scales);
        });
        assert_eq!(host.writes().len(), 1);
        catalog_text_ids(cx);
    }

    #[gpui::test]
    fn threshold_scale_retry_commands_fit_and_menu_is_keyboard_operable(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(bind_keys);
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        enter_scales(&view, &host, cx);
        prepare(&view, cx);
        host.next_write.store(403, Ordering::Release);
        view.update(cx, |app, cx| app.confirm_scale(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| app.reread_scale(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(
                app.form
                    .as_ref()
                    .unwrap()
                    .scale
                    .as_ref()
                    .unwrap()
                    .retry_ready()
            );
            app.text_scale = 4.;
            cx.notify();
        });
        cx.simulate_resize(gpui::size(px(390.), px(700.)));
        for _ in 0..8 {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                window.simulate_next_frame(cx);
            });
            cx.run_until_parked();
        }
        for body in [14., 16.] {
            cx.simulate_resize(gpui::size(px(390.), px(640.)));
            view.update(cx, |app, cx| {
                app.test_body_size = Some(body);
                cx.notify();
            });
            super::super::notes_recovery_tests::draw(cx);
            super::super::notes_recovery_tests::assert_minimum_geometry(&view, cx, "Scale", body);
        }
        view.update(cx, |app, cx| {
            app.test_body_size = None;
            cx.notify();
        });
        cx.simulate_resize(gpui::size(px(390.), px(700.)));
        super::super::notes_recovery_tests::draw(cx);
        let bar = cx.debug_bounds("threshold-bar").unwrap();
        let content = cx.debug_bounds("threshold-scroll").unwrap();
        assert!(
            bar.top() >= px(0.) && bar.bottom() <= px(700.),
            "bar={bar:?} content={content:?}"
        );
        let minimum_content =
            view.read_with(cx, |app, _| px(app.theme.role(TypeRole::Body).line_height));
        assert!(content.size.height >= minimum_content && content.bottom() <= bar.top());
        for id in ["clinical-workspace-reconcile", "threshold-other-actions"] {
            let command = cx.debug_bounds(id).expect("rendered command");
            assert!(
                command.top() >= bar.top()
                    && command.bottom() <= bar.bottom()
                    && command.left() >= px(0.)
                    && command.right() <= px(390.)
            );
        }
        view.read_with(cx, |app, _| {
            assert_eq!(app.threshold_mode.get(), ThresholdMode::Compact)
        });
        assert!(
            cx.debug_bounds("clinical-scale-review-retry").is_none(),
            "secondary action only in menu"
        );
        cx.update(|window, cx| {
            let focus = view.read(cx).form_actions[7].focus.clone();
            window.focus(&focus, cx)
        });
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        cx.simulate_keystrokes("shift-tab");
        cx.update(|window, cx| {
            assert!(
                view.read(cx).threshold_menu_focus.is_focused(window),
                "Tab reaches Altre azioni"
            )
        });
        cx.simulate_keystrokes("enter");
        cx.simulate_event(gpui::KeyUpEvent {
            keystroke: gpui::Keystroke::parse("enter").unwrap(),
        });
        cx.run_until_parked();
        for _ in 0..4 {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            });
            cx.run_until_parked();
        }
        let menu = cx
            .debug_bounds("threshold-other-actions-menu")
            .expect("keyboard opens menu");
        assert!(menu.top() >= px(0.) && menu.bottom() <= px(700.));
        let minimum = view.read_with(cx, |app, _| {
            px(app.theme.role(TypeRole::Strong).line_height + 16.)
        });
        for id in [
            "clinical-workspace-copy-draft",
            "clinical-scale-close-draft",
            "clinical-scale-review-retry",
        ] {
            let item = cx.debug_bounds(id).expect("secondary command in menu");
            assert!(
                item.size.height >= minimum,
                "menu must not shrink text into overlapping rows: {item:?}"
            );
        }
        for _ in 0..2 {
            cx.simulate_keystrokes("tab");
            for _ in 0..4 {
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                    window.simulate_next_frame(cx);
                });
                cx.run_until_parked();
            }
        }
        cx.update(|window, cx| {
            assert!(
                view.read(cx).threshold_menu_targets[2]
                    .focus
                    .is_focused(window),
                "Tab reaches retry"
            )
        });
        let retry = cx.debug_bounds("clinical-scale-review-retry").unwrap();
        assert!(
            retry.top() >= menu.top() && retry.bottom() <= menu.bottom(),
            "menu scroll reveals focused action: {retry:?} in {menu:?}"
        );
        cx.simulate_keystrokes("escape");
        cx.run_until_parked();
        cx.update(|window, cx| {
            assert!(!view.read(cx).threshold_menu_open.get());
            assert!(view.read(cx).threshold_menu_focus.is_focused(window));
            {
                let focus = view.read(cx).form_actions[7].focus.clone();
                window.focus(&focus, cx)
            };
        });
        let before = host.requests.lock().unwrap().len();
        cx.simulate_keystrokes("enter");
        cx.simulate_event(gpui::KeyUpEvent {
            keystroke: gpui::Keystroke::parse("enter").unwrap(),
        });
        cx.run_until_parked();
        assert!(
            host.requests.lock().unwrap().len() > before,
            "primary activation rereads"
        );
        assert_eq!(host.writes().len(), 1, "no second write");
    }

    #[gpui::test]
    fn scales_gpui_two_gestures_denial_reconcile_and_explicit_identical_retry_use_real_transport(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        enter_scales(&view, &host, cx);
        prepare(&view, cx);
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        let row = cx.debug_bounds("clinical-scale-score").unwrap();
        let meaning = cx.debug_bounds("clinical-scale-score-meaning").unwrap();
        let number = cx.debug_bounds("clinical-scale-score-number").unwrap();
        assert!(meaning.right() <= number.left());
        assert!(number.top() < meaning.bottom() && meaning.top() < number.bottom());
        assert!(row.top() <= meaning.top() && row.bottom() >= number.bottom());
        assert!(host.writes().is_empty());
        view.update(cx, |app, cx| app.confirm_scale(cx));
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.form.is_none());
            assert!(
                app.verified
                    .as_ref()
                    .unwrap()
                    .contains("riletta integralmente")
            );
        });
        assert_eq!(host.writes().len(), 1);

        prepare(&view, cx);
        view.update(cx, |app, cx| {
            app.cancel_scale_review(cx);
            app.choose_scale_answer(0, 0, cx);
            app.confirm_scale(cx);
            assert!(app.form.as_ref().unwrap().state == FormState::Draft);
            assert!(
                app.form
                    .as_ref()
                    .unwrap()
                    .scale
                    .as_ref()
                    .unwrap()
                    .prepared
                    .is_none()
            );
            app.review_scale(cx);
        });
        cx.run_until_parked();
        assert_eq!(
            host.writes().len(),
            1,
            "editing invalidates review without writing"
        );
        host.next_write.store(403, Ordering::Release);
        view.update(cx, |app, cx| app.confirm_scale(cx));
        cx.run_until_parked();
        let retained_id = view.read_with(cx, |app, _| {
            let form = app.form.as_ref().unwrap();
            let scale = form.scale.as_ref().unwrap();
            assert!(form.state == FormState::Uncertain);
            assert!(app.verified.is_none());
            assert_eq!(scale.answers["synthetic-choice"].as_u64(), Some(0));
            scale.attempt.as_ref().unwrap().id().to_owned()
        });
        view.update(cx, |app, cx| {
            app.confirm_scale(cx);
            app.reread_scale(cx);
        });
        cx.run_until_parked();
        assert_eq!(
            host.writes().len(),
            2,
            "reread and blocked confirmation do not retry"
        );
        view.update(cx, |app, cx| {
            assert!(
                app.form
                    .as_ref()
                    .unwrap()
                    .scale
                    .as_ref()
                    .unwrap()
                    .retry_ready()
            );
            app.review_scale_retry(cx);
            assert_eq!(
                app.form
                    .as_ref()
                    .unwrap()
                    .scale
                    .as_ref()
                    .unwrap()
                    .attempt
                    .as_ref()
                    .unwrap()
                    .id(),
                retained_id
            );
        });
        assert_eq!(
            host.writes().len(),
            2,
            "review of a retry is also read-only"
        );
        view.update(cx, |app, cx| app.confirm_scale(cx));
        cx.run_until_parked();
        let writes = host.writes();
        assert_eq!(writes.len(), 3);
        assert_eq!(writes[1], writes[2]);
        view.read_with(cx, |app, _| {
            assert!(app.form.is_none());
            assert!(app.verified.is_some());
        });

        prepare(&view, cx);
        host.next_write.store(401, Ordering::Release);
        let date_editor = view.update(cx, |app, cx| {
            let editor = app.form.as_ref().unwrap().fields[0].editor.clone();
            app.confirm_scale(cx);
            editor
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.session.is_none() && app.form.is_none());
            assert!(app.patient.detail.ready().is_none());
            assert!(
                app.message
                    .as_ref()
                    .unwrap()
                    .0
                    .starts_with("Salvataggio della valutazione non verificato.")
            );
        });
        date_editor.read_with(cx, |input, _| assert!(input.value().is_empty()));
    }
}
impl ScaleArea {
    pub(super) fn new(scroll: &ScrollHandle, theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let search = cx.new(|cx| {
            TextInput::new(
                "clinical-scale-search",
                "Cerca la persona",
                "Nome o codice fiscale",
                false,
                theme,
                cx,
            )
        });
        let subscription = cx.subscribe(&search, |this, input, _: &InputChanged, cx| {
            this.scales.query = input.read(cx).value().to_owned();
            cx.notify();
        });
        Self {
            catalog: Load::Idle,
            patients: Load::Idle,
            search,
            query: String::new(),
            search_target: ScrollTarget::new(scroll, cx),
            targets: HashMap::new(),
            _subscription: subscription,
        }
    }
    pub(super) fn reset(&mut self, cx: &mut App) {
        self.catalog = Load::Idle;
        self.patients = Load::Idle;
        self.query.clear();
        self.targets.clear();
        self.search
            .update(cx, |input, cx| input.set_content("", cx));
    }
    pub(super) fn prepare_render(&mut self, theme: Theme, _window: &mut Window, cx: &mut App) {
        self.search
            .update(cx, |input, cx| input.configure(theme, false, cx));
    }
    pub(super) fn reveal_if_focused(&self, window: &mut Window, cx: &mut App) -> bool {
        self.search_target.reveal_if_focused(window, cx)
            || self
                .targets
                .values()
                .any(|target| target.reveal_if_focused(window, cx))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Working {
    Prepare,
    Save,
    Read,
}

pub(super) struct ScaleAssessment {
    catalog: ScaleCatalog,
    descriptor: ScaleDescriptor,
    answers: ScaleAnswers,
    question: usize,
    patient_id: String,
    scope: String,
    patient_version: u64,
    intent: ProfileQueryIntent,
    prepared: Option<PreparedScale>,
    reviewed_fields: Option<Vec<String>>,
    attempt: Option<ScaleEntryAttempt>,
    retry_ready: bool,
    working: Option<Working>,
    question_target: ScrollTarget,
    option_targets: Vec<ScrollTarget>,
    step_targets: [ScrollTarget; 2],
    focus_question: bool,
}
impl ScaleAssessment {
    fn new(
        catalog: ScaleCatalog,
        descriptor: ScaleDescriptor,
        patient: &PatientDetail,
        scope: String,
        intent: ProfileQueryIntent,
        scroll: &ScrollHandle,
        cx: &App,
    ) -> Self {
        let option_count = descriptor
            .questions
            .iter()
            .map(|question| question.options.len())
            .max()
            .unwrap_or(0);
        let mut question_target = ScrollTarget::new(scroll, cx);
        question_target.focus = question_target.focus.tab_stop(false);
        Self {
            catalog,
            descriptor,
            answers: ScaleAnswers::new(),
            question: 0,
            patient_id: patient.id.clone(),
            scope,
            patient_version: patient.version,
            intent,
            prepared: None,
            reviewed_fields: None,
            attempt: None,
            retry_ready: false,
            working: None,
            question_target,
            option_targets: (0..option_count)
                .map(|_| ScrollTarget::new(scroll, cx))
                .collect(),
            step_targets: std::array::from_fn(|_| ScrollTarget::new(scroll, cx)),
            focus_question: true,
        }
    }
    pub(super) fn retire(&self) {
        self.intent.cancel();
    }
    pub(super) fn has_attempt(&self) -> bool {
        self.attempt.is_some()
    }
    pub(super) fn is_working(&self) -> bool {
        self.working.is_some()
    }
    pub(super) fn is_preparing(&self) -> bool {
        self.working == Some(Working::Prepare)
    }
    pub(super) fn is_reading(&self) -> bool {
        self.working == Some(Working::Read)
    }
    pub(super) fn can_prepare(&self) -> bool {
        self.complete() && !self.is_working() && !self.has_attempt()
    }
    pub(super) fn retry_ready(&self) -> bool {
        self.retry_ready && self.attempt.is_some() && self.working.is_none()
    }
    fn complete(&self) -> bool {
        self.descriptor.accepts_answers(&self.answers)
    }
    fn invalidate_review(&mut self) {
        self.prepared = None;
        self.reviewed_fields = None;
        self.retry_ready = false;
    }
    pub(super) fn prepare_render(&mut self, window: &mut Window, cx: &mut App) {
        if std::mem::take(&mut self.focus_question) {
            window.focus(&self.question_target.focus, cx);
            self.question_target.scroll_to(window, cx);
        }
    }
    pub(super) fn reveal_if_focused(&self, window: &mut Window, cx: &mut App) -> bool {
        self.option_targets
            .iter()
            .chain(self.step_targets.iter())
            .any(|target| target.reveal_if_focused(window, cx))
    }
    pub(super) fn copy_text(&self) -> String {
        let mut lines = vec![
            "Valutazione · salvataggio non verificato".into(),
            self.descriptor.title.clone(),
        ];
        for question in &self.descriptor.questions {
            let answer = self
                .answers
                .get(&question.id)
                .and_then(|value| {
                    question
                        .options
                        .iter()
                        .find(|choice| choice.value == *value)
                })
                .map(|choice| choice.label.as_str())
                .unwrap_or("Risposta non inserita");
            lines.push(format!("{}\n{answer}", question.text));
        }
        if let Some(prepared) = &self.prepared {
            lines.push(prepared.submission().content.clone());
        }
        if let Some(attempt) = &self.attempt {
            lines.push(format!(
                "Identificativo della voce da verificare: {}",
                attempt.id()
            ));
        }
        lines.join("\n\n")
    }
}

impl ClinicalApp {
    pub(super) fn load_scales(&mut self, cx: &mut Context<Self>) {
        if self.form.is_some() {
            return;
        }
        // Retire the abandoned area even when no session/scope can start a new
        // read; its late authentication result cannot affect this destination.
        self.next_epoch();
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            return;
        };
        self.retire_profile_selection();
        self.selected_id = None;
        self.patient = PatientData::default();
        self.core = Workspace::default();
        self.scales.reset(cx);
        self.scales.catalog = Load::Loading;
        self.scales.patients = Load::Loading;
        self.run(
            move || {
                Ok((
                    session.read_scale_catalog(&scope)?,
                    session.list_patients(&scope, false)?,
                ))
            },
            |this, result, cx| match result {
                Ok((catalog, patients)) => {
                    for id in patients
                        .iter()
                        .map(|patient| format!("patient-{}", patient.id))
                        .chain(
                            catalog
                                .scales
                                .iter()
                                .map(|scale| format!("scale-{}", scale.id.as_str())),
                        )
                        .chain(["reload".into(), "clear".into()])
                    {
                        this.scales
                            .targets
                            .insert(id, ScrollTarget::new(&this.area_scroll, cx));
                    }
                    this.scales.catalog = Load::Ready(catalog);
                    this.scales.patients = Load::Ready(patients);
                }
                Err(error) => {
                    this.scales.catalog = Load::Failed(ui_error(error));
                    this.scales.patients = Load::Failed(ui_error(error));
                }
            },
            cx,
        );
        cx.notify();
    }

    fn open_scale_form(&mut self, id: ScaleId, cx: &mut Context<Self>) {
        if self.form.is_some() || self.area != Area::Scales {
            return;
        }
        let (Some(_), Some(scope), Some(patient), Some(catalog)) = (
            self.session.clone(),
            self.scope.clone(),
            self.patient.detail.ready().cloned(),
            self.scales.catalog.ready().cloned(),
        ) else {
            return;
        };
        if patient.is_archived
            || patient.deleted_at.is_some()
            || self.selected_id.as_deref() != Some(&patient.id)
        {
            return;
        }
        let Some(descriptor) = catalog.descriptor(id).cloned() else {
            return;
        };
        self.next_epoch();
        let session = self.session.as_ref().expect("active session").clone();
        let intent = session.profile_query_intent();
        let fields = vec![
            Field::new(
                "clinical-scale-date",
                "Data della valutazione · AAAA-MM-GG",
                &chrono::Local::now().format("%Y-%m-%d").to_string(),
                false,
                false,
                self.theme,
                cx,
            )
            .with_scroll(&self.profile_scroll, cx),
        ];
        let subscriptions = fields
            .iter()
            .map(|field| {
                cx.subscribe(&field.editor, |this, _, _: &InputChanged, cx| {
                    if let Some(form) = &mut this.form
                        && let Some(scale) = &mut form.scale
                        && !scale.has_attempt()
                        && !scale.is_working()
                    {
                        scale.invalidate_review();
                        form.state = FormState::Draft;
                        this.verified = None;
                        cx.notify();
                    }
                })
            })
            .collect();
        let scale = ScaleAssessment::new(
            catalog,
            descriptor,
            &patient,
            scope,
            intent,
            &self.profile_scroll,
            cx,
        );
        self.form = Some(Form {
            kind: FormKind::Scale,
            fields,
            scale: Some(scale),
            upload: None,
            edit: None,
            patient_original: None,
            created_id: None,
            therapy: None,
            state: FormState::Draft,
            _subscriptions: subscriptions,
        });
        self.message = None;
        self.verified = None;
        self.discard = None;
        self.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
        cx.notify();
    }

    fn choose_scale_answer(
        &mut self,
        question_index: usize,
        option_index: usize,
        cx: &mut Context<Self>,
    ) {
        let Some(form) = &mut self.form else {
            return;
        };
        if form.state != FormState::Draft || self.discard.is_some() {
            return;
        }
        let Some(scale) = &mut form.scale else {
            return;
        };
        if scale.is_working() || scale.has_attempt() || scale.question != question_index {
            return;
        }
        let Some(question) = scale.descriptor.questions.get(question_index) else {
            return;
        };
        let Some(choice) = question.options.get(option_index) else {
            return;
        };
        scale
            .answers
            .insert(question.id.clone(), choice.value.clone());
        scale.invalidate_review();
        self.message = None;
        self.verified = None;
        cx.notify();
    }

    fn move_scale_question(&mut self, forward: bool, cx: &mut Context<Self>) {
        let Some(form) = &mut self.form else {
            return;
        };
        if form.state != FormState::Draft || self.discard.is_some() {
            return;
        }
        let Some(scale) = &mut form.scale else {
            return;
        };
        if scale.is_working() || scale.has_attempt() {
            return;
        }
        if forward {
            let Some(question) = scale.descriptor.questions.get(scale.question) else {
                return;
            };
            if !scale.answers.contains_key(&question.id)
                || scale.question + 1 >= scale.descriptor.questions.len()
            {
                return;
            }
            scale.question += 1;
        } else {
            scale.question = scale.question.saturating_sub(1);
        }
        scale.focus_question = true;
        cx.notify();
    }

    pub(super) fn review_scale(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &self.form else {
            return;
        };
        let Some(scale) = &form.scale else {
            return;
        };
        if form.state != FormState::Draft
            || scale.is_working()
            || scale.has_attempt()
            || self.discard.is_some()
        {
            return;
        }
        let values: Vec<_> = form.fields.iter().map(|field| field.value(cx)).collect();
        if values.len() != 1 || date_for_write(&values[0]).is_err() || !scale.complete() {
            self.message = Some(("Completa ogni risposta e indica una data valida prima di preparare la valutazione.".into(), true));
            cx.notify();
            return;
        }
        let Some(session) = self.session.clone() else {
            return;
        };
        if self.scope.as_deref() != Some(&scale.scope)
            || self.selected_id.as_deref() != Some(&scale.patient_id)
        {
            return;
        }
        let request = match ScalePreparationRequest::new(
            &scale.catalog,
            scale.descriptor.id,
            scale.answers.clone(),
            scale.patient_version,
        ) {
            Ok(request) => request,
            Err(error) => {
                self.message = Some((ui_error(error), true));
                cx.notify();
                return;
            }
        };
        let scope = scale.scope.clone();
        let id = scale.patient_id.clone();
        let intent = scale.intent.clone();
        let scale = self
            .form
            .as_mut()
            .and_then(|form| form.scale.as_mut())
            .expect("scale form");
        scale.invalidate_review();
        scale.working = Some(Working::Prepare);
        scale.reviewed_fields = Some(values);
        self.message = None;
        self.run(
            move || session.prepare_scale(&scope, &id, &intent, &request),
            Self::receive_scale_preparation,
            cx,
        );
        cx.notify();
    }

    fn receive_scale_preparation(
        &mut self,
        result: Result<PreparedScale, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        let Some(form) = &mut self.form else {
            return;
        };
        let Some(scale) = &mut form.scale else {
            return;
        };
        if scale.working != Some(Working::Prepare) {
            return;
        }
        scale.working = None;
        match result {
            Ok(prepared)
                if self.selected_id.as_deref() == Some(&scale.patient_id)
                    && self.scope.as_deref() == Some(&scale.scope)
                    && scale.reviewed_fields.as_ref().is_some_and(|values| {
                        *values
                            == form
                                .fields
                                .iter()
                                .map(|field| field.value(cx))
                                .collect::<Vec<_>>()
                    }) =>
            {
                scale.prepared = Some(prepared);
                form.state = FormState::Review;
                self.message = None;
                self.focus_after_render = true;
            }
            Ok(_) => {
                scale.invalidate_review();
                form.state = FormState::Rejected;
                self.message = Some((
                    "Il contesto della bozza è cambiato. Rileggi prima di prepararla nuovamente."
                        .into(),
                    true,
                ));
            }
            Err(error) => {
                scale.invalidate_review();
                form.state = if error.is_conflict() {
                    FormState::Conflict
                } else {
                    FormState::Rejected
                };
                self.message = Some((
                    format!(
                        "{} La valutazione non è stata registrata. Le risposte restano in questa finestra; rileggi il contesto prima di riprendere.",
                        ui_error(error)
                    ),
                    true,
                ));
            }
        }
        cx.notify();
    }

    pub(super) fn cancel_scale_review(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &mut self.form else {
            return;
        };
        let Some(scale) = &mut form.scale else {
            return;
        };
        if form.state != FormState::Review || scale.is_working() {
            return;
        }
        if scale.has_attempt() {
            form.state = FormState::Uncertain;
        } else {
            scale.invalidate_review();
            form.state = FormState::Draft;
            scale.focus_question = true;
        }
        cx.notify();
    }

    pub(super) fn confirm_scale(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &self.form else {
            return;
        };
        let Some(scale) = &form.scale else {
            return;
        };
        if form.state != FormState::Review || scale.is_working() || self.discard.is_some() {
            return;
        }
        if !self.can_write(FormKind::Scale) {
            self.message = Some(("Il dispositivo deve poter scrivere e rileggere il Diario. Chiedi all’amministratore di abilitarlo sull’host.".into(), true));
            cx.notify();
            return;
        }
        let Some(session) = self.session.clone() else {
            return;
        };
        if self.scope.as_deref() != Some(&scale.scope)
            || self.selected_id.as_deref() != Some(&scale.patient_id)
        {
            return;
        }
        let attempt = if let Some(attempt) = &scale.attempt {
            if !scale.retry_ready {
                return;
            }
            attempt.clone()
        } else {
            let values: Vec<_> = form.fields.iter().map(|field| field.value(cx)).collect();
            if scale.reviewed_fields.as_ref() != Some(&values) {
                return;
            }
            let Some(prepared) = &scale.prepared else {
                return;
            };
            let date = match values
                .first()
                .ok_or_else(|| "Data mancante".to_owned())
                .and_then(|date| date_for_write(date))
            {
                Ok(date) => date,
                Err(message) => {
                    self.message = Some((message, true));
                    cx.notify();
                    return;
                }
            };
            match session.seal_scale_entry(prepared, &date, Some("ambulatory")) {
                Ok(attempt) => attempt,
                Err(error) => {
                    self.scale_save_failure(error, cx);
                    return;
                }
            }
        };
        // The form owns the exact sealed attempt before the first network send.
        let form = self.form.as_mut().expect("scale form");
        let scale = form.scale.as_mut().expect("assessment");
        scale.attempt = Some(attempt.clone());
        scale.retry_ready = false;
        scale.working = Some(Working::Save);
        form.state = FormState::Saving;
        self.message = None;
        self.next_presentation_epoch();
        self.run(
            move || session.create_scale_entry(&attempt),
            Self::receive_scale_readback,
            cx,
        );
        cx.notify();
    }

    pub(super) fn review_scale_retry(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &mut self.form else {
            return;
        };
        let Some(scale) = &form.scale else {
            return;
        };
        if !scale.retry_ready()
            || !matches!(
                form.state,
                FormState::Uncertain | FormState::Rejected | FormState::Conflict
            )
        {
            return;
        }
        form.state = FormState::Review;
        self.message = Some(("Riprova della stessa voce: identificativo, data e contenuto restano quelli del primo invio. È richiesta una nuova conferma.".into(), false));
        cx.notify();
    }

    pub(super) fn reread_scale(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &mut self.form else {
            return;
        };
        let Some(scale) = &mut form.scale else {
            return;
        };
        if scale.is_working() {
            return;
        }
        let Some(session) = self.session.clone() else {
            return;
        };
        if let Some(attempt) = scale.attempt.clone() {
            scale.working = Some(Working::Read);
            scale.retry_ready = false;
            form.state = FormState::Saving;
            self.next_presentation_epoch();
            self.message = None;
            self.run(
                move || session.read_scale_entry(&attempt),
                Self::receive_scale_readback,
                cx,
            );
        } else {
            scale.invalidate_review();
            scale.working = Some(Working::Read);
            form.state = FormState::Rejected;
            let id = scale.patient_id.clone();
            let scope = scale.scope.clone();
            scale.intent.cancel();
            scale.intent = session.profile_query_intent();
            let intent = scale.intent.clone();
            self.next_presentation_epoch();
            self.message = None;
            self.run(
                move || {
                    Ok((
                        session.open_patient_profile(&scope, &id, &intent)?,
                        session.read_scale_catalog(&scope)?,
                    ))
                },
                |this, result, cx| this.receive_scale_context(result, cx),
                cx,
            );
        }
        cx.notify();
    }

    fn receive_scale_context(
        &mut self,
        result: Result<(PatientDetail, ScaleCatalog), RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        let Some(form) = &mut self.form else {
            return;
        };
        let Some(scale) = &mut form.scale else {
            return;
        };
        if scale.working != Some(Working::Read) || scale.has_attempt() {
            return;
        }
        scale.working = None;
        match result {
            Ok((patient, catalog))
                if !patient.is_archived
                    && patient.deleted_at.is_none()
                    && patient.id == scale.patient_id
                    && self.selected_id.as_deref() == Some(&scale.patient_id)
                    && self.scope.as_deref() == Some(&scale.scope) =>
            {
                let same_descriptor =
                    catalog.descriptor(scale.descriptor.id) == Some(&scale.descriptor);
                scale.patient_version = patient.version;
                self.patient.detail = ReadLoad::Ready(patient);
                if same_descriptor {
                    scale.catalog = catalog;
                    form.state = FormState::Draft;
                    self.message = Some(("Scheda e catalogo riletti. Le risposte sono conservate; prepara una nuova valutazione prima di confermare.".into(), false));
                } else {
                    form.state = FormState::Rejected;
                    self.message = Some(("Il questionario è cambiato. Copia le risposte se servono, poi riapri lo strumento dal catalogo aggiornato.".into(), true));
                }
            }
            Ok(_) | Err(RuntimeError::Forbidden | RuntimeError::Missing) => {
                self.retire_form(cx);
                self.retire_profile_selection();
                self.selected_id = None;
                self.patient = PatientData::default();
                self.core = Workspace::default();
                self.message = Some(("La scheda non è più disponibile per questa valutazione. La bozza è stata ritirata.".into(), true));
            }
            Err(error) => {
                form.state = FormState::Rejected;
                self.message = Some((
                    format!(
                        "{} Nessuna nuova valutazione può essere confermata; le risposte sono conservate.",
                        ui_error(error)
                    ),
                    true,
                ));
            }
        }
        cx.notify();
    }

    fn receive_scale_readback(
        &mut self,
        result: Result<ScaleEntryReadback, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        let Some(form) = &mut self.form else {
            return;
        };
        let Some(scale) = &mut form.scale else {
            return;
        };
        if !matches!(scale.working, Some(Working::Save | Working::Read)) || !scale.has_attempt() {
            return;
        }
        scale.working = None;
        match result {
            Ok(ScaleEntryReadback::Verified(row)) => {
                self.patient.entries = ReadLoad::Ready(vec![row]);
                self.saved(
                    "Valutazione registrata e riletta integralmente dal Diario.",
                    cx,
                );
            }
            Ok(ScaleEntryReadback::NotFound) => {
                form.state = FormState::Uncertain;
                scale.retry_ready = true;
                self.message = Some(("La voce non è presente nella rilettura attuale. Questo non esclude un invio ancora in corso. Puoi rileggere o confermare esplicitamente la ripetizione della stessa voce.".into(), true));
            }
            Ok(ScaleEntryReadback::Different(_)) => {
                form.state = FormState::Uncertain;
                scale.retry_ready = false;
                self.message = Some(("La rilettura non coincide con tutti i dati inviati. Verifica il Diario; la bozza è conservata e non verrà inviata automaticamente.".into(), true));
            }
            Err(error) => self.scale_save_failure(error, cx),
        }
        cx.notify();
    }

    fn scale_save_failure(&mut self, error: RuntimeError, cx: &mut Context<Self>) {
        let Some(form) = &mut self.form else {
            return;
        };
        let Some(scale) = &mut form.scale else {
            return;
        };
        scale.working = None;
        scale.retry_ready = false;
        let has_attempt = scale.has_attempt();
        if !has_attempt {
            scale.invalidate_review();
        }
        form.state = if error.is_conflict() {
            FormState::Conflict
        } else if has_attempt {
            FormState::Uncertain
        } else {
            FormState::Rejected
        };
        self.message = Some((
            format!(
                "{} {} Le risposte sono conservate; rileggi prima di un nuovo invio.",
                if has_attempt {
                    "Salvataggio della valutazione non verificato."
                } else {
                    "Valutazione non registrata."
                },
                ui_error(error)
            ),
            true,
        ));
        cx.notify();
    }

    pub(super) fn scales_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div().min_w_0().max_w_full().flex().flex_col().gap(px(24.))
            .child(heading("clinical-scales-heading", "Scale", theme))
            .child(div().text_color(theme.secondary).child(text!("Scegli una persona e uno strumento. Il risultato resta una bozza finché non lo rivedi e confermi nel Diario.")))
            .child(button("clinical-scales-reload", "Rileggi catalogo e persone", theme, false, !matches!(self.scales.catalog, Load::Loading))
                .when(!matches!(self.scales.catalog, Load::Loading), |el| el.on_click(cx.listener(|this, _, _, cx| this.load_scales(cx)))))
            .when(self.verified.is_some(), |el| el.child(notice("clinical-scales-verified", self.verified.clone().unwrap_or_default(), theme, false)));
        if let Some(message) = self.scales.catalog.message() {
            return pane.child(notice(
                "clinical-scales-state",
                message.to_owned(),
                theme,
                matches!(self.scales.catalog, Load::Failed(_)),
            ));
        }
        if let Some(patient) = self.patient.detail.ready() {
            pane = pane.child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(section(
                                "clinical-scales-person-label",
                                "PERSONA SELEZIONATA",
                                theme,
                            ))
                            .child(
                                div()
                                    .type_role(theme, TypeRole::Strong)
                                    .child(text!(patient.display_name())),
                            )
                            .child(text!(format!(
                                "Nascita: {}",
                                display_date(patient.birth_date.as_deref())
                            ))),
                    )
                    .child(
                        button(
                            "clinical-scales-change-person",
                            "Cambia persona",
                            theme,
                            false,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.next_epoch();
                            this.retire_profile_selection();
                            this.selected_id = None;
                            this.patient = PatientData::default();
                            this.core = Workspace::default();
                            cx.notify();
                        })),
                    ),
            );
        } else {
            pane = pane
                .child(section(
                    "clinical-scales-choose-person",
                    "SCEGLI LA PERSONA",
                    theme,
                ))
                .child(
                    self.scales.search_target.attach_enabled(
                        div()
                            .id("clinical-scale-search-anchor")
                            .child(self.scales.search.clone()),
                        false,
                    ),
                )
                .when(
                    self.scales.patients.ready().is_some_and(|patients| {
                        !patients
                            .iter()
                            .any(|patient| patient.matches_query(&self.scales.query))
                    }),
                    |el| {
                        el.child(text!(
                            "Nessuna persona corrisponde alla ricerca nell’ambulatorio selezionato."
                        ))
                    },
                )
                .when(
                    matches!(
                        self.patient.detail,
                        ReadLoad::Loading { .. } | ReadLoad::Failed(_)
                    ),
                    |el| {
                        el.child(notice(
                            "clinical-scales-profile-state",
                            match &self.patient.detail {
                                ReadLoad::Failed(error) => ui_error(error),
                                _ => "Lettura in corso…".into(),
                            },
                            theme,
                            matches!(self.patient.detail, ReadLoad::Failed(_)),
                        ))
                    },
                )
                .children(
                    self.scales
                        .patients
                        .ready()
                        .into_iter()
                        .flatten()
                        .filter(|patient| patient.matches_query(&self.scales.query))
                        .map(|patient| {
                            let id = patient.id.clone();
                            let target = self.scales.targets.get(&format!("patient-{id}"));
                            let row = button(
                                format!("clinical-scale-patient-{id}"),
                                format!(
                                    "{} · {}",
                                    patient.display_name(),
                                    display_date(patient.birth_date.as_deref())
                                ),
                                theme,
                                false,
                                !matches!(self.patient.detail, ReadLoad::Loading { .. }),
                            );
                            row.when_some(target, |row, target| target.attach(row))
                                .when(
                                    !matches!(self.patient.detail, ReadLoad::Loading { .. }),
                                    |el| {
                                        el.on_click(cx.listener(move |this, _, _, cx| {
                                            this.select_patient(&id, true, cx)
                                        }))
                                    },
                                )
                        }),
                );
        }
        let selected = self
            .patient
            .detail
            .ready()
            .is_some_and(|patient| !patient.is_archived && patient.deleted_at.is_none());
        pane.child(section(
            "clinical-scales-catalog-label",
            "STRUMENTI DELL’ARCHIVIO",
            theme,
        ))
        .children(
            self.scales
                .catalog
                .ready()
                .into_iter()
                .flat_map(|catalog| &catalog.scales)
                .map(|scale| {
                    let id = scale.id;
                    div()
                        .id(SharedString::from(format!(
                            "clinical-scale-catalog-row-{}",
                            id.as_str()
                        )))
                        .min_w_0()
                        .max_w_full()
                        .border_t_1()
                        .border_color(theme.rule)
                        .pt(px(20.))
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .child(div().type_role(theme, TypeRole::Strong).child({
                            let text = text!(scale.title.clone());
                            #[cfg(test)]
                            let text = rendered_command::observe_text(text);
                            text
                        }))
                        .child(div().text_color(theme.secondary).child({
                            let text = text!(scale.description.clone());
                            #[cfg(test)]
                            let text = rendered_command::observe_text(text);
                            text
                        }))
                        .child({
                            let text = text!(format!(
                                "{} domande · tutte le risposte sono richieste",
                                scale.questions.len()
                            ));
                            #[cfg(test)]
                            let text = rendered_command::observe_text(text);
                            text
                        })
                        .child(
                            self.scales
                                .targets
                                .get(&format!("scale-{}", id.as_str()))
                                .expect("catalog target")
                                .attach_enabled(
                                    button(
                                        format!("clinical-scale-open-{}", id.as_str()),
                                        "Compila la valutazione",
                                        theme,
                                        true,
                                        selected,
                                    ),
                                    selected,
                                )
                                .when(selected, |el| {
                                    el.on_click(cx.listener(move |this, _, _, cx| {
                                        this.open_scale_form(id, cx)
                                    }))
                                }),
                        )
                }),
        )
    }

    pub(super) fn scale_workspace_view(&self, layout: Layout, cx: &Context<Self>) -> Stateful<Div> {
        let Some(form) = &self.form else {
            return div().id("clinical-scale-workspace-empty");
        };
        let Some(scale) = &form.scale else {
            return div().id("clinical-scale-workspace-empty");
        };
        let theme = self.theme;
        let editable = form.state == FormState::Draft
            && !scale.is_working()
            && !scale.has_attempt()
            && self.discard.is_none();
        let patient_context = format!(
            "{} · {}",
            self.patient
                .detail
                .ready()
                .map(PatientDetail::display_name)
                .unwrap_or_default(),
            self.ambulatories
                .ready()
                .into_iter()
                .flatten()
                .find(|scope| Some(&scope.id) == self.scope.as_ref())
                .map(|scope| scope.name.as_str())
                .unwrap_or("Ambulatorio selezionato")
        );
        let header = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(section(
                "clinical-scale-draft-label",
                if scale.prepared.is_some() {
                    "RIVEDI PRIMA DI REGISTRARE"
                } else {
                    "VALUTAZIONE · BOZZA"
                },
                theme,
            ))
            .child(heading(
                "clinical-scale-title",
                scale.descriptor.title.clone(),
                theme,
            ))
            .child(
                div()
                    .text_color(theme.secondary)
                    .child(text!(patient_context)),
            );
        let question = &scale.descriptor.questions[scale.question];
        let question_index = scale.question;
        let mut questions = div().min_w_0().flex_1().flex().flex_col().gap(px(16.));
        if scale.prepared.is_none() && !scale.has_attempt() {
            questions = questions.child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary)
                .child(text!(format!("Domanda {} di {} · {} risposte inserite", scale.question + 1, scale.descriptor.questions.len(), scale.answers.len()))))
                .child(scale.question_target.attach_enabled(heading("clinical-scale-question", question.text.clone(), theme).type_role(theme, TypeRole::Strong), false))
                .child(div().id("clinical-scale-options").role(Role::Group).aria_label(question.text.clone()).flex().flex_col().gap(px(8.))
                    .children(question.options.iter().enumerate().map(|(index, choice)| {
                        let selected = scale.answers.get(&question.id) == Some(&choice.value);
                        scale.option_targets[index].attach_enabled(button(format!("clinical-scale-option-{index}"), choice.label.clone(), theme, false, editable), editable)
                            .aria_selected(selected).when(selected, |el| el.bg(theme.selected).border_color(theme.fresh))
                            .when(editable, |el| el.on_click(cx.listener(move |this, _, _, cx| this.choose_scale_answer(question_index, index, cx))))
                    })))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .children([(false, "clinical-scale-previous", "Precedente", scale.question > 0),
                        (true, "clinical-scale-next", "Successiva", scale.answers.contains_key(&question.id) && scale.question + 1 < scale.descriptor.questions.len())]
                        .into_iter().enumerate().map(|(index, (forward, id, title, admitted))| {
                            scale.step_targets[index].attach_enabled(button(id, title, theme, false, editable && admitted), editable && admitted)
                                .when(editable && admitted, |el| el.on_click(cx.listener(move |this, _, _, cx| this.move_scale_question(forward, cx))))
                        })))
                .when(scale.complete(), |el| el.child(notice("clinical-scale-complete", "Tutte le risposte sono inserite. Prepara il risultato per rivederlo prima della registrazione.", theme, false)));
        } else {
            questions = questions
                .child(section(
                    "clinical-scale-answers-heading",
                    "RISPOSTE DA REGISTRARE",
                    theme,
                ))
                .children(scale.descriptor.questions.iter().map(|question| {
                    let label = scale
                        .answers
                        .get(&question.id)
                        .and_then(|answer| {
                            question
                                .options
                                .iter()
                                .find(|choice| choice.value == *answer)
                        })
                        .map(|choice| choice.label.clone())
                        .unwrap_or_else(|| "Risposta non inserita".into());
                    div()
                        .id(SharedString::from(format!(
                            "clinical-scale-answer-{}-{}",
                            scale.descriptor.id.as_str(),
                            question.id
                        )))
                        .border_b_1()
                        .border_color(theme.rule)
                        .pb(px(12.))
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child({
                            let text = text!(question.text.clone());
                            #[cfg(test)]
                            let text = crate::shell::rendered_command::observe_text(text);
                            text
                        })
                        .child(div().type_role(theme, TypeRole::Strong).child({
                            let text = text!(label);
                            #[cfg(test)]
                            let text = crate::shell::rendered_command::observe_text(text);
                            text
                        }))
                }));
        }
        questions = questions
            .children(form.fields.iter().enumerate().map(|(index, field)| {
                self.field_view(field, format!("clinical-scale-field-{index}"), cx)
            }))
            .child(
                div()
                    .type_role(theme, TypeRole::Meta)
                    .text_color(theme.secondary)
                    .child(text!(
                        "La voce viene registrata nel contesto ambulatoriale selezionato."
                    )),
            );
        let mut result = div()
            .min_w_0()
            .flex_1()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(section(
                "clinical-scale-result-heading",
                "RISULTATO E LIMITI",
                theme,
            ));
        if let Some(prepared) = &scale.prepared {
            let metadata = &prepared.submission().metadata;
            result = result
                .child(
                    crate::components::number_line(
                        "clinical-scale-score",
                        "Punteggio ",
                        metadata.score.to_string(),
                        "",
                        theme,
                    )
                    .aria_label(format!("Punteggio: {}", metadata.score)),
                )
                .child(
                    div()
                        .id("clinical-scale-interpretation")
                        .accessibility_id("clinical-scale-interpretation")
                        .child(text!(metadata.interpretation.clone())),
                )
                .child(
                    div()
                        .type_role(theme, TypeRole::Meta)
                        .text_color(theme.secondary)
                        .child(text!(format!(
                            "Versione dell’interpretazione: {}",
                            metadata
                                .interpretation_version
                                .as_deref()
                                .unwrap_or("Non indicata")
                        ))),
                )
                .child(section(
                    "clinical-scale-entry-heading",
                    "TESTO CHE VERRÀ REGISTRATO",
                    theme,
                ))
                .child(clinical_text::render(
                    &prepared.submission().content,
                    WritingInk::Fresh,
                    theme,
                ));
        } else {
            result = result.child(div().text_color(theme.secondary).child(text!(if scale.is_preparing() { "Preparazione del risultato nell’archivio…" }
                else { "Il risultato verrà preparato dall’archivio dopo tutte le risposte. Nessuna voce è stata registrata." })));
        }
        result = result.child(section("clinical-scale-source-heading", "FONTE E VERSIONE", theme))
            .child(div().child(text!(scale.descriptor.description.clone())))
            .child(div().type_role(theme, TypeRole::Meta).text_color(theme.secondary).flex().flex_col().gap(px(8.))
                .child(text!(format!("Fonte indicata: {}", scale.descriptor.use_contract.source_id)))
                .child(text!(format!("Definizione: {}", scale.descriptor.use_contract.definition_version)))
                .child(text!(format!("Lingua: {} · Traduzione: {}", scale.descriptor.use_contract.language, scale.descriptor.use_contract.translation)))
                .child(text!(format!("Limiti di revisione indicati dall’host: {}", scale.descriptor.use_contract.review_gap))))
            .when(!self.can_write(FormKind::Scale), |el| el.child(notice("clinical-scale-write-capability", "Per registrare la valutazione serve l’abilitazione alla scrittura del Diario sull’host.", theme, false)));
        let content = div()
            .id("clinical-scale-workspace")
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(theme.paper)
            .when(layout.magnified && self.message.is_some(), |el| {
                let (message, error) = self.message.clone().unwrap_or_default();
                el.child(
                    notice("clinical-workspace-message", message, theme, error).flex_shrink_0(),
                )
            })
            .child(
                div()
                    .id("clinical-scale-workspace-scroll")
                    .min_w_0()
                    .p(px(layout.margin))
                    .child(
                        div()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(24.))
                            .child(header)
                            .child(
                                div()
                                    .min_w_0()
                                    .flex()
                                    .gap(px(layout.gap))
                                    .when(layout.compact || layout.magnified, |el| el.flex_col())
                                    .child(questions)
                                    .child(result),
                            ),
                    ),
            );
        self.confirmation_plane("clinical-scale-plane", content, layout, cx)
    }
}
