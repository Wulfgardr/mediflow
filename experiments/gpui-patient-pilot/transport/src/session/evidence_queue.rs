use super::*;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::process::{Command, Stdio};

const WORKER: &str = include_str!("../../../worker/evidence-queue.bundle.mjs");

#[derive(Clone)]
pub struct EvidenceQueueRead {
    pub queue: Value,
    pub receipt: Value,
    intent: ProfileQueryIntent,
    read_epoch: u64,
    archive_epoch: u64,
    scope: String,
    patient: String,
    sources: Vec<Attachment>,
}

impl EvidenceQueueRead {
    pub fn source_attachments(&self) -> &[Attachment] {
        &self.sources
    }
}

fn same_sources(expected: &[Attachment], current: &[Attachment]) -> bool {
    if expected.len() != current.len() {
        return false;
    }
    let indexed = current
        .iter()
        .map(|row| (row.id.as_str(), row))
        .collect::<HashMap<_, _>>();
    indexed.len() == current.len()
        && expected.iter().all(|row| {
            indexed.get(row.id.as_str()).is_some_and(|other| {
                other.patient_id == row.patient_id
                    && other.locked_fields.is_empty()
                    && other.currentness == row.currentness
                    && other.name == row.name
                    && other.created_at == row.created_at
                    && other.summary_snapshot == row.summary_snapshot
                    && other.parse_evidence_artifact_snapshot
                        == row.parse_evidence_artifact_snapshot
            })
        })
}

impl Drop for EvidenceQueueRead {
    fn drop(&mut self) {
        crate::local_host::wipe_value(&mut self.queue);
    }
}

fn attachment_inputs(rows: &[Attachment], patient: &str) -> Result<Value> {
    let mut ids = HashSet::new();
    let mut inputs = vec![];
    for row in rows {
        if row.patient_id != patient || !row.locked_fields.is_empty() || !ids.insert(&row.id) {
            return Err(RuntimeError::InvalidResponse);
        }
        let currentness = row.currentness.as_ref().ok_or(RuntimeError::ReadRequired)?;
        if currentness["sourceRef"]
            .as_str()
            .is_none_or(|v| v.len() != 64 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
            || ["revision", "freshnessEpoch"].iter().any(|key| {
                currentness[key]
                    .as_u64()
                    .is_none_or(|v| !(1..=MAX_SAFE_VERSION).contains(&v))
            })
        {
            return Err(RuntimeError::InvalidResponse);
        }
        inputs.push(
            json!({"id":row.id,"patientId":row.patient_id,"fileName":row.name,
            "createdAt":row.created_at,"sourceVersion":row.created_at,
            "summarySnapshot":row.summary_snapshot,
            "parseEvidenceArtifactSnapshot":row.parse_evidence_artifact_snapshot}),
        );
    }
    inputs.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    Ok(json!(inputs))
}

fn project(input: Value) -> Result<Value> {
    let node = std::env::var_os("MEDIFLOW_NODE_BINARY")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("PATH").and_then(|paths| {
                std::env::split_paths(&paths)
                    .map(|p| p.join(if cfg!(windows) { "node.exe" } else { "node" }))
                    .find(|p| p.is_absolute() && p.is_file())
            })
        })
        .ok_or(RuntimeError::Missing)?;
    if !node.is_absolute() {
        return Err(RuntimeError::InvalidInput);
    }
    let input = Zeroizing::new(serde_json::to_vec(&input).map_err(|_| RuntimeError::InvalidInput)?);
    if input.len() > 16 * 1024 * 1024 {
        return Err(RuntimeError::TooLarge);
    }
    let mut child = Command::new(node)
        .args(["--permission", "--input-type=module", "--eval", WORKER])
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| RuntimeError::Transport)?;
    let written = child
        .stdin
        .take()
        .ok_or(RuntimeError::Transport)?
        .write_all(&input);
    if written.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(RuntimeError::Transport);
    }
    let output = child
        .wait_with_output()
        .map_err(|_| RuntimeError::Transport)?;
    let bytes = Zeroizing::new(output.stdout);
    if !output.status.success() || bytes.len() > 16 * 1024 * 1024 {
        return Err(RuntimeError::InvalidResponse);
    }
    serde_json::from_slice(&bytes).map_err(|_| RuntimeError::InvalidResponse)
}

impl RuntimeSession {
    pub fn evidence_queue_sources_are_current(
        &self,
        read: &EvidenceQueueRead,
        sources: &[Attachment],
    ) -> bool {
        self.evidence_queue_is_current(read) && same_sources(&read.sources, sources)
    }
    pub fn evidence_queue_is_current(&self, read: &EvidenceQueueRead) -> bool {
        self.profile_target_matches(&read.intent, &read.scope, &read.patient)
            .is_ok()
            && self
                .check_profile_intent(&read.intent, read.read_epoch)
                .is_ok()
            && self.dossier_check(read.archive_epoch).is_ok()
    }
    pub fn read_evidence_queue(
        &self,
        scope: &str,
        patient: &str,
        intent: &ProfileQueryIntent,
    ) -> Result<EvidenceQueueRead> {
        self.profile_target_matches(intent, scope, patient)?;
        let read_epoch = self.inner.read_epoch.load(Ordering::Acquire);
        let archive_epoch = self.document_archive_epoch();
        let rows = self.list_attachments(scope, patient)?;
        self.check_profile_intent(intent, read_epoch)?;
        let attachments = attachment_inputs(&rows, patient)?;
        let queue = project(json!({"patientId":patient,"attachments":attachments}))?;
        self.check_profile_intent(intent, read_epoch)?;
        let refreshed = self.list_attachments(scope, patient)?;
        if attachment_inputs(&refreshed, patient)? != attachments
            || rows.len() != refreshed.len()
            || rows.iter().any(|row| {
                refreshed
                    .iter()
                    .find(|next| next.id == row.id)
                    .is_none_or(|next| next.currentness != row.currentness)
            })
        {
            return Err(RuntimeError::ReadRequired);
        }
        let encoded =
            Zeroizing::new(serde_json::to_vec(&queue).map_err(|_| RuntimeError::InvalidResponse)?);
        let receipt = json!({"operation":"document-evidence-queue.read.v1","outcome":"read",
            "readAt":queue["generatedAt"],"sourceCount":rows.len(),
            "snapshotHash":format!("{:x}", Sha256::digest(&*encoded))});
        let read = EvidenceQueueRead {
            queue,
            receipt,
            intent: intent.clone(),
            read_epoch,
            archive_epoch,
            scope: scope.into(),
            patient: patient.into(),
            sources: refreshed,
        };
        if !self.evidence_queue_is_current(&read) {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(read)
    }
}
