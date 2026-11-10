//! Giro della sintesi documenti contro un host MediFlow vero, con archivio sintetico
//! e provider finto: lo prepara il chiamante e passa la configurazione privata del
//! client abbinato in `MEDIFLOW_DOCUMENT_SYNTHESIS_LIVE`. Senza la variabile il test
//! non fa nulla; in CI resta ignorato.
//!
//! `MEDIFLOW_DOCUMENT_SYNTHESIS_LIVE_EXPECT` dice che cosa deve accadere: `proposal`
//! (funzione accesa) oppure `disabled` (interruttore spento sull'host).
//! I due documenti PDF sintetici li crea il test con lo stesso trasporto di GPUI,
//! se la scheda non li ha già; la sintesi poi non scrive nulla.

use base64::Engine;
use mediflow_runtime_client::{
    Attachment, DocumentSynthesisRequest, GenerationOutcome, LocalHostAccess, PairingCredentials,
    RetirementNotice, RuntimeClient, RuntimeConfig,
};
use serde_json::{Value, json};
use zeroize::Zeroizing;

/// PDF di una pagina con testo estraibile, generato come il file di contratto.
fn pdf(lines: &[&str]) -> Vec<u8> {
    let mut content = String::from("BT /F1 11 Tf 50 780 Td\n");
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            content.push_str("0 -16 Td ");
        }
        content.push_str(&format!("({line}) Tj\n"));
    }
    content.push_str("ET");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_owned(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_owned(),
        format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = vec![];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    out
}

const DOCUMENTS: [(&str, &str); 2] = [
    (
        "Referto pressorio sintetico.pdf",
        "Pressione arteriosa 130/80 mmHg, stabile rispetto al controllo precedente.",
    ),
    (
        "Esami ematici sintetici.pdf",
        "Emoglobina glicata 6,9 per cento, in lieve calo rispetto a marzo.",
    ),
];

fn bytes_of(detail: &Attachment) -> Zeroizing<Vec<u8>> {
    let data = detail.data.as_deref().unwrap();
    let encoded = data
        .strip_prefix(&format!("data:{};base64,", detail.mime_type))
        .unwrap();
    Zeroizing::new(
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap(),
    )
}

#[test]
#[ignore = "richiede un host locale sintetico avviato dal chiamante"]
fn document_synthesis_against_a_real_host() {
    let Ok(path) = std::env::var("MEDIFLOW_DOCUMENT_SYNTHESIS_LIVE") else {
        return;
    };
    let expect = std::env::var("MEDIFLOW_DOCUMENT_SYNTHESIS_LIVE_EXPECT").unwrap();
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

    // Due documenti sintetici nella scheda, cifrati da GPUI come nell'app.
    let mut rows = session.list_attachments(&scope, &patient_id).unwrap();
    for (name, marker) in DOCUMENTS {
        if !rows.iter().any(|row| row.name == name) {
            let bytes = pdf(&[
                "Documento inventato per le prove automatiche di MediFlow.",
                marker,
                "Proseguire il controllo programmato secondo indicazione clinica.",
            ]);
            session
                .create_attachment(&scope, &patient_id, name, "application/pdf", &bytes)
                .unwrap();
        }
    }
    rows = session.list_attachments(&scope, &patient_id).unwrap();
    let before: Vec<(String, Option<String>, Option<Value>)> = rows
        .iter()
        .map(|row| {
            (
                row.id.clone(),
                row.summary_snapshot.clone(),
                row.currentness.clone(),
            )
        })
        .collect();

    let access: LocalHostAccess = session
        .authenticate_local_host(&text("passphrase"), RetirementNotice::new(None))
        .unwrap();
    let enabled = access.document_synthesis_enabled().unwrap();
    let mut reports = vec![];
    for (name, marker) in DOCUMENTS {
        let row = rows.iter().find(|row| row.name == name).unwrap();
        let detail = session
            .read_attachment(&scope, &patient_id, &row.id)
            .unwrap();
        let request =
            DocumentSynthesisRequest::new(&patient_id, &scope, row, &detail, bytes_of(&detail))
                .unwrap();
        let context = access.generation_context();
        let outcome = access
            .preview_document_synthesis(&request, &context)
            .unwrap();
        reports.push(match (&outcome, expect.as_str()) {
            (GenerationOutcome::Proposal(proposal), "proposal") => {
                assert!(enabled);
                assert_eq!(proposal.writes_performed, 0);
                assert_eq!(proposal.provider, "ollama");
                assert_eq!(proposal.venue, "local_process");
                assert_eq!(proposal.egress, "none");
                assert_eq!(proposal.fallback, "none");
                // La citazione viene dal documento inviato, non dall'altro.
                assert!(proposal.citations.iter().any(|c| c.quote == marker));
                let other = DOCUMENTS.iter().find(|(n, _)| *n != name).unwrap().1;
                assert!(!proposal.citations.iter().any(|c| c.quote == other));
                json!({"document": name, "outcome": "proposal", "summary": proposal.summary,
                    "citations": proposal.citations.iter().map(|c| json!({"label": c.label, "quote": c.quote})).collect::<Vec<_>>(),
                    "receipt": {"provider": proposal.provider, "model": proposal.model, "venue": proposal.venue,
                        "egress": proposal.egress, "fallback": proposal.fallback, "qualityLevel": proposal.quality_level,
                        "outputSha256": proposal.output_sha256, "writesPerformed": proposal.writes_performed}})
            }
            (GenerationOutcome::Unavailable(code), "disabled") => {
                // GPUI non chiama quando l'interruttore è spento; qui si prova che anche
                // il server, chiamato lo stesso, rifiuta senza generare.
                assert!(!enabled);
                assert!(matches!(code.as_str(), "lane_disabled" | "function_disabled"));
                json!({"document": name, "outcome": "unavailable", "code": code, "enabledReadByGpui": enabled})
            }
            (other, expected) => panic!("atteso {expected}, ricevuto {other:?}"),
        });
    }
    // Nessuna scrittura: documenti, sintesi salvate e currentness come prima.
    let after: Vec<(String, Option<String>, Option<Value>)> = session
        .list_attachments(&scope, &patient_id)
        .unwrap()
        .iter()
        .map(|row| {
            (
                row.id.clone(),
                row.summary_snapshot.clone(),
                row.currentness.clone(),
            )
        })
        .collect();
    assert_eq!(before, after);
    println!(
        "DOCUMENT_SYNTHESIS_LIVE {}",
        json!({"documents": rows.len(), "runs": reports})
    );
    drop(access);
    session.logout().unwrap();
}
