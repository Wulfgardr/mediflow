//! Stati della sintesi dei documenti in GPUI contro un host sintetico: le risposte
//! sono quelle registrate dagli handler reali (`lib/document-synthesis-gpui-contract.test.ts`).

use super::*;
use crate::shell::notes_recovery_tests::Host;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../transport/tests/fixtures/document_synthesis"
);
const SETTING: &str = "GET /api/settings/aiDocumentSynthesisKillSwitch";
const EPOCH: &str = "GET /api/ai/smart-import/selection";
const SELECT: &str = "POST /api/ai/smart-import/selection";
const CAPTURE: &str = "POST /api/ai/document-synthesis/capture";
const INGEST: &str = "POST /api/ai/document-synthesis/ingest";
const PREVIEW: &str = "POST /api/ai/document-synthesis/preview";
const SAVED: &str = "Sintesi salvata in passato, mai toccata dalla proposta.";

fn fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{FIXTURES}/{name}.json")).unwrap())
        .unwrap()
}
fn document() -> Value {
    fixture("document")
}
fn text(key: &str) -> String {
    document()[key].as_str().unwrap().to_owned()
}
fn detail_route() -> String {
    format!(
        "GET /api/v1/network/patients/{}/attachments/{}",
        text("patientId"),
        text("attachmentId")
    )
}
/// La riga del documento come la legge GPUI: elenco senza dati, dettaglio con i dati.
fn wire(with_data: bool) -> Value {
    let document = document();
    let mut row = json!({
        "currentness": document["currentness"], "id": document["attachmentId"],
        "patientId": document["patientId"], "name": document["name"],
        "type": document["mimeType"], "size": pdf().len(), "path": "sintetico.pdf",
        "summarySnapshot": SAVED, "parseEvidenceArtifactSnapshot": null,
        "ocrQueueState": null, "ocrQueueReason": null, "ocrQueueUpdatedAt": null,
        "createdAt": null,
    });
    if with_data {
        row["data"] = json!(format!(
            "data:application/pdf;base64,{}",
            document["base64"].as_str().unwrap()
        ));
    }
    row
}
fn pdf() -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(document()["base64"].as_str().unwrap())
        .unwrap()
}
fn row() -> Attachment {
    serde_json::from_value(wire(false)).unwrap()
}

fn show(app: &mut ClinicalApp, patient: &str) {
    app.scope = Some(text("ambulatoryId"));
    app.selected_id = Some(patient.to_owned());
    app.patient = PatientData::default();
    let mut row = row();
    row.patient_id = patient.to_owned();
    app.patient.document_details_id = Some(row.id.clone());
    app.patient.attachments = ReadLoad::Ready(vec![row]);
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
        show(app, &text("patientId"));
    });
    (Bench { host, view }, cx)
}

impl Bench {
    fn switch(&self, value: &str) {
        self.host
            .plan(SETTING)
            .send((
                200,
                json!({"key": "aiDocumentSynthesisKillSwitch", "value": value}),
            ))
            .unwrap();
    }
    fn detail(&self, value: Value) {
        self.host.plan(&detail_route()).send((200, value)).unwrap();
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
    /// Selezione, cattura e ingest come li ha risposti l'host reale.
    fn until_preview(&self) {
        self.respond(EPOCH, "response-selection-epoch");
        self.respond(SELECT, "response-selection");
        self.respond(CAPTURE, "response-capture");
        self.respond(INGEST, "response-ingest");
    }
    /// Risponde all'anteprima con un file registrato solo dopo che la richiesta è
    /// arrivata. Restituisce il thread che risponde: `false` se nessuna richiesta.
    fn answer(&self, name: &'static str) -> std::thread::JoinHandle<bool> {
        let sender = self.host.plan(PREVIEW);
        let seen = self.host.bodies(PREVIEW).len();
        let requests = self.host.requests_handle();
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let arrived = requests
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|(route, _)| route == PREVIEW)
                    .count();
                if arrived > seen {
                    break;
                }
                if Instant::now() > deadline {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            let response = fixture(name);
            let status = response["status"].as_u64().unwrap() as u16;
            sender.send((status, response["body"].clone())).is_ok()
        })
    }
    fn phase<R>(
        &self,
        cx: &mut gpui::VisualTestContext,
        read: impl FnOnce(&SynthesisPhase) -> R,
    ) -> R {
        self.view
            .read_with(cx, |app, _| read(&app.patient.synthesis.area.phase))
    }
    fn generation_routes(&self) -> Vec<String> {
        self.host
            .routes()
            .into_iter()
            .filter(|route| route.starts_with("POST /api/ai/") || route.starts_with(EPOCH))
            .collect()
    }
    /// Letture, accesso locale e i quattro passaggi della sintesi: nessuna altra rotta,
    /// nessuna scrittura nella scheda.
    fn assert_no_clinical_write(&self) {
        for route in self.host.routes() {
            assert!(
                route.starts_with("GET ")
                    || [SELECT, CAPTURE, INGEST, PREVIEW].contains(&route.as_str())
                    || route.starts_with("POST /api/auth/"),
                "rotta inattesa dopo la sintesi: {route}"
            );
        }
    }
}

fn prepare(bench: &Bench, cx: &mut gpui::VisualTestContext) {
    let before = bench.generation_routes().len();
    bench.switch("enabled");
    bench.detail(wire(true));
    let document = text("attachmentId");
    bench
        .view
        .update(cx, |app, cx| app.synthesis_prepare(&document, cx));
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
    bench.view.update(cx, |app, cx| app.synthesis_confirm(cx));
    cx.run_until_parked();
    assert!(answer.join().unwrap());
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        GenerationPhase::Proposal { .. }
    )));
}

fn rendered_buttons(bench: &Bench, cx: &mut gpui::VisualTestContext) -> Vec<String> {
    let row = row();
    bench.view.update(cx, |app, cx| {
        let mut row = row;
        row.patient_id = app.selected_id.clone().unwrap();
        rendered_command::button_ids(|| {
            let _ = app.document_synthesis_view(&row, cx);
        })
    })
}

#[gpui::test]
fn proposal_is_shown_with_citations_and_receipt(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    generate(&bench, cx);
    // Gli stessi corpi del contratto, nello stesso ordine del Web.
    assert_eq!(
        bench.generation_routes(),
        vec![EPOCH, SELECT, CAPTURE, INGEST, PREVIEW]
    );
    assert_eq!(
        bench.host.bodies(SELECT),
        vec![fixture("request-selection")]
    );
    assert_eq!(bench.host.bodies(CAPTURE), vec![fixture("request-capture")]);
    assert_eq!(bench.host.bodies(PREVIEW), vec![fixture("request-preview")]);
    assert_eq!(
        bench.host.bodies(INGEST),
        vec![Value::String(String::from_utf8_lossy(&pdf()).into_owned())],
        "l'ingest porta i byte del documento decifrati da GPUI"
    );
    bench.view.read_with(cx, |app, _| {
        let GenerationPhase::Proposal { request, proposal } = &app.patient.synthesis.area.phase
        else {
            panic!("la risposta disponibile è una proposta");
        };
        assert_eq!(app.synthesis_currency(request), SynthesisCurrency::Current);
        assert_eq!(request.byte_length(), 0, "i byte non restano nello stato");
        assert_eq!(proposal.citations[0].label, "S1");
        assert_eq!(proposal.citations[0].quote, text("quote"));
        assert_eq!(proposal.provider, "ollama");
        assert_eq!(proposal.egress, "none");
        assert_eq!(proposal.writes_performed, 0);
    });
    let buttons = rendered_buttons(&bench, cx);
    assert!(buttons.contains(&"document-synthesis-discard".to_owned()));
    assert!(
        !buttons
            .iter()
            .any(|id| id.contains("apply") || id.contains("save"))
    );
    bench.assert_no_clinical_write();
}

/// La sintesi salvata del documento resta quella di prima e si legge accanto alla
/// proposta nuova, non al suo posto.
#[gpui::test]
fn saved_synthesis_stays_distinct_from_the_new_proposal(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    generate(&bench, cx);
    bench.view.read_with(cx, |app, _| {
        let rows = app.patient.attachments.ready().unwrap();
        assert_eq!(rows[0].summary_snapshot.as_deref(), Some(SAVED));
        let GenerationPhase::Proposal { proposal, .. } = &app.patient.synthesis.area.phase else {
            panic!("proposta attesa");
        };
        assert_ne!(proposal.summary, SAVED);
    });
    // Nessuna rotta di scrittura dei documenti: la proposta non è conservata nell'archivio.
    assert!(
        !bench
            .host
            .routes()
            .iter()
            .any(|route| route.contains("/attachments") && !route.starts_with("GET "))
    );
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn declined_consent_sends_nothing(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    bench.view.update(cx, |app, cx| app.synthesis_decline(cx));
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Ended(m) if m.contains("Nessun dato"))
    ));
    assert!(bench.generation_routes().is_empty());
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn kill_switch_off_is_unavailable_without_generation(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.switch("disabled");
    let document = text("attachmentId");
    bench
        .view
        .update(cx, |app, cx| app.synthesis_prepare(&document, cx));
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Unavailable(m) if m.contains("spenta sull'host"))
    ));
    assert!(bench.generation_routes().is_empty());
    assert!(
        !bench.host.routes().contains(&detail_route()),
        "con la funzione spenta il documento non viene nemmeno letto"
    );
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn host_closed_is_unavailable_without_any_call(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let document = text("attachmentId");
    bench.view.update(cx, |app, cx| {
        drop(app.local_host.withdraw(cx));
        app.synthesis_prepare(&document, cx);
    });
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Unavailable(m) if m.contains("Host locale chiuso"))
    ));
    assert!(bench.host.bodies(SETTING).is_empty());
    assert!(!bench.host.routes().contains(&detail_route()));
    assert!(bench.generation_routes().is_empty());
}

/// Dinieghi e fallimenti reali dell'host: messaggio leggibile, nessuna proposta.
#[gpui::test]
fn server_refusals_are_readable_and_create_no_proposal(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    let preview_cases = [
        ("response-function-disabled", true, "spenta sull'host"),
        (
            "response-provider-failed",
            false,
            "non ha prodotto una sintesi",
        ),
        (
            "response-proposal-invalid",
            false,
            "La risposta del modello non era valida. Riprova.",
        ),
        (
            "response-proposal-truncated",
            false,
            "La risposta del modello non era valida. Riprova.",
        ),
        (
            "response-preview-stale",
            false,
            "sono cambiati durante la richiesta",
        ),
    ];
    for (name, unavailable, message) in preview_cases {
        prepare(&bench, cx);
        bench.until_preview();
        let answer = bench.answer(name);
        bench.view.update(cx, |app, cx| app.synthesis_confirm(cx));
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
    // Rifiuti prima dell'anteprima: la catena si ferma lì.
    for (route, name, message) in [
        (
            CAPTURE,
            "response-capture-lane-disabled",
            "spenta sull'host",
        ),
        (INGEST, "response-ingest-unsupported", "estrarre il testo"),
    ] {
        prepare(&bench, cx);
        let previews = bench.host.bodies(PREVIEW).len();
        bench.respond(EPOCH, "response-selection-epoch");
        bench.respond(SELECT, "response-selection");
        if route == INGEST {
            bench.respond(CAPTURE, "response-capture");
        }
        bench.respond(route, name);
        bench.view.update(cx, |app, cx| app.synthesis_confirm(cx));
        cx.run_until_parked();
        assert!(
            bench.phase(
                cx,
                |phase| matches!(phase, GenerationPhase::Unavailable(m) if m.contains(message))
            ),
            "{name}"
        );
        assert_eq!(bench.host.bodies(PREVIEW).len(), previews, "{name}");
    }
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn altered_response_is_an_error_not_a_proposal(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    bench.until_preview();
    let mut altered = fixture("response-available");
    altered["body"]["publication"]["receipt"]["writesPerformed"] = json!(1);
    bench
        .host
        .plan(PREVIEW)
        .send((200, altered["body"].clone()))
        .unwrap();
    bench.view.update(cx, |app, cx| app.synthesis_confirm(cx));
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Error(m) if m == "La risposta dell'host non ha superato i controlli dell'app.")
    ));
    bench.assert_no_clinical_write();
}

#[gpui::test]
fn stop_during_generation_discards_the_late_answer(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    bench.until_preview();
    let answer = bench.answer("response-available");
    bench.view.update(cx, |app, cx| {
        app.synthesis_confirm(cx);
        assert!(matches!(
            app.patient.synthesis.area.phase,
            GenerationPhase::Running { .. }
        ));
        app.synthesis_stop(cx);
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
    bench.view.update(cx, |app, cx| app.synthesis_discard(cx));
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

/// Documento sostituito o tolto dopo la generazione: la proposta si dichiara superata.
#[gpui::test]
fn proposal_is_superseded_when_the_document_changes_or_disappears(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    generate(&bench, cx);
    let check = |cx: &mut gpui::VisualTestContext, expected: SynthesisCurrency| {
        bench.view.read_with(cx, |app, _| {
            let GenerationPhase::Proposal { request, .. } = &app.patient.synthesis.area.phase
            else {
                panic!("proposta attesa");
            };
            assert_eq!(app.synthesis_currency(request), expected);
        });
    };
    // Rilettura senza cambiamenti: resta attuale.
    bench.view.update(cx, |app, _| {
        let mut again = row();
        again.patient_id = app.selected_id.clone().unwrap();
        app.patient.attachments = ReadLoad::Ready(vec![again]);
    });
    check(cx, SynthesisCurrency::Current);
    bench
        .view
        .update(cx, |app, _| app.patient.attachments = ReadLoad::loading());
    check(cx, SynthesisCurrency::Reading);
    // Stesso documento, nuova currentness sull'host (sostituito o modificato).
    bench.view.update(cx, |app, _| {
        let mut changed = row();
        changed.patient_id = app.selected_id.clone().unwrap();
        changed.currentness.as_mut().unwrap()["freshnessEpoch"] = json!(6);
        app.patient.attachments = ReadLoad::Ready(vec![changed]);
    });
    check(cx, SynthesisCurrency::Superseded);
    let buttons = rendered_buttons(&bench, cx);
    assert!(buttons.contains(&"document-synthesis-discard".to_owned()));
    assert!(buttons.contains(&"document-synthesis-prepare".to_owned()));
    // Documento tolto.
    bench.view.update(cx, |app, _| {
        app.patient.attachments = ReadLoad::Ready(vec![])
    });
    check(cx, SynthesisCurrency::Superseded);
}

/// Documento cambiato fra preparazione e consenso: nessun invio.
#[gpui::test]
fn document_changed_before_consent_sends_nothing(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    prepare(&bench, cx);
    bench.view.update(cx, |app, cx| {
        let mut changed = row();
        changed.patient_id = app.selected_id.clone().unwrap();
        changed.currentness.as_mut().unwrap()["revision"] = json!(4);
        app.patient.attachments = ReadLoad::Ready(vec![changed]);
        app.synthesis_confirm(cx);
    });
    cx.run_until_parked();
    assert!(bench.phase(
        cx,
        |phase| matches!(phase, GenerationPhase::Error(m) if m.contains("Nessun dato è stato inviato"))
    ));
    assert!(bench.generation_routes().is_empty());
}

/// Un documento che non si decifra non diventa un invio vuoto.
#[gpui::test]
fn unreadable_document_blocks_the_request(cx: &mut gpui::TestAppContext) {
    let (bench, cx) = bench(cx);
    bench.switch("enabled");
    let mut detail = wire(true);
    detail["data"] = json!("ENC:illeggibile");
    bench.detail(detail);
    let document = text("attachmentId");
    bench
        .view
        .update(cx, |app, cx| app.synthesis_prepare(&document, cx));
    cx.run_until_parked();
    assert!(bench.phase(cx, |phase| matches!(
        phase,
        GenerationPhase::Unavailable(_) | GenerationPhase::Error(_)
    )));
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
    let first = text("patientId");
    let document = text("attachmentId");
    let ticket = bench.view.update(cx, |app, cx| {
        app.synthesis_confirm(cx);
        assert!(matches!(
            app.patient.synthesis.area.phase,
            GenerationPhase::Running { .. }
        ));
        let ticket = app.patient.synthesis.area.ticket.clone();
        // Lo stesso passaggio di `select_patient`: nuova presentazione, nuova scheda.
        app.next_presentation_epoch();
        show(app, "pt-gpui-ds-0002");
        ticket
    });
    cx.run_until_parked();
    assert!(
        !answer.join().unwrap(),
        "nessuna anteprima dopo l'annullamento"
    );
    assert!(bench.phase(cx, |phase| matches!(phase, GenerationPhase::Idle)));
    // Anche consegnata a mano, la risposta di A non entra nella scheda di B.
    let late = mediflow_runtime_client::document_synthesis_outcome(
        200,
        fixture("response-available")["body"].to_string().as_bytes(),
    );
    let (mut request_row, bytes) = (row(), pdf());
    request_row.patient_id = first.clone();
    let request = DocumentSynthesisRequest::new(
        &first,
        &text("ambulatoryId"),
        &request_row,
        &request_row,
        zeroize::Zeroizing::new(bytes),
    )
    .unwrap();
    bench.view.update(cx, |app, cx| {
        app.patient.synthesis.document = Some(document.clone());
        app.patient.synthesis.area.phase = GenerationPhase::Running {
            request: Box::new(request),
            context: mediflow_runtime_client::RequestContext::default(),
        };
        app.synthesis_receive(&ticket, &first, &document, late.clone(), cx);
        assert!(
            matches!(
                app.patient.synthesis.area.phase,
                GenerationPhase::Running { .. }
            ),
            "biglietto vecchio"
        );
        let current = app.patient.synthesis.area.ticket.clone();
        app.synthesis_receive(&current, &first, &document, late, cx);
        assert!(
            matches!(
                app.patient.synthesis.area.phase,
                GenerationPhase::Running { .. }
            ),
            "una risposta per un altro paziente non è di questa scheda"
        );
    });
    bench.assert_no_clinical_write();
}

#[cfg(target_os = "macos")]
mod chat;
