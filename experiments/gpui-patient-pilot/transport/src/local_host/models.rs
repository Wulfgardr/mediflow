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
    reqwest::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && matches!(url.path(), "" | "/" | "/v1" | "/v1/")
    })
}
impl LocalHostAccess {
    fn model_value(&self, key: &str) -> Result<Option<String>> {
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
        for endpoint in [
            "http://localhost:11434",
            "http://127.0.0.1:11434/v1",
            "http://[::1]:11434/v1/",
        ] {
            assert!(valid_endpoint(endpoint));
        }
        for endpoint in [
            "https://example.org",
            "http://192.168.0.1:11434",
            "http://127.0.0.1/path",
            "http://user@localhost",
            "http://localhost/?secret=x",
        ] {
            assert!(!valid_endpoint(endpoint));
        }
        assert_eq!(canonical_model("a:latest"), "a");
        assert_eq!(canonical_model("hf.co/a/b:latest"), "hf.co/a/b");
        assert_ne!(canonical_model("a:7b"), "a");
        assert!(!valid_model("a\nb"));
    }
}
