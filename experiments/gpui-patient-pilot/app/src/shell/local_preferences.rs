use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::{Value, json};

const MAX_BYTES: u64 = 4096;
pub(super) const TEXT_SCALES: [f32; 6] = [1., 1.25, 1.5, 2., 3., 4.];

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct LocalPreferences {
    pub dark_override: Option<bool>,
    pub text_scale: f32,
    pub increased_contrast: bool,
    pub privacy_shield: bool,
}

impl Default for LocalPreferences {
    fn default() -> Self {
        Self {
            dark_override: None,
            text_scale: 1.,
            increased_contrast: false,
            privacy_shield: false,
        }
    }
}

impl LocalPreferences {
    fn parse(bytes: &[u8]) -> Option<Self> {
        let value: Value = serde_json::from_slice(bytes).ok()?;
        let object = value.as_object()?;
        if object.len() != 5 || value["version"].as_u64()? != 1 {
            return None;
        }
        let dark_override = match value["appearance"].as_str()? {
            "system" => None,
            "day" => Some(false),
            "graphite" => Some(true),
            _ => return None,
        };
        let raw_scale = value["textScale"].as_f64()?;
        let text_scale = TEXT_SCALES
            .into_iter()
            .find(|scale| f64::from(*scale) == raw_scale)?;
        Some(Self {
            dark_override,
            text_scale,
            increased_contrast: value["increasedContrast"].as_bool()?,
            privacy_shield: value["privacyShield"].as_bool()?,
        })
    }

    fn bytes(self) -> io::Result<Vec<u8>> {
        if !TEXT_SCALES.contains(&self.text_scale) {
            return Err(io::Error::from(io::ErrorKind::InvalidInput));
        }
        serde_json::to_vec(&json!({
            "version": 1,
            "appearance": match self.dark_override {
                None => "system", Some(false) => "day", Some(true) => "graphite",
            },
            "textScale": self.text_scale,
            "increasedContrast": self.increased_contrast,
            "privacyShield": self.privacy_shield,
        }))
        .map_err(io::Error::other)
    }
}

pub(crate) struct LocalPreferencesStore {
    path: Option<PathBuf>,
}

impl LocalPreferencesStore {
    pub(crate) fn from_directory(directory: &Path) -> io::Result<Self> {
        if !directory.is_absolute() {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let canonical = directory.canonicalize()?;
        let metadata = fs::symlink_metadata(directory)?;
        if canonical.as_os_str() != directory.as_os_str() || !metadata.is_dir() {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        #[cfg(unix)]
        {
            unsafe extern "C" {
                fn geteuid() -> u32;
            }
            if !private_directory(&metadata, unsafe { geteuid() }) {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            Ok(Self {
                path: Some(directory.join("preferences.json")),
            })
        }
        #[cfg(not(unix))]
        {
            Err(io::ErrorKind::Unsupported.into())
        }
    }
    pub(super) fn system() -> Self {
        #[cfg(test)]
        {
            Self { path: None }
        }
        #[cfg(not(test))]
        {
            Self {
                path: preferences_path(),
            }
        }
    }

    pub(super) fn ambulatory_command_directory(&self) -> Option<PathBuf> {
        let parent = self.path.as_ref()?.parent()?;
        let canonical = parent
            .canonicalize()
            .unwrap_or_else(|_| parent.to_path_buf());
        Some(canonical.join("ambulatory-command-recovery"))
    }

    pub(super) fn load(&self) -> (LocalPreferences, bool) {
        let Some(path) = &self.path else {
            return (
                LocalPreferences {
                    privacy_shield: !cfg!(test),
                    ..Default::default()
                },
                !cfg!(test),
            );
        };
        let read = || -> io::Result<LocalPreferences> {
            regular_file(path)?;
            let mut bytes = Vec::new();
            fs::File::open(path)?
                .take(MAX_BYTES + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() as u64 > MAX_BYTES {
                return Err(io::Error::from(io::ErrorKind::InvalidData));
            }
            LocalPreferences::parse(&bytes)
                .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidData))
        };
        match read() {
            Ok(preferences) => (preferences, false),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                (LocalPreferences::default(), false)
            }
            Err(_) => (
                LocalPreferences {
                    privacy_shield: true,
                    ..Default::default()
                },
                true,
            ),
        }
    }

    pub(super) fn save(&self, preferences: LocalPreferences) -> io::Result<()> {
        let bytes = preferences.bytes()?;
        let Some(path) = &self.path else {
            return if cfg!(test) {
                Ok(())
            } else {
                Err(io::Error::from(io::ErrorKind::NotFound))
            };
        };
        let parent = path
            .parent()
            .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
        fs::create_dir_all(parent)?;
        match regular_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        static NEXT_FILE: AtomicU64 = AtomicU64::new(0);
        let temporary = parent.join(format!(
            ".preferences-{}-{}.tmp",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        let result = (|| {
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

#[cfg(unix)]
fn private_directory(metadata: &fs::Metadata, uid: u32) -> bool {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    metadata.uid() == uid && metadata.permissions().mode() & 0o777 == 0o700
}

fn regular_file(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.file_type().is_file() {
        Ok(())
    } else {
        Err(io::Error::from(io::ErrorKind::InvalidData))
    }
}

#[cfg(not(test))]
fn preferences_path() -> Option<PathBuf> {
    fn directory(name: &str) -> Option<PathBuf> {
        std::env::var_os(name)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
    }
    #[cfg(target_os = "macos")]
    let parent = directory("HOME")?.join("Library/Application Support/MediFlow GPUI");
    #[cfg(target_os = "windows")]
    let parent = directory("LOCALAPPDATA")?.join("MediFlow GPUI");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let parent = directory("XDG_CONFIG_HOME")
        .or_else(|| directory("HOME").map(|home| home.join(".config")))?
        .join("mediflow-gpui");
    Some(parent.join("preferences.json"))
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub struct Fixture(pub PathBuf);

    impl Fixture {
        pub fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            Self(std::env::temp_dir().join(format!(
                "mediflow-local-preferences-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            )))
        }

        pub fn store(&self) -> LocalPreferencesStore {
            LocalPreferencesStore {
                path: Some(self.0.join("preferences.json")),
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    #[test]
    fn explicit_state_directory_is_owned_private_canonical_and_never_falls_back() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
        let fixture = Fixture::new();
        fs::create_dir(&fixture.0).unwrap();
        fs::set_permissions(&fixture.0, fs::Permissions::from_mode(0o700)).unwrap();
        let directory = fixture.0.canonicalize().unwrap();
        let store = LocalPreferencesStore::from_directory(&directory).unwrap();
        assert_eq!(
            store.path.as_deref(),
            Some(directory.join("preferences.json").as_path())
        );
        assert_eq!(
            store.ambulatory_command_directory(),
            Some(directory.join("ambulatory-command-recovery"))
        );
        let metadata = fs::metadata(&directory).unwrap();
        assert!(!private_directory(
            &metadata,
            metadata.uid().wrapping_add(1)
        ));
        assert!(LocalPreferencesStore::from_directory(Path::new("relative")).is_err());
        assert!(LocalPreferencesStore::from_directory(&directory.join("missing")).is_err());
        symlink(&directory, directory.join("alias")).unwrap();
        assert!(LocalPreferencesStore::from_directory(&directory.join("alias")).is_err());
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(LocalPreferencesStore::from_directory(&directory).is_err());
        assert!(!directory.join("preferences.json").exists());
        assert!(!directory.join("ambulatory-command-recovery").exists());
    }

    #[test]
    fn local_preferences_round_trip_replaces_all_visual_choices_and_nothing_else() {
        let fixture = Fixture::new();
        assert_eq!(fixture.store().load(), (LocalPreferences::default(), false));
        let selected = LocalPreferences {
            dark_override: Some(true),
            text_scale: 3.,
            increased_contrast: true,
            privacy_shield: true,
        };
        fixture.store().save(selected).unwrap();
        assert_eq!(fixture.store().load(), (selected, false));
        fixture.store().save(LocalPreferences::default()).unwrap();
        assert_eq!(fixture.store().load(), (LocalPreferences::default(), false));
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(fixture.0.join("preferences.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn local_preferences_corruption_is_covered_and_never_automatically_overwritten() {
        let fixture = Fixture::new();
        fixture.store().save(LocalPreferences::default()).unwrap();
        let path = fixture.0.join("preferences.json");
        for invalid in [
            b"{broken".to_vec(),
            vec![b' '; MAX_BYTES as usize + 1],
            br#"{"version":2}"#.to_vec(),
        ] {
            fs::write(&path, &invalid).unwrap();
            let (preferences, failed) = fixture.store().load();
            assert!(failed);
            assert!(preferences.privacy_shield);
            assert_eq!(fs::read(&path).unwrap(), invalid);
        }
    }

    #[test]
    fn local_preferences_reject_arbitrary_values_and_failed_write_preserves_saved_choices() {
        let fixture = Fixture::new();
        let selected = LocalPreferences {
            privacy_shield: true,
            ..Default::default()
        };
        fixture.store().save(selected).unwrap();
        for text_scale in [0., 1.1, 5., f32::NAN, f32::INFINITY] {
            assert!(
                fixture
                    .store()
                    .save(LocalPreferences {
                        text_scale,
                        ..selected
                    })
                    .is_err()
            );
            assert_eq!(fixture.store().load(), (selected, false));
        }
        let mut value: Value = serde_json::from_slice(&selected.bytes().unwrap()).unwrap();
        for (key, invalid) in [
            ("appearance", json!("custom")),
            ("privacyShield", json!("false")),
            ("textScale", json!(1.3)),
            ("extra", json!("patient")),
        ] {
            let mut value = value.clone();
            value[key] = invalid;
            assert!(LocalPreferences::parse(&serde_json::to_vec(&value).unwrap()).is_none());
        }
        value.as_object_mut().unwrap().remove("privacyShield");
        assert!(LocalPreferences::parse(&serde_json::to_vec(&value).unwrap()).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn local_preferences_never_follow_a_link_or_replace_its_target() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let target = fixture.0.join("original");
        fs::write(&target, b"original").unwrap();
        symlink(&target, fixture.0.join("preferences.json")).unwrap();
        assert!(fixture.store().load().1);
        assert!(fixture.store().save(LocalPreferences::default()).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"original");
    }
}
