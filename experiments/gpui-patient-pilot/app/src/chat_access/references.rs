use mediflow_runtime_client::ChatTherapyOutcome;
use std::{
    fs,
    io::{self, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::PathBuf,
};

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
    pub(crate) fn pending(&self) -> io::Result<Vec<String>> {
        let path = self.directory()?;
        let mut ids = Vec::new();
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let id = entry
                .file_name()
                .into_string()
                .map_err(|_| io::ErrorKind::InvalidData)?;
            self.verify(&id)?;
            ids.push(id);
        }
        ids.sort();
        Ok(ids)
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
    pub(crate) fn remember(&self, id: &str) -> io::Result<()> {
        if !Self::valid(id) {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let directory = self.directory()?;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(directory.join(id))
        {
            Ok(mut file) => {
                file.write_all(id.as_bytes())?;
                file.sync_all()?;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                self.verify(id)?;
            }
            Err(error) => return Err(error),
        }
        fs::File::open(directory)?.sync_all()
    }
    pub(crate) fn confirm(&self, id: &str, _outcome: ChatTherapyOutcome) -> io::Result<()> {
        self.verify(id)?;
        fs::remove_file(self.directory()?.join(id))?;
        fs::File::open(self.directory()?)?.sync_all()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
