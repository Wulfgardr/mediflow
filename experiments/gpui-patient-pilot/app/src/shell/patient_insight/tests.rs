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
