use super::*;
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FabricRegistry {
    schema_version: String,
    contract_version: String,
    pub egress_gate_open: bool,
    pub readiness_note: String,
    pub capabilities: Vec<FabricCapability>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FabricCapability {
    pub id: String,
    pub class: String,
    pub operation: String,
    pub review: String,
    pub availability_disposition: String,
    pub venues: Vec<String>,
    pub egress_profile: FabricEgress,
}
#[derive(Clone, Debug, Deserialize)]
pub struct FabricEgress {
    pub id: String,
    pub version: String,
    pub egress: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FabricObservation {
    schema_version: String,
    pub fallback: String,
    pub observations: Vec<FabricVenueObservation>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct FabricVenueObservation {
    pub venue: String,
    pub state: String,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelParliament {
    pub updated_at: String,
    pub report: ParliamentReport,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ParliamentReport {
    pub parliament: ParliamentDecision,
    pub scorecard: Option<ParliamentScorecard>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParliamentDecision {
    pub readiness: String,
    pub baseline_model: Option<String>,
    #[serde(default)]
    pub challenger_models: Vec<String>,
    pub rationale: Option<String>,
    #[serde(default)]
    pub protected_models: Vec<String>,
    #[serde(default)]
    pub recommended_prune_models: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ParliamentScorecard {
    #[serde(default)]
    pub lanes: Vec<ParliamentLane>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParliamentLane {
    pub lane: String,
    pub capability: String,
    pub state: String,
    pub total_candidates: u32,
    pub runnable_candidates: u32,
    pub benchmarked_candidates: u32,
    pub focus_candidate_label: Option<String>,
    pub focus_candidate_model: Option<String>,
    pub focus_note: Option<String>,
    pub blockers: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutReadiness {
    pub lanes: Vec<RolloutLane>,
    pub local_controls: Vec<RolloutControl>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutLane {
    pub lane: String,
    pub available: bool,
    pub updated_at: Option<String>,
    pub report: Option<RolloutReport>,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutReport {
    pub status: Option<String>,
    pub current_state: Option<String>,
    pub selected_model: Option<String>,
    #[serde(default)]
    pub blockers: Vec<RolloutIssue>,
    #[serde(default)]
    pub warnings: Vec<RolloutIssue>,
    pub evidence: Option<RolloutEvidence>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct RolloutIssue {
    pub id: Option<String>,
    pub message: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutEvidence {
    pub benchmark_fresh: Option<bool>,
    pub owner: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct RolloutControl {
    pub lane: String,
    pub state: String,
}

pub struct GovernanceSnapshot {
    pub registry: Result<FabricRegistry>,
    pub observations: Result<FabricObservation>,
    pub parliament: Result<ModelParliament>,
    pub rollout: Result<RolloutReadiness>,
}

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)
}
fn unique<'a>(values: impl IntoIterator<Item = &'a str>) -> bool {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .all(|id| !id.is_empty() && seen.insert(id))
}
fn registry(value: Value) -> Result<FabricRegistry> {
    let row: FabricRegistry = decode(value)?;
    if row.schema_version != "mediflow.ai.fabric-status.v1"
        || row.contract_version != "mediflow.ai.fabric.v1"
        || row.readiness_note != "available_unqualified"
        || !unique(row.capabilities.iter().map(|r| r.id.as_str()))
        || row.capabilities.iter().any(|r| {
            !matches!(r.class.as_str(), "generative" | "deterministic")
                || !matches!(r.review.as_str(), "review_first" | "informational")
                || !matches!(
                    r.availability_disposition.as_str(),
                    "available" | "proposal_only" | "manual_only" | "unavailable"
                )
                || r.egress_profile.version != "mediflow.ai.egress-profile.v1"
                || !matches!(
                    (
                        r.egress_profile.id.as_str(),
                        r.egress_profile.egress.as_str()
                    ),
                    ("local_only", "none")
                        | ("cloud_authorized_redacted", "redacted_explicit_consent")
                )
                || !unique(r.venues.iter().map(String::as_str))
                || r.venues.iter().any(|v| !venue(v))
        })
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(row)
}
fn venue(value: &str) -> bool {
    matches!(value, "local_process" | "home_base" | "on_device" | "cloud")
}
fn observations(value: Value) -> Result<FabricObservation> {
    let row: FabricObservation = decode(value)?;
    if row.schema_version != "mediflow.ai.fabric-observability.v1"
        || row.fallback != "denied_by_contract"
        || !unique(row.observations.iter().map(|r| r.venue.as_str()))
        || row.observations.iter().any(|r| {
            !venue(&r.venue)
                || !matches!(
                    r.state.as_str(),
                    "available" | "degraded" | "offline" | "unknown"
                )
                || (matches!(r.state.as_str(), "offline" | "unknown") && r.reason.is_none())
                || r.reason.as_deref().is_some_and(|v| {
                    !matches!(
                        v,
                        "target_invalid"
                            | "daemon_unreachable"
                            | "mode_disabled"
                            | "egress_profile_closed"
                            | "not_implemented"
                            | "not_probed"
                    )
                })
        })
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(row)
}
fn parliament(value: Value) -> Result<ModelParliament> {
    let row: ModelParliament = decode(value)?;
    if !matches!(
        row.report.parliament.readiness.as_str(),
        "hold" | "prune_ready"
    ) {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(row)
}
fn rollout(value: Value) -> Result<RolloutReadiness> {
    let row: RolloutReadiness = decode(value)?;
    if !unique(row.lanes.iter().map(|r| r.lane.as_str()))
        || !unique(row.local_controls.iter().map(|r| r.lane.as_str()))
        || row.lanes.iter().any(|r| {
            r.available != r.report.is_some()
                || r.report
                    .as_ref()
                    .and_then(|r| r.status.as_deref())
                    .is_some_and(|v| !matches!(v, "hold" | "shadow-ready" | "rollback-required"))
        })
        || row
            .local_controls
            .iter()
            .any(|r| !matches!(r.state.as_str(), "enabled" | "disabled"))
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(row)
}
pub(super) fn retain_section<T>(result: Result<T>) -> Result<Result<T>> {
    match result {
        Err(error) if error.retires_session() => Err(error),
        result => Ok(result),
    }
}
impl LocalHostAccess {
    pub fn read_governance(&self) -> Result<GovernanceSnapshot> {
        Ok(GovernanceSnapshot {
            registry: retain_section(
                self.request(Method::GET, &["api", "ai", "fabric", "status"], None, false)
                    .and_then(registry),
            )?,
            observations: retain_section(
                self.request(
                    Method::GET,
                    &["api", "ai", "fabric", "observability"],
                    None,
                    false,
                )
                .and_then(observations),
            )?,
            parliament: retain_section(
                self.request(
                    Method::GET,
                    &["api", "system", "ai-parliament"],
                    None,
                    false,
                )
                .and_then(parliament),
            )?,
            rollout: retain_section(
                self.request(
                    Method::GET,
                    &["api", "system", "ai-rollout-readiness"],
                    None,
                    false,
                )
                .and_then(rollout),
            )?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn fixture() -> Value {
        serde_json::from_str(include_str!("../../../comparison/governance.json")).unwrap()
    }
    #[test]
    fn governance_parses_host_snapshots_and_rejects_drift_without_promoting_readiness() {
        let fixture = fixture();
        let parsed = registry(fixture["registry"].clone()).unwrap();
        assert_eq!(parsed.capabilities.len(), 16);
        assert!(!parsed.egress_gate_open);
        let treatment = parsed
            .capabilities
            .iter()
            .find(|r| r.id == "treatment_reasoning")
            .unwrap();
        assert_eq!(treatment.availability_disposition, "proposal_only");
        assert_eq!(treatment.venues, ["local_process", "home_base"]);
        let obs = observations(fixture["observations"].clone()).unwrap();
        assert_eq!(obs.observations.len(), 4);
        assert_eq!(obs.fallback, "denied_by_contract");
        assert_eq!(
            parliament(fixture["parliament"].clone())
                .unwrap()
                .report
                .parliament
                .baseline_model
                .as_deref(),
            Some("synthetic-model")
        );
        let ready = rollout(fixture["rollout"].clone()).unwrap();
        assert_eq!(ready.lanes.len(), 5);
        assert_eq!(
            ready.lanes[0].report.as_ref().unwrap().status.as_deref(),
            Some("shadow-ready")
        );
        assert!(ready.lanes[1..].iter().all(|r| !r.available));
        for field in ["schemaVersion", "contractVersion", "readinessNote"] {
            let mut invalid = fixture["registry"].clone();
            invalid[field] = json!("unknown");
            assert!(registry(invalid).is_err(), "{field}");
        }
        let mut invalid = fixture["registry"].clone();
        invalid["capabilities"][1] = invalid["capabilities"][0].clone();
        assert!(registry(invalid).is_err());
        let mut invalid = fixture["observations"].clone();
        invalid["observations"][0]["state"] = json!("ready");
        assert!(observations(invalid).is_err());
        let mut invalid = fixture["rollout"].clone();
        invalid["lanes"][0]["report"] = Value::Null;
        assert!(rollout(invalid).is_err());
    }
}
