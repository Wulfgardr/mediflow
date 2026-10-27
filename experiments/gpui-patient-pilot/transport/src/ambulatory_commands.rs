use crate::{MAX_SAFE_VERSION, Result, RuntimeError, validate_version};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;

pub const AMBULATORY_COMMAND_PROTOCOL: &str = "ambulatory.destructive.v1";
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum AmbulatoryCommandOperation {
    #[serde(rename = "ambulatory.clear-test.v1")]
    ClearTest,
    #[serde(rename = "ambulatory.delete.v1")]
    Delete,
}
impl AmbulatoryCommandOperation {
    pub fn confirmation(self) -> &'static str {
        match self {
            Self::ClearTest => "SVUOTA",
            Self::Delete => "ELIMINA",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbulatoryCommandIntent {
    pub operation: AmbulatoryCommandOperation,
    pub original_scope_id: String,
    pub ambulatory_id: String,
    pub expected_version: u64,
}
impl AmbulatoryCommandIntent {
    pub(crate) fn validate(&self) -> Result<()> {
        opaque(&self.original_scope_id)?;
        opaque(&self.ambulatory_id)?;
        validate_version(self.expected_version)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbulatoryCommandMarker {
    pub protocol: String,
    pub command_id: String,
    pub original_archive_generation: String,
    pub original_scope_id: String,
    pub ambulatory_id: String,
    pub expected_version: u64,
    pub operation: AmbulatoryCommandOperation,
    pub plan_digest: String,
}
impl AmbulatoryCommandMarker {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let marker: Self =
            serde_json::from_slice(bytes).map_err(|_| RuntimeError::InvalidResponse)?;
        marker.validate()?;
        Ok(marker)
    }
    pub fn bytes(&self) -> Result<Vec<u8>> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| RuntimeError::InvalidInput)
    }
    pub(crate) fn validate(&self) -> Result<()> {
        if self.protocol != AMBULATORY_COMMAND_PROTOCOL
            || !uuid(&self.command_id)
            || !uuid(&self.original_archive_generation)
            || !hex64(&self.plan_digest)
        {
            return Err(RuntimeError::InvalidResponse);
        }
        self.intent()
            .validate()
            .map_err(|_| RuntimeError::InvalidResponse)
    }
    pub(crate) fn intent(&self) -> AmbulatoryCommandIntent {
        AmbulatoryCommandIntent {
            operation: self.operation,
            original_scope_id: self.original_scope_id.clone(),
            ambulatory_id: self.ambulatory_id.clone(),
            expected_version: self.expected_version,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbulatoryCommandTarget {
    pub id: String,
    pub version: u64,
    pub name: String,
    #[serde(rename = "type", deserialize_with = "nullable")]
    pub kind: Option<String>,
    pub is_default: bool,
    #[serde(deserialize_with = "nullable")]
    pub parent_id: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub created_at: Option<i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbulatoryCommandCounts {
    pub tombstoned_patients: u64,
    pub unlinked_patients: u64,
    pub preserved_live_patients: u64,
    pub removed_membership_rows: u64,
}
impl AmbulatoryCommandCounts {
    fn validate(&self) -> Result<()> {
        if [
            self.tombstoned_patients,
            self.unlinked_patients,
            self.preserved_live_patients,
            self.removed_membership_rows,
        ]
        .into_iter()
        .any(|n| n > MAX_SAFE_VERSION)
            || self.preserved_live_patients > self.unlinked_patients
            || self.removed_membership_rows
                < self
                    .tombstoned_patients
                    .saturating_add(self.unlinked_patients)
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbulatoryCommandVersion {
    pub id: String,
    pub version: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbulatoryCommandFallback {
    pub id: String,
    pub version: u64,
    pub name: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbulatoryCommandPreview {
    pub marker: AmbulatoryCommandMarker,
    pub target: AmbulatoryCommandTarget,
    #[serde(deserialize_with = "nullable")]
    pub fallback: Option<AmbulatoryCommandFallback>,
    #[serde(deserialize_with = "nullable")]
    pub counts: Option<AmbulatoryCommandCounts>,
    pub challenge_expires_at: u64,
}
impl AmbulatoryCommandPreview {
    pub(crate) fn parse(bytes: &[u8], identity: &AmbulatoryCommandMarker) -> Result<Self> {
        let value: Self =
            serde_json::from_slice(bytes).map_err(|_| RuntimeError::InvalidResponse)?;
        value.marker.validate()?;
        if value.marker.intent() != identity.intent()
            || value.marker.command_id != identity.command_id
            || value.marker.original_archive_generation != identity.original_archive_generation
            || value.target.id != identity.ambulatory_id
            || value.target.version != identity.expected_version
            || value.target.name.is_empty()
            || value.challenge_expires_at == 0
            || value.challenge_expires_at > MAX_SAFE_VERSION
        {
            return Err(RuntimeError::InvalidResponse);
        }
        if let Some(parent) = &value.target.parent_id {
            opaque(parent)?;
        }
        if let Some(fallback) = &value.fallback {
            opaque(&fallback.id)?;
            validate_version(fallback.version)?;
            if fallback.id == value.target.id || fallback.name.is_empty() {
                return Err(RuntimeError::InvalidResponse);
            }
        }
        match value.marker.operation {
            AmbulatoryCommandOperation::ClearTest => {
                if value.target.kind.as_deref() != Some("test") || value.fallback.is_some() {
                    return Err(RuntimeError::InvalidResponse);
                }
                value
                    .counts
                    .as_ref()
                    .ok_or(RuntimeError::InvalidResponse)?
                    .validate()?;
            }
            AmbulatoryCommandOperation::Delete => {
                if value.counts.is_some() || value.target.is_default != value.fallback.is_some() {
                    return Err(RuntimeError::InvalidResponse);
                }
            }
        }
        Ok(value)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbulatoryCommandResult {
    #[serde(deserialize_with = "nullable")]
    pub target_version: Option<u64>,
    pub affected_ambulatories: Vec<AmbulatoryCommandVersion>,
    #[serde(deserialize_with = "nullable")]
    pub clear: Option<AmbulatoryCommandCounts>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AmbulatoryCommandOutcome {
    Applied,
    Rejected,
    Closed,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbulatoryCommandReceipt {
    pub protocol: String,
    pub command_id: String,
    pub original_archive_generation: String,
    pub original_scope_id: String,
    pub ambulatory_id: String,
    pub expected_version: u64,
    pub operation: AmbulatoryCommandOperation,
    pub plan_digest: String,
    pub outcome: AmbulatoryCommandOutcome,
    #[serde(deserialize_with = "nullable")]
    pub reason: Option<String>,
    pub committed_at: u64,
    #[serde(deserialize_with = "nullable")]
    pub result: Option<AmbulatoryCommandResult>,
}
impl AmbulatoryCommandReceipt {
    pub fn marker(&self) -> AmbulatoryCommandMarker {
        AmbulatoryCommandMarker {
            protocol: self.protocol.clone(),
            command_id: self.command_id.clone(),
            original_archive_generation: self.original_archive_generation.clone(),
            original_scope_id: self.original_scope_id.clone(),
            ambulatory_id: self.ambulatory_id.clone(),
            expected_version: self.expected_version,
            operation: self.operation,
            plan_digest: self.plan_digest.clone(),
        }
    }
    fn validate(&self, marker: &AmbulatoryCommandMarker) -> Result<()> {
        if self.marker() != *marker || self.committed_at > 8_640_000_000_000 {
            return Err(RuntimeError::InvalidResponse);
        }
        match self.outcome {
            AmbulatoryCommandOutcome::Closed if self.reason.is_none() && self.result.is_none() => {
                Ok(())
            }
            AmbulatoryCommandOutcome::Rejected
                if self.result.is_none()
                    && matches!(
                        self.reason.as_deref(),
                        Some("plan_changed" | "not_admissible")
                    ) =>
            {
                Ok(())
            }
            AmbulatoryCommandOutcome::Applied if self.reason.is_none() => {
                let result = self.result.as_ref().ok_or(RuntimeError::InvalidResponse)?;
                let mut ids = HashSet::new();
                for row in &result.affected_ambulatories {
                    opaque(&row.id)?;
                    validate_version(row.version)?;
                    if !ids.insert(&row.id) {
                        return Err(RuntimeError::InvalidResponse);
                    }
                }
                match marker.operation {
                    AmbulatoryCommandOperation::ClearTest => {
                        result
                            .clear
                            .as_ref()
                            .ok_or(RuntimeError::InvalidResponse)?
                            .validate()?;
                        if result.target_version != marker.expected_version.checked_add(1)
                            || result.affected_ambulatories
                                != vec![AmbulatoryCommandVersion {
                                    id: marker.ambulatory_id.clone(),
                                    version: marker.expected_version + 1,
                                }]
                        {
                            return Err(RuntimeError::InvalidResponse);
                        }
                        Ok(())
                    }
                    AmbulatoryCommandOperation::Delete
                        if result.target_version.is_none()
                            && result.clear.is_none()
                            && result.affected_ambulatories.len() <= 1
                            && !result
                                .affected_ambulatories
                                .iter()
                                .any(|row| row.id == marker.ambulatory_id) =>
                    {
                        Ok(())
                    }
                    _ => Err(RuntimeError::InvalidResponse),
                }
            }
            _ => Err(RuntimeError::InvalidResponse),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AmbulatoryCommandRead {
    Unknown,
    Terminal(Box<AmbulatoryCommandTerminal>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AmbulatoryCommandTerminal {
    historical: bool,
    receipt: AmbulatoryCommandReceipt,
    binding: Option<crate::ambulatory_command_recovery::CommandRecoveryBinding>,
}
impl AmbulatoryCommandTerminal {
    pub fn historical(&self) -> bool {
        self.historical
    }
    pub fn receipt(&self) -> &AmbulatoryCommandReceipt {
        &self.receipt
    }
    pub(crate) fn bound_to(
        &self,
        binding: &crate::ambulatory_command_recovery::CommandRecoveryBinding,
    ) -> bool {
        self.binding.as_ref() == Some(binding)
    }
}
impl AmbulatoryCommandRead {
    pub(crate) fn bind(
        mut self,
        binding: &crate::ambulatory_command_recovery::CommandRecoveryBinding,
    ) -> Self {
        if let Self::Terminal(terminal) = &mut self {
            terminal.binding = Some(binding.clone());
        }
        self
    }
    pub(crate) fn parse(
        bytes: &[u8],
        marker: &AmbulatoryCommandMarker,
        allow_unknown: bool,
    ) -> Result<Self> {
        #[derive(Deserialize)]
        #[serde(tag = "outcome", rename_all = "lowercase", deny_unknown_fields)]
        enum Wire {
            Unknown {},
            Terminal {
                historical: bool,
                receipt: Box<AmbulatoryCommandReceipt>,
            },
        }
        let value: Wire = serde_json::from_slice(bytes).map_err(|_| RuntimeError::Indeterminate)?;
        match value {
            Wire::Unknown {} if allow_unknown => Ok(Self::Unknown),
            Wire::Terminal {
                historical,
                receipt,
            } => {
                receipt
                    .validate(marker)
                    .map_err(|_| RuntimeError::Indeterminate)?;
                Ok(Self::Terminal(Box::new(AmbulatoryCommandTerminal {
                    historical,
                    receipt: *receipt,
                    binding: None,
                })))
            }
            _ => Err(RuntimeError::Indeterminate),
        }
    }
}
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
fn opaque(value: &str) -> Result<()> {
    if value.is_empty()
        || value.encode_utf16().count() > 256
        || value.trim_matches(crate::js_whitespace) != value
        || value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(())
}
pub(crate) fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(crate) fn uuid(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 36
        && [8, 13, 18, 23].into_iter().all(|i| b[i] == b'-')
        && b[14] == b'4'
        && matches!(b[19], b'8' | b'9' | b'a' | b'b')
        && b.iter().enumerate().all(|(i, c)| {
            [8, 13, 18, 23].contains(&i) || c.is_ascii_digit() || (b'a'..=b'f').contains(c)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    fn marker() -> AmbulatoryCommandMarker {
        AmbulatoryCommandMarker {
            protocol: AMBULATORY_COMMAND_PROTOCOL.into(),
            command_id: "11111111-1111-4111-8111-111111111111".into(),
            original_archive_generation: "22222222-2222-4222-8222-222222222222".into(),
            original_scope_id: "scope".into(),
            ambulatory_id: "target".into(),
            expected_version: 1,
            operation: AmbulatoryCommandOperation::ClearTest,
            plan_digest: "a".repeat(64),
        }
    }
    fn preview() -> Value {
        json!({"marker":marker(),"target":{"id":"target","version":1,"name":"Test inventato","type":"test","isDefault":false,"parentId":null,"createdAt":1},
            "fallback":null,"counts":{"tombstonedPatients":2,"unlinkedPatients":1,"preservedLivePatients":1,"removedMembershipRows":4},"challengeExpiresAt":10000})
    }
    fn receipt() -> Value {
        let mut value = serde_json::to_value(marker()).unwrap();
        value.as_object_mut().unwrap().extend(json!({"outcome":"applied","reason":null,"committedAt":100,"result":{"targetVersion":2,"affectedAmbulatories":[{"id":"target","version":2}],"clear":preview()["counts"]}}).as_object().unwrap().clone());
        json!({"outcome":"terminal","historical":false,"receipt":value})
    }
    #[test]
    fn ambulatory_command_marker_is_minimal_exact_and_not_a_credential_container() {
        let bytes = marker().bytes().unwrap();
        assert_eq!(AmbulatoryCommandMarker::parse(&bytes), Ok(marker()));
        let original = String::from_utf8(bytes).unwrap();
        for key in [
            "patientIds",
            "target",
            "cookie",
            "control",
            "token",
            "auditSnapshots",
        ] {
            let mut value = serde_json::to_value(marker()).unwrap();
            value[key] = json!("private");
            assert!(AmbulatoryCommandMarker::parse(&serde_json::to_vec(&value).unwrap()).is_err());
        }
        for key in ["commandId", "protocol", "planDigest", "operation"] {
            let mut value = serde_json::to_value(marker()).unwrap();
            value.as_object_mut().unwrap().remove(key);
            assert!(AmbulatoryCommandMarker::parse(&serde_json::to_vec(&value).unwrap()).is_err());
        }
        let duplicate = original.replacen(
            '{',
            "{\"commandId\":\"11111111-1111-4111-8111-111111111111\",",
            1,
        );
        assert!(AmbulatoryCommandMarker::parse(duplicate.as_bytes()).is_err());
    }
    #[test]
    fn ambulatory_command_preview_preserves_distinct_host_counts_and_binds_identity() {
        let parsed =
            AmbulatoryCommandPreview::parse(&serde_json::to_vec(&preview()).unwrap(), &marker())
                .unwrap();
        assert_eq!(
            parsed.counts.unwrap(),
            AmbulatoryCommandCounts {
                tombstoned_patients: 2,
                unlinked_patients: 1,
                preserved_live_patients: 1,
                removed_membership_rows: 4
            }
        );
        for pointer in [
            "/marker/commandId",
            "/marker/originalArchiveGeneration",
            "/marker/ambulatoryId",
            "/target/id",
        ] {
            let mut v = preview();
            *v.pointer_mut(pointer).unwrap() = json!("other");
            assert!(
                AmbulatoryCommandPreview::parse(&serde_json::to_vec(&v).unwrap(), &marker())
                    .is_err()
            );
        }
        for field in ["fallback", "counts"] {
            let mut v = preview();
            v.as_object_mut().unwrap().remove(field);
            assert!(
                AmbulatoryCommandPreview::parse(&serde_json::to_vec(&v).unwrap(), &marker())
                    .is_err()
            );
        }
        let mut v = preview();
        v["patients"] = json!(["private"]);
        assert!(
            AmbulatoryCommandPreview::parse(&serde_json::to_vec(&v).unwrap(), &marker()).is_err()
        );
    }
    #[test]
    fn ambulatory_command_receipt_binds_all_immutable_fields_and_refuses_forged_success() {
        let valid = receipt();
        assert!(matches!(
            AmbulatoryCommandRead::parse(&serde_json::to_vec(&valid).unwrap(), &marker(), false),
            Ok(AmbulatoryCommandRead::Terminal(terminal)) if !terminal.historical()
        ));
        for pointer in [
            "/receipt/commandId",
            "/receipt/originalArchiveGeneration",
            "/receipt/originalScopeId",
            "/receipt/ambulatoryId",
            "/receipt/planDigest",
            "/receipt/operation",
        ] {
            let mut v = valid.clone();
            *v.pointer_mut(pointer).unwrap() = json!("other");
            assert!(
                AmbulatoryCommandRead::parse(&serde_json::to_vec(&v).unwrap(), &marker(), false)
                    .is_err()
            );
        }
        for pointer in [
            "/receipt/expectedVersion",
            "/receipt/result/targetVersion",
            "/receipt/result/affectedAmbulatories/0/version",
        ] {
            let mut v = valid.clone();
            *v.pointer_mut(pointer).unwrap() = json!(9);
            assert!(
                AmbulatoryCommandRead::parse(&serde_json::to_vec(&v).unwrap(), &marker(), false)
                    .is_err()
            );
        }
        for field in ["reason", "result"] {
            let mut v = valid.clone();
            v["receipt"].as_object_mut().unwrap().remove(field);
            assert!(
                AmbulatoryCommandRead::parse(&serde_json::to_vec(&v).unwrap(), &marker(), false)
                    .is_err()
            );
        }
        let mut v = valid.clone();
        v["receipt"]["result"]["affectedAmbulatories"] =
            json!([{"id":"target","version":2},{"id":"target","version":2}]);
        assert!(
            AmbulatoryCommandRead::parse(&serde_json::to_vec(&v).unwrap(), &marker(), false)
                .is_err()
        );
        let mut v = valid;
        v["receipt"]["auditSnapshots"] = json!([]);
        assert!(
            AmbulatoryCommandRead::parse(&serde_json::to_vec(&v).unwrap(), &marker(), false)
                .is_err()
        );
    }
    #[test]
    fn ambulatory_command_unknown_closed_and_historical_are_separate_from_current_state() {
        let unknown = br#"{"outcome":"unknown"}"#;
        assert_eq!(
            AmbulatoryCommandRead::parse(unknown, &marker(), true),
            Ok(AmbulatoryCommandRead::Unknown)
        );
        assert!(AmbulatoryCommandRead::parse(unknown, &marker(), false).is_err());
        assert!(
            AmbulatoryCommandRead::parse(br#"{"outcome":"unknown","receipt":{}}"#, &marker(), true)
                .is_err()
        );
        let mut v = receipt();
        v["historical"] = json!(true);
        v["receipt"]["outcome"] = json!("closed");
        v["receipt"]["result"] = Value::Null;
        assert!(matches!(
            AmbulatoryCommandRead::parse(&serde_json::to_vec(&v).unwrap(), &marker(), false),
            Ok(AmbulatoryCommandRead::Terminal(terminal)) if terminal.historical() && terminal.receipt().outcome == AmbulatoryCommandOutcome::Closed
        ));
        v["receipt"]["result"] = json!({});
        assert!(
            AmbulatoryCommandRead::parse(&serde_json::to_vec(&v).unwrap(), &marker(), false)
                .is_err()
        );
    }
}
