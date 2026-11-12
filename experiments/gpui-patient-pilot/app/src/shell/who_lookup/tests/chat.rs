use super::*;
use crate::chat_access::owner::{Function, Pending, Stage, State, tests::function_request};
use crate::shell::notes_recovery_tests::Host;
use serde_json::{Value, json};
use std::os::unix::net::UnixStream;

const ELIGIBILITY: &str = "GET /api/auth/native/chat-access-confirmation";
const SEARCH: &str = "GET /api/v1/network/terminology/who/search?q=synthetic";

struct Bench {
    host: Host,
    view: Entity<ClinicalApp>,
}
fn bench(cx: &mut gpui::TestAppContext) -> (Bench, &mut gpui::VisualTestContext) {
    let host = Host::new();
    host.session.list_ambulatories().unwrap();
    host.session
        .select_profile_patient("scope-a", "patient-a")
        .unwrap();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    view.update(cx, |app, _| {
        app.session = Some(host.session.clone());
        app.scope = Some("scope-a".into());
        app.selected_id = Some("patient-a".into());
        app.area = Area::Patients;
        app.directory = false;
        app.patient_section = PatientSection::Therapies;
        app.patient.detail = ReadLoad::Ready(
            serde_json::from_value(json!({
                "id":"patient-a", "firstName":"Ada", "lastName":"Sintetica", "taxCode":"SYNTHETIC", "version":1,
                "isAdi":false, "isArchived":false
            }))
            .unwrap(),
        );
    });
    (Bench { host, view }, cx)
}
fn admission(host: &Host, code: u16) {
    admission_at_epoch(host, code, 0);
}
fn admission_at_epoch(host: &Host, code: u16, epoch: u64) {
    host.plan(ELIGIBILITY)
        .send((code, json!({"status":"eligible"})))
        .unwrap();
    host.plan("GET /api/v1/network/patient-profile/selection-epoch")
        .send((200, json!({"contractVersion":1,"selectionEpoch":epoch})))
        .unwrap();
}
fn open(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
    let function = Function::ALL
        .into_iter()
        .find(|function| State::Generative(*function, Stage::Opened).wire() == "icd-opened")
        .expect("la chat offre la ricerca ICD");
    let (pending, remote) = function_request(function);
    bench
        .view
        .update(cx, |app, cx| app.open_chat_function(&pending, function, cx));
    (pending, remote)
}
fn wire(pending: &Pending) -> Value {
    let status = pending.lock().unwrap().status();
    crate::chat_access::reply(status, Some(pending), None)
}
fn response() -> Value {
    json!({
        "schemaVersion":"mediflow.reference-data.icd11-search-response.v2",
        "entries":[{"code":"TEST1","description":"Synthetic English title", "system":"ICD-11",
            "canonicalUri":"http://id.who.int/icd/release/11/2026-01/mms/123"}],
        "partial":true,"receipt":{"schemaVersion":"mediflow.reference-data.icd11-search-receipt.v2",
            "operation":"mediflow.reference_data.icd11.search.v2","releaseId":"2026-01","language":"en",
            "deployment":"local","bindingId":"who.icd11.v2.2026-01.mms.en.local.v1",
            "imageDigest":format!("sha256:{}", "a".repeat(64)),"datasetSnapshotId":format!("sha256:{}", "b".repeat(64)),
            "source":"cache","resultCount":1,"latencyMs":1,
            "fetchedAt":"2026-10-19T00:00:00.000Z","expiresAt":"2026-10-20T00:00:00.000Z",
            "completedAt":"2026-10-19T01:00:00.000Z"}
    })
}
fn query(app: &mut ClinicalApp, cx: &mut Context<ClinicalApp>) {
    app.reference_search
        .update(cx, |input, cx| input.set_content("synthetic", cx));
}
fn assert_read_only(host: &Host) {
    assert!(
        host.routes().iter().all(|route| route.starts_with("GET ")
            || route.starts_with("POST /api/auth/")
            || route == "POST /api/v1/network/patients/patient-a/profile-query"
            || route == "POST /api/v1/network/pairing/confirm"),
        "{:?}",
        host.routes()
    );
}

#[gpui::test]
fn chat_icd_opens_in_the_selected_patient_without_local_host_or_search(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    cx.simulate_resize(gpui::size(px(1440.), px(900.)));
    bench
        .view
        .update(cx, |app, cx| app.select_patient("patient-a", false, cx));
    cx.run_until_parked();
    bench.view.read_with(cx, |app, _| {
        assert!(
            app.directory,
            "il clic sulla riga apre l’anteprima nell’elenco"
        );
        assert_eq!(app.patient.detail.ready().unwrap().id, "patient-a");
    });
    admission_at_epoch(&bench.host, 200, 2);
    let (pending, _remote) = open(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"icd-opened"}));
    bench.view.read_with(cx, |app, _| {
        assert!(
            !app.directory,
            "la chat deve aprire la scheda dall’anteprima dell’elenco"
        );
        assert!(
            app.who_location(),
            "la ricerca ICD deve essere utilizzabile"
        );
        assert_eq!(app.area, Area::Patients);
        assert_eq!(app.patient_section, PatientSection::Overview);
        assert_eq!(app.selected_id.as_deref(), Some("patient-a"));
        assert_eq!(app.patient.detail.ready().unwrap().id, "patient-a");
    });
    assert!(
        !bench
            .host
            .routes()
            .iter()
            .any(|route| route.contains("/terminology/"))
    );
    assert_read_only(&bench.host);
}

#[gpui::test]
fn chat_icd_receipt_follows_the_real_reader_and_contains_only_status(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    let (pending, _remote) = open(&bench, cx);
    cx.run_until_parked();
    bench.host.plan(SEARCH).send((200, response())).unwrap();
    bench.view.update(cx, |app, cx| {
        query(app, cx);
        app.request_who(true, cx);
    });
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"icd-closed"}));
    assert!(bench.host.routes().iter().any(|route| route == SEARCH));
    bench.view.read_with(cx, |app, _| {
        let result = app
            .who
            .rows
            .ready()
            .expect("risultato e ricevuta nella finestra");
        assert_eq!(result.entries[0].code, "TEST1");
        assert_eq!(result.receipt.result_count, 1);
        assert_eq!(
            result.receipt.operation,
            "mediflow.reference_data.icd11.search.v2"
        );
    });
    pending.lock().unwrap().revoke();
    bench
        .view
        .read_with(cx, |app, _| assert!(app.who.rows.ready().is_some()));
    assert_read_only(&bench.host);
}

#[gpui::test]
fn chat_icd_permission_denied_never_opens_or_searches(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.view.update(cx, |app, _| app.directory = true);
    admission(&bench.host, 403);
    let (pending, _remote) = open(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    bench.view.read_with(cx, |app, _| {
        assert!(app.directory, "il diniego conserva l’anteprima nell’elenco");
        assert_eq!(app.patient_section, PatientSection::Therapies)
    });
    assert!(
        !bench
            .host
            .routes()
            .iter()
            .any(|route| route.contains("/terminology/"))
    );
    assert_read_only(&bench.host);
}

#[gpui::test]
fn chat_icd_patient_changed_during_admission_never_opens(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.view.update(cx, |app, _| app.directory = true);
    admission(&bench.host, 200);
    let (pending, _remote) = open(&bench, cx);
    bench.view.update(cx, |app, _| {
        bench
            .host
            .session
            .select_profile_patient("scope-a", "patient-b")
            .unwrap();
        app.selected_id = Some("patient-b".into());
    });
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    bench.view.read_with(cx, |app, _| assert!(app.directory));
    bench
        .view
        .read_with(cx, |app, _| assert!(matches!(app.who.rows, Load::Idle)));
    assert_read_only(&bench.host);
}

#[gpui::test]
fn chat_icd_late_result_after_patient_change_or_revoke_is_discarded(cx: &mut gpui::TestAppContext) {
    for revoke in [false, true] {
        let (bench, cx) = bench(cx);
        admission(&bench.host, 200);
        let (pending, _remote) = open(&bench, cx);
        cx.run_until_parked();
        bench.view.update(cx, |app, cx| {
            query(app, cx);
            let token = app.begin_who(Some("synthetic".into()));
            if revoke {
                pending.lock().unwrap().revoke();
            } else {
                bench
                    .host
                    .session
                    .select_profile_patient("scope-a", "patient-b")
                    .unwrap();
                app.selected_id = Some("patient-b".into());
            }
            assert!(!app.receive_who(
                token,
                WhoResult::Search(Ok(serde_json::from_value(response()).unwrap())),
                cx
            ));
            assert!(app.who.rows.ready().is_none());
        });
        assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
        assert_read_only(&bench.host);
    }
}

#[gpui::test]
fn chat_icd_search_permission_denied_has_no_success_receipt(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    let (pending, _remote) = open(&bench, cx);
    cx.run_until_parked();
    bench
        .host
        .plan(SEARCH)
        .send((403, json!({"error":"denied"})))
        .unwrap();
    bench.view.update(cx, |app, cx| {
        query(app, cx);
        app.request_who(true, cx);
    });
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    bench
        .view
        .read_with(cx, |app, _| assert!(app.who.rows.ready().is_none()));
    assert_read_only(&bench.host);
}

const OPEN_LOOPS: &str = "GET /api/v1/network/patients/patient-a/open-loops";
fn loops_response() -> Value {
    json!({"contractVersion":1,"patientId":"patient-a","ambulatoryId":"scope-a",
        "groups":[{"prescriptionId":"prescription-a","prescribedAt":"2026-10-01T00:00:00.000Z","loops":[{
            "kind":"results_pending","label":"Referto sintetico","sinceDate":"2026-10-01T00:00:00.000Z",
            "elapsedDays":42,"typicalIntervalDays":null,
            "source":{"type":"service_prescription_item","id":"item-a","prescriptionId":"prescription-a"}}]}],
        "standaloneLoops":[],"receipt":{"operation":"patient-open-loops.read.v1","outcome":"read",
            "readAt":"2026-11-12T01:00:00.000Z","itemCount":1,"snapshotHash":"a".repeat(64)}})
}
fn open_loops(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
    let function = Function::ALL
        .into_iter()
        .find(|function| State::Generative(*function, Stage::Opened).wire() == "loops-opened")
        .expect("la chat offre i follow-up aperti");
    let (pending, remote) = function_request(function);
    bench
        .view
        .update(cx, |app, cx| app.open_chat_function(&pending, function, cx));
    (pending, remote)
}
fn after_request(
    host: &Host,
    route: &'static str,
    action: impl FnOnce() + Send + 'static,
) -> std::thread::JoinHandle<()> {
    let requests = host.requests_handle();
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !requests
            .lock()
            .unwrap()
            .iter()
            .any(|(request, _)| request == route)
        {
            assert!(
                std::time::Instant::now() < deadline,
                "request not observed: {route}"
            );
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        action();
    })
}

#[gpui::test]
fn chat_followups_opens_the_current_patient_and_returns_only_the_read_receipt_status(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    bench
        .host
        .plan(OPEN_LOOPS)
        .send((200, loops_response()))
        .unwrap();
    let (pending, _remote) = open_loops(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"loops-closed"}));
    assert!(bench.host.routes().iter().any(|route| route == OPEN_LOOPS));
    bench.view.read_with(cx, |app, _| {
        assert_eq!(app.selected_id.as_deref(), Some("patient-a"));
        assert_eq!(app.patient.detail.ready().unwrap().id, "patient-a");
        assert_eq!(app.patient_section, PatientSection::Overview);
    });
    assert_read_only(&bench.host);
}

#[gpui::test]
fn chat_followups_denied_admission_or_reader_has_no_success_receipt(cx: &mut gpui::TestAppContext) {
    for admission_denied in [true, false] {
        let (bench, cx) = bench(cx);
        admission(&bench.host, if admission_denied { 403 } else { 200 });
        if !admission_denied {
            bench
                .host
                .plan(OPEN_LOOPS)
                .send((403, json!({"error":"denied"})))
                .unwrap();
        }
        let (pending, _remote) = open_loops(&bench, cx);
        cx.run_until_parked();
        assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
        assert_eq!(
            bench.host.routes().iter().any(|route| route == OPEN_LOOPS),
            !admission_denied
        );
        assert_read_only(&bench.host);
    }
}

#[gpui::test]
fn chat_followups_patient_changed_during_admission_never_reads(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    let (pending, _remote) = open_loops(&bench, cx);
    bench.view.update(cx, |app, _| {
        bench
            .host
            .session
            .select_profile_patient("scope-a", "patient-b")
            .unwrap();
        app.selected_id = Some("patient-b".into());
    });
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    assert!(!bench.host.routes().iter().any(|route| route == OPEN_LOOPS));
    assert_read_only(&bench.host);
}

#[gpui::test]
fn chat_followups_late_http_result_after_patient_change_or_revoke_is_discarded(
    cx: &mut gpui::TestAppContext,
) {
    for revoke in [false, true] {
        let (bench, cx) = bench(cx);
        admission(&bench.host, 200);
        let response = bench.host.plan(OPEN_LOOPS);
        let (pending, _remote) = open_loops(&bench, cx);
        let session = bench.host.session.clone();
        let withdrawn = pending.clone();
        let worker = after_request(&bench.host, OPEN_LOOPS, move || {
            if revoke {
                withdrawn.lock().unwrap().revoke();
            } else {
                session
                    .select_profile_patient("scope-a", "patient-b")
                    .unwrap();
            }
            response.send((200, loops_response())).unwrap();
        });
        cx.run_until_parked();
        worker.join().unwrap();
        assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
        assert_read_only(&bench.host);
    }
}

#[gpui::test]
fn chat_followups_rejects_foreign_patient_and_malformed_read_receipts(
    cx: &mut gpui::TestAppContext,
) {
    for mutation in ["patient", "count", "operation", "source", "extra"] {
        let (bench, cx) = bench(cx);
        admission(&bench.host, 200);
        let mut response = loops_response();
        match mutation {
            "patient" => response["patientId"] = json!("patient-b"),
            "count" => response["receipt"]["itemCount"] = json!(0),
            "operation" => response["receipt"]["operation"] = json!("write"),
            "source" => {
                response["groups"][0]["loops"][0]["source"]["prescriptionId"] = json!("other")
            }
            _ => response["extra"] = json!("unexpected"),
        }
        bench.host.plan(OPEN_LOOPS).send((200, response)).unwrap();
        let (pending, _remote) = open_loops(&bench, cx);
        cx.run_until_parked();
        assert_eq!(wire(&pending), json!({"status":"withdrawn"}), "{mutation}");
        assert_read_only(&bench.host);
    }
}

#[gpui::test]
fn chat_followups_second_request_is_busy_without_replacing_the_owner(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    bench
        .host
        .plan(OPEN_LOOPS)
        .send((200, loops_response()))
        .unwrap();
    let (first, _first_remote) = open_loops(&bench, cx);
    let (second, _second_remote) = open_loops(&bench, cx);
    assert_eq!(wire(&second), json!({"status":"loops-busy"}));
    cx.run_until_parked();
    assert_eq!(wire(&first), json!({"status":"loops-closed"}));
    assert_eq!(
        bench
            .host
            .routes()
            .iter()
            .filter(|route| route.as_str() == OPEN_LOOPS)
            .count(),
        1
    );
    assert_read_only(&bench.host);
}

fn matrix_ready(bench: &Bench, cx: &mut gpui::VisualTestContext) {
    let access = std::sync::Arc::new(
        bench
            .host
            .session
            .authenticate_local_host(
                "Synthetic scales fixture passphrase",
                mediflow_runtime_client::RetirementNotice::new(None),
            )
            .unwrap(),
    );
    bench.view.update(cx, |app, _| {
        app.local_host.test_access(access);
        let mut patient = app.patient.detail.ready().unwrap().clone();
        patient.diagnoses = Some(
            r#"[{"code":"I10","description":"Ipertensione sintetica","system":"ICD-10"}]"#.into(),
        );
        patient.notes = Some("Nota sintetica per la matrice delle viste.".into());
        app.patient.detail = ReadLoad::Ready(patient);
        app.patient.entries = ReadLoad::Ready(vec![]);
        app.patient.therapies = ReadLoad::Ready(vec![]);
        app.patient.observations = ReadLoad::Ready(vec![]);
        app.patient.checkups = ReadLoad::Ready(vec![]);
        app.patient.attachments =
            ReadLoad::Ready(vec![serde_json::from_value(json!({
            "id":"matrix-document", "patientId":"patient-a", "name":"Documento sintetico.pdf",
            "type":"application/pdf", "size":12, "path":"matrix.pdf"
        })).unwrap()]);
    });
    cx.simulate_resize(gpui::size(px(1440.), px(1100.)));
}

fn matrix_open(
    bench: &Bench,
    function: Function,
    cx: &mut gpui::VisualTestContext,
) -> (Pending, UnixStream) {
    matrix_request(bench, function, 200, cx)
}

fn matrix_request(
    bench: &Bench,
    function: Function,
    code: u16,
    cx: &mut gpui::VisualTestContext,
) -> (Pending, UnixStream) {
    admission(&bench.host, code);
    let key = match function {
        Function::Insight => Some("aiPatientInsightKillSwitch"),
        Function::Synthesis => Some("aiDocumentSynthesisKillSwitch"),
        Function::Import => Some("aiSmartImportKillSwitch"),
        Function::Icd
        | Function::OpenLoops
        | Function::EvidenceQueue
        | Function::ServiceMatching => None,
    };
    if let Some(key) = key {
        bench
            .host
            .plan(&format!("GET /api/settings/{key}"))
            .send((200, json!({"key":key,"value":"enabled"})))
            .unwrap();
    }
    if function == Function::OpenLoops && code == 200 {
        let empty = bench.view.read_with(cx, |app, _| {
            app.patient.attachments.ready().is_some_and(Vec::is_empty)
        });
        let mut rows = loops_response();
        if empty {
            rows["groups"] = json!([]);
            rows["receipt"]["itemCount"] = json!(0);
        }
        bench.host.plan(OPEN_LOOPS).send((200, rows)).unwrap();
    }
    if function == Function::EvidenceQueue && code == 200 {
        let empty = bench.view.read_with(cx, |app, _| {
            app.patient.attachments.ready().is_some_and(Vec::is_empty)
        });
        for _ in 0..2 {
            bench
                .host
                .plan(EVIDENCE_ATTACHMENTS)
                .send((200, if empty { json!([]) } else { evidence_rows() }))
                .unwrap();
        }
    }
    if function == Function::ServiceMatching && code == 200 {
        let empty = bench.view.read_with(cx, |app, _| {
            app.patient.attachments.ready().is_some_and(Vec::is_empty)
        });
        bench
            .host
            .plan(MATCH_ITEMS)
            .send((
                200,
                if empty {
                    json!([])
                } else {
                    match_rows(1, false)
                },
            ))
            .unwrap();
        bench
            .host
            .plan(MATCH_CATALOG)
            .send((200, match_catalog()))
            .unwrap();
    }
    let (pending, remote) = function_request(function);
    bench
        .view
        .update(cx, |app, cx| app.open_chat_function(&pending, function, cx));
    cx.run_until_parked();
    bench.view.update(cx, |app, cx| {
        match function {
            Function::Insight => {
                app.patient.insight.follow_chat();
            }
            Function::Synthesis => {
                app.patient.synthesis.area.follow_chat();
            }
            Function::Import => {
                app.patient.smart_import.follow_chat();
            }
            Function::Icd => {
                app.who.follow_chat();
            }
            Function::OpenLoops => {
                app.open_loops.follow_chat();
            }
            Function::EvidenceQueue => {
                app.evidence_queue.follow_chat();
            }
            Function::ServiceMatching => {
                app.service_matching.follow_chat();
            }
        }
        cx.notify();
    });
    (pending, remote)
}

struct MatrixFrame {
    functions: Vec<Function>,
    texts: Vec<String>,
    buttons: Vec<String>,
}

fn matrix_frame(cx: &mut gpui::VisualTestContext) -> MatrixFrame {
    let _probe = rendered_command::begin_inks();
    let ids = rendered_command::button_ids(|| crate::shell::notes_recovery_tests::draw(cx));
    let texts: Vec<String> = rendered_command::take_inks()
        .into_iter()
        .map(|ink| ink.label)
        .collect();
    let mut functions: Vec<Function> = [
        (Function::Insight, "patient-insight-confirm"),
        (Function::Synthesis, "clinical-workspace-new-document"),
        (Function::Icd, "clinical-workspace-reference-run-search"),
        (Function::OpenLoops, "clinical-open-loops-close"),
        (Function::EvidenceQueue, "evidence-queue-close"),
        (Function::ServiceMatching, "service-matching-close"),
    ]
    .into_iter()
    .filter_map(|(function, id)| ids.iter().any(|found| found == id).then_some(function))
    .collect();
    if texts
        .iter()
        .any(|text| text == "IMPORT ASSISTITO · PROPOSTA")
    {
        functions.push(Function::Import);
    }
    MatrixFrame {
        functions,
        texts,
        buttons: ids,
    }
}

fn matrix_rendered(cx: &mut gpui::VisualTestContext) -> Vec<Function> {
    matrix_frame(cx).functions
}

#[gpui::test]
fn chat_function_view_matrix_renders_only_the_requested_function(cx: &mut gpui::TestAppContext) {
    run_view_matrix(cx, false);
}

#[gpui::test]
fn chat_followups_view_matrix_covers_both_directions(cx: &mut gpui::TestAppContext) {
    run_view_matrix(cx, true);
}

fn run_view_matrix(cx: &mut gpui::TestAppContext, only_followups: bool) {
    let mut failures = vec![];
    let mut checked = 0;
    for empty in [false, true] {
        for before in Function::ALL {
            for completed in [false, true] {
                if completed && before != Function::Icd {
                    continue;
                }
                for requested in Function::ALL {
                    if only_followups
                        && before != Function::OpenLoops
                        && requested != Function::OpenLoops
                    {
                        continue;
                    }
                    let (bench, cx) = bench(cx);
                    matrix_ready(&bench, cx);
                    if empty {
                        bench.view.update(cx, |app, _| {
                            let mut patient = app.patient.detail.ready().unwrap().clone();
                            patient.diagnoses = None;
                            patient.notes = None;
                            app.patient.detail = ReadLoad::Ready(patient);
                            app.patient.attachments = ReadLoad::Ready(vec![]);
                        });
                    }
                    cx.simulate_resize(gpui::size(px(1440.), px(1800.)));
                    let (first, _first_remote) = matrix_open(&bench, before, cx);
                    assert_eq!(
                        wire(&first),
                        json!({"status":State::Generative(before, if matches!(before,Function::OpenLoops | Function::EvidenceQueue) {Stage::Closed} else {Stage::Opened}).wire()}),
                        "{before:?}, vuota={empty}"
                    );
                    assert!(
                        matrix_rendered(cx).contains(&before),
                        "la prima funzione deve essere visibile: {before:?}, vuota={empty}"
                    );
                    if completed {
                        let mut rows = response();
                        if empty {
                            rows["entries"] = json!([]);
                            rows["partial"] = json!(false);
                            rows["receipt"]["resultCount"] = json!(0);
                        }
                        bench.host.plan(SEARCH).send((200, rows)).unwrap();
                        bench.view.update(cx, |app, cx| {
                            query(app, cx);
                            app.request_who(true, cx);
                        });
                        cx.run_until_parked();
                        assert_eq!(wire(&first), json!({"status":"icd-closed"}));
                    }
                    let (next, _next_remote) = matrix_open(&bench, requested, cx);
                    let stage = if before == requested {
                        Stage::Busy
                    } else if matches!(requested, Function::OpenLoops | Function::EvidenceQueue) {
                        Stage::Closed
                    } else {
                        Stage::Opened
                    };
                    assert_eq!(
                        wire(&next),
                        json!({"status":State::Generative(requested,stage).wire()}),
                        "{before:?} → {requested:?}, conclusa={completed}, vuota={empty}"
                    );
                    let frame = matrix_frame(cx);
                    checked += 1;
                    let case =
                        format!("{before:?} → {requested:?}, conclusa={completed}, vuota={empty}");
                    eprintln!("{case}: render {:?}", frame.functions);
                    if before != requested {
                        let expected = if before == Function::OpenLoops {
                            "loops-closed"
                        } else if before == Function::EvidenceQueue {
                            "evidence-closed"
                        } else if completed {
                            "icd-closed"
                        } else {
                            "withdrawn"
                        };
                        if wire(&first) != json!({"status":expected}) {
                            failures.push(format!(
                                "{case}: funzione precedente ancora {}",
                                wire(&first)
                            ));
                        }
                    }
                    if frame.functions != [requested] {
                        failures.push(format!("{case}: render {:?}", frame.functions));
                    }
                    let expected: Vec<&str> = match requested {
                        Function::Insight => vec![if empty {
                            "Verranno inviati al modello locale dell’host: 0 condizioni, 0 terapie attive, 0 voci recenti del diario. Nome, codice fiscale e recapiti non vengono inviati."
                        } else {
                            "Verranno inviati al modello locale dell’host: 1 condizioni, 0 terapie attive, 0 voci recenti del diario. Nome, codice fiscale e recapiti non vengono inviati."
                        }],
                        Function::ServiceMatching => vec![if empty {
                            "Nessuna prestazione da abbinare."
                        } else {
                            "Prestazione da abbinare"
                        }],
                        Function::EvidenceQueue => vec![if empty {
                            "Nessuna evidenza dai documenti."
                        } else {
                            "Referto sintetico · Da rivedere"
                        }],
                        Function::OpenLoops => vec![if empty {
                            "Nessun follow-up aperto."
                        } else {
                            "Referto sintetico"
                        }],
                        Function::Synthesis if empty => vec![
                            "Nessun documento da sintetizzare. Aggiungi un documento oppure revoca la richiesta dalla chat.",
                            "Nessun documento presente nella scheda.",
                        ],
                        Function::Synthesis => vec!["Scegli un documento e apri Sintesi e fonte."],
                        Function::Import => vec![if empty {
                            "Nessuna nota, voce di diario o sintesi di documento da cui proporre. Aggiungine una oppure revoca la richiesta dalla chat."
                        } else {
                            "Prepara la richiesta nell’import assistito."
                        }],
                        Function::Icd => {
                            let mut messages = vec![
                                "Stato del servizio non ancora letto.",
                                "Cerca un termine clinico in inglese o un codice. I titoli originali non vengono tradotti.",
                            ];
                            if empty && completed && before == requested {
                                messages.push("Nessun risultato per questa ricerca. Prova altri termini in inglese.");
                            }
                            messages
                        }
                    };
                    for message in expected {
                        if frame.texts.iter().filter(|text| *text == message).count() != 1 {
                            failures.push(format!("{case}: avviso assente o ripetuto: {message}"));
                        }
                    }
                    if empty && requested == Function::Import {
                        assert!(!frame.buttons.iter().any(|id| id == "smart-import-prepare"));
                    }
                    bench.view.read_with(cx, |app, _| {
                        assert_eq!(app.selected_id.as_deref(), Some("patient-a"))
                    });
                    assert_read_only(&bench.host);
                }
            }
        }
    }
    assert_eq!(checked, if only_followups { 28 } else { 112 });
    assert!(
        failures.is_empty(),
        "Viste o avvisi errati nella matrice:\n{}",
        failures.join("\n")
    );
}

#[gpui::test]
fn chat_function_import_notice_is_not_duplicated_in_documents(cx: &mut gpui::TestAppContext) {
    for empty in [false, true] {
        let (bench, cx) = bench(cx);
        matrix_ready(&bench, cx);
        if empty {
            bench.view.update(cx, |app, _| {
                let mut patient = app.patient.detail.ready().unwrap().clone();
                patient.notes = None;
                app.patient.detail = ReadLoad::Ready(patient);
                app.patient.attachments = ReadLoad::Ready(vec![]);
            });
        }
        let (pending, _remote) = matrix_open(&bench, Function::Import, cx);
        assert_eq!(wire(&pending), json!({"status":"import-opened"}));
        bench.view.update(cx, |app, cx| {
            app.section_selected(PatientSection::Documents, cx)
        });
        cx.simulate_resize(gpui::size(px(1440.), px(1800.)));
        let frame = matrix_frame(cx);
        let expected = if empty {
            "Nessuna nota, voce di diario o sintesi di documento da cui proporre. Aggiungine una oppure revoca la richiesta dalla chat."
        } else {
            "Prepara la richiesta nell’import assistito."
        };
        assert_eq!(
            frame.texts.iter().filter(|text| *text == expected).count(),
            1,
            "un solo avviso anche nei Documenti completi, vuota={empty}: {:?}",
            frame.texts
        );
        assert_eq!(
            frame.buttons.iter().any(|id| id == "smart-import-prepare"),
            !empty
        );
        assert_read_only(&bench.host);
    }
}

#[gpui::test]
fn denied_chat_function_keeps_the_previous_rendered_function(cx: &mut gpui::TestAppContext) {
    for requested in Function::ALL {
        let before = if requested == Function::Icd {
            Function::Insight
        } else {
            Function::Icd
        };
        let (bench, cx) = bench(cx);
        matrix_ready(&bench, cx);
        let (first, _remote) = matrix_open(&bench, before, cx);
        let (next, _other) = matrix_request(&bench, requested, 403, cx);
        assert_eq!(wire(&next), json!({"status":"withdrawn"}));
        assert_eq!(
            wire(&first),
            json!({"status":State::Generative(before,Stage::Opened).wire()})
        );
        assert_eq!(matrix_rendered(cx), [before], "{before:?} → {requested:?}");
    }
}

#[gpui::test]
fn busy_chat_function_reveals_its_existing_consent(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    matrix_ready(&bench, cx);
    let (first, _remote) = matrix_open(&bench, Function::Insight, cx);
    bench.view.update(cx, |app, cx| {
        app.section_selected(PatientSection::Documents, cx)
    });
    assert!(!matrix_rendered(cx).contains(&Function::Insight));
    let calls = bench.host.routes().len();
    let (next, _other) = matrix_open(&bench, Function::Insight, cx);
    assert_eq!(wire(&next), json!({"status":"insight-busy"}));
    assert_eq!(wire(&first), json!({"status":"insight-opened"}));
    assert_eq!(matrix_rendered(cx), [Function::Insight]);
    assert_eq!(
        bench.host.routes().len(),
        calls,
        "rimostra il consenso senza nuove letture o generazioni"
    );
}

#[gpui::test]
fn duplicate_during_denied_admission_keeps_the_previous_rendered_function(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    matrix_ready(&bench, cx);
    let (first, _remote) = matrix_open(&bench, Function::Icd, cx);
    admission(&bench.host, 403);
    let (denied, _denied_remote) = function_request(Function::Insight);
    let (duplicate, _duplicate_remote) = function_request(Function::Insight);
    bench.view.update(cx, |app, cx| {
        app.open_chat_function(&denied, Function::Insight, cx);
        app.open_chat_function(&duplicate, Function::Insight, cx);
    });
    cx.run_until_parked();
    assert_eq!(wire(&denied), json!({"status":"withdrawn"}));
    assert_eq!(wire(&duplicate), json!({"status":"insight-busy"}));
    assert_eq!(wire(&first), json!({"status":"icd-opened"}));
    assert_eq!(matrix_rendered(cx), [Function::Icd]);
}

#[gpui::test]
fn chat_followups_denied_next_function_keeps_the_read_receipt_visible(
    cx: &mut gpui::TestAppContext,
) {
    for requested in Function::ALL {
        if requested == Function::OpenLoops {
            continue;
        }
        let (bench, cx) = bench(cx);
        matrix_ready(&bench, cx);
        let (first, _remote) = matrix_open(&bench, Function::OpenLoops, cx);
        assert_eq!(wire(&first), json!({"status":"loops-closed"}));
        let (next, _other) = matrix_request(&bench, requested, 403, cx);
        assert_eq!(wire(&next), json!({"status":"withdrawn"}));
        assert_eq!(wire(&first), json!({"status":"loops-closed"}));
        assert_eq!(matrix_rendered(cx), [Function::OpenLoops]);
        assert_read_only(&bench.host);
    }
}

#[gpui::test]
fn chat_followups_busy_reveals_the_existing_read_without_another_request(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    matrix_ready(&bench, cx);
    let (first, _remote) = matrix_open(&bench, Function::OpenLoops, cx);
    bench.view.update(cx, |app, _| {
        app.area = Area::Agenda;
    });
    assert!(!matrix_rendered(cx).contains(&Function::OpenLoops));
    let calls = bench.host.routes().len();
    let (next, _other) = matrix_open(&bench, Function::OpenLoops, cx);
    assert_eq!(wire(&next), json!({"status":"loops-busy"}));
    assert_eq!(wire(&first), json!({"status":"loops-closed"}));
    assert_eq!(matrix_rendered(cx), [Function::OpenLoops]);
    assert_eq!(bench.host.routes().len(), calls);
    assert_read_only(&bench.host);
}

const EVIDENCE_ATTACHMENTS: &str = "GET /api/v1/network/patients/patient-a/attachments";
fn evidence_rows() -> Value {
    json!([{"id":"document-a","patientId":"patient-a","name":"Referto sintetico",
        "type":"text/plain","size":12,"path":"uploads/synthetic.txt","createdAt":"2026-11-12T00:00:00Z",
        "summarySnapshot":"Sintesi del documento da rivedere prima dell’uso clinico.","parseEvidenceArtifactSnapshot":null,
        "currentness":{"sourceRef":"a".repeat(64),"revision":1,"freshnessEpoch":1}}])
}
fn open_evidence(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
    let function = Function::ALL
        .into_iter()
        .find(|function| State::Generative(*function, Stage::Opened).wire() == "evidence-opened")
        .expect("la chat offre le evidenze dai documenti");
    let (pending, remote) = function_request(function);
    bench
        .view
        .update(cx, |app, cx| app.open_chat_function(&pending, function, cx));
    (pending, remote)
}
#[gpui::test]
fn chat_evidence_opens_selected_patient_receives_and_renders_read_receipt(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    for _ in 0..2 {
        bench
            .host
            .plan(EVIDENCE_ATTACHMENTS)
            .send((200, evidence_rows()))
            .unwrap();
    }
    let (pending, _remote) = open_evidence(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"evidence-closed"}));
    bench.view.read_with(cx, |app, _| {
        assert_eq!(app.selected_id.as_deref(), Some("patient-a"));
        assert_eq!(app.patient.detail.ready().unwrap().id, "patient-a");
        assert_eq!(app.patient_section, PatientSection::Overview);
        assert!(!app.directory);
    });
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(
        cx.debug_bounds("evidence-queue-heading").is_some(),
        "vista visibile"
    );
    assert!(
        cx.debug_bounds("evidence-queue-receipt").is_some(),
        "ricevuta visibile"
    );
    assert!(
        cx.debug_bounds("evidence-queue-source-0").is_some(),
        "fonte visibile"
    );
    assert_read_only(&bench.host);
}
#[gpui::test]
fn chat_evidence_denied_admission_or_reader_never_produces_receipt(cx: &mut gpui::TestAppContext) {
    for denied in [true, false] {
        let (bench, cx) = bench(cx);
        admission(&bench.host, if denied { 403 } else { 200 });
        if !denied {
            bench
                .host
                .plan(EVIDENCE_ATTACHMENTS)
                .send((403, json!({"error":"denied"})))
                .unwrap();
        }
        let (pending, _remote) = open_evidence(&bench, cx);
        cx.run_until_parked();
        assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
        assert_eq!(
            bench
                .host
                .routes()
                .iter()
                .any(|r| r == EVIDENCE_ATTACHMENTS),
            !denied
        );
        assert_read_only(&bench.host);
    }
}
#[gpui::test]
fn chat_evidence_late_response_after_patient_change_or_revocation_is_discarded(
    cx: &mut gpui::TestAppContext,
) {
    for revoke in [false, true] {
        let (bench, cx) = bench(cx);
        admission(&bench.host, 200);
        let response = bench.host.plan(EVIDENCE_ATTACHMENTS);
        let (pending, _remote) = open_evidence(&bench, cx);
        let session = bench.host.session.clone();
        let withdrawn = pending.clone();
        let worker = after_request(&bench.host, EVIDENCE_ATTACHMENTS, move || {
            if revoke {
                withdrawn.lock().unwrap().revoke();
            } else {
                session
                    .select_profile_patient("scope-a", "patient-b")
                    .unwrap();
            }
            response.send((200, evidence_rows())).unwrap();
        });
        cx.run_until_parked();
        worker.join().unwrap();
        assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
        crate::shell::notes_recovery_tests::draw(cx);
        assert!(cx.debug_bounds("evidence-queue-receipt").is_none());
        assert_read_only(&bench.host);
    }
}
#[gpui::test]
fn chat_evidence_foreign_locked_or_changed_sources_never_produce_receipt(
    cx: &mut gpui::TestAppContext,
) {
    for mutation in ["patient", "locked", "changed", "missing-currentness"] {
        let (bench, cx) = bench(cx);
        admission(&bench.host, 200);
        let mut rows = evidence_rows();
        match mutation {
            "patient" => rows[0]["patientId"] = json!("patient-b"),
            "locked" => rows[0]["summarySnapshot"] = json!("ENC:unreadable"),
            "missing-currentness" => rows[0]["currentness"] = Value::Null,
            _ => {}
        }
        bench
            .host
            .plan(EVIDENCE_ATTACHMENTS)
            .send((200, rows.clone()))
            .unwrap();
        if mutation == "changed" {
            rows[0]["currentness"]["revision"] = json!(2);
            bench
                .host
                .plan(EVIDENCE_ATTACHMENTS)
                .send((200, rows))
                .unwrap();
        }
        let (pending, _remote) = open_evidence(&bench, cx);
        cx.run_until_parked();
        assert_eq!(wire(&pending), json!({"status":"withdrawn"}), "{mutation}");
        assert_read_only(&bench.host);
    }
}
#[gpui::test]
fn chat_evidence_changed_patient_during_admission_does_not_read(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    let (pending, _remote) = open_evidence(&bench, cx);
    bench.view.update(cx, |app, _| {
        bench
            .host
            .session
            .select_profile_patient("scope-a", "patient-b")
            .unwrap();
        app.selected_id = Some("patient-b".into());
    });
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    assert!(
        !bench
            .host
            .routes()
            .iter()
            .any(|r| r == EVIDENCE_ATTACHMENTS)
    );
}

#[gpui::test]
fn chat_evidence_function_visibility_matrix(cx: &mut gpui::TestAppContext) {
    let functions = [
        ("icd-opened", "control-label:Chiudi ricerca ICD"),
        ("loops-opened", "control-label:Chiudi follow-up"),
        ("evidence-opened", "control-label:Chiudi evidenze"),
    ];
    for (previous, _) in functions {
        for (next, close) in functions {
            if previous == next {
                continue;
            }
            let (bench, cx) = bench(cx);
            cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
            let mut remotes = Vec::new();
            for status in [previous, next] {
                let function = Function::ALL
                    .into_iter()
                    .find(|f| State::Generative(*f, Stage::Opened).wire() == status)
                    .expect("la chat offre la funzione della matrice");
                admission(&bench.host, 200);
                if status == "loops-opened" {
                    bench
                        .host
                        .plan(OPEN_LOOPS)
                        .send((200, loops_response()))
                        .unwrap();
                }
                if status == "evidence-opened" {
                    for _ in 0..2 {
                        bench
                            .host
                            .plan(EVIDENCE_ATTACHMENTS)
                            .send((200, evidence_rows()))
                            .unwrap();
                    }
                }
                let (pending, remote) = function_request(function);
                bench
                    .view
                    .update(cx, |app, cx| app.open_chat_function(&pending, function, cx));
                cx.run_until_parked();
                assert_ne!(
                    wire(&pending),
                    json!({"status":"withdrawn"}),
                    "{previous} -> {next}"
                );
                remotes.push(remote);
            }
            crate::shell::notes_recovery_tests::draw(cx);
            assert!(cx.debug_bounds(close).is_some(), "{previous} -> {next}");
            assert_read_only(&bench.host);
        }
    }
}

#[gpui::test]
fn chat_evidence_currentness_is_checked_again_by_the_visible_view(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    for _ in 0..2 {
        bench
            .host
            .plan(EVIDENCE_ATTACHMENTS)
            .send((200, evidence_rows()))
            .unwrap();
    }
    let (pending, _remote) = open_evidence(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"evidence-closed"}));
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(cx.debug_bounds("evidence-queue-receipt").is_some());
    bench
        .host
        .session
        .select_profile_patient("scope-a", "patient-b")
        .unwrap();
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(cx.debug_bounds("evidence-queue-receipt").is_none());
    assert_read_only(&bench.host);
}

#[gpui::test]
fn chat_evidence_refreshed_source_currentness_hides_the_previous_queue(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    for _ in 0..2 {
        bench
            .host
            .plan(EVIDENCE_ATTACHMENTS)
            .send((200, evidence_rows()))
            .unwrap();
    }
    let (pending, _remote) = open_evidence(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"evidence-closed"}));
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(cx.debug_bounds("evidence-queue-receipt").is_some());
    let mut rows = evidence_rows();
    rows[0]["currentness"]["revision"] = json!(2);
    bench.view.update(cx, |app, cx| {
        app.patient.attachments = ReadLoad::Ready(serde_json::from_value(rows).unwrap());
        cx.notify();
    });
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(
        cx.debug_bounds("evidence-queue-receipt").is_none(),
        "una fonte riletta e cambiata ritira la coda precedente"
    );
    for _ in 0..2 {
        let mut rows = evidence_rows();
        rows[0]["currentness"]["revision"] = json!(2);
        bench
            .host
            .plan(EVIDENCE_ATTACHMENTS)
            .send((200, rows))
            .unwrap();
    }
    let refresh = cx
        .debug_bounds("control-label:Rileggi evidenze")
        .expect("rilettura disponibile");
    cx.simulate_click(refresh.center(), gpui::Modifiers::default());
    cx.run_until_parked();
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(cx.debug_bounds("evidence-queue-receipt").is_some());
    assert_read_only(&bench.host);
}

const MATCH_ITEMS: &str = "GET /api/v1/network/service-prescription-items?patientId=patient-a";
const MATCH_CATALOG: &str = "GET /api/v1/network/service-catalog";
const MATCH_PUT: &str = "PUT /api/v1/network/service-prescription-items/item-a";
fn match_rows(version: u64, matched: bool) -> Value {
    json!([{"id":"item-a","patientId":"patient-a","prescriptionId":"prescription-a","serviceName":"Prestazione sintetica",
        "status":"prescribed","matchStatus":if matched{"manual"}else{"unmatched"},"version":version,
        "serviceCode":if matched{Some("SYN-1")}else{None},"codeSystem":if matched{Some("SSR")}else{None},
        "catalogEntryId":if matched{Some("catalog-a")}else{None},"catalogDisplayName":if matched{Some("Voce sintetica")}else{None}}])
}
fn match_catalog() -> Value {
    json!([{"id":"catalog-a","codeSystem":"SSR","serviceCode":"SYN-1","displayName":"Voce sintetica","active":true}])
}
fn plan_matching(bench: &Bench) {
    admission(&bench.host, 200);
    bench
        .host
        .plan(MATCH_ITEMS)
        .send((200, match_rows(1, false)))
        .unwrap();
    bench
        .host
        .plan(MATCH_CATALOG)
        .send((200, match_catalog()))
        .unwrap();
}
fn open_matching(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
    let function = Function::ALL
        .into_iter()
        .find(|f| State::Generative(*f, Stage::Opened).wire() == "matching-opened")
        .expect("la chat offre l’abbinamento prestazioni");
    let (pending, remote) = function_request(function);
    bench
        .view
        .update(cx, |app, cx| app.open_chat_function(&pending, function, cx));
    (pending, remote)
}
fn match_click(cx: &mut gpui::VisualTestContext, label: &'static str) {
    crate::shell::notes_recovery_tests::draw(cx);
    let bounds = cx.debug_bounds(label).expect("comando del medico visibile");
    cx.simulate_click(bounds.center(), gpui::Modifiers::default());
    cx.run_until_parked();
}
fn choose_matching(cx: &mut gpui::VisualTestContext) {
    match_click(cx, "control-label:Prestazione sintetica · Prescritta · v1");
    match_click(cx, "control-label:SYN-1 · Voce sintetica");
}
#[gpui::test]
fn chat_matching_opens_current_patient_and_only_explicit_confirmation_writes_with_version_and_receipt(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
    plan_matching(&bench);
    let (pending, _remote) = open_matching(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"matching-opened"}));
    bench.view.read_with(cx, |app, _| {
        assert_eq!(app.selected_id.as_deref(), Some("patient-a"));
        assert!(!app.directory);
    });
    assert_read_only(&bench.host);
    choose_matching(cx);
    assert_read_only(&bench.host);
    bench
        .host
        .plan(MATCH_PUT)
        .send((200, json!({"success":true})))
        .unwrap();
    bench
        .host
        .plan(MATCH_ITEMS)
        .send((200, match_rows(2, true)))
        .unwrap();
    match_click(cx, "control-label:Conferma abbinamento");
    assert_eq!(
        wire(&pending),
        json!({"status":"matching-closed"}),
        "{:?}",
        bench.host.requests_handle().lock().unwrap()
    );
    let requests = bench.host.requests_handle();
    let requests = requests.lock().unwrap();
    let puts = requests
        .iter()
        .filter(|(route, _)| route == MATCH_PUT)
        .collect::<Vec<_>>();
    assert_eq!(puts.len(), 1);
    assert_eq!(puts[0].1["version"], 1);
    assert_eq!(puts[0].1["matchStatus"], "manual");
    assert_eq!(puts[0].1["serviceCode"], "SYN-1");
    assert!(
        puts[0].1["catalogDisplayName"]
            .as_str()
            .unwrap()
            .starts_with("ENC:")
    );
    assert!(puts[0].1.get("patientId").is_none());
    drop(requests);
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(cx.debug_bounds("service-matching-receipt").is_some());
    assert!(
        cx.debug_bounds("control-label:Conferma abbinamento")
            .is_none()
    );
}
#[gpui::test]
fn chat_matching_denied_admission_items_catalog_or_writer_never_has_success_receipt(
    cx: &mut gpui::TestAppContext,
) {
    for denied in ["admission", "items", "catalog", "writer"] {
        let (bench, cx) = bench(cx);
        cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
        admission(&bench.host, if denied == "admission" { 403 } else { 200 });
        if denied != "admission" {
            bench
                .host
                .plan(MATCH_ITEMS)
                .send((
                    if denied == "items" { 403 } else { 200 },
                    if denied == "items" {
                        json!({"error":"denied"})
                    } else {
                        match_rows(1, false)
                    },
                ))
                .unwrap();
        }
        if denied == "catalog" || denied == "writer" {
            bench
                .host
                .plan(MATCH_CATALOG)
                .send((
                    if denied == "catalog" { 403 } else { 200 },
                    if denied == "catalog" {
                        json!({"error":"denied"})
                    } else {
                        match_catalog()
                    },
                ))
                .unwrap();
        }
        let (pending, _remote) = open_matching(&bench, cx);
        cx.run_until_parked();
        if denied == "writer" {
            choose_matching(cx);
            bench
                .host
                .plan(MATCH_PUT)
                .send((403, json!({"error":"denied"})))
                .unwrap();
            match_click(cx, "control-label:Conferma abbinamento");
        }
        assert_eq!(wire(&pending), json!({"status":"withdrawn"}), "{denied}");
        crate::shell::notes_recovery_tests::draw(cx);
        assert!(cx.debug_bounds("service-matching-receipt").is_none());
        if denied != "writer" {
            assert_read_only(&bench.host);
        }
    }
}
#[gpui::test]
fn chat_matching_late_read_after_patient_change_or_revocation_never_offers_confirmation(
    cx: &mut gpui::TestAppContext,
) {
    for revoke in [false, true] {
        let (bench, cx) = bench(cx);
        admission(&bench.host, 200);
        let response = bench.host.plan(MATCH_ITEMS);
        bench
            .host
            .plan(MATCH_CATALOG)
            .send((200, match_catalog()))
            .unwrap();
        let (pending, _remote) = open_matching(&bench, cx);
        let session = bench.host.session.clone();
        let withdrawn = pending.clone();
        let worker = after_request(&bench.host, MATCH_ITEMS, move || {
            if revoke {
                withdrawn.lock().unwrap().revoke();
            } else {
                session
                    .select_profile_patient("scope-a", "patient-b")
                    .unwrap();
            }
            response.send((200, match_rows(1, false))).unwrap();
        });
        cx.run_until_parked();
        worker.join().unwrap();
        assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
        crate::shell::notes_recovery_tests::draw(cx);
        assert!(
            cx.debug_bounds("control-label:Conferma abbinamento")
                .is_none()
        );
        assert_read_only(&bench.host);
    }
}
#[gpui::test]
fn chat_matching_version_conflict_requires_reread_and_never_reports_applied(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
    plan_matching(&bench);
    let (pending, _remote) = open_matching(&bench, cx);
    cx.run_until_parked();
    choose_matching(cx);
    bench
        .host
        .plan(MATCH_PUT)
        .send((409, json!({"error":"Version conflict"})))
        .unwrap();
    match_click(cx, "control-label:Conferma abbinamento");
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(cx.debug_bounds("service-matching-receipt").is_none());
    assert!(
        cx.debug_bounds("control-label:Conferma abbinamento")
            .is_none()
    );
    assert!(
        cx.debug_bounds("control-label:Rileggi prestazioni")
            .is_some()
    );
    assert_eq!(
        bench
            .host
            .routes()
            .iter()
            .filter(|r| r.as_str() == MATCH_PUT)
            .count(),
        1
    );
}
#[gpui::test]
fn chat_matching_late_writer_response_after_revocation_has_no_receipt(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
    plan_matching(&bench);
    let (pending, _remote) = open_matching(&bench, cx);
    cx.run_until_parked();
    choose_matching(cx);
    let response = bench.host.plan(MATCH_PUT);
    bench
        .host
        .plan(MATCH_ITEMS)
        .send((200, match_rows(2, true)))
        .unwrap();
    let withdrawn = pending.clone();
    let worker = after_request(&bench.host, MATCH_PUT, move || {
        withdrawn.lock().unwrap().revoke();
        response.send((200, json!({"success":true}))).unwrap();
    });
    match_click(cx, "control-label:Conferma abbinamento");
    worker.join().unwrap();
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(cx.debug_bounds("service-matching-receipt").is_none());
    assert_eq!(
        bench
            .host
            .routes()
            .iter()
            .filter(|r| r.as_str() == MATCH_PUT)
            .count(),
        1
    );
}
#[gpui::test]
fn chat_matching_foreign_patient_is_rejected_without_catalog_or_write(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    admission(&bench.host, 200);
    let mut rows = match_rows(1, false);
    rows[0]["patientId"] = json!("patient-b");
    bench.host.plan(MATCH_ITEMS).send((200, rows)).unwrap();
    let (pending, _remote) = open_matching(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    assert!(
        !bench
            .host
            .routes()
            .iter()
            .any(|r| r.starts_with(MATCH_CATALOG))
    );
    assert_read_only(&bench.host);
}

#[gpui::test]
fn chat_matching_revocation_after_selection_prevents_the_confirmation_write(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
    plan_matching(&bench);
    let (pending, _remote) = open_matching(&bench, cx);
    cx.run_until_parked();
    choose_matching(cx);
    pending.lock().unwrap().revoke();
    crate::shell::notes_recovery_tests::draw(cx);
    if let Some(bounds) = cx.debug_bounds("control-label:Conferma abbinamento") {
        cx.simulate_click(bounds.center(), gpui::Modifiers::default());
        cx.run_until_parked();
    }
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    assert_read_only(&bench.host);
    assert!(cx.debug_bounds("service-matching-receipt").is_none());
}

#[gpui::test]
fn chat_matching_acknowledgement_without_the_expected_readback_is_not_a_receipt(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
    plan_matching(&bench);
    let (pending, _remote) = open_matching(&bench, cx);
    cx.run_until_parked();
    choose_matching(cx);
    bench
        .host
        .plan(MATCH_PUT)
        .send((200, json!({"success":true})))
        .unwrap();
    bench
        .host
        .plan(MATCH_ITEMS)
        .send((200, match_rows(3, true)))
        .unwrap();
    match_click(cx, "control-label:Conferma abbinamento");
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    crate::shell::notes_recovery_tests::draw(cx);
    assert!(cx.debug_bounds("service-matching-receipt").is_none());
    assert_eq!(
        bench
            .host
            .routes()
            .iter()
            .filter(|r| r.as_str() == MATCH_PUT)
            .count(),
        1
    );
}

#[gpui::test]
fn chat_matching_completed_receipt_view_yields_to_each_requested_function(
    cx: &mut gpui::TestAppContext,
) {
    let matching = Function::ALL
        .into_iter()
        .find(|f| State::Generative(*f, Stage::Opened).wire() == "matching-opened")
        .expect("abbinamento disponibile");
    for requested in Function::ALL {
        let (bench, cx) = bench(cx);
        matrix_ready(&bench, cx);
        let (first, _remote) = matrix_open(&bench, matching, cx);
        assert_eq!(wire(&first), json!({"status":"matching-opened"}));
        choose_matching(cx);
        bench
            .host
            .plan(MATCH_PUT)
            .send((200, json!({"success":true})))
            .unwrap();
        bench
            .host
            .plan(MATCH_ITEMS)
            .send((200, match_rows(2, true)))
            .unwrap();
        match_click(cx, "control-label:Conferma abbinamento");
        assert_eq!(wire(&first), json!({"status":"matching-closed"}));
        let (next, _other) = matrix_open(&bench, requested, cx);
        let stage = if requested == matching {
            Stage::Busy
        } else if matches!(
            State::Generative(requested, Stage::Opened).wire(),
            "loops-opened" | "evidence-opened"
        ) {
            Stage::Closed
        } else {
            Stage::Opened
        };
        assert_eq!(
            wire(&next),
            json!({"status":State::Generative(requested,stage).wire()})
        );
        assert_eq!(matrix_rendered(cx), [requested]);
        assert_eq!(wire(&first), json!({"status":"matching-closed"}));
        assert_eq!(
            cx.debug_bounds("service-matching-receipt").is_some(),
            requested == matching
        );
        assert_eq!(
            bench
                .host
                .routes()
                .iter()
                .filter(|r| r.as_str() == MATCH_PUT)
                .count(),
            1
        );
    }
}
