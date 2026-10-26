use mediflow_runtime_client::{AmbulatoryCommandContext, RuntimeError};
use std::sync::atomic::{AtomicU64, Ordering};

const INSTALLED: u64 = 1;
const SCREEN_LOCKED: u64 = 2;
const SESSION_INACTIVE: u64 = 4;
const FLAGS: u64 = INSTALLED | SCREEN_LOCKED | SESSION_INACTIVE;
static STATE: AtomicU64 = AtomicU64::new(0);

fn installed(state: &AtomicU64) {
    let _ = state.fetch_update(Ordering::AcqRel, Ordering::Acquire, |previous| {
        (previous != u64::MAX && previous & INSTALLED == 0).then_some(previous | INSTALLED)
    });
}

#[cfg(any(target_os = "macos", test))]
fn event(state: &AtomicU64, reason: u64, blocked: bool) {
    let _ = state.fetch_update(Ordering::AcqRel, Ordering::Acquire, |previous| {
        let flags = (previous & FLAGS & !reason) | if blocked { reason } else { 0 };
        Some(
            (previous & !FLAGS)
                .checked_add(FLAGS + 1)
                .map_or(u64::MAX, |next| next | flags),
        )
    });
}
fn admits_fresh_auth(stamp: u64) -> bool {
    stamp != u64::MAX && stamp & FLAGS == INSTALLED
}

#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
extern "C" fn MFAmbulatoryWindowScreenLockEvent(locked: i32) {
    event(&STATE, SCREEN_LOCKED, locked != 0);
}

#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
extern "C" fn MFAmbulatoryWindowSessionActiveEvent(active: i32) {
    event(&STATE, SESSION_INACTIVE, active != 1);
}

pub(crate) fn monitor_installed() {
    if cfg!(target_os = "macos") {
        installed(&STATE);
    }
}

pub(crate) fn available() -> bool {
    cfg!(target_os = "macos") && admits_fresh_auth(STATE.load(Ordering::Acquire))
}

pub(crate) fn bind(context: &mut AmbulatoryCommandContext) -> Result<(), RuntimeError> {
    let before = STATE.load(Ordering::Acquire);
    if !available() {
        context.cancel();
        return Err(RuntimeError::ReadRequired);
    }
    context.bind_revocation_epoch(&STATE)?;
    if before != STATE.load(Ordering::Acquire) || !available() {
        context.cancel();
        return Err(RuntimeError::ReadRequired);
    }
    context.check()
}

pub(crate) fn current(context: &AmbulatoryCommandContext) -> bool {
    available() && context.revocation_epoch_current()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_installation_admits_fresh_auth_but_never_revalidates_old_snapshots() {
        let during_installation = AtomicU64::new(0);
        event(&during_installation, SCREEN_LOCKED, true);
        let observed_lock = during_installation.load(Ordering::Acquire);
        installed(&during_installation);
        assert_eq!(
            during_installation.load(Ordering::Acquire),
            observed_lock | INSTALLED
        );
        assert!(!admits_fresh_auth(
            during_installation.load(Ordering::Acquire)
        ));

        let state = AtomicU64::new(0);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        installed(&state);
        let first = state.load(Ordering::Acquire);
        assert_eq!(first, INSTALLED);
        assert!(admits_fresh_auth(first));
        event(&state, SCREEN_LOCKED, true);
        let screen_lock = state.load(Ordering::Acquire);
        assert!(!admits_fresh_auth(screen_lock));
        installed(&state);
        assert_eq!(state.load(Ordering::Acquire), screen_lock);
        event(&state, SESSION_INACTIVE, false);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        assert_ne!(state.load(Ordering::Acquire), first);
        event(&state, SCREEN_LOCKED, false);
        let successor = state.load(Ordering::Acquire);
        assert!(admits_fresh_auth(successor));
        assert_ne!(successor, first);
        event(&state, SESSION_INACTIVE, true);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        event(&state, SCREEN_LOCKED, false);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        event(&state, SESSION_INACTIVE, false);
        assert!(admits_fresh_auth(state.load(Ordering::Acquire)));
        assert_ne!(state.load(Ordering::Acquire), successor);
    }

    #[test]
    fn overflow_is_terminal_even_after_unlock() {
        let state = AtomicU64::new(u64::MAX - 2);
        event(&state, SCREEN_LOCKED, false);
        assert_eq!(state.load(Ordering::Acquire), u64::MAX);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        installed(&state);
        assert_eq!(state.load(Ordering::Acquire), u64::MAX);
        event(&state, SCREEN_LOCKED, false);
        assert_eq!(state.load(Ordering::Acquire), u64::MAX);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
    }
}
