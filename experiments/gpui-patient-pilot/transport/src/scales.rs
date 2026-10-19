//! Serializable host descriptors and prepared results. No clinical scoring or
//! interpretation is implemented here; the existing host owns both.

use crate::{Entry, MAX_SAFE_VERSION, ProfileQueryIntent, Result, RuntimeError};
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use std::collections::{BTreeMap, HashSet};

pub(crate) const SCALE_PREPARATION_VERSION: &str = "mediflow.scales.prepare.v1";
pub(crate) const SCALE_CATALOG_LIMIT: usize = 256 * 1024;
pub(crate) const SCALE_PREPARATION_LIMIT: usize = 128 * 1024;
pub(crate) const SCALE_REQUEST_LIMIT: usize = 64 * 1024;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
pub enum ScaleId {
    #[serde(rename = "adl")]
    Adl,
    #[serde(rename = "gds")]
    Gds,
    #[serde(rename = "iadl")]
    Iadl,
    #[serde(rename = "mmse")]
    Mmse,
    #[serde(rename = "tinetti-poma28-v1")]
    TinettiPoma28,
}
impl ScaleId {
    pub const ALL: [Self; 5] = [
        Self::Adl,
        Self::Gds,
        Self::Iadl,
        Self::Mmse,
        Self::TinettiPoma28,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Adl => "adl",
            Self::Gds => "gds",
            Self::Iadl => "iadl",
            Self::Mmse => "mmse",
            Self::TinettiPoma28 => "tinetti-poma28-v1",
        }
    }
}

pub type ScaleAnswers = BTreeMap<String, Number>;

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ScaleChoice {
    pub label: String,
    pub value: Number,
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum ScaleQuestionType {
    #[serde(rename = "choice")]
    Choice,
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ScaleQuestion {
    pub id: String,
    pub text: String,
    #[serde(rename = "type")]
    pub question_type: ScaleQuestionType,
    pub options: Vec<ScaleChoice>,
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScaleInstrument {
    pub instrument_id: String,
    pub instrument_version: String,
    pub definition_version: String,
    pub source_id: String,
    pub source_url: String,
    pub source_document_version: String,
    pub language: String,
    pub translation_status: String,
    pub risk_classification: String,
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScaleUseContract {
    pub evidence_checked_on: String,
    pub evidence_reference: String,
    pub language: String,
    pub missing_answers: String,
    pub clinical_reviewer: Option<String>,
    pub rights_reviewer: Option<String>,
    pub permission_reference: Option<String>,
    pub permission_attestation: String,
    pub new_use_decision: String,
    pub definition_version: String,
    pub source_id: String,
    pub source_binding: String,
    pub population: String,
    pub scoring: String,
    pub interpretation: String,
    pub interpretation_version: String,
    pub translation: String,
    pub rights: String,
    pub review_gap: String,
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScaleDescriptor {
    pub id: ScaleId,
    pub title: String,
    pub description: String,
    pub questions: Vec<ScaleQuestion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrument: Option<ScaleInstrument>,
    pub use_contract: ScaleUseContract,
}
impl ScaleDescriptor {
    /// Presence and exact catalog choices only. Never computes or imputes a score.
    pub fn accepts_answers(&self, answers: &ScaleAnswers) -> bool {
        answers.len() == self.questions.len()
            && self.questions.iter().all(|question| {
                answers.get(&question.id).is_some_and(|answer| {
                    question
                        .options
                        .iter()
                        .any(|choice| choice.value == *answer)
                })
            })
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScaleCatalog {
    contract_version: u8,
    preparation_version: String,
    catalog_revision: String,
    pub scales: Vec<ScaleDescriptor>,
}
impl ScaleCatalog {
    pub fn descriptor(&self, id: ScaleId) -> Option<&ScaleDescriptor> {
        self.scales.iter().find(|scale| scale.id == id)
    }
    pub fn catalog_revision(&self) -> &str {
        &self.catalog_revision
    }
    pub fn preparation_version(&self) -> &str {
        &self.preparation_version
    }
}

/// Request values known by the window. The host selection epoch is deliberately
/// absent: RuntimeSession obtains it from its real consumed profile-query.
#[derive(Clone)]
pub struct ScalePreparationRequest {
    pub(crate) catalog: ScaleCatalog,
    pub(crate) scale_id: ScaleId,
    pub(crate) answers: ScaleAnswers,
    pub(crate) patient_version: u64,
}
impl ScalePreparationRequest {
    pub fn new(
        catalog: &ScaleCatalog,
        scale_id: ScaleId,
        answers: ScaleAnswers,
        patient_version: u64,
    ) -> Result<Self> {
        validate_catalog(catalog).map_err(|_| RuntimeError::InvalidInput)?;
        crate::validate_version(patient_version)?;
        if !catalog
            .descriptor(scale_id)
            .is_some_and(|scale| scale.accepts_answers(&answers))
        {
            return Err(RuntimeError::InvalidInput);
        }
        Ok(Self {
            catalog: catalog.clone(),
            scale_id,
            answers,
            patient_version,
        })
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScaleMetadata {
    pub title: String,
    pub scale_id: ScaleId,
    pub score: Number,
    pub interpretation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interpretation_version: Option<String>,
    pub answers: ScaleAnswers,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrument: Option<ScaleInstrument>,
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ScaleSubmission {
    pub title: String,
    pub content: String,
    pub metadata: ScaleMetadata,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScalePreparationContext {
    pub patient_id: String,
    pub ambulatory_id: String,
    pub patient_version: u64,
    pub selection_epoch: u64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ScalePreparationReply {
    contract_version: u8,
    preparation_version: String,
    catalog_revision: String,
    status: String,
    pub(crate) context: ScalePreparationContext,
    pub(crate) submission: ScaleSubmission,
}

/// A host calculation retained for human review. This is not a host write grant
/// or a cryptographic attestation about a client's later encrypted payload.
#[derive(Clone)]
pub struct PreparedScale {
    pub(crate) reply: ScalePreparationReply,
    pub(crate) intent: ProfileQueryIntent,
}
impl PreparedScale {
    pub fn context(&self) -> &ScalePreparationContext {
        &self.reply.context
    }
    pub fn submission(&self) -> &ScaleSubmission {
        &self.reply.submission
    }
}

/// Fixed identity and already sealed fields for the existing diary writer.
/// Retaining this value prevents a retry from inventing another ID or ciphertext.
#[derive(Clone)]
pub struct ScaleEntryAttempt {
    pub(crate) prepared: PreparedScale,
    pub(crate) body: Value,
    pub(crate) id: String,
    pub(crate) date: String,
    pub(crate) setting: Option<String>,
}
impl ScaleEntryAttempt {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn date(&self) -> &str {
        &self.date
    }
    pub fn setting(&self) -> Option<&str> {
        self.setting.as_deref()
    }
    pub fn submission(&self) -> &ScaleSubmission {
        self.prepared.submission()
    }
    pub(crate) fn matches(&self, row: &Entry) -> bool {
        row.id == self.id
            && row.patient_id == self.prepared.context().patient_id
            && row.entry_type == "scale"
            && row.version == 1
            && row.deleted_at.is_none()
            && row.title == self.submission().title
            && row.content == self.submission().content
            && row.date == self.date
            && row.setting == self.setting
            && row.locked_fields.is_empty()
            && row.attachments.is_none()
            && row.deletion_reason.is_none()
            && row
                .metadata
                .as_deref()
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                == serde_json::to_value(&self.submission().metadata).ok()
    }
}

pub enum ScaleEntryReadback {
    Verified(Entry),
    Different(Entry),
    /// The current scoped GET did not find the fixed ID. It is not proof that
    /// an interrupted request can never complete; any retry must retain this ID.
    NotFound,
}

pub(crate) fn parse_catalog(value: Value) -> Result<ScaleCatalog> {
    let catalog: ScaleCatalog =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

fn text_valid(text: &str) -> bool {
    !text.trim().is_empty()
        && text.len() <= 16 * 1024
        && !text
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
}
fn revision_valid(revision: &str) -> bool {
    revision.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}
fn validate_catalog(catalog: &ScaleCatalog) -> Result<()> {
    if catalog.contract_version != 1
        || catalog.preparation_version != SCALE_PREPARATION_VERSION
        || !revision_valid(&catalog.catalog_revision)
        || catalog.scales.len() != ScaleId::ALL.len()
        || catalog
            .scales
            .iter()
            .map(|scale| scale.id)
            .collect::<HashSet<_>>()
            .len()
            != ScaleId::ALL.len()
    {
        return Err(RuntimeError::InvalidResponse);
    }
    for scale in &catalog.scales {
        if !text_valid(&scale.title)
            || !text_valid(&scale.description)
            || scale.questions.is_empty()
            || scale.questions.len() > 64
            || scale
                .questions
                .iter()
                .map(|q| &q.id)
                .collect::<HashSet<_>>()
                .len()
                != scale.questions.len()
        {
            return Err(RuntimeError::InvalidResponse);
        }
        for question in &scale.questions {
            if question.id.trim() != question.id
                || question.id.len() > 160
                || crate::validate_id(&question.id).is_err()
                || !text_valid(&question.text)
                || question.options.is_empty()
                || question.options.len() > 16
                || question.options.iter().any(|option| {
                    !text_valid(&option.label) || !option.value.as_f64().is_some_and(f64::is_finite)
                })
                || question
                    .options
                    .iter()
                    .map(|option| option.value.to_string())
                    .collect::<HashSet<_>>()
                    .len()
                    != question.options.len()
            {
                return Err(RuntimeError::InvalidResponse);
            }
        }
        // These remain provenance/limits supplied by the host, never client admission rules.
        let provenance =
            serde_json::to_value(&scale.use_contract).map_err(|_| RuntimeError::InvalidResponse)?;
        if provenance.as_object().is_none_or(|fields| {
            fields
                .values()
                .any(|value| !value.is_null() && !value.as_str().is_some_and(text_valid))
        }) {
            return Err(RuntimeError::InvalidResponse);
        }
    }
    Ok(())
}

pub(crate) fn parse_preparation(
    value: Value,
    request: &ScalePreparationRequest,
    expected: &ScalePreparationContext,
    intent: ProfileQueryIntent,
) -> Result<PreparedScale> {
    let reply: ScalePreparationReply =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    let descriptor = request
        .catalog
        .descriptor(request.scale_id)
        .ok_or(RuntimeError::InvalidResponse)?;
    let metadata = &reply.submission.metadata;
    if reply.contract_version != 1
        || reply.preparation_version != SCALE_PREPARATION_VERSION
        || reply.catalog_revision != request.catalog.catalog_revision
        || reply.status != "draft"
        || reply.context != *expected
        || reply.context.patient_version == 0
        || reply.context.patient_version > MAX_SAFE_VERSION
        || reply.context.selection_epoch > MAX_SAFE_VERSION
        || reply.submission.title != descriptor.title
        || metadata.title != descriptor.title
        || metadata.scale_id != request.scale_id
        || metadata.answers != request.answers
        || metadata.instrument != descriptor.instrument
        || metadata.interpretation_version.as_deref()
            != Some(descriptor.use_contract.interpretation_version.as_str())
        || !metadata.score.as_f64().is_some_and(f64::is_finite)
        || !text_valid(&metadata.interpretation)
        || !text_valid(&reply.submission.content)
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(PreparedScale { reply, intent })
}

#[cfg(test)]
pub(crate) fn synthetic_catalog() -> Value {
    use serde_json::json;
    // Contract fixtures deliberately have no clinical scoring or cut-offs. The
    // actual five host definitions are exercised by the built UI qualification.
    json!({"contractVersion":1, "preparationVersion":SCALE_PREPARATION_VERSION,
        "catalogRevision":format!("sha256:{}", "a".repeat(64)),
        "scales":ScaleId::ALL.iter().map(|id| json!({"id":id, "title":format!("Strumento sintetico {}", id.as_str()),
            "description":"Descrizione sintetica restituita dall'host.",
            "questions":[{"id":"synthetic-choice", "text":"Domanda sintetica", "type":"choice",
                "options":[{"label":"Prima risposta", "value":0}, {"label":"Seconda risposta", "value":1}]}],
            "useContract":{
                "evidenceCheckedOn":"2026-10-19", "evidenceReference":"synthetic-reference", "language":"it-IT",
                "missingAnswers":"reject-incomplete-no-imputation", "clinicalReviewer":null, "rightsReviewer":null,
                "permissionReference":null, "permissionAttestation":"synthetic-attestation", "newUseDecision":"hold-proposed-not-enforced",
                "definitionVersion":"synthetic-definition-v1", "sourceId":"synthetic-source", "sourceBinding":"synthetic-binding",
                "population":"synthetic-population", "scoring":"synthetic-host-only", "interpretation":"synthetic-host-only",
                "interpretationVersion":"synthetic-interpretation-v1", "translation":"synthetic-translation",
                "rights":"synthetic-rights", "reviewGap":"synthetic-gap"}})).collect::<Vec<_>>()})
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scale_catalog_and_answer_admission_follow_the_closed_host_descriptor() {
        let catalog = parse_catalog(synthetic_catalog()).unwrap();
        assert_eq!(catalog.scales.len(), 5);
        let answers = serde_json::from_value(json!({"synthetic-choice":1})).unwrap();
        assert!(ScalePreparationRequest::new(&catalog, ScaleId::Adl, answers, 7).is_ok());
        for answers in [
            json!({}),
            json!({"synthetic-choice":2}),
            json!({"synthetic-choice":"1"}),
            json!({"synthetic-choice":1,"extra":0}),
        ] {
            let accepted = serde_json::from_value(answers).ok().is_some_and(|answers| {
                ScalePreparationRequest::new(&catalog, ScaleId::Adl, answers, 7).is_ok()
            });
            assert!(!accepted);
        }
        // These host limitations are displayed as provenance, never converted
        // into a new client permission or an invented clinical admission rule.
        assert_eq!(
            catalog.scales[0].use_contract.new_use_decision,
            "hold-proposed-not-enforced"
        );
    }

    #[test]
    fn scale_catalog_rejects_unknown_versions_types_retired_ids_and_duplicate_questions() {
        for (pointer, value) in [
            ("/contractVersion", json!(2)),
            ("/preparationVersion", json!("other")),
            ("/catalogRevision", json!("sha256:invalid")),
            ("/scales/0/id", json!("tinetti")),
            ("/scales/0/questions/0/type", json!("number")),
            ("/scales/0/questions/0/options/0/value", json!("0")),
            ("/scales/0/questions/0/options", json!([])),
        ] {
            let mut value_wire = synthetic_catalog();
            *value_wire.pointer_mut(pointer).unwrap() = value;
            assert!(matches!(
                parse_catalog(value_wire),
                Err(RuntimeError::InvalidResponse)
            ));
        }
        let mut unknown = synthetic_catalog();
        unknown["scales"][0]["scoringLogic"] = json!("not-a-consumer-field");
        assert!(parse_catalog(unknown).is_err());
        let mut duplicate = synthetic_catalog();
        let question = duplicate["scales"][0]["questions"][0].clone();
        duplicate["scales"][0]["questions"]
            .as_array_mut()
            .unwrap()
            .push(question);
        assert!(parse_catalog(duplicate).is_err());
        let mut missing = synthetic_catalog();
        missing["scales"].as_array_mut().unwrap().pop();
        assert!(parse_catalog(missing).is_err());
    }
}
