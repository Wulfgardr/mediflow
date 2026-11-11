use super::*;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/smart_import");

pub(crate) fn fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{FIXTURES}/{name}.json")).unwrap())
        .unwrap()
}
fn write_or_compare(name: &str, built: &Value) {
    let file = format!("{FIXTURES}/{name}.json");
    if std::env::var_os("MEDIFLOW_WRITE_FIXTURES").is_some() {
        std::fs::write(
            &file,
            format!("{}\n", serde_json::to_string_pretty(built).unwrap()),
        )
        .unwrap();
    }
    assert_eq!(
        &fixture(name),
        built,
        "{name}: GPUI non invia il corpo del contratto"
    );
}
fn response(name: &str) -> (u16, Vec<u8>) {
    let value = fixture(name);
    (
        value["status"].as_u64().unwrap() as u16,
        value["body"].to_string().into_bytes(),
    )
}

/// La scheda sintetica di `chart.json`, come GPUI la riceve già decifrata.
pub(crate) struct Chart {
    pub patient: crate::PatientDetail,
    pub entries: Vec<crate::Entry>,
    pub therapies: Vec<crate::Therapy>,
    pub attachments: Vec<crate::Attachment>,
    pub scope: String,
}
pub(crate) fn chart() -> Chart {
    chart_from("chart")
}
pub(crate) fn chart_from(name: &str) -> Chart {
    let chart = fixture(name);
    let patient_id = chart["patient"]["id"].clone();
    let patient = serde_json::from_value(json!({
        "id": patient_id, "firstName": "Persona", "lastName": "Sintetica",
        "taxCode": "SYNTHETICSIGPUI01", "version": chart["patient"]["version"],
        "notes": chart["patient"]["notes"], "diagnoses": chart["patient"]["diagnoses"],
        "ambulatoryId": null,
    }))
    .unwrap();
    let entries = chart["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            serde_json::from_value(json!({
                "id": row["id"], "patientId": patient_id, "type": row["type"],
                "title": row["title"], "date": row["date"], "content": row["content"],
                "deletedAt": row["deletedAt"], "version": 1,
            }))
            .unwrap()
        })
        .collect();
    let therapies = chart["therapies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            serde_json::from_value(json!({
                "id": row["id"], "patientId": patient_id, "drugName": row["drugName"],
                "activePrinciple": row["activePrinciple"], "dosage": row["dosage"],
                "aic": row["aic"], "atc": row["atc"], "status": row["status"],
                "startDate": "2026-01-01", "version": 1,
            }))
            .unwrap()
        })
        .collect();
    let attachments = chart["attachments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            serde_json::from_value(json!({
                "currentness": null, "id": row["id"], "patientId": patient_id,
                "name": row["name"], "type": "application/pdf", "size": 10, "path": "sintetico",
                "summarySnapshot": row["summarySnapshot"], "parseEvidenceArtifactSnapshot": null,
                "ocrQueueState": null, "ocrQueueReason": null, "ocrQueueUpdatedAt": null,
                "createdAt": row["createdAt"],
            }))
            .unwrap()
        })
        .collect();
    Chart {
        patient,
        entries,
        therapies,
        attachments,
        scope: chart["ambulatoryId"].as_str().unwrap().to_owned(),
    }
}
impl Chart {
    pub(crate) fn capture(&self) -> Result<Value> {
        smart_import_capture(&SmartImportChart {
            patient: &self.patient,
            scope: Some(&self.scope),
            therapies: &self.therapies,
            entries: &self.entries,
            attachments: &self.attachments,
        })
    }
    pub(crate) fn request(&self) -> Result<SmartImportRequest> {
        SmartImportRequest::new(&self.patient, Some(&self.scope), self.capture()?)
    }
}
/// La richiesta legata come all'invio, con i valori fissi del contratto.
pub(crate) fn bound_request() -> SmartImportRequest {
    let chart_file = fixture("chart");
    let mut request = chart().request().unwrap();
    let ids = &chart_file["requestIds"];
    request
        .bind_with(
            chart_file["sourceRevision"].as_u64().unwrap(),
            chart_file["capturedAt"].as_str().unwrap(),
            (
                ids[0].as_str().unwrap().to_owned(),
                ids[1].as_str().unwrap().to_owned(),
            ),
        )
        .unwrap();
    request
}

/// Le fonti che GPUI raccoglie dalla scheda sono quelle che il costruttore Web
/// (`buildPatientSmartImportProjectionCaptureInput`) produce dalla stessa scheda:
/// `capture-input.json` lo scrive `lib/smart-import-gpui-contract.test.ts`.
#[test]
fn capture_matches_the_web_builder() {
    let capture = chart().capture().unwrap();
    assert_eq!(
        fixture("capture-input"),
        capture,
        "GPUI raccoglie fonti diverse dal Web"
    );
    // Voce eliminata e terapia sospesa restano fuori.
    let text = capture.to_string();
    assert!(!text.contains("Questa voce non deve arrivare"));
    assert!(!text.contains("Amlodipina\""));
}

/// I corpi che GPUI invia, uguali ai file che il test TypeScript passa agli handler
/// reali, nello stesso ordine del Web.
#[test]
fn request_bodies_match_the_contract_fixtures() {
    let request = bound_request();
    let (status, body) = response("response-selection-epoch");
    assert_eq!(status, 200);
    let epoch = parse_selection_epoch(&body).unwrap();
    write_or_compare("request-selection", &request.selection_body(epoch));
    let (_, lease) = response("response-selection");
    let tuple = smart_import_selection_tuple(&lease, epoch).unwrap();
    write_or_compare("request-ingest", &request.ingest_body(&tuple).unwrap());
    let (status, body) = response("response-ingest");
    let Ok(Ok(handle)) = smart_import_ingest_step(status, &body) else {
        panic!("l'ingest reale restituisce una maniglia");
    };
    write_or_compare("request-preview", &request.preview_body(&handle).unwrap());
}

#[test]
fn real_handler_responses_become_outcomes() {
    let request = bound_request();
    let (status, body) = response("response-available");
    let Ok(GenerationOutcome::Proposal(proposal)) = smart_import_outcome(status, &body) else {
        panic!("la risposta disponibile è una proposta");
    };
    assert_eq!(proposal.writes_performed, 0);
    assert_eq!(
        (proposal.provider.as_str(), proposal.egress.as_str()),
        ("ollama", "none")
    );
    assert_eq!(proposal.diagnoses.len(), 1);
    assert_eq!(proposal.therapies.len(), 1);
    assert_eq!(proposal.services.len(), 1);
    assert!(
        proposal.cites_only(&request),
        "ogni candidato cita una fonte inviata"
    );
    // Ogni tipo di candidato viene da una fonte diversa della scheda.
    let kinds: Vec<&str> = proposal
        .candidates()
        .map(|c| request.source(&c.source_id).unwrap().kind)
        .collect();
    assert_eq!(
        kinds,
        ["clinical-entry", "patient-notes", "attachment-summary"]
    );
    for (name, expected) in [
        (
            "response-kill-switch-disabled",
            GenerationOutcome::Unavailable("kill_switch_disabled".into()),
        ),
        (
            "response-function-disabled",
            GenerationOutcome::Unavailable("function_disabled".into()),
        ),
        (
            "response-provider-unready",
            GenerationOutcome::Unavailable("provider_unready".into()),
        ),
        (
            "response-provider-failed",
            GenerationOutcome::Failed("provider_failed".into()),
        ),
        (
            "response-proposal-invalid",
            GenerationOutcome::Failed("proposal_invalid".into()),
        ),
        (
            "response-proposal-truncated",
            GenerationOutcome::Failed("response_truncated".into()),
        ),
        (
            "response-preview-replayed",
            GenerationOutcome::Failed("projection_unavailable".into()),
        ),
    ] {
        let (status, body) = response(name);
        assert_eq!(smart_import_outcome(status, &body), Ok(expected), "{name}");
    }
    let (status, body) = response("response-ingest-stale");
    assert_eq!(
        smart_import_ingest_step(status, &body),
        Ok(Err(GenerationOutcome::Failed("projection_stale".into())))
    );
}

/// Controprova: un corpo alterato non è mai una proposta.
#[test]
fn altered_responses_are_refused() {
    let base = fixture("response-available")["body"].clone();
    let check = |change: &dyn Fn(&mut Value)| {
        let mut body = base.clone();
        change(&mut body);
        smart_import_outcome(200, body.to_string().as_bytes())
    };
    assert!(check(&|_| {}).is_ok());
    for change in [
        &(|b: &mut Value| b["preview"]["writesPerformed"] = json!(1)) as &dyn Fn(&mut Value),
        &|b| b["preview"]["apply"] = json!("allowed"),
        &|b| b["preview"]["proposal"]["writesPerformed"] = json!(1),
        &|b| b["preview"]["extra"] = json!(true),
        &|b| b["preview"]["receipt"]["egressProfile"]["egress"] = json!("internet"),
        &|b| b["preview"]["receipt"]["provider"] = json!("chatgpt_subscription"),
        &|b| b["preview"]["receipt"]["fallbackCount"] = json!(1),
        &|b| b["preview"]["provenance"]["model"] = json!("altro-modello"),
        &|b| b["preview"]["reviewRef"] = json!("review_x"),
        &|b| b["preview"]["proposal"]["diagnoses"][0]["confidence"] = json!("certa"),
        &|b| b["preview"]["proposal"]["diagnoses"][0]["explicitCode"] = Value::Null,
        &|b| b["preview"]["proposal"]["therapies"][0]["extra"] = json!("x"),
        &|b| b["preview"]["proposal"]["summary"] = json!("x".repeat(221)),
        &|b| b["preview"]["status"] = json!("applied"),
    ] {
        assert_eq!(check(change), Err(RuntimeError::InvalidResponse));
    }
    assert_eq!(
        smart_import_ingest_step(200, br#"{"handle":"prj_x"}"#),
        Err(RuntimeError::InvalidResponse)
    );
    let (_, lease) = response("response-selection");
    let epoch = parse_selection_epoch(&response("response-selection-epoch").1).unwrap();
    assert_eq!(
        smart_import_selection_tuple(&lease, epoch + 1),
        Err(RuntimeError::InvalidResponse)
    );
    // Una proposta che cita una fonte mai inviata non vale per questa richiesta.
    let mut other = base.clone();
    other["preview"]["proposal"]["diagnoses"][0]["sourceId"] = json!("source.local.00000000009.01");
    let Ok(GenerationOutcome::Proposal(proposal)) =
        smart_import_outcome(200, other.to_string().as_bytes())
    else {
        panic!("la forma resta valida");
    };
    assert!(!proposal.cites_only(&bound_request()));
}

/// Regole della richiesta: fonti, paziente, scheda illeggibile.
#[test]
fn request_follows_the_chart() {
    let request = chart().request().unwrap();
    assert_eq!(request.count("patient-notes"), 2);
    assert_eq!(request.count("clinical-entry"), 3);
    assert_eq!(request.count("attachment-summary"), 1);
    assert_eq!((request.diagnosis_count, request.therapy_count), (1, 1));
    assert!(
        request.sources.iter().all(|s| s.id.is_empty()),
        "gli identificativi nascono all'invio"
    );

    let mut locked = chart();
    locked.patient.locked_fields.push("diagnoses".into());
    assert_eq!(locked.capture().unwrap_err(), RuntimeError::LockedField);

    let mut empty = chart();
    empty.patient.notes = None;
    empty.entries.clear();
    empty.attachments.clear();
    assert_eq!(empty.request().unwrap_err(), RuntimeError::Missing);

    let other = chart();
    assert_eq!(
        SmartImportRequest::new(&other.patient, Some("altro"), other.capture().unwrap())
            .map(|r| r.ambulatory_id),
        Ok("altro".to_owned())
    );
    let mut moved = chart();
    moved.patient.ambulatory_id = Some("ambulatorio-del-profilo".into());
    assert_eq!(moved.request().unwrap_err(), RuntimeError::InvalidInput);

    // Una sintesi di documento cambiata cambia ciò che una richiesta invierebbe.
    let mut changed = chart();
    changed.attachments[0].summary_snapshot = Some("Altra sintesi.".into());
    assert_ne!(changed.capture().unwrap(), request.capture);
    let mut removed = chart();
    removed.attachments.clear();
    assert_ne!(removed.capture().unwrap(), request.capture);

    let mut bound = bound_request();
    assert!(bound.source("source.local.00000000001.01").is_some());
    bound.wipe();
    assert!(bound.sources.iter().all(|s| s.content.is_empty()));
    assert_eq!(bound.capture, Value::Null);
}

/// Note oltre il limite di 900 unità UTF-16 (una riga ASCII di 901 caratteri, una di
/// caratteri fuori dal piano base): la richiesta nasce con le note accorciate entro il
/// limite, identiche a quelle del Web (`capture-input-limit.json`, scritto dal test TS).
/// Voci di diario in testo ricco e note vicino a 900 unità con emoji e caratteri fuori
/// dal piano base: le fonti sono quelle che il Web scrive in `capture-input-rich-text.json`.
#[test]
fn rich_text_entries_and_notes_near_the_limit_match_the_web() {
    let chart = chart_from("chart-rich-text");
    let capture = chart.capture().unwrap();
    for source in capture["sources"].as_array().unwrap() {
        if source["kind"] == "clinical-entry" {
            let content = source["content"].as_str().unwrap();
            assert!(
                !content.contains("<p>") && !content.contains("&amp;") && !content.contains("**"),
                "{content}"
            );
        }
    }
    assert_eq!(fixture("capture-input-rich-text"), capture);
}

#[test]
fn notes_over_the_limit_are_shortened_like_the_web() {
    let chart = chart_from("chart-limit");
    let request = chart
        .request()
        .expect("la preparazione riesce con le note accorciate");
    assert_eq!(request.count("patient-notes"), 2);
    for source in &request.sources {
        assert!(
            source.content.encode_utf16().count() <= 900,
            "{}",
            source.label
        );
        assert!(source.content.ends_with("..."));
    }
    assert_eq!(fixture("capture-input-limit"), chart.capture().unwrap());
}

/// Un errore senza proposta lo dice col solo motivo: la proposta mancante si vede.
#[test]
fn refusal_messages_state_only_the_reason() {
    for (code, expected) in [
        ("provider_failed", "Il modello locale non ha risposto."),
        (
            "proposal_invalid",
            "La risposta del modello non ha superato i controlli dell’host.",
        ),
        (
            "response_truncated",
            "La risposta del modello si è interrotta prima della fine. Riprova.",
        ),
        (
            "selection_changed",
            "La selezione sull’host è cambiata durante la richiesta. Riprova.",
        ),
        (
            "response_invalid",
            "La risposta dell’host non ha superato i controlli dell’app.",
        ),
        ("codice-sconosciuto", "L’host ha rifiutato la richiesta."),
    ] {
        assert_eq!(smart_import_message(code), expected, "{code}");
    }
    for code in [
        "kill_switch_disabled",
        "kill_switch_unavailable",
        "model_unavailable",
        "fabric_denied",
        "provider_failed",
        "proposal_invalid",
        "response_truncated",
        "lease_expired",
        "session_unavailable",
        "response_invalid",
        "codice-sconosciuto",
    ] {
        let message = smart_import_message(code);
        assert!(!message.contains("Nessuna proposta"), "{code}: {message}");
        assert!(!message.contains("GPUI"), "{code}: {message}");
    }
}
