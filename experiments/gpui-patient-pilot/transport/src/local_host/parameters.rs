use super::*;
const KEYS: [&str; 3] = [
    "aiInsightMode",
    "aiInsightManualConfig",
    "documentRouterControlFlow",
];
#[derive(Clone, Deserialize, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InsightBudget {
    pub max_documents: u32,
    pub max_document_summary_chars: u32,
    pub max_document_context_chars: u32,
    pub output_max_tokens: u32,
}
impl Default for InsightBudget {
    fn default() -> Self {
        Self {
            max_documents: 6,
            max_document_summary_chars: 260,
            max_document_context_chars: 2200,
            output_max_tokens: 512,
        }
    }
}
impl InsightBudget {
    fn from_stored(value: Option<&str>) -> Self {
        let value: Value = value
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or(Value::Null);
        fn bounded(value: &Value, default: u32, min: u32, max: u32) -> u32 {
            let number = value.as_f64().or_else(|| {
                value.as_str().and_then(|v| {
                    let v = v.trim_start();
                    let length = v
                        .char_indices()
                        .take_while(|(i, c)| {
                            c.is_ascii_digit() || (*i == 0 && matches!(c, '+' | '-'))
                        })
                        .map(|(i, c)| i + c.len_utf8())
                        .last()?;
                    v[..length].parse::<f64>().ok()
                })
            });
            number
                .filter(|n| n.is_finite())
                .map(|n| n.round().clamp(min as f64, max as f64) as u32)
                .unwrap_or(default)
        }
        Self {
            max_documents: bounded(&value["maxDocuments"], 6, 2, 12),
            max_document_summary_chars: bounded(&value["maxDocumentSummaryChars"], 260, 120, 480),
            max_document_context_chars: bounded(&value["maxDocumentContextChars"], 2200, 800, 5000),
            output_max_tokens: bounded(&value["outputMaxTokens"], 512, 256, 1200),
        }
    }
    pub fn valid(&self) -> bool {
        (2..=12).contains(&self.max_documents)
            && (120..=480).contains(&self.max_document_summary_chars)
            && (800..=5000).contains(&self.max_document_context_chars)
            && (256..=1200).contains(&self.output_max_tokens)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InsightParameters {
    pub mode: String,
    pub budget: InsightBudget,
    pub router: String,
    values: Vec<Option<String>>,
}
pub struct PreparedInsightParameters {
    owner: Weak<()>,
    before: InsightParameters,
    pub mode: String,
    pub budget: InsightBudget,
    pub router: String,
    submitted: AtomicBool,
}
impl PreparedInsightParameters {
    pub fn description(&self) -> String {
        let mode = match self.mode.as_str() {
            "balanced" => "Rapida",
            "complete" => "Approfondita",
            "manual" => "Personalizzata",
            _ => "Automatica",
        };
        let router = match self.router.as_str() {
            "shadow" => "Osservazione",
            "active" => "Attivo",
            _ => "Spento",
        };
        format!(
            "Salvare i parametri? Modalità: {mode}; documenti: {}; caratteri per documento: {}; contesto: {}; token: {}; instradamento: {router}.",
            self.budget.max_documents,
            self.budget.max_document_summary_chars,
            self.budget.max_document_context_chars,
            self.budget.output_max_tokens
        )
    }
}
impl LocalHostAccess {
    pub fn read_insight_parameters(&self) -> Result<InsightParameters> {
        let values = KEYS
            .iter()
            .map(|key| self.model_value(key))
            .collect::<Result<Vec<_>>>()?;
        let mode = values[0]
            .as_deref()
            .filter(|v| valid_mode(v))
            .unwrap_or("full_auto")
            .into();
        let budget = InsightBudget::from_stored(values[1].as_deref());
        let router = router_mode(values[2].as_deref()).into();
        Ok(InsightParameters {
            mode,
            budget,
            router,
            values,
        })
    }
    pub fn prepare_insight_parameters(
        &self,
        before: &InsightParameters,
        mode: &str,
        budget: InsightBudget,
        router: &str,
    ) -> Result<PreparedInsightParameters> {
        if !valid_mode(mode) || !budget.valid() || !valid_router(router) {
            return Err(RuntimeError::InvalidInput);
        }
        if self.read_insight_parameters()? != *before {
            return Err(RuntimeError::Conflict);
        }
        Ok(PreparedInsightParameters {
            owner: Arc::downgrade(&self.owner),
            before: before.clone(),
            mode: mode.into(),
            budget,
            router: router.into(),
            submitted: AtomicBool::new(false),
        })
    }
    pub fn apply_insight_parameters(&self, command: &PreparedInsightParameters) -> Result<bool> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        if self.read_insight_parameters()? != command.before {
            return Err(RuntimeError::Conflict);
        }
        let budget =
            serde_json::to_string(&command.budget).map_err(|_| RuntimeError::InvalidInput)?;
        for (key, value) in KEYS
            .iter()
            .zip([command.mode.as_str(), &budget, &command.router])
        {
            let row = self.request(
                Method::PUT,
                &["api", "settings", key],
                Some(&json!({"value":value})),
                true,
            )?;
            if row["success"] != true || row["key"] != *key || row["value"] != value {
                return Err(RuntimeError::Indeterminate);
            }
            if self.model_value(key)?.as_deref() != Some(value) {
                return Err(RuntimeError::Indeterminate);
            }
        }
        let observed = self.read_insight_parameters()?;
        Ok(observed.mode == command.mode
            && observed.budget == command.budget
            && observed.router == command.router)
    }
}
fn valid_mode(value: &str) -> bool {
    matches!(value, "full_auto" | "balanced" | "complete" | "manual")
}
fn router_mode(value: Option<&str>) -> &str {
    value
        .filter(|value| valid_router(value))
        .unwrap_or("shadow")
}
fn valid_router(value: &str) -> bool {
    matches!(value, "off" | "shadow" | "active")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn insight_limits_and_modes_match_web() {
        assert!(InsightBudget::default().valid());
        assert_eq!(
            InsightBudget::from_stored(Some(
                r#"{"maxDocuments":99,"maxDocumentSummaryChars":"120px","maxDocumentContextChars":900.6,"outputMaxTokens":null}"#
            )),
            InsightBudget {
                max_documents: 12,
                max_document_summary_chars: 120,
                max_document_context_chars: 901,
                output_max_tokens: 512
            }
        );
        let mut budget = InsightBudget::default();
        for (docs, expected) in [(1, false), (2, true), (12, true), (13, false)] {
            budget.max_documents = docs;
            assert_eq!(budget.valid(), expected);
        }
        assert!(!valid_mode("provider"));
        assert!(!valid_router("automatic"));
        assert_eq!(router_mode(None), "shadow");
        assert_eq!(router_mode(Some("invalid")), "shadow");
        assert_eq!(router_mode(Some("active")), "active");
    }
}
