//! Consumer of the existing native function-preferences v1 contract. These
//! projections and commands convey no grant, execution authority or endpoint.

use crate::{Result, RuntimeError};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;

pub(crate) const AI_PREFERENCES_PATH: &[&str] = &["api", "v1", "network", "ai", "functions"];
pub(crate) const AI_PREVIEW_PATH: &[&str] = &["api", "v1", "network", "ai", "functions", "preview"];
pub(crate) const AI_PREFERENCES_LIMIT: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiFunctionId {
    PatientInsight,
    SmartImport,
    DocumentSynthesis,
    TreatmentReasoning,
}
impl AiFunctionId {
    pub const ALL: [Self; 4] = [
        Self::PatientInsight,
        Self::SmartImport,
        Self::DocumentSynthesis,
        Self::TreatmentReasoning,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PatientInsight => "patient_insight",
            Self::SmartImport => "smart_import",
            Self::DocumentSynthesis => "document_synthesis",
            Self::TreatmentReasoning => "treatment_reasoning",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiModelProvider {
    Ollama,
    AthenaMlx,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiModelState {
    AvailableUnqualified,
    Unavailable,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiDefaultSource {
    SavedPreference,
    HostConfiguration,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiBindingState {
    Current,
    Stale,
    Unsupported,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiPreferencePreset {
    HostDefaults,
    AllOff,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiModelOption {
    pub model_option_id: String,
    pub label: String,
    pub provider: AiModelProvider,
    pub state: AiModelState,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiFunctionPreference {
    pub id: AiFunctionId,
    pub enabled: bool,
    pub default_model_option_id: Option<String>,
    pub default_source: AiDefaultSource,
    pub binding_state: AiBindingState,
    pub options: Vec<AiModelOption>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiFunctionPreferences {
    pub schema_version: String,
    pub revision: String,
    pub catalog_revision: String,
    pub check: String,
    pub functions: Vec<AiFunctionPreference>,
    pub presets: Vec<AiPreferencePreset>,
    pub apply: String,
}
impl AiFunctionPreferences {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != "mediflow.function-preferences.v1"
            || self.check != "configuration_only"
            || self.apply != "denied"
            || !digest(&self.revision)
            || !digest(&self.catalog_revision)
            || self.functions.len() != 4
            || self
                .functions
                .iter()
                .map(|row| row.id)
                .collect::<HashSet<_>>()
                .len()
                != 4
            || self.presets.len() != 2
            || !self.presets.contains(&AiPreferencePreset::HostDefaults)
            || !self.presets.contains(&AiPreferencePreset::AllOff)
        {
            return Err(RuntimeError::InvalidResponse);
        }
        for row in &self.functions {
            if row
                .default_model_option_id
                .as_ref()
                .is_some_and(|id| !model_option(id))
                || row
                    .options
                    .iter()
                    .map(|option| &option.model_option_id)
                    .collect::<HashSet<_>>()
                    .len()
                    != row.options.len()
                || row.options.iter().any(|option| {
                    !model_option(&option.model_option_id)
                        || option.label.trim().is_empty()
                        || option.label.chars().any(char::is_control)
                })
                || (row.binding_state == AiBindingState::Current
                    && !row.options.iter().any(|option| {
                        Some(&option.model_option_id) == row.default_model_option_id.as_ref()
                    }))
            {
                return Err(RuntimeError::InvalidResponse);
            }
        }
        Ok(())
    }
    pub fn function(&self, id: AiFunctionId) -> Option<&AiFunctionPreference> {
        self.functions.iter().find(|row| row.id == id)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AiPreferenceChange {
    Set {
        #[serde(rename = "functionId")]
        function_id: AiFunctionId,
        enabled: bool,
        // Explicit null restores the host default; omission is not the contract.
        #[serde(rename = "defaultModelOptionId")]
        default_model_option_id: Option<String>,
    },
    Preset {
        #[serde(rename = "presetId")]
        preset_id: AiPreferencePreset,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPreferencesCommand {
    schema_version: &'static str,
    command_id: String,
    expected_revision: String,
    expected_catalog_revision: String,
    #[serde(flatten)]
    change: AiPreferenceChange,
}
impl AiPreferencesCommand {
    pub fn new(snapshot: &AiFunctionPreferences, change: AiPreferenceChange) -> Result<Self> {
        snapshot.validate()?;
        if let AiPreferenceChange::Set {
            function_id,
            default_model_option_id: Some(option),
            ..
        } = &change
        {
            let row = snapshot
                .function(*function_id)
                .ok_or(RuntimeError::InvalidInput)?;
            // Retain an absent saved choice so the host can admit a safe switch
            // off. Never silently substitute a different/default model.
            if !model_option(option)
                || !(row.default_model_option_id.as_ref() == Some(option)
                    || row
                        .options
                        .iter()
                        .any(|value| value.model_option_id == *option))
            {
                return Err(RuntimeError::InvalidInput);
            }
        }
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).map_err(|_| RuntimeError::Transport)?;
        let command_id = format!(
            "gpui_{}",
            bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
        );
        Ok(Self {
            schema_version: "mediflow.function-preferences-command.v1",
            command_id,
            expected_revision: snapshot.revision.clone(),
            expected_catalog_revision: snapshot.catalog_revision.clone(),
            change,
        })
    }
    pub(crate) fn wire(&self) -> Result<Value> {
        serde_json::to_value(self).map_err(|_| RuntimeError::InvalidInput)
    }
}

/// Produced only after the host echoes the exact reviewed command, reports no
/// preview writes, and returns the same catalog revision. Not a host grant.
#[derive(Clone, Debug)]
pub struct AiPreferencesPreview {
    pub proposed: AiFunctionPreferences,
    command: AiPreferencesCommand,
}
impl AiPreferencesPreview {
    pub fn command(&self) -> &AiPreferencesCommand {
        &self.command
    }
}

pub struct AiPreferencesReadback {
    pub observed: AiFunctionPreferences,
    /// Full configuration equality as well as both host revisions. This does
    /// not claim the settings cannot change after the response was received.
    pub matches_confirmation: bool,
}

pub(crate) fn parse_preferences(value: Value) -> Result<AiFunctionPreferences> {
    let preferences: AiFunctionPreferences =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    preferences.validate()?;
    Ok(preferences)
}
pub(crate) fn parse_preferences_preview(
    value: Value,
    command: &AiPreferencesCommand,
) -> Result<AiPreferencesPreview> {
    if value["schemaVersion"] != "mediflow.function-preferences-preview.v1"
        || value["writesPerformed"] != json!(0)
        || value["command"] != command.wire()?
    {
        return Err(RuntimeError::InvalidResponse);
    }
    let proposed = parse_preferences(value["proposed"].clone())?;
    if proposed.catalog_revision != command.expected_catalog_revision {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(AiPreferencesPreview {
        proposed,
        command: command.clone(),
    })
}
fn digest(value: &str) -> bool {
    prefixed_hex(value, "sha256_", 64)
}
fn model_option(value: &str) -> bool {
    prefixed_hex(value, "model_option_", 32)
}
fn prefixed_hex(value: &str, prefix: &str, length: usize) -> bool {
    value.strip_prefix(prefix).is_some_and(|hex| {
        hex.len() == length
            && hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub(crate) fn preferences_wire() -> Value {
        json!({"schemaVersion":"mediflow.function-preferences.v1", "revision":format!("sha256_{}", "a".repeat(64)),
            "catalogRevision":format!("sha256_{}", "b".repeat(64)), "check":"configuration_only", "apply":"denied",
            "presets":["host_defaults", "all_off"], "functions":AiFunctionId::ALL.map(|id| json!({
                "id":id, "enabled":id == AiFunctionId::PatientInsight,
                "defaultModelOptionId":format!("model_option_{}", "c".repeat(32)), "defaultSource":"host_configuration",
                "bindingState":"current", "options":[{"modelOptionId":format!("model_option_{}", "c".repeat(32)),
                    "label":"Modello sintetico", "provider":"ollama", "state":"unavailable"}]}))})
    }
    pub(crate) fn preview_wire(command: &AiPreferencesCommand) -> Value {
        let mut proposed = preferences_wire();
        proposed["revision"] = json!(format!("sha256_{}", "d".repeat(64)));
        for row in proposed["functions"].as_array_mut().unwrap() {
            row["enabled"] = json!(false);
        }
        json!({"schemaVersion":"mediflow.function-preferences-preview.v1", "command":command.wire().unwrap(),
            "proposed":proposed, "writesPerformed":0})
    }
    #[test]
    fn ai_preferences_contract_preserves_stale_choices_and_rejects_unknown_authority() {
        let mut wire = preferences_wire();
        wire["functions"][0]["defaultSource"] = json!("saved_preference");
        wire["functions"][0]["bindingState"] = json!("stale");
        wire["functions"][0]["defaultModelOptionId"] =
            json!(format!("model_option_{}", "e".repeat(32)));
        let view = parse_preferences(wire.clone()).unwrap();
        let row = &view.functions[0];
        let command = AiPreferencesCommand::new(
            &view,
            AiPreferenceChange::Set {
                function_id: row.id,
                enabled: false,
                default_model_option_id: row.default_model_option_id.clone(),
            },
        )
        .unwrap();
        assert_eq!(
            command.wire().unwrap()["defaultModelOptionId"],
            wire["functions"][0]["defaultModelOptionId"]
        );
        let restore = AiPreferencesCommand::new(
            &view,
            AiPreferenceChange::Set {
                function_id: row.id,
                enabled: false,
                default_model_option_id: None,
            },
        )
        .unwrap()
        .wire()
        .unwrap();
        assert_eq!(restore.get("defaultModelOptionId"), Some(&Value::Null));
        assert!(restore.get("presetId").is_none() && restore.get("provider").is_none());
        for (pointer, value) in [
            ("/schemaVersion", json!("mediflow.function-preferences.v2")),
            ("/apply", json!("allowed")),
            ("/check", json!("inference_ready")),
            (
                "/functions/0/options/0/provider",
                json!("athena_transformers"),
            ),
            ("/functions/0/id", json!("new_function")),
            ("/functions/1/id", json!("patient_insight")),
            (
                "/functions/0/defaultModelOptionId",
                json!("untrusted-option"),
            ),
            ("/functions/0/bindingState", json!("current")),
        ] {
            let mut invalid = wire.clone();
            *invalid.pointer_mut(pointer).unwrap() = value;
            assert!(
                matches!(
                    parse_preferences(invalid),
                    Err(RuntimeError::InvalidResponse)
                ),
                "{pointer}"
            );
        }
    }
    #[test]
    fn ai_preferences_preview_binds_exact_command_catalog_and_zero_writes() {
        let view = parse_preferences(preferences_wire()).unwrap();
        let command = AiPreferencesCommand::new(
            &view,
            AiPreferenceChange::Preset {
                preset_id: AiPreferencePreset::AllOff,
            },
        )
        .unwrap();
        let preview = preview_wire(&command);
        assert_eq!(
            parse_preferences_preview(preview.clone(), &command)
                .unwrap()
                .command(),
            &command
        );
        for (pointer, replacement) in [
            ("/writesPerformed", json!(1)),
            ("/command/presetId", json!("host_defaults")),
            ("/command/commandId", json!("different-command-0001")),
            (
                "/command/expectedRevision",
                json!(format!("sha256_{}", "f".repeat(64))),
            ),
            (
                "/proposed/catalogRevision",
                json!(format!("sha256_{}", "f".repeat(64))),
            ),
        ] {
            let mut invalid = preview.clone();
            *invalid.pointer_mut(pointer).unwrap() = replacement;
            assert!(
                matches!(
                    parse_preferences_preview(invalid, &command),
                    Err(RuntimeError::InvalidResponse)
                ),
                "{pointer}"
            );
        }
        let mut extra = preview;
        extra["command"]["endpoint"] = json!("http://127.0.0.1:0");
        assert!(parse_preferences_preview(extra, &command).is_err());
    }
}
