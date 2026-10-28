use crate::{AmbulatoryCommandMarker, AmbulatoryCommandTerminal, Result, RuntimeError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommandRecoveryBinding {
    pub(crate) host_origin: String,
    pub(crate) actor_id: String,
    pub(crate) device_id: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    version: u8,
    binding: CommandRecoveryBinding,
    marker: AmbulatoryCommandMarker,
}
#[derive(Clone)]
pub struct AmbulatoryCommandRecoveryStore {
    path: PathBuf,
    lock_path: PathBuf,
    binding: CommandRecoveryBinding,
}
/// A successful durable write, revalidated against disk at the single dispatch.
/// This value contains no credential or host authorization.
pub struct PersistedAmbulatoryCommand {
    marker: AmbulatoryCommandMarker,
    store: AmbulatoryCommandRecoveryStore,
}
/// Attests only retirement of the exact WebP3 session that returned this proof.
/// It does not attest retirement of a session lost with an earlier process.
pub struct AmbulatoryCommandRetirement {
    pub(crate) binding: CommandRecoveryBinding,
    pub(crate) command_id: String,
}
impl PersistedAmbulatoryCommand {
    pub fn marker(&self) -> &AmbulatoryCommandMarker {
        &self.marker
    }
    pub(crate) fn verify(
        &self,
        binding: &CommandRecoveryBinding,
        marker: &AmbulatoryCommandMarker,
    ) -> Result<()> {
        let _lock = self.store.lock()?;
        if self.store.binding != *binding
            || self.marker != *marker
            || self.store.load_unlocked()?.as_ref() != Some(marker)
        {
            return Err(RuntimeError::ReadRequired);
        }
        self.store.sync_marker()?;
        Ok(())
    }
}
impl AmbulatoryCommandRecoveryStore {
    pub(crate) fn new(directory: &Path, binding: CommandRecoveryBinding) -> Result<Self> {
        if !directory.is_absolute() {
            return Err(RuntimeError::InvalidInput);
        }
        #[cfg(windows)]
        mediflow_local_state::create_directory(directory)
            .map_err(|_| RuntimeError::ReadRequired)?;
        if !directory.exists() {
            let mut builder = fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder
                .create(directory)
                .map_err(|_| RuntimeError::ReadRequired)?;
        }
        let metadata = fs::symlink_metadata(directory).map_err(|_| RuntimeError::ReadRequired)?;
        if !metadata.is_dir()
            || directory
                .canonicalize()
                .map_err(|_| RuntimeError::ReadRequired)?
                != directory
        {
            return Err(RuntimeError::ReadRequired);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(RuntimeError::ReadRequired);
            }
        }
        let digest =
            Sha256::digest(serde_json::to_vec(&binding).map_err(|_| RuntimeError::InvalidInput)?);
        let name: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        Ok(Self {
            path: directory.join(format!("{name}.json")),
            lock_path: directory.join(format!("{name}.lock")),
            binding,
        })
    }
    fn lock(&self) -> Result<std::fs::File> {
        #[cfg(not(windows))]
        let mut options = fs::OpenOptions::new();
        #[cfg(not(windows))]
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(windows)]
        let file = mediflow_local_state::open_lock(&self.lock_path)
            .map_err(|_| RuntimeError::ReadRequired)?;
        #[cfg(not(windows))]
        let file = options
            .open(&self.lock_path)
            .map_err(|_| RuntimeError::ReadRequired)?;
        file.try_lock().map_err(|_| RuntimeError::Busy)?;
        if !fs::symlink_metadata(&self.lock_path)
            .map_err(|_| RuntimeError::ReadRequired)?
            .is_file()
        {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(file)
    }
    pub fn load(&self) -> Result<Option<AmbulatoryCommandMarker>> {
        let _lock = self.lock()?;
        self.load_unlocked()
    }
    fn load_unlocked(&self) -> Result<Option<AmbulatoryCommandMarker>> {
        #[cfg(windows)]
        let file = match mediflow_local_state::open_read(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(RuntimeError::ReadRequired),
        };
        #[cfg(windows)]
        let metadata = file.metadata().map_err(|_| RuntimeError::ReadRequired)?;
        #[cfg(not(windows))]
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(RuntimeError::ReadRequired),
        };
        if !metadata.is_file() || metadata.len() > 4096 {
            return Err(RuntimeError::ReadRequired);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            if metadata.nlink() != 1 || metadata.permissions().mode() & 0o077 != 0 {
                return Err(RuntimeError::ReadRequired);
            }
        }
        let mut bytes = Vec::new();
        #[cfg(not(windows))]
        let file = fs::File::open(&self.path).map_err(|_| RuntimeError::ReadRequired)?;
        file.take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| RuntimeError::ReadRequired)?;
        if bytes.len() > 4096 {
            return Err(RuntimeError::ReadRequired);
        }
        let record: Record =
            serde_json::from_slice(&bytes).map_err(|_| RuntimeError::ReadRequired)?;
        if record.version != 1
            || record.binding != self.binding
            || record.marker.validate().is_err()
        {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(Some(record.marker))
    }
    pub(crate) fn persist(
        &self,
        marker: &AmbulatoryCommandMarker,
    ) -> Result<PersistedAmbulatoryCommand> {
        marker.validate()?;
        let _lock = self.lock()?;
        if let Some(previous) = self.load_unlocked()? {
            self.sync_marker()?;
            return if previous == *marker {
                Ok(PersistedAmbulatoryCommand {
                    marker: marker.clone(),
                    store: self.clone(),
                })
            } else {
                Err(RuntimeError::ReadRequired)
            };
        }
        let bytes = serde_json::to_vec(&Record {
            version: 1,
            binding: self.binding.clone(),
            marker: marker.clone(),
        })
        .map_err(|_| RuntimeError::InvalidInput)?;
        if bytes.len() > 4096 {
            return Err(RuntimeError::TooLarge);
        }
        #[cfg(not(windows))]
        let mut options = fs::OpenOptions::new();
        #[cfg(not(windows))]
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(windows)]
        let created = mediflow_local_state::create_file(&self.path);
        #[cfg(not(windows))]
        let created = options.open(&self.path);
        let mut file = match created {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if self.load_unlocked()?.as_ref() == Some(marker) {
                    self.sync_marker()?;
                    return Ok(PersistedAmbulatoryCommand {
                        marker: marker.clone(),
                        store: self.clone(),
                    });
                }
                return Err(RuntimeError::ReadRequired);
            }
            Err(_) => return Err(RuntimeError::ReadRequired),
        };
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| RuntimeError::ReadRequired)?;
        #[cfg(unix)]
        fs::File::open(self.path.parent().ok_or(RuntimeError::ReadRequired)?)
            .and_then(|file| file.sync_all())
            .map_err(|_| RuntimeError::ReadRequired)?;
        drop(file);
        let persisted = PersistedAmbulatoryCommand {
            marker: marker.clone(),
            store: self.clone(),
        };
        if self.load_unlocked()?.as_ref() != Some(marker) {
            return Err(RuntimeError::ReadRequired);
        }
        Ok(persisted)
    }
    fn sync_marker(&self) -> Result<()> {
        #[cfg(windows)]
        mediflow_local_state::open_write(&self.path)
            .and_then(|file| file.sync_all())
            .map_err(|_| RuntimeError::ReadRequired)?;
        #[cfg(not(windows))]
        fs::File::open(&self.path)
            .and_then(|file| file.sync_all())
            .map_err(|_| RuntimeError::ReadRequired)?;
        #[cfg(unix)]
        fs::File::open(self.path.parent().ok_or(RuntimeError::ReadRequired)?)
            .and_then(|file| file.sync_all())
            .map_err(|_| RuntimeError::ReadRequired)?;
        Ok(())
    }
    /// Explicit acknowledgement after an exact terminal receipt and retirement
    /// of the current recovery/command WebP3. No remote cleanup is inferred.
    pub fn acknowledge_terminal(
        &self,
        marker: &AmbulatoryCommandMarker,
        terminal: &AmbulatoryCommandTerminal,
        retirement: &AmbulatoryCommandRetirement,
    ) -> Result<()> {
        let _lock = self.lock()?;
        if !terminal.bound_to(&self.binding)
            || terminal.receipt().marker() != *marker
            || retirement.binding != self.binding
            || retirement.command_id != marker.command_id
            || self.load_unlocked()?.as_ref() != Some(marker)
        {
            return Err(RuntimeError::ReadRequired);
        }
        fs::remove_file(&self.path).map_err(|_| RuntimeError::ReadRequired)?;
        #[cfg(unix)]
        fs::File::open(self.path.parent().ok_or(RuntimeError::ReadRequired)?)
            .and_then(|file| file.sync_all())
            .map_err(|_| RuntimeError::ReadRequired)?;
        Ok(())
    }
    pub(crate) fn matches(&self, binding: &CommandRecoveryBinding) -> bool {
        self.binding == *binding
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AMBULATORY_COMMAND_PROTOCOL, AmbulatoryCommandOperation};
    use std::sync::{Arc, Barrier};
    fn marker(id: &str) -> AmbulatoryCommandMarker {
        AmbulatoryCommandMarker {
            protocol: AMBULATORY_COMMAND_PROTOCOL.into(),
            command_id: id.into(),
            original_archive_generation: "22222222-2222-4222-8222-222222222222".into(),
            original_scope_id: "scope".into(),
            ambulatory_id: "target".into(),
            expected_version: 1,
            operation: AmbulatoryCommandOperation::ClearTest,
            plan_digest: "a".repeat(64),
        }
    }
    fn binding() -> CommandRecoveryBinding {
        CommandRecoveryBinding {
            host_origin: "http://127.0.0.1:1234".into(),
            actor_id: "synthetic-admin".into(),
            device_id: "synthetic-device".into(),
        }
    }
    fn store() -> AmbulatoryCommandRecoveryStore {
        let mut b = [0; 16];
        getrandom::fill(&mut b).unwrap();
        let name: String = b.iter().map(|byte| format!("{byte:02x}")).collect();
        #[cfg(not(windows))]
        let root = std::env::temp_dir();
        #[cfg(windows)]
        let root = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap());
        let dir = root
            .canonicalize()
            .unwrap()
            .join(format!("mediflow-command-recovery-{name}"));
        AmbulatoryCommandRecoveryStore::new(&dir, binding()).unwrap()
    }
    #[test]
    fn ambulatory_command_recovery_persists_only_bound_marker_and_survives_reopen() {
        let store = store();
        let marker = marker("11111111-1111-4111-8111-111111111111");
        let proof = store.persist(&marker).unwrap();
        assert_eq!(proof.marker(), &marker);
        let reopened =
            AmbulatoryCommandRecoveryStore::new(store.path.parent().unwrap(), binding()).unwrap();
        assert_eq!(reopened.load(), Ok(Some(marker.clone())));
        proof.verify(&binding(), &marker).unwrap();
        let bytes = fs::read_to_string(&store.path).unwrap();
        for secret in [
            "cookie", "control", "token", "password", "patient", "name", "dose", "audit",
        ] {
            assert!(!bytes.contains(secret));
        }
        assert!(
            store
                .persist(&self::marker("33333333-3333-4333-8333-333333333333"))
                .is_err()
        );
        assert_eq!(store.load(), Ok(Some(marker)));
        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }
    #[test]
    fn ambulatory_command_recovery_rejects_damage_changes_and_foreign_bindings_before_dispatch() {
        let store = store();
        let marker = marker("11111111-1111-4111-8111-111111111111");
        let proof = store.persist(&marker).unwrap();
        let original = fs::read(&store.path).unwrap();
        fs::write(&store.path, b"{").unwrap();
        assert_eq!(store.load(), Err(RuntimeError::ReadRequired));
        assert!(proof.verify(&binding(), &marker).is_err());
        assert_eq!(fs::read(&store.path).unwrap(), b"{");
        fs::write(&store.path, &original).unwrap();
        let mut foreign = binding();
        foreign.actor_id = "other".into();
        assert!(proof.verify(&foreign, &marker).is_err());
        let mut value: serde_json::Value = serde_json::from_slice(&original).unwrap();
        value["cookie"] = serde_json::json!("forged");
        fs::write(&store.path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(store.load().is_err());
        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }
    #[test]
    fn ambulatory_command_recovery_two_writers_cannot_replace_each_others_marker() {
        let store = store();
        let barrier = Arc::new(Barrier::new(3));
        let mut tasks = Vec::new();
        for id in [
            "11111111-1111-4111-8111-111111111111",
            "33333333-3333-4333-8333-333333333333",
        ] {
            let store = store.clone();
            let barrier = barrier.clone();
            tasks.push(std::thread::spawn(move || {
                barrier.wait();
                store.persist(&marker(id)).is_ok()
            }));
        }
        barrier.wait();
        assert_eq!(
            tasks
                .into_iter()
                .map(|t| usize::from(t.join().unwrap()))
                .sum::<usize>(),
            1
        );
        assert!(store.load().unwrap().is_some());
        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }
    #[test]
    fn ambulatory_command_recovery_ack_requires_transport_terminal_and_exact_retirement_without_removing_a_new_marker()
     {
        let store = store();
        let marker = marker("11111111-1111-4111-8111-111111111111");
        store.persist(&marker).unwrap();
        let mut wire = serde_json::to_value(&marker).unwrap();
        wire.as_object_mut().unwrap().extend(
            serde_json::json!({"outcome":"closed","reason":null,"committedAt":1,"result":null})
                .as_object()
                .unwrap()
                .clone(),
        );
        let bytes = serde_json::to_vec(
            &serde_json::json!({"outcome":"terminal","historical":true,"receipt":wire}),
        )
        .unwrap();
        let retirement = AmbulatoryCommandRetirement {
            binding: binding(),
            command_id: marker.command_id.clone(),
        };
        let parsed = crate::AmbulatoryCommandRead::parse(&bytes, &marker, false).unwrap();
        let crate::AmbulatoryCommandRead::Terminal(unbound) = &parsed else {
            panic!()
        };
        assert!(
            store
                .acknowledge_terminal(&marker, unbound, &retirement)
                .is_err()
        );
        let crate::AmbulatoryCommandRead::Terminal(terminal) = parsed.bind(&binding()) else {
            panic!()
        };
        let wrong = AmbulatoryCommandRetirement {
            binding: binding(),
            command_id: "33333333-3333-4333-8333-333333333333".into(),
        };
        assert!(
            store
                .acknowledge_terminal(&marker, &terminal, &wrong)
                .is_err()
        );
        assert_eq!(store.load(), Ok(Some(marker.clone())));
        store
            .acknowledge_terminal(&marker, &terminal, &retirement)
            .unwrap();
        let replacement = self::marker("33333333-3333-4333-8333-333333333333");
        store.persist(&replacement).unwrap();
        assert!(
            store
                .acknowledge_terminal(&marker, &terminal, &retirement)
                .is_err()
        );
        assert_eq!(store.load(), Ok(Some(replacement)));
        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn ambulatory_command_recovery_rejects_marker_with_other_sid_write_access() {
        let store = store();
        let marker = marker("11111111-1111-4111-8111-111111111111");
        store.persist(&marker).unwrap();
        assert!(
            std::process::Command::new("icacls")
                .arg(&store.path)
                .args(["/grant", "*S-1-5-32-545:W"])
                .status()
                .unwrap()
                .success()
        );
        assert_eq!(store.load(), Err(RuntimeError::ReadRequired));
        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn ambulatory_command_recovery_denies_symlink_and_shared_hardlink_without_touching_target() {
        let store = store();
        let marker = marker("11111111-1111-4111-8111-111111111111");
        store.persist(&marker).unwrap();
        let original = fs::read(&store.path).unwrap();
        let copy = store.path.with_extension("copy");
        fs::rename(&store.path, &copy).unwrap();
        std::os::unix::fs::symlink(&copy, &store.path).unwrap();
        assert!(store.load().is_err());
        assert!(store.persist(&marker).is_err());
        assert_eq!(fs::read(&copy).unwrap(), original);
        fs::remove_file(&store.path).unwrap();
        fs::hard_link(&copy, &store.path).unwrap();
        assert!(store.load().is_err());
        assert_eq!(fs::read(&copy).unwrap(), original);
        fs::remove_dir_all(store.path.parent().unwrap()).unwrap();
    }
}
