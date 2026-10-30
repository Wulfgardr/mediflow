use super::*;

const MODEL_KEYS: [&str; 8] = [
    "hardwareProfile",
    "aiProvider",
    "aiModel_clinical",
    "aiModel_reasoning",
    "aiModel",
    "aiUrl",
    "ollamaUrl",
    "aiModelDefaultVersion",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalModelConfiguration {
    pub endpoint: String,
    pub clinical: String,
    pub reasoning: String,
    pub hardware: HardwareProfile,
    values: Vec<Option<String>>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HardwareProfile {
    Low,
    Medium,
    High,
    Custom,
}
impl HardwareProfile {
    pub fn wire(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Custom => "custom",
        }
    }
    pub fn recommended_model(self) -> Option<&'static str> {
        match self {
            Self::Low => Some("qwen2.5:7b"),
            Self::Medium => Some("qwen2.5:14b"),
            Self::High => Some("qwen3.5:35b-a3b"),
            Self::Custom => None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledLocalModel {
    pub name: String,
    pub size: Option<u64>,
}
pub struct PreparedLocalModels {
    owner: Weak<()>,
    before: LocalModelConfiguration,
    endpoint: String,
    clinical: String,
    reasoning: String,
    hardware: HardwareProfile,
    submitted: AtomicBool,
}
impl PreparedLocalModels {
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
    pub fn clinical(&self) -> &str {
        &self.clinical
    }
    pub fn reasoning(&self) -> &str {
        &self.reasoning
    }
    pub fn hardware(&self) -> HardwareProfile {
        self.hardware
    }
}
fn valid_model(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !value.chars().any(|c| c.is_whitespace() || c.is_control())
}
fn valid_endpoint(value: &str) -> bool {
    let normalized = ["/v1/", "/v1", "/v/", "/v"]
        .iter()
        .find_map(|suffix| value.strip_suffix(suffix))
        .unwrap_or(value);
    let normalized = normalized.strip_suffix('/').unwrap_or(normalized);
    reqwest::Url::parse(normalized).is_ok_and(|url| {
        url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
            && url.username().is_empty()
            && url.password().is_none()
            && matches!(
                url.path().strip_suffix('/').unwrap_or(url.path()),
                "" | "/api/chat" | "/api/generate" | "/api/tags" | "/api/show" | "/api/pull"
            )
    })
}
impl LocalHostAccess {
    pub(super) fn model_value(&self, key: &str) -> Result<Option<String>> {
        let row = self.request(Method::GET, &["api", "settings", key], None, false)?;
        if row["key"] != key {
            return Err(RuntimeError::InvalidResponse);
        }
        match &row["value"] {
            Value::Null => Ok(None),
            Value::String(v) if v.len() <= 2048 => Ok(Some(v.clone())),
            _ => Err(RuntimeError::InvalidResponse),
        }
    }
    pub fn read_local_model_configuration(&self) -> Result<LocalModelConfiguration> {
        let values = MODEL_KEYS
            .iter()
            .map(|key| self.model_value(key))
            .collect::<Result<Vec<_>>>()?;
        let model = |index: usize| {
            values[index]
                .clone()
                .filter(|v| !v.is_empty())
                .or_else(|| values[4].clone())
                .unwrap_or_else(|| "qwen3.5:35b-a3b".into())
        };
        let hardware = match values[0].as_deref() {
            Some("low") => HardwareProfile::Low,
            Some("medium") => HardwareProfile::Medium,
            Some("high") => HardwareProfile::High,
            _ => HardwareProfile::Custom,
        };
        Ok(LocalModelConfiguration {
            endpoint: values[5]
                .clone()
                .filter(|v| !v.is_empty())
                .or_else(|| values[6].clone())
                .filter(|v| !v.is_empty() && !v.contains(":8080"))
                .unwrap_or_else(|| "http://127.0.0.1:11434/v1".into()),
            clinical: model(2),
            reasoning: model(3),
            hardware,
            values,
        })
    }
    pub fn installed_local_models(&self, endpoint: &str) -> Result<Vec<InstalledLocalModel>> {
        if !valid_endpoint(endpoint) {
            return Err(RuntimeError::InvalidInput);
        }
        let mut headers = self.headers()?;
        headers.insert("x-target-url", sensitive_header(endpoint)?);
        let response = self.client.dedicated_web_raw(
            Method::GET,
            &["api", "ai", "models"],
            headers,
            None,
            false,
        )?;
        let value: Value =
            serde_json::from_slice(&response.body).map_err(|_| RuntimeError::InvalidResponse)?;
        let models = value["models"]
            .as_array()
            .filter(|models| models.len() <= 1024)
            .ok_or(RuntimeError::InvalidResponse)?;
        let mut rows = Vec::new();
        for model in models {
            let name = model["name"]
                .as_str()
                .filter(|v| valid_model(v))
                .ok_or(RuntimeError::InvalidResponse)?;
            let size = if model["size"].is_null() {
                None
            } else {
                Some(
                    model["size"]
                        .as_u64()
                        .filter(|v| *v <= crate::MAX_SAFE_VERSION)
                        .ok_or(RuntimeError::InvalidResponse)?,
                )
            };
            if !rows.iter().any(|row: &InstalledLocalModel| {
                canonical_model(&row.name) == canonical_model(name)
            }) {
                rows.push(InstalledLocalModel {
                    name: name.into(),
                    size,
                });
            }
        }
        self.headers()?;
        Ok(rows)
    }
    pub fn prepare_local_models(
        &self,
        before: &LocalModelConfiguration,
        endpoint: &str,
        clinical: &str,
        reasoning: &str,
        hardware: HardwareProfile,
    ) -> Result<PreparedLocalModels> {
        if !valid_endpoint(endpoint) || !valid_model(clinical) || !valid_model(reasoning) {
            return Err(RuntimeError::InvalidInput);
        }
        if self.read_local_model_configuration()? != *before {
            return Err(RuntimeError::Conflict);
        }
        Ok(PreparedLocalModels {
            owner: Arc::downgrade(&self.owner),
            before: before.clone(),
            endpoint: endpoint.into(),
            clinical: clinical.into(),
            reasoning: reasoning.into(),
            hardware,
            submitted: AtomicBool::new(false),
        })
    }
    pub fn apply_local_models(&self, command: &PreparedLocalModels) -> Result<bool> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        if self.read_local_model_configuration()? != command.before {
            return Err(RuntimeError::Conflict);
        }
        let values = [
            command.hardware.wire(),
            "ollama",
            &command.clinical,
            &command.reasoning,
            &command.clinical,
            &command.endpoint,
            &command.endpoint,
        ];
        for (key, value) in MODEL_KEYS.iter().zip(values) {
            let result = self.request(
                Method::PUT,
                &["api", "settings", key],
                Some(&json!({"value":value})),
                true,
            )?;
            if result["success"] != true || result["key"] != *key || result["value"] != value {
                return Err(RuntimeError::Indeterminate);
            }
        }
        let observed = self.read_local_model_configuration()?;
        Ok(observed
            .values
            .iter()
            .take(7)
            .zip(values)
            .all(|(a, b)| a.as_deref() == Some(b)))
    }
}
fn canonical_model(value: &str) -> &str {
    let leaf = value.rsplit('/').next().unwrap_or(value);
    if leaf.matches(':').count() == 1 {
        value.strip_suffix(":latest").unwrap_or(value)
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_names_and_endpoints_follow_web_locality() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../../comparison/ollama-endpoint-cases.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let endpoint = case["endpoint"].as_str().unwrap();
            assert_eq!(
                valid_endpoint(endpoint),
                case["accepted"].as_bool().unwrap(),
                "{endpoint}"
            );
        }
        assert_eq!(canonical_model("a:latest"), "a");
        assert_eq!(canonical_model("hf.co/a/b:latest"), "hf.co/a/b");
        assert_ne!(canonical_model("a:7b"), "a");
        assert!(!valid_model("a\nb"));
    }
}

#[cfg(test)]
mod review738_endpoint_probe {
    use super::*;
    #[test]
    fn review738_reject_endpoint_disallowed_by_web() {
        assert!(
            !valid_endpoint("http://[::1]:11434/v1/"),
            "the Web strictOllamaLoopbackBaseUrl rejects IPv6; native must not accept and persist it"
        );
    }
}

#[derive(Clone, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalProviderStatus {
    pub provider: String,
    pub credential_class: String,
    pub model: Option<String>,
    pub state: String,
    pub revision: String,
    pub version: u64,
    pub receipt: Option<String>,
    pub can_activate: bool,
    pub inference: String,
    pub qualification: String,
}
impl LocalProviderStatus {
    fn parse(value: Value) -> Result<Self> {
        let status: Self =
            serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
        if status.provider != "ollama"
            || status.credential_class != "local_model"
            || status.inference != "not_run"
            || status.qualification != "not_assessed"
            || status.revision.len() != 64
            || !status.revision.bytes().all(|c| c.is_ascii_hexdigit())
            || status.model.as_ref().is_some_and(|m| !valid_model(m))
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(status)
    }
    pub fn description(&self) -> &'static str {
        match self.state.as_str() {
            "missing" => "Collegamento locale da attivare.",
            "available_unqualified" => {
                "Collegamento locale attivo. Le funzioni mantengono le proprie abilitazioni e verifiche."
            }
            "degraded" => {
                "Collegamento da recuperare: controlla Ollama, poi avvia una nuova verifica."
            }
            "revoked" => {
                "Collegamento revocato. Questa pagina non può riattivarlo: rivolgiti all’operatore del computer."
            }
            "configuration_missing" => {
                "Scegli un modello Ollama già installato e salva la configurazione."
            }
            "locality_denied" => "Collegamento non ammesso. Usa Ollama locale sulla porta 11434.",
            _ => "Stato non disponibile. Rivolgiti all’operatore del computer.",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalProviderOutcome {
    Confirmed(LocalProviderStatus),
    Denied(String),
}
impl LocalHostAccess {
    pub fn read_local_provider(&self) -> Result<LocalProviderStatus> {
        let value = self.request(
            Method::GET,
            &["api", "ai", "local-provider", "onboarding"],
            None,
            false,
        )?;
        self.headers()?;
        LocalProviderStatus::parse(value)
    }
    pub fn activate_local_provider(
        &self,
        before: &LocalProviderStatus,
    ) -> Result<LocalProviderOutcome> {
        if !before.can_activate {
            return Err(RuntimeError::Forbidden);
        }
        let response = self.client.dedicated_web_raw(
            Method::POST,
            &["api", "ai", "local-provider", "onboarding"],
            self.headers()?,
            Some(&json!({"intent":"verify_and_activate", "expectedRevision":before.revision})),
            true,
        )?;
        self.headers()?;
        let value: Value =
            serde_json::from_slice(&response.body).map_err(|_| RuntimeError::Indeterminate)?;
        if response.status != 200 {
            return Ok(LocalProviderOutcome::Denied(provider_denial(&value)));
        }
        let written = LocalProviderStatus::parse(value)?;
        let observed = self.read_local_provider()?;
        if written != observed || observed.state != "available_unqualified" {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(LocalProviderOutcome::Confirmed(observed))
    }
}
fn provider_denial(value: &Value) -> String {
    match value["error"].as_str() {
        Some("provider_version_unsupported") => {
            let mismatch = &value["versionMismatch"];
            match (mismatch["serverVersion"].as_str(), mismatch["supportedVersions"].as_str()) {
                (Some(found), Some(supported)) if found.len() <= 128 && supported.len() <= 512 =>
                    format!("Versione di Ollama trovata: {found}. Versioni ammesse: {supported}. Aggiorna MediFlow o installa una versione di Ollama ammessa."),
                _ => "Versione di Ollama non ammessa. Aggiorna MediFlow o installa una versione ammessa.".into(),
            }
        }
        Some("provider_unreachable") => "Ollama non è raggiungibile. Apri Ollama e rileggi lo stato.".into(),
        Some("provider_unready") => "Ollama è raggiungibile ma il modello non è pronto. Controlla il modello installato e rileggi lo stato.".into(),
        Some("configuration_changed") => "La configurazione o lo stato sono cambiati. Rileggi prima di una nuova verifica.".into(),
        Some("verification_interrupted") => "Verifica interrotta. Rileggi lo stato prima di una nuova conferma.".into(),
        Some("revoked") => "Collegamento revocato. Questa pagina non può riattivarlo.".into(),
        _ => "Verifica non riuscita. Rileggi lo stato prima di una nuova conferma.".into(),
    }
}
