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
    host.plan(ELIGIBILITY)
        .send((code, json!({"status":"eligible"})))
        .unwrap();
    host.plan("GET /api/v1/network/patient-profile/selection-epoch")
        .send((200, json!({"contractVersion":1,"selectionEpoch":0})))
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
    admission(&bench.host, 200);
    let (pending, _remote) = open(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"icd-opened"}));
    bench.view.read_with(cx, |app, _| {
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
    admission(&bench.host, 403);
    let (pending, _remote) = open(&bench, cx);
    cx.run_until_parked();
    assert_eq!(wire(&pending), json!({"status":"withdrawn"}));
    bench.view.read_with(cx, |app, _| {
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
