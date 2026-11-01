use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ReferenceCatalog {
    #[default]
    Aifa,
    Exemptions,
    Prosthetics,
    Who,
}
impl ReferenceCatalog {
    pub const ALL: [Self; 4] = [Self::Aifa, Self::Exemptions, Self::Prosthetics, Self::Who];
    pub fn title(self) -> &'static str {
        match self {
            Self::Aifa => "Farmaci AIFA",
            Self::Exemptions => "Esenzioni",
            Self::Prosthetics => "Protesica e ausili",
            Self::Who => "Terminologia WHO",
        }
    }
    fn path(self, action: &'static str) -> Vec<&'static str> {
        match self {
            Self::Exemptions => vec!["api", "exemptions", "import", action],
            Self::Prosthetics => vec!["api", "prosthetics", "catalog", action],
            Self::Who => vec!["api", "icd", "catalog"],
            Self::Aifa => vec!["api", "drugs"],
        }
    }
    pub fn file_limit(self) -> u64 {
        if self == Self::Aifa {
            100 * 1024 * 1024
        } else {
            2 * 1024 * 1024
        }
    }
}
#[derive(Clone, Debug)]
pub struct ReferenceStatus {
    pub catalog: ReferenceCatalog,
    pub data: Value,
    pub sources: Option<Result<Value>>,
}
pub struct PreparedReferenceImport {
    owner: Weak<()>,
    catalog: ReferenceCatalog,
    preview: Value,
    payload: Value,
    file: Option<Vec<u8>>,
    submitted: AtomicBool,
    baseline: Option<Value>,
    cancellation: Option<Box<RequestContext>>,
}
impl PreparedReferenceImport {
    pub fn cancel_acquisition(&self) {
        if let Some(context) = &self.cancellation {
            context.cancel();
        }
    }
    pub fn acquisition_cancellable(&self) -> bool {
        self.cancellation.is_some()
    }
    pub fn catalog(&self) -> ReferenceCatalog {
        self.catalog
    }
    pub fn data(&self) -> &Value {
        &self.preview
    }
    pub fn can_commit(&self) -> bool {
        match self.catalog {
            ReferenceCatalog::Aifa => {
                self.file.is_none()
                    || self.preview["review"]["count"]
                        .as_u64()
                        .is_some_and(|n| n > 0)
            }
            ReferenceCatalog::Who => self.preview["previewId"].is_string(),
            _ => self.preview["valid"] == true && self.preview["proof"].is_string(),
        }
    }
}
pub enum ReferenceImportResult {
    Recorded(Value),
    Reduction(PreparedReferenceImport),
    CatalogChanged,
}
fn status(catalog: ReferenceCatalog, value: Value) -> Result<Value> {
    let valid = match catalog {
        ReferenceCatalog::Aifa => {
            value["count"].is_u64()
                && matches!(
                    value["state"].as_str(),
                    Some("ready" | "unverified" | "not-imported")
                )
        }
        ReferenceCatalog::Who => {
            value["revision"].is_u64()
                && value["enabled"].is_boolean()
                && value["previousAvailable"].is_boolean()
                && matches!(
                    value["state"].as_str(),
                    Some("ready" | "unverified" | "absent")
                )
        }
        _ => {
            value["revision"].is_string()
                && value["count"].is_u64()
                && (value["latestReceipt"].is_null() || value["latestReceipt"].is_object())
        }
    };
    if valid {
        Ok(value)
    } else {
        Err(RuntimeError::InvalidResponse)
    }
}
fn aifa_file_review(text: &str) -> Result<Value> {
    use unicode_normalization::UnicodeNormalization;
    let delimiter = if text.lines().next().unwrap_or("").contains(';') {
        ';'
    } else {
        ','
    };
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '"' {
            if quoted && chars.peek() == Some(&'"') {
                chars.next();
                field.push('"');
            } else {
                quoted = !quoted;
            }
        } else if !quoted && (c == delimiter || c == '\n' || c == '\r') {
            record.push(field.trim().to_owned());
            field.clear();
            if c != delimiter {
                if c == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                if record.iter().any(|s| !s.is_empty()) {
                    records.push(record);
                }
                record = Vec::new();
            }
        } else {
            field.push(c);
        }
    }
    record.push(field.trim().to_owned());
    if record.iter().any(|s| !s.is_empty()) {
        records.push(record);
    }
    if quoted || records.len() < 2 {
        return Err(RuntimeError::InvalidInput);
    }
    let headers = records[0]
        .iter()
        .map(|s| {
            s.trim_start_matches('\u{feff}')
                .nfkd()
                .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
                .collect::<String>()
                .to_ascii_lowercase()
                .split(|c: char| !c.is_ascii_alphanumeric())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("_")
        })
        .collect::<Vec<_>>();
    let column = |aliases: &[&str]| {
        aliases
            .iter()
            .find_map(|a| headers.iter().position(|h| h == a))
            .ok_or(RuntimeError::InvalidInput)
    };
    let aic = column(&["codice_aic", "aic"])?;
    let name = column(&["denominazione", "nome_commerciale"])?;
    column(&["codice_atc", "atc"])?;
    column(&["pa_associati", "principio_attivo", "principi_attivi"])?;
    let mut rejected = 0;
    let mut duplicates = 0;
    let mut seen = std::collections::HashSet::new();
    let mut diagnostics = Vec::new();
    for (i, row) in records.iter().enumerate().skip(1) {
        let code = row
            .get(aic)
            .map(|s| s.chars().filter(|c| !c.is_whitespace()).collect::<String>())
            .unwrap_or_default();
        let invalid_code =
            !(6..=9).contains(&code.len()) || !code.bytes().all(|b| b.is_ascii_digit());
        let missing_name = row.get(name).is_none_or(|s| s.is_empty());
        let message = if invalid_code || missing_name {
            rejected += 1;
            Some(match (invalid_code, missing_name) {
                (true, true) => "AIC non valido e denominazione assente",
                (true, false) => "AIC non valido",
                _ => "Denominazione assente",
            })
        } else if !seen.insert(code) {
            duplicates += 1;
            Some("AIC duplicato: viene conservata l’ultima riga")
        } else {
            None
        };
        if let Some(message) = message
            && diagnostics.len() < 200
        {
            diagnostics.push(json!({"row":i+1,"message":message}));
        }
    }
    Ok(
        json!({"totalRecords":records.len()-1,"rejectedRecords":rejected,"duplicateRows":duplicates,
        "count":seen.len(),"diagnosticsTruncated":rejected+duplicates>200,"diagnostics":diagnostics}),
    )
}
impl LocalHostAccess {
    pub fn read_reference_catalog(&self, catalog: ReferenceCatalog) -> Result<ReferenceStatus> {
        let data = if catalog == ReferenceCatalog::Aifa {
            let raw = self.client.aifa_catalog_raw(self.headers()?, None)?;
            serde_json::from_slice(&raw.body).map_err(|_| RuntimeError::InvalidResponse)?
        } else {
            self.request(Method::GET, &catalog.path("status"), None, false)?
        };
        let data = status(catalog, data)?;
        let sources = if catalog == ReferenceCatalog::Prosthetics {
            let result = self
                .request(Method::GET, &catalog.path("sources"), None, false)
                .and_then(|v| {
                    if v["sources"].is_array() && v["revision"].is_string() {
                        if v["revision"] != data["revision"] {
                            return Err(RuntimeError::Conflict);
                        }
                        Ok(v)
                    } else {
                        Err(RuntimeError::InvalidResponse)
                    }
                });
            if let Err(e) = result.as_ref()
                && e.retires_session()
            {
                return Err(*e);
            }
            Some(result)
        } else {
            None
        };
        self.headers()?;
        Ok(ReferenceStatus {
            catalog,
            data,
            sources,
        })
    }
    pub fn aifa_source_status(&self, check_remote: bool) -> Result<Value> {
        let value = self.request(
            if check_remote {
                Method::POST
            } else {
                Method::GET
            },
            &["api", "drugs", "source"],
            None,
            check_remote,
        )?;
        if !value["catalog"].is_object()
            || !value["networkAllowed"].is_boolean()
            || !value["networkPreference"].is_boolean()
            || !matches!(
                value["remote"]["outcome"].as_str(),
                Some("available" | "unchanged" | "unavailable")
            )
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(value)
    }
    pub fn set_aifa_network_preference(&self, expected: bool, enabled: bool) -> Result<Value> {
        if self.aifa_source_status(false)?["networkPreference"] != expected {
            return Err(RuntimeError::Conflict);
        }
        let value = if enabled { "enabled" } else { "disabled" };
        let response = self.request(
            Method::PUT,
            &["api", "settings", "aifaNetworkAccess"],
            Some(&json!({"value":value})),
            true,
        )?;
        if response["success"] != true
            || response["key"] != "aifaNetworkAccess"
            || response["value"] != value
        {
            return Err(RuntimeError::Indeterminate);
        }
        let current = self.aifa_source_status(false)?;
        if current["networkPreference"] != enabled {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(current)
    }
    pub fn aifa_download_progress(&self) -> Result<Value> {
        let value = self.request(Method::GET, &["api", "drugs", "update"], None, false)?;
        let p = &value["progress"];
        if !p.is_null()
            && (!p["receivedBytes"].is_u64()
                || (!p["totalBytes"].is_null() && !p["totalBytes"].is_u64())
                || !matches!(p["phase"].as_str(), Some("downloading" | "validating")))
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(value)
    }
    pub fn prepare_reference_file(
        &self,
        catalog: ReferenceCatalog,
        name: &str,
        bytes: &[u8],
        metadata: Value,
    ) -> Result<PreparedReferenceImport> {
        self.headers()?;
        if catalog == ReferenceCatalog::Who
            || bytes.is_empty()
            || bytes.len() as u64 > catalog.file_limit()
            || name.is_empty()
            || name.len() > 255
            || name.chars().any(char::is_control)
        {
            return Err(RuntimeError::InvalidInput);
        }
        let (mut payload, preview, file) = if catalog == ReferenceCatalog::Aifa {
            if !name.to_ascii_lowercase().ends_with(".csv")
                || ["sourceUrl", "downloadedAt", "version"].iter().any(|k| {
                    metadata[k].as_str().is_none_or(|v| {
                        v.trim().is_empty() || v.len() > 2048 || v.chars().any(char::is_control)
                    })
                })
            {
                return Err(RuntimeError::InvalidInput);
            }
            let review = aifa_file_review(
                std::str::from_utf8(bytes).map_err(|_| RuntimeError::InvalidInput)?,
            )?;
            let sample = std::str::from_utf8(bytes)
                .map_err(|_| RuntimeError::InvalidInput)?
                .lines()
                .take(6)
                .map(|s| s.chars().take(500).collect::<String>())
                .collect::<Vec<_>>();
            (
                metadata.clone(),
                json!({"sourceName":name,"bytes":bytes.len(),"metadata":metadata,"sample":sample,"review":review}),
                Some(bytes.to_vec()),
            )
        } else {
            let mut payload = json!({"sourceName":name,"base64":STANDARD.encode(bytes)});
            if catalog == ReferenceCatalog::Prosthetics && !metadata.is_null() {
                payload["options"] = metadata;
            }
            let preview = self.request(
                Method::POST,
                &catalog.path("preview"),
                Some(&payload),
                false,
            )?;
            if !preview["valid"].is_boolean()
                || !preview["manifest"].is_object()
                || !preview["sample"].is_array()
                || !preview["diagnostics"].is_array()
                || (preview["valid"] == true && !preview["proof"].is_string())
            {
                return Err(RuntimeError::InvalidResponse);
            }
            (payload, preview, None)
        };
        self.headers()?;
        let baseline = if catalog == ReferenceCatalog::Aifa {
            {
                let data = self.read_reference_catalog(catalog)?.data;
                let snapshot = data["snapshot"]
                    .as_str()
                    .filter(|s| {
                        s.len() == 64
                            && s.bytes()
                                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                    })
                    .ok_or(RuntimeError::InvalidResponse)?;
                payload["expectedSnapshot"] = json!(snapshot);
                Some(data)
            }
        } else {
            None
        };
        Ok(PreparedReferenceImport {
            owner: Arc::downgrade(&self.owner),
            catalog,
            preview,
            payload,
            file,
            submitted: AtomicBool::new(false),
            baseline,
            cancellation: None,
        })
    }
    pub fn prepare_aifa_update(&self) -> Result<PreparedReferenceImport> {
        self.headers()?;
        Ok(PreparedReferenceImport {
            owner: Arc::downgrade(&self.owner),
            catalog: ReferenceCatalog::Aifa,
            preview: json!({"acquisition":true,"sourceUrl":"https://drive.aifa.gov.it/farmaci/confezioni_fornitura.csv"}),
            payload: json!({}),
            file: None,
            submitted: AtomicBool::new(false),
            baseline: None,
            cancellation: Some(Box::new(self.client.request_context().child())),
        })
    }
    pub fn prepare_who_acquisition(&self) -> Result<PreparedReferenceImport> {
        let preview = self.request(
            Method::POST,
            &ReferenceCatalog::Who.path("preview"),
            Some(&json!({"action":"preview","confirmed":true})),
            true,
        )?;
        if !preview["previewId"].is_string()
            || !preview["expectedRevision"].is_u64()
            || !preview["manifest"].is_object()
        {
            return Err(RuntimeError::Indeterminate);
        }
        self.headers()?;
        Ok(PreparedReferenceImport {
            owner: Arc::downgrade(&self.owner),
            catalog: ReferenceCatalog::Who,
            payload: json!({"action":"activate","confirmed":true,"previewId":preview["previewId"],"expectedRevision":preview["expectedRevision"]}),
            preview,
            file: None,
            submitted: AtomicBool::new(false),
            baseline: None,
            cancellation: None,
        })
    }
    pub fn commit_reference_import(
        &self,
        command: &PreparedReferenceImport,
    ) -> Result<ReferenceImportResult> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) || !command.can_commit() {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.load(Ordering::Acquire) {
            return Err(RuntimeError::ReadRequired);
        }
        if let Some(baseline) = &command.baseline
            && self.read_reference_catalog(command.catalog)?.data != *baseline
        {
            return Ok(ReferenceImportResult::CatalogChanged);
        }
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let value = if command.catalog == ReferenceCatalog::Aifa {
            let raw = if command.file.is_some() {
                let boundary = format!("mediflow-{}", operation_uuid()?);
                let mut body = Vec::new();
                for key in [
                    "sourceUrl",
                    "downloadedAt",
                    "version",
                    "reductionConfirmation",
                    "expectedSnapshot",
                ] {
                    if let Some(value) = command.payload[key].as_str() {
                        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n").as_bytes());
                    }
                }
                body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"catalogo.csv\"\r\nContent-Type: text/csv\r\n\r\n").as_bytes());
                body.extend_from_slice(command.file.as_ref().ok_or(RuntimeError::InvalidInput)?);
                body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
                self.client.aifa_catalog_raw(
                    self.headers()?,
                    Some((format!("multipart/form-data; boundary={boundary}"), body)),
                )?
            } else {
                let mut headers = self.headers()?;
                if let Some(token) = command.payload["reductionConfirmation"].as_str() {
                    headers.insert(
                        "x-mediflow-aifa-confirm-reduction",
                        sensitive_header(token)?,
                    );
                }
                let client = command
                    .cancellation
                    .as_ref()
                    .map(|c| self.client.with_request_context(c.as_ref().clone()))
                    .unwrap_or_else(|| self.client.clone());
                client.dedicated_web_raw(
                    Method::POST,
                    &["api", "drugs", "update"],
                    headers,
                    None,
                    true,
                )?
            };
            let value: Value =
                serde_json::from_slice(&raw.body).map_err(|_| RuntimeError::Indeterminate)?;
            if raw.status == 409
                && command.file.is_some()
                && value["code"] == "AIFA_CATALOG_CHANGED"
            {
                command.submitted.store(false, Ordering::Release);
                return Ok(ReferenceImportResult::CatalogChanged);
            }
            if raw.status == 409 {
                if value["code"] != "AIFA_REDUCTION_CONFIRMATION_REQUIRED"
                    || value["confirmation"].as_str().is_none_or(|v| {
                        v.len() != 129
                            || v.bytes().enumerate().any(|(i, b)| {
                                if i == 64 {
                                    b != b':'
                                } else {
                                    !b.is_ascii_hexdigit() || b.is_ascii_uppercase()
                                }
                            })
                    })
                {
                    return Err(RuntimeError::Conflict);
                }
                let mut payload = command.payload.clone();
                payload["reductionConfirmation"] = value["confirmation"].clone();
                let mut preview = command.preview.clone();
                preview["reduction"] = value;
                self.headers()?;
                return Ok(ReferenceImportResult::Reduction(PreparedReferenceImport {
                    owner: Arc::downgrade(&self.owner),
                    catalog: command.catalog,
                    preview,
                    payload,
                    file: command.file.clone(),
                    submitted: AtomicBool::new(false),
                    baseline: command.baseline.clone(),
                    cancellation: command.cancellation.as_ref().map(|c| Box::new(c.child())),
                }));
            }
            if !value["rejectedRecords"].is_u64() || !value["totalRecords"].is_u64() {
                return Err(RuntimeError::Indeterminate);
            }
            if command.file.is_some()
                && ["count", "rejectedRecords", "totalRecords"]
                    .iter()
                    .any(|key| value[key] != command.preview["review"][key])
            {
                return Err(RuntimeError::Indeterminate);
            }
            status(ReferenceCatalog::Aifa, value).map_err(|_| RuntimeError::Indeterminate)?
        } else {
            let mut payload = command.payload.clone();
            if command.catalog != ReferenceCatalog::Who {
                payload["proof"] = command.preview["proof"].clone();
                payload["acceptSubset"] = json!(true);
            }
            let value = self.request(
                Method::POST,
                &command.catalog.path("commit"),
                Some(&payload),
                true,
            )?;
            if command.catalog == ReferenceCatalog::Who {
                status(ReferenceCatalog::Who, value).map_err(|_| RuntimeError::Indeterminate)?
            } else if value["receipt"]["operationKey"].is_string()
                && value["receipt"]["revision"].is_string()
            {
                value
            } else {
                return Err(RuntimeError::Indeterminate);
            }
        };
        let mut value = value;
        if command.catalog == ReferenceCatalog::Aifa && command.file.is_some() {
            value["review"] = command.preview["review"].clone();
        }
        self.headers()?;
        Ok(ReferenceImportResult::Recorded(value))
    }
}

pub struct PreparedProstheticsDocument {
    owner: Weak<()>,
    payload: Value,
    sha256: String,
    submitted: AtomicBool,
}
impl PreparedProstheticsDocument {
    pub fn review(&self) -> Value {
        json!({"sourceId":self.payload["sourceId"],"revision":self.payload["revision"],"name":self.payload["name"],"sha256":self.sha256,"page":self.payload["page"]})
    }
}
impl LocalHostAccess {
    pub fn read_prosthetics_source_entries(&self, source_id: &str) -> Result<Value> {
        if source_id.is_empty() || source_id.encode_utf16().count() > 1024 {
            return Err(RuntimeError::InvalidInput);
        }
        let raw =
            self.client
                .prosthetics_read(false, &[("sourceId", source_id)], self.headers()?)?;
        let value: Value =
            serde_json::from_slice(&raw.body).map_err(|_| RuntimeError::InvalidResponse)?;
        if !value["revision"].is_string()
            || !value["entries"].is_array()
            || !value["truncated"].is_boolean()
            || value["entries"].as_array().unwrap().iter().any(|r| {
                r["sourceId"] != source_id
                    || !r["code"].is_string()
                    || !r["description"].is_string()
            })
        {
            return Err(RuntimeError::InvalidResponse);
        }
        self.headers()?;
        Ok(value)
    }
    pub fn prepare_prosthetics_document(
        &self,
        source_id: &str,
        revision: &str,
        name: &str,
        bytes: &[u8],
        page: Option<&str>,
    ) -> Result<PreparedProstheticsDocument> {
        self.headers()?;
        if source_id.is_empty()
            || source_id.encode_utf16().count() > 1024
            || !reference_hash(revision)
            || name.is_empty()
            || name.encode_utf16().count() > 200
            || name.chars().any(char::is_control)
            || bytes.is_empty()
            || bytes.len() > 25 * 1024 * 1024
            || page
                .is_some_and(|p| p.encode_utf16().count() > 100 || p.chars().any(char::is_control))
        {
            return Err(RuntimeError::InvalidInput);
        }
        use sha2::{Digest, Sha256};
        Ok(PreparedProstheticsDocument {
            owner: Arc::downgrade(&self.owner),
            payload: json!({"sourceId":source_id,"revision":revision,"name":name,"base64":STANDARD.encode(bytes),"page":page}),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            submitted: AtomicBool::new(false),
        })
    }
    pub fn attach_prosthetics_document(
        &self,
        command: &PreparedProstheticsDocument,
    ) -> Result<Value> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let value = self.request(
            Method::POST,
            &["api", "prosthetics", "catalog", "documents"],
            Some(&command.payload),
            true,
        )?;
        if !value["id"].is_string()
            || value["sourceId"] != command.payload["sourceId"]
            || value["sha256"] != command.sha256
        {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(value)
    }
    pub fn read_prosthetics_original(&self, id: &str, sha256: &str) -> Result<Zeroizing<Vec<u8>>> {
        validate_id(id)?;
        if !reference_hash(sha256) {
            return Err(RuntimeError::InvalidInput);
        }
        let raw = self.client.prosthetics_read(
            true,
            &[("id", id), ("sha256", sha256)],
            self.headers()?,
        )?;
        use sha2::{Digest, Sha256};
        if format!("{:x}", Sha256::digest(&raw.body)) != sha256 {
            return Err(RuntimeError::InvalidResponse);
        }
        self.headers()?;
        Ok(raw.body)
    }
}
fn reference_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aifa_review_truncation_keeps_the_complete_total() {
        let mut csv = String::from(
            "AIC;DENOMINAZIONE;ATC;PRINCIPIO_ATTIVO\n000000001;Inventato;X;Inventato\n",
        );
        csv.push_str(&"bad;Inventato;X;Inventato\n".repeat(201));
        let review = aifa_file_review(&csv).unwrap();
        assert_eq!(review["rejectedRecords"], 201);
        assert_eq!(review["count"], 1);
        assert_eq!(review["diagnosticsTruncated"], true);
        assert_eq!(review["diagnostics"].as_array().unwrap().len(), 200);
    }
}
