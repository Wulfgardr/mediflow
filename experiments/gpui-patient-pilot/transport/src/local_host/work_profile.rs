use super::*;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkProfileState {
    pub schema_version: u8,
    pub revision: u64,
    pub active: Option<WorkProfileSelection>,
    pub previous: Option<WorkProfileSelection>,
    pub can_rollback: bool,
    pub draft: Option<WorkProfileDraft>,
    pub last_command: Option<Value>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WorkProfileSelection {
    pub profile: WorkProfile,
    pub source: WorkProfileSource,
    pub answers: WorkProfileAnswers,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WorkProfileDraft {
    pub profile: WorkProfile,
    pub source: WorkProfileSource,
    pub answers: WorkProfileAnswers,
    pub step: u8,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(deny_unknown_fields)]
pub struct WorkProfileAnswers {
    pub activity: Option<String>,
    pub interaction: Option<String>,
    pub platform: Option<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkProfile {
    Interactive,
    Agent,
    Both,
}
impl WorkProfile {
    pub fn label(self) -> &'static str {
        match self {
            Self::Interactive => "Interactive",
            Self::Agent => "Agent",
            Self::Both => "Entrambi",
        }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkProfileSource {
    Guided,
    Manual,
}
impl WorkProfileAnswers {
    pub fn complete(&self) -> bool {
        self.activity.is_some() && self.interaction.is_some() && self.platform.is_some()
    }
    pub fn recommended(&self) -> WorkProfile {
        match self.interaction.as_deref() {
            Some("delegate") => WorkProfile::Agent,
            Some("mixed") => WorkProfile::Both,
            Some("unsure") if self.activity.as_deref() == Some("repetitive") => WorkProfile::Both,
            _ => WorkProfile::Interactive,
        }
    }
    fn valid(&self) -> bool {
        self.activity
            .as_deref()
            .is_none_or(|v| matches!(v, "records" | "organization" | "repetitive"))
            && self
                .interaction
                .as_deref()
                .is_none_or(|v| matches!(v, "screens" | "delegate" | "mixed" | "unsure"))
            && self
                .platform
                .as_deref()
                .is_none_or(|v| matches!(v, "macos" | "windows" | "linux" | "other"))
    }
}
impl WorkProfileDraft {
    pub fn can_confirm(&self) -> bool {
        self.step == 3 && (self.source == WorkProfileSource::Manual || self.answers.complete())
    }
    pub fn start_area(&self) -> &'static str {
        if self.profile == WorkProfile::Agent {
            "Sistema e impostazioni"
        } else if self.profile == WorkProfile::Interactive
            && self.answers.activity.as_deref() == Some("records")
        {
            "Lista pazienti"
        } else {
            "Turno"
        }
    }
}
fn state(value: Value) -> Result<WorkProfileState> {
    let state: WorkProfileState =
        serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
    if state.schema_version != 1
        || state.revision > 9_007_199_254_740_991
        || state
            .draft
            .as_ref()
            .is_some_and(|d| d.step > 3 || !d.answers.valid())
        || [&state.active, &state.previous]
            .iter()
            .any(|s| s.as_ref().is_some_and(|s| !s.answers.valid()))
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(state)
}
#[derive(Clone, Copy)]
pub enum WorkProfileAction {
    SaveDraft,
    Confirm,
    DiscardDraft,
    Rollback,
}
pub struct PreparedWorkProfile {
    owner: Weak<()>,
    payload: Value,
    expected: WorkProfileState,
    submitted: AtomicBool,
}
pub struct WorkProfileWrite {
    pub recorded: WorkProfileState,
    pub current: Result<WorkProfileState>,
}
impl LocalHostAccess {
    pub fn read_work_profile(&self) -> Result<WorkProfileState> {
        state(self.request(
            Method::GET,
            &["api", "onboarding", "work-profile"],
            None,
            false,
        )?)
    }
    pub fn prepare_work_profile(
        &self,
        observed: &WorkProfileState,
        action: WorkProfileAction,
        draft: Option<WorkProfileDraft>,
    ) -> Result<PreparedWorkProfile> {
        self.headers()?;
        if observed.revision >= 9_007_199_254_740_991 {
            return Err(RuntimeError::ReadRequired);
        }
        let action = match action {
            WorkProfileAction::SaveDraft
                if draft
                    .as_ref()
                    .is_some_and(|d| d.step <= 3 && d.answers.valid()) =>
            {
                "save-draft"
            }
            WorkProfileAction::Confirm
                if draft.is_none()
                    && observed
                        .draft
                        .as_ref()
                        .is_some_and(WorkProfileDraft::can_confirm) =>
            {
                "confirm"
            }
            WorkProfileAction::DiscardDraft if draft.is_none() => "discard-draft",
            WorkProfileAction::Rollback if draft.is_none() && observed.can_rollback => "rollback",
            _ => return Err(RuntimeError::InvalidInput),
        };
        let mut payload =
            json!({"id":operation_uuid()?,"expectedRevision":observed.revision,"action":action});
        if let Some(draft) = draft {
            payload["draft"] =
                serde_json::to_value(draft).map_err(|_| RuntimeError::InvalidInput)?;
        }
        let mut expected = observed.clone();
        expected.revision += 1;
        expected.last_command = Some(payload.clone());
        match action {
            "save-draft" => {
                expected.draft = Some(
                    serde_json::from_value(payload["draft"].clone())
                        .map_err(|_| RuntimeError::InvalidInput)?,
                )
            }
            "discard-draft" => expected.draft = None,
            "rollback" => {
                expected.active = observed.previous.clone();
                expected.previous = None;
                expected.can_rollback = false;
                expected.draft = None;
            }
            "confirm" => {
                let d = observed.draft.as_ref().ok_or(RuntimeError::ReadRequired)?;
                let selection = WorkProfileSelection {
                    profile: d.profile,
                    source: d.source,
                    answers: d.answers.clone(),
                };
                if observed.active.as_ref() != Some(&selection) {
                    expected.previous = observed.active.clone();
                    expected.can_rollback = true;
                }
                expected.active = Some(selection);
                expected.draft = None;
            }
            _ => return Err(RuntimeError::InvalidInput),
        }
        Ok(PreparedWorkProfile {
            owner: Arc::downgrade(&self.owner),
            expected,
            payload,
            submitted: AtomicBool::new(false),
        })
    }
    pub fn write_work_profile(&self, command: &PreparedWorkProfile) -> Result<WorkProfileWrite> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let recorded = state(self.request(
            Method::PUT,
            &["api", "onboarding", "work-profile"],
            Some(&command.payload),
            true,
        )?)?;
        if recorded != command.expected {
            return Err(RuntimeError::Indeterminate);
        }
        let current = self.read_work_profile();
        if let Err(error) = &current
            && error.retires_session()
        {
            return Err(*error);
        }
        Ok(WorkProfileWrite { recorded, current })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn work_profile_preview_requires_answers_and_valid_state() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/work-profile.json")).unwrap();
        let initial = state(fixture["initial"].clone()).unwrap();
        assert!(initial.active.is_none());
        let partial = state(fixture["steps"][0]["state"].clone()).unwrap();
        assert!(!partial.draft.unwrap().can_confirm());
        let preview = state(fixture["steps"][1]["state"].clone()).unwrap();
        let draft = preview.draft.unwrap();
        assert!(draft.can_confirm());
        assert_eq!(draft.start_area(), "Lista pazienti");
        assert_eq!(draft.answers.recommended(), WorkProfile::Interactive);
        let mut invalid = fixture["initial"].clone();
        invalid["revision"] = json!(9_007_199_254_740_992u64);
        assert!(state(invalid).is_err());
        let mut invalid = fixture["steps"][1]["state"].clone();
        invalid["draft"]["answers"]["interaction"] = json!("invented");
        assert!(state(invalid).is_err());
    }
}
