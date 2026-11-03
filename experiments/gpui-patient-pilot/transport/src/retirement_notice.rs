use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub const RETIREMENT_WARNING: &str = "Ritiro di una sessione locale non confermato. Verifica le sessioni dell’host prima di lasciare la postazione.";
pub const RETIREMENT_ORPHAN_GUIDANCE: &str = "Il ritiro non confermato risale a un avvio dell’app ormai chiuso. Dopo aver verificato nell’host che la sessione non è più attiva, puoi chiudere l’avviso. I ritiri ancora in corso in un’altra finestra aperta restano segnalati.";

struct State {
    /// Markers begun by this instance. The open file keeps an exclusive lock
    /// for as long as the instance lives; the OS releases it when the process
    /// ends, which is what tells a later start that the marker is orphaned.
    markers: HashMap<String, Option<fs::File>>,
    path: Option<PathBuf>,
    failed: bool,
    /// Orphans found at start and after a dismissal. Kept in memory so the
    /// shell does not open and lock marker files on every frame.
    orphaned: bool,
}
#[derive(Clone)]
pub struct RetirementNotice(Arc<Mutex<State>>);
impl RetirementNotice {
    pub fn new(path: Option<PathBuf>) -> Self {
        let failed = path
            .as_ref()
            .is_some_and(|path| create_directory(&path.with_extension("pending")).is_err());
        let mut state = State {
            markers: HashMap::new(),
            path,
            failed,
            orphaned: false,
        };
        state.orphaned = scan_orphans(&state);
        Self(Arc::new(Mutex::new(state)))
    }
    pub fn pending(&self) -> bool {
        let Ok(state) = self.0.lock() else {
            return true;
        };
        state.failed
            || !state.markers.is_empty()
            || state.path.as_ref().is_some_and(|path| {
                match fs::read_dir(path.with_extension("pending")) {
                    Ok(mut entries) => entries.next().is_some(),
                    Err(_) => true,
                }
            })
    }
    /// True when, at start or after the last dismissal, at least one marker on
    /// disk belonged to no running instance: its owner's lock was free and the
    /// file carried its complete name.
    pub fn orphaned(&self) -> bool {
        self.0.lock().is_ok_and(|state| state.orphaned)
    }
    /// Removes only orphaned markers. Markers held by a running instance,
    /// unreadable entries and this instance's own retirements stay pending.
    pub fn dismiss_orphaned(&self) -> io::Result<()> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| io::Error::other("retirement state"))?;
        let removed = remove_orphans(&state);
        state.orphaned = scan_orphans(&state);
        removed
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
        let mut held = None;
        if let Some(path) = &state.path {
            let saved = (|| -> io::Result<fs::File> {
                let directory = path.with_extension("pending");
                create_directory(&directory)?;
                let mut file = create_file(&directory.join(&marker))?;
                file.lock()?;
                file.write_all(marker.as_bytes())?;
                file.sync_all()?;
                Ok(file)
            })();
            match saved {
                Ok(file) => held = Some(file),
                Err(_) => {
                    state.failed = true;
                    eprintln!("{RETIREMENT_WARNING}");
                }
            }
        }
        state.markers.insert(marker.clone(), held);
        marker
    }
    pub(crate) fn confirm(&self, marker: &str) {
        if let Ok(mut state) = self.0.lock() {
            let Some(held) = state.markers.get_mut(marker) else {
                return;
            };
            // Windows refuses to delete a file that is still open.
            drop(held.take());
            if let Some(path) = &state.path {
                match fs::remove_file(path.with_extension("pending").join(marker)) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(_) => {
                        state.failed = true;
                        return;
                    }
                }
            }
            state.markers.remove(marker);
        }
    }
}

fn scan_orphans(state: &State) -> bool {
    foreign_markers(state)
        .is_ok_and(|markers| markers.iter().any(|marker| claim_orphan(marker).is_some()))
}

fn remove_orphans(state: &State) -> io::Result<()> {
    for marker in foreign_markers(state)? {
        if let Some(claim) = claim_orphan(&marker) {
            // Windows refuses to delete a file that is still open.
            drop(claim);
            match fs::remove_file(&marker) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
    }
    Ok(())
}

fn foreign_markers(state: &State) -> io::Result<Vec<PathBuf>> {
    let Some(path) = &state.path else {
        return Ok(Vec::new());
    };
    let mut markers = Vec::new();
    for entry in fs::read_dir(path.with_extension("pending"))? {
        let entry = entry?;
        let own = entry
            .file_name()
            .to_str()
            .is_some_and(|name| state.markers.contains_key(name));
        if !own {
            markers.push(entry.path());
        }
    }
    Ok(markers)
}

/// Returns the locked marker when nobody else holds it and its content is
/// its own name. A marker still being written, a directory, a link or a file
/// another process keeps open is never treated as orphaned.
fn claim_orphan(marker: &Path) -> Option<fs::File> {
    let name = marker.file_name()?.to_str()?;
    if !fs::symlink_metadata(marker).ok()?.is_file() {
        return None;
    }
    #[cfg(windows)]
    let mut file = mediflow_local_state::open_write(marker).ok()?;
    #[cfg(not(windows))]
    let mut file = fs::File::open(marker).ok()?;
    file.try_lock().ok()?;
    let mut content = Vec::new();
    (&mut file)
        .take(name.len() as u64 + 1)
        .read_to_end(&mut content)
        .ok()?;
    (content == name.as_bytes()).then_some(file)
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
            // A live instance keeps its marker open without sharing, so no
            // other process can read, claim or delete it as an orphan.
            let held =
                mediflow_local_state::open_read(&path.with_extension("pending").join(&a_marker))
                    .unwrap_err();
            assert_eq!(held.raw_os_error(), Some(32), "{held}");
        }
        assert!(RetirementNotice::new(Some(path.clone())).pending());
        #[cfg(not(windows))]
        assert_eq!(
            fs::read_to_string(path.with_extension("pending").join(&a_marker)).unwrap(),
            a_marker
        );
        a.confirm(&a_marker);
        assert!(!RetirementNotice::new(Some(path)).pending());
    }
    #[test]
    fn orphaned_marker_after_restart_is_dismissed_but_an_active_one_stays() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let path = fixture.0.join("retirement.json");
        let active = RetirementNotice::new(Some(path.clone()));
        let active_marker = active.begin();
        let closed = RetirementNotice::new(Some(path.clone()));
        let closed_marker = closed.begin();
        drop(closed);
        let restarted = RetirementNotice::new(Some(path.clone()));
        assert!(restarted.pending());
        assert!(restarted.orphaned());
        restarted.dismiss_orphaned().unwrap();
        assert!(!path.with_extension("pending").join(&closed_marker).exists());
        assert!(path.with_extension("pending").join(&active_marker).exists());
        assert!(!restarted.orphaned());
        assert!(RetirementNotice::new(Some(path.clone())).pending());
        active.confirm(&active_marker);
        assert!(!RetirementNotice::new(Some(path)).pending());
    }
    #[test]
    fn a_running_instance_does_not_offer_its_own_marker_as_orphaned() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let path = fixture.0.join("retirement.json");
        let notice = RetirementNotice::new(Some(path.clone()));
        let marker = notice.begin();
        assert!(!notice.orphaned());
        notice.dismiss_orphaned().unwrap();
        assert!(notice.pending());
        assert!(path.with_extension("pending").join(marker).exists());
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
