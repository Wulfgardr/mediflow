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
