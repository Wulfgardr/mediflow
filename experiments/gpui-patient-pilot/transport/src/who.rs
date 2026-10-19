//! The paired WHO v2 consultation contract (ADR 0115). The host owns the
//! optional local service; this client never selects a source or calls WHO.

use crate::{Result, RuntimeError, RuntimeSession, session::CatalogRoute};
use chrono::{DateTime, SecondsFormat, Timelike, Utc};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

pub const WHO_ATTRIBUTION: &str = "ICD-11, World Health Organization (WHO), CC BY-ND 3.0 IGO";
pub(crate) const WHO_LIMIT: usize = 65_536;
pub(crate) const READINESS_PATH: &[&str] =
    &["api", "v1", "network", "terminology", "who", "readiness"];
const BINDING: &str = "who.icd11.v2.2026-01.mms.en.local.v1";
const MMS: &str = "http://id.who.int/icd/release/11/2026-01/mms/";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WhoReadinessStatus {
    Disabled,
    ConfigurationRequired,
    Configured,
    Available,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WhoSource {
    Live,
    Cache,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WhoReadiness {
    pub schema_version: String,
    pub status: WhoReadinessStatus,
    pub release_id: String,
    pub language: String,
    pub deployment: String,
    pub binding_id: String,
    pub image_digest: Option<String>,
    pub dataset_snapshot_id: Option<String>,
    pub last_live_observed_at: Option<String>,
    pub last_result_source: Option<WhoSource>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WhoEntry {
    pub code: String,
    pub description: String,
    pub system: String,
    pub canonical_uri: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WhoReceipt {
    pub schema_version: String,
    pub operation: String,
    pub release_id: String,
    pub language: String,
    pub deployment: String,
    pub binding_id: String,
    pub image_digest: String,
    pub dataset_snapshot_id: String,
    pub source: WhoSource,
    pub result_count: u64,
    pub latency_ms: u64,
    pub fetched_at: String,
    pub expires_at: String,
    pub completed_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WhoSearchResponse {
    pub schema_version: String,
    pub entries: Vec<WhoEntry>,
    pub partial: bool,
    pub receipt: WhoReceipt,
}

/// Exactly the host's normalization; only terminology terms, never a patient
/// context. The byte limit is applied after whitespace normalization.
pub fn normalize_who_query(input: &str) -> Result<String> {
    let value = input
        .split(crate::js_whitespace)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if value.is_empty()
        || value.len() > 160
        || value.chars().any(|c| {
            matches!(c, '\u{0000}'..='\u{001f}' | '\u{007f}' | '<' | '>' |
                '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
    {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(value)
}

fn reference(release: &str, language: &str, deployment: &str, binding: &str) -> bool {
    release == "2026-01" && language == "en" && deployment == "local" && binding == BINDING
}

fn digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hash| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn timestamp(value: &str) -> Result<i64> {
    let date = DateTime::parse_from_rfc3339(value)
        .map_err(|_| RuntimeError::InvalidResponse)?
        .with_timezone(&Utc);
    if date.nanosecond() >= 1_000_000_000
        || date.to_rfc3339_opts(SecondsFormat::Millis, true) != value
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(date.timestamp_millis())
}

pub(crate) fn parse_readiness(value: Value) -> Result<WhoReadiness> {
    // Option<T> alone accepts missing keys, but the public contract requires
    // explicit nulls. Unknown/missing members are never inferred locally.
    if value.as_object().map(|object| object.len()) != Some(10) {
        return Err(RuntimeError::InvalidResponse);
    }
    let result: WhoReadiness =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    let configured = !matches!(
        result.status,
        WhoReadinessStatus::Disabled | WhoReadinessStatus::ConfigurationRequired
    );
    if result.schema_version != "mediflow.reference-data.icd11-who-readiness.v2"
        || !reference(
            &result.release_id,
            &result.language,
            &result.deployment,
            &result.binding_id,
        )
        || result
            .image_digest
            .as_deref()
            .is_some_and(|value| !digest(value))
        || result
            .dataset_snapshot_id
            .as_deref()
            .is_some_and(|value| !digest(value))
        || (configured && (result.image_digest.is_none() || result.dataset_snapshot_id.is_none()))
        || (result.status == WhoReadinessStatus::Available
            && result.last_live_observed_at.is_none())
    {
        return Err(RuntimeError::InvalidResponse);
    }
    if let Some(date) = &result.last_live_observed_at {
        timestamp(date)?;
    }
    Ok(result)
}

/// Readiness is the one existing catalog GET whose valid unavailable body is
/// delivered with 503. It must never make arbitrary 503 bodies successful.
pub(crate) fn validate_readiness_http(status: u16, body: &[u8]) -> Result<()> {
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    if status == 503
        && value
            == serde_json::json!({
                "schemaVersion": "mediflow.reference-data.icd11-error.v1", "code": "service_unavailable"
            })
    {
        return Err(RuntimeError::Transport);
    }
    let result = parse_readiness(value)?;
    if (status == 200 && result.status == WhoReadinessStatus::Available)
        || (status == 503 && result.status != WhoReadinessStatus::Available)
    {
        Ok(())
    } else {
        Err(RuntimeError::InvalidResponse)
    }
}

fn canonical_uri(uri: &str, code: &str) -> bool {
    if code.contains(['&', '/']) {
        let valid_combination = code.split(['&', '/']).all(|part| {
            part.as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
                && part.bytes().all(|b| {
                    b.is_ascii_uppercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-')
                })
        });
        return valid_combination
            && uri
                == format!(
                    "{MMS}codeinfo/{}",
                    code.replace('&', "%26").replace('/', "%2F")
                );
    }
    uri.strip_prefix(MMS).is_some_and(|entity| {
        let number = entity
            .strip_suffix("/other")
            .or_else(|| entity.strip_suffix("/unspecified"))
            .unwrap_or(entity);
        !number.is_empty()
            && number.len() <= 20
            && !number.starts_with('0')
            && number.bytes().all(|b| b.is_ascii_digit())
    })
}

fn entry_valid(entry: &WhoEntry) -> bool {
    let code = &entry.code;
    !code.is_empty() && code.len() <= 32 && code != "N/A"
        && code.as_bytes()[0].is_ascii_alphanumeric()
        && code.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || matches!(b, b'.' | b'&' | b'/' | b'-'))
        && entry.system == "ICD-11"
        && !entry.description.is_empty() && entry.description.encode_utf16().count() <= 4096
        && entry.description == entry.description.split(crate::js_whitespace).filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" ")
        && !entry.description.chars().any(|c| matches!(c,
            '\u{0000}'..='\u{001f}' | '\u{007f}' | '<' | '>' | '\u{061c}' | '\u{200e}' | '\u{200f}' |
            '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'))
        && canonical_uri(&entry.canonical_uri, code)
}

fn parse_search(value: Value) -> Result<WhoSearchResponse> {
    let result: WhoSearchResponse =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    let receipt = &result.receipt;
    let mut codes = HashSet::new();
    if result.schema_version != "mediflow.reference-data.icd11-search-response.v2"
        || receipt.schema_version != "mediflow.reference-data.icd11-search-receipt.v2"
        || receipt.operation != "mediflow.reference_data.icd11.search.v2"
        || !reference(
            &receipt.release_id,
            &receipt.language,
            &receipt.deployment,
            &receipt.binding_id,
        )
        || !digest(&receipt.image_digest)
        || !digest(&receipt.dataset_snapshot_id)
        || result.entries.len() > 25
        || receipt.result_count != result.entries.len() as u64
        || receipt.latency_ms > crate::MAX_SAFE_VERSION
        || result
            .entries
            .iter()
            .any(|entry| !entry_valid(entry) || !codes.insert(&entry.code))
    {
        return Err(RuntimeError::InvalidResponse);
    }
    let fetched = timestamp(&receipt.fetched_at)?;
    let expires = timestamp(&receipt.expires_at)?;
    let completed = timestamp(&receipt.completed_at)?;
    if expires - fetched != 86_400_000
        || completed < fetched
        || completed >= expires
        || (receipt.source == WhoSource::Live && completed - fetched > receipt.latency_ms as i64)
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(result)
}

impl RuntimeSession {
    /// Passive observation, not a live probe. Configured is never available.
    pub fn read_who_readiness(&self, scope: &str) -> Result<WhoReadiness> {
        parse_readiness(self.read_catalog(scope, CatalogRoute::WhoReadiness, &[])?)
    }

    /// Explicit consultation only. No code application, writes or source fallback.
    pub fn search_who(&self, scope: &str, query: &str) -> Result<WhoSearchResponse> {
        let query = normalize_who_query(query)?;
        parse_search(self.read_catalog(scope, CatalogRoute::WhoSearch, &[("q", &query)])?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn readiness(status: &str) -> Value {
        json!({"schemaVersion":"mediflow.reference-data.icd11-who-readiness.v2",
            "status":status,"releaseId":"2026-01","language":"en","deployment":"local",
            "bindingId":BINDING,"imageDigest":format!("sha256:{}", "a".repeat(64)),
            "datasetSnapshotId":format!("sha256:{}", "b".repeat(64)),
            "lastLiveObservedAt":if status == "available" {Some("2026-10-19T00:00:00.000Z")} else {None},
            "lastResultSource":null})
    }

    fn search() -> Value {
        json!({"schemaVersion":"mediflow.reference-data.icd11-search-response.v2", "entries":[
            {"code":"TEST1","description":"Synthetic English title","system":"ICD-11","canonicalUri":format!("{MMS}123")}],
            "partial":true,"receipt":{"schemaVersion":"mediflow.reference-data.icd11-search-receipt.v2",
            "operation":"mediflow.reference_data.icd11.search.v2","releaseId":"2026-01","language":"en",
            "deployment":"local","bindingId":BINDING,"imageDigest":format!("sha256:{}", "a".repeat(64)),
            "datasetSnapshotId":format!("sha256:{}", "b".repeat(64)),"source":"live","resultCount":1,
            "latencyMs":10,"fetchedAt":"2026-10-19T00:00:00.000Z","expiresAt":"2026-10-20T00:00:00.000Z",
            "completedAt":"2026-10-19T00:00:00.010Z"}})
    }

    #[test]
    fn who_queries_are_explicit_bounded_and_cannot_select_another_binding() {
        assert_eq!(
            normalize_who_query(" \u{feff} chronic\n pain\t"),
            Ok("chronic pain".into())
        );
        assert!(normalize_who_query(&"é".repeat(80)).is_ok());
        for query in [
            "".into(),
            " \u{feff}".into(),
            "é".repeat(81),
            "<script>".into(),
            "term\0".into(),
            "term\u{202e}".into(),
        ] {
            assert_eq!(normalize_who_query(&query), Err(RuntimeError::InvalidInput));
        }
    }

    #[test]
    fn who_readiness_preserves_nonavailable_503_and_rejects_false_availability() {
        for status in [
            "disabled",
            "configuration_required",
            "configured",
            "available",
            "unavailable",
        ] {
            let value = readiness(status);
            assert!(parse_readiness(value.clone()).is_ok());
            let bytes = serde_json::to_vec(&value).unwrap();
            let http = if status == "available" { 200 } else { 503 };
            assert_eq!(validate_readiness_http(http, &bytes), Ok(()));
            assert_eq!(
                validate_readiness_http(if http == 200 { 503 } else { 200 }, &bytes),
                Err(RuntimeError::InvalidResponse)
            );
        }
        for key in ["lastLiveObservedAt", "imageDigest", "lastResultSource"] {
            let mut value = readiness("available");
            value.as_object_mut().unwrap().remove(key);
            assert!(parse_readiness(value).is_err());
        }
        let mut value = readiness("available");
        value["lastLiveObservedAt"] = Value::Null;
        assert!(parse_readiness(value).is_err());
        assert_eq!(validate_readiness_http(503, br#"{"schemaVersion":"mediflow.reference-data.icd11-error.v1","code":"service_unavailable"}"#), Err(RuntimeError::Transport));
        assert!(validate_readiness_http(503, br#"{"status":"configured"}"#).is_err());
    }

    #[test]
    fn who_results_keep_empty_partial_source_and_exact_public_reference() {
        let value = search();
        let result = parse_search(value.clone()).unwrap();
        assert!(result.partial);
        assert_eq!(result.receipt.source, WhoSource::Live);
        assert_eq!(result.entries[0].canonical_uri, format!("{MMS}123"));
        let mut cached = value;
        cached["entries"] = json!([]);
        cached["receipt"]["resultCount"] = json!(0);
        cached["receipt"]["source"] = json!("cache");
        cached["receipt"]["completedAt"] = json!("2026-10-19T01:00:00.000Z");
        let empty = parse_search(cached).unwrap();
        assert!(empty.entries.is_empty());
        assert_eq!(empty.receipt.source, WhoSource::Cache);
        assert!(empty.partial);
        assert!(canonical_uri(
            &format!("{MMS}codeinfo/TEST1%26TEST2"),
            "TEST1&TEST2"
        ));
        assert!(!canonical_uri(&format!("{MMS}123"), "TEST1&TEST2"));
    }

    #[test]
    fn who_invalid_provenance_and_entries_fail_closed_without_truncation() {
        for (pointer, replacement) in [
            (
                "/schemaVersion",
                json!("mediflow.reference-data.icd11-search-response.v3"),
            ),
            ("/receipt/bindingId", json!("other")),
            ("/receipt/language", json!("it")),
            ("/receipt/source", json!("embedded")),
            ("/receipt/resultCount", json!(0)),
            ("/receipt/imageDigest", json!("sha256:BAD")),
            ("/receipt/expiresAt", json!("2026-10-20T00:00:00.001Z")),
            ("/receipt/completedAt", json!("2026-10-20T00:00:00.000Z")),
            ("/receipt/fetchedAt", json!("2026-10-19T01:00:00.000+01:00")),
            ("/receipt/completedAt", json!("2026-10-19T00:00:60.000Z")),
            (
                "/entries/0/canonicalUri",
                json!("https://other.example/123"),
            ),
            ("/entries/0/code", json!("N/A")),
            ("/entries/0/description", json!("<b>Title</b>")),
        ] {
            let mut value = search();
            *value.pointer_mut(pointer).unwrap() = replacement;
            assert!(parse_search(value).is_err(), "{pointer}");
        }
        let mut value = search();
        value["extra"] = json!(true);
        assert!(parse_search(value).is_err());
        let mut value = search();
        let row = value["entries"][0].clone();
        value["entries"] = json!(vec![row; 26]);
        value["receipt"]["resultCount"] = json!(26);
        assert!(parse_search(value).is_err());
    }
}
