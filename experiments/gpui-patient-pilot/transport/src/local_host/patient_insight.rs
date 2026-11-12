//! Quadro paziente (Patient Insight, G-5a) tramite l'host locale.
//!
//! GPUI costruisce la stessa richiesta minimizzata del Web
//! (`buildPatientInsightPreviewRequest`) dai dati della scheda già letti, la invia
//! alla route Web `/api/ai/patient-insight/preview` con la sessione Web
//! dell'host e legge la risposta con le stesse regole di
//! `parsePatientInsightPreviewWireRoot`. Il server resta l'autorità: kill switch,
//! governo delle funzioni, validazione della proposta, citazioni `[Sx]`, ricevuta
//! e currentness sono suoi. Qui non esiste alcun percorso di scrittura.
//!
//! Le parti generiche (testo normalizzato come in JS, campi esatti, ISO, fonti
//! citate, chiamata annullabile) servono anche a sintesi documenti e import
//! assistito, che hanno contratti di richiesta e risposta propri.

use super::*;
use regex::Regex;
use std::sync::OnceLock;

pub const PATIENT_INSIGHT_PATH: &[&str] = &["api", "ai", "patient-insight", "preview"];
pub const PATIENT_INSIGHT_FOCUS: &str = "Valutazione manuale del follow-up clinico attuale";
/// Riga sopra ogni proposta, stesso testo del Web (`PATIENT_INSIGHT_REVIEW_NOTICE`) e dell'app Apple.
pub const PATIENT_INSIGHT_REVIEW_NOTICE: &str = "Controlla ogni frase sulla fonte che cita: il modello può scambiare ciò che è fatto con ciò che è da fare.";
const REQUEST_SCHEMA: &str = "mediflow.patient-insight.preview-request.v1";
const PROPOSAL_SCHEMA: &str = "mediflow.patient-insight.review-proposal.v2";
const MAX_ITEMS: usize = 12;

fn text_field(value: &Value, key: &str, max: usize) -> Option<String> {
    value[key].as_str().and_then(|text| bounded_text(text, max))
}

fn entity_id(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$").is_match(value)
}
fn request_id(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^[A-Za-z][A-Za-z0-9._:-]{15,159}$").is_match(value)
}
fn model_name(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,127}$").is_match(value)
}
fn digest(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^sha256_[0-9a-f]{64}$").is_match(value)
}
fn review_ref(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^review_[0-9a-f]{32}$").is_match(value)
}

/// Una riga numerata del contesto che il modello cita come `[Sx]`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InsightSource {
    pub token: String,
    pub kind: &'static str,
    pub text: String,
}

/// La richiesta pronta, con le fonti nell'ordine in cui l'host le numera.
#[derive(Clone, Debug, PartialEq)]
pub struct PatientInsightRequest {
    pub body: Value,
    pub sources: Vec<InsightSource>,
    pub patient_id: String,
    pub patient_revision: u64,
}
impl PatientInsightRequest {
    pub fn condition_count(&self) -> usize {
        self.body["sources"]["conditions"]
            .as_array()
            .map_or(0, Vec::len)
    }
    pub fn therapy_count(&self) -> usize {
        self.body["sources"]["activeTherapies"]
            .as_array()
            .map_or(0, Vec::len)
    }
    pub fn event_count(&self) -> usize {
        self.body["sources"]["recentEvents"]
            .as_array()
            .map_or(0, Vec::len)
    }
}

fn labels(values: &[Value], render: impl Fn(&Value) -> Option<String>) -> Vec<String> {
    let mut output = Vec::new();
    for value in values {
        if output.len() >= MAX_ITEMS || !value.is_object() {
            break;
        }
        if let Some(label) = render(value) {
            output.push(label);
        }
    }
    output
}

/// Specchio di `buildPatientInsightPreviewRequest`. `capture` ha la forma
/// `CaptureInput` del Web: `patient` (id, ambulatoryId, version, diagnoses),
/// `therapies`, `entries` dalla più recente, `requestId`, `capturedAt`.
pub fn build_patient_insight_request(capture: &Value) -> Result<PatientInsightRequest> {
    let patient = &capture["patient"];
    let patient_id = patient["id"]
        .as_str()
        .filter(|id| entity_id(id))
        .ok_or(RuntimeError::InvalidInput)?;
    let ambulatory_id = patient["ambulatoryId"]
        .as_str()
        .filter(|id| entity_id(id))
        .ok_or(RuntimeError::InvalidInput)?;
    let revision = patient["version"]
        .as_u64()
        .filter(|v| (1..=9_007_199_254_740_991).contains(v))
        .ok_or(RuntimeError::InvalidInput)?;
    let request = capture["requestId"]
        .as_str()
        .filter(|id| request_id(id))
        .ok_or(RuntimeError::InvalidInput)?;
    let captured_at = canonical_iso(&capture["capturedAt"]).ok_or(RuntimeError::InvalidInput)?;
    let empty = Vec::new();
    let conditions = labels(patient["diagnoses"].as_array().unwrap_or(&empty), |value| {
        let description = text_field(value, "description", 200)?;
        let code = text_field(value, "code", 32);
        bounded_text(
            &match code {
                Some(code) => format!("{description} ({code})"),
                None => description,
            },
            240,
        )
    });
    let therapies: Vec<Value> = capture["therapies"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .filter(|item| item["status"] == "active")
        .cloned()
        .collect();
    // Stesso separatore del Web (lineetta lunga, U+2014): è testo per il modello, non interfaccia.
    let active_therapies = labels(&therapies, |value| {
        let drug = text_field(value, "drugName", 160)?;
        let dosage = text_field(value, "dosage", 72);
        bounded_text(
            &match dosage {
                Some(dosage) => format!("{drug} \u{2014} {dosage}"),
                None => drug,
            },
            240,
        )
    });
    let recent_events: Vec<String> = capture["entries"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .take(MAX_ITEMS)
        .filter_map(|value| {
            let title = text_field(value, "title", 96);
            // Le voci di diario sono testo ricco: al modello va il testo semplice del Web,
            // tagliato dopo la conversione.
            let content = value["content"]
                .as_str()
                .and_then(|text| bounded_text(&rich_text_plain(text), 220));
            if title.is_none() && content.is_none() {
                return None;
            }
            let title = title.unwrap_or_else(|| "Evento clinico".into());
            bounded_text(
                &match content {
                    Some(content) => format!("{title}: {content}"),
                    None => title,
                },
                240,
            )
        })
        .collect();

    let mut sources = vec![InsightSource {
        token: "S1".into(),
        kind: "Motivo della richiesta",
        text: PATIENT_INSIGHT_FOCUS.into(),
    }];
    for (kind, items) in [
        ("Condizione attiva", &conditions),
        ("Terapia corrente", &active_therapies),
        ("Evento clinico recente", &recent_events),
    ] {
        for item in items {
            sources.push(InsightSource {
                token: format!("S{}", sources.len() + 1),
                kind,
                text: item.clone(),
            });
        }
    }
    let body = json!({
        "schemaVersion": REQUEST_SCHEMA,
        "requestId": request,
        "patientId": patient_id,
        "ambulatoryId": ambulatory_id,
        "patientRevision": revision,
        "capturedAt": captured_at,
        "sources": {
            "focus": {"summary": PATIENT_INSIGHT_FOCUS},
            "conditions": conditions.iter().map(|label| json!({"label": label})).collect::<Vec<_>>(),
            "activeTherapies": active_therapies.iter().map(|label| json!({"label": label})).collect::<Vec<_>>(),
            "recentEvents": recent_events.iter().map(|summary| json!({"summary": summary})).collect::<Vec<_>>(),
        },
    });
    Ok(PatientInsightRequest {
        body,
        sources,
        patient_id: patient_id.to_owned(),
        patient_revision: revision,
    })
}

/// Materiale della richiesta dai dati della scheda già letti e decifrati da GPUI,
/// con identificativo e ora nuovi. Stesse scelte del Web: terapie non eliminate
/// (il costruttore tiene le attive), al più dodici voci di diario dalla più recente.
/// Righe con campi cifrati illeggibili restano fuori: non diventano testo vuoto.
///
/// Il profilo abbinato non espone l'ambulatorio interno: vale l'ambulatorio con cui
/// GPUI ha letto la scheda. Se il profilo lo porta e non coincide, la richiesta non parte.
pub fn patient_insight_capture(
    patient: &crate::PatientDetail,
    scope: Option<&str>,
    therapies: &[crate::Therapy],
    entries: &[crate::Entry],
) -> Result<Value> {
    capture_with(
        patient,
        scope,
        therapies,
        entries,
        format!("pi_{}", crate::http::operation_uuid()?),
        iso_now(),
    )
}

/// Le fonti numerate che una richiesta costruita adesso invierebbe. Servono a dire
/// se una proposta descrive ancora la scheda: diario e terapie cambiano senza
/// alzare la revisione del paziente.
pub fn patient_insight_sources(
    patient: &crate::PatientDetail,
    scope: Option<&str>,
    therapies: &[crate::Therapy],
    entries: &[crate::Entry],
) -> Result<Vec<InsightSource>> {
    let capture = capture_with(
        patient,
        scope,
        therapies,
        entries,
        "pi_current_sources_check".into(),
        "2000-01-01T00:00:00.000Z".into(),
    )?;
    Ok(build_patient_insight_request(&capture)?.sources)
}

fn capture_with(
    patient: &crate::PatientDetail,
    scope: Option<&str>,
    therapies: &[crate::Therapy],
    entries: &[crate::Entry],
    request_id: String,
    captured_at: String,
) -> Result<Value> {
    if patient
        .locked_fields
        .iter()
        .any(|field| field == "diagnoses")
    {
        return Err(RuntimeError::LockedField);
    }
    let ambulatory_id = match (patient.ambulatory_id.as_deref(), scope) {
        (Some(own), Some(scope)) if own != scope => return Err(RuntimeError::InvalidInput),
        (Some(id), _) | (None, Some(id)) => id,
        (None, None) => return Err(RuntimeError::InvalidInput),
    };
    let diagnoses = match patient.diagnoses.as_deref().map(str::trim) {
        None | Some("") => json!([]),
        Some(text) => serde_json::from_str::<Value>(text)
            .ok()
            .filter(Value::is_array)
            .ok_or(RuntimeError::InvalidInput)?,
    };
    let therapies: Vec<Value> = therapies
        .iter()
        .filter(|row| row.deleted_at.is_none() && row.locked_fields.is_empty())
        .map(|row| json!({"drugName": row.drug_name, "dosage": row.dosage, "status": row.status}))
        .collect();
    let mut rows: Vec<&crate::Entry> = entries
        .iter()
        .filter(|row| row.deleted_at.is_none() && row.locked_fields.is_empty())
        .collect();
    rows.sort_by(|a, b| b.date.cmp(&a.date));
    let entries: Vec<Value> = rows
        .into_iter()
        .take(MAX_ITEMS)
        .map(|row| json!({"title": row.title, "content": row.content}))
        .collect();
    Ok(json!({
        "patient": {
            "id": patient.id,
            "ambulatoryId": ambulatory_id,
            "version": patient.version,
            "diagnoses": diagnoses,
        },
        "therapies": therapies,
        "entries": entries,
        "requestId": request_id,
        "capturedAt": captured_at,
    }))
}

/// Una proposta da rivedere: nessuna scrittura, nessuna applicazione.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PatientInsightProposal {
    pub summary: String,
    pub current_state: Vec<String>,
    pub alerts: Vec<String>,
    pub next_steps: Vec<String>,
    pub gaps: Vec<String>,
    pub generated_at: String,
    pub selection_epoch: u64,
    pub patient_revision: u64,
    pub captured_at: String,
    pub verified_at: String,
    pub provider: String,
    pub model: String,
    pub venue: String,
    pub egress: String,
    pub preprocessing: Vec<String>,
    /// Chiamate al modello locale registrate dall'host (1 o 2). `None` per la ricevuta
    /// di un host precedente, che non lo registrava: nessun numero inventato.
    pub attempts: Option<u8>,
    pub review_ref: String,
    pub writes_performed: u64,
}
impl PatientInsightProposal {
    /// Tutte le righe, con la sezione a cui appartengono.
    pub fn lines(&self) -> Vec<(&'static str, &str)> {
        let mut lines = Vec::new();
        if !self.summary.is_empty() {
            lines.push(("Sintesi proposta", self.summary.as_str()));
        }
        for (title, items) in [
            ("Stato attuale", &self.current_state),
            ("Attenzioni proposte", &self.alerts),
            ("Follow-up proposto", &self.next_steps),
            ("Dati mancanti", &self.gaps),
        ] {
            lines.extend(items.iter().map(|item| (title, item.as_str())));
        }
        lines
    }
}

/// Esito del Quadro paziente.
pub type PatientInsightOutcome = GenerationOutcome<PatientInsightProposal>;

const DENIAL_CODES: [&str; 13] = [
    "input_invalid",
    "kill_switch_disabled",
    "kill_switch_unavailable",
    "projection_unavailable",
    "source_stale",
    "lifecycle_missing",
    "lifecycle_corrupt",
    "lifecycle_unavailable",
    "provider_binding_denied",
    "provider_unready",
    "model_unavailable",
    "fabric_denied",
    "source_invalid",
];
const FAILURE_CODES: [&str; 4] = [
    "provider_failed",
    "proposal_invalid",
    "proposal_unfaithful",
    "source_stale",
];
/// Codici di diniego che dicono «funzione non disponibile» e non «errore».
const UNAVAILABLE_CODES: [&str; 11] = [
    "kill_switch_disabled",
    "kill_switch_unavailable",
    "function_disabled",
    "lifecycle_missing",
    "lifecycle_corrupt",
    "lifecycle_unavailable",
    "provider_binding_denied",
    "provider_unready",
    "model_unavailable",
    "provider_unavailable",
    "fabric_denied",
];

/// Testo per un codice del servizio, sullo stile dei messaggi del pannello Web.
pub fn patient_insight_message(code: &str) -> &'static str {
    match code {
        "kill_switch_disabled" | "function_disabled" => {
            "Il Quadro paziente è spento sull'home-base. Si riattiva in Impostazioni, Funzioni IA."
        }
        "kill_switch_unavailable" => "Lo stato della funzione sull'home-base non è leggibile.",
        "lifecycle_missing"
        | "lifecycle_corrupt"
        | "lifecycle_unavailable"
        | "provider_binding_denied"
        | "provider_unready"
        | "model_unavailable"
        | "provider_unavailable" => {
            "Il modello locale dell'home-base non è disponibile. Verifica Impostazioni, Modelli locali."
        }
        "fabric_denied" => "L'home-base non ha autorizzato l'esecuzione sul modello locale.",
        "source_stale" => {
            "I dati della scheda sono cambiati durante la generazione. Rileggi la scheda e riprova."
        }
        "provider_failed" => "Il modello locale non ha completato la risposta.",
        "proposal_invalid" => "La risposta del modello non ha superato i controlli dell'home-base.",
        // ADR 0189: stesso testo del Web (`PATIENT_INSIGHT_UNFAITHFUL_MESSAGE`).
        "proposal_unfaithful" => {
            "Il modello ha dato per presa una decisione ancora aperta nella scheda, o per urgente qualcosa che la scheda non segnala come urgente."
        }
        "binding_stale" | "catalog_stale" | "session_stale" => {
            "La configurazione dei modelli è cambiata durante la richiesta. Riprova."
        }
        "session_unavailable" => {
            "La sessione dell'home-base non è più valida. Riapri l'accesso locale."
        }
        "response_invalid" => "La risposta dell'home-base non ha superato i controlli dell'app.",
        _ => "L'home-base ha rifiutato la richiesta.",
    }
}

fn classify(code: &str) -> PatientInsightOutcome {
    if UNAVAILABLE_CODES.contains(&code) {
        PatientInsightOutcome::Unavailable(code.to_owned())
    } else {
        PatientInsightOutcome::Failed(code.to_owned())
    }
}

fn string_array(value: &Value, max: usize) -> Option<Vec<String>> {
    let items = value.as_array()?;
    if items.len() > max {
        return None;
    }
    items
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|text| {
                    !text.is_empty()
                        && text.encode_utf16().count() <= 1_200
                        && text.trim_matches(js_space) == *text
                })
                .map(str::to_owned)
        })
        .collect()
}

fn local_receipt(value: &Value) -> Option<(String, String, String, String)> {
    let receipt = exact_object(
        value,
        &[
            "schemaVersion",
            "capability",
            "venue",
            "provider",
            "model",
            "egress",
        ],
    )?;
    let model = receipt["model"].as_str().filter(|m| model_name(m))?;
    (receipt["schemaVersion"] == "mediflow.ai.fabric-resolution.v1"
        && receipt["capability"] == "patient_insight"
        && receipt["venue"] == "local_process"
        && receipt["provider"] == "ollama"
        && receipt["egress"] == "none")
        .then(|| {
            (
                "ollama".into(),
                model.to_owned(),
                "local_process".into(),
                "none".into(),
            )
        })
}

/// Specchio di `provenanceWire`: passi di preprocessing e tentativi. La ricevuta di un
/// host precedente non ha `attempts` e si legge ancora; un valore diverso da 1 o 2 no.
fn local_provenance(value: &Value, model: &str) -> Option<(Vec<String>, Option<u8>)> {
    const KEYS: [&str; 6] = [
        "schemaVersion",
        "capability",
        "venue",
        "provider",
        "model",
        "preprocessing",
    ];
    let (provenance, attempts) = match exact_object(value, &KEYS) {
        Some(provenance) => (provenance, None),
        None => {
            let mut keys = KEYS.to_vec();
            keys.push("attempts");
            let provenance = exact_object(value, &keys)?;
            let attempts = provenance["attempts"]
                .as_u64()
                .filter(|count| matches!(count, 1 | 2))? as u8;
            (provenance, Some(attempts))
        }
    };
    let steps = string_array(&provenance["preprocessing"], 2)?;
    (steps == ["context_minimization", "envelope_validation"]
        && provenance["schemaVersion"] == "mediflow.ai.fabric-provenance.v1"
        && provenance["capability"] == "patient_insight"
        && provenance["venue"] == "local_process"
        && provenance["provider"] == "ollama"
        && provenance["model"] == model)
        .then_some((steps, attempts))
}

fn safe_integer(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .filter(|v| (1..=9_007_199_254_740_991).contains(v))
}

/// Specchio di `parsePatientInsightPreviewWireRoot`. Una ricevuta remota (venue
/// ChatGPT) non è accettata: GPUI non chiede mai il canale remoto.
pub fn parse_patient_insight_root(value: &Value) -> Result<PatientInsightOutcome> {
    let invalid = RuntimeError::InvalidResponse;
    let root = exact_object(value, &["preview"]).ok_or(invalid)?;
    let preview = exact_object(
        &root["preview"],
        &[
            "writesPerformed",
            "apply",
            "status",
            "code",
            "proposal",
            "receipt",
            "provenance",
            "reviewRef",
        ],
    )
    .ok_or(invalid)?;
    if preview["writesPerformed"] != json!(0) || preview["apply"] != "denied" {
        return Err(invalid);
    }
    let code = preview["code"].as_str();
    match preview["status"].as_str() {
        Some("denied") => {
            let code = code.filter(|c| DENIAL_CODES.contains(c)).ok_or(invalid)?;
            if !(preview["proposal"].is_null()
                && preview["receipt"].is_null()
                && preview["provenance"].is_null()
                && preview["reviewRef"].is_null())
            {
                return Err(invalid);
            }
            Ok(classify(code))
        }
        Some("failed") => {
            let code = code.filter(|c| FAILURE_CODES.contains(c)).ok_or(invalid)?;
            let (_, model, _, _) = local_receipt(&preview["receipt"]).ok_or(invalid)?;
            local_provenance(&preview["provenance"], &model).ok_or(invalid)?;
            if !preview["proposal"].is_null() || !preview["reviewRef"].is_null() {
                return Err(invalid);
            }
            Ok(classify(code))
        }
        Some("available") => {
            if !preview["code"].is_null() {
                return Err(invalid);
            }
            let (provider, model, venue, egress) =
                local_receipt(&preview["receipt"]).ok_or(invalid)?;
            let (preprocessing, attempts) =
                local_provenance(&preview["provenance"], &model).ok_or(invalid)?;
            let review = preview["reviewRef"]
                .as_str()
                .filter(|r| review_ref(r))
                .ok_or(invalid)?;
            let proposal = exact_object(
                &preview["proposal"],
                &[
                    "schemaVersion",
                    "reviewOnly",
                    "summary",
                    "currentState",
                    "alerts",
                    "nextSteps",
                    "gaps",
                    "generatedAt",
                    "currentness",
                ],
            )
            .ok_or(invalid)?;
            let summary = proposal["summary"]
                .as_str()
                .filter(|s| s.encode_utf16().count() <= 1_200 && s.trim_matches(js_space) == *s)
                .ok_or(invalid)?;
            let current_state = string_array(&proposal["currentState"], 2).ok_or(invalid)?;
            let alerts = string_array(&proposal["alerts"], 2).ok_or(invalid)?;
            let next_steps = string_array(&proposal["nextSteps"], 3).ok_or(invalid)?;
            let gaps = string_array(&proposal["gaps"], 1).ok_or(invalid)?;
            let generated_at = canonical_iso(&proposal["generatedAt"]).ok_or(invalid)?;
            let currentness = exact_object(
                &proposal["currentness"],
                &[
                    "selectionEpoch",
                    "patientRevision",
                    "projectionDigest",
                    "capturedAt",
                    "verifiedAt",
                ],
            )
            .ok_or(invalid)?;
            if proposal["schemaVersion"] != PROPOSAL_SCHEMA
                || proposal["reviewOnly"] != true
                || !currentness["projectionDigest"].as_str().is_some_and(digest)
                || (summary.is_empty()
                    && current_state.is_empty()
                    && alerts.is_empty()
                    && next_steps.is_empty()
                    && gaps.is_empty())
            {
                return Err(invalid);
            }
            Ok(PatientInsightOutcome::Proposal(Box::new(
                PatientInsightProposal {
                    summary: summary.to_owned(),
                    current_state,
                    alerts,
                    next_steps,
                    gaps,
                    generated_at,
                    selection_epoch: safe_integer(&currentness["selectionEpoch"]).ok_or(invalid)?,
                    patient_revision: safe_integer(&currentness["patientRevision"])
                        .ok_or(invalid)?,
                    captured_at: canonical_iso(&currentness["capturedAt"]).ok_or(invalid)?,
                    verified_at: canonical_iso(&currentness["verifiedAt"]).ok_or(invalid)?,
                    provider,
                    model,
                    venue,
                    egress,
                    preprocessing,
                    attempts,
                    review_ref: review.to_owned(),
                    writes_performed: 0,
                },
            )))
        }
        _ => Err(invalid),
    }
}

/// Risposta HTTP della route (stato, corpo) letta come esito. Le risposte non 200
/// portano soltanto un codice: nessun testo del server arriva all'interfaccia.
pub fn patient_insight_outcome(
    request: &PatientInsightRequest,
    status: u16,
    body: &[u8],
) -> Result<PatientInsightOutcome> {
    if status != 200 {
        let code = denial_code(body);
        return Ok(match status {
            401 => PatientInsightOutcome::Failed("session_unavailable".into()),
            403 => PatientInsightOutcome::Unavailable(if code == "function_disabled" {
                code
            } else {
                "fabric_denied".into()
            }),
            409 => PatientInsightOutcome::Failed(if code.is_empty() {
                "binding_stale".into()
            } else {
                code
            }),
            503 if UNAVAILABLE_CODES.contains(&code.as_str()) => {
                PatientInsightOutcome::Unavailable(code)
            }
            _ => PatientInsightOutcome::Failed(if code.is_empty() {
                "preview_unavailable".into()
            } else {
                code
            }),
        });
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    let outcome = parse_patient_insight_root(&value)?;
    if let PatientInsightOutcome::Proposal(proposal) = &outcome {
        // La proposta appartiene a questa richiesta: stessa revisione, stessa cattura,
        // e ogni `Sx` citata esiste fra le fonti inviate.
        let captured = request.body["capturedAt"].as_str().unwrap_or_default();
        if proposal.patient_revision != request.patient_revision
            || proposal.captured_at != captured
            || proposal
                .lines()
                .iter()
                .flat_map(|(_, line)| cited_sources(line))
                .any(|index| index == 0 || index > request.sources.len())
        {
            return Err(RuntimeError::InvalidResponse);
        }
    }
    Ok(outcome)
}

impl LocalHostAccess {
    /// Il kill switch del Quadro paziente come lo legge il Web, prima di ogni richiesta.
    pub fn patient_insight_enabled(&self) -> Result<bool> {
        Ok(matches!(
            self.setting_value(HostSettingKey::PatientInsight)?
                .as_deref(),
            Some("enabled" | "true" | "1")
        ))
    }
    /// Una richiesta, un tentativo. Non è una scrittura: l'host risponde con `writesPerformed: 0`.
    pub fn preview_patient_insight(
        &self,
        request: &PatientInsightRequest,
        context: &RequestContext,
    ) -> Result<PatientInsightOutcome> {
        let raw = self
            .client
            .with_request_context(context.clone())
            .dedicated_web_raw(
                Method::POST,
                PATIENT_INSIGHT_PATH,
                self.headers()?,
                Some(&request.body),
                false,
            )?;
        patient_insight_outcome(request, raw.status, &raw.body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/patient_insight"
    );
    fn fixture(name: &str) -> Value {
        serde_json::from_str(&std::fs::read_to_string(format!("{FIXTURES}/{name}.json")).unwrap())
            .unwrap()
    }
    fn request() -> PatientInsightRequest {
        build_patient_insight_request(&fixture("capture")).unwrap()
    }
    fn outcome(name: &str) -> Result<PatientInsightOutcome> {
        let response = fixture(name);
        let status = response["status"].as_u64().unwrap() as u16;
        patient_insight_outcome(&request(), status, response["body"].to_string().as_bytes())
    }

    #[test]
    fn bounded_text_follows_the_javascript_rules() {
        assert_eq!(
            bounded_text("  a\u{a0}\u{2003}b\n\tc  ", 240).as_deref(),
            Some("a b c")
        );
        assert_eq!(bounded_text(" \u{feff} ", 240), None);
        assert_eq!(bounded_text("abcdef gh", 7).as_deref(), Some("abcdef"));
        // Una emoji conta due unità UTF-16, come `slice` in JavaScript.
        assert_eq!(bounded_text("ab🩺c", 3).as_deref(), Some("ab"));
        assert_eq!(bounded_text("ab🩺c", 4).as_deref(), Some("ab🩺"));
        // U+0085 non è uno spazio per JavaScript.
        assert_eq!(bounded_text("a\u{85}b", 240).as_deref(), Some("a\u{85}b"));
    }

    #[test]
    fn citations_are_read_as_source_indices() {
        assert_eq!(cited_sources("Quadro stabile. [S1, S3] e [S3]"), vec![1, 3]);
        assert_eq!(
            cited_sources("Dato assente. [DATI-INCOMPLETI]"),
            Vec::<usize>::new()
        );
        assert_eq!(cited_sources("Testo senza fonti"), Vec::<usize>::new());
    }

    /// La richiesta che GPUI costruisce, identica al file che
    /// `lib/patient-insight-gpui-contract.test.ts` passa all'handler reale.
    #[test]
    fn request_body_matches_the_contract_fixture() {
        let built = request();
        let file = format!("{FIXTURES}/request.json");
        if std::env::var_os("MEDIFLOW_WRITE_FIXTURES").is_some() {
            std::fs::write(
                &file,
                format!("{}\n", serde_json::to_string_pretty(&built.body).unwrap()),
            )
            .unwrap();
        }
        assert_eq!(fixture("request"), built.body);
        assert_eq!(built.sources[0].text, PATIENT_INSIGHT_FOCUS);
        assert_eq!(
            built.sources.len(),
            1 + built.condition_count() + built.therapy_count() + built.event_count()
        );
        assert!(
            built
                .sources
                .iter()
                .enumerate()
                .all(|(i, s)| s.token == format!("S{}", i + 1))
        );
    }

    #[test]
    fn capture_without_patient_identity_is_refused() {
        let mut capture = fixture("capture");
        capture["patient"]["ambulatoryId"] = Value::Null;
        assert_eq!(
            build_patient_insight_request(&capture),
            Err(RuntimeError::InvalidInput)
        );
        let mut capture = fixture("capture");
        capture["capturedAt"] = json!("2026-11-09T10:00:00Z");
        assert_eq!(
            build_patient_insight_request(&capture),
            Err(RuntimeError::InvalidInput)
        );
    }

    /// Il profilo abbinato arriva senza ambulatorio: vale quello della lettura, e un
    /// profilo che ne indica un altro non parte. Righe illeggibili restano fuori.
    #[test]
    fn capture_uses_the_read_scope_and_skips_unreadable_rows() {
        let detail = |ambulatory: Value| -> crate::PatientDetail {
            serde_json::from_value(json!({
                "id": "pi-gpui-synthetic-0001", "firstName": "Ada", "lastName": "Sintetica",
                "birthDate": null, "taxCode": "SYNTHETIC", "address": null, "phone": null,
                "caregiver": null, "exemptions": null,
                "diagnoses": "[{\"code\":\"I10\",\"description\":\"Ipertensione\"}]",
                "monitoringProfile": null, "statusReason": null, "archiveReason": null,
                "archiveNote": null, "notes": null, "isAdi": false, "isArchived": false,
                "version": 3, "ambulatoryId": ambulatory, "createdAt": null,
                "updatedAt": null, "deletedAt": null,
            }))
            .unwrap()
        };
        let therapy = |name: &str, locked: bool| -> crate::Therapy {
            let mut row: crate::Therapy = serde_json::from_value(json!({
                "id": name, "patientId": "p", "drugName": name, "aic": null, "atc": null,
                "activePrinciple": null, "dosage": "", "motivation": null, "diagnosisCode": null,
                "diagnosisName": null, "status": "active", "startDate": "2026-01-01",
                "endDate": null, "version": 1, "createdAt": null, "updatedAt": null,
                "deletedAt": null, "deletionReason": null,
            }))
            .unwrap();
            if locked {
                row.locked_fields.push("dosage".into());
            }
            row
        };
        let therapies = [therapy("Ramipril", false), therapy("Illeggibile", true)];
        let capture = patient_insight_capture(
            &detail(Value::Null),
            Some("ambulatory-synthetic-01"),
            &therapies,
            &[],
        )
        .unwrap();
        assert_eq!(
            capture["patient"]["ambulatoryId"],
            "ambulatory-synthetic-01"
        );
        assert_eq!(capture["therapies"].as_array().unwrap().len(), 1);
        let request = build_patient_insight_request(&capture).unwrap();
        assert_eq!(request.therapy_count(), 1);
        assert_eq!(request.condition_count(), 1);
        assert_eq!(
            patient_insight_capture(&detail(Value::Null), None, &therapies, &[]),
            Err(RuntimeError::InvalidInput)
        );
        assert_eq!(
            patient_insight_capture(
                &detail(json!("altro")),
                Some("ambulatory-synthetic-01"),
                &therapies,
                &[]
            ),
            Err(RuntimeError::InvalidInput)
        );
        let mut locked = detail(Value::Null);
        locked.locked_fields.push("diagnoses".into());
        assert_eq!(
            patient_insight_capture(&locked, Some("ambulatory-synthetic-01"), &therapies, &[]),
            Err(RuntimeError::LockedField)
        );
    }

    /// Le risposte prodotte dall'handler reale nel test TypeScript.
    #[test]
    fn real_handler_responses_become_outcomes() {
        let Ok(PatientInsightOutcome::Proposal(proposal)) = outcome("response-available") else {
            panic!("the available response is a proposal");
        };
        assert_eq!(proposal.writes_performed, 0);
        assert_eq!(proposal.provider, "ollama");
        assert_eq!(proposal.egress, "none");
        // Caso normale: una sola chiamata al modello, registrata dall'host.
        assert_eq!(proposal.attempts, Some(1));
        assert!(!proposal.lines().is_empty());
        assert!(
            proposal
                .lines()
                .iter()
                .any(|(_, line)| !cited_sources(line).is_empty())
        );
        assert_eq!(
            outcome("response-proposal-invalid"),
            Ok(PatientInsightOutcome::Failed("proposal_invalid".into()))
        );
        // ADR 0189: lo scarto per infedeltà ha un codice e un testo propri.
        assert_eq!(
            outcome("response-proposal-unfaithful"),
            Ok(PatientInsightOutcome::Failed("proposal_unfaithful".into()))
        );
        let unfaithful = patient_insight_message("proposal_unfaithful");
        assert!(unfaithful.contains("decisione ancora aperta"));
        assert!(unfaithful.contains("urgente"));
        assert!(!unfaithful.contains('\u{2014}'));
        assert_ne!(unfaithful, patient_insight_message("proposal_invalid"));
        assert_eq!(
            outcome("response-provider-failed"),
            Ok(PatientInsightOutcome::Failed("provider_failed".into()))
        );
        assert_eq!(
            outcome("response-kill-switch"),
            Ok(PatientInsightOutcome::Unavailable(
                "kill_switch_disabled".into()
            ))
        );
        assert_eq!(
            outcome("response-function-disabled"),
            Ok(PatientInsightOutcome::Unavailable(
                "function_disabled".into()
            ))
        );
        assert_eq!(
            outcome("response-stale"),
            Ok(PatientInsightOutcome::Failed("source_stale".into()))
        );
    }

    /// Primo tentativo scartato, secondo valido: la provenienza registra 2 chiamate.
    #[test]
    fn a_discarded_first_attempt_is_recorded_in_the_provenance() {
        let Ok(PatientInsightOutcome::Proposal(proposal)) =
            outcome("response-available-second-attempt")
        else {
            panic!("the second attempt is a proposal");
        };
        assert_eq!(proposal.attempts, Some(2));
        // Il numero sta nella provenienza, non fra le righe mostrate.
        assert!(
            proposal
                .lines()
                .iter()
                .all(|(_, line)| !line.contains("tentativ"))
        );
    }

    /// La risposta registrata prima di questo campo (host precedente) si legge ancora,
    /// senza un numero inventato; un numero fuori contratto invece no.
    #[test]
    fn a_receipt_without_attempts_from_an_older_host_is_still_read() {
        let before = fixture("response-available-before-attempts");
        assert!(
            before["body"]["preview"]["provenance"]
                .get("attempts")
                .is_none()
        );
        let Ok(PatientInsightOutcome::Proposal(proposal)) =
            outcome("response-available-before-attempts")
        else {
            panic!("the older receipt is still a proposal");
        };
        assert_eq!(proposal.attempts, None);
        let Ok(PatientInsightOutcome::Proposal(current)) = outcome("response-available") else {
            panic!("the current receipt is a proposal");
        };
        assert_eq!(proposal.lines(), current.lines());
        let request = request();
        for attempts in [json!(0), json!(3), json!("2"), Value::Null, json!(1.5)] {
            let mut body = before["body"].clone();
            body["preview"]["provenance"]["attempts"] = attempts.clone();
            assert_eq!(
                patient_insight_outcome(&request, 200, body.to_string().as_bytes()),
                Err(RuntimeError::InvalidResponse),
                "attempts {attempts}"
            );
        }
        // Anche uno scarto di un host precedente resta un esito leggibile.
        let mut failed = fixture("response-proposal-unfaithful")["body"].clone();
        failed["preview"]["provenance"]
            .as_object_mut()
            .unwrap()
            .remove("attempts");
        assert_eq!(
            patient_insight_outcome(&request, 200, failed.to_string().as_bytes()),
            Ok(PatientInsightOutcome::Failed("proposal_unfaithful".into()))
        );
    }

    /// Controprova: un corpo alterato non è mai una proposta.
    #[test]
    fn altered_responses_are_refused() {
        let base = fixture("response-available")["body"].clone();
        let request = request();
        let check = |change: &dyn Fn(&mut Value)| {
            let mut body = base.clone();
            change(&mut body);
            patient_insight_outcome(&request, 200, body.to_string().as_bytes())
        };
        assert!(check(&|_| {}).is_ok());
        for change in [
            &(|b: &mut Value| b["preview"]["writesPerformed"] = json!(1)) as &dyn Fn(&mut Value),
            &|b| b["preview"]["apply"] = json!("allowed"),
            &|b| b["preview"]["extra"] = json!(true),
            &|b| b["preview"]["proposal"]["reviewOnly"] = json!(false),
            &|b| b["preview"]["receipt"]["egress"] = json!("internet"),
            &|b| b["preview"]["provenance"]["model"] = json!("altro-modello"),
            &|b| b["preview"]["reviewRef"] = json!("review_x"),
            &|b| b["preview"]["proposal"]["alerts"] = json!(["a", "b", "c"]),
            &|b| b["preview"]["proposal"]["currentness"]["patientRevision"] = json!(99),
            &|b| {
                b["preview"]["proposal"]["currentness"]["capturedAt"] =
                    json!("2020-01-01T00:00:00.000Z")
            },
            &|b| b["preview"]["proposal"]["summary"] = json!("Fonte inesistente. [S99]"),
        ] {
            assert_eq!(check(change), Err(RuntimeError::InvalidResponse));
        }
    }

    /// Un errore senza proposta lo dice col solo motivo: la proposta mancante si vede.
    #[test]
    fn refusal_messages_state_only_the_reason() {
        assert_eq!(
            patient_insight_message("provider_failed"),
            "Il modello locale non ha completato la risposta."
        );
        assert_eq!(
            patient_insight_message("codice-sconosciuto"),
            "L'home-base ha rifiutato la richiesta."
        );
        assert_eq!(
            patient_insight_message("proposal_invalid"),
            "La risposta del modello non ha superato i controlli dell'home-base."
        );
        assert_eq!(
            patient_insight_message("proposal_unfaithful"),
            "Il modello ha dato per presa una decisione ancora aperta nella scheda, o per urgente qualcosa che la scheda non segnala come urgente."
        );
        assert_eq!(
            patient_insight_message("response_invalid"),
            "La risposta dell'home-base non ha superato i controlli dell'app."
        );
        // Nessun messaggio d'esito ripete la proposta mancante o nomina GPUI.
        for code in [
            "kill_switch_disabled",
            "function_disabled",
            "kill_switch_unavailable",
            "lifecycle_missing",
            "lifecycle_corrupt",
            "lifecycle_unavailable",
            "provider_binding_denied",
            "provider_unready",
            "model_unavailable",
            "provider_unavailable",
            "fabric_denied",
            "source_stale",
            "provider_failed",
            "proposal_invalid",
            "proposal_unfaithful",
            "binding_stale",
            "catalog_stale",
            "session_stale",
            "session_unavailable",
            "response_invalid",
            "codice-sconosciuto",
        ] {
            let message = patient_insight_message(code);
            assert!(!message.contains("Nessuna proposta"), "{code}: {message}");
            assert!(!message.contains("GPUI"), "{code}: {message}");
        }
    }
}
