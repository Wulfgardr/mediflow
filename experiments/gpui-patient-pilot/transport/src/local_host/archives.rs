use super::*;

#[derive(Clone, Deserialize, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreReceipt {
    pub id: String,
    pub source_checksum: String,
    pub archive_generation: String,
    pub completed_at: String,
}
#[derive(Clone, Deserialize, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreLookup {
    pub id: String,
    pub source_checksum: String,
    pub origin: String,
}
pub struct RestoreConfirmation(());
impl RestoreConfirmation {
    pub fn new(value: &str) -> Result<Self> {
        if value.trim().to_uppercase() == "RIPRISTINA" {
            Ok(Self(()))
        } else {
            Err(RuntimeError::InvalidInput)
        }
    }
}
pub struct PreparedArchiveRestore {
    owner: Weak<()>,
    artifact: Value,
    snapshot: String,
    lookup: RestoreLookup,
    records: u64,
    submitted: AtomicBool,
}
impl PreparedArchiveRestore {
    pub fn lookup(&self) -> &RestoreLookup {
        &self.lookup
    }
    pub fn records(&self) -> u64 {
        self.records
    }
}
fn digest(value: &Value) -> Result<String> {
    value
        .as_str()
        .filter(|v| {
            v.len() == 64
                && v.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        .map(str::to_owned)
        .ok_or(RuntimeError::InvalidResponse)
}
impl LocalHostAccess {
    pub fn admit_archive_file_effect(&self) -> Result<()> {
        self.headers()?;
        self.client.context.admit_file_effect()
    }
    pub fn export_recovery_archive(&self) -> Result<Zeroizing<Vec<u8>>> {
        let response = self.client.dedicated_web_raw(
            Method::POST,
            &["api", "system", "recovery-backup"],
            self.headers()?,
            None,
            false,
        )?;
        let bytes = self.native.seal_recovery_backup(&response.body)?;
        self.native.verify_recovery_backup(&bytes)?;
        self.headers()?;
        Ok(bytes)
    }
    pub fn verify_recovery_archive(&self, bytes: &[u8]) -> Result<()> {
        self.headers()?;
        self.native.verify_recovery_backup(bytes)
    }
    pub fn export_archive(&self) -> Result<Zeroizing<Vec<u8>>> {
        let artifact = self.request(
            Method::GET,
            &["api", "system", "backup-restore"],
            None,
            false,
        )?;
        self.native.assert_backup_key(&artifact)?;
        self.verify_archive(&artifact)?;
        self.headers()?;
        serde_json::to_vec(&artifact)
            .map(Zeroizing::new)
            .map_err(|_| RuntimeError::InvalidResponse)
    }
    fn verify_archive(&self, artifact: &Value) -> Result<Value> {
        self.native.assert_backup_key(artifact)?;
        let preview = self.request(
            Method::POST,
            &["api", "system", "backup-restore", "verify"],
            Some(artifact),
            false,
        )?;
        if preview["format"] != "mediflow-backup"
            || preview["success"] != true
            || preview["version"] != 1
            || !preview["counts"].is_object()
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(preview)
    }
    pub fn prepare_archive_restore(&self, bytes: &[u8]) -> Result<PreparedArchiveRestore> {
        if bytes.len() > crate::http::JSON_LIMIT {
            return Err(RuntimeError::TooLarge);
        }
        let artifact: Value =
            serde_json::from_slice(bytes).map_err(|_| RuntimeError::InvalidInput)?;
        let preview = self.verify_archive(&artifact)?;
        let records = preview["counts"]
            .as_object()
            .ok_or(RuntimeError::InvalidResponse)?
            .values()
            .try_fold(0u64, |sum, n| {
                sum.checked_add(n.as_u64()?)
                    .filter(|n| *n <= crate::MAX_SAFE_VERSION)
            })
            .ok_or(RuntimeError::InvalidResponse)?;
        Ok(PreparedArchiveRestore {
            owner: Arc::downgrade(&self.owner),
            artifact,
            snapshot: digest(&preview["expectedSnapshot"])?,
            lookup: RestoreLookup {
                id: operation_uuid()?,
                source_checksum: digest(&preview["sourceChecksum"])?,
                origin: self.client.base_url().into(),
            },
            records,
            submitted: AtomicBool::new(false),
        })
    }
    pub fn restore_archive(
        &self,
        command: &PreparedArchiveRestore,
        _confirmation: RestoreConfirmation,
        passphrase: &str,
    ) -> Result<()> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        let mut headers = self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let checked = self.client.dedicated_web_raw(
            Method::GET,
            &["api", "auth", "check"],
            headers.clone(),
            None,
            false,
        )?;
        let check: Value =
            serde_json::from_slice(&checked.body).map_err(|_| RuntimeError::InvalidResponse)?;
        if check["archiveGeneration"] != self.generation
            || check["unlock"]["credential"] != "passphrase"
            || check["unlock"]["kdfVersion"] != 3
        {
            return Err(RuntimeError::UnsupportedUnlock);
        }
        let salt = check["unlock"]["salt"]
            .as_str()
            .ok_or(RuntimeError::InvalidResponse)?;
        let material = crate::crypto::derive_v3(passphrase, salt)?;
        let credential = Zeroizing::new(format!(r#"{{"verifier":"{}"}}"#, &*material.verifier));
        headers.insert(
            "x-mediflow-restore-credential",
            sensitive_header(&credential)?,
        );
        headers.insert(
            "x-mediflow-restore-id",
            sensitive_header(&command.lookup.id)?,
        );
        headers.insert(
            "x-mediflow-restore-snapshot",
            sensitive_header(&command.snapshot)?,
        );
        headers.insert(
            "x-mediflow-restore-confirmation",
            sensitive_header("RIPRISTINA")?,
        );
        let response = self.client.dedicated_web_raw(
            Method::POST,
            &["api", "system", "backup-restore"],
            headers,
            Some(&command.artifact),
            true,
        )?;
        let value: Value =
            serde_json::from_slice(&response.body).map_err(|_| RuntimeError::Indeterminate)?;
        if value["success"] != true
            || value["sourceChecksum"] != command.lookup.source_checksum
            || value["receipt"]["id"] != command.lookup.id
        {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(())
    }
    pub fn read_restore_receipt(&self, lookup: &RestoreLookup) -> Result<RestoreReceipt> {
        validate_id(&lookup.id)?;
        if lookup.origin != self.client.base_url() {
            return Err(RuntimeError::ReadRequired);
        }
        let value = self.request(
            Method::GET,
            &["api", "system", "backup-restore", "receipts", &lookup.id],
            None,
            false,
        )?;
        let receipt: RestoreReceipt =
            serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
        if receipt.id != lookup.id
            || receipt.source_checksum != lookup.source_checksum
            || receipt.archive_generation != self.generation
            || chrono::DateTime::parse_from_rfc3339(&receipt.completed_at).is_err()
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(receipt)
    }
}

#[derive(Clone, Deserialize, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupScheduleConfig {
    pub enabled: bool,
    pub hour: u8,
    pub minute: u8,
    pub destination_dir: String,
    pub retention_keep_artifacts: u64,
    #[serde(default)]
    pub volume_protection_acknowledged: bool,
}
impl BackupScheduleConfig {
    pub fn validate(&self) -> Result<()> {
        if self.hour > 23
            || self.minute > 59
            || self.destination_dir.trim().is_empty()
            || self.destination_dir.chars().any(char::is_control)
            || self.destination_dir.len() > 3000
            || self.destination_dir.trim() != self.destination_dir
            || !std::path::Path::new(&self.destination_dir).is_absolute()
            || !(1..=365).contains(&self.retention_keep_artifacts)
        {
            return Err(RuntimeError::InvalidInput);
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupScheduleRun {
    pub last_run_at: Option<String>,
    pub last_run_status: Option<String>,
    pub last_run_message: Option<String>,
    pub last_artifact_path: Option<String>,
}
#[derive(Clone, Deserialize, Debug)]
pub struct BackupScheduleState {
    pub version: u64,
    pub revision: String,
    pub config: BackupScheduleConfig,
    pub run: BackupScheduleRun,
}
#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupScheduleStatus {
    pub supported: bool,
    pub installed: Option<bool>,
    pub observation_message: Option<String>,
    pub state: BackupScheduleState,
}
impl BackupScheduleStatus {
    fn parse(value: Value) -> Result<Self> {
        let status: Self =
            serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;

        let mut syntax = status.state.config.clone();
        syntax.enabled = false;
        syntax
            .validate()
            .map_err(|_| RuntimeError::InvalidResponse)?;
        if status.state.revision.is_empty() || status.state.revision.len() > 128 {
            return Err(RuntimeError::InvalidResponse);
        }
        if status.state.version != 1
            || !matches!(
                status.state.run.last_run_status.as_deref(),
                None | Some("success" | "error")
            )
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(status)
    }
}
pub struct PreparedBackupSchedule {
    owner: Weak<()>,
    before: BackupScheduleConfig,
    revision: String,
    after: BackupScheduleConfig,
    installed: bool,
    submitted: AtomicBool,
}
impl PreparedBackupSchedule {
    pub fn config(&self) -> &BackupScheduleConfig {
        &self.after
    }
}
impl LocalHostAccess {
    pub fn read_backup_schedule(&self) -> Result<BackupScheduleStatus> {
        let value = self.request(
            Method::GET,
            &["api", "system", "backup-scheduler"],
            None,
            false,
        )?;
        BackupScheduleStatus::parse(value)
    }
    pub fn prepare_backup_schedule(
        &self,
        expected: &BackupScheduleConfig,
        after: BackupScheduleConfig,
    ) -> Result<PreparedBackupSchedule> {
        after.validate()?;
        let before = self.read_backup_schedule()?;
        if &before.state.config != expected {
            return Err(RuntimeError::Conflict);
        }
        if after.enabled && !before.supported {
            return Err(RuntimeError::Forbidden);
        }
        Ok(PreparedBackupSchedule {
            owner: Arc::downgrade(&self.owner),
            revision: before.state.revision,
            before: before.state.config,
            after,
            installed: before.installed.ok_or(RuntimeError::ReadRequired)?,
            submitted: AtomicBool::new(false),
        })
    }
    pub fn apply_backup_schedule(
        &self,
        command: &PreparedBackupSchedule,
    ) -> Result<BackupScheduleStatus> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
        let before = self.read_backup_schedule()?;
        if before.state.revision != command.revision
            || before.state.config != command.before
            || before.installed != Some(command.installed)
        {
            return Err(RuntimeError::Conflict);
        }
        if command.after.enabled && !before.supported {
            return Err(RuntimeError::Forbidden);
        }
        self.request(
            Method::POST,
            &["api", "system", "backup-scheduler"],
            Some(&json!({"action":"save", "expectedRevision":command.revision, "config":command.after})),
            true,
        )?;
        let observed = self.read_backup_schedule().map_err(|error| {
            if error.retires_session() {
                error
            } else {
                RuntimeError::Indeterminate
            }
        })?;
        if observed.state.config != command.after
            || observed.installed != Some(command.after.enabled)
        {
            return Err(RuntimeError::Indeterminate);
        }
        Ok(observed)
    }
}

#[cfg(test)]
mod backup_destination_tests {
    use super::*;

    #[test]
    fn backup_schedule_path_validation_is_preview_and_legacy_destinations_remain_readable() {
        let mut config = BackupScheduleConfig {
            enabled: true,
            hour: 2,
            minute: 0,
            destination_dir: std::env::temp_dir()
                .join("synthetic-safe")
                .to_string_lossy()
                .into(),
            retention_keep_artifacts: 14,
            volume_protection_acknowledged: false,
        };
        assert!(config.validate().is_ok());
        for component in [
            "Mobile Documents",
            "CloudStorage",
            "Dropbox",
            "OneDrive - Organization",
            "GoogleDrive-account",
            "Documents",
            "Desktop",
        ] {
            config.destination_dir = std::env::temp_dir()
                .join(component)
                .join("synthetic-backups")
                .to_string_lossy()
                .into();
            assert!(config.validate().is_ok());
            config.enabled = false;
            assert!(config.validate().is_ok());
            config.enabled = true;
        }
    }
}
