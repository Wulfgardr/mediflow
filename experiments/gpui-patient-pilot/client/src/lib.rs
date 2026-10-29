//! Client state for the patient-notes pilot (WUL-706/WUL-714).
//!
//! This crate owns selection, drafts, review and response correlation only.
//! It has no IO, database, credentials, encryption, audit or commit authority.
//! Its inputs are already admitted display projections. A future production
//! adapter must supply the accepted WUL-580 contract and current authorization.
#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Same integer ceiling as the existing JavaScript version/CAS contract.
pub const MAX_VERSION: u64 = 9_007_199_254_740_991;
/// A bound for this synthetic client, not a change to the HTTP API contract.
pub const MAX_NOTES_UTF16: usize = 262_144;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PersonName(String);
impl PersonName {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl From<String> for PersonName {
    fn from(value: String) -> Self {
        Self(value)
    }
}
impl From<&str> for PersonName {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}
impl std::fmt::Display for PersonName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ClinicalCode(String);
impl std::ops::Deref for ClinicalCode {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}
impl ClinicalCode {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl From<String> for ClinicalCode {
    fn from(value: String) -> Self {
        Self(value)
    }
}
impl From<&str> for ClinicalCode {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}
impl std::fmt::Display for ClinicalCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

pub fn format_patient_name(first_name: &str, last_name: &str) -> String {
    [last_name.trim(), first_name.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatientProfile {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub birth_date: Option<String>,
    pub tax_code: ClinicalCode,
    pub notes: Option<String>,
    pub version: u64,
    pub is_archived: bool,
}

impl PatientProfile {
    pub fn display_name(&self) -> PersonName {
        format_patient_name(&self.first_name, &self.last_name).into()
    }

    pub fn matches_query(&self, query: &str) -> bool {
        let query = query.trim().to_lowercase();
        query.is_empty()
            || self.display_name().as_str().to_lowercase().contains(&query)
            || self.tax_code.to_lowercase().contains(&query)
    }

    fn valid(&self) -> bool {
        valid_id(&self.id)
            && (1..=MAX_VERSION).contains(&self.version)
            && valid_text(&self.first_name, 512)
            && valid_text(&self.last_name, 512)
            && valid_text(&self.tax_code, 128)
            && self.birth_date.as_ref().is_none_or(|v| valid_text(v, 64))
            && self
                .notes
                .as_ref()
                .is_none_or(|v| valid_text(v, MAX_NOTES_UTF16))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub enum Phase {
    #[default]
    Empty,
    Loading,
    Ready,
    Editing,
    Review,
    Submitting,
    Verifying,
    Recovering,
    Saved,
    Conflict,
    Indeterminate,
    Unavailable,
    Locked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClientError {
    WrongPhase,
    UnsavedChanges,
    InvalidInput,
    NoChanges,
    VersionExhausted,
    RequestExhausted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadFailure {
    NotFound,
    Unavailable,
    Invalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateOutcome {
    Acknowledged,
    Conflict,
    Rejected,
    /// Dispatch may have committed. Never retry automatically or infer rollback.
    Indeterminate,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadRequest {
    pub patient_id: String,
    sequence: u64,
    owner: WorkspaceIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateNotes {
    pub patient_id: String,
    pub expected_version: u64,
    pub notes: String,
    sequence: u64,
    owner: WorkspaceIdentity,
}

// A retained request keeps its originating allocation alive. Pointer identity
// therefore cannot be reused while a late reply can still refer to it; no
// process-global counter, random token or serialization is needed for this
// in-process client correlation. This identity is not authentication.
#[derive(Clone, Debug, Default)]
struct WorkspaceIdentity(Arc<()>);

impl PartialEq for WorkspaceIdentity {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for WorkspaceIdentity {}

/// The existing PUT body for the notes-only subset; the patient ID is in the
/// route. This is not a new RPC envelope or a grant to perform the operation.
#[derive(Debug, Serialize)]
pub struct NotesBody<'a> {
    pub version: u64,
    pub notes: &'a str,
}

impl UpdateNotes {
    pub fn http_body(&self) -> NotesBody<'_> {
        NotesBody {
            version: self.expected_version,
            notes: &self.notes,
        }
    }
}

#[derive(Default)]
pub struct Workspace {
    owner: WorkspaceIdentity,
    selected_id: Option<String>,
    profile: Option<PatientProfile>,
    draft: String,
    phase: Phase,
    sequence: u64,
    pending_read: Option<ReadRequest>,
    pending_update: Option<UpdateNotes>,
    verifying: Option<UpdateNotes>,
    recovery: Option<Phase>,
    comparison: bool,
}

impl Workspace {
    pub fn selected(&self) -> Option<&PatientProfile> {
        self.profile.as_ref()
    }
    pub fn selected_id(&self) -> Option<&str> {
        self.selected_id.as_deref()
    }
    pub fn draft_notes(&self) -> &str {
        &self.draft
    }
    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn has_notes_comparison(&self) -> bool {
        self.comparison
    }

    pub fn is_dirty(&self) -> bool {
        self.profile
            .as_ref()
            .is_some_and(|p| self.draft != p.notes.as_deref().unwrap_or(""))
    }

    pub fn can_switch(&self) -> bool {
        !self.is_dirty()
            && matches!(
                self.phase,
                Phase::Empty
                    | Phase::Loading
                    | Phase::Ready
                    | Phase::Saved
                    | Phase::Unavailable
                    | Phase::Locked
            )
    }

    pub fn select(&mut self, patient_id: &str) -> Result<ReadRequest, ClientError> {
        if !self.can_switch() {
            return Err(ClientError::UnsavedChanges);
        }
        if !valid_id(patient_id) {
            return Err(ClientError::InvalidInput);
        }
        self.begin_read(patient_id.to_owned())
    }

    fn next_sequence(&mut self) -> Result<u64, ClientError> {
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or(ClientError::RequestExhausted)?;
        Ok(self.sequence)
    }

    fn begin_read(&mut self, patient_id: String) -> Result<ReadRequest, ClientError> {
        let request = ReadRequest {
            patient_id: patient_id.clone(),
            sequence: self.next_sequence()?,
            owner: self.owner.clone(),
        };
        self.clear_content();
        self.selected_id = Some(patient_id);
        self.pending_read = Some(request.clone());
        self.phase = Phase::Loading;
        Ok(request)
    }

    /// Returns false for a superseded request or an invalid/mismatched result.
    /// A failed current read still leaves a visible unavailable/uncertain state.
    pub fn receive_read(
        &mut self,
        request: &ReadRequest,
        result: Result<PatientProfile, ReadFailure>,
    ) -> bool {
        if self.pending_read.as_ref() != Some(request)
            || self.selected_id.as_deref() != Some(&request.patient_id)
            || !matches!(
                self.phase,
                Phase::Loading | Phase::Verifying | Phase::Recovering
            )
        {
            return false;
        }
        self.pending_read = None;
        let recovery = self.recovery.take();
        let verification = self.verifying.take();
        let profile = match result {
            Ok(profile) if profile.id == request.patient_id && profile.valid() => profile,
            _ => {
                self.phase = recovery.unwrap_or(if verification.is_some() {
                    Phase::Indeterminate
                } else {
                    Phase::Unavailable
                });
                self.verifying = verification;
                return false;
            }
        };
        if recovery.is_some() {
            let confirmed = verification.as_ref().is_some_and(|command| {
                profile.version > command.expected_version
                    && profile.notes.as_deref() == Some(command.notes.as_str())
            });
            self.profile = Some(profile);
            self.comparison = !confirmed;
            self.phase = if confirmed {
                Phase::Saved
            } else if self.is_dirty() {
                Phase::Editing
            } else {
                Phase::Ready
            };
            return true;
        }
        if let Some(command) = verification {
            // A transport acknowledgement is insufficient. The fresh projection
            // must be exactly the expected revision and content. A later write,
            // old read, or different value requires explicit reconciliation.
            if profile.version != command.expected_version + 1
                || profile.notes.as_deref() != Some(command.notes.as_str())
            {
                self.phase = Phase::Conflict;
                return false;
            }
            self.phase = Phase::Saved;
            self.comparison = false;
        } else {
            self.phase = Phase::Ready;
        }
        self.draft = profile.notes.clone().unwrap_or_default();
        self.profile = Some(profile);
        true
    }

    pub fn edit_notes(&mut self, notes: String) -> Result<(), ClientError> {
        if !matches!(self.phase, Phase::Ready | Phase::Saved | Phase::Editing) {
            return Err(ClientError::WrongPhase);
        }
        if !valid_text(&notes, MAX_NOTES_UTF16) {
            return Err(ClientError::InvalidInput);
        }
        self.draft = notes;
        self.phase = if self.is_dirty() {
            Phase::Editing
        } else {
            Phase::Ready
        };
        Ok(())
    }

    pub fn review(&mut self) -> Result<(), ClientError> {
        if !matches!(self.phase, Phase::Editing | Phase::Ready | Phase::Saved) {
            return Err(ClientError::WrongPhase);
        }
        if !self.is_dirty() {
            return Err(ClientError::NoChanges);
        }
        if self
            .profile
            .as_ref()
            .is_none_or(|p| p.version >= MAX_VERSION)
        {
            return Err(ClientError::VersionExhausted);
        }
        self.phase = Phase::Review;
        Ok(())
    }

    pub fn cancel_review(&mut self) -> Result<(), ClientError> {
        if self.phase != Phase::Review {
            return Err(ClientError::WrongPhase);
        }
        self.phase = Phase::Editing;
        Ok(())
    }

    pub fn confirm(&mut self) -> Result<UpdateNotes, ClientError> {
        if self.phase != Phase::Review {
            return Err(ClientError::WrongPhase);
        }
        let sequence = self.next_sequence()?;
        let profile = self.profile.as_ref().ok_or(ClientError::WrongPhase)?;
        let command = UpdateNotes {
            patient_id: profile.id.clone(),
            expected_version: profile.version,
            notes: self.draft.clone(),
            sequence,
            owner: self.owner.clone(),
        };
        self.pending_update = Some(command.clone());
        self.phase = Phase::Submitting;
        Ok(command)
    }

    /// Acknowledgement schedules a read. Only receive_read can mark the draft
    /// saved. A duplicate, modified or old-session response has no effect.
    pub fn receive_update(
        &mut self,
        command: &UpdateNotes,
        outcome: UpdateOutcome,
    ) -> Option<ReadRequest> {
        if self.phase != Phase::Submitting || self.pending_update.as_ref() != Some(command) {
            return None;
        }
        self.pending_update = None;
        self.phase = match outcome {
            UpdateOutcome::Conflict => Phase::Conflict,
            UpdateOutcome::Rejected => Phase::Editing,
            UpdateOutcome::Indeterminate => {
                self.verifying = Some(command.clone());
                Phase::Indeterminate
            }
            UpdateOutcome::Acknowledged => {
                let Ok(sequence) = self.next_sequence() else {
                    self.phase = Phase::Indeterminate;
                    return None;
                };
                let request = ReadRequest {
                    patient_id: command.patient_id.clone(),
                    sequence,
                    owner: self.owner.clone(),
                };
                self.verifying = Some(command.clone());
                self.pending_read = Some(request.clone());
                self.phase = Phase::Verifying;
                return Some(request);
            }
        };
        None
    }

    /// Read the current notes without changing the draft or dispatching a write.
    /// Only a matching fresh read can resolve an indeterminate submission.
    pub fn reread_preserving_draft(&mut self) -> Result<ReadRequest, ClientError> {
        if !matches!(
            self.phase,
            Phase::Conflict | Phase::Indeterminate | Phase::Editing
        ) {
            return Err(ClientError::WrongPhase);
        }
        let request = ReadRequest {
            patient_id: self.selected_id.clone().ok_or(ClientError::WrongPhase)?,
            sequence: self.next_sequence()?,
            owner: self.owner.clone(),
        };
        self.recovery = Some(self.phase);
        self.pending_read = Some(request.clone());
        self.phase = Phase::Recovering;
        Ok(request)
    }

    /// Explicitly discard the draft and request the latest state. This does not
    /// retry a mutation or decide whether a previously uncertain write committed.
    pub fn discard_and_reload(&mut self) -> Option<ReadRequest> {
        if matches!(
            self.phase,
            Phase::Submitting | Phase::Verifying | Phase::Recovering | Phase::Locked
        ) {
            return None;
        }
        let id = self.selected_id.clone()?;
        self.begin_read(id).ok()
    }

    pub fn lock(&mut self) {
        self.clear_content();
        self.selected_id = None;
        self.phase = Phase::Locked;
    }

    fn clear_content(&mut self) {
        self.profile = None;
        self.draft.clear();
        self.pending_read = None;
        self.pending_update = None;
        self.verifying = None;
        self.recovery = None;
        self.comparison = false;
        // Logical invalidation only; this pilot does not claim RAM zeroization.
    }
}

fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && valid_text(value, 128)
}

fn valid_text(value: &str, max_utf16: usize) -> bool {
    !value.contains('\0') && value.encode_utf16().take(max_utf16 + 1).count() <= max_utf16
}
