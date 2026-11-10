use super::*;
use crate::chat_access::owner::{Function, Pending, tests::function_request};
use std::os::unix::net::UnixStream;

const ELIGIBILITY: &str = "GET /api/auth/native/chat-access-confirmation";
const CHAT_EPOCH: &str = "GET /api/v1/network/patient-profile/selection-epoch";

fn paired(bench: &Bench, cx: &mut gpui::VisualTestContext) {
    let scope = text("ambulatoryId");
    bench
        .host
        .plan("GET /api/v1/network/ambulatories")
        .send((
            200,
            json!([{"id":scope,"name":"Ambulatorio sintetico","isDefault":true,"version":1}]),
        ))
        .unwrap();
    bench.host.session.list_ambulatories().unwrap();
    bench
        .host
        .session
        .select_profile_patient(&scope, &text("patientId"))
        .unwrap();
    bench.view.update(cx, |app, _| {
        app.patient.detail = ReadLoad::Ready(
            serde_json::from_value(json!({
                "id":text("patientId"), "firstName":"Ada", "lastName":"Sintetica",
                "taxCode":"SYNTHETIC", "version":1,
            }))
            .unwrap(),
        );
        app.patient.therapies = ReadLoad::Ready(vec![]);
        app.patient.entries = ReadLoad::Ready(vec![]);
    });
}

fn admission(bench: &Bench, eligible: bool) {
    for _ in 0..2 {
        bench.host.plan("GET /api/v1/network/identity").send((200, json!({
            "scope":{"effectiveAmbulatoryId":text("ambulatoryId"),"requestBinding":"expected-ambulatory-id-v1"},
            "operator":{"userId":"synthetic-user","authChannel":"native"},
        }))).unwrap();
    }
    bench
        .host
        .plan(ELIGIBILITY)
        .send((
            200,
            json!({"status":if eligible {"eligible"} else {"ineligible"}}),
        ))
        .unwrap();
    bench
        .host
        .plan(CHAT_EPOCH)
        .send((200, json!({"contractVersion":1,"selectionEpoch":0})))
        .unwrap();
}

fn reply(pending: &Pending) -> Value {
    let status = pending.lock().unwrap().status();
    let reply = crate::chat_access::reply(status, Some(pending), None);
    assert_eq!(
        reply.as_object().unwrap().keys().collect::<Vec<_>>(),
        ["status"]
    );
    reply
}

fn follow(bench: &Bench, cx: &mut gpui::VisualTestContext) {
    bench.view.update(cx, |app, _| {
        app.patient.synthesis.area.follow_chat();
    });
}

fn open(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
    let (pending, remote) = function_request(Function::Synthesis);
    bench.view.update(cx, |app, cx| {
        app.open_chat_function(&pending, Function::Synthesis, cx)
    });
    cx.run_until_parked();
    follow(bench, cx);
    (pending, remote)
}

fn opened(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
    paired(bench, cx);
    admission(bench, true);
    bench.switch("enabled");
    let opened = open(bench, cx);
    assert_eq!(reply(&opened.0), json!({"status":"synthesis-opened"}));
    opened
}

#[gpui::test]
fn chat_waits_for_native_document_choice_and_consent(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let (pending, _remote) = opened(&bench, cx);
    bench.view.read_with(cx, |app, _| {
        assert_eq!(app.patient_section, PatientSection::Documents);
        assert!(matches!(
            app.patient.synthesis.area.phase,
            GenerationPhase::Idle
        ));
        assert!(
            app.synthesis_chat_notice()
                .unwrap()
                .contains("Scegli un documento")
        );
    });
    assert!(!bench.host.routes().contains(&detail_route()));
    assert!(bench.generation_routes().is_empty());
    let routes = bench.host.routes();
    let position = |route: &str| routes.iter().position(|seen| seen == route).unwrap();
    assert!(position(ELIGIBILITY) < position(SETTING));
    assert!(position(CHAT_EPOCH) < position(SETTING));
    prepare(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"synthesis-opened"}));
    bench.until_preview();
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| app.synthesis_confirm(cx));
    cx.run_until_parked();
    assert!(answer.join().unwrap());
    follow(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"synthesis-closed"}));
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        GenerationPhase::Proposal { .. }
    )));
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn admission_in_flight_blocks_native_clicks_and_a_second_chat(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    paired(&bench, cx);
    admission(&bench, true);
    bench.switch("enabled");
    let (first, _remote) = function_request(Function::Synthesis);
    let (second, _other) = function_request(Function::Synthesis);
    bench.view.update(cx, |app, cx| {
        app.patient.document_details_id = None;
        app.open_chat_function(&first, Function::Synthesis, cx);
        assert!(!app.patient.synthesis.area.chat_ready());
        app.toggle_document_details(&text("attachmentId"), cx);
        assert!(app.patient.document_details_id.is_none());
        app.synthesis_prepare(&text("attachmentId"), cx);
        app.synthesis_confirm(cx);
        app.open_chat_function(&second, Function::Synthesis, cx);
        assert!(matches!(
            app.patient.synthesis.area.phase,
            GenerationPhase::Checking
        ));
    });
    assert_eq!(reply(&second), json!({"status":"synthesis-busy"}));
    cx.run_until_parked();
    assert_eq!(reply(&first), json!({"status":"synthesis-opened"}));
    assert!(!bench.host.routes().contains(&detail_route()));
    assert!(bench.generation_routes().is_empty());
}

#[gpui::test]
fn idle_document_choice_and_empty_list_remain_owned_until_revocation(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    let (pending, _remote) = opened(&bench, cx);
    bench.view.update(cx, |app, _| {
        app.patient.attachments = ReadLoad::Ready(vec![])
    });
    follow(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"synthesis-opened"}));
    bench.view.read_with(cx, |app, _| {
        assert!(
            app.synthesis_chat_notice()
                .unwrap()
                .contains("Nessun documento")
        );
        assert!(app.patient.synthesis.area.occupied());
    });
    let (second, _other) = open(&bench, cx);
    assert_eq!(reply(&second), json!({"status":"synthesis-busy"}));
    pending.lock().unwrap().revoke();
    follow(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"withdrawn"}));
    bench
        .view
        .read_with(cx, |app, _| assert!(app.synthesis_chat_notice().is_none()));
    assert!(bench.generation_routes().is_empty());
}

#[gpui::test]
fn revocation_before_consent_and_after_a_second_choice_sends_nothing(
    cx: &mut gpui::TestAppContext,
) {
    for change in ["revoke", "eof", "lock", "second-choice"] {
        let (bench, cx) = bench(cx);
        let (pending, remote) = opened(&bench, cx);
        let mut remote = Some(remote);
        prepare(&bench, cx);
        if change == "second-choice" {
            let mut second = row();
            second.id = "document-synthetic-second".into();
            bench.view.update(cx, |app, _| {
                app.patient.attachments = ReadLoad::Ready(vec![row(), second.clone()]);
            });
            bench.switch("enabled");
            let mut detail = wire(true);
            detail["id"] = json!(second.id);
            bench
                .host
                .plan(&format!(
                    "GET /api/v1/network/patients/{}/attachments/{}",
                    text("patientId"),
                    second.id
                ))
                .send((200, detail))
                .unwrap();
            bench
                .view
                .update(cx, |app, cx| app.synthesis_prepare(&second.id, cx));
            cx.run_until_parked();
            assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Consent(_))));
            assert_eq!(reply(&pending), json!({"status":"synthesis-opened"}));
        }
        bench.until_preview();
        bench.respond(PREVIEW, "response-available");
        bench.view.update(cx, |app, cx| {
            match change {
                "eof" => drop(remote.take()),
                "lock" => bench.host.session.lock(),
                _ => pending.lock().unwrap().revoke(),
            }
            app.synthesis_confirm(cx);
        });
        cx.run_until_parked();
        assert!(
            bench.generation_routes().is_empty(),
            "{change}: nessuna richiesta al modello"
        );
        assert!(
            !bench.phase(cx, |phase| matches!(
                phase,
                GenerationPhase::Running { .. } | GenerationPhase::Proposal { .. }
            )),
            "{change}"
        );
        assert_eq!(reply(&pending), json!({"status":"withdrawn"}), "{change}");
        bench.assert_no_clinical_write();
    }
}

#[gpui::test]
fn late_answer_after_chat_revocation_is_not_shown(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let (pending, _remote) = opened(&bench, cx);
    prepare(&bench, cx);
    bench.until_preview();
    let sender = bench.host.plan(PREVIEW);
    let requests = bench.host.requests_handle();
    let revoking = pending.clone();
    let responder = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !requests
            .lock()
            .unwrap()
            .iter()
            .any(|(route, _)| route == PREVIEW)
        {
            assert!(Instant::now() < deadline, "la richiesta non è partita");
            std::thread::sleep(Duration::from_millis(5));
        }
        revoking.lock().unwrap().revoke();
        sender
            .send((200, fixture("response-available")["body"].clone()))
            .unwrap();
    });
    bench.view.update(cx, |app, cx| app.synthesis_confirm(cx));
    cx.run_until_parked();
    responder.join().unwrap();
    assert_eq!(bench.host.bodies(PREVIEW).len(), 1);
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Ended(_))));
    assert_eq!(reply(&pending), json!({"status":"withdrawn"}));
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn closed_proposal_ignores_chat_revocation_and_follows_document_currentness(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    let (pending, remote) = opened(&bench, cx);
    generate(&bench, cx);
    follow(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"synthesis-closed"}));
    let check = |cx: &mut gpui::VisualTestContext, expected| {
        bench.view.read_with(cx, |app, _| {
            let GenerationPhase::Proposal { request, .. } = &app.patient.synthesis.area.phase
            else {
                panic!("la proposta resta nella finestra");
            };
            assert!(app.patient.synthesis.area.chat.0.is_none());
            assert_eq!(app.synthesis_currency(request), expected);
        });
    };
    check(cx, SynthesisCurrency::Current);
    bench.view.update(cx, |app, _| {
        let mut changed = row();
        changed.currentness.as_mut().unwrap()["revision"] = json!(99);
        app.patient.attachments = ReadLoad::Ready(vec![changed]);
    });
    follow(&bench, cx);
    check(cx, SynthesisCurrency::Superseded);
    assert_eq!(reply(&pending), json!({"status":"synthesis-closed"}));
    pending.lock().unwrap().revoke();
    drop(remote);
    follow(&bench, cx);
    check(cx, SynthesisCurrency::Superseded);
}

#[gpui::test]
fn patient_a_b_a_retires_chat_and_cancels_its_generation(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let (pending, _remote) = opened(&bench, cx);
    prepare(&bench, cx);
    bench.view.update(cx, |app, cx| {
        app.synthesis_confirm(cx);
        let session = app.session.clone().unwrap();
        session
            .select_profile_patient(&text("ambulatoryId"), "patient-synthetic-b")
            .unwrap();
        app.next_presentation_epoch();
        show(app, "patient-synthetic-b");
        session
            .select_profile_patient(&text("ambulatoryId"), &text("patientId"))
            .unwrap();
        show(app, &text("patientId"));
    });
    cx.run_until_parked();
    assert_eq!(reply(&pending), json!({"status":"withdrawn"}));
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Idle)));
    bench
        .view
        .read_with(cx, |app, _| assert!(app.synthesis_chat_notice().is_none()));
    assert!(bench.generation_routes().is_empty());
}

#[gpui::test]
fn function_disabled_or_unreadable_is_unavailable_before_document_read(
    cx: &mut gpui::TestAppContext,
) {
    for scenario in ["disabled", "unreadable", "ineligible"] {
        let (bench, cx) = bench(cx);
        paired(&bench, cx);
        admission(&bench, scenario != "ineligible");
        if scenario == "disabled" {
            bench.switch("disabled");
        }
        if scenario == "unreadable" {
            bench
                .host
                .plan(SETTING)
                .send((500, json!({"error":"unavailable"})))
                .unwrap();
        }
        let (pending, _remote) = open(&bench, cx);
        assert_eq!(
            reply(&pending),
            json!({"status":if scenario == "ineligible" {"withdrawn"} else {"synthesis-unavailable"}})
        );
        assert!(!bench.host.routes().contains(&detail_route()));
        assert!(bench.generation_routes().is_empty());
    }
}

#[gpui::test]
fn an_active_synthesis_or_proposal_is_never_replaced(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    paired(&bench, cx);
    generate(&bench, cx);
    let ticket = bench
        .view
        .read_with(cx, |app, _| app.patient.synthesis.area.ticket.clone());
    let (pending, _remote) = open(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"synthesis-busy"}));
    assert!(
        bench
            .view
            .read_with(cx, |app, _| app.patient.synthesis.area.holds(&ticket))
    );
    bench.view.update(cx, |app, cx| app.synthesis_discard(cx));
    prepare(&bench, cx);
    let (pending, _remote) = open(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"synthesis-busy"}));
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Consent(_))));
}

#[gpui::test]
fn synthesis_and_insight_have_independent_chat_ownership(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let (synthesis, _remote) = opened(&bench, cx);
    admission(&bench, true);
    bench
        .host
        .plan("GET /api/settings/aiPatientInsightKillSwitch")
        .send((
            200,
            json!({"key":"aiPatientInsightKillSwitch","value":"enabled"}),
        ))
        .unwrap();
    let (insight, _other) = function_request(Function::Insight);
    bench.view.update(cx, |app, cx| {
        app.open_chat_function(&insight, Function::Insight, cx)
    });
    cx.run_until_parked();
    bench.view.update(cx, |app, _| {
        app.patient.insight.follow_chat();
    });
    assert_eq!(reply(&insight), json!({"status":"insight-opened"}));
    assert_eq!(reply(&synthesis), json!({"status":"synthesis-opened"}));
    synthesis.lock().unwrap().revoke();
    follow(&bench, cx);
    assert_eq!(reply(&insight), json!({"status":"insight-opened"}));
    bench.view.read_with(cx, |app, _| {
        assert!(matches!(
            app.patient.insight.phase,
            GenerationPhase::Consent(_)
        ))
    });
}

#[gpui::test]
fn a_document_of_another_patient_is_not_read_or_sent(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let (pending, _remote) = opened(&bench, cx);
    bench.view.update(cx, |app, cx| {
        let mut foreign = row();
        foreign.patient_id = "patient-synthetic-foreign".into();
        app.patient.attachments = ReadLoad::Ready(vec![foreign]);
        app.synthesis_prepare(&text("attachmentId"), cx);
    });
    cx.run_until_parked();
    follow(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"synthesis-closed"}));
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Error(_))));
    assert!(!bench.host.routes().contains(&detail_route()));
    assert!(bench.generation_routes().is_empty());
}
