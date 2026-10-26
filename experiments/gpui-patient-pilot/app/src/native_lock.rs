use mediflow_runtime_client::{AmbulatoryCommandContext, RuntimeError};
use std::sync::atomic::{AtomicU64, Ordering};

static STATE: AtomicU64 = AtomicU64::new(0);

fn installed(state: &AtomicU64) {
    let _ = state.compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire);
}

fn event(state: &AtomicU64, resumed: bool) {
    let _ = state.fetch_update(Ordering::AcqRel, Ordering::Acquire, |previous| {
        Some(
            previous
                .checked_add(2)
                .map_or(u64::MAX, |next| (next & !1) | u64::from(resumed)),
        )
    });
}
fn admits_fresh_auth(stamp: u64) -> bool {
    stamp != u64::MAX && stamp & 1 == 1
}

#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
extern "C" fn MFAmbulatoryWindowLockEvent(permits_fresh_auth: i32) {
    event(&STATE, permits_fresh_auth == 1);
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
        event(&during_installation, false);
        let observed_lock = during_installation.load(Ordering::Acquire);
        installed(&during_installation);
        assert_eq!(during_installation.load(Ordering::Acquire), observed_lock);
        assert!(!admits_fresh_auth(
            during_installation.load(Ordering::Acquire)
        ));

        let state = AtomicU64::new(0);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        installed(&state);
        let first = state.load(Ordering::Acquire);
        assert_eq!(first, 1);
        assert!(admits_fresh_auth(first));
        event(&state, false);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        assert_ne!(state.load(Ordering::Acquire), first);
        installed(&state);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        event(&state, true);
        let successor = state.load(Ordering::Acquire);
        assert!(admits_fresh_auth(successor));
        assert_ne!(successor, first);
        event(&state, false);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        assert_ne!(state.load(Ordering::Acquire), successor);
    }

    #[test]
    fn overflow_is_terminal_even_after_unlock() {
        let state = AtomicU64::new(u64::MAX - 2);
        event(&state, true);
        assert_eq!(state.load(Ordering::Acquire), u64::MAX);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
        installed(&state);
        assert_eq!(state.load(Ordering::Acquire), u64::MAX);
        event(&state, true);
        assert_eq!(state.load(Ordering::Acquire), u64::MAX);
        assert!(!admits_fresh_auth(state.load(Ordering::Acquire)));
    }
}
