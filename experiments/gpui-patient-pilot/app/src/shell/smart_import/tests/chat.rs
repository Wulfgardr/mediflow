//! L'import assistito aperto dalla chat (C-7): la finestra prepara, chiede il consenso
//! e mostra la proposta; alla chat tornano solo stati.

use super::*;
use crate::chat_access::owner::{Function, Pending, tests::function_request};
use std::os::unix::net::UnixStream;

const ELIGIBILITY: &str = "GET /api/auth/native/chat-access-confirmation";
const CHAT_EPOCH: &str = "GET /api/v1/network/patient-profile/selection-epoch";

fn scope() -> String {
    chart()["ambulatoryId"].as_str().unwrap().to_owned()
}

/// Sessione abbinata con la scheda sintetica selezionata anche sul server.
fn paired(bench: &Bench) {
    bench
        .host
        .plan("GET /api/v1/network/ambulatories")
        .send((
            200,
            json!([{"id":scope(),"name":"Ambulatorio sintetico","isDefault":true,"version":1}]),
        ))
        .unwrap();
    bench.host.session.list_ambulatories().unwrap();
    bench
        .host
        .session
        .select_profile_patient(&scope(), &patient_id())
        .unwrap();
}

fn admission(bench: &Bench, eligible: bool) {
    for _ in 0..2 {
        bench.host.plan("GET /api/v1/network/identity").send((200, json!({
            "scope":{"effectiveAmbulatoryId":scope(),"requestBinding":"expected-ambulatory-id-v1"},
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
        ["status"],
        "alla chat torna solo lo stato"
    );
    reply
}

fn follow(bench: &Bench, cx: &mut gpui::VisualTestContext) {
    bench.view.update(cx, |app, _| {
        app.patient.smart_import.follow_chat();
    });
}

fn open(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
    let (pending, remote) = function_request(Function::Import);
    bench.view.update(cx, |app, cx| {
        app.open_chat_function(&pending, Function::Import, cx)
    });
    cx.run_until_parked();
    follow(bench, cx);
    (pending, remote)
}

fn opened(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
    paired(bench);
    admission(bench, true);
    bench.switch("enabled");
    let opened = open(bench, cx);
    assert_eq!(reply(&opened.0), json!({"status":"import-opened"}));
    opened
}

fn notice(bench: &Bench, cx: &mut gpui::VisualTestContext) -> Option<&'static str> {
    bench.view.read_with(cx, |app, _| app.import_chat_notice())
}

fn empty_chart(app: &mut ClinicalApp) {
    app.patient.entries = ReadLoad::Ready(vec![]);
    app.patient.attachments = ReadLoad::Ready(vec![]);
    let mut detail = app.patient.detail.ready().cloned().unwrap();
    detail.notes = None;
    app.patient.detail = ReadLoad::Ready(detail);
}

#[gpui::test]
fn chat_import_waits_for_native_preparation_and_consent(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.view.read_with(cx, |app, _| {
        assert!(app.directory, "selezione in anteprima nell’elenco")
    });
    let (pending, _remote) = opened(&bench, cx);
    bench.view.read_with(cx, |app, _| {
        assert!(
            !app.directory,
            "la chat deve aprire la scheda dall’anteprima dell’elenco"
        );
        assert_eq!(app.patient_section, PatientSection::Documents);
        assert!(matches!(
            app.patient.smart_import.phase,
            GenerationPhase::Idle
        ));
    });
    assert_eq!(
        notice(&bench, cx),
        Some("Prepara la richiesta nell’import assistito.")
    );
    assert!(rendered_buttons(&bench, cx).contains(&"smart-import-prepare".to_owned()));
    // L'ammissione sul server precede la lettura dell'interruttore; nulla verso il modello.
    let routes = bench.host.routes();
    let position = |route: &str| routes.iter().position(|seen| seen == route).unwrap();
    assert!(position(ELIGIBILITY) < position(SETTING));
    assert!(position(CHAT_EPOCH) < position(SETTING));
    assert!(bench.generation_routes().is_empty());
    prepare(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"import-opened"}));
    assert_eq!(notice(&bench, cx), None);
    bench.until_preview();
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| app.import_confirm(cx));
    cx.run_until_parked();
    assert!(answer.join().unwrap());
    follow(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"import-closed"}));
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        GenerationPhase::Proposal { .. }
    )));
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn admission_in_flight_blocks_native_clicks_and_a_second_chat(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    paired(&bench);
    admission(&bench, true);
    bench.switch("enabled");
    let (first, _remote) = function_request(Function::Import);
    let (second, _other) = function_request(Function::Import);
    bench.view.update(cx, |app, cx| {
        app.open_chat_function(&first, Function::Import, cx);
        assert!(!app.patient.smart_import.chat_ready());
        app.import_prepare(cx);
        app.import_confirm(cx);
        app.open_chat_function(&second, Function::Import, cx);
        assert!(matches!(
            app.patient.smart_import.phase,
            GenerationPhase::Checking
        ));
    });
    assert_eq!(reply(&second), json!({"status":"import-busy"}));
    assert_eq!(
        rendered_buttons(&bench, cx),
        Vec::<String>::new(),
        "nessun comando durante l'ammissione"
    );
    assert_eq!(notice(&bench, cx), None);
    cx.run_until_parked();
    assert_eq!(reply(&first), json!({"status":"import-opened"}));
    // Il clic durante l'ammissione non ha letto l'interruttore una seconda volta.
    assert_eq!(bench.host.bodies(SETTING).len(), 1);
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Idle)));
    assert!(bench.generation_routes().is_empty());
}

#[gpui::test]
fn idle_import_and_empty_chart_remain_owned_until_revocation(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let (pending, _remote) = opened(&bench, cx);
    bench.view.update(cx, |app, _| empty_chart(app));
    follow(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"import-opened"}));
    assert!(notice(&bench, cx).unwrap().starts_with("Nessuna nota"));
    assert!(
        !rendered_buttons(&bench, cx).contains(&"smart-import-prepare".to_owned()),
        "senza fonti nessun invio da preparare"
    );
    bench
        .view
        .read_with(cx, |app, _| assert!(app.patient.smart_import.occupied()));
    let (second, _other) = open(&bench, cx);
    assert_eq!(reply(&second), json!({"status":"import-busy"}));
    pending.lock().unwrap().revoke();
    follow(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"withdrawn"}));
    assert_eq!(notice(&bench, cx), None);
    assert!(bench.generation_routes().is_empty());
}

/// Revoca, fine del canale o blocco fra consenso e invio: nessuna chiamata al modello.
/// Il consenso negato chiude senza invio.
#[gpui::test]
fn import_revocation_before_consent_sends_nothing(cx: &mut gpui::TestAppContext) {
    for change in ["revoke", "eof", "lock", "decline"] {
        let (bench, cx) = bench(cx);
        let (pending, remote) = opened(&bench, cx);
        let mut remote = Some(remote);
        prepare(&bench, cx);
        assert_eq!(reply(&pending), json!({"status":"import-opened"}));
        bench.until_preview();
        bench.respond(PREVIEW, "response-available");
        bench.view.update(cx, |app, cx| {
            match change {
                "eof" => drop(remote.take()),
                "lock" => bench.host.session.lock(),
                "decline" => app.import_decline(cx),
                _ => pending.lock().unwrap().revoke(),
            }
            app.import_confirm(cx);
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
        follow(&bench, cx);
        let expected = if change == "decline" {
            "import-closed"
        } else {
            "withdrawn"
        };
        assert_eq!(reply(&pending), json!({"status":expected}), "{change}");
        bench.assert_no_clinical_write();
    }
}

#[gpui::test]
fn import_late_answer_after_chat_revocation_is_not_shown(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let (pending, _remote) = opened(&bench, cx);
    prepare(&bench, cx);
    bench.until_preview();
    let sender = bench.host.plan(PREVIEW);
    let requests = bench.host.requests_handle();
    let revoking = pending.clone();
    let responder = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let ingest = loop {
            let seen = requests.lock().unwrap().clone();
            if seen.iter().any(|(route, _)| route == PREVIEW) {
                break seen
                    .iter()
                    .rev()
                    .find(|(route, _)| route == INGEST)
                    .map(|(_, body)| body.clone())
                    .unwrap();
            }
            assert!(Instant::now() < deadline, "la richiesta non è partita");
            std::thread::sleep(Duration::from_millis(5));
        };
        revoking.lock().unwrap().revoke();
        sender
            .send((
                200,
                as_sent(&fixture("response-available")["body"], &ingest),
            ))
            .unwrap();
    });
    bench.view.update(cx, |app, cx| app.import_confirm(cx));
    cx.run_until_parked();
    responder.join().unwrap();
    assert_eq!(bench.host.bodies(PREVIEW).len(), 1);
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Ended(_))));
    assert_eq!(reply(&pending), json!({"status":"withdrawn"}));
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn closed_proposal_ignores_chat_revocation_and_follows_chart_currentness(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    let (pending, remote) = opened(&bench, cx);
    generate(&bench, cx);
    follow(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"import-closed"}));
    let check = |cx: &mut gpui::VisualTestContext, expected| {
        bench.view.read_with(cx, |app, _| {
            let GenerationPhase::Proposal { request, .. } = &app.patient.smart_import.phase else {
                panic!("la proposta resta nella finestra");
            };
            assert!(app.patient.smart_import.chat.0.is_none());
            assert_eq!(app.import_currency(request), expected);
        });
    };
    check(cx, ImportCurrency::Current);
    pending.lock().unwrap().revoke();
    drop(remote);
    follow(&bench, cx);
    check(cx, ImportCurrency::Current);
    // Una fonte cambiata o rimossa rende superata la proposta; la chat non ne sa nulla.
    bench.view.update(cx, |app, _| {
        let mut rows = app.patient.entries.ready().unwrap().clone();
        rows[0].content = "Pressione 130/80.".into();
        app.patient.entries = ReadLoad::Ready(rows);
    });
    follow(&bench, cx);
    check(cx, ImportCurrency::Superseded);
    assert_eq!(reply(&pending), json!({"status":"withdrawn"}));
    bench.assert_no_clinical_write();
}

/// Una fonte cambiata o rimossa dopo la preparazione: nessun invio, la finestra
/// conclude e la chat riceve la chiusura.
#[gpui::test]
fn chart_changed_or_removed_after_preparation_sends_nothing(cx: &mut gpui::TestAppContext) {
    for change in ["changed", "removed"] {
        let (bench, cx) = bench(cx);
        let (pending, _remote) = opened(&bench, cx);
        prepare(&bench, cx);
        bench.view.update(cx, |app, cx| {
            let mut detail = app.patient.detail.ready().cloned().unwrap();
            detail.notes = match change {
                "changed" => Some("Nota sintetica riscritta dopo la preparazione.".into()),
                _ => None,
            };
            app.patient.detail = ReadLoad::Ready(detail);
            app.import_confirm(cx);
        });
        cx.run_until_parked();
        assert!(bench.phase(
            cx,
            |phase| matches!(phase, GenerationPhase::Error(m) if m.contains("nulla è stato inviato"))
        ));
        assert!(bench.generation_routes().is_empty(), "{change}");
        follow(&bench, cx);
        assert_eq!(
            reply(&pending),
            json!({"status":"import-closed"}),
            "{change}"
        );
    }
}

/// La scheda mostrata non è quella del paziente selezionato: nulla si legge per l'invio.
#[gpui::test]
fn a_chart_of_another_patient_is_not_sent(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let (pending, _remote) = opened(&bench, cx);
    bench.view.update(cx, |app, cx| {
        let mut detail = app.patient.detail.ready().cloned().unwrap();
        detail.id = "pt-gpui-si-foreign".into();
        app.patient.detail = ReadLoad::Ready(detail);
        app.import_prepare(cx);
    });
    cx.run_until_parked();
    follow(&bench, cx);
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Error(_))));
    assert_eq!(reply(&pending), json!({"status":"import-closed"}));
    assert!(bench.host.bodies(SETTING).len() == 1);
    assert!(bench.generation_routes().is_empty());
}

#[gpui::test]
fn patient_a_b_a_retires_chat_and_cancels_its_import(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let (pending, _remote) = opened(&bench, cx);
    prepare(&bench, cx);
    bench.view.update(cx, |app, cx| {
        app.import_confirm(cx);
        let session = app.session.clone().unwrap();
        session
            .select_profile_patient(&scope(), "pt-gpui-si-0002")
            .unwrap();
        app.next_presentation_epoch();
        show(app, "pt-gpui-si-0002");
        session
            .select_profile_patient(&scope(), &patient_id())
            .unwrap();
        show(app, &patient_id());
    });
    cx.run_until_parked();
    assert_eq!(reply(&pending), json!({"status":"withdrawn"}));
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Idle)));
    assert_eq!(notice(&bench, cx), None);
    assert!(bench.host.bodies(PREVIEW).is_empty());
}

/// Funzione spenta, interruttore illeggibile o host chiuso: non disponibile. Senza
/// paziente, con la sessione bloccata o con l'account non idoneo: ritirata.
#[gpui::test]
fn denials_answer_a_state_and_never_generate(cx: &mut gpui::TestAppContext) {
    for scenario in [
        "disabled",
        "unreadable",
        "host-closed",
        "no-patient",
        "locked",
        "ineligible",
    ] {
        let (bench, cx) = bench(cx);
        paired(&bench);
        admission(&bench, scenario != "ineligible");
        match scenario {
            "disabled" => bench.switch("disabled"),
            "unreadable" => {
                bench
                    .host
                    .plan(SETTING)
                    .send((500, json!({"error":"unavailable"})))
                    .unwrap();
            }
            _ => bench.switch("enabled"),
        }
        bench.view.update(cx, |app, cx| match scenario {
            "host-closed" => drop(app.local_host.withdraw(cx)),
            "no-patient" => app.selected_id = None,
            "locked" => bench.host.session.lock(),
            _ => {}
        });
        let (pending, _remote) = open(&bench, cx);
        let expected = match scenario {
            "disabled" | "unreadable" | "host-closed" => "import-unavailable",
            _ => "withdrawn",
        };
        assert_eq!(reply(&pending), json!({"status":expected}), "{scenario}");
        assert!(
            bench.phase(cx, |phase| matches!(
                phase,
                GenerationPhase::Idle | GenerationPhase::Ended(_)
            )),
            "{scenario}"
        );
        bench.view.read_with(cx, |app, _| {
            assert!(app.patient.smart_import.chat.0.is_none(), "{scenario}")
        });
        assert!(bench.generation_routes().is_empty(), "{scenario}");
    }
}

#[gpui::test]
fn an_active_import_or_proposal_is_never_replaced(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    paired(&bench);
    generate(&bench, cx);
    let ticket = bench
        .view
        .read_with(cx, |app, _| app.patient.smart_import.ticket.clone());
    let (pending, _remote) = open(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"import-busy"}));
    assert!(
        bench
            .view
            .read_with(cx, |app, _| app.patient.smart_import.holds(&ticket))
    );
    bench.view.update(cx, |app, cx| app.import_discard(cx));
    prepare(&bench, cx);
    let (pending, _remote) = open(&bench, cx);
    assert_eq!(reply(&pending), json!({"status":"import-busy"}));
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Consent(_))));
}

/// Un'apertura ammessa sostituisce le altre richieste ancora aperte. La revoca
/// dell'import non ripristina quelle sostituite e non avvia generazioni.
#[gpui::test]
fn switching_import_closes_other_function_requests_without_generation(
    cx: &mut gpui::TestAppContext,
) {
    let (bench, cx) = bench(cx);
    paired(&bench);
    admission(&bench, true);
    bench
        .host
        .plan("GET /api/settings/aiPatientInsightKillSwitch")
        .send((
            200,
            json!({"key":"aiPatientInsightKillSwitch","value":"enabled"}),
        ))
        .unwrap();
    let (insight, _a) = function_request(Function::Insight);
    bench.view.update(cx, |app, cx| {
        app.open_chat_function(&insight, Function::Insight, cx)
    });
    cx.run_until_parked();
    bench.view.update(cx, |app, _| {
        app.patient.insight.follow_chat();
    });
    assert_eq!(reply(&insight), json!({"status":"insight-opened"}));
    let insight_ticket = bench
        .view
        .read_with(cx, |app, _| app.patient.insight.ticket.clone());

    admission(&bench, true);
    bench
        .host
        .plan("GET /api/settings/aiDocumentSynthesisKillSwitch")
        .send((
            200,
            json!({"key":"aiDocumentSynthesisKillSwitch","value":"enabled"}),
        ))
        .unwrap();
    let (synthesis, _b) = function_request(Function::Synthesis);
    bench.view.update(cx, |app, cx| {
        app.open_chat_function(&synthesis, Function::Synthesis, cx)
    });
    cx.run_until_parked();
    bench.view.update(cx, |app, _| {
        app.patient.synthesis.area.follow_chat();
    });
    assert_eq!(reply(&synthesis), json!({"status":"synthesis-opened"}));

    admission(&bench, true);
    bench.switch("enabled");
    let (import, _c) = open(&bench, cx);
    assert_eq!(reply(&import), json!({"status":"import-opened"}));
    bench.view.read_with(cx, |app, _| {
        assert!(!app.patient.insight.holds(&insight_ticket));
        assert!(matches!(app.patient.insight.phase, GenerationPhase::Idle));
    });
    assert_eq!(reply(&insight), json!({"status":"withdrawn"}));
    assert_eq!(reply(&synthesis), json!({"status":"withdrawn"}));

    import.lock().unwrap().revoke();
    bench.view.update(cx, |app, _| {
        app.patient.insight.follow_chat();
        app.patient.synthesis.area.follow_chat();
        app.patient.smart_import.follow_chat();
    });
    assert_eq!(reply(&import), json!({"status":"withdrawn"}));
    assert_eq!(reply(&insight), json!({"status":"withdrawn"}));
    assert_eq!(reply(&synthesis), json!({"status":"withdrawn"}));
    synthesis.lock().unwrap().revoke();
    insight.lock().unwrap().revoke();
    follow(&bench, cx);
    assert!(bench.generation_routes().is_empty());
}
