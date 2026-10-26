use mediflow_runtime_client::{AmbulatoryCommandContext, RuntimeError};
use std::sync::atomic::{AtomicU64, Ordering};

static STATE: AtomicU64 = AtomicU64::new(0);

fn event(state: &AtomicU64, unlocked: bool) {
    let _ = state.fetch_update(Ordering::AcqRel, Ordering::Acquire, |previous| {
        Some(
            previous
                .checked_add(2)
                .map_or(u64::MAX, |next| (next & !1) | u64::from(unlocked)),
        )
    });
}
fn unlocked(stamp: u64) -> bool {
    stamp != u64::MAX && stamp & 1 == 1
}

#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
extern "C" fn MFAmbulatoryWindowLockEvent(is_unlocked: i32) {
    event(&STATE, is_unlocked == 1);
}

pub(crate) fn available() -> bool {
    cfg!(target_os = "macos") && unlocked(STATE.load(Ordering::Acquire))
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
    fn unknown_start_denies_and_unlock_never_revalidates_an_old_snapshot() {
        let state = AtomicU64::new(0);
        assert!(!unlocked(state.load(Ordering::Acquire)));
        event(&state, true);
        let first = state.load(Ordering::Acquire);
        assert!(unlocked(first));
        event(&state, false);
        assert!(!unlocked(state.load(Ordering::Acquire)));
        assert_ne!(state.load(Ordering::Acquire), first);
        event(&state, true);
        let successor = state.load(Ordering::Acquire);
        assert!(unlocked(successor));
        assert_ne!(successor, first);
        event(&state, false);
        assert!(!unlocked(state.load(Ordering::Acquire)));
        assert_ne!(state.load(Ordering::Acquire), successor);
    }

    #[test]
    fn overflow_is_terminal_even_after_unlock() {
        let state = AtomicU64::new(u64::MAX - 2);
        event(&state, true);
        assert_eq!(state.load(Ordering::Acquire), u64::MAX);
        assert!(!unlocked(state.load(Ordering::Acquire)));
        event(&state, true);
        assert_eq!(state.load(Ordering::Acquire), u64::MAX);
        assert!(!unlocked(state.load(Ordering::Acquire)));
    }
}
