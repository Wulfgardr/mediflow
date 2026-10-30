use mediflow_runtime_client::ChatTherapyOutcome;
use std::{
    ffi::OsString,
    fs,
    io::{self, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::PathBuf,
};

#[derive(Default)]
pub(crate) struct ReferenceScan {
    pub(crate) ids: Vec<String>,
    pub(crate) invalid: Vec<OsString>,
}

#[derive(Clone)]
pub(crate) struct CommandReferences {
    root: Option<PathBuf>,
    path: Option<PathBuf>,
}
impl Default for CommandReferences {
    fn default() -> Self {
        #[cfg(test)]
        return Self::new(Some(std::env::temp_dir().canonicalize().unwrap().join(
            format!(
                "mf-chat-commands-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ),
        )));
        #[cfg(not(test))]
        Self::new(None)
    }
}
impl CommandReferences {
    pub(crate) fn new(path: Option<PathBuf>) -> Self {
        Self {
            root: path.clone(),
            path,
        }
    }
    pub(crate) fn for_session(&self, session: &mediflow_runtime_client::RuntimeSession) -> Self {
        Self {
            root: self.root.clone(),
            path: self
                .root
                .as_ref()
                .map(|p| p.join(session.chat_therapy_reference_namespace())),
        }
    }
    fn directory(&self) -> io::Result<&std::path::Path> {
        let path = self.path.as_deref().ok_or(io::ErrorKind::NotFound)?;
        if !path.is_absolute() {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700).recursive(true);
        let root = self.root.as_deref().ok_or(io::ErrorKind::NotFound)?;
        builder.create(root)?;
        let meta = fs::symlink_metadata(root)?;
        if !meta.is_dir()
            || root.canonicalize()? != root
            || meta.uid() != super::native::uid()
            || meta.permissions().mode() & 0o777 != 0o700
        {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        builder.create(path)?;
        for directory in [path, path.parent().ok_or(io::ErrorKind::InvalidInput)?] {
            let meta = fs::symlink_metadata(directory)?;
            if !meta.is_dir()
                || directory.canonicalize()? != directory
                || meta.uid() != super::native::uid()
                || (directory == path && meta.permissions().mode() & 0o777 != 0o700)
            {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
        }
        Ok(path)
    }
    fn valid(id: &str) -> bool {
        id.len() == 36
            && id.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            })
    }
    #[cfg(all(test, target_os = "macos"))]
    pub(crate) fn pending(&self) -> io::Result<Vec<String>> {
        Ok(self.scan()?.ids)
    }
    pub(crate) fn scan(&self) -> io::Result<ReferenceScan> {
        if self.path.is_none() {
            return Ok(ReferenceScan::default());
        }
        let path = self.directory()?;
        let mut scan = ReferenceScan::default();
        for entry in fs::read_dir(path)? {
            let name = entry?.file_name();
            if name == ".quarantine" {
                continue;
            }
            match name.to_str() {
                Some(id) if self.verify(id).is_ok() => scan.ids.push(id.to_owned()),
                _ => scan.invalid.push(name),
            }
        }
        scan.ids.sort();
        Ok(scan)
    }
    pub(crate) fn quarantine_invalid(&self) -> io::Result<()> {
        let scan = self.scan()?;
        let directory = self.directory()?;
        let quarantine = directory.join(".quarantine");
        fs::DirBuilder::new()
            .mode(0o700)
            .recursive(true)
            .create(&quarantine)?;
        let meta = fs::symlink_metadata(&quarantine)?;
        if !meta.is_dir()
            || quarantine.canonicalize()? != quarantine
            || meta.uid() != super::native::uid()
            || meta.permissions().mode() & 0o777 != 0o700
        {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        let batch = quarantine.join(Self::temporary_name()?);
        fs::DirBuilder::new().mode(0o700).create(&batch)?;
        for name in scan.invalid {
            if name.to_str().is_some_and(|id| self.verify(id).is_ok()) {
                continue;
            }
            fs::rename(directory.join(&name), batch.join(name))?;
        }
        fs::File::open(&batch)?.sync_all()?;
        fs::File::open(&quarantine)?.sync_all()?;
        fs::File::open(directory)?.sync_all()
    }
    fn temporary_name() -> io::Result<String> {
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(io::Error::other)?;
        Ok(format!(".pending-{:032x}", u128::from_ne_bytes(random)))
    }
    fn verify(&self, id: &str) -> io::Result<()> {
        if !Self::valid(id) {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let path = self.directory()?.join(id);
        let meta = fs::symlink_metadata(&path)?;
        if !meta.is_file()
            || meta.uid() != super::native::uid()
            || meta.permissions().mode() & 0o777 != 0o600
            || meta.len() != 36
            || fs::read_to_string(&path)? != id
        {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        Ok(())
    }
    fn stage(&self, id: &str) -> io::Result<PathBuf> {
        let path = self.directory()?.join(Self::temporary_name()?);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)?;
        file.write_all(id.as_bytes())?;
        file.sync_all()?;
        Ok(path)
    }
    pub(crate) fn remember(&self, id: &str) -> io::Result<()> {
        if !Self::valid(id) {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let directory = self.directory()?;
        match fs::symlink_metadata(directory.join(id)) {
            Ok(_) => return self.verify(id),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let temporary = self.stage(id)?;
        fs::rename(temporary, directory.join(id))?;
        fs::File::open(directory)?.sync_all()
    }
    pub(crate) fn confirm(&self, id: &str, _outcome: ChatTherapyOutcome) -> io::Result<()> {
        self.verify(id)?;
        fs::remove_file(self.directory()?.join(id))?;
        fs::File::open(self.directory()?)?.sync_all()
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn unconfigured_store_has_no_recovery_but_cannot_authorize() {
        let store = CommandReferences::new(None);
        assert!(store.scan().unwrap().ids.is_empty());
        assert!(store.scan().unwrap().invalid.is_empty());
        assert!(
            store
                .remember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
                .is_err()
        );
    }
    #[test]
    fn restart_keeps_only_opaque_reference_until_server_confirmation() {
        let path = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("mf-chat-persist-{}", std::process::id()));
        let store = CommandReferences::new(Some(path.clone()));
        let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        store.remember(id).unwrap();
        drop(store);
        let reopened = CommandReferences::new(Some(path.clone()));
        assert_eq!(
            reopened.pending().unwrap(),
            [id],
            "crash recovery lost unresolved command"
        );
        assert_eq!(fs::read_to_string(path.join(id)).unwrap(), id);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(path.join(id)).unwrap().permissions().mode() & 0o777,
            0o600
        );
        reopened.confirm(id, ChatTherapyOutcome::Retired).unwrap();
        assert!(reopened.pending().unwrap().is_empty());
        fs::remove_dir(path).unwrap();
    }
    #[test]
    fn incomplete_marker_does_not_hide_a_valid_command_and_can_be_quarantined() {
        let store = CommandReferences::default();
        let valid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let invalid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        store.remember(valid).unwrap();
        let directory = store.directory().unwrap().to_owned();
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(directory.join(invalid))
            .unwrap();
        assert_eq!(
            store.pending().unwrap(),
            [valid],
            "invalid marker hid a valid command"
        );
        assert_eq!(store.scan().unwrap().invalid, [OsString::from(invalid)]);
        store.quarantine_invalid().unwrap();
        assert_eq!(store.pending().unwrap(), [valid]);
        assert!(store.scan().unwrap().invalid.is_empty());
        let saved: Vec<_> = fs::read_dir(directory.join(".quarantine"))
            .unwrap()
            .collect();
        assert_eq!(saved.len(), 1);
        assert_eq!(
            fs::metadata(saved[0].as_ref().unwrap().path().join(invalid))
                .unwrap()
                .len(),
            0
        );
        assert_eq!(fs::read_to_string(directory.join(valid)).unwrap(), valid);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn interrupted_staging_never_publishes_a_partial_command() {
        let store = CommandReferences::default();
        let valid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let staged = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        store.remember(valid).unwrap();
        let temporary = store.stage(staged).unwrap();
        assert!(
            !store.directory().unwrap().join(staged).exists(),
            "staging published the final filename before rename"
        );
        assert_eq!(fs::read_to_string(&temporary).unwrap(), staged);
        assert_eq!(store.pending().unwrap(), [valid]);
        store.remember(staged).unwrap();
        assert_eq!(store.pending().unwrap(), [valid, staged]);
        store.quarantine_invalid().unwrap();
        assert_eq!(store.pending().unwrap(), [valid, staged]);
        fs::remove_dir_all(store.directory().unwrap()).unwrap();
    }

    #[test]
    fn unsafe_storage_blocks_authorization_without_following_links() {
        let store = CommandReferences::default();
        let path = store.path.clone().unwrap();
        store.pending().unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            store
                .remember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
                .is_err()
        );
        fs::remove_dir(path).unwrap();
    }
}

#[cfg(all(test, not(target_os = "macos")))]
mod unsupported_tests {
    use super::*;
    #[test]
    fn unsupported_system_cannot_publish_native_command_authority() {
        let store = CommandReferences::default();
        assert!(
            store
                .remember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
                .is_err()
        );
        assert!(store.scan().is_err());
        fs::remove_dir_all(store.root.unwrap()).unwrap();
    }
}
