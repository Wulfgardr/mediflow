use crate::{Result, RuntimeError};
use futures_util::future::{Either, select, select_all};
use std::future::Future;
use std::sync::{Arc, Mutex};
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
    file_admission: Arc<Mutex<()>>,
}
impl Default for RequestContext {
    fn default() -> Self {
        Self {
            session: Cancellation::new(),
            selections: vec![Cancellation::new()],
            file_admission: Arc::new(Mutex::new(())),
        }
    }
}
impl RequestContext {
    pub fn cancel(&self) {
        let _admission = self
            .file_admission
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.selections.last().expect("selection context").cancel();
    }
    /// Local point of no return for an already announced, fixed file copy.
    /// Revocation before admission denies it; after admission it may finish.
    /// No IO runs under this lock. This is a lifetime fence, never a grant.
    pub fn admit_file_effect(&self) -> Result<()> {
        let _admission = self
            .file_admission
            .lock()
            .map_err(|_| RuntimeError::Locked)?;
        self.check()
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
            file_admission: self.file_admission.clone(),
        }
    }
    pub(crate) fn revoke(&self) {
        let _admission = self
            .file_admission
            .lock()
            .unwrap_or_else(|error| error.into_inner());
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
            file_admission: self.file_admission.clone(),
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
        match select(Box::pin(operation), Box::pin(cancelled)).await {
            Either::Right(_) => Err(if mutation {
                RuntimeError::Indeterminate
            } else {
                self.check().err().unwrap_or(RuntimeError::ReadRequired)
            }),
            Either::Left((result, _)) => {
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

    fn simultaneous_completion(result: Result<()>, mutation: bool, revoke: bool) -> Result<()> {
        let context = RequestContext::default();
        let (send, receive) = tokio::sync::oneshot::channel();
        let mut request = Box::pin(context.run(async { receive.await.unwrap() }, mutation));
        let mut task = std::task::Context::from_waker(futures_util::task::noop_waker_ref());
        assert!(request.as_mut().poll(&mut task).is_pending());
        send.send(result).unwrap();
        if revoke {
            context.revoke();
        } else {
            context.cancel();
        }
        match request.as_mut().poll(&mut task) {
            std::task::Poll::Ready(result) => result,
            std::task::Poll::Pending => {
                panic!("completed response and cancellation were both ready")
            }
        }
    }

    #[test]
    fn g1a2_file_admission_obeys_selection_children_and_session_retirement() {
        let root = RequestContext::default();
        let child = root.child();
        let account = root.session_scope();
        assert_eq!(child.admit_file_effect(), Ok(()));
        root.cancel();
        assert_eq!(child.admit_file_effect(), Err(RuntimeError::ReadRequired));
        assert_eq!(account.admit_file_effect(), Ok(()));
        let next = root.next_selection();
        assert_eq!(next.admit_file_effect(), Ok(()));
        root.revoke();
        assert_eq!(next.admit_file_effect(), Err(RuntimeError::Locked));
        assert_eq!(account.admit_file_effect(), Err(RuntimeError::Locked));
        assert_eq!(root.child().admit_file_effect(), Err(RuntimeError::Locked));
    }

    #[test]
    fn completed_retirement_wins_simultaneous_cancellation_stress() {
        for _ in 0..1_000 {
            for mutation in [false, true] {
                for revoke in [false, true] {
                    for error in [
                        RuntimeError::Authentication,
                        RuntimeError::ArchiveReplaced,
                        RuntimeError::Locked,
                    ] {
                        assert_eq!(
                            simultaneous_completion(Err(error), mutation, revoke),
                            Err(error),
                            "mutation={mutation} session_cancellation={revoke}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn completed_non_retirement_still_obeys_simultaneous_cancellation() {
        for mutation in [false, true] {
            for revoke in [false, true] {
                for result in [
                    Ok(()),
                    Err(RuntimeError::Forbidden),
                    Err(RuntimeError::Transport),
                ] {
                    assert_eq!(
                        simultaneous_completion(result, mutation, revoke),
                        Err(if mutation {
                            RuntimeError::Indeterminate
                        } else if revoke {
                            RuntimeError::Locked
                        } else {
                            RuntimeError::ReadRequired
                        })
                    );
                }
            }
        }
    }

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
