//! Import assistito (G-5c): diagnosi, terapie e prestazioni proposte dall'host locale
//! a partire dalle fonti della scheda (note, diario, sintesi dei documenti), su
//! richiesta esplicita. Il server decide disponibilità, proiezione, validità e fonti;
//! GPUI raccoglie le fonti come il Web, chiede il consenso all'invio, mostra i
//! candidati con la loro fonte e la ricevuta e permette di interrompere o scartare.
//!
//! È soltanto un'anteprima: nessun comando di applicazione, nessuna route di
//! scrittura. L'apply legacy è ritirato e non si riattiva; una scrittura derivata
//! arriva soltanto con il contratto G-6j.

use super::generation::{GenerationArea, GenerationPhase, Wipe, pencil_block};
use super::*;
use mediflow_runtime_client::{
    GenerationOutcome, LocalHostAccess, SmartImportCandidate, SmartImportChart, SmartImportOutcome,
    SmartImportProposal, SmartImportRequest, smart_import_capture, smart_import_message,
};
use std::sync::Arc;
use zeroize::Zeroize;

pub(super) type ImportPhase = GenerationPhase<SmartImportRequest, SmartImportProposal>;
/// Stato dell'import assistito, legato a una sola scheda: cambia con `PatientData`.
pub(super) type SmartImportArea = GenerationArea<SmartImportRequest, SmartImportProposal>;

impl Wipe for SmartImportRequest {
    fn wipe(&mut self) {
        SmartImportRequest::wipe(self);
    }
}
fn wipe_candidate(candidate: &mut SmartImportCandidate) {
    candidate.title.zeroize();
    candidate.evidence.zeroize();
    for (_, value) in &mut candidate.details {
        value.zeroize();
    }
    candidate.items.iter_mut().for_each(wipe_candidate);
}
impl Wipe for SmartImportProposal {
    fn wipe(&mut self) {
        self.summary.zeroize();
        self.model.zeroize();
        self.diagnoses
            .iter_mut()
            .chain(self.therapies.iter_mut())
            .chain(self.services.iter_mut())
            .for_each(wipe_candidate);
    }
}

/// Se la proposta descrive ancora la scheda mostrata.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ImportCurrency {
    Current,
    /// Una parte della scheda è in rilettura: la risposta si dà dopo.
    Reading,
    /// Le fonti sono cambiate: una richiesta fatta adesso invierebbe altro.
    Superseded,
}

const HOST_CLOSED: &str = "Host locale chiuso. L’import assistito si genera sul Mac che ospita l’archivio: apri Gestione locale in Impostazioni e conferma l’accesso.";

fn plain(text: &str) -> String {
    crate::clinical_text::plain_text(text)
}

impl ClinicalApp {
    /// La cattura che una richiesta fatta adesso invierebbe; `None` se una parte
    /// della scheda non è letta.
    fn import_capture_now(&self) -> Option<Result<serde_json::Value, RuntimeError>> {
        let patient = self.patient.detail.ready()?;
        if self.selected_id.as_deref() != Some(patient.id.as_str()) {
            return None;
        }
        Some(smart_import_capture(&SmartImportChart {
            patient,
            scope: self.scope.as_deref(),
            therapies: self.patient.therapies.ready()?,
            entries: self.patient.entries.ready()?,
            attachments: self.patient.attachments.ready()?,
            plain: &plain,
        }))
    }

    /// La proposta vale finché paziente, ambulatorio e fonti sono quelli che una
    /// richiesta fatta adesso invierebbe.
    pub(super) fn import_currency(&self, request: &SmartImportRequest) -> ImportCurrency {
        if self.selected_id.as_deref() != Some(request.patient_id.as_str())
            || self.scope.as_deref() != Some(request.ambulatory_id.as_str())
        {
            return ImportCurrency::Superseded;
        }
        match self.import_capture_now() {
            None => ImportCurrency::Reading,
            Some(Ok(capture)) if capture == request.capture => ImportCurrency::Current,
            Some(_) => ImportCurrency::Superseded,
        }
    }

    /// Primo passo: verifica che la funzione sia accesa sull'host e raccoglie le fonti
    /// da mostrare. Nessun dato lascia GPUI qui.
    pub(super) fn import_prepare(&mut self, cx: &mut Context<Self>) {
        if self.patient.smart_import.phase.is_busy() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            self.patient
                .smart_import
                .end(ImportPhase::Unavailable(HOST_CLOSED.into()));
            cx.notify();
            return;
        };
        let (Some(patient), Some(therapies), Some(entries), Some(attachments)) = (
            self.patient
                .detail
                .ready()
                .filter(|p| self.selected_id.as_deref() == Some(p.id.as_str()))
                .cloned(),
            self.patient.therapies.ready().cloned(),
            self.patient.entries.ready().cloned(),
            self.patient.attachments.ready().cloned(),
        ) else {
            self.patient.smart_import.end(ImportPhase::Error(
                "La scheda non è ancora letta del tutto. Attendi la lettura e riprova.".into(),
            ));
            cx.notify();
            return;
        };
        self.patient.smart_import.end(ImportPhase::Checking);
        let ticket = self.patient.smart_import.ticket.clone();
        let patient_id = patient.id.clone();
        let scope = self.scope.clone();
        self.run(
            move || {
                if !access.smart_import_enabled()? {
                    return Ok(None);
                }
                let capture = smart_import_capture(&SmartImportChart {
                    patient: &patient,
                    scope: scope.as_deref(),
                    therapies: &therapies,
                    entries: &entries,
                    attachments: &attachments,
                    plain: &plain,
                })?;
                SmartImportRequest::new(&patient, scope.as_deref(), capture).map(Some)
            },
            move |this, result, cx| {
                if !this.patient.smart_import.holds(&ticket)
                    || this.selected_id.as_deref() != Some(patient_id.as_str())
                {
                    return;
                }
                this.patient.smart_import.phase = match result {
                    Ok(Some(request)) => ImportPhase::Consent(Box::new(request)),
                    Ok(None) => {
                        ImportPhase::Unavailable(smart_import_message("kill_switch_disabled").into())
                    }
                    Err(RuntimeError::Missing) => ImportPhase::Unavailable(
                        "La scheda non ha note, voci di diario o sintesi di documenti da cui proporre.".into(),
                    ),
                    Err(RuntimeError::TooLarge) => ImportPhase::Unavailable(
                        "La scheda ha più di 32 testi utilizzabili, oltre il limite dell’host.".into(),
                    ),
                    Err(RuntimeError::LockedField) => ImportPhase::Unavailable(
                        "Le diagnosi della scheda non sono leggibili con la chiave attuale: la richiesta non parte.".into(),
                    ),
                    Err(RuntimeError::InvalidInput) => ImportPhase::Unavailable(
                        "La scheda non indica un ambulatorio leggibile o ha testi che l’host non accetta: la richiesta non parte.".into(),
                    ),
                    Err(error) => ImportPhase::Error(ui_error(error)),
                };
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }

    /// Consenso negato: nessuna chiamata.
    pub(super) fn import_decline(&mut self, cx: &mut Context<Self>) {
        if matches!(self.patient.smart_import.phase, ImportPhase::Consent(_)) {
            self.patient.smart_import.end(ImportPhase::Ended(
                "Richiesta annullata: nulla è stato inviato.".into(),
            ));
            cx.notify();
        }
    }

    /// Consenso dato: un solo invio, annullabile, per le fonti mostrate.
    pub(super) fn import_confirm(&mut self, cx: &mut Context<Self>) {
        let ImportPhase::Consent(request) = &self.patient.smart_import.phase else {
            return;
        };
        let Some(access) = self.local_host.access() else {
            self.patient.smart_import.end(ImportPhase::Unavailable(
                "Host locale chiuso: nulla è stato inviato.".into(),
            ));
            cx.notify();
            return;
        };
        if self.import_currency(request) != ImportCurrency::Current {
            self.patient.smart_import.end(ImportPhase::Error(
                "La scheda è cambiata dopo la preparazione e nulla è stato inviato. Prepara di nuovo la richiesta.".into(),
            ));
            cx.notify();
            return;
        }
        let mut sent = (**request).clone();
        if let Err(error) = sent.bind() {
            self.patient
                .smart_import
                .end(ImportPhase::Error(ui_error(error)));
            cx.notify();
            return;
        }
        self.import_send(access, sent, cx);
    }

    fn import_send(
        &mut self,
        access: Arc<LocalHostAccess>,
        sent: SmartImportRequest,
        cx: &mut Context<Self>,
    ) {
        let context = access.generation_context();
        self.patient.smart_import.end(ImportPhase::Running {
            request: Box::new(sent.clone()),
            context: context.clone(),
        });
        let ticket = self.patient.smart_import.ticket.clone();
        let patient_id = sent.patient_id.clone();
        self.run(
            move || access.preview_smart_import(&sent, &context),
            move |this, result, cx| this.import_receive(&ticket, &patient_id, result, cx),
            cx,
        );
        cx.notify();
    }

    pub(super) fn import_receive(
        &mut self,
        ticket: &Arc<()>,
        patient_id: &str,
        result: Result<SmartImportOutcome, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        // Una risposta tardiva non appartiene a un'altra scheda né a una richiesta interrotta.
        if !self.patient.smart_import.holds(ticket)
            || self.selected_id.as_deref() != Some(patient_id)
        {
            return;
        }
        let Some(request) = self.patient.smart_import.take_running() else {
            return;
        };
        let current = self.import_currency(&request) == ImportCurrency::Current;
        self.patient.smart_import.phase = match result {
            // Ogni candidato deve citare una fonte inviata con questa richiesta.
            Ok(GenerationOutcome::Proposal(proposal)) if !proposal.cites_only(&request) => {
                ImportPhase::Error(smart_import_message("response_invalid").into())
            }
            Ok(GenerationOutcome::Proposal(proposal)) if current => {
                ImportPhase::Proposal { request, proposal }
            }
            Ok(GenerationOutcome::Proposal(_)) => ImportPhase::Error(
                "Le fonti della scheda sono cambiate durante la richiesta. Nessuna proposta creata: riprova.".into(),
            ),
            Ok(GenerationOutcome::Unavailable(code)) => {
                ImportPhase::Unavailable(smart_import_message(&code).into())
            }
            Ok(GenerationOutcome::Failed(code)) => {
                ImportPhase::Error(smart_import_message(&code).into())
            }
            Err(RuntimeError::InvalidResponse) => {
                ImportPhase::Error(smart_import_message("response_invalid").into())
            }
            Err(RuntimeError::Conflict) => {
                ImportPhase::Error(smart_import_message("selection_changed").into())
            }
            Err(error) => ImportPhase::Error(format!("{} Nessuna proposta creata.", ui_error(error))),
        };
        cx.notify();
    }

    /// Un cambio di scheda chiude la richiesta in volo, invece di lasciarla «in corso».
    pub(super) fn interrupt_smart_import(&mut self) {
        match self.patient.smart_import.phase {
            ImportPhase::Running { .. } => self.patient.smart_import.end(ImportPhase::Ended(
                "Generazione interrotta dal cambio di scheda.".into(),
            )),
            ImportPhase::Checking => self.patient.smart_import.end(ImportPhase::Idle),
            _ => {}
        }
    }

    /// Interrompe la generazione in corso: la richiesta HTTP viene annullata.
    pub(super) fn import_stop(&mut self, cx: &mut Context<Self>) {
        if matches!(self.patient.smart_import.phase, ImportPhase::Running { .. }) {
            self.patient
                .smart_import
                .end(ImportPhase::Ended("Generazione interrotta.".into()));
            cx.notify();
        }
    }

    /// Scarta (revoca) la proposta mostrata. Non era stata salvata da nessuna parte.
    pub(super) fn import_discard(&mut self, cx: &mut Context<Self>) {
        if matches!(
            self.patient.smart_import.phase,
            ImportPhase::Proposal { .. }
        ) {
            self.patient
                .smart_import
                .end(ImportPhase::Ended("Proposta scartata.".into()));
            cx.notify();
        }
    }

    pub(super) fn smart_import_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div()
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(section(
                "smart-import-heading",
                "IMPORT ASSISTITO · PROPOSTA",
                theme,
            ));
        let muted = |text: String| {
            div()
                .min_w_0()
                .text_color(theme.secondary)
                .child(text!(text))
        };
        let prepare = |label: &'static str, primary: bool| {
            button("smart-import-prepare", label, theme, primary, true)
                .on_click(cx.listener(|this, _, _, cx| this.import_prepare(cx)))
        };
        if self.local_host.access().is_none()
            && matches!(self.patient.smart_import.phase, ImportPhase::Idle)
        {
            return pane.child(notice(
                "smart-import-host-closed",
                HOST_CLOSED,
                theme,
                false,
            ));
        }
        match &self.patient.smart_import.phase {
            ImportPhase::Idle => {
                pane = pane
                    .child(muted("Propone diagnosi, terapie e prestazioni trovate nelle note, nel diario e nelle sintesi dei documenti.".into()))
                    .child(prepare("Prepara la richiesta", true));
            }
            ImportPhase::Checking => {
                pane = pane.child(notice(
                    "smart-import-checking",
                    "Verifica della funzione e raccolta delle fonti…",
                    theme,
                    false,
                ));
            }
            ImportPhase::Unavailable(reason) => {
                pane = pane
                    .child(notice(
                        "smart-import-unavailable",
                        reason.clone(),
                        theme,
                        false,
                    ))
                    .when(self.local_host.access().is_some(), |el| {
                        el.child(prepare("Verifica di nuovo", false))
                    });
            }
            ImportPhase::Consent(request) => {
                pane = pane
                    .child(div().min_w_0().child(text!(consent_text(request))))
                    .child(
                        button("smart-import-confirm", "Invia e genera", theme, true, true)
                            .on_click(cx.listener(|this, _, _, cx| this.import_confirm(cx))),
                    )
                    .child(
                        button("smart-import-decline", "Annulla", theme, false, true)
                            .on_click(cx.listener(|this, _, _, cx| this.import_decline(cx))),
                    );
            }
            ImportPhase::Running { .. } => {
                pane = pane
                    .child(notice(
                        "smart-import-running",
                        "Generazione in corso sull’host.",
                        theme,
                        false,
                    ))
                    .child(
                        button("smart-import-stop", "Interrompi", theme, false, true)
                            .on_click(cx.listener(|this, _, _, cx| this.import_stop(cx))),
                    );
            }
            ImportPhase::Proposal { request, proposal } => {
                let currency = self.import_currency(request);
                if currency != ImportCurrency::Current {
                    return pane
                        .child(notice(
                            "smart-import-superseded",
                            if currency == ImportCurrency::Reading {
                                "Scheda in rilettura: la proposta torna visibile se le fonti non sono cambiate."
                            } else {
                                "Proposta superata: le fonti della scheda sono cambiate dopo la generazione."
                            },
                            theme,
                            false,
                        ))
                        .child(
                            button("smart-import-discard", "Chiudi", theme, false, true)
                                .on_click(cx.listener(|this, _, _, cx| this.import_discard(cx))),
                        )
                        .when(currency == ImportCurrency::Superseded, |el| {
                            el.child(prepare("Prepara una nuova richiesta", false))
                        });
                }
                pane = pane
                    .child(self.import_proposal_block(request, proposal))
                    .child(muted(format!(
                        "Ricevuta: {} · {} · esecuzione locale, nessuna uscita in rete · nessun passaggio ad altro modello · 0 scritture · {}",
                        proposal.provider, proposal.model, proposal.review_ref
                    )))
                    .child(
                        button("smart-import-discard", "Scarta la proposta", theme, false, true)
                            .on_click(cx.listener(|this, _, _, cx| this.import_discard(cx))),
                    )
                    .child(prepare("Nuova proposta", false));
            }
            ImportPhase::Ended(message) => {
                pane = pane
                    .child(notice("smart-import-ended", message.clone(), theme, false))
                    .child(prepare("Prepara la richiesta", false));
            }
            ImportPhase::Error(message) => {
                pane = pane
                    .child(notice("smart-import-error", message.clone(), theme, true))
                    .child(prepare("Riprova", false));
            }
        }
        pane
    }

    fn import_proposal_block(
        &self,
        request: &SmartImportRequest,
        proposal: &SmartImportProposal,
    ) -> Div {
        let theme = self.theme;
        let mut block = pencil_block(theme).child(
            div()
                .min_w_0()
                .type_role(theme, crate::theme::TextRole::Strong)
                .child(text!("Proposta da rivedere")),
        );
        if !proposal.summary.trim().is_empty() {
            block = block.child(
                div()
                    .id("smart-import-summary")
                    .min_w_0()
                    .text_color(theme.ink)
                    .child(text!(proposal.summary.clone())),
            );
        }
        if proposal.candidates().next().is_none() {
            return block.child(div().min_w_0().child(text!(
                "Nelle fonti inviate il modello non ha trovato diagnosi, terapie o prestazioni."
            )));
        }
        for (key, title, list) in [
            ("diagnoses", "Diagnosi", &proposal.diagnoses),
            ("therapies", "Terapie", &proposal.therapies),
            ("services", "Prestazioni", &proposal.services),
        ] {
            if list.is_empty() {
                continue;
            }
            block = block
                .child(section(
                    SharedString::from(format!("smart-import-{key}")),
                    title,
                    theme,
                ))
                .children(list.iter().enumerate().map(|(index, candidate)| {
                    candidate_view(
                        theme,
                        request,
                        candidate,
                        SharedString::from(format!("smart-import-{key}-{index}")),
                    )
                }));
        }
        block
    }
}

fn consent_text(request: &SmartImportRequest) -> String {
    let parts: Vec<String> = [
        ("patient-notes", "di note", "di note"),
        ("clinical-entry", "del diario", "del diario"),
        (
            "attachment-summary",
            "sintesi di documento",
            "sintesi di documenti",
        ),
    ]
    .into_iter()
    .filter_map(|(kind, one, many)| match request.count(kind) {
        0 => None,
        1 => Some(format!("1 {one}")),
        n => Some(format!("{n} {many}")),
    })
    .collect();
    format!(
        "Verranno inviati all’host {} testi della scheda ({}), con {} diagnosi e {} terapie in corso. Il modello locale dell’host ne ricava una proposta da rivedere: nella scheda non viene scritto nulla.",
        request.sources.len(),
        parts.join(", "),
        request.diagnosis_count,
        request.therapy_count
    )
}

/// La fonte di un candidato, come la scheda la nomina.
pub(super) fn candidate_source(
    request: &SmartImportRequest,
    candidate: &SmartImportCandidate,
) -> String {
    match request.source(&candidate.source_id) {
        // Le voci di diario portano già la data nel nome.
        Some(source) => match &source.date {
            Some(date) if source.kind != "clinical-entry" => {
                format!("Fonte: {} · {}", source.label, display_date(Some(date)))
            }
            _ => format!("Fonte: {}", source.label),
        },
        None => "Fonte non riconosciuta".into(),
    }
}

fn candidate_view(
    theme: Theme,
    request: &SmartImportRequest,
    candidate: &SmartImportCandidate,
    id: SharedString,
) -> Stateful<Div> {
    let muted = |text: String| {
        div()
            .min_w_0()
            .text_color(theme.secondary)
            .child(text!(text))
    };
    div()
        .id(id.clone())
        .min_w_0()
        .flex()
        .flex_col()
        .gap(px(4.))
        .child(
            div()
                .min_w_0()
                .text_color(theme.ink)
                .child(text!(candidate.title.clone())),
        )
        .children(
            candidate
                .details
                .iter()
                .map(|(label, value)| muted(format!("{label}: {value}"))),
        )
        .child(muted(format!(
            "Affidabilità dichiarata dal modello: {}",
            candidate.confidence
        )))
        .child(
            div()
                .min_w_0()
                .text_color(theme.ink)
                .child(text!(format!("«{}»", candidate.evidence))),
        )
        .child(muted(candidate_source(request, candidate)))
        .children(candidate.items.iter().enumerate().map(|(index, item)| {
            div().pl(px(14.)).child(candidate_view(
                theme,
                request,
                item,
                SharedString::from(format!("{id}-item-{index}")),
            ))
        }))
}

#[cfg(test)]
mod tests;
