//! Stato comune alle funzioni che generano tramite l'host locale (G-5): Quadro
//! paziente, sintesi dei documenti e, in seguito, import assistito.
//!
//! Ogni area ha un biglietto: una risposta arrivata per un biglietto vecchio
//! (richiesta interrotta, scartata, cambio di scheda) non entra nello stato. Le
//! fasi sono le stesse per tutte le funzioni; richiesta e proposta sono proprie
//! di ciascuna e si cancellano dalla memoria quando non servono più.

use super::*;
use std::sync::Arc;

/// Testi clinici che non devono restare in memoria oltre il loro uso.
pub(super) trait Wipe {
    fn wipe(&mut self);
}

pub(super) enum GenerationPhase<R, P> {
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
impl<R, P> Default for GenerationPhase<R, P> {
    fn default() -> Self {
        Self::Idle
    }
}
impl<R, P> GenerationPhase<R, P> {
    pub(super) fn is_busy(&self) -> bool {
        matches!(self, Self::Checking | Self::Running { .. })
    }
}

pub(super) struct GenerationArea<R: Wipe, P: Wipe> {
    pub(super) ticket: Arc<()>,
    pub(super) phase: GenerationPhase<R, P>,
}
impl<R: Wipe, P: Wipe> Default for GenerationArea<R, P> {
    fn default() -> Self {
        Self {
            ticket: Arc::new(()),
            phase: GenerationPhase::Idle,
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
        if let GenerationPhase::Running { context, .. } = &self.phase {
            context.cancel();
        }
        wipe_phase(&mut self.phase);
        self.renew();
        self.phase = phase;
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
        match std::mem::take(&mut self.phase) {
            GenerationPhase::Running { request, .. } => Some(request),
            _ => None,
        }
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
