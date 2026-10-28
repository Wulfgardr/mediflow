#[cfg(windows)]
use mediflow_local_state as windows_private_directory;
use std::{
    fs::{self},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::{Value, json};

const MAX_BYTES: u64 = 4096;
pub(crate) const TEXT_SCALES: [f32; 6] = [1., 1.25, 1.5, 2., 3., 4.];

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LocalPreferences {
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
    initial_error: Option<String>,
}

impl LocalPreferencesStore {
    pub(crate) fn from_directory(directory: &Path) -> io::Result<Self> {
        if !directory.is_absolute() {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let canonical = directory.canonicalize()?;
        let metadata = fs::symlink_metadata(directory)?;
        if (!cfg!(windows) && canonical.as_os_str() != directory.as_os_str()) || !metadata.is_dir()
        {
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
                initial_error: None,
            })
        }
        #[cfg(windows)]
        {
            windows_private_directory::verify_directory(directory)?;
            Ok(Self {
                path: Some(canonical.join("preferences.json")),
                initial_error: None,
            })
        }
        #[cfg(not(any(unix, windows)))]
        {
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                crate::STATE_DIRECTORY_UNSUPPORTED,
            ))
        }
    }
    pub(crate) fn system() -> Self {
        #[cfg(test)]
        {
            Self {
                path: None,
                initial_error: None,
            }
        }
        #[cfg(not(test))]
        {
            match preferences_path() {
                Ok(path) => Self {
                    path: Some(path),
                    initial_error: None,
                },
                Err(error) => Self {
                    path: None,
                    initial_error: Some(error.to_string()),
                },
            }
        }
    }

    pub(crate) fn ambulatory_command_directory(&self) -> io::Result<Option<PathBuf>> {
        if let Some(error) = &self.initial_error {
            return Err(io::Error::other(error.clone()));
        }
        let Some(path) = &self.path else {
            return Ok(None);
        };
        let parent = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
        let canonical = parent
            .canonicalize()
            .unwrap_or_else(|_| parent.to_path_buf());
        let directory = canonical.join("ambulatory-command-recovery");
        #[cfg(windows)]
        {
            windows_private_directory::verify_directory(&canonical)?;
            windows_private_directory::create_directory(&directory)?;
            for entry in fs::read_dir(&directory)? {
                windows_private_directory::open_read(&entry?.path())?;
            }
        }
        Ok(Some(directory))
    }

    fn read(&self) -> io::Result<LocalPreferences> {
        if let Some(error) = &self.initial_error {
            return Err(io::Error::other(error.clone()));
        }
        let Some(path) = &self.path else {
            return if cfg!(test) {
                Ok(LocalPreferences::default())
            } else {
                Err(io::ErrorKind::NotFound.into())
            };
        };
        #[cfg(not(windows))]
        regular_file(path)?;
        #[cfg(windows)]
        let file = windows_private_directory::open_read(path)?;
        #[cfg(not(windows))]
        let file = fs::File::open(path)?;
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(io::ErrorKind::InvalidData.into());
        }
        LocalPreferences::parse(&bytes).ok_or_else(|| io::Error::from(io::ErrorKind::InvalidData))
    }

    pub(crate) fn load_with_error(&self) -> (LocalPreferences, Option<String>) {
        match self.read() {
            Ok(preferences) => (preferences, None),
            Err(error)
                if error.kind() == io::ErrorKind::NotFound && self.initial_error.is_none() =>
            {
                (LocalPreferences::default(), None)
            }
            Err(error) => (
                LocalPreferences {
                    privacy_shield: true,
                    ..Default::default()
                },
                Some(error.to_string()),
            ),
        }
    }

    #[cfg(test)]
    pub(crate) fn load(&self) -> (LocalPreferences, bool) {
        let (preferences, error) = self.load_with_error();
        (preferences, error.is_some())
    }

    pub(crate) fn save(&self, preferences: LocalPreferences) -> io::Result<()> {
        let bytes = preferences.bytes()?;
        if let Some(error) = &self.initial_error {
            return Err(io::Error::other(error.clone()));
        }
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
        #[cfg(not(windows))]
        fs::create_dir_all(parent)?;
        #[cfg(windows)]
        windows_private_directory::verify_directory(parent)?;
        #[cfg(windows)]
        let existing = windows_private_directory::open_read(path).map(|_| ());
        #[cfg(not(windows))]
        let existing = regular_file(path);
        match existing {
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
        #[cfg(windows)]
        let mut file = windows_private_directory::create_file(&temporary)?;
        #[cfg(not(windows))]
        let mut file = {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options.open(&temporary)?
        };
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

#[cfg(not(windows))]
fn regular_file(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.file_type().is_file() {
        Ok(())
    } else {
        Err(io::Error::from(io::ErrorKind::InvalidData))
    }
}

#[cfg(not(test))]
fn preferences_path() -> io::Result<PathBuf> {
    fn directory(name: &str) -> io::Result<PathBuf> {
        std::env::var_os(name)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("Cartella di stato non configurata: {name}."),
                )
            })
    }
    #[cfg(target_os = "macos")]
    let parent = directory("HOME")?.join("Library/Application Support/MediFlow GPUI");
    #[cfg(target_os = "windows")]
    let parent = directory("LOCALAPPDATA")?.join("MediFlow GPUI");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let parent = directory("XDG_CONFIG_HOME")
        .or_else(|_| directory("HOME").map(|home| home.join(".config")))?
        .join("mediflow-gpui");
    #[cfg(windows)]
    windows_private_directory::create_directory(&parent)?;
    Ok(parent.join("preferences.json"))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub struct Fixture(pub PathBuf);

    impl Fixture {
        pub fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            #[cfg(not(windows))]
            let root = std::env::temp_dir();
            #[cfg(windows)]
            let root = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap());
            Self(root.join(format!(
                "mediflow-local-preferences-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            )))
        }

        pub fn store(&self) -> LocalPreferencesStore {
            #[cfg(windows)]
            windows_private_directory::create_directory(&self.0).unwrap();
            LocalPreferencesStore {
                path: Some(self.0.join("preferences.json")),
                initial_error: None,
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
            store.ambulatory_command_directory().unwrap(),
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

    #[cfg(not(any(unix, windows)))]
    #[test]
    fn explicit_state_directory_reports_platform_support_instead_of_privacy_failure() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let error = LocalPreferencesStore::from_directory(&fixture.0.canonicalize().unwrap())
            .err()
            .expect("explicit directories are unsupported on this platform");
        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
        assert_eq!(error.to_string(), crate::STATE_DIRECTORY_UNSUPPORTED);
    }

    #[cfg(windows)]
    #[test]
    fn windows_state_directory_requires_owner_only_acl_and_persists() {
        let fixture = Fixture::new();
        windows_private_directory::create_directory(&fixture.0).unwrap();
        let store = LocalPreferencesStore::from_directory(&fixture.0).unwrap();
        let selected = LocalPreferences {
            dark_override: Some(true),
            ..Default::default()
        };
        store.save(selected).unwrap();
        store.save(selected).unwrap();
        assert_eq!(store.load(), (selected, false));
        let status = std::process::Command::new("icacls")
            .arg(&fixture.0)
            .args(["/grant", "*S-1-1-0:(OI)(CI)R"])
            .status()
            .unwrap();
        assert!(status.success());
        assert!(LocalPreferencesStore::from_directory(&fixture.0).is_err());
    }

    #[cfg(windows)]
    fn set_windows_dacl(path: &Path, inheritance: &str, protected: bool, other: bool) {
        use std::{os::windows::ffi::OsStrExt, ptr};
        use windows_sys::Win32::{
            Foundation::LocalFree,
            Security::{Authorization::*, *},
        };
        unsafe {
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            let mut owner = ptr::null_mut();
            let mut owner_descriptor = ptr::null_mut();
            assert_eq!(
                GetNamedSecurityInfoW(
                    wide.as_ptr(),
                    SE_FILE_OBJECT,
                    OWNER_SECURITY_INFORMATION,
                    &mut owner,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    &mut owner_descriptor
                ),
                0
            );
            let mut sid = ptr::null_mut();
            assert_ne!(ConvertSidToStringSidW(owner, &mut sid), 0);
            let mut length = 0;
            while *sid.add(length) != 0 {
                length += 1;
            }
            let user = String::from_utf16_lossy(std::slice::from_raw_parts(sid, length));
            let sddl: Vec<u16> = format!(
                "D:{}(A;{inheritance};FA;;;{user}){}",
                if protected { "P" } else { "" },
                if other { "(A;;FW;;;BU)" } else { "" }
            )
            .encode_utf16()
            .chain(Some(0))
            .collect();
            let mut descriptor = ptr::null_mut();
            assert_ne!(
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut descriptor,
                    ptr::null_mut()
                ),
                0
            );
            let mut present = 0;
            let mut defaulted = 0;
            let mut acl = ptr::null_mut();
            assert_ne!(
                GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted),
                0
            );
            let status = SetNamedSecurityInfoW(
                wide.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION
                    | if protected {
                        PROTECTED_DACL_SECURITY_INFORMATION
                    } else {
                        UNPROTECTED_DACL_SECURITY_INFORMATION
                    },
                ptr::null_mut(),
                ptr::null_mut(),
                acl,
                ptr::null_mut(),
            );
            LocalFree(descriptor);
            LocalFree(sid.cast());
            LocalFree(owner_descriptor);
            assert_eq!(status, 0);
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_security_r2_rejects_file_writable_by_another_sid() {
        let fixture = Fixture::new();
        windows_private_directory::create_directory(&fixture.0).unwrap();
        let store = LocalPreferencesStore::from_directory(&fixture.0).unwrap();
        store.save(LocalPreferences::default()).unwrap();
        set_windows_dacl(&fixture.0.join("preferences.json"), "", true, true);
        let (preferences, failed) = store.load();
        assert!(failed, "untrusted file must not be loaded");
        assert!(preferences.privacy_shield);
    }

    #[cfg(windows)]
    #[test]
    fn windows_security_r4_rejects_preference_file_with_inherited_dacl() {
        let fixture = Fixture::new();
        let store = fixture.store();
        store.save(LocalPreferences::default()).unwrap();
        let path = fixture.0.join("preferences.json");
        let before = fs::read(&path).unwrap();
        set_windows_dacl(&path, "", false, false);
        let error = windows_private_directory::open_read(&path).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        let expected = "L'oggetto di stato Windows richiede una DACL protetta dall'ereditarietà.";
        assert_eq!(error.to_string(), expected);
        let (preferences, cause) = store.load_with_error();
        assert!(preferences.privacy_shield);
        assert_eq!(cause.as_deref(), Some(expected));
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[cfg(windows)]
    #[test]
    fn windows_security_r2_rejects_folder_only_ace() {
        let fixture = Fixture::new();
        windows_private_directory::create_directory(&fixture.0).unwrap();
        set_windows_dacl(&fixture.0, "", true, false);
        assert!(
            LocalPreferencesStore::from_directory(&fixture.0).is_err(),
            "file and subdirectory inheritance is required"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_security_r2_rejects_unprotected_dacl() {
        let fixture = Fixture::new();
        windows_private_directory::create_directory(&fixture.0).unwrap();
        let directory = fixture.0.join("unprotected");
        windows_private_directory::create_directory(&directory).unwrap();
        set_windows_dacl(&directory, "OICI", false, false);
        let error = LocalPreferencesStore::from_directory(&directory)
            .err()
            .expect("protected DACL is required");
        assert!(error.to_string().contains("DACL protetta"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_security_r2_rejects_state_outside_profile() {
        let fixture = Fixture(PathBuf::from(format!(
            r"C:\mediflow-outside-profile-{}",
            std::process::id()
        )));
        fs::create_dir(&fixture.0).unwrap();
        set_windows_dacl(&fixture.0, "OICI", true, false);
        let error = LocalPreferencesStore::from_directory(&fixture.0)
            .err()
            .expect("outside profile must be rejected");
        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
        assert!(error.to_string().contains("profilo"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_security_r3_accepts_different_case_for_the_same_directory() {
        let fixture = Fixture::new();
        windows_private_directory::create_directory(&fixture.0).unwrap();
        let alternate = PathBuf::from(fixture.0.to_str().unwrap().to_ascii_uppercase());
        let canonical = fixture.0.canonicalize().unwrap();
        assert_eq!(alternate.canonicalize().unwrap(), canonical);
        for directory in [alternate, canonical] {
            let store = LocalPreferencesStore::from_directory(&directory).unwrap();
            let selected = LocalPreferences {
                dark_override: Some(true),
                ..Default::default()
            };
            store.save(selected).unwrap();
            assert_eq!(store.load(), (selected, false));
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_security_r3_rejects_case_sensitive_profile_sibling() {
        const PARENT: &str = "MEDIFLOW_TEST_CASE_SENSITIVE_PARENT";
        if let Some(parent) = std::env::var_os(PARENT) {
            let parent = PathBuf::from(parent);
            let profile = parent.join("Profile");
            let outside = parent.join("profile");
            assert_eq!(
                PathBuf::from(std::env::var_os("USERPROFILE").unwrap()),
                profile
            );
            assert_eq!(
                PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap()),
                profile
            );
            assert_ne!(
                profile.canonicalize().unwrap(),
                outside.canonicalize().unwrap()
            );
            assert!(!outside.join("profile-only").exists());
            for directory in [
                profile.join("state"),
                profile.join("state").canonicalize().unwrap(),
            ] {
                let store = LocalPreferencesStore::from_directory(&directory).unwrap();
                store.save(LocalPreferences::default()).unwrap();
                assert_eq!(store.load(), (LocalPreferences::default(), false));
            }
            for directory in [
                outside.join("state"),
                outside.join("state").canonicalize().unwrap(),
            ] {
                let error = LocalPreferencesStore::from_directory(&directory)
                    .err()
                    .expect("a distinct case-sensitive sibling is outside the profile");
                assert_eq!(error.kind(), io::ErrorKind::Unsupported);
                assert!(error.to_string().contains("profilo"));
            }
            return;
        }
        let fixture = Fixture::new();
        windows_private_directory::create_directory(&fixture.0).unwrap();
        let output = std::process::Command::new("fsutil")
            .args(["file", "setCaseSensitiveInfo"])
            .arg(&fixture.0)
            .arg("enable")
            .output()
            .unwrap();
        println!("{}", String::from_utf8_lossy(&output.stdout));
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        for name in ["Profile", "profile"] {
            let profile = fixture.0.join(name);
            fs::create_dir(&profile).unwrap();
            set_windows_dacl(&profile, "OICI", true, false);
            let state = profile.join("state");
            fs::create_dir(&state).unwrap();
            set_windows_dacl(&state, "OICI", true, false);
        }
        fs::write(fixture.0.join("Profile/profile-only"), b"synthetic").unwrap();
        let profile = fixture.0.join("Profile");
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "shell::local_preferences::tests::windows_security_r3_rejects_case_sensitive_profile_sibling",
                "--nocapture",
            ])
            .env(PARENT, &fixture.0)
            .env("USERPROFILE", &profile)
            .env("LOCALAPPDATA", &profile)
            .output()
            .unwrap();
        println!("{}", String::from_utf8_lossy(&output.stdout));
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_security_r2_ambulatory_directory_rejects_unattested_child() {
        let fixture = Fixture::new();
        windows_private_directory::create_directory(&fixture.0).unwrap();
        let store = LocalPreferencesStore::from_directory(&fixture.0).unwrap();
        let recovery = store.ambulatory_command_directory().unwrap().unwrap();
        fs::write(recovery.join("foreign.json"), b"{}").unwrap();
        assert!(store.ambulatory_command_directory().is_err());
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
