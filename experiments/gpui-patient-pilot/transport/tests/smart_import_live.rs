//! Giro dell'import assistito contro un host MediFlow vero, con archivio sintetico e
//! provider finto: lo prepara il chiamante e passa la configurazione privata del client
//! abbinato in `MEDIFLOW_SMART_IMPORT_LIVE`. Senza la variabile il test non fa nulla;
//! in CI resta ignorato.
//!
//! `MEDIFLOW_SMART_IMPORT_LIVE_EXPECT` dice che cosa deve accadere: `proposal`
//! (funzione accesa) oppure `disabled` (interruttore spento sull'host).
//! Due voci di diario sintetiche le crea il test con lo stesso trasporto di GPUI, se la
//! scheda non le ha già; l'anteprima poi non scrive nulla.

use mediflow_runtime_client::{
    EntryDraft, GenerationOutcome, LocalHostAccess, PairingCredentials, RetirementNotice,
    RuntimeClient, RuntimeConfig, SmartImportChart, SmartImportRequest, smart_import_capture,
};
use serde_json::{Value, json};

const ENTRIES: [(&str, &str); 2] = [
    (
        "Visita sintetica di controllo",
        "Pressione 150/95 in due misurazioni. Si richiede ecocardiogramma.",
    ),
    (
        "Telefonata sintetica",
        "Terapia domiciliare: ramipril 5 mg una volta al giorno.",
    ),
];

fn plain(text: &str) -> String {
    text.to_owned()
}

#[test]
#[ignore = "richiede un host locale sintetico avviato dal chiamante"]
fn smart_import_against_a_real_host() {
    let Ok(path) = std::env::var("MEDIFLOW_SMART_IMPORT_LIVE") else {
        return;
    };
    let expect = std::env::var("MEDIFLOW_SMART_IMPORT_LIVE_EXPECT").unwrap();
    let config: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(config["synthetic"], true, "solo archivi sintetici");
    let text = |key: &str| config[key].as_str().unwrap().to_owned();
    let client = RuntimeClient::new(RuntimeConfig {
        base_url: text("baseUrl"),
        tls_pin_sha256: None,
    })
    .unwrap();
    let session = client
        .login(
            PairingCredentials::new(text("pairingId"), text("pairingToken")).unwrap(),
            &text("username"),
            &text("passphrase"),
        )
        .unwrap();
    let scope = text("scope");
    let patient_id = text("patientId");
    session.list_ambulatories().unwrap();

    // Due voci di diario sintetiche, cifrate da GPUI come nell'app.
    let entries = session.list_entries(&scope, &patient_id).unwrap();
    for (title, content) in ENTRIES {
        if !entries.iter().any(|row| row.title == title) {
            session
                .create_entry(
                    &scope,
                    &patient_id,
                    &EntryDraft {
                        entry_type: "visita".into(),
                        title: title.into(),
                        content: content.into(),
                        date: "2026-11-05T12:00:00.000Z".into(),
                        setting: None,
                    },
                )
                .unwrap();
        }
    }
    // Ciò che una scrittura cambierebbe: scheda, diario, terapie, documenti.
    let snapshot = || {
        let patient = session.read_patient_legacy(&scope, &patient_id).unwrap();
        let entries = session.list_entries(&scope, &patient_id).unwrap();
        let therapies = session.list_therapies(&scope, &patient_id).unwrap();
        let attachments = session.list_attachments(&scope, &patient_id).unwrap();
        let state = json!({
            "patient": [patient.version, patient.diagnoses, patient.notes],
            "entries": entries.iter().map(|r| json!([r.id, r.version, r.content, r.deleted_at])).collect::<Vec<_>>(),
            "therapies": therapies.iter().map(|r| json!([r.id, r.version, r.status, r.deleted_at])).collect::<Vec<_>>(),
            "attachments": attachments.iter().map(|r| json!([r.id, r.summary_snapshot, r.currentness])).collect::<Vec<_>>(),
        });
        (patient, entries, therapies, attachments, state)
    };
    let (patient, entries, therapies, attachments, before) = snapshot();

    let access: LocalHostAccess = session
        .authenticate_local_host(&text("passphrase"), RetirementNotice::new(None))
        .unwrap();
    let enabled = access.smart_import_enabled().unwrap();
    let capture = smart_import_capture(&SmartImportChart {
        patient: &patient,
        scope: Some(&scope),
        therapies: &therapies,
        entries: &entries,
        attachments: &attachments,
        plain: &plain,
    })
    .unwrap();
    let mut request = SmartImportRequest::new(&patient, Some(&scope), capture).unwrap();
    request.bind().unwrap();
    let context = access.generation_context();
    let outcome = access.preview_smart_import(&request, &context).unwrap();
    let report = match (&outcome, expect.as_str()) {
        (GenerationOutcome::Proposal(proposal), "proposal") => {
            assert!(enabled);
            assert_eq!(proposal.writes_performed, 0);
            assert_eq!(proposal.provider, "ollama");
            assert_eq!(proposal.venue, "local_process");
            assert_eq!(proposal.egress, "none");
            assert_eq!(proposal.fallback_count, 0);
            assert!(proposal.candidates().next().is_some());
            // Ogni candidato cita una fonte inviata da GPUI con questa richiesta.
            assert!(proposal.cites_only(&request));
            let sources: Vec<Value> = proposal
                .candidates()
                .map(|c| {
                    let source = request.source(&c.source_id).unwrap();
                    json!({"candidate": c.title, "source": source.label, "evidence": c.evidence,
                        "sourceContainsEvidence": source.content.contains(&c.evidence)})
                })
                .collect();
            json!({"outcome": "proposal", "summary": proposal.summary, "candidates": sources,
                "sentSources": request.sources.len(),
                "receipt": {"provider": proposal.provider, "model": proposal.model, "venue": proposal.venue,
                    "egress": proposal.egress, "fallbackCount": proposal.fallback_count,
                    "reviewRef": proposal.review_ref, "writesPerformed": proposal.writes_performed}})
        }
        (GenerationOutcome::Unavailable(code), "disabled") => {
            // GPUI non chiama quando l'interruttore è spento; qui si prova che anche il
            // server, chiamato lo stesso, rifiuta senza generare.
            assert!(!enabled);
            assert!(matches!(
                code.as_str(),
                "kill_switch_disabled" | "function_disabled"
            ));
            json!({"outcome": "unavailable", "code": code, "enabledReadByGpui": enabled})
        }
        (other, expected) => panic!("atteso {expected}, ricevuto {other:?}"),
    };
    // Nessuna scrittura: scheda, diario, terapie e documenti come prima.
    let (.., after) = snapshot();
    assert_eq!(before, after);
    println!("SMART_IMPORT_LIVE {report}");
    drop(access);
    session.logout().unwrap();
}
