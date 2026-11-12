use super::*;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenLoopsRead {
    pub contract_version: u8,
    pub patient_id: String,
    pub ambulatory_id: String,
    pub groups: Vec<OpenLoopGroup>,
    pub standalone_loops: Vec<OpenLoopRow>,
    pub receipt: OpenLoopsReceipt,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenLoopGroup {
    pub prescription_id: String,
    pub prescribed_at: String,
    pub loops: Vec<OpenLoopRow>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenLoopRow {
    pub kind: String,
    pub label: String,
    pub since_date: String,
    pub elapsed_days: u64,
    pub typical_interval_days: Option<f64>,
    pub source: OpenLoopSource,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum OpenLoopSource {
    #[serde(rename = "service_prescription_item", rename_all = "camelCase")]
    ServiceItem { id: String, prescription_id: String },
    #[serde(rename = "observation_series", rename_all = "camelCase")]
    ObservationSeries { code_system: String, code: String },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenLoopsReceipt {
    pub operation: String,
    pub outcome: String,
    pub read_at: String,
    pub item_count: usize,
    pub snapshot_hash: String,
}

fn valid_date(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

impl OpenLoopRow {
    fn valid(&self) -> bool {
        !self.label.is_empty()
            && self.label.len() <= 16_384
            && valid_date(&self.since_date)
            && match &self.source {
                OpenLoopSource::ServiceItem {
                    id,
                    prescription_id,
                } => {
                    self.kind == "results_pending"
                        && self.typical_interval_days.is_none()
                        && validate_id(id).is_ok()
                        && validate_id(prescription_id).is_ok()
                }
                OpenLoopSource::ObservationSeries { code_system, code } => {
                    self.kind == "series_stalled"
                        && self
                            .typical_interval_days
                            .is_some_and(|days| (1.0..=180.0).contains(&days))
                        && !code_system.is_empty()
                        && !code.is_empty()
                }
            }
    }
}

impl RuntimeSession {
    pub fn read_open_loops(
        &self,
        scope: &str,
        patient: &str,
        intent: &ProfileQueryIntent,
    ) -> Result<OpenLoopsRead> {
        validate_id(patient)?;
        self.profile_target_matches(intent, scope, patient)?;
        let epoch = self.inner.read_epoch.load(Ordering::Acquire);
        let mut value = self.request_with_profile_intent(
            Method::GET,
            &["api", "v1", "network", "patients", patient, "open-loops"],
            &[],
            Some(scope),
            None,
            false,
            JSON_LIMIT,
            Some(intent),
        )?;
        let decrypt_row = |value: &mut Value| -> Result<()> {
            if !self
                .decrypt_fields(value, &[("label", true, false)])?
                .is_empty()
            {
                return Err(RuntimeError::InvalidResponse);
            }
            Ok(())
        };
        for group in value["groups"]
            .as_array_mut()
            .ok_or(RuntimeError::InvalidResponse)?
        {
            for row in group["loops"]
                .as_array_mut()
                .ok_or(RuntimeError::InvalidResponse)?
            {
                decrypt_row(row)?;
            }
        }
        for row in value["standaloneLoops"]
            .as_array_mut()
            .ok_or(RuntimeError::InvalidResponse)?
        {
            decrypt_row(row)?;
        }
        let read: OpenLoopsRead = decode(value)?;
        let count = read
            .groups
            .iter()
            .map(|group| group.loops.len())
            .sum::<usize>()
            + read.standalone_loops.len();
        if read.contract_version != 1 || read.patient_id != patient || read.ambulatory_id != scope
            || count > 2048 || read.groups.len() > 1024
            || read.receipt.operation != "patient-open-loops.read.v1" || read.receipt.outcome != "read"
            || read.receipt.item_count != count || !valid_date(&read.receipt.read_at)
            || read.receipt.snapshot_hash.len() != 64
            || !read.receipt.snapshot_hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            || read.groups.iter().any(|group| !valid_date(&group.prescribed_at) || group.loops.is_empty()
                || group.loops.iter().any(|row| !row.valid() || !matches!(&row.source,
                    OpenLoopSource::ServiceItem { prescription_id, .. } if prescription_id == &group.prescription_id)))
            || read.standalone_loops.iter().any(|row| !row.valid()) {
            return Err(RuntimeError::InvalidResponse);
        }
        self.profile_target_matches(intent, scope, patient)?;
        self.check_profile_intent(intent, epoch)?;
        Ok(read)
    }
}

impl Drop for OpenLoopRow {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.label.zeroize();
    }
}
