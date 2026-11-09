//! Giro del Quadro paziente contro un host MediFlow vero, con archivio sintetico e
//! provider finto: lo prepara il chiamante e passa la configurazione privata del
//! client abbinato in `MEDIFLOW_PATIENT_INSIGHT_LIVE`. Senza la variabile il test
//! non fa nulla; in CI resta ignorato.
//!
//! `MEDIFLOW_PATIENT_INSIGHT_LIVE_EXPECT` dice che cosa deve accadere:
//! `proposal` (funzione accesa) oppure `disabled` (interruttore spento sull'host).

use mediflow_runtime_client::{
    LocalHostAccess, PairingCredentials, PatientInsightOutcome, RetirementNotice, RuntimeClient,
    RuntimeConfig, build_patient_insight_request, cited_sources, patient_insight_capture,
};
use serde_json::{Value, json};

#[test]
#[ignore = "richiede un host locale sintetico avviato dal chiamante"]
fn patient_insight_against_a_real_host() {
    let Ok(path) = std::env::var("MEDIFLOW_PATIENT_INSIGHT_LIVE") else {
        return;
    };
    let expect = std::env::var("MEDIFLOW_PATIENT_INSIGHT_LIVE_EXPECT").unwrap();
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
    session.select_profile_patient(&scope, &patient_id).unwrap();
    let intent = session.profile_query_intent();
    let patient = session
        .open_patient_profile(&scope, &patient_id, &intent)
        .unwrap();
    let therapies = session.list_therapies(&scope, &patient_id).unwrap();
    let entries = session.list_entries(&scope, &patient_id).unwrap();
    // Il profilo abbinato non espone l'ambulatorio: la richiesta usa quello della lettura.
    assert!(patient.ambulatory_id.is_none());

    let access: LocalHostAccess = session
        .authenticate_local_host(&text("passphrase"), RetirementNotice::new(None))
        .unwrap();
    let enabled = access.patient_insight_enabled().unwrap();
    let capture = patient_insight_capture(&patient, Some(&scope), &therapies, &entries).unwrap();
    let request = build_patient_insight_request(&capture).unwrap();
    let context = access.generation_context();
    let outcome = access.preview_patient_insight(&request, &context).unwrap();

    let report = match (&outcome, expect.as_str()) {
        (PatientInsightOutcome::Proposal(proposal), "proposal") => {
            assert!(enabled);
            assert_eq!(proposal.writes_performed, 0);
            assert_eq!(proposal.provider, "ollama");
            assert_eq!(proposal.venue, "local_process");
            assert_eq!(proposal.egress, "none");
            assert_eq!(proposal.patient_revision, patient.version);
            assert!(proposal.review_ref.starts_with("review_"));
            let lines: Vec<Value> = proposal
                .lines()
                .into_iter()
                .map(|(section, line)| {
                    let sources: Vec<Value> = cited_sources(line)
                        .into_iter()
                        .map(|index| {
                            let source = &request.sources[index - 1];
                            json!({"token": source.token, "kind": source.kind, "text": source.text})
                        })
                        .collect();
                    json!({"section": section, "text": line, "sources": sources})
                })
                .collect();
            assert!(
                lines
                    .iter()
                    .any(|line| !line["sources"].as_array().unwrap().is_empty()),
                "almeno una riga cita una fonte inviata"
            );
            json!({
                "outcome": "proposal", "lines": lines,
                "receipt": {"provider": proposal.provider, "model": proposal.model,
                    "venue": proposal.venue, "egress": proposal.egress,
                    "preprocessing": proposal.preprocessing, "reviewRef": proposal.review_ref,
                    "writesPerformed": proposal.writes_performed},
                "currentness": {"patientRevision": proposal.patient_revision,
                    "capturedAt": proposal.captured_at, "verifiedAt": proposal.verified_at},
                "sentSources": request.sources.len(),
            })
        }
        (PatientInsightOutcome::Unavailable(code), "disabled") => {
            // GPUI non chiama quando l'interruttore è spento; qui si prova che anche il
            // server, chiamato lo stesso, rifiuta senza generare.
            assert!(!enabled);
            assert!(matches!(
                code.as_str(),
                "function_disabled" | "kill_switch_disabled"
            ));
            json!({"outcome": "unavailable", "code": code, "enabledReadByGpui": enabled})
        }
        (other, expected) => panic!("atteso {expected}, ricevuto {other:?}"),
    };
    println!("PATIENT_INSIGHT_LIVE {report}");
    drop(access);
    session.logout().unwrap();
}
