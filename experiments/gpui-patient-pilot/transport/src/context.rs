use crate::{Result, RuntimeError};
use futures_util::future::{Either, select, select_all};
use std::future::Future;
use tokio::sync::watch;

#[derive(Clone)]
struct Cancellation(watch::Sender<bool>);
impl Cancellation {
    fn new() -> Self {
        Self(watch::channel(false).0)
    }
    fn cancel(&self) {
        self.0.send_replace(true);
    }
    fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }
    async fn cancelled(&self) {
        let mut receiver = self.0.subscribe();
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                return;
            }
        }
    }
}

/// Local session/selection lifetime shared by every port. This is never a grant.
#[derive(Clone)]
pub struct RequestContext {
    session: Cancellation,
    selections: Vec<Cancellation>,
}
impl Default for RequestContext {
    fn default() -> Self {
        Self {
            session: Cancellation::new(),
            selections: vec![Cancellation::new()],
        }
    }
}
impl RequestContext {
    pub fn cancel(&self) {
        self.selections.last().expect("selection context").cancel();
    }
    pub fn check(&self) -> Result<()> {
        if self.session.is_cancelled() {
            Err(RuntimeError::Locked)
        } else if self.selections.iter().any(Cancellation::is_cancelled) {
            Err(RuntimeError::ReadRequired)
        } else {
            Ok(())
        }
    }
    pub(crate) fn child(&self) -> Self {
        let mut selections = self.selections.clone();
        selections.push(Cancellation::new());
        Self {
            session: self.session.clone(),
            selections,
        }
    }
    pub(crate) fn revoke(&self) {
        self.session.cancel();
    }
    pub(crate) fn next_selection(&self) -> Self {
        self.cancel();
        self.session_scope()
    }
    pub(crate) fn session_scope(&self) -> Self {
        Self {
            session: self.session.clone(),
            selections: vec![Cancellation::new()],
        }
    }
    pub(crate) async fn run<T>(
        &self,
        operation: impl Future<Output = Result<T>>,
        mutation: bool,
    ) -> Result<T> {
        self.check()?;
        let cancelled = select_all(
            self.selections
                .iter()
                .chain(std::iter::once(&self.session))
                .map(|cancel| Box::pin(cancel.cancelled())),
        );
        match select(Box::pin(cancelled), Box::pin(operation)).await {
            Either::Left(_) => Err(if mutation {
                RuntimeError::Indeterminate
            } else {
                self.check().err().unwrap_or(RuntimeError::ReadRequired)
            }),
            Either::Right((result, _)) => {
                // A host retirement signal must survive a simultaneous local cancellation.
                if result.as_ref().is_err_and(|error| error.retires_session()) {
                    return result;
                }
                match self.check() {
                    Ok(()) => result,
                    Err(_) if mutation => Err(RuntimeError::Indeterminate),
                    Err(error) => Err(error),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_cancellation_is_per_generation_and_session_revocation_is_universal() {
        let old = RequestContext::default();
        let pending = old.clone();
        let fresh = old.next_selection();
        assert_eq!(pending.check(), Err(RuntimeError::ReadRequired));
        assert_eq!(fresh.check(), Ok(()));
        old.revoke();
        assert_eq!(fresh.check(), Err(RuntimeError::Locked));
        assert_eq!(pending.check(), Err(RuntimeError::Locked));
        assert_eq!(old.next_selection().check(), Err(RuntimeError::Locked));
    }
}
