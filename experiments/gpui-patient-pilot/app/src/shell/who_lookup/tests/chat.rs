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
        Function::Icd => None,
    };
    if let Some(key) = key {
        bench
            .host
            .plan(&format!("GET /api/settings/{key}"))
            .send((200, json!({"key":key,"value":"enabled"})))
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
    let mut failures = vec![];
    let mut checked = 0;
    for empty in [false, true] {
        for before in Function::ALL {
            for completed in [false, true] {
                if completed && before != Function::Icd {
                    continue;
                }
                for requested in Function::ALL {
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
                        json!({"status":State::Generative(before,Stage::Opened).wire()}),
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
                        let expected = if completed { "icd-closed" } else { "withdrawn" };
                        assert_eq!(
                            wire(&first),
                            json!({"status":expected}),
                            "la funzione sostituita non resta aperta"
                        );
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
    assert_eq!(checked, 40);
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
