//! Stati dell'import assistito in GPUI contro un host sintetico: le risposte sono
//! quelle registrate dagli handler reali (`lib/smart-import-gpui-contract.test.ts`).

use super::*;
use crate::shell::notes_recovery_tests::Host;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../transport/tests/fixtures/smart_import"
);
const SETTING: &str = "GET /api/settings/aiSmartImportKillSwitch";
const EPOCH: &str = "GET /api/ai/smart-import/selection";
const SELECT: &str = "POST /api/ai/smart-import/selection";
const INGEST: &str = "POST /api/ai/smart-import/ingest";
const PREVIEW: &str = "POST /api/ai/smart-import/preview";
/// Il prefisso delle fonti nelle risposte registrate (ordinale 1).
const RECORDED: &str = "source.local.00000000001.";

fn fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{FIXTURES}/{name}.json")).unwrap())
        .unwrap()
}
fn chart() -> Value {
    fixture("chart")
}
fn patient_id() -> String {
    chart()["patient"]["id"].as_str().unwrap().to_owned()
}

/// La scheda sintetica di `chart.json` come la legge GPUI, per il paziente `patient`.
fn show(app: &mut ClinicalApp, patient: &str) {
    let chart = chart();
    app.scope = Some(chart["ambulatoryId"].as_str().unwrap().to_owned());
    app.selected_id = Some(patient.to_owned());
    app.patient = PatientData::default();
    app.patient.detail = ReadLoad::Ready(
        serde_json::from_value(json!({
            "id": patient, "firstName": "Persona", "lastName": "Sintetica",
            "taxCode": "SYNTHETICSIGPUI01", "version": chart["patient"]["version"],
            "notes": chart["patient"]["notes"], "diagnoses": chart["patient"]["diagnoses"],
        }))
        .unwrap(),
    );
    let rows = |key: &str, extra: &dyn Fn(&Value) -> Value| -> Vec<Value> {
        chart[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                let mut value = extra(row);
                for (k, v) in row.as_object().unwrap() {
                    value[k] = v.clone();
                }
                value["patientId"] = json!(patient);
                value
            })
            .collect()
    };
    app.patient.entries = ReadLoad::Ready(
        rows("entries", &|_| json!({"version": 1}))
            .into_iter()
            .map(|v| serde_json::from_value(v).unwrap())
            .collect(),
    );
    app.patient.therapies = ReadLoad::Ready(
        rows(
            "therapies",
            &|_| json!({"startDate": "2026-01-01", "version": 1}),
        )
        .into_iter()
        .map(|v| serde_json::from_value(v).unwrap())
        .collect(),
    );
    app.patient.attachments = ReadLoad::Ready(
        rows("attachments", &|_| {
            json!({"currentness": null, "type": "application/pdf", "size": 10, "path": "sintetico",
                "parseEvidenceArtifactSnapshot": null, "ocrQueueState": null,
                "ocrQueueReason": null, "ocrQueueUpdatedAt": null})
        })
        .into_iter()
        .map(|v| serde_json::from_value(v).unwrap())
        .collect(),
    );
}

fn base36(mut n: u64) -> String {
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    while out.len() < 11 {
        out.push(b'0');
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}
/// Una risposta registrata, con le fonti numerate come le ha inviate questa richiesta:
/// l'host reale cita gli identificativi che riceve.
fn as_sent(body: &Value, ingest: &Value) -> Value {
    let revision = ingest["attachment"]["sourceRevision"].as_u64().unwrap();
    serde_json::from_str(
        &body
            .to_string()
            .replace(RECORDED, &format!("source.local.{}.", base36(revision))),
    )
    .unwrap()
}
/// Toglie da un ingest ciò che cambia a ogni invio (ordinale, ora, identificativi).
fn stable_ingest(mut ingest: Value) -> Value {
    let revision = ingest["attachment"]["sourceRevision"].as_u64().unwrap();
    let text = ingest
        .to_string()
        .replace(&format!("source.local.{}.", base36(revision)), RECORDED);
    ingest = serde_json::from_str(&text).unwrap();
    ingest["attachment"]["sourceRevision"] = json!(1);
    ingest["attachment"]["capturedAt"] = json!("fisso");
    ingest["requestId"] = json!("fisso");
    ingest
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
    let session = host.session.clone();
    let (view, cx) = cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
    view.update(cx, |app, _| {
        app.local_host.test_access(access);
        app.session = Some(session);
        show(app, &patient_id());
    });
    (Bench { host, view }, cx)
}

impl Bench {
    fn switch(&self, value: &str) {
        self.host
            .plan(SETTING)
            .send((
                200,
                json!({"key": "aiSmartImportKillSwitch", "value": value}),
            ))
            .unwrap();
    }
    fn respond(&self, route: &str, name: &str) {
        let response = fixture(name);
        self.host
            .plan(route)
            .send((
                response["status"].as_u64().unwrap() as u16,
                response["body"].clone(),
            ))
            .unwrap();
    }
    /// Selezione e ingest come li ha risposti l'host reale.
    fn until_preview(&self) {
        self.respond(EPOCH, "response-selection-epoch");
        self.respond(SELECT, "response-selection");
        self.respond(INGEST, "response-ingest");
    }
    /// Risponde all'anteprima solo dopo che la richiesta è arrivata, con le fonti
    /// numerate come le ha inviate GPUI. `false` se nessuna richiesta.
    fn answer_with(
        &self,
        name: &'static str,
        change: fn(&mut Value),
    ) -> std::thread::JoinHandle<bool> {
        let sender = self.host.plan(PREVIEW);
        let seen = self.host.bodies(PREVIEW).len();
        let requests = self.host.requests_handle();
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let ingest = loop {
                let found: Vec<Value> = requests
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|(route, _)| route == PREVIEW || route == INGEST)
                    .map(|(route, body)| json!({"route": route, "body": body}))
                    .collect();
                if found.iter().filter(|r| r["route"] == PREVIEW).count() > seen {
                    break found
                        .iter()
                        .rev()
                        .find(|r| r["route"] == INGEST)
                        .map(|r| r["body"].clone())
                        .unwrap();
                }
                if Instant::now() > deadline {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(5));
            };
            let response = fixture(name);
            let status = response["status"].as_u64().unwrap() as u16;
            let mut body = as_sent(&response["body"], &ingest);
            change(&mut body);
            sender.send((status, body)).is_ok()
        })
    }
    fn answer(&self, name: &'static str) -> std::thread::JoinHandle<bool> {
        self.answer_with(name, |_| {})
    }
    fn phase<R>(
        &self,
        cx: &mut gpui::VisualTestContext,
        read: impl FnOnce(&ImportPhase) -> R,
    ) -> R {
        self.view
            .read_with(cx, |app, _| read(&app.patient.smart_import.phase))
    }
    fn generation_routes(&self) -> Vec<String> {
        self.host
            .routes()
            .into_iter()
            .filter(|route| route.starts_with("POST /api/ai/") || route.starts_with(EPOCH))
            .collect()
    }
    /// Letture, accesso locale e i tre passaggi dell'anteprima: nessuna altra rotta,
    /// nessuna scrittura nella scheda, nessun apply (legacy o nuovo).
    fn assert_no_clinical_write(&self) {
        for route in self.host.routes() {
            assert!(
                route.starts_with("GET ")
                    || [SELECT, INGEST, PREVIEW].contains(&route.as_str())
                    || route.starts_with("POST /api/auth/"),
                "rotta inattesa dopo l'import assistito: {route}"
            );
            assert!(!route.contains("apply"), "apply chiamato: {route}");
        }
    }
}

fn prepare(bench: &Bench, cx: &mut gpui::VisualTestContext) {
    let before = bench.generation_routes().len();
    bench.switch("enabled");
    bench.view.update(cx, |app, cx| app.import_prepare(cx));
    cx.run_until_parked();
    let seen = bench.phase(cx, |phase| match phase {
        GenerationPhase::Consent(_) => "consenso".to_owned(),
        GenerationPhase::Unavailable(m) | GenerationPhase::Error(m) => m.clone(),
        _ => "altro".to_owned(),
    });
    assert_eq!(seen, "consenso");
    assert_eq!(
        bench.generation_routes().len(),
        before,
        "il consenso precede ogni passaggio verso il modello"
    );
}

fn generate(bench: &Bench, cx: &mut gpui::VisualTestContext) {
    prepare(bench, cx);
    bench.until_preview();
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| app.import_confirm(cx));
    cx.run_until_parked();
    assert!(answer.join().unwrap());
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        GenerationPhase::Proposal { .. }
    )));
}

fn rendered_buttons(bench: &Bench, cx: &mut gpui::VisualTestContext) -> Vec<String> {
    bench.view.update(cx, |app, cx| {
        rendered_command::button_ids(|| {
            let _ = app.smart_import_view(cx);
        })
    })
}

#[gpui::test]
fn proposal_shows_candidates_by_kind_with_their_source(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    generate(&bench, cx);
    // Gli stessi corpi del contratto, nello stesso ordine del Web.
    assert_eq!(
        bench.generation_routes(),
        vec![EPOCH, SELECT, INGEST, PREVIEW]
    );
    assert_eq!(
        bench.host.bodies(SELECT),
        vec![fixture("request-selection")]
    );
    let ingest = bench.host.bodies(INGEST);
    assert_eq!(ingest.len(), 1);
    assert_eq!(
        stable_ingest(ingest[0].clone()),
        stable_ingest(fixture("request-ingest")),
        "GPUI invia le fonti del contratto, con la tupla della selezione concessa"
    );
    let preview = bench.host.bodies(PREVIEW);
    assert_eq!(preview[0]["handle"], fixture("request-preview")["handle"]);
    assert_ne!(preview[0]["requestId"], ingest[0]["requestId"]);
    bench.view.read_with(cx, |app, _| {
        let GenerationPhase::Proposal { request, proposal } = &app.patient.smart_import.phase
        else {
            panic!("la risposta disponibile è una proposta");
        };
        assert_eq!(app.import_currency(request), ImportCurrency::Current);
        assert_eq!(proposal.writes_performed, 0);
        assert_eq!(
            (proposal.provider.as_str(), proposal.egress.as_str()),
            ("ollama", "none")
        );
        let shown: Vec<(String, String)> = proposal
            .candidates()
            .map(|c| (c.title.clone(), candidate_source(request, c)))
            .collect();
        assert_eq!(
            shown,
            vec![
                (
                    "Ipertensione arteriosa".into(),
                    "Fonte: VISITA 05/11/2026".into()
                ),
                (
                    "ramipril 5 mg".into(),
                    "Fonte: Note paziente · segmento 2".into()
                ),
                (
                    "Ecocardiogramma".into(),
                    "Fonte: Allegato referto-cardiologico.pdf · 01/11/2026".into()
                ),
            ]
        );
    });
    let buttons = rendered_buttons(&bench, cx);
    assert!(buttons.contains(&"smart-import-discard".to_owned()));
    assert!(
        !buttons
            .iter()
            .any(|id| id.contains("apply") || id.contains("save") || id.contains("write")),
        "nessun comando di applicazione: {buttons:?}"
    );
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn declined_consent_sends_nothing(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    bench.view.update(cx, |app, cx| app.import_decline(cx));
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Ended(m) if m.contains("nulla è stato inviato"))
    ));
    assert!(bench.generation_routes().is_empty());
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn kill_switch_off_is_unavailable_without_generation(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.switch("disabled");
    bench.view.update(cx, |app, cx| app.import_prepare(cx));
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Unavailable(m) if m.contains("spento sull’host"))
    ));
    assert!(bench.generation_routes().is_empty());
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn host_closed_is_unavailable_without_any_call(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.view.update(cx, |app, cx| {
        drop(app.local_host.withdraw(cx));
        app.import_prepare(cx);
    });
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Unavailable(m) if m.contains("Host locale chiuso"))
    ));
    assert!(bench.host.bodies(SETTING).is_empty());
    assert!(bench.generation_routes().is_empty());
}

#[gpui::test]
fn chart_without_sources_is_unavailable_without_generation(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.switch("enabled");
    bench.view.update(cx, |app, cx| {
        app.patient.entries = ReadLoad::Ready(vec![]);
        app.patient.attachments = ReadLoad::Ready(vec![]);
        if let Some(detail) = app.patient.detail.ready().cloned() {
            let mut detail = detail;
            detail.notes = None;
            app.patient.detail = ReadLoad::Ready(detail);
        }
        app.import_prepare(cx);
    });
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Unavailable(m) if m.contains("da cui proporre"))
    ));
    assert!(bench.generation_routes().is_empty());
}

/// Dinieghi e fallimenti reali dell'host: messaggio leggibile, nessuna proposta.
#[gpui::test]
fn server_refusals_are_readable_and_create_no_proposal(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    for (name, unavailable, message) in [
        ("response-function-disabled", true, "spento sull’host"),
        ("response-kill-switch-disabled", true, "spento sull’host"),
        ("response-provider-unready", true, "Modelli locali"),
        ("response-provider-failed", false, "non ha risposto"),
        ("response-proposal-invalid", false, "controlli dell’host"),
        (
            "response-preview-replayed",
            false,
            "selezione sull’host è cambiata",
        ),
    ] {
        prepare(&bench, cx);
        bench.until_preview();
        let answer = bench.answer(name);
        bench.view.update(cx, |app, cx| app.import_confirm(cx));
        cx.run_until_parked();
        assert!(answer.join().unwrap(), "{name}");
        assert!(
            bench.phase(cx, |phase| match phase {
                GenerationPhase::Unavailable(m) => unavailable && m.contains(message),
                GenerationPhase::Error(m) => !unavailable && m.contains(message),
                _ => false,
            }),
            "{name}"
        );
    }
    // Proiezione rifiutata all'ingest: la catena si ferma prima dell'anteprima.
    prepare(&bench, cx);
    let previews = bench.host.bodies(PREVIEW).len();
    bench.respond(EPOCH, "response-selection-epoch");
    bench.respond(SELECT, "response-selection");
    bench.respond(INGEST, "response-ingest-stale");
    bench.view.update(cx, |app, cx| app.import_confirm(cx));
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Error(m) if m == "La selezione sull’host è cambiata durante la richiesta. Riprova.")
    ));
    assert_eq!(bench.host.bodies(PREVIEW).len(), previews);
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn altered_or_foreign_response_is_an_error_not_a_proposal(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    for change in [
        (|b: &mut Value| b["preview"]["writesPerformed"] = json!(1)) as fn(&mut Value),
        // Un candidato che cita una fonte mai inviata con questa richiesta.
        |b| {
            b["preview"]["proposal"]["diagnoses"][0]["sourceId"] =
                json!("source.local.zzzzzzzzzzz.01")
        },
    ] {
        prepare(&bench, cx);
        bench.until_preview();
        let answer = bench.answer_with("response-available", change);
        bench.view.update(cx, |app, cx| app.import_confirm(cx));
        cx.run_until_parked();
        assert!(answer.join().unwrap());
        assert!(bench.phase(
            cx,
            |phase| matches!(phase, GenerationPhase::Error(m) if m == "La risposta dell’host non ha superato i controlli dell’app.")
        ));
    }
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn stop_during_generation_discards_the_late_answer(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    bench.until_preview();
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| {
        app.import_confirm(cx);
        assert!(matches!(
            app.patient.smart_import.phase,
            GenerationPhase::Running { .. }
        ));
        app.import_stop(cx);
    });
    cx.run_until_parked();
    assert!(
        !answer.join().unwrap(),
        "nessuna anteprima dopo l'annullamento"
    );
    assert!(
        bench.generation_routes().is_empty(),
        "il contesto annullato ferma la catena prima che parta"
    );
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Ended(m) if m.contains("Generazione interrotta"))
    ));
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn discard_revokes_the_shown_proposal(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    generate(&bench, cx);
    let routes = bench.host.routes().len();
    bench.view.update(cx, |app, cx| app.import_discard(cx));
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Ended(m) if m.contains("scartata"))
    ));
    assert_eq!(
        bench.host.routes().len(),
        routes,
        "lo scarto non chiama l'host"
    );
    bench.assert_no_clinical_write();
}

/// Documento cambiato o tolto, voce di diario nuova: la proposta si dichiara superata.
#[gpui::test]
fn proposal_is_superseded_when_a_source_changes_or_disappears(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    generate(&bench, cx);
    let check = |cx: &mut gpui::VisualTestContext, expected: ImportCurrency| {
        bench.view.read_with(cx, |app, _| {
            let GenerationPhase::Proposal { request, .. } = &app.patient.smart_import.phase else {
                panic!("proposta attesa");
            };
            assert_eq!(app.import_currency(request), expected);
        });
    };
    let reset = |cx: &mut gpui::VisualTestContext| {
        bench.view.update(cx, |app, _| {
            let phase = std::mem::take(&mut app.patient.smart_import.phase);
            show(app, &patient_id());
            app.patient.smart_import.phase = phase;
        });
    };
    // Rilettura senza cambiamenti: resta attuale.
    reset(cx);
    check(cx, ImportCurrency::Current);
    bench
        .view
        .update(cx, |app, _| app.patient.attachments = ReadLoad::loading());
    check(cx, ImportCurrency::Reading);
    // Sintesi del documento cambiata.
    reset(cx);
    bench.view.update(cx, |app, _| {
        let mut rows = app.patient.attachments.ready().unwrap().clone();
        rows[0].summary_snapshot = Some("Referto sostituito.".into());
        app.patient.attachments = ReadLoad::Ready(rows);
    });
    check(cx, ImportCurrency::Superseded);
    let buttons = rendered_buttons(&bench, cx);
    assert!(buttons.contains(&"smart-import-discard".to_owned()));
    assert!(buttons.contains(&"smart-import-prepare".to_owned()));
    // Documento tolto.
    reset(cx);
    bench.view.update(cx, |app, _| {
        let mut rows = app.patient.attachments.ready().unwrap().clone();
        rows.remove(0);
        app.patient.attachments = ReadLoad::Ready(rows);
    });
    check(cx, ImportCurrency::Superseded);
    // Voce di diario cambiata.
    reset(cx);
    bench.view.update(cx, |app, _| {
        let mut rows = app.patient.entries.ready().unwrap().clone();
        rows[0].content = "Pressione 130/80.".into();
        app.patient.entries = ReadLoad::Ready(rows);
    });
    check(cx, ImportCurrency::Superseded);
}

/// Scheda cambiata fra preparazione e consenso: nessun invio.
#[gpui::test]
fn chart_changed_before_consent_sends_nothing(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    bench.view.update(cx, |app, cx| {
        let mut rows = app.patient.attachments.ready().unwrap().clone();
        rows.clear();
        app.patient.attachments = ReadLoad::Ready(rows);
        app.import_confirm(cx);
    });
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Error(m) if m.contains("nulla è stato inviato"))
    ));
    assert!(bench.generation_routes().is_empty());
}

/// La risposta di una richiesta partita sul paziente A, arrivata dopo il passaggio a B,
/// non compare sulla scheda di B.
#[gpui::test]
fn late_answer_never_lands_on_the_next_patient(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    bench.until_preview();
    let answer = bench.answer("response-available");
    let first = patient_id();
    let (ticket, request) = bench.view.update(cx, |app, cx| {
        app.import_confirm(cx);
        let GenerationPhase::Running { request, .. } = &app.patient.smart_import.phase else {
            panic!("richiesta in corso attesa");
        };
        let request = (**request).clone();
        let ticket = app.patient.smart_import.ticket.clone();
        // Lo stesso passaggio di `select_patient`: nuova presentazione, nuova scheda.
        app.next_presentation_epoch();
        show(app, "pt-gpui-si-0002");
        (ticket, request)
    });
    cx.run_until_parked();
    assert!(
        !answer.join().unwrap(),
        "nessuna anteprima dopo l'annullamento"
    );
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Idle)));
    // Anche consegnata a mano, la risposta di A non entra nella scheda di B.
    let ingest = json!({"attachment": {"sourceRevision": request.sources[0].id
        .split('.').nth(2).map(|r| u64::from_str_radix(r, 36).unwrap()).unwrap()}});
    let late = mediflow_runtime_client::smart_import_outcome(
        200,
        as_sent(&fixture("response-available")["body"], &ingest)
            .to_string()
            .as_bytes(),
    );
    assert!(matches!(late, Ok(GenerationOutcome::Proposal(_))));
    bench.view.update(cx, |app, cx| {
        app.patient.smart_import.phase = GenerationPhase::Running {
            request: Box::new(request),
            context: mediflow_runtime_client::RequestContext::default(),
        };
        app.import_receive(&ticket, &first, late.clone(), cx);
        assert!(
            matches!(
                app.patient.smart_import.phase,
                GenerationPhase::Running { .. }
            ),
            "biglietto vecchio"
        );
        let current = app.patient.smart_import.ticket.clone();
        app.import_receive(&current, &first, late, cx);
        assert!(
            matches!(
                app.patient.smart_import.phase,
                GenerationPhase::Running { .. }
            ),
            "una risposta per un altro paziente non è di questa scheda"
        );
    });
    bench.assert_no_clinical_write();
}

#[cfg(target_os = "macos")]
mod chat;
