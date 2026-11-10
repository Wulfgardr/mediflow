//! Stato comune alle funzioni che generano tramite l'host locale (G-5): Quadro
//! paziente, sintesi dei documenti e import assistito.
//!
//! Ogni area ha un biglietto: una risposta arrivata per un biglietto vecchio
//! (richiesta interrotta, scartata, cambio di scheda) non entra nello stato. Le
//! fasi sono le stesse per tutte le funzioni; richiesta e proposta sono proprie
//! di ciascuna e si cancellano dalla memoria quando non servono più.

use super::*;
#[cfg(unix)]
use crate::chat_access::owner::{Pending, Stage};
use std::sync::Arc;

const CHAT_WITHDRAWN: &str = "La chat ha ritirato la richiesta. Nessuna proposta.";

#[cfg(unix)]
#[derive(Default)]
pub(super) struct ChatHold(pub(super) Option<Pending>);

#[cfg(unix)]
impl Drop for ChatHold {
    fn drop(&mut self) {
        if let Some(chat) = self.0.take()
            && let Ok(mut chat) = chat.lock()
        {
            chat.withdraw();
        }
    }
}

/// Testi clinici che non devono restare in memoria oltre il loro uso.
pub(super) trait Wipe {
    fn wipe(&mut self);
}

#[derive(Default)]
pub(super) enum GenerationPhase<R, P> {
    #[default]
    Idle,
    Checking,
    Unavailable(String),
    Consent(Box<R>),
    Running {
        request: Box<R>,
        context: RequestContext,
    },
    Proposal {
        request: Box<R>,
        proposal: Box<P>,
    },
    /// Fine senza proposta per scelta di chi usa la scheda (scarto, interruzione, rinuncia).
    Ended(String),
    Error(String),
}
impl<R, P> GenerationPhase<R, P> {
    pub(super) fn is_busy(&self) -> bool {
        matches!(self, Self::Checking | Self::Running { .. })
    }
}

pub(super) struct GenerationArea<R: Wipe, P: Wipe> {
    pub(super) ticket: Arc<()>,
    pub(super) phase: GenerationPhase<R, P>,
    #[cfg(unix)]
    pub(super) chat: ChatHold,
}
impl<R: Wipe, P: Wipe> Default for GenerationArea<R, P> {
    fn default() -> Self {
        Self {
            ticket: Arc::new(()),
            phase: GenerationPhase::Idle,
            #[cfg(unix)]
            chat: ChatHold::default(),
        }
    }
}
impl<R: Wipe, P: Wipe> GenerationArea<R, P> {
    fn renew(&mut self) {
        self.ticket = Arc::new(());
    }
    /// Chiude la fase corrente (annulla la richiesta in volo, cancella i testi) e
    /// apre `phase` con un biglietto nuovo.
    pub(super) fn end(&mut self, phase: GenerationPhase<R, P>) {
        assert!(!matches!(phase, GenerationPhase::Running { .. }));
        self.replace(phase);
    }
    fn replace(&mut self, phase: GenerationPhase<R, P>) {
        if let GenerationPhase::Running { context, .. } = &self.phase {
            context.cancel();
        }
        wipe_phase(&mut self.phase);
        self.renew();
        self.phase = phase;
    }
    pub(super) fn start(&mut self, mut request: R, context: RequestContext) -> bool {
        if self.chat_withdrawn() {
            context.cancel();
            request.wipe();
            self.end(GenerationPhase::Ended(CHAT_WITHDRAWN.into()));
            return false;
        }
        self.replace(GenerationPhase::Running {
            request: Box::new(request),
            context,
        });
        true
    }
    fn chat_withdrawn(&self) -> bool {
        #[cfg(unix)]
        if let Some(chat) = &self.chat.0 {
            return !chat.lock().is_ok_and(|mut chat| chat.function_held());
        }
        false
    }
    pub(super) fn chat_ready(&self) -> bool {
        #[cfg(unix)]
        if let Some(chat) = &self.chat.0 {
            return chat.lock().is_ok_and(|mut chat| chat.function_open());
        }
        true
    }
    #[cfg(unix)]
    pub(super) fn occupied(&self) -> bool {
        self.chat.0.is_some()
            || matches!(
                self.phase,
                GenerationPhase::Checking
                    | GenerationPhase::Consent(_)
                    | GenerationPhase::Running { .. }
                    | GenerationPhase::Proposal { .. }
            )
    }
    #[cfg(unix)]
    pub(super) fn follow_chat(&mut self) -> bool {
        let Some(chat) = self.chat.0.clone() else {
            return false;
        };
        let (bound, open) = chat
            .lock()
            .map(|mut chat| (chat.function_bound(), chat.function_open()))
            .unwrap_or((false, false));
        if !bound && !open {
            self.chat.0 = None;
            if matches!(
                self.phase,
                GenerationPhase::Checking
                    | GenerationPhase::Consent(_)
                    | GenerationPhase::Running { .. }
            ) {
                self.end(GenerationPhase::Ended(CHAT_WITHDRAWN.into()));
            }
            return true;
        }
        if bound {
            let stage = match &self.phase {
                GenerationPhase::Idle | GenerationPhase::Checking => return false,
                GenerationPhase::Consent(_) => Some(Stage::Opened),
                GenerationPhase::Unavailable(_) => Some(Stage::Unavailable),
                _ => None,
            };
            if let Ok(mut chat) = chat.lock() {
                match stage {
                    Some(stage) => chat.finish_function_open(stage),
                    None => chat.withdraw(),
                }
            }
            if stage != Some(Stage::Opened) {
                self.chat.0 = None;
            }
            return true;
        }
        if !matches!(
            self.phase,
            GenerationPhase::Idle
                | GenerationPhase::Checking
                | GenerationPhase::Consent(_)
                | GenerationPhase::Running { .. }
        ) {
            if let Ok(mut chat) = chat.lock() {
                chat.close_function();
            }
            self.chat.0 = None;
            return true;
        }
        false
    }
    /// Il biglietto è ancora quello di questa area.
    pub(super) fn holds(&self, ticket: &Arc<()>) -> bool {
        Arc::ptr_eq(ticket, &self.ticket)
    }
    /// Toglie la richiesta in corso, se c'è, e lascia la fase vuota.
    pub(super) fn take_running(&mut self) -> Option<Box<R>> {
        if !matches!(self.phase, GenerationPhase::Running { .. }) {
            return None;
        }
        if self.chat_withdrawn() {
            self.end(GenerationPhase::Ended(CHAT_WITHDRAWN.into()));
            return None;
        }
        match std::mem::take(&mut self.phase) {
            GenerationPhase::Running { request, .. } => Some(request),
            _ => None,
        }
    }
}
/// Ciò che il canale della chat fa con l'area di una funzione generativa, uguale per
/// tutte: verifica di occupazione, legame durante l'ammissione, controllo del legame.
#[cfg(unix)]
pub(super) trait ChatArea {
    fn occupied(&self) -> bool;
    fn follow_chat(&mut self) -> bool;
    /// Lega la richiesta all'area in verifica e restituisce il biglietto dell'ammissione.
    fn hold(&mut self, chat: Pending) -> Arc<()>;
    /// Il biglietto è ancora quello dell'ammissione e il legame è con questa richiesta.
    fn holds_chat(&self, ticket: &Arc<()>, chat: &Pending) -> bool;
    /// Funzione non disponibile: il legame cade senza ritirare la risposta già data.
    fn release(&mut self);
    /// Ammissione riuscita: la scelta torna alla finestra.
    fn admitted(&mut self);
}
#[cfg(unix)]
impl<R: Wipe, P: Wipe> ChatArea for GenerationArea<R, P> {
    fn occupied(&self) -> bool {
        GenerationArea::occupied(self)
    }
    fn follow_chat(&mut self) -> bool {
        GenerationArea::follow_chat(self)
    }
    fn hold(&mut self, chat: Pending) -> Arc<()> {
        self.end(GenerationPhase::Checking);
        self.chat.0 = Some(chat);
        self.ticket.clone()
    }
    fn holds_chat(&self, ticket: &Arc<()>, chat: &Pending) -> bool {
        self.holds(ticket)
            && self
                .chat
                .0
                .as_ref()
                .is_some_and(|held| Arc::ptr_eq(held, chat))
    }
    fn release(&mut self) {
        self.chat.0 = None;
        self.end(GenerationPhase::Idle);
    }
    fn admitted(&mut self) {
        self.end(GenerationPhase::Idle);
    }
}

impl<R: Wipe, P: Wipe> Drop for GenerationArea<R, P> {
    fn drop(&mut self) {
        if let GenerationPhase::Running { context, .. } = &self.phase {
            context.cancel();
        }
        wipe_phase(&mut self.phase);
    }
}
fn wipe_phase<R: Wipe, P: Wipe>(phase: &mut GenerationPhase<R, P>) {
    match phase {
        GenerationPhase::Proposal { proposal, request } => {
            proposal.wipe();
            request.wipe();
        }
        GenerationPhase::Consent(request) | GenerationPhase::Running { request, .. } => {
            request.wipe()
        }
        _ => {}
    }
}

/// Il blocco della proposta: bordo a matita, come le proposte da rivedere del Web.
pub(super) fn pencil_block(theme: Theme) -> Div {
    div()
        .min_w_0()
        .border_l_2()
        .border_color(theme.pencil)
        .pl(px(14.))
        .flex()
        .flex_col()
        .gap(px(10.))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::chat_access::owner::{
        Function,
        tests::{function_request, native_session},
    };
    use std::sync::atomic::{AtomicBool, Ordering};

    struct Payload(Arc<AtomicBool>);
    impl Wipe for Payload {
        fn wipe(&mut self) {
            self.0.store(true, Ordering::Release);
        }
    }

    #[test]
    fn rejected_start_cancels_context_and_wipes_both_requests() {
        for function in Function::ALL {
            let (session, _host) = native_session();
            let (pending, _remote) = function_request(function);
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            assert!(pending.lock().unwrap().bind(session, context));
            pending.lock().unwrap().finish_function_open(Stage::Opened);
            let old = Arc::new(AtomicBool::new(false));
            let new = Arc::new(AtomicBool::new(false));
            let mut area: GenerationArea<Payload, Payload> = GenerationArea::default();
            area.chat.0 = Some(pending.clone());
            area.end(GenerationPhase::Consent(Box::new(Payload(old.clone()))));
            pending.lock().unwrap().revoke();
            let context = RequestContext::default();
            assert!(!area.start(Payload(new.clone()), context.clone()));
            assert!(context.check().is_err());
            assert!(old.load(Ordering::Acquire));
            assert!(new.load(Ordering::Acquire));
            assert!(matches!(area.phase, GenerationPhase::Ended(_)));
        }
    }

    #[test]
    fn choices_keep_the_same_chat_hold() {
        for function in Function::ALL {
            let (session, _host) = native_session();
            let (pending, _remote) = function_request(function);
            let context = session.chat_access_context("scope-a", "patient-a").unwrap();
            assert!(pending.lock().unwrap().bind(session, context));
            pending.lock().unwrap().finish_function_open(Stage::Opened);
            let mut area: GenerationArea<Payload, Payload> = GenerationArea::default();
            area.chat.0 = Some(pending.clone());
            for _ in 0..2 {
                area.end(GenerationPhase::Checking);
                assert!(
                    area.chat
                        .0
                        .as_ref()
                        .is_some_and(|chat| Arc::ptr_eq(chat, &pending))
                );
                area.end(GenerationPhase::Consent(Box::new(Payload(Arc::new(
                    AtomicBool::new(false),
                )))));
                assert!(
                    area.chat
                        .0
                        .as_ref()
                        .is_some_and(|chat| Arc::ptr_eq(chat, &pending))
                );
            }
        }
    }

    #[test]
    fn take_running_rechecks_chat_and_cancels_and_wipes_a_withdrawn_request() {
        for revoked in [false, true] {
            for function in Function::ALL {
                let (session, _host) = native_session();
                let (pending, _remote) = function_request(function);
                let context = session.chat_access_context("scope-a", "patient-a").unwrap();
                assert!(pending.lock().unwrap().bind(session, context));
                pending.lock().unwrap().finish_function_open(Stage::Opened);
                let wiped = Arc::new(AtomicBool::new(false));
                let mut area: GenerationArea<Payload, Payload> = GenerationArea::default();
                area.chat.0 = Some(pending.clone());
                let context = RequestContext::default();
                assert!(area.start(Payload(wiped.clone()), context.clone()));
                if revoked {
                    pending.lock().unwrap().revoke();
                }
                assert_eq!(area.take_running().is_none(), revoked);
                assert_eq!(context.check().is_err(), revoked);
                assert_eq!(wiped.load(Ordering::Acquire), revoked);
            }
        }
    }
}
