use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub const RETIREMENT_WARNING: &str = "Ritiro di una sessione locale non confermato. Verifica le sessioni dell’host prima di lasciare la postazione.";

#[derive(Clone)]
pub struct RetirementNotice(Arc<Mutex<(usize, Option<PathBuf>)>>);
impl RetirementNotice {
    pub fn new(path: Option<PathBuf>) -> Self {
        let pending = path
            .as_ref()
            .map(|path| match std::fs::read(path) {
                Ok(bytes) => serde_json::from_slice::<usize>(&bytes).unwrap_or(1),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
                Err(_) => 1,
            })
            .unwrap_or(0);
        Self(Arc::new(Mutex::new((pending, path))))
    }
    pub fn pending(&self) -> bool {
        self.0.lock().map(|state| state.0 > 0).unwrap_or(true)
    }
    pub(crate) fn change(&self, begin: bool) {
        if let Ok(mut state) = self.0.lock() {
            state.0 = if begin {
                state.0.saturating_add(1)
            } else {
                state.0.saturating_sub(1)
            };
            if let Some(path) = &state.1 {
                let saved = (|| -> std::io::Result<()> {
                    let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
                    std::fs::create_dir_all(parent)?;
                    std::fs::write(path, serde_json::to_vec(&state.0)?)
                })();
                if saved.is_err() {
                    eprintln!("{RETIREMENT_WARNING}");
                }
            }
        }
    }
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
    fn unconfirmed_retirement_survives_restart_and_a_later_success_cannot_hide_it() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(&fixture.0).unwrap();
        let path = fixture.0.join("retirement.json");
        let notice = RetirementNotice::new(Some(path.clone()));
        assert!(!notice.pending());
        notice.change(true);
        assert!(notice.pending());
        let reopened = RetirementNotice::new(Some(path.clone()));
        assert!(reopened.pending());
        reopened.change(true);
        reopened.change(false);
        assert!(reopened.pending());
        reopened.change(false);
        assert!(!RetirementNotice::new(Some(path)).pending());
    }
}
