use super::*;
const KEYS: [&str; 3] = [
    "aiInsightMode",
    "aiInsightManualConfig",
    "documentRouterControlFlow",
];
#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// ```compile_fail
/// use mediflow_runtime_client::InsightBudget;
/// let mut budget = InsightBudget::default();
/// budget.max_documents = 99;
/// ```
pub struct InsightBudget {
    max_documents: u32,
    max_document_summary_chars: u32,
    max_document_context_chars: u32,
    output_max_tokens: u32,
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
    pub fn new(
        max_documents: u32,
        max_document_summary_chars: u32,
        max_document_context_chars: u32,
        output_max_tokens: u32,
    ) -> Result<Self> {
        let budget = Self {
            max_documents,
            max_document_summary_chars,
            max_document_context_chars,
            output_max_tokens,
        };
        if budget.valid() {
            Ok(budget)
        } else {
            Err(RuntimeError::InvalidInput)
        }
    }
    pub fn max_documents(&self) -> u32 {
        self.max_documents
    }
    pub fn max_document_summary_chars(&self) -> u32 {
        self.max_document_summary_chars
    }
    pub fn max_document_context_chars(&self) -> u32 {
        self.max_document_context_chars
    }
    pub fn output_max_tokens(&self) -> u32 {
        self.output_max_tokens
    }

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
    fn valid(&self) -> bool {
        (2..=12).contains(&self.max_documents)
            && (120..=480).contains(&self.max_document_summary_chars)
            && (800..=5000).contains(&self.max_document_context_chars)
            && (256..=1200).contains(&self.output_max_tokens)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InsightMode {
    FullAuto,
    Balanced,
    Complete,
    Manual,
}
impl InsightMode {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "full_auto" => Some(Self::FullAuto),
            "balanced" => Some(Self::Balanced),
            "complete" => Some(Self::Complete),
            "manual" => Some(Self::Manual),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FullAuto => "full_auto",
            Self::Balanced => "balanced",
            Self::Complete => "complete",
            Self::Manual => "manual",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InsightRouter {
    Off,
    Shadow,
    Active,
}
impl InsightRouter {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "shadow" => Some(Self::Shadow),
            "active" => Some(Self::Active),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Shadow => "shadow",
            Self::Active => "active",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InsightParameters {
    mode: InsightMode,
    budget: InsightBudget,
    router: InsightRouter,
    values: Vec<Option<String>>,
}
impl InsightParameters {
    pub fn mode(&self) -> InsightMode {
        self.mode
    }
    pub fn router(&self) -> InsightRouter {
        self.router
    }
    pub fn budget(&self) -> &InsightBudget {
        &self.budget
    }
}
/// ```compile_fail
/// use mediflow_runtime_client::{PreparedInsightParameters, InsightMode};
/// fn change(command: &mut PreparedInsightParameters) {
///     command.mode = InsightMode::Manual;
/// }
/// ```
pub struct PreparedInsightParameters {
    owner: Weak<()>,
    before: InsightParameters,
    mode: InsightMode,
    budget: InsightBudget,
    router: InsightRouter,
    submitted: AtomicBool,
}
impl PreparedInsightParameters {
    pub fn mode(&self) -> InsightMode {
        self.mode
    }
    pub fn router(&self) -> InsightRouter {
        self.router
    }
    pub fn budget(&self) -> &InsightBudget {
        &self.budget
    }

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
            .and_then(InsightMode::parse)
            .unwrap_or(InsightMode::FullAuto);
        let budget = InsightBudget::from_stored(values[1].as_deref());
        let router = values[2]
            .as_deref()
            .and_then(InsightRouter::parse)
            .unwrap_or(InsightRouter::Shadow);
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
        let mode = InsightMode::parse(mode).ok_or(RuntimeError::InvalidInput)?;
        let router = InsightRouter::parse(router).ok_or(RuntimeError::InvalidInput)?;
        if self.read_insight_parameters()? != *before {
            return Err(RuntimeError::Conflict);
        }
        Ok(PreparedInsightParameters {
            owner: Arc::downgrade(&self.owner),
            before: before.clone(),
            mode,
            budget,
            router,
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
        for (key, value) in
            KEYS.iter()
                .zip([command.mode.as_str(), &budget, command.router.as_str()])
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
        for (docs, expected) in [(1, false), (2, true), (12, true), (13, false)] {
            assert_eq!(InsightBudget::new(docs, 260, 2200, 512).is_ok(), expected);
        }
        for (summary, context, tokens) in [
            (119, 2200, 512),
            (481, 2200, 512),
            (260, 799, 512),
            (260, 5001, 512),
            (260, 2200, 255),
            (260, 2200, 1201),
        ] {
            assert!(InsightBudget::new(6, summary, context, tokens).is_err());
        }
        assert!(InsightBudget::new(2, 120, 800, 256).is_ok());
        assert!(InsightBudget::new(12, 480, 5000, 1200).is_ok());
        assert!(InsightMode::parse("provider").is_none());
        assert!(InsightRouter::parse("automatic").is_none());
    }
}
