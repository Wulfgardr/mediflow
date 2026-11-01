mod archives;
mod chatgpt;
mod controls;
mod governance;
mod models;
mod network;
mod parameters;
mod references;
mod security;
mod work_profile;
use crate::RetirementNotice;
use crate::http::{authenticate_web_p3, control_cookie, operation_uuid, sensitive_header};
use crate::{
    Attachment, RequestContext, Result, RuntimeClient, RuntimeError, RuntimeSession, RuntimeUser,
    validate_id,
};
pub use archives::*;
pub use chatgpt::*;
pub use controls::*;
pub use governance::*;
pub use models::*;
pub use network::*;
pub use parameters::*;
pub use references::*;
use reqwest::{
    Method,
    header::{COOKIE, HeaderMap},
};
pub use security::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex, Weak,
    atomic::{AtomicBool, Ordering},
};
pub use work_profile::*;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostSettingKey {
    PatientInsight,
    DocumentSynthesis,
    SmartImport,
    TreatmentReasoning,
}
impl HostSettingKey {
    pub fn wire(self) -> &'static str {
        match self {
            Self::PatientInsight => "aiPatientInsightKillSwitch",
            Self::DocumentSynthesis => "aiDocumentSynthesisKillSwitch",
            Self::SmartImport => "aiSmartImportKillSwitch",
            Self::TreatmentReasoning => "aiTreatmentReasoningKillSwitch",
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            Self::PatientInsight => "Sintesi paziente",
            Self::DocumentSynthesis => "Sintesi documenti",
            Self::SmartImport => "Importazione intelligente",
            Self::TreatmentReasoning => "Ragionamento terapeutico",
        }
    }
}

#[derive(Clone, Deserialize, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DocumentCurrentness {
    source_ref: String,
    revision: u64,
    freshness_epoch: u64,
}
impl DocumentCurrentness {
    fn parse(value: Value) -> Result<Self> {
        let value: Self =
            serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
        if value.source_ref.len() != 64
            || !value
                .source_ref
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || !(1..=9_007_199_254_740_991).contains(&value.revision)
            || !(1..=9_007_199_254_740_991).contains(&value.freshness_epoch)
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(value)
    }
}

pub struct PreparedDocumentDeletion {
    owner: Weak<()>,
    document: Attachment,
    expected: DocumentCurrentness,
    submitted: AtomicBool,
}
impl PreparedDocumentDeletion {
    pub fn document(&self) -> &Attachment {
        &self.document
    }
}

pub struct PreparedHostSetting {
    owner: Weak<()>,
    key: HostSettingKey,
    before: Option<String>,
    enabled: bool,
    submitted: AtomicBool,
}

impl PreparedHostSetting {
    pub fn key(&self) -> HostSettingKey {
        self.key
    }
    pub fn enabled(&self) -> bool {
        self.enabled
    }
}

pub struct LocalHostAccess {
    client: RuntimeClient,
    native: RuntimeSession,
    cookie: Zeroizing<String>,
    control: Zeroizing<String>,
    generation: String,
    owner: Arc<()>,
    closed: AtomicBool,
    retired: AtomicBool,
    retirement_marker: Mutex<Option<String>>,
    notice: RetirementNotice,
}
impl LocalHostAccess {
    pub(crate) fn authenticate(
        client: RuntimeClient,
        native: RuntimeSession,
        user: &RuntimeUser,
        passphrase: &str,
        notice: RetirementNotice,
    ) -> Result<Self> {
        if !client.is_local_bootstrap_origin() {
            return Err(RuntimeError::Forbidden);
        }
        let checked = client.dedicated_web_raw(
            Method::GET,
            &["api", "auth", "check"],
            HeaderMap::new(),
            None,
            false,
        )?;
        let control = control_cookie(&checked.headers, "mediflow_auth_control", 32, 256)?;
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            sensitive_header(&format!("mediflow_auth_control={}", *control))?,
        );
        let (cookie, login, possibly_issued) =
            authenticate_web_p3(&client, user, headers, passphrase, true);
        let Some(cookie) = cookie else {
            if possibly_issued {
                notice.begin();
            }
            return Err(login.err().unwrap_or(RuntimeError::InvalidResponse));
        };
        let access = Self {
            client,
            native,
            cookie,
            control,
            generation: user.archive_generation.clone(),
            owner: Arc::new(()),
            closed: AtomicBool::new(false),
            retired: AtomicBool::new(false),
            retirement_marker: Mutex::new(None),
            notice,
        };
        if let Err(error) = login {
            return Err(if access.retire().is_err() {
                RuntimeError::Indeterminate
            } else {
                error
            });
        }
        Ok(access)
    }
    fn headers(&self) -> Result<HeaderMap> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::Locked);
        }
        self.client.context.check()?;
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            sensitive_header(&format!(
                "mediflow_session={}; mediflow_auth_control={}",
                *self.cookie, *self.control
            ))?,
        );
        headers.insert(
            "x-mediflow-archive-generation",
            sensitive_header(&self.generation)?,
        );
        Ok(headers)
    }
    fn request(
        &self,
        method: Method,
        path: &[&str],
        body: Option<&Value>,
        mutation: bool,
    ) -> Result<Value> {
        let response = self
            .client
            .dedicated_web_raw(method, path, self.headers()?, body, mutation)
            .map_err(|error| {
                if mutation && matches!(error, RuntimeError::Rejected(500..=599)) {
                    RuntimeError::Indeterminate
                } else {
                    error
                }
            })?;
        serde_json::from_slice(&response.body).map_err(|_| {
            if mutation {
                RuntimeError::Indeterminate
            } else {
                RuntimeError::InvalidResponse
            }
        })
    }
    fn setting_value(&self, key: HostSettingKey) -> Result<Option<String>> {
        let row = self.request(Method::GET, &["api", "settings", key.wire()], None, false)?;
        if row["key"] != key.wire() {
            return Err(RuntimeError::InvalidResponse);
        }
        match &row["value"] {
            Value::Null => Ok(None),
            Value::String(value) if value.len() <= 128 => Ok(Some(value.clone())),
            _ => Err(RuntimeError::InvalidResponse),
        }
    }
    pub fn read_switches(&self) -> Result<Vec<(HostSettingKey, bool)>> {
        [
            HostSettingKey::PatientInsight,
            HostSettingKey::DocumentSynthesis,
            HostSettingKey::SmartImport,
            HostSettingKey::TreatmentReasoning,
        ]
        .into_iter()
        .map(|key| {
            let enabled = matches!(
                self.setting_value(key)?.as_deref(),
                Some("enabled" | "true" | "1")
            );
            Ok((key, enabled))
        })
        .collect()
    }
    pub fn prepare_switch(
        &self,
        key: HostSettingKey,
        enabled: bool,
    ) -> Result<PreparedHostSetting> {
        if key == HostSettingKey::TreatmentReasoning {
            return Err(RuntimeError::Forbidden);
        }
        Ok(PreparedHostSetting {
            owner: Arc::downgrade(&self.owner),
            key,
            before: self.setting_value(key)?,
            enabled,
            submitted: AtomicBool::new(false),
        })
    }
    pub fn apply_switch(&self, command: &PreparedHostSetting) -> Result<bool> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        if self.setting_value(command.key)? != command.before {
            return Err(RuntimeError::Conflict);
        }
        let expected = if command.enabled {
            "enabled"
        } else {
            "disabled"
        };
        let written = self.request(
            Method::PUT,
            &["api", "settings", command.key.wire()],
            Some(&json!({"value":expected})),
            true,
        )?;
        if written["success"] != true
            || written["key"] != command.key.wire()
            || written["value"] != expected
        {
            return Ok(false);
        }
        match self.setting_value(command.key) {
            Ok(observed) => Ok(observed.as_deref() == Some(expected)),
            Err(error) if error.retires_session() => Err(error),
            Err(_) => Ok(false),
        }
    }
    pub fn prepare_document_deletion(
        &self,
        patient: &str,
        id: &str,
    ) -> Result<PreparedDocumentDeletion> {
        validate_id(patient)?;
        validate_id(id)?;
        let value = self.request(Method::GET, &["api", "attachments", id], None, false)?;
        let expected = DocumentCurrentness::parse(value["currentness"].clone())?;
        let document = self.native.attachment(value, patient, Some(id))?;
        Ok(PreparedDocumentDeletion {
            owner: Arc::downgrade(&self.owner),
            document,
            expected,
            submitted: AtomicBool::new(false),
        })
    }
    pub fn delete_document(&self, command: &PreparedDocumentDeletion) -> Result<bool> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let response = self.request(
            Method::DELETE,
            &["api", "attachments", &command.document.id],
            Some(&json!({"patientId":command.document.patient_id,"expected":command.expected})),
            true,
        )?;
        if response["success"] != true {
            return Ok(false);
        }
        match self.request(
            Method::GET,
            &["api", "attachments", &command.document.id],
            None,
            false,
        ) {
            Err(RuntimeError::Missing) => Ok(true),
            Err(error) if error.retires_session() => Err(error),
            _ => Ok(false),
        }
    }
    fn record_retirement(&self) {
        if let Ok(mut marker) = self.retirement_marker.lock()
            && marker.is_none()
            && !self.retired.load(Ordering::Acquire)
        {
            *marker = Some(self.notice.begin());
        }
    }
    pub fn begin_retirement(self: &Arc<Self>) -> RetiringAccess {
        self.record_retirement();
        RetiringAccess {
            access: self.clone(),
        }
    }
    pub fn retire(&self) -> Result<()> {
        if self.closed.swap(true, Ordering::AcqRel) {
            return if self.retired.load(Ordering::Acquire) {
                Ok(())
            } else {
                Err(RuntimeError::Indeterminate)
            };
        }
        self.record_retirement();
        let client = self.client.with_request_context(RequestContext::default());
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            sensitive_header(&format!(
                "mediflow_session={}; mediflow_auth_control={}",
                *self.cookie, *self.control
            ))?,
        );
        let checked = client.dedicated_web_raw(
            Method::GET,
            &["api", "auth", "check"],
            headers.clone(),
            None,
            false,
        )?;
        let etag = checked
            .headers
            .get("etag")
            .ok_or(RuntimeError::InvalidResponse)?
            .clone();
        headers.insert("if-match", etag);
        headers.insert("idempotency-key", sensitive_header(&operation_uuid()?)?);
        let retired = client.dedicated_web_raw(
            Method::POST,
            &["api", "auth", "local-client", "logout"],
            headers,
            None,
            true,
        )?;
        if retired.status != 204 {
            return Err(RuntimeError::InvalidResponse);
        }
        self.retired.store(true, Ordering::Release);
        if let Ok(marker) = self.retirement_marker.lock()
            && let Some(marker) = marker.as_ref()
        {
            self.notice.confirm(marker);
        }
        Ok(())
    }
}

pub struct RetiringAccess {
    access: Arc<LocalHostAccess>,
}
impl RetiringAccess {
    pub fn retire(self) -> Result<()> {
        self.access.retire()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_preconditions_are_exact_safe_host_values() {
        let valid = json!({"sourceRef":"a".repeat(64),"revision":1,"freshnessEpoch":2});
        assert!(DocumentCurrentness::parse(valid.clone()).is_ok());
        for changed in [
            json!({}),
            json!({"sourceRef":"A".repeat(64),"revision":1,"freshnessEpoch":2}),
            json!({"sourceRef":"a".repeat(64),"revision":0,"freshnessEpoch":2}),
            json!({"sourceRef":"a".repeat(64),"revision":1,"freshnessEpoch":9_007_199_254_740_992u64}),
            json!({"sourceRef":"a".repeat(64),"revision":1,"freshnessEpoch":2,"extra":true}),
        ] {
            assert!(DocumentCurrentness::parse(changed).is_err());
        }
    }
}
