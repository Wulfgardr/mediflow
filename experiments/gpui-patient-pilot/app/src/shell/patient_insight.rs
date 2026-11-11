//! Quadro paziente (G-5a): una proposta da rivedere, generata dall'host locale su
//! richiesta esplicita. Il server decide disponibilità, validità e fonti; GPUI
//! chiede il consenso all'invio, mostra proposta, fonti e ricevuta e permette di
//! interromperla o scartarla. Nessuna azione scrive nella scheda.

use super::generation::{GenerationArea, GenerationPhase, Wipe, pencil_block};
use super::*;
use mediflow_runtime_client::{
    LocalHostAccess, PatientInsightOutcome, PatientInsightProposal, PatientInsightRequest,
    build_patient_insight_request, cited_sources, patient_insight_capture, patient_insight_message,
    patient_insight_sources,
};
use serde_json::Value;
use std::sync::Arc;
use zeroize::Zeroize;

pub(super) type InsightPhase = GenerationPhase<PatientInsightRequest, PatientInsightProposal>;
/// Stato del Quadro paziente, legato a una sola scheda: cambia con `PatientData`.
pub(super) type PatientInsightArea = GenerationArea<PatientInsightRequest, PatientInsightProposal>;

impl Wipe for PatientInsightProposal {
    fn wipe(&mut self) {
        for text in [&mut self.summary, &mut self.model]
            .into_iter()
            .chain(self.current_state.iter_mut())
            .chain(self.alerts.iter_mut())
            .chain(self.next_steps.iter_mut())
            .chain(self.gaps.iter_mut())
        {
            text.zeroize();
        }
    }
}
impl Wipe for PatientInsightRequest {
    fn wipe(&mut self) {
        for source in &mut self.sources {
            source.text.zeroize();
        }
        self.body = Value::Null;
    }
}

/// Una riga mostrata: sezione, testo, fonti citate risolte nel testo inviato.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct InsightLine {
    pub(super) section: &'static str,
    pub(super) text: String,
    pub(super) sources: Vec<String>,
}

/// Righe della proposta con le fonti che citano: è ciò che la vista disegna.
pub(super) fn insight_lines(
    request: &PatientInsightRequest,
    proposal: &PatientInsightProposal,
) -> Vec<InsightLine> {
    proposal
        .lines()
        .into_iter()
        .map(|(section, text)| InsightLine {
            section,
            text: text.to_owned(),
            sources: cited_sources(text)
                .into_iter()
                .filter_map(|index| request.sources.get(index.wrapping_sub(1)))
                .map(|source| format!("{} · {}: {}", source.token, source.kind, source.text))
                .collect(),
        })
        .collect()
}

impl ClinicalApp {
    fn insight_patient(&self) -> Option<&PatientDetail> {
        let detail = self.patient.detail.ready()?;
        (self.selected_id.as_deref() == Some(detail.id.as_str())).then_some(detail)
    }

    /// La proposta descrive ancora la scheda mostrata: stessa revisione del paziente
    /// e stesse fonti minimizzate di allora. Diario e terapie cambiano senza alzare
    /// la revisione del paziente, quindi si confrontano le fonti. Se diario o terapie
    /// non sono letti in questo momento, la proposta non vale come attuale.
    pub(super) fn insight_is_current(
        &self,
        request: &PatientInsightRequest,
        proposal: &PatientInsightProposal,
    ) -> bool {
        let (Some(patient), Some(therapies), Some(entries)) = (
            self.insight_patient(),
            self.patient.therapies.ready(),
            self.patient.entries.ready(),
        ) else {
            return false;
        };
        patient.version == proposal.patient_revision
            && patient_insight_sources(patient, self.scope.as_deref(), therapies, entries)
                .is_ok_and(|sources| sources == request.sources)
    }

    /// Primo passo: verifica che la funzione sia accesa sull'host e prepara la
    /// richiesta da mostrare. Nessun dato clinico lascia GPUI in questo passo.
    pub(super) fn insight_prepare(&mut self, cx: &mut Context<Self>) {
        if self.patient.insight.phase.is_busy() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            self.patient.insight.end(InsightPhase::Unavailable(
                "Host locale chiuso. Il Quadro paziente si genera sul Mac che ospita l’archivio: apri Gestione locale in Impostazioni e conferma l’accesso.".into(),
            ));
            cx.notify();
            return;
        };
        let (Some(patient), Some(therapies), Some(entries)) = (
            self.insight_patient().cloned(),
            self.patient.therapies.ready().cloned(),
            self.patient.entries.ready().cloned(),
        ) else {
            self.patient.insight.end(InsightPhase::Error(
                "Scheda, terapie e diario non sono ancora letti. Attendi la lettura e riprova."
                    .into(),
            ));
            cx.notify();
            return;
        };
        self.patient.insight.end(InsightPhase::Checking);
        let ticket = self.patient.insight.ticket.clone();
        let patient_id = patient.id.clone();
        let scope = self.scope.clone();
        self.run(
            move || {
                if !access.patient_insight_enabled()? {
                    return Ok(None);
                }
                let capture =
                    patient_insight_capture(&patient, scope.as_deref(), &therapies, &entries)?;
                build_patient_insight_request(&capture).map(Some)
            },
            move |this, result, cx| {
                if !this.patient.insight.holds(&ticket)
                    || this.selected_id.as_deref() != Some(patient_id.as_str())
                {
                    return;
                }
                this.patient.insight.phase = match result {
                    Ok(Some(request)) => InsightPhase::Consent(Box::new(request)),
                    Ok(None) => InsightPhase::Unavailable(
                        patient_insight_message("kill_switch_disabled").into(),
                    ),
                    Err(RuntimeError::LockedField) => InsightPhase::Unavailable(
                        "Le diagnosi della scheda non sono leggibili: la richiesta non parte."
                            .into(),
                    ),
                    Err(RuntimeError::InvalidInput) => InsightPhase::Unavailable(
                        "La scheda non indica identità e ambulatorio leggibili: la richiesta non parte."
                            .into(),
                    ),
                    Err(error) => InsightPhase::Error(ui_error(error)),
                };
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }

    /// Consenso negato: nessuna chiamata, nessun dato inviato.
    pub(super) fn insight_decline(&mut self, cx: &mut Context<Self>) {
        if matches!(self.patient.insight.phase, InsightPhase::Consent(_)) {
            self.patient.insight.end(InsightPhase::Ended(
                "Richiesta annullata. Nessun dato è stato inviato al modello.".into(),
            ));
            cx.notify();
        }
    }

    /// Consenso dato: un solo invio, annullabile, per questa scheda e questa revisione.
    pub(super) fn insight_confirm(&mut self, cx: &mut Context<Self>) {
        let InsightPhase::Consent(consented) = &self.patient.insight.phase else {
            return;
        };
        let consented_sources = consented.sources.clone();
        let consented_revision = consented.patient_revision;
        let Some(access) = self.local_host.access() else {
            self.patient.insight.end(InsightPhase::Unavailable(
                "Host locale chiuso. Nessun dato è stato inviato.".into(),
            ));
            cx.notify();
            return;
        };
        // Identificativo e ora nuovi; le fonti devono restare quelle mostrate.
        let fresh = match (
            self.insight_patient(),
            self.patient.therapies.ready(),
            self.patient.entries.ready(),
        ) {
            (Some(patient), Some(therapies), Some(entries)) => {
                patient_insight_capture(patient, self.scope.as_deref(), therapies, entries)
                    .and_then(|capture| build_patient_insight_request(&capture))
            }
            _ => Err(RuntimeError::ReadRequired),
        };
        let request = match fresh {
            Ok(request)
                if request.sources == consented_sources
                    && request.patient_revision == consented_revision =>
            {
                request
            }
            _ => {
                self.patient.insight.end(InsightPhase::Error(
                    "La scheda è cambiata dopo la preparazione. Nessun dato è stato inviato: prepara di nuovo la richiesta.".into(),
                ));
                cx.notify();
                return;
            }
        };
        self.insight_send(access, request, cx);
    }

    fn insight_send(
        &mut self,
        access: Arc<LocalHostAccess>,
        request: PatientInsightRequest,
        cx: &mut Context<Self>,
    ) {
        let context = access.generation_context();
        let mut sent = request.clone();
        if !self.patient.insight.start(request, context.clone()) {
            sent.wipe();
            cx.notify();
            return;
        }
        let ticket = self.patient.insight.ticket.clone();
        let patient_id = sent.patient_id.clone();
        self.run(
            move || access.preview_patient_insight(&sent, &context),
            move |this, result, cx| this.insight_receive(&ticket, &patient_id, result, cx),
            cx,
        );
        cx.notify();
    }

    fn insight_receive(
        &mut self,
        ticket: &Arc<()>,
        patient_id: &str,
        result: Result<PatientInsightOutcome, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        // Una risposta tardiva non appartiene a un'altra scheda né a una richiesta interrotta.
        if !self.patient.insight.holds(ticket) || self.selected_id.as_deref() != Some(patient_id) {
            return;
        }
        if !matches!(self.patient.insight.phase, InsightPhase::Running { .. }) {
            return;
        }
        let Some(request) = self.patient.insight.take_running() else {
            return;
        };
        let shown = match result {
            Ok(PatientInsightOutcome::Proposal(proposal))
                if self.insight_patient().is_some_and(|p| {
                    p.id == patient_id && p.version == proposal.patient_revision
                }) =>
            {
                Ok(proposal)
            }
            Ok(PatientInsightOutcome::Proposal(_)) => Err(InsightPhase::Error(
                patient_insight_message("source_stale").into(),
            )),
            Ok(PatientInsightOutcome::Unavailable(code)) => Err(InsightPhase::Unavailable(
                patient_insight_message(&code).into(),
            )),
            Ok(PatientInsightOutcome::Failed(code)) => {
                Err(InsightPhase::Error(patient_insight_message(&code).into()))
            }
            Err(RuntimeError::InvalidResponse) => Err(InsightPhase::Error(
                patient_insight_message("response_invalid").into(),
            )),
            Err(error) => Err(InsightPhase::Error(ui_error(error))),
        };
        self.patient.insight.phase = match shown {
            Ok(proposal) => InsightPhase::Proposal { request, proposal },
            Err(phase) => {
                // Senza proposta il testo inviato non serve più: non resta in memoria.
                let mut request = request;
                request.wipe();
                phase
            }
        };
        cx.notify();
    }

    /// Un cambio di contesto scarta i risultati della richiesta in volo: la si chiude
    /// qui, invece di lasciarla «in corso» per sempre. Una proposta già mostrata resta.
    pub(super) fn interrupt_insight(&mut self) {
        match self.patient.insight.phase {
            InsightPhase::Running { .. } => self.patient.insight.end(InsightPhase::Ended(
                "Generazione interrotta da un cambio di contesto. Nessuna proposta e nessuna modifica alla scheda.".into(),
            )),
            InsightPhase::Checking => self.patient.insight.end(InsightPhase::Idle),
            _ => {}
        }
    }

    /// Interrompe la generazione in corso: la richiesta HTTP viene annullata.
    pub(super) fn insight_stop(&mut self, cx: &mut Context<Self>) {
        if matches!(self.patient.insight.phase, InsightPhase::Running { .. }) {
            self.patient.insight.end(InsightPhase::Ended(
                "Generazione interrotta. Nessuna proposta e nessuna modifica alla scheda.".into(),
            ));
            cx.notify();
        }
    }

    /// Scarta (revoca) la proposta mostrata. Non era stata salvata da nessuna parte.
    pub(super) fn insight_discard(&mut self, cx: &mut Context<Self>) {
        if matches!(self.patient.insight.phase, InsightPhase::Proposal { .. }) {
            self.patient.insight.end(InsightPhase::Ended(
                "Proposta scartata. La scheda non è stata modificata.".into(),
            ));
            cx.notify();
        }
    }

    pub(super) fn patient_insight_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(section(
                "patient-insight-heading",
                "QUADRO PAZIENTE · PROPOSTA",
                theme,
            ));
        let line = |text: String| div().min_w_0().child(text!(text));
        let muted = |text: String| {
            div()
                .min_w_0()
                .text_color(theme.secondary)
                .child(text!(text))
        };
        let prepare = |label: &'static str, primary: bool| {
            button("patient-insight-prepare", label, theme, primary, true)
                .on_click(cx.listener(|this, _, _, cx| this.insight_prepare(cx)))
        };
        match &self.patient.insight.phase {
            InsightPhase::Idle => {
                if self.local_host.access().is_none() {
                    return pane.child(notice(
                        "patient-insight-host-closed",
                        "Host locale chiuso. Il Quadro paziente si genera sul Mac che ospita l’archivio: apri Gestione locale in Impostazioni e conferma l’accesso.",
                        theme,
                        false,
                    ));
                }
                pane = pane
                    .child(muted("Un riepilogo temporaneo dal modello locale dell’host, da confrontare con la scheda. Nessun aggiornamento automatico.".into()))
                    .child(prepare("Prepara la richiesta", true));
            }
            InsightPhase::Checking => {
                pane = pane.child(notice(
                    "patient-insight-checking",
                    "Verifica della funzione sull’host…",
                    theme,
                    false,
                ));
            }
            InsightPhase::Unavailable(reason) => {
                pane = pane
                    .child(notice(
                        "patient-insight-unavailable",
                        reason.clone(),
                        theme,
                        false,
                    ))
                    .when(self.local_host.access().is_some(), |el| {
                        el.child(prepare("Verifica di nuovo", false))
                    });
            }
            InsightPhase::Consent(request) => {
                pane = pane
                    .child(line(format!(
                        "Verranno inviati al modello locale dell’host: {} condizioni, {} terapie attive, {} voci recenti del diario. Nome, codice fiscale e recapiti non vengono inviati.",
                        request.condition_count(),
                        request.therapy_count(),
                        request.event_count()
                    )))
                    .child(muted("Il testo non lascia il computer dell’host. La risposta resta una proposta: la scheda non cambia.".into()))
                    .child(
                        button("patient-insight-confirm", "Invia e genera", theme, true, true)
                            .on_click(cx.listener(|this, _, _, cx| this.insight_confirm(cx))),
                    )
                    .child(
                        button("patient-insight-decline", "Annulla", theme, false, true)
                            .on_click(cx.listener(|this, _, _, cx| this.insight_decline(cx))),
                    );
            }
            InsightPhase::Running { .. } => {
                pane = pane
                    .child(notice(
                        "patient-insight-running",
                        "Generazione in corso sul modello locale dell’host.",
                        theme,
                        false,
                    ))
                    .child(
                        button("patient-insight-stop", "Interrompi", theme, false, true)
                            .on_click(cx.listener(|this, _, _, cx| this.insight_stop(cx))),
                    );
            }
            InsightPhase::Proposal { request, proposal } => {
                if !self.insight_is_current(request, proposal) {
                    return pane
                        .child(notice(
                            "patient-insight-obsolete",
                            "Proposta superata: profilo, diario o terapie sono cambiati dopo la generazione, oppure la scheda è in rilettura.",
                            theme,
                            false,
                        ))
                        .child(
                            button("patient-insight-discard", "Chiudi", theme, false, true)
                                .on_click(cx.listener(|this, _, _, cx| this.insight_discard(cx))),
                        )
                        .child(prepare("Prepara una nuova richiesta", false));
                }
                pane = pane
                    .child(
                        pencil_block(theme)
                            .child(line("Proposta da rivedere. La scheda resta invariata.".into()))
                            .children(insight_lines(request, proposal).into_iter().enumerate().map(
                                |(index, row)| {
                                    let warning = row.section == "Attenzioni proposte";
                                    div()
                                        .id(SharedString::from(format!("patient-insight-line-{index}")))
                                        .min_w_0()
                                        .flex()
                                        .flex_col()
                                        .gap(px(4.))
                                        .child(muted(row.section.to_owned()))
                                        .child(
                                            div()
                                                .min_w_0()
                                                .text_color(if warning { theme.warning } else { theme.ink })
                                                .child(text!(row.text)),
                                        )
                                        .children(row.sources.into_iter().map(|source| {
                                            div()
                                                .min_w_0()
                                                .text_color(theme.secondary)
                                                .child(text!(format!("Fonte {source}")))
                                        }))
                                },
                            )),
                    )
                    .child(muted(format!(
                        "Ricevuta: {} · {} · esecuzione locale, nessuna uscita in rete · {} · 0 scritture · riferimento {}",
                        proposal.provider, proposal.model, proposal.preprocessing.join(" e "), proposal.review_ref
                    )))
                    .child(muted(format!(
                        "Revisione della scheda {} · dati raccolti {} · verificati {}",
                        proposal.patient_revision,
                        crate::components::display_instant(&proposal.captured_at),
                        crate::components::display_instant(&proposal.verified_at)
                    )))
                    .child(
                        button("patient-insight-discard", "Scarta la proposta", theme, false, true)
                            .on_click(cx.listener(|this, _, _, cx| this.insight_discard(cx))),
                    )
                    .child(prepare("Nuova proposta", false));
            }
            InsightPhase::Ended(message) => {
                pane = pane
                    .child(notice(
                        "patient-insight-ended",
                        message.clone(),
                        theme,
                        false,
                    ))
                    .child(prepare("Prepara la richiesta", false));
            }
            InsightPhase::Error(message) => {
                pane = pane
                    .child(notice(
                        "patient-insight-error",
                        message.clone(),
                        theme,
                        true,
                    ))
                    .child(prepare("Riprova", false));
            }
        }
        pane
    }
}

#[cfg(test)]
mod tests;
