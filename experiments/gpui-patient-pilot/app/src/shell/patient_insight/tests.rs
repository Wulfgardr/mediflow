//! Stati del Quadro paziente in GPUI contro un host sintetico: le risposte sono
//! quelle registrate dall'handler reale (`lib/patient-insight-gpui-contract.test.ts`).

use super::*;
use crate::shell::notes_recovery_tests::Host;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../transport/tests/fixtures/patient_insight"
);
const SETTING: &str = "GET /api/settings/aiPatientInsightKillSwitch";
const PREVIEW: &str = "POST /api/ai/patient-insight/preview";

fn fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{FIXTURES}/{name}.json")).unwrap())
        .unwrap()
}

/// La scheda del file di cattura, come GPUI la riceve già decifrata.
fn records(id: &str) -> (PatientDetail, Vec<Therapy>, Vec<Entry>) {
    let capture = fixture("capture");
    let patient = &capture["patient"];
    let detail: PatientDetail = serde_json::from_value(json!({
        "id": id, "firstName": "Ada", "lastName": "Sintetica", "birthDate": null,
        "taxCode": "SYNTHETIC", "address": null, "phone": null, "caregiver": null,
        "exemptions": null, "diagnoses": patient["diagnoses"].to_string(),
        "monitoringProfile": null, "statusReason": null, "archiveReason": null,
        "archiveNote": null, "notes": null, "isAdi": false, "isArchived": false,
        // Il profilo abbinato non porta l'ambulatorio: GPUI usa quello selezionato.
        "version": patient["version"], "ambulatoryId": null,
        "createdAt": null, "updatedAt": null, "deletedAt": null,
    }))
    .unwrap();
    let therapies = capture["therapies"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(index, row)| {
            serde_json::from_value(json!({
                "id": format!("t{index}"), "patientId": id, "drugName": row["drugName"],
                "aic": null, "atc": null, "activePrinciple": null, "dosage": row["dosage"],
                "motivation": null, "diagnosisCode": null, "diagnosisName": null,
                "status": row["status"], "startDate": "2026-01-01", "endDate": null,
                "version": 1, "createdAt": null, "updatedAt": null, "deletedAt": null,
                "deletionReason": null,
            }))
            .unwrap()
        })
        .collect();
    let entries = capture["entries"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(index, row)| {
            serde_json::from_value(json!({
                "id": format!("e{index}"), "patientId": id, "type": "note",
                "title": row["title"], "content": row["content"],
                // Dalla più recente, come nel file di cattura.
                "date": format!("2026-11-{:02}", 9 - index), "setting": null,
                "metadata": null, "attachments": null, "version": 1, "recordedBy": null,
                "createdAt": null, "updatedAt": null, "deletedAt": null, "deletionReason": null,
            }))
            .unwrap()
        })
        .collect();
    (detail, therapies, entries)
}

fn show(app: &mut ClinicalApp, id: &str) {
    let (detail, therapies, entries) = records(id);
    app.scope = Some(
        fixture("capture")["patient"]["ambulatoryId"]
            .as_str()
            .unwrap()
            .to_owned(),
    );
    app.selected_id = Some(id.to_owned());
    app.patient = PatientData::default();
    app.patient.detail = ReadLoad::Ready(detail);
    app.patient.therapies = ReadLoad::Ready(therapies);
    app.patient.entries = ReadLoad::Ready(entries);
}

struct Bench {
    host: Host,
    view: Entity<ClinicalApp>,
}

fn bench(cx: &mut gpui::TestAppContext) -> (Bench, &mut gpui::VisualTestContext) {
    let host = Host::new();
    let access = Arc::new(
        host.session
            .authenticate_local_host(
                "Synthetic scales fixture passphrase",
                mediflow_runtime_client::RetirementNotice::new(None),
            )
            .unwrap(),
    );
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    view.update(cx, |app, _| {
        app.local_host.test_access(access);
        show(app, "pi-gpui-synthetic-0001");
    });
    (Bench { host, view }, cx)
}

impl Bench {
    fn switch(&self, value: &str) {
        self.host
            .plan(SETTING)
            .send((
                200,
                json!({"key": "aiPatientInsightKillSwitch", "value": value}),
            ))
            .unwrap();
    }
    /// Risponde alla generazione con un file registrato, adattato alla richiesta
    /// arrivata (ora di cattura nuova). Restituisce il thread che risponde.
    fn answer(&self, name: &'static str) -> std::thread::JoinHandle<bool> {
        let sender = self.host.plan(PREVIEW);
        let seen = self.host.bodies(PREVIEW).len();
        let requests = self.host.requests_handle();
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let body = loop {
                let bodies: Vec<Value> = requests
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|(route, _)| route == PREVIEW)
                    .map(|(_, body)| body.clone())
                    .collect();
                if let Some(body) = bodies.get(seen) {
                    break body.clone();
                }
                if Instant::now() > deadline {
                    // Nessuna richiesta: il canale si chiude senza risposta.
                    return false;
                }
                std::thread::sleep(Duration::from_millis(5));
            };
            let mut response = fixture(name);
            // `pointer_mut`, non l'indice: l'indice trasformerebbe `proposal: null` in un oggetto.
            if let Some(currentness) = response
                .pointer_mut("/body/preview/proposal/currentness")
                .and_then(Value::as_object_mut)
            {
                currentness.insert("capturedAt".into(), body["capturedAt"].clone());
            }
            let status = response["status"].as_u64().unwrap() as u16;
            sender.send((status, response["body"].clone())).is_ok()
        })
    }
    fn phase<R>(
        &self,
        cx: &mut gpui::VisualTestContext,
        read: impl FnOnce(&InsightPhase) -> R,
    ) -> R {
        self.view
            .read_with(cx, |app, _| read(&app.patient.insight.phase))
    }
    /// Solo lettura dell'interruttore e anteprima: nessuna altra rotta, nessuna scrittura.
    fn assert_no_clinical_write(&self) {
        for route in self.host.routes() {
            assert!(
                route.starts_with("GET ")
                    || route == PREVIEW
                    || route.starts_with("POST /api/auth/"),
                "rotta inattesa dopo il Quadro paziente: {route}"
            );
        }
    }
}

fn prepare(bench: &Bench, cx: &mut gpui::VisualTestContext) {
    bench.switch("enabled");
    bench.view.update(cx, |app, cx| app.insight_prepare(cx));
    cx.run_until_parked();
    assert!(bench.phase(cx, |phase| matches!(phase, InsightPhase::Consent(_))));
}

fn rendered_buttons(bench: &Bench, cx: &mut gpui::VisualTestContext) -> Vec<String> {
    bench.view.update(cx, |app, cx| {
        rendered_command::button_ids(|| {
            let _ = app.patient_insight_view(cx);
        })
    })
}

#[gpui::test]
fn proposal_is_shown_with_its_sources_and_receipt(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    assert!(
        bench.host.bodies(PREVIEW).is_empty(),
        "il consenso precede l'invio"
    );
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| app.insight_confirm(cx));
    cx.run_until_parked();
    assert!(answer.join().unwrap());
    let sent = bench.host.bodies(PREVIEW);
    assert_eq!(sent.len(), 1);
    // Il corpo inviato è quello del contratto, salvo identificativo e ora nuovi.
    let mut expected = fixture("request");
    expected["requestId"] = sent[0]["requestId"].clone();
    expected["capturedAt"] = sent[0]["capturedAt"].clone();
    assert_eq!(sent[0], expected);
    bench.view.read_with(cx, |app, _| {
        let InsightPhase::Proposal { request, proposal } = &app.patient.insight.phase else {
            panic!("la risposta disponibile è una proposta");
        };
        assert!(app.insight_is_current(request, proposal));
        let lines = insight_lines(request, proposal);
        assert_eq!(lines[0].section, "Sintesi proposta");
        assert_eq!(
            lines[0].sources,
            vec![
                "S2 · Condizione attiva: Ipertensione arteriosa essenziale (I10)".to_owned(),
                "S3 · Condizione attiva: Diabete mellito tipo 2".to_owned(),
            ]
        );
        let alert = lines
            .iter()
            .find(|line| line.section == "Attenzioni proposte")
            .unwrap();
        assert_eq!(alert.sources, vec!["S6 · Terapia corrente: Metformina"]);
        let gap = lines
            .iter()
            .find(|line| line.section == "Dati mancanti")
            .unwrap();
        assert!(gap.sources.is_empty(), "DATI-INCOMPLETI non è una fonte");
        assert_eq!(proposal.provider, "ollama");
        assert_eq!(proposal.egress, "none");
        assert_eq!(proposal.writes_performed, 0);
    });
    let buttons = rendered_buttons(&bench, cx);
    assert!(buttons.contains(&"patient-insight-discard".to_owned()));
    assert!(
        !buttons
            .iter()
            .any(|id| id.contains("apply") || id.contains("save"))
    );
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn declined_consent_sends_nothing(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    bench.view.update(cx, |app, cx| app.insight_decline(cx));
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, InsightPhase::Ended(m) if m.contains("Nessun dato"))
    ));
    assert!(bench.host.bodies(PREVIEW).is_empty());
    // Un consenso dato dopo la rinuncia non vale: non c'è più nulla da inviare.
    bench.view.update(cx, |app, cx| app.insight_confirm(cx));
    cx.run_until_parked();
    assert!(bench.host.bodies(PREVIEW).is_empty());
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn kill_switch_off_is_unavailable_without_generation(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.switch("disabled");
    bench.view.update(cx, |app, cx| app.insight_prepare(cx));
    cx.run_until_parked();
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        InsightPhase::Unavailable(m) if m.contains("spento sull'host")
    )));
    assert!(bench.host.bodies(PREVIEW).is_empty());
    let buttons = rendered_buttons(&bench, cx);
    assert!(!buttons.contains(&"patient-insight-confirm".to_owned()));
    bench.view.update(cx, |app, cx| app.insight_confirm(cx));
    cx.run_until_parked();
    assert!(bench.host.bodies(PREVIEW).is_empty());
}

#[gpui::test]
fn host_closed_is_unavailable_without_any_call(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.view.update(cx, |app, cx| {
        drop(app.local_host.withdraw(cx));
        app.insight_prepare(cx);
    });
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, InsightPhase::Unavailable(m) if m.contains("Host locale chiuso"))
    ));
    assert!(bench.host.bodies(SETTING).is_empty());
    assert!(bench.host.bodies(PREVIEW).is_empty());
}

/// Il server resta l'autorità: un diniego arrivato alla generazione (funzione spenta
/// nel frattempo, modello assente) è «non disponibile», gli altri esiti sono errori.
#[gpui::test]
fn server_refusals_are_readable_and_create_no_proposal(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    for (name, unavailable, text) in [
        ("response-function-disabled", true, "spento sull'host"),
        ("response-kill-switch", true, "spento sull'host"),
        (
            "response-proposal-invalid",
            false,
            "non ha superato i controlli dell'host",
        ),
        (
            "response-provider-failed",
            false,
            "non ha completato la risposta",
        ),
        (
            "response-stale",
            false,
            "sono cambiati durante la generazione",
        ),
    ] {
        prepare(&bench, cx);
        let answer = bench.answer(name);
        bench.view.update(cx, |app, cx| app.insight_confirm(cx));
        cx.run_until_parked();
        assert!(answer.join().unwrap(), "{name}");
        bench.phase(cx, |phase| match phase {
            InsightPhase::Unavailable(message) if unavailable => {
                assert!(message.contains(text), "{name}: {message}")
            }
            InsightPhase::Error(message) if !unavailable => {
                assert!(message.contains(text), "{name}: {message}")
            }
            InsightPhase::Unavailable(m) | InsightPhase::Error(m) | InsightPhase::Ended(m) => {
                panic!("{name}: stato inatteso: {m}")
            }
            InsightPhase::Running { .. } => panic!("{name}: ancora in corso"),
            _ => panic!("{name}: stato inatteso"),
        });
    }
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn altered_response_is_an_error_not_a_proposal(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    let sender = bench.host.plan(PREVIEW);
    let mut body = fixture("response-available")["body"].clone();
    // Una fonte che non esiste fra quelle inviate.
    body["preview"]["proposal"]["summary"] = json!("Fonte inesistente. [S99]");
    sender.send((200, body)).unwrap();
    bench.view.update(cx, |app, cx| app.insight_confirm(cx));
    cx.run_until_parked();
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        InsightPhase::Error(m) if m.contains("controlli di GPUI")
    )));
}

#[gpui::test]
fn stop_during_generation_discards_the_late_answer(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| {
        app.insight_confirm(cx);
        assert!(matches!(
            app.patient.insight.phase,
            InsightPhase::Running { .. }
        ));
        assert!(
            rendered_command::button_ids(|| {
                let _ = app.patient_insight_view(cx);
            })
            .contains(&"patient-insight-stop".to_owned())
        );
        app.insight_stop(cx);
    });
    cx.run_until_parked();
    // Il contesto annullato ferma la richiesta prima che lasci GPUI.
    assert!(
        !answer.join().unwrap(),
        "nessuna richiesta dopo l'annullamento"
    );
    assert!(bench.host.bodies(PREVIEW).is_empty());
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        InsightPhase::Ended(m) if m.contains("Generazione interrotta")
    )));
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn discard_revokes_the_shown_proposal(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| app.insight_confirm(cx));
    cx.run_until_parked();
    assert!(answer.join().unwrap());
    assert!(bench.phase(cx, |phase| matches!(phase, InsightPhase::Proposal { .. })));
    let routes = bench.host.routes().len();
    bench.view.update(cx, |app, cx| app.insight_discard(cx));
    cx.run_until_parked();
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        InsightPhase::Ended(m) if m.contains("scartata")
    )));
    assert_eq!(
        bench.host.routes().len(),
        routes,
        "lo scarto non chiama l'host"
    );
    bench.assert_no_clinical_write();
}

/// Una proposta già mostrata diventa obsoleta se la scheda cambia revisione.
#[gpui::test]
fn proposal_becomes_obsolete_when_the_record_changes(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| app.insight_confirm(cx));
    cx.run_until_parked();
    assert!(answer.join().unwrap());
    bench.view.update(cx, |app, cx| {
        if let ReadLoad::Ready(detail) = &mut app.patient.detail {
            detail.version += 1;
        }
        let InsightPhase::Proposal { request, proposal } = &app.patient.insight.phase else {
            panic!("proposta attesa");
        };
        assert!(!app.insight_is_current(request, proposal));
        let buttons = rendered_command::button_ids(|| {
            let _ = app.patient_insight_view(cx);
        });
        assert!(buttons.contains(&"patient-insight-discard".to_owned()));
    });
}

/// La risposta di una richiesta partita sul paziente A, arrivata dopo il passaggio a B,
/// non compare sulla scheda di B.
#[gpui::test]
fn late_answer_never_lands_on_the_next_patient(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    let answer = bench.answer("response-available");
    let ticket = bench.view.update(cx, |app, cx| {
        app.insight_confirm(cx);
        assert!(matches!(
            app.patient.insight.phase,
            InsightPhase::Running { .. }
        ));
        let ticket = app.patient.insight.ticket.clone();
        // Lo stesso passaggio di `select_patient`: nuova presentazione, nuova scheda.
        app.next_presentation_epoch();
        show(app, "pi-gpui-synthetic-0002");
        ticket
    });
    cx.run_until_parked();
    // Il contesto annullato ferma la richiesta prima che lasci GPUI.
    assert!(
        !answer.join().unwrap(),
        "nessuna richiesta dopo l'annullamento"
    );
    assert!(bench.host.bodies(PREVIEW).is_empty());
    assert!(bench.phase(cx, |phase| matches!(phase, InsightPhase::Idle)));
    // Anche consegnata a mano, la risposta di A non entra nella scheda di B.
    let late = mediflow_runtime_client::patient_insight_outcome(
        &build_patient_insight_request(&fixture("capture")).unwrap(),
        200,
        fixture("response-available")["body"].to_string().as_bytes(),
    );
    bench.view.update(cx, |app, cx| {
        app.patient.insight.phase = InsightPhase::Running {
            request: Box::new(build_patient_insight_request(&fixture("capture")).unwrap()),
            context: mediflow_runtime_client::RequestContext::default(),
        };
        app.insight_receive(&ticket, "pi-gpui-synthetic-0001", late.clone(), cx);
        assert!(matches!(
            app.patient.insight.phase,
            InsightPhase::Running { .. }
        ));
        let current = app.patient.insight.ticket.clone();
        app.insight_receive(&current, "pi-gpui-synthetic-0001", late, cx);
        assert!(
            matches!(app.patient.insight.phase, InsightPhase::Running { .. }),
            "una risposta per un altro paziente non è di questa scheda"
        );
    });
    bench.assert_no_clinical_write();
}

/// Un campo cifrato illeggibile non diventa testo vuoto inviato al modello.
#[gpui::test]
fn unreadable_diagnoses_block_the_request(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.view.update(cx, |app, _| {
        if let ReadLoad::Ready(detail) = &mut app.patient.detail {
            detail.locked_fields.push("diagnoses".into());
        }
    });
    bench.switch("enabled");
    bench.view.update(cx, |app, cx| app.insight_prepare(cx));
    cx.run_until_parked();
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        InsightPhase::Unavailable(m) if m.contains("non sono leggibili")
    )));
    assert!(bench.host.bodies(PREVIEW).is_empty());
}

fn shown_proposal(bench: &Bench, cx: &mut gpui::VisualTestContext) {
    prepare(bench, cx);
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| app.insight_confirm(cx));
    cx.run_until_parked();
    assert!(answer.join().unwrap());
    assert!(bench.phase(cx, |phase| matches!(phase, InsightPhase::Proposal { .. })));
}

fn proposal_is_current(bench: &Bench, cx: &mut gpui::VisualTestContext) -> bool {
    bench.view.read_with(cx, |app, _| {
        let InsightPhase::Proposal { request, proposal } = &app.patient.insight.phase else {
            panic!("proposta attesa");
        };
        app.insight_is_current(request, proposal)
    })
}

/// Rilievo Codex su #892: modificare una voce di diario alza solo la versione della
/// voce, non quella del paziente. La proposta mostrata non deve restare attuale.
#[gpui::test]
fn proposal_is_superseded_when_a_diary_entry_changes(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    shown_proposal(&bench, cx);
    assert!(proposal_is_current(&bench, cx));
    bench.view.update(cx, |app, cx| {
        // Diario riletto dopo il salvataggio: stessa revisione del paziente.
        if let ReadLoad::Ready(entries) = &mut app.patient.entries {
            entries[1].content = "Telefonata con la figlia: febbre da due giorni.".into();
            entries[1].version += 1;
        }
        cx.notify();
    });
    assert!(!proposal_is_current(&bench, cx));
    // Dichiarata superata, non cancellata in silenzio: resta chiudibile e rigenerabile.
    assert!(bench.phase(cx, |phase| matches!(phase, InsightPhase::Proposal { .. })));
    let buttons = rendered_buttons(&bench, cx);
    assert!(buttons.contains(&"patient-insight-discard".to_owned()));
    assert!(buttons.contains(&"patient-insight-prepare".to_owned()));
}

/// Sezioni in rilettura: finché diario o terapie non sono di nuovo letti, la proposta
/// non vale come attuale.
#[gpui::test]
fn proposal_is_not_current_while_sections_reload(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    shown_proposal(&bench, cx);
    bench
        .view
        .update(cx, |app, _| app.patient.entries = ReadLoad::loading());
    assert!(!proposal_is_current(&bench, cx));
}

/// Stesso caso per le terapie: una terapia modificata o aggiunta.
#[gpui::test]
fn proposal_is_superseded_when_therapies_change(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    shown_proposal(&bench, cx);
    bench.view.update(cx, |app, _| {
        if let ReadLoad::Ready(therapies) = &mut app.patient.therapies {
            therapies[0].dosage = "10 mg una volta al giorno".into();
            therapies[0].version += 1;
        }
    });
    assert!(!proposal_is_current(&bench, cx));
    let (bench, cx2) = (bench, cx);
    bench.view.update(cx2, |app, _| {
        let (_, mut therapies, _) = records("pi-gpui-synthetic-0001");
        let mut added = therapies[0].clone();
        added.id = "t-nuova".into();
        added.drug_name = "Bisoprololo".into();
        therapies.push(added);
        app.patient.therapies = ReadLoad::Ready(therapies);
    });
    assert!(!proposal_is_current(&bench, cx2));
}

/// Controesempio: rilettura con lo stesso contenuto (versioni uguali o alzate senza
/// cambiare il testo inviato) non rende obsoleta la proposta.
#[gpui::test]
fn proposal_stays_current_when_reread_without_changes(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    shown_proposal(&bench, cx);
    bench.view.update(cx, |app, _| {
        let (_, therapies, entries) = records("pi-gpui-synthetic-0001");
        app.patient.therapies = ReadLoad::Ready(therapies);
        app.patient.entries = ReadLoad::Ready(entries);
    });
    assert!(proposal_is_current(&bench, cx));
}

/// Comando della chat (C-7): il Quadro si apre nella finestra, alla chat tornano solo stati.
#[cfg(target_os = "macos")]
mod chat {
    use super::*;
    use crate::chat_access::owner::{Pending, State as ChatState, tests::insight_request};
    use std::os::unix::net::UnixStream;

    const ELIGIBILITY: &str = "GET /api/auth/native/chat-access-confirmation";
    const EPOCH: &str = "GET /api/v1/network/patient-profile/selection-epoch";
    const FIRST: &str = "pi-gpui-synthetic-0001";
    const SCOPE: &str = "ambulatory-synthetic-01";

    /// L'host sintetico conferma l'ambulatorio della scheda per ogni richiesta con scope.
    fn identity(bench: &Bench) {
        bench
            .host
            .plan("GET /api/v1/network/identity")
            .send((
                200,
                json!({"scope": {"effectiveAmbulatoryId": SCOPE, "requestBinding": "expected-ambulatory-id-v1"},
                    "operator": {"userId": "synthetic-user", "authChannel": "native"}}),
            ))
            .unwrap();
    }

    /// La GPUI è abbinata e la selezione della sessione è la scheda mostrata.
    fn paired(bench: &Bench, cx: &mut gpui::VisualTestContext) {
        let session = bench.host.session.clone();
        bench
            .host
            .plan("GET /api/v1/network/ambulatories")
            .send((
                200,
                json!([{"id": SCOPE, "name": "Ambulatorio sintetico", "isDefault": true, "version": 1}]),
            ))
            .unwrap();
        session.list_ambulatories().unwrap();
        bench.view.update(cx, |app, _| {
            session
                .select_profile_patient(app.scope.as_deref().unwrap(), FIRST)
                .unwrap();
            app.session = Some(session);
        });
    }
    /// Risposte del server all'ammissione: account idoneo e stessa epoca di selezione.
    fn admission(bench: &Bench, eligible: bool) {
        let status = if eligible { "eligible" } else { "ineligible" };
        identity(bench);
        identity(bench);
        bench
            .host
            .plan(ELIGIBILITY)
            .send((200, json!({ "status": status })))
            .unwrap();
        bench
            .host
            .plan(EPOCH)
            .send((200, json!({"contractVersion": 1, "selectionEpoch": 0})))
            .unwrap();
    }
    /// La riga che il socket restituirebbe alla chat in questo momento.
    fn wire(pending: &Pending) -> Value {
        let status = pending.lock().unwrap().status();
        crate::chat_access::reply(status, Some(pending), None)
    }
    fn open(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
        let (pending, remote) = insight_request();
        bench
            .view
            .update(cx, |app, cx| app.open_chat_insight(&pending, cx));
        cx.run_until_parked();
        bench.view.update(cx, |app, cx| app.poll_chat_insight(cx));
        (pending, remote)
    }
    fn opened(bench: &Bench, cx: &mut gpui::VisualTestContext) -> (Pending, UnixStream) {
        paired(bench, cx);
        bench.switch("enabled");
        admission(bench, true);
        let (pending, remote) = open(bench, cx);
        assert_eq!(wire(&pending), json!({"status": "insight-opened"}));
        (pending, remote)
    }
    fn position(bench: &Bench, route: &str) -> Option<usize> {
        bench
            .host
            .routes()
            .iter()
            .position(|seen| seen.starts_with(route))
    }

    #[gpui::test]
    fn chat_opens_the_selected_patient_quadro_and_receives_only_states(
        cx: &mut gpui::TestAppContext,
    ) {
        let (bench, cx) = bench(cx);
        bench.view.update(cx, |app, _| {
            app.patient_section = PatientSection::Therapies;
        });
        let (pending, _remote) = opened(&bench, cx);
        // Il server ammette la richiesta prima che GPUI legga l'interruttore.
        assert!(position(&bench, ELIGIBILITY) < position(&bench, SETTING));
        assert!(position(&bench, EPOCH) < position(&bench, SETTING));
        bench.view.read_with(cx, |app, _| {
            let InsightPhase::Consent(request) = &app.patient.insight.phase else {
                panic!("il Quadro attende il consenso nella finestra");
            };
            assert_eq!(request.patient_id, FIRST);
            assert_eq!(app.patient_section, PatientSection::Overview);
        });
        assert!(
            bench.host.bodies(PREVIEW).is_empty(),
            "il consenso nella finestra precede l'invio"
        );
        let answer = bench.answer("response-available");
        bench.view.update(cx, |app, cx| app.insight_confirm(cx));
        cx.run_until_parked();
        assert!(answer.join().unwrap());
        bench.view.update(cx, |app, cx| app.poll_chat_insight(cx));
        let lines = bench.view.read_with(cx, |app, _| {
            let InsightPhase::Proposal { proposal, .. } = &app.patient.insight.phase else {
                panic!("proposta attesa nella finestra");
            };
            assert!(
                app.patient.insight.chat.is_none(),
                "la proposta appartiene alla finestra"
            );
            let mut lines: Vec<String> = proposal
                .lines()
                .into_iter()
                .map(|(_, text)| text.to_owned())
                .collect();
            lines.extend([proposal.model.clone(), proposal.review_ref.clone()]);
            lines
        });
        // Con la proposta mostrata la chat non possiede più il Quadro.
        let reply = wire(&pending);
        assert_eq!(reply, json!({"status": "insight-closed"}));
        let text = reply.to_string();
        for line in lines.iter().filter(|line| line.len() > 3) {
            assert!(!text.contains(line.as_str()), "testo clinico verso la chat");
        }
        assert!(!text.contains(FIRST) && !text.contains("Ipertensione"));
        bench.assert_no_clinical_write();
    }

    #[gpui::test]
    fn chat_never_replaces_a_shown_proposal(cx: &mut gpui::TestAppContext) {
        let (bench, cx) = bench(cx);
        paired(&bench, cx);
        shown_proposal(&bench, cx);
        let before = bench
            .view
            .read_with(cx, |app, _| match &app.patient.insight.phase {
                InsightPhase::Proposal { proposal, .. } => proposal.summary.clone(),
                _ => unreachable!(),
            });
        let routes = bench.host.routes().len();
        let (pending, _remote) = open(&bench, cx);
        assert_eq!(wire(&pending), json!({"status": "insight-busy"}));
        assert_eq!(
            bench.host.routes().len(),
            routes,
            "nessuna chiamata all'host"
        );
        bench.view.read_with(cx, |app, _| {
            assert!(matches!(
                &app.patient.insight.phase,
                InsightPhase::Proposal { proposal, .. } if proposal.summary == before
            ));
            assert!(app.patient.insight.chat.is_none());
        });
    }

    #[gpui::test]
    fn chat_never_replaces_a_running_generation(cx: &mut gpui::TestAppContext) {
        let (bench, cx) = bench(cx);
        paired(&bench, cx);
        prepare(&bench, cx);
        let answer = bench.answer("response-available");
        let (pending, _remote) = insight_request();
        bench.view.update(cx, |app, cx| {
            app.insight_confirm(cx);
            app.open_chat_insight(&pending, cx);
            assert!(matches!(
                app.patient.insight.phase,
                InsightPhase::Running { .. }
            ));
        });
        assert_eq!(wire(&pending), json!({"status": "insight-busy"}));
        cx.run_until_parked();
        assert!(answer.join().unwrap());
        // La generazione chiesta dalla finestra arriva alla sua proposta.
        assert!(bench.phase(cx, |phase| matches!(phase, InsightPhase::Proposal { .. })));
        assert_eq!(bench.host.bodies(PREVIEW).len(), 1);
    }

    #[gpui::test]
    fn second_chat_request_is_busy_while_the_first_waits_for_consent(
        cx: &mut gpui::TestAppContext,
    ) {
        let (bench, cx) = bench(cx);
        let (first, _remote) = opened(&bench, cx);
        let (second, _other) = open(&bench, cx);
        assert_eq!(wire(&second), json!({"status": "insight-busy"}));
        assert_eq!(wire(&first), json!({"status": "insight-opened"}));
        assert!(bench.phase(cx, |phase| matches!(phase, InsightPhase::Consent(_))));
    }

    /// Revoca, sessione chiusa o chat chiusa durante la generazione: nessuna proposta.
    #[gpui::test]
    fn chat_withdrawal_during_generation_leaves_no_proposal(cx: &mut gpui::TestAppContext) {
        for change in ["revoke", "lock", "eof"] {
            let (bench, cx) = bench(cx);
            let (pending, remote) = opened(&bench, cx);
            let mut remote = Some(remote);
            let answer = bench.answer("response-available");
            bench.view.update(cx, |app, cx| {
                app.insight_confirm(cx);
                assert!(matches!(
                    app.patient.insight.phase,
                    InsightPhase::Running { .. }
                ));
                match change {
                    "revoke" => pending.lock().unwrap().revoke(),
                    "lock" => bench.host.session.lock(),
                    _ => drop(remote.take()),
                }
                app.poll_chat_insight(cx);
            });
            cx.run_until_parked();
            assert!(!answer.join().unwrap(), "{change}: nessuna richiesta parte");
            assert!(bench.host.bodies(PREVIEW).is_empty(), "{change}");
            // Con la sessione bloccata la finestra torna anche all'accesso: il Quadro si azzera.
            assert!(
                bench.phase(cx, |phase| match phase {
                    InsightPhase::Ended(m) => m.contains("La chat ha ritirato"),
                    InsightPhase::Idle => change == "lock",
                    _ => false,
                }),
                "{change}"
            );
            assert_eq!(wire(&pending), json!({"status": "withdrawn"}), "{change}");
            bench.assert_no_clinical_write();
        }
    }

    /// Rilievo Codex su #896: la chat ritira mentre la finestra mostra il consenso e il
    /// medico conferma prima del controllo periodico. Nessun dato deve partire.
    #[gpui::test]
    fn chat_withdrawn_before_consent_sends_nothing(cx: &mut gpui::TestAppContext) {
        for change in ["revoke", "eof"] {
            let (bench, cx) = bench(cx);
            let (pending, remote) = opened(&bench, cx);
            let mut remote = Some(remote);
            let answer = bench.answer("response-available");
            bench.view.update(cx, |app, cx| {
                match change {
                    "revoke" => pending.lock().unwrap().revoke(),
                    _ => drop(remote.take()),
                }
                // Stesso intervallo di 250 ms: nessun `poll_chat_insight` in mezzo.
                app.insight_confirm(cx);
            });
            cx.run_until_parked();
            assert!(!answer.join().unwrap(), "{change}: nessuna richiesta parte");
            assert!(bench.host.bodies(PREVIEW).is_empty(), "{change}");
            assert!(
                bench.phase(cx, |phase| matches!(
                    phase,
                    InsightPhase::Ended(m) if m.contains("La chat ha ritirato")
                )),
                "{change}"
            );
            assert_eq!(wire(&pending), json!({"status": "withdrawn"}), "{change}");
        }
    }

    /// La risposta è già in volo quando la chat ritira, prima del controllo periodico.
    #[gpui::test]
    fn late_answer_after_chat_revocation_is_not_shown(cx: &mut gpui::TestAppContext) {
        let (bench, cx) = bench(cx);
        let (pending, _remote) = opened(&bench, cx);
        let sender = bench.host.plan(PREVIEW);
        let requests = bench.host.requests_handle();
        let revoking = pending.clone();
        let responder = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !requests.lock().unwrap().iter().any(|(r, _)| r == PREVIEW) {
                assert!(Instant::now() < deadline, "la richiesta non è partita");
                std::thread::sleep(Duration::from_millis(5));
            }
            revoking.lock().unwrap().revoke();
            let response = fixture("response-available");
            let mut body = response["body"].clone();
            let sent = requests
                .lock()
                .unwrap()
                .iter()
                .find(|(r, _)| r == PREVIEW)
                .unwrap()
                .1
                .clone();
            if let Some(currentness) = body
                .pointer_mut("/preview/proposal/currentness")
                .and_then(Value::as_object_mut)
            {
                currentness.insert("capturedAt".into(), sent["capturedAt"].clone());
            }
            sender.send((200, body)).unwrap();
        });
        bench.view.update(cx, |app, cx| app.insight_confirm(cx));
        cx.run_until_parked();
        responder.join().unwrap();
        assert_eq!(bench.host.bodies(PREVIEW).len(), 1);
        assert!(bench.phase(cx, |phase| matches!(
            phase,
            InsightPhase::Ended(m) if m.contains("La chat ha ritirato")
        )));
        assert_eq!(wire(&pending), json!({"status": "withdrawn"}));
        bench.assert_no_clinical_write();
    }

    /// Cambio paziente dopo l'apertura dalla chat: la risposta tardiva non compare.
    #[gpui::test]
    fn patient_change_withdraws_the_chat_and_drops_the_late_answer(cx: &mut gpui::TestAppContext) {
        let (bench, cx) = bench(cx);
        let (pending, _remote) = opened(&bench, cx);
        let answer = bench.answer("response-available");
        bench.view.update(cx, |app, cx| {
            app.insight_confirm(cx);
            app.next_presentation_epoch();
            show(app, "pi-gpui-synthetic-0002");
            app.poll_chat_insight(cx);
        });
        cx.run_until_parked();
        assert!(!answer.join().unwrap());
        assert!(bench.host.bodies(PREVIEW).is_empty());
        assert_eq!(wire(&pending), json!({"status": "withdrawn"}));
        bench.view.read_with(cx, |app, _| {
            assert!(matches!(app.patient.insight.phase, InsightPhase::Idle));
            assert!(app.patient.insight.chat.is_none());
        });
        bench.assert_no_clinical_write();
    }

    /// Ogni diniego: alla chat solo uno stato, nessuna generazione, nessun dato inviato.
    #[gpui::test]
    fn chat_denials_return_a_state_and_never_generate(cx: &mut gpui::TestAppContext) {
        for scenario in [
            "no-session",
            "selection",
            "privacy",
            "ineligible",
            "kill-switch",
            "switch-unreadable",
            "locked",
        ] {
            let (bench, cx) = bench(cx);
            paired(&bench, cx);
            match scenario {
                "no-session" => bench.view.update(cx, |app, _| app.session = None),
                "selection" => bench
                    .host
                    .session
                    .select_profile_patient(SCOPE, "pi-gpui-synthetic-0002")
                    .unwrap(),
                "privacy" => bench.view.update(cx, |app, _| app.privacy_shield = true),
                "ineligible" => admission(&bench, false),
                "kill-switch" => {
                    admission(&bench, true);
                    bench.switch("disabled");
                }
                "switch-unreadable" => {
                    admission(&bench, true);
                    bench
                        .host
                        .plan(SETTING)
                        .send((500, json!({"error": "unavailable"})))
                        .unwrap();
                }
                _ => bench.host.session.lock(),
            }
            let (pending, _remote) = open(&bench, cx);
            let expected = if scenario == "kill-switch" {
                "insight-unavailable"
            } else {
                "withdrawn"
            };
            assert_eq!(wire(&pending), json!({ "status": expected }), "{scenario}");
            assert!(bench.host.bodies(PREVIEW).is_empty(), "{scenario}");
            let read_switch = position(&bench, SETTING).is_some();
            assert_eq!(
                read_switch,
                matches!(scenario, "kill-switch" | "switch-unreadable"),
                "{scenario}: l'interruttore si legge solo dopo l'ammissione"
            );
            bench.view.read_with(cx, |app, _| {
                assert!(app.patient.insight.chat.is_none(), "{scenario}");
                assert!(
                    !matches!(
                        app.patient.insight.phase,
                        InsightPhase::Consent(_) | InsightPhase::Proposal { .. }
                    ),
                    "{scenario}"
                );
            });
            if scenario == "kill-switch" {
                assert!(bench.phase(cx, |phase| matches!(phase, InsightPhase::Unavailable(_))));
            }
            bench.assert_no_clinical_write();
        }
    }

    #[gpui::test]
    fn chat_with_local_host_closed_is_unavailable_without_any_call(cx: &mut gpui::TestAppContext) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let session = host.session.clone();
        view.update(cx, |app, _| {
            show(app, FIRST);
            session
                .select_profile_patient(app.scope.as_deref().unwrap(), FIRST)
                .unwrap();
            app.session = Some(session);
        });
        let routes = host.routes().len();
        let (pending, _remote) = insight_request();
        view.update(cx, |app, cx| app.open_chat_insight(&pending, cx));
        cx.run_until_parked();
        assert_eq!(wire(&pending), json!({"status": "insight-unavailable"}));
        assert_eq!(host.routes().len(), routes);
        assert_eq!(
            pending.lock().unwrap().status(),
            ChatState::InsightUnavailable
        );
    }
}
