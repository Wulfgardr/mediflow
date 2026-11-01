use super::*;

const EMBEDDED: &str = "who.icd11.2026-01.mms.en.embedded.v1";
const LOCAL: &str = "who.icd11.v2.2026-01.mms.en.local.v1";
const MMS: &str = "http://id.who.int/icd/release/11/2026-01/mms/";
fn exact(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
}
fn hash(v: &Value) -> bool {
    v.as_str()
        .and_then(|s| s.strip_prefix("sha256:"))
        .is_some_and(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}
fn iso(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        chrono::DateTime::parse_from_rfc3339(s)
            .is_ok_and(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true) == s)
    })
}
fn number(v: &Value) -> bool {
    v.as_u64().is_some_and(|n| n <= crate::MAX_SAFE_VERSION)
}
fn reference(v: &Value, embedded: bool) -> bool {
    v["releaseId"] == "2026-01"
        && v["language"] == "en"
        && v["bindingId"] == if embedded { EMBEDDED } else { LOCAL }
        && hash(&v["datasetSnapshotId"])
        && (embedded || hash(&v["imageDigest"]))
}
fn title(v: &Value, embedded: bool) -> bool {
    v.as_str().is_some_and(|s| {
        if s.trim().is_empty()
            || s.encode_utf16().count() > 4096
            || s.chars().any(|c| matches!(c, '\0'..='\u{1f}' | '\u{7f}' | '\u{61c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'))
        {
            return false;
        }
        if !embedded {
            return !s.contains(['<', '>'])
                && s == s.split(crate::js_whitespace).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
        }
        s.char_indices().all(|(i, c)| {
            !matches!(c, '<' | '>') || s[i + c.len_utf8()..].chars()
                .find(|c| !crate::js_whitespace(*c)).is_some_and(|c| c.is_ascii_digit())
        })
    })
}
pub fn valid_who_check_code(code: &str) -> bool {
    code.len() <= 32
        && code != "N/A"
        && !code.is_empty()
        && code.split(['&', '/']).all(|s| {
            s.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
                && s.bytes().all(|b| {
                    b.is_ascii_uppercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-')
                })
        })
}
fn parse_readiness(v: Value, http_status: u16) -> Result<Value> {
    match v["schemaVersion"].as_str() {
        Some("mediflow.reference-data.icd11-who-readiness.v2") => {
            crate::who::parse_readiness(v.clone())?;
        }
        Some("mediflow.reference-data.icd11-who-readiness.v3") => {
            if !exact(
                &v,
                &[
                    "schemaVersion",
                    "status",
                    "releaseId",
                    "language",
                    "deployment",
                    "catalogState",
                    "datasetSnapshotId",
                ],
            ) || v["releaseId"] != "2026-01"
                || v["language"] != "en"
                || v["deployment"] != "embedded"
                || !matches!(
                    v["status"].as_str(),
                    Some("available" | "unavailable" | "disabled")
                )
                || !matches!(
                    v["catalogState"].as_str(),
                    Some("ready" | "absent" | "unverified")
                )
                || (!v["datasetSnapshotId"].is_null() && !hash(&v["datasetSnapshotId"]))
                || (v["status"] == "available"
                    && (v["catalogState"] != "ready" || !hash(&v["datasetSnapshotId"])))
            {
                return Err(RuntimeError::InvalidResponse);
            }
        }
        _ => return Err(RuntimeError::InvalidResponse),
    }
    if http_status != 200 && v["status"] == "available" {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(v)
}
fn parse_probe(v: Value) -> Result<Value> {
    if v["schemaVersion"] == "mediflow.reference-data.icd11-search-response.v2" {
        crate::who::parse_search(v.clone())?;
        return Ok(v);
    }
    let entries = v["entries"]
        .as_array()
        .ok_or(RuntimeError::InvalidResponse)?;
    let r = &v["receipt"];
    let mut seen = std::collections::HashSet::new();
    if !exact(&v, &["schemaVersion", "entries", "partial", "receipt"])
        || v["schemaVersion"] != "mediflow.reference-data.icd11-search-response.v3"
        || !v["partial"].is_boolean()
        || entries.len() > 25
        || !exact(
            r,
            &[
                "schemaVersion",
                "operation",
                "releaseId",
                "language",
                "bindingId",
                "datasetSnapshotId",
                "source",
                "resultCount",
                "latencyMs",
                "completedAt",
            ],
        )
        || r["schemaVersion"] != "mediflow.reference-data.icd11-search-receipt.v3"
        || r["operation"] != "mediflow.reference_data.icd11.search.v3"
        || r["source"] != "embedded"
        || !reference(r, true)
        || r["resultCount"].as_u64() != Some(entries.len() as u64)
        || !number(&r["latencyMs"])
        || !iso(&r["completedAt"])
        || entries.iter().any(|e| {
            let code = e["code"].as_str().unwrap_or("");
            !exact(e, &["code", "description", "system", "canonicalUri"])
                || !valid_who_check_code(code)
                || code.contains(['&', '/'])
                || !seen.insert(code)
                || !title(&e["description"], true)
                || e["system"] != "ICD-11"
                || !crate::who::canonical_uri(e["canonicalUri"].as_str().unwrap_or(""), code)
        })
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(v)
}
fn parse_code(v: Value, code: &str) -> Result<Value> {
    let r = &v["receipt"];
    let embedded = r["source"] == "embedded";
    let mut keys = vec![
        "schemaVersion",
        "operation",
        "releaseId",
        "language",
        "bindingId",
        "datasetSnapshotId",
        "source",
        "found",
        "checkedAt",
        "latencyMs",
    ];
    if !embedded {
        keys.push("imageDigest");
    }
    if !exact(&v, &["schemaVersion", "code", "status", "entry", "receipt"])
        || v["schemaVersion"] != "mediflow.reference-data.icd11-code-check.v1"
        || v["code"] != code
        || !matches!(v["status"].as_str(), Some("found" | "not_found"))
        || !exact(r, &keys)
        || r["schemaVersion"] != "mediflow.reference-data.icd11-code-check-receipt.v1"
        || r["operation"] != "mediflow.reference_data.icd11.code_check.v1"
        || !reference(r, embedded)
        || r["source"] != if embedded { "embedded" } else { "live" }
        || r["found"].as_bool() != Some(v["status"] == "found")
        || !iso(&r["checkedAt"])
        || !number(&r["latencyMs"])
        || (embedded && code.contains(['&', '/']))
    {
        return Err(RuntimeError::InvalidResponse);
    }
    if v["status"] == "not_found" {
        return if v["entry"].is_null() {
            Ok(v)
        } else {
            Err(RuntimeError::InvalidResponse)
        };
    }
    let e = &v["entry"];
    let encoded = code.replace('&', "%26").replace('/', "%2F");
    let uri = e["stemUri"]
        .as_str()
        .unwrap_or("")
        .strip_prefix(MMS)
        .unwrap_or("");
    let stem = uri.split('/').next().unwrap_or("");
    let suffix = uri.strip_prefix(stem).unwrap_or("");
    if !exact(e, &["canonicalUri", "stemUri", "stemCode", "stemTitle"])
        || e["canonicalUri"] != format!("{MMS}codeinfo/{encoded}")
        || e["stemCode"] != code.split(['&', '/']).next().unwrap_or("")
        || stem.is_empty()
        || stem.len() > 20
        || stem.starts_with('0')
        || !stem.bytes().all(|b| b.is_ascii_digit())
        || !matches!(suffix, "" | "/other" | "/unspecified")
        || !title(&e["stemTitle"], embedded)
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(v)
}
fn rollback_manifest(v: &Value) -> bool {
    v["schemaVersion"] == "mediflow.icd11-catalog-manifest.v1"
        && v["releaseId"] == "2026-01"
        && v["language"] == "en"
        && v["license"] == "CC BY-ND 3.0 IGO"
        && v["attribution"] == "World Health Organization (WHO)"
        && v["sha256"].as_str().is_some_and(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        && [
            "bytes",
            "rows",
            "categories",
            "withoutCode",
            "blocks",
            "chapters",
        ]
        .iter()
        .all(|k| number(&v[*k]))
        && v["categories"].as_u64().is_some_and(|n| n > 0)
        && v["sourceUrl"]
            .as_str()
            .is_some_and(|s| s == "https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip")
}
pub struct PreparedWhoRollback {
    owner: Weak<()>,
    revision: u64,
    submitted: AtomicBool,
}
impl PreparedWhoRollback {
    pub fn revision(&self) -> u64 {
        self.revision
    }
}

pub struct WhoRollbackWrite {
    pub recorded: Value,
    pub current: Result<Value>,
}
impl LocalHostAccess {
    fn who_read(&self, code_check: bool, query: &[(&str, &str)]) -> Result<(u16, Value)> {
        let raw = self
            .client
            .who_administration_read(code_check, query, self.headers()?)?;
        let v = serde_json::from_slice(&raw.body).map_err(|_| RuntimeError::InvalidResponse)?;
        self.headers()?;
        Ok((raw.status, v))
    }
    pub fn read_who_administration_readiness(&self) -> Result<Value> {
        let (status, v) = self.who_read(false, &[])?;
        parse_readiness(v, status)
    }
    pub fn probe_who_administration(&self) -> Result<Value> {
        let (_, v) = self.who_read(false, &[("q", "cholera")])?;
        parse_probe(v)
    }
    pub fn check_who_administration_code(&self, code: &str) -> Result<Value> {
        if !valid_who_check_code(code) {
            return Err(RuntimeError::InvalidInput);
        }
        let (_, v) = self.who_read(true, &[("code", code), ("release", "2026-01")])?;
        parse_code(v, code)
    }
    pub fn read_diagnostic_provider_setting(&self) -> Result<String> {
        let v = self.request(Method::GET, &["api", "settings", "aiProvider"], None, false)?;
        if v["key"] != "aiProvider" {
            return Err(RuntimeError::InvalidResponse);
        }
        v["value"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
            .map(str::to_owned)
            .ok_or(RuntimeError::InvalidResponse)
    }
    pub fn prepare_who_rollback(&self, observed: &ReferenceStatus) -> Result<PreparedWhoRollback> {
        self.headers()?;
        let revision = observed.data["revision"]
            .as_u64()
            .filter(|v| *v < crate::MAX_SAFE_VERSION)
            .ok_or(RuntimeError::ReadRequired)?;
        if observed.catalog != ReferenceCatalog::Who
            || observed.data["enabled"] != true
            || observed.data["previousAvailable"] != true
        {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(PreparedWhoRollback {
            owner: Arc::downgrade(&self.owner),
            revision,
            submitted: AtomicBool::new(false),
        })
    }
    pub fn rollback_who_catalog(&self, command: &PreparedWhoRollback) -> Result<WhoRollbackWrite> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let recorded = self.request(
            Method::POST,
            &["api", "icd", "catalog"],
            Some(
                &json!({"action":"rollback","confirmed":true,"expectedRevision":command.revision}),
            ),
            true,
        )?;
        if recorded["revision"].as_u64() != Some(command.revision + 1)
            || recorded["state"] != "ready"
            || !recorded["enabled"].is_boolean()
            || !recorded["previousAvailable"].is_boolean()
            || !rollback_manifest(&recorded["manifest"])
        {
            return Err(RuntimeError::Indeterminate);
        }
        let current = self
            .read_reference_catalog(ReferenceCatalog::Who)
            .map(|s| s.data);
        if let Err(e) = &current
            && e.retires_session()
        {
            return Err(*e);
        }
        Ok(WhoRollbackWrite { recorded, current })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        serde_json::from_str(include_str!("../../tests/fixtures/who-administration.json")).unwrap()
    }

    #[test]
    fn who_responses_bind_code_source_dataset_and_availability() {
        let f = fixture();
        assert!(parse_readiness(f["readiness"].clone(), 200).is_ok());
        assert!(parse_readiness(f["readiness"].clone(), 503).is_err());
        let mut unavailable = f["readiness"].clone();
        unavailable["status"] = json!("unavailable");
        unavailable["catalogState"] = json!("absent");
        unavailable["datasetSnapshotId"] = Value::Null;
        assert!(parse_readiness(unavailable, 503).is_ok());
        assert!(parse_probe(f["probe"].clone()).is_ok());
        assert!(parse_code(f["found"].clone(), "AA00").is_ok());
        assert!(parse_code(f["notFound"].clone(), "ZZ99").is_ok());
        assert!(parse_code(f["found"].clone(), "AA01").is_err());
        for (path, value) in [
            (["receipt", "source"], json!("cache")),
            (["receipt", "datasetSnapshotId"], json!("sha256:invalid")),
            (["receipt", "found"], json!(false)),
            (["entry", "stemCode"], json!("AA01")),
            (["entry", "stemUri"], json!("https://example.invalid/AA00")),
            (["entry", "stemTitle"], json!("<script>")),
        ] {
            let mut bad = f["found"].clone();
            bad[path[0]][path[1]] = value;
            assert!(parse_code(bad, "AA00").is_err(), "{path:?}");
        }
        let mut false_count = f["probe"].clone();
        false_count["receipt"]["resultCount"] = json!(1);
        assert!(parse_probe(false_count).is_err());
        let mut false_miss = f["notFound"].clone();
        false_miss["entry"] = f["found"]["entry"].clone();
        assert!(parse_code(false_miss, "ZZ99").is_err());
    }

    #[test]
    fn who_code_input_accepts_existing_compound_contract_but_no_query_or_patient_text() {
        for code in ["AA00", "1A00.1", "AA00&XY1/ZZ2"] {
            assert!(valid_who_check_code(code));
        }
        for code in [
            "",
            "N/A",
            "aa00",
            "AA00?patient=x",
            "AA00&&XY1",
            "AA00/",
            " AA00",
            "Nome inventato",
        ] {
            assert!(!valid_who_check_code(code));
        }
        let f = fixture();
        assert!(rollback_manifest(&f["rollback"]["manifest"]));
        let mut invalid = f["rollback"]["manifest"].clone();
        invalid["license"] = json!("invented");
        assert!(!rollback_manifest(&invalid));
        invalid = f["rollback"]["manifest"].clone();
        invalid["sourceUrl"] = json!("https://example.invalid/invented.zip");
        assert!(!rollback_manifest(&invalid));
    }

    #[test]
    fn who_local_code_check_keeps_direct_source_and_embedded_probe_validates_entries() {
        let f = fixture();
        let mut local = f["found"].clone();
        local["receipt"]["source"] = json!("live");
        local["receipt"]["bindingId"] = json!(LOCAL);
        local["receipt"]["imageDigest"] = json!(format!("sha256:{}", "a".repeat(64)));
        local["code"] = json!("AA00&XY1");
        local["entry"]["canonicalUri"] = json!(format!("{MMS}codeinfo/AA00%26XY1"));
        assert!(parse_code(local.clone(), "AA00&XY1").is_ok());
        local["receipt"]["source"] = json!("cache");
        assert!(parse_code(local, "AA00&XY1").is_err());

        let mut probe = f["probe"].clone();
        probe["entries"] = json!([{"code":"AA00", "description":f["found"]["entry"]["stemTitle"], "system":"ICD-11", "canonicalUri":f["found"]["entry"]["stemUri"]}]);
        probe["receipt"]["resultCount"] = json!(1);
        assert!(parse_probe(probe.clone()).is_ok());
        probe["entries"][0]["canonicalUri"] = json!("https://example.invalid/AA00");
        assert!(parse_probe(probe).is_err());
    }
}
