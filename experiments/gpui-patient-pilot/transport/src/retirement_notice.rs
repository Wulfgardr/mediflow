use std::{
    collections::HashSet,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub const RETIREMENT_WARNING: &str = "Ritiro di una sessione locale non confermato. Verifica le sessioni dell’host prima di lasciare la postazione.";

struct State {
    markers: HashSet<String>,
    path: Option<PathBuf>,
    failed: bool,
}
#[derive(Clone)]
pub struct RetirementNotice(Arc<Mutex<State>>);
impl RetirementNotice {
    pub fn new(path: Option<PathBuf>) -> Self {
        let failed = path
            .as_ref()
            .is_some_and(|path| create_directory(&path.with_extension("pending")).is_err());
        Self(Arc::new(Mutex::new(State {
            markers: HashSet::new(),
            path,
            failed,
        })))
    }
    pub fn pending(&self) -> bool {
        let Ok(state) = self.0.lock() else {
            return true;
        };
        state.failed
            || !state.markers.is_empty()
            || state.path.as_ref().is_some_and(|path| {
                let legacy = match fs::read(path) {
                    Ok(bytes) => serde_json::from_slice::<usize>(&bytes).unwrap_or(1) > 0,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => false,
                    Err(_) => true,
                };
                legacy
                    || match fs::read_dir(path.with_extension("pending")) {
                        Ok(mut entries) => entries.next().is_some(),
                        Err(_) => true,
                    }
            })
    }
    pub(crate) fn begin(&self) -> String {
        let Ok(mut state) = self.0.lock() else {
            return String::new();
        };
        let marker = match crate::http::operation_uuid() {
            Ok(marker) => marker,
            Err(_) => {
                state.failed = true;
                return String::new();
            }
        };
        state.markers.insert(marker.clone());
        if let Some(path) = &state.path {
            let saved = (|| -> io::Result<()> {
                let directory = path.with_extension("pending");
                create_directory(&directory)?;
                let mut file = create_file(&directory.join(&marker))?;
                file.write_all(marker.as_bytes())?;
                file.sync_all()
            })();
            if saved.is_err() {
                state.failed = true;
                eprintln!("{RETIREMENT_WARNING}");
            }
        }
        marker
    }
    pub(crate) fn confirm(&self, marker: &str) {
        if let Ok(mut state) = self.0.lock() {
            if !state.markers.contains(marker) {
                return;
            }
            if let Some(path) = &state.path
                && fs::remove_file(path.with_extension("pending").join(marker)).is_err()
            {
                state.failed = true;
                return;
            }
            state.markers.remove(marker);
        }
    }
}

#[cfg(windows)]
fn create_directory(path: &Path) -> io::Result<()> {
    mediflow_local_state::create_directory(path)
}
#[cfg(not(windows))]
fn create_directory(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700);
    match builder.create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir()
        || metadata.uid() != fs::metadata(path.parent().ok_or(io::ErrorKind::InvalidInput)?)?.uid()
        || metadata.permissions().mode() & 0o777 != 0o700
    {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    Ok(())
}
#[cfg(windows)]
fn create_file(path: &Path) -> io::Result<fs::File> {
    mediflow_local_state::create_file(path)
}
#[cfg(not(windows))]
fn create_file(path: &Path) -> io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            #[cfg(windows)]
            let root = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap());
            #[cfg(not(windows))]
            let root = std::env::temp_dir();
            Self(root.join(format!(
                "mediflow-retirement-{}",
                crate::http::operation_uuid().unwrap()
            )))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn two_instances_only_confirm_their_own_retirement() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let path = fixture.0.join("retirement.json");
        let a = RetirementNotice::new(Some(path.clone()));
        let b = RetirementNotice::new(Some(path.clone()));
        assert!(!a.pending());
        assert!(!b.pending());
        let a_marker = a.begin();
        let b_marker = b.begin();
        assert_ne!(a_marker, b_marker);
        b.confirm(&a_marker);
        b.confirm(&b_marker);
        assert!(b.pending());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path.with_extension("pending"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(path.with_extension("pending").join(&a_marker))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        #[cfg(windows)]
        {
            mediflow_local_state::verify_directory(&path.with_extension("pending")).unwrap();
            mediflow_local_state::open_read(&path.with_extension("pending").join(&a_marker))
                .unwrap();
        }
        assert!(RetirementNotice::new(Some(path.clone())).pending());
        assert_eq!(
            fs::read_to_string(path.with_extension("pending").join(&a_marker)).unwrap(),
            a_marker
        );
        a.confirm(&a_marker);
        assert!(!RetirementNotice::new(Some(path)).pending());
    }
    #[test]
    fn legacy_warning_cannot_be_confirmed_by_an_unrelated_retirement() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let path = fixture.0.join("retirement.json");
        fs::write(&path, b"1").unwrap();
        let notice = RetirementNotice::new(Some(path.clone()));
        let marker = notice.begin();
        notice.confirm(&marker);
        assert!(RetirementNotice::new(Some(path)).pending());
    }
    #[test]
    fn unreadable_marker_directory_keeps_warning() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let path = fixture.0.join("retirement.json");
        let notice = RetirementNotice::new(Some(path.clone()));
        fs::remove_dir(path.with_extension("pending")).unwrap();
        fs::write(path.with_extension("pending"), b"synthetic").unwrap();
        assert!(notice.pending());
        assert!(RetirementNotice::new(Some(path)).pending());
    }
}
