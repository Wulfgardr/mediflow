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
    ) -> Result<()> {
        if !command.owner.ptr_eq(&Arc::downgrade(&self.owner)) {
            return Err(RuntimeError::ReadRequired);
        }
        let mut headers = self.headers()?;
        if command.submitted.swap(true, Ordering::AcqRel) {
            return Err(RuntimeError::ReadRequired);
        }
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
