//! Display DTOs from the existing paired HTTP contract. These are not authority.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Filters use explicit RFC3339 instants; omitted dates preserve the server's
/// unbounded date range. Limits are validated rather than silently truncated.
#[derive(Clone, Default)]
pub struct AgendaFilter {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub limit: Option<u16>,
    pub statuses: Vec<CheckupStatus>,
}

#[derive(Clone, Default)]
pub struct GlobalEntryFilter {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub limit: Option<u16>,
    /// The diary accepts opaque non-empty entry types, not a closed client enum.
    pub entry_type: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CheckupStatus {
    Pending,
    Completed,
    Cancelled,
}

fn nullable_bool<'de, D: Deserializer<'de>>(de: D) -> Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(de)?.unwrap_or(false))
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeUser {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub role: String,
    pub archive_generation: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ambulatory {
    pub id: String,
    pub name: String,
    pub address: Option<String>,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub description: Option<String>,
    #[serde(default, deserialize_with = "nullable_bool")]
    pub is_default: bool,
    pub version: u64,
    pub created_at: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatientSummary {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub birth_date: Option<String>,
    pub tax_code: String,
    #[serde(default, deserialize_with = "nullable_bool")]
    pub is_adi: bool,
    #[serde(default, deserialize_with = "nullable_bool")]
    pub is_archived: bool,
    pub version: u64,
    pub updated_at: Option<String>,
    pub deleted_at: Option<String>,
}

impl PatientSummary {
    pub fn display_name(&self) -> String {
        format!("{} {}", self.first_name, self.last_name)
    }
    pub fn matches_query(&self, query: &str) -> bool {
        let query = query.trim().to_lowercase();
        self.display_name().to_lowercase().contains(&query)
            || self.tax_code.to_lowercase().contains(&query)
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatientDetail {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub birth_date: Option<String>,
    pub tax_code: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub caregiver: Option<String>,
    pub exemptions: Option<String>,
    pub diagnoses: Option<String>,
    pub monitoring_profile: Option<String>,
    pub status_reason: Option<String>,
    pub archive_reason: Option<String>,
    pub archive_note: Option<String>,
    pub notes: Option<String>,
    #[serde(default, deserialize_with = "nullable_bool")]
    pub is_adi: bool,
    #[serde(default, deserialize_with = "nullable_bool")]
    pub is_archived: bool,
    pub version: u64,
    pub ambulatory_id: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub deleted_at: Option<String>,
    /// A failed authenticated decryption is unavailable, never an empty editable field.
    #[serde(skip)]
    pub locked_fields: Vec<String>,
}

/// Display projection of the host's status-only AI response. Enabled settings
/// are not model health checks or permission to execute a clinical operation.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimeStatus {
    pub local_runtime: AiLocalRuntimeStatus,
    pub central_runtime: AiCentralRuntimeStatus,
    pub kill_switches: AiFunctionSwitches,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLocalRuntimeStatus {
    pub state: AiLocalState,
    pub clinical_model: Option<String>,
    pub reasoning_model: Option<String>,
    pub ocr_model: Option<String>,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AiLocalState {
    Configured,
    Misconfigured,
}

#[derive(Clone, Deserialize)]
pub struct AiCentralRuntimeStatus {
    pub state: AiCentralState,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AiCentralState {
    Disabled,
    Available,
    Unavailable,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiFunctionSwitches {
    pub patient_insight: AiFunctionSwitch,
    pub document_synthesis: AiFunctionSwitch,
    pub smart_import: AiFunctionSwitch,
    pub treatment_reasoning: AiFunctionSwitch,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AiFunctionSwitch {
    Enabled,
    Disabled,
}

impl PatientDetail {
    pub fn display_name(&self) -> String {
        format!("{} {}", self.first_name, self.last_name)
    }
    pub fn field_locked(&self, name: &str) -> bool {
        self.locked_fields.iter().any(|field| field == name)
    }
}

/// Ordinary registration fields only. The server chooses identity, version,
/// timestamps and ambulatory membership; this draft cannot archive a patient.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatientCreateDraft {
    pub first_name: String,
    pub last_name: String,
    pub tax_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub birth_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caregiver: Option<String>,
    #[serde(default)]
    pub is_adi: bool,
}

/// Three distinct intentions for a nullable field. In a profile patch,
/// Unchanged is omitted, Clear emits null and Set emits the exact string.
/// No Debug implementation: these values may contain clinical information.
#[derive(Clone, Default, PartialEq, Eq)]
pub enum NullableStringPatch {
    #[default]
    Unchanged,
    Clear,
    Set(String),
}

impl NullableStringPatch {
    pub fn is_unchanged(&self) -> bool {
        matches!(self, Self::Unchanged)
    }
}

impl Serialize for NullableStringPatch {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Unchanged | Self::Clear => serializer.serialize_none(),
            Self::Set(value) => serializer.serialize_str(value),
        }
    }
}

impl<'de> Deserialize<'de> for NullableStringPatch {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Option::<String>::deserialize(deserializer)? {
            Some(value) => Self::Set(value),
            None => Self::Clear,
        })
    }
}

/// A sparse update of ordinary registration fields. Missing fields stay
/// untouched, including notes, diagnoses, encrypted fields and archive state.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatientProfilePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tax_code: Option<String>,
    #[serde(default, skip_serializing_if = "NullableStringPatch::is_unchanged")]
    pub birth_date: NullableStringPatch,
    #[serde(default, skip_serializing_if = "NullableStringPatch::is_unchanged")]
    pub address: NullableStringPatch,
    #[serde(default, skip_serializing_if = "NullableStringPatch::is_unchanged")]
    pub phone: NullableStringPatch,
    #[serde(default, skip_serializing_if = "NullableStringPatch::is_unchanged")]
    pub caregiver: NullableStringPatch,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_adi: Option<bool>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub patient_id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub title: String,
    pub date: String,
    pub content: String,
    pub setting: Option<String>,
    pub metadata: Option<String>,
    pub attachments: Option<String>,
    pub version: u64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub deleted_at: Option<String>,
    pub deletion_reason: Option<String>,
    #[serde(skip)]
    pub locked_fields: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Therapy {
    pub id: String,
    pub patient_id: String,
    pub drug_name: String,
    pub aic: Option<String>,
    pub atc: Option<String>,
    pub active_principle: Option<String>,
    pub dosage: String,
    pub motivation: Option<String>,
    pub diagnosis_code: Option<String>,
    pub diagnosis_name: Option<String>,
    pub status: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub version: u64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub deleted_at: Option<String>,
    pub deletion_reason: Option<String>,
    #[serde(skip)]
    pub locked_fields: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub id: String,
    pub patient_id: String,
    pub code_system: String,
    pub code: String,
    pub display: String,
    pub unit_system: String,
    pub unit_code: String,
    pub value: String,
    pub notes: Option<String>,
    pub ref_low: Option<String>,
    pub ref_high: Option<String>,
    pub ref_text: Option<String>,
    pub observed_at: String,
    pub source: Option<String>,
    pub version: u64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub deleted_at: Option<String>,
    pub deletion_reason: Option<String>,
    #[serde(skip)]
    pub locked_fields: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkup {
    pub id: String,
    pub patient_id: String,
    pub date: String,
    pub title: String,
    pub notes: Option<String>,
    pub status: String,
    pub source: Option<String>,
    pub version: u64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub deleted_at: Option<String>,
    pub deletion_reason: Option<String>,
    #[serde(skip)]
    pub locked_fields: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub patient_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub mime_type: String,
    pub size: u64,
    pub path: String,
    pub summary_snapshot: Option<String>,
    pub parse_evidence_artifact_snapshot: Option<String>,
    pub ocr_queue_state: Option<String>,
    pub ocr_queue_reason: Option<String>,
    pub ocr_queue_updated_at: Option<String>,
    pub created_at: Option<String>,
    /// Present only for an explicit detail read. Never persisted by this crate.
    pub data: Option<String>,
    #[serde(skip)]
    pub locked_fields: Vec<String>,
}

#[derive(Clone, Deserialize)]
pub struct CreatedResource {
    pub id: String,
    pub version: Option<u64>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDraft {
    #[serde(rename = "type")]
    pub entry_type: String,
    pub title: String,
    pub content: String,
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TherapyDraft {
    pub drug_name: String,
    pub dosage: String,
    pub status: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub motivation: Option<String>,
    pub aic: Option<String>,
    pub atc: Option<String>,
    pub active_principle: Option<String>,
    pub diagnosis_code: Option<String>,
    pub diagnosis_name: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationDraft {
    pub code_system: String,
    pub code: String,
    pub display: String,
    pub unit_system: String,
    pub unit_code: String,
    pub value: String,
    pub notes: Option<String>,
    pub ref_low: Option<String>,
    pub ref_high: Option<String>,
    pub ref_text: Option<String>,
    pub observed_at: String,
    pub source: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckupDraft {
    pub date: String,
    pub title: String,
    pub notes: Option<String>,
    pub status: String,
    pub source: Option<String>,
}
