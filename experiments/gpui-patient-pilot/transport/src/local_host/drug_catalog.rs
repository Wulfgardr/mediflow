use super::*;

/// Campi del catalogo farmaci da file (ADR 0177), con le etichette del Web.
pub const DRUG_CATALOG_FIELDS: [(&str, &str); 8] = [
    ("codice", "Codice"),
    ("denominazione", "Denominazione"),
    ("principio_attivo", "Principio attivo"),
    ("atc", "ATC"),
    ("forma", "Forma farmaceutica"),
    ("confezione", "Confezione"),
    ("classe_rimborsabilita", "Classe di rimborsabilità"),
    ("titolare", "Titolare"),
];
pub const DRUG_CATALOG_MAX_BYTES: usize = 100 * 1024 * 1024;

/// Esito di una richiesta che il server può rifiutare con un messaggio per chi importa.
#[derive(Debug)]
pub enum DrugCatalogReply<T> {
    Ready(T),
    Refused(String),
}

fn hex64(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    })
}

fn refusal(body: &[u8]) -> Result<String> {
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    value["error"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 500)
        .map(str::to_owned)
        .ok_or(RuntimeError::InvalidResponse)
}

fn multipart(
    fields: &[(&str, String)],
    file_name: &str,
    bytes: &[u8],
) -> Result<(String, Vec<u8>)> {
    Ok(multipart_with(
        &format!("mediflow-{}", operation_uuid()?),
        fields,
        file_name,
        bytes,
    ))
}

fn multipart_with(
    boundary: &str,
    fields: &[(&str, String)],
    file_name: &str,
    bytes: &[u8],
) -> (String, Vec<u8>) {
    let mut body = Vec::with_capacity(bytes.len() + 2048);
    for (key, value) in fields {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: text/csv\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

/// JSON con le chiavi in ordine: gli stessi byte con o senza `preserve_order` di serde_json.
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let items: Vec<String> = keys
                .into_iter()
                .map(|key| format!("{}:{}", Value::String(key.clone()), canonical(&map[key])))
                .collect();
            format!("{{{}}}", items.join(","))
        }
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        other => other.to_string(),
    }
}

fn preview_fields(mapping: Option<&Value>) -> Vec<(&'static str, String)> {
    let mut fields = vec![("mode", "preview".to_owned())];
    if let Some(mapping) = mapping {
        fields.push(("mapping", canonical(mapping)));
    }
    fields
}

fn commit_fields(command: &PreparedDrugCatalogImport) -> Vec<(&'static str, String)> {
    let preview = &command.preview.value;
    let text = |value: &Value| value.as_str().unwrap_or_default().to_owned();
    let mut fields = vec![
        ("mode", "commit".to_owned()),
        ("mapping", canonical(&preview["mapping"])),
        ("source", canonical(&command.source)),
        ("previewSha256", text(&preview["sha256"])),
        ("expectedSnapshot", text(&preview["current"]["snapshot"])),
        ("confirmed", "true".to_owned()),
    ];
    if let Some(token) = &command.reduction {
        fields.push(("reductionConfirmation", token.clone()));
    }
    fields
}

/// Nome del file come lo registra il manifesto: senza percorso, virgolette o caratteri di controllo.
fn upload_name(name: &str) -> Result<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let clean: String = base
        .chars()
        .map(|c| if c == '"' || c.is_control() { '_' } else { c })
        .collect();
    if clean.is_empty() || clean.chars().count() > 200 {
        return Err(RuntimeError::InvalidInput);
    }
    Ok(clean)
}

/// Anteprima del server: senza mappatura propone le colonne, con mappatura conta le righe.
#[derive(Clone, Debug)]
pub struct DrugCatalogPreview {
    value: Value,
    file_name: String,
    bytes: Arc<Vec<u8>>,
}
impl DrugCatalogPreview {
    pub fn data(&self) -> &Value {
        &self.value
    }
    pub fn file_name(&self) -> &str {
        &self.file_name
    }
    pub fn bytes(&self) -> Arc<Vec<u8>> {
        self.bytes.clone()
    }
    pub fn header(&self) -> Vec<String> {
        self.value["header"]
            .as_array()
            .map(|cells| {
                cells
                    .iter()
                    .filter_map(|c| c.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default()
    }
    pub fn mapping(&self) -> &Value {
        &self.value["mapping"]
    }
    pub fn counted(&self) -> bool {
        self.value["counts"].is_object()
    }
    pub fn importable(&self) -> u64 {
        self.value["counts"]["importable"].as_u64().unwrap_or(0)
    }
    pub fn reduction_required(&self) -> bool {
        self.value["reductionRequired"] == true
    }
    pub fn current_count(&self) -> u64 {
        self.value["current"]["count"].as_u64().unwrap_or(0)
    }
}

fn valid_preview(value: &Value) -> bool {
    let header_ok = value["header"]
        .as_array()
        .is_some_and(|h| h.len() >= 2 && h.iter().all(Value::is_string));
    let counts_ok = value["counts"].is_null()
        || ["total", "importable", "rejected", "duplicateCodes"]
            .iter()
            .all(|k| value["counts"][k].is_u64());
    header_ok
        && counts_ok
        && value["mapping"]["columns"].is_object()
        && matches!(
            value["mapping"]["delimiter"].as_str(),
            Some("," | ";" | "\t")
        )
        && value["suggested"].is_boolean()
        && hex64(&value["sha256"])
        && hex64(&value["current"]["snapshot"])
        && value["current"]["count"].is_u64()
        && value["sample"].is_array()
        && value["diagnostics"].is_array()
        && value["reductionRequired"].is_boolean()
}

pub struct PreparedDrugCatalogImport {
    owner: Weak<()>,
    preview: DrugCatalogPreview,
    source: Value,
    reduction: Option<String>,
    submitted: AtomicBool,
}
impl PreparedDrugCatalogImport {
    pub fn preview(&self) -> &DrugCatalogPreview {
        &self.preview
    }
    pub fn source(&self) -> &Value {
        &self.source
    }
    /// Il server ha chiesto di confermare un catalogo molto più piccolo di quello attivo.
    pub fn reduction_confirmed(&self) -> bool {
        self.reduction.is_some()
    }
}

pub enum DrugCatalogCommit {
    /// Catalogo sostituito e riletto: lo stato dell'host con il manifesto importato.
    Recorded(Value),
    /// Il file ha meno del 90% delle voci attive: serve una seconda conferma esplicita.
    Reduction {
        command: PreparedDrugCatalogImport,
        previous: u64,
        next: u64,
    },
    /// Il catalogo o il file sono cambiati dopo l'anteprima: si ripete l'anteprima.
    CatalogChanged(String),
    Refused(String),
}

impl LocalHostAccess {
    pub fn preview_drug_catalog(
        &self,
        name: &str,
        bytes: Arc<Vec<u8>>,
        mapping: Option<&Value>,
    ) -> Result<DrugCatalogReply<DrugCatalogPreview>> {
        if bytes.is_empty() || bytes.len() > DRUG_CATALOG_MAX_BYTES {
            return Err(RuntimeError::InvalidInput);
        }
        let file_name = upload_name(name)?;
        let (content_type, body) = multipart(&preview_fields(mapping), &file_name, &bytes)?;
        let raw =
            self.client
                .drug_catalog_import_raw(self.headers()?, content_type, body, false)?;
        if raw.status == 400 {
            return Ok(DrugCatalogReply::Refused(refusal(&raw.body)?));
        }
        if raw.status != 200 {
            return Err(RuntimeError::InvalidResponse);
        }
        let value: Value =
            serde_json::from_slice(&raw.body).map_err(|_| RuntimeError::InvalidResponse)?;
        if !valid_preview(&value) {
            return Err(RuntimeError::InvalidResponse);
        }
        self.headers()?;
        Ok(DrugCatalogReply::Ready(DrugCatalogPreview {
            value,
            file_name,
            bytes,
        }))
    }

    /// Lega la conferma all'anteprima contata e alla fonte dichiarata; il server riconvalida tutto.
    pub fn prepare_drug_catalog_import(
        &self,
        preview: &DrugCatalogPreview,
        source: Value,
    ) -> Result<PreparedDrugCatalogImport> {
        self.headers()?;
        if !preview.counted() || preview.importable() == 0 || !source.is_object() {
            return Err(RuntimeError::InvalidInput);
        }
        Ok(PreparedDrugCatalogImport {
            owner: Arc::downgrade(&self.owner),
            preview: preview.clone(),
            source,
            reduction: None,
            submitted: AtomicBool::new(false),
        })
    }

    pub fn commit_drug_catalog_import(
        &self,
        command: &PreparedDrugCatalogImport,
    ) -> Result<DrugCatalogCommit> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let preview = &command.preview;
        let (content_type, body) =
            multipart(&commit_fields(command), &preview.file_name, &preview.bytes)?;
        let raw = self
            .client
            .drug_catalog_import_raw(self.headers()?, content_type, body, true)?;
        let value: Value =
            serde_json::from_slice(&raw.body).map_err(|_| RuntimeError::Indeterminate)?;
        match raw.status {
            400 => {
                return Ok(DrugCatalogCommit::Refused(
                    refusal(&raw.body).map_err(|_| RuntimeError::Indeterminate)?,
                ));
            }
            409 if value["code"] == "DRUG_CATALOG_REDUCTION_CONFIRMATION_REQUIRED" => {
                let confirmation = value["confirmation"].as_str().filter(|token| {
                    token.len() == 129
                        && token.bytes().enumerate().all(|(i, b)| {
                            if i == 64 {
                                b == b':'
                            } else {
                                b.is_ascii_hexdigit() && !b.is_ascii_uppercase()
                            }
                        })
                });
                let (Some(token), Some(previous), Some(next)) = (
                    confirmation,
                    value["previousCount"].as_u64(),
                    value["nextCount"].as_u64(),
                ) else {
                    return Err(RuntimeError::Indeterminate);
                };
                if command.reduction.is_some() {
                    return Err(RuntimeError::Conflict);
                }
                self.headers()?;
                return Ok(DrugCatalogCommit::Reduction {
                    command: PreparedDrugCatalogImport {
                        owner: command.owner.clone(),
                        preview: preview.clone(),
                        source: command.source.clone(),
                        reduction: Some(token.to_owned()),
                        submitted: AtomicBool::new(false),
                    },
                    previous,
                    next,
                });
            }
            409 => {
                return Ok(DrugCatalogCommit::CatalogChanged(
                    refusal(&raw.body).unwrap_or_else(|_| {
                        "Il catalogo è cambiato dopo l’anteprima: ripeti l’anteprima.".into()
                    }),
                ));
            }
            200 => {}
            _ => return Err(RuntimeError::Indeterminate),
        }
        let imported = &value["imported"];
        if imported["sha256"] != preview.value["sha256"]
            || imported["rowCount"].as_u64() != Some(preview.importable())
            || value["count"].as_u64() != Some(preview.importable())
        {
            return Err(RuntimeError::Indeterminate);
        }
        // Rilettura dall'host: il catalogo attivo deve avere le voci appena confermate.
        let reread = self.read_reference_catalog(ReferenceCatalog::Aifa)?;
        if reread.data["count"].as_u64() != Some(preview.importable())
            || reread.data["snapshot"] == preview.value["current"]["snapshot"]
        {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(DrugCatalogCommit::Recorded(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/drug-catalog");
    const CSV: &str = "code;name;active_ingredient;atc\nX0001;Farmaco inventato uno;Sostanza inventata;A01AA01\nX0002;Farmaco inventato due;Sostanza seconda;B01AC06\n";
    /// Snapshot del catalogo vuoto: sha256 di `null`, come lo calcola l'host.
    const EMPTY_SNAPSHOT: &str = "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b";

    fn fixture(name: &str, actual: &[u8]) {
        let file = format!("{FIXTURES}/{name}");
        if std::env::var_os("MEDIFLOW_WRITE_FIXTURES").is_some() {
            std::fs::write(&file, actual).unwrap();
        }
        let expected = std::fs::read(&file).unwrap();
        assert!(
            expected == actual,
            "{name} differs from the bytes GPUI sends"
        );
    }

    /// I byte esatti che GPUI invia: `lib/drug-catalog-gpui-contract.test.ts` li passa alla route reale.
    #[test]
    fn multipart_bodies_match_the_contract_fixtures() {
        use sha2::{Digest, Sha256};
        let mapping = json!({"delimiter":";","columns":{"codice":0,"denominazione":1,"principio_attivo":2,"atc":3}});
        let (kind, body) = multipart_with(
            "mediflow-fixture",
            &preview_fields(None),
            "catalogo.csv",
            CSV.as_bytes(),
        );
        assert_eq!(kind, "multipart/form-data; boundary=mediflow-fixture");
        fixture("preview.multipart", &body);
        let preview = DrugCatalogPreview {
            value: json!({"header":["code","name","active_ingredient","atc"],"mapping":mapping,"suggested":false,
                "sha256":format!("{:x}", Sha256::digest(CSV.as_bytes())),"counts":{"total":2,"importable":2,"rejected":0,"duplicateCodes":0},
                "diagnostics":[],"sample":[],"current":{"count":0,"snapshot":EMPTY_SNAPSHOT},"reductionRequired":false}),
            file_name: "catalogo.csv".into(),
            bytes: Arc::new(CSV.as_bytes().to_vec()),
        };
        assert!(valid_preview(&preview.value));
        let command = PreparedDrugCatalogImport {
            owner: Weak::new(),
            preview,
            source: json!({"agency":"Agenzia inventata","codeSystem":"Codice inventato","version":"2026-11","date":"2026-11-01","sourceUrl":"https://agency.example/catalogo.csv"}),
            reduction: None,
            submitted: AtomicBool::new(false),
        };
        let (_, body) = multipart_with(
            "mediflow-fixture",
            &commit_fields(&command),
            "catalogo.csv",
            CSV.as_bytes(),
        );
        fixture("commit.multipart", &body);
    }
    #[test]
    fn canonical_json_sorts_keys_at_every_level() {
        assert_eq!(
            canonical(&json!({"z":{"b":1,"a":[{"d":null,"c":"x"}]},"a":true})),
            r#"{"a":true,"z":{"a":[{"c":"x","d":null}],"b":1}}"#
        );
    }
    #[test]
    fn upload_name_keeps_only_a_plain_file_name() {
        assert_eq!(
            upload_name("/tmp/x/catalogo \"EMA\".csv").unwrap(),
            "catalogo _EMA_.csv"
        );
        assert_eq!(upload_name("C:\\dati\\bdpm.csv").unwrap(), "bdpm.csv");
        assert!(upload_name("/tmp/").is_err());
        assert!(upload_name(&"a".repeat(201)).is_err());
    }
    #[test]
    fn preview_shape_is_checked_before_use() {
        let good = json!({"header":["code","name"],"mapping":{"delimiter":";","columns":{"codice":0,"denominazione":1}},
            "suggested":true,"sha256":"a".repeat(64),"counts":null,"diagnostics":[],"sample":[],
            "current":{"count":0,"snapshot":"b".repeat(64)},"reductionRequired":false});
        assert!(valid_preview(&good));
        for broken in [
            json!({"header":["solo"]}),
            {
                let mut v = good.clone();
                v["sha256"] = json!("A".repeat(64));
                v
            },
            {
                let mut v = good.clone();
                v["mapping"]["delimiter"] = json!("|");
                v
            },
            {
                let mut v = good.clone();
                v["counts"] = json!({"total":1});
                v
            },
        ] {
            assert!(!valid_preview(&broken), "{broken}");
        }
    }
}
