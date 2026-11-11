//! Sintesi dei documenti (G-5b): una proposta da rivedere, generata dall'host
//! locale su richiesta esplicita a partire da un solo documento. Il server decide
//! disponibilità, currentness, estrazione, validità e citazioni; GPUI legge il
//! documento, chiede il consenso all'invio, mostra proposta, citazioni e ricevuta e
//! permette di interromperla o scartarla. La sintesi salvata del documento resta
//! quella di prima: nessuna azione scrive nella scheda.

use super::generation::{GenerationArea, GenerationPhase, Wipe, pencil_block};
use super::*;
use mediflow_runtime_client::{
    DocumentSynthesisOutcome, DocumentSynthesisProposal, DocumentSynthesisRequest,
    GenerationOutcome, LocalHostAccess, document_synthesis_message,
};
use std::sync::Arc;
use zeroize::Zeroize;

pub(super) type SynthesisPhase =
    GenerationPhase<DocumentSynthesisRequest, DocumentSynthesisProposal>;

/// Una sola sintesi alla volta per scheda, legata al documento per cui è stata chiesta.
#[derive(Default)]
pub(super) struct DocumentSynthesisArea {
    pub(super) document: Option<String>,
    pub(super) area: GenerationArea<DocumentSynthesisRequest, DocumentSynthesisProposal>,
}
impl DocumentSynthesisArea {
    fn begin(&mut self, document: &str, phase: SynthesisPhase) {
        self.area.end(phase);
        self.document = Some(document.to_owned());
    }
    fn belongs_to(&self, document: &str) -> bool {
        self.document.as_deref() == Some(document)
    }
}

impl Wipe for DocumentSynthesisRequest {
    fn wipe(&mut self) {
        DocumentSynthesisRequest::wipe(self);
    }
}
impl Wipe for DocumentSynthesisProposal {
    fn wipe(&mut self) {
        self.summary.zeroize();
        self.model.zeroize();
        for citation in &mut self.citations {
            citation.quote.zeroize();
        }
    }
}

/// Se la proposta descrive ancora il documento mostrato.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SynthesisCurrency {
    Current,
    /// I documenti sono in rilettura: la risposta si dà dopo.
    Reading,
    /// Il documento è cambiato o non c'è più: una richiesta fatta adesso invierebbe altro.
    Superseded,
}

const HOST_CLOSED: &str = "Host locale chiuso. La sintesi si genera sul Mac che ospita l’archivio: apri Gestione locale in Impostazioni e conferma l’accesso.";

impl ClinicalApp {
    fn synthesis_row(&self, document: &str) -> Option<&Attachment> {
        let patient = self.selected_id.as_deref()?;
        self.patient
            .attachments
            .ready()?
            .iter()
            .find(|row| row.id == document && row.patient_id == patient)
    }

    /// La proposta vale finché paziente, ambulatorio e documento (con la sua
    /// currentness sull'host) sono quelli che una richiesta fatta adesso invierebbe.
    pub(super) fn synthesis_currency(
        &self,
        request: &DocumentSynthesisRequest,
    ) -> SynthesisCurrency {
        if self.selected_id.as_deref() != Some(request.patient_id.as_str())
            || self.scope.as_deref() != Some(request.ambulatory_id.as_str())
        {
            return SynthesisCurrency::Superseded;
        }
        let Some(rows) = self.patient.attachments.ready() else {
            return SynthesisCurrency::Reading;
        };
        match rows.iter().find(|row| row.id == request.attachment_id) {
            Some(row) if request.matches(row) => SynthesisCurrency::Current,
            _ => SynthesisCurrency::Superseded,
        }
    }

    /// Primo passo: verifica che la funzione sia accesa sull'host, rilegge il
    /// documento e prepara la richiesta da mostrare. Nessun dato lascia GPUI qui.
    pub(super) fn synthesis_prepare(&mut self, document: &str, cx: &mut Context<Self>) {
        if !self.patient.synthesis.area.chat_ready() {
            #[cfg(unix)]
            self.patient.synthesis.area.follow_chat();
            cx.notify();
            return;
        }
        if self.patient.synthesis.area.phase.is_busy()
            && self.patient.synthesis.belongs_to(document)
        {
            return;
        }
        let Some(access) = self.local_host.access() else {
            self.patient
                .synthesis
                .begin(document, GenerationPhase::Unavailable(HOST_CLOSED.into()));
            cx.notify();
            return;
        };
        let (Some(session), Some(scope), Some(patient), Some(row)) = (
            self.session.clone(),
            self.scope.clone(),
            self.selected_id.clone(),
            self.synthesis_row(document).cloned(),
        ) else {
            self.patient.synthesis.begin(
                document,
                GenerationPhase::Error(
                    "Il documento non è ancora letto. Attendi la lettura e riprova.".into(),
                ),
            );
            cx.notify();
            return;
        };
        self.patient
            .synthesis
            .begin(document, GenerationPhase::Checking);
        let ticket = self.patient.synthesis.area.ticket.clone();
        let document = document.to_owned();
        let requested = document.clone();
        let patient_id = patient.clone();
        self.run(
            move || {
                if !access.document_synthesis_enabled()? {
                    return Ok(None);
                }
                let detail = session.read_attachment(&scope, &patient, &requested)?;
                let bytes =
                    documents::decode_attachment(&detail).map_err(|_| RuntimeError::LockedField)?;
                DocumentSynthesisRequest::new(&patient, &scope, &row, &detail, bytes).map(Some)
            },
            move |this, result, cx| {
                if !this.patient.synthesis.area.holds(&ticket)
                    || !this.patient.synthesis.belongs_to(&document)
                    || this.selected_id.as_deref() != Some(patient_id.as_str())
                {
                    return;
                }
                this.patient.synthesis.area.phase = match result {
                    Ok(Some(request)) => GenerationPhase::Consent(Box::new(request)),
                    Ok(None) => GenerationPhase::Unavailable(
                        document_synthesis_message("lane_disabled").into(),
                    ),
                    Err(RuntimeError::LockedField) => GenerationPhase::Unavailable(
                        "Il documento non è leggibile con la chiave attuale: la richiesta non parte."
                            .into(),
                    ),
                    Err(RuntimeError::TooLarge) => GenerationPhase::Unavailable(
                        "Il documento supera i 25 MiB che l’host accetta: la richiesta non parte."
                            .into(),
                    ),
                    Err(RuntimeError::ReadRequired) => GenerationPhase::Error(
                        "Il documento è cambiato dopo l’ultima lettura. Rileggi i documenti e riprova."
                            .into(),
                    ),
                    Err(error) => GenerationPhase::Error(ui_error(error)),
                };
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }

    /// Consenso negato: nessuna chiamata, nessun dato inviato.
    pub(super) fn synthesis_decline(&mut self, cx: &mut Context<Self>) {
        if matches!(
            self.patient.synthesis.area.phase,
            GenerationPhase::Consent(_)
        ) {
            self.patient.synthesis.area.end(GenerationPhase::Ended(
                "Richiesta annullata. Nessun dato è stato inviato al modello.".into(),
            ));
            cx.notify();
        }
    }

    /// Consenso dato: un solo invio, annullabile, per questo documento così com'è.
    pub(super) fn synthesis_confirm(&mut self, cx: &mut Context<Self>) {
        let GenerationPhase::Consent(request) = &self.patient.synthesis.area.phase else {
            return;
        };
        let Some(access) = self.local_host.access() else {
            self.patient
                .synthesis
                .area
                .end(GenerationPhase::Unavailable(
                    "Host locale chiuso. Nessun dato è stato inviato.".into(),
                ));
            cx.notify();
            return;
        };
        if self.synthesis_currency(request) != SynthesisCurrency::Current {
            self.patient.synthesis.area.end(GenerationPhase::Error(
                "Il documento è cambiato dopo la preparazione. Nessun dato è stato inviato: prepara di nuovo la richiesta.".into(),
            ));
            cx.notify();
            return;
        }
        let sent = (**request).clone();
        self.synthesis_send(access, sent, cx);
    }

    fn synthesis_send(
        &mut self,
        access: Arc<LocalHostAccess>,
        mut sent: DocumentSynthesisRequest,
        cx: &mut Context<Self>,
    ) {
        let context = access.generation_context();
        // Lo stato tiene il riferimento al documento; i byte viaggiano solo con l'invio.
        let mut kept = sent.clone();
        kept.wipe();
        if !self.patient.synthesis.area.start(kept, context.clone()) {
            sent.wipe();
            cx.notify();
            return;
        }
        let ticket = self.patient.synthesis.area.ticket.clone();
        let patient_id = sent.patient_id.clone();
        let document = sent.attachment_id.clone();
        self.run(
            move || access.preview_document_synthesis(&sent, &context),
            move |this, result, cx| {
                this.synthesis_receive(&ticket, &patient_id, &document, result, cx)
            },
            cx,
        );
        cx.notify();
    }

    pub(super) fn synthesis_receive(
        &mut self,
        ticket: &Arc<()>,
        patient_id: &str,
        document: &str,
        result: Result<DocumentSynthesisOutcome, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        // Una risposta tardiva non appartiene a un'altra scheda, a un altro documento
        // né a una richiesta interrotta.
        if !self.patient.synthesis.area.holds(ticket)
            || !self.patient.synthesis.belongs_to(document)
            || self.selected_id.as_deref() != Some(patient_id)
        {
            return;
        }
        let Some(request) = self.patient.synthesis.area.take_running() else {
            return;
        };
        let current = self.synthesis_currency(&request) == SynthesisCurrency::Current;
        self.patient.synthesis.area.phase = match result {
            Ok(GenerationOutcome::Proposal(proposal)) if current => {
                GenerationPhase::Proposal { request, proposal }
            }
            Ok(GenerationOutcome::Proposal(_)) => {
                GenerationPhase::Error(document_synthesis_message("currentness_mismatch").into())
            }
            Ok(GenerationOutcome::Unavailable(code)) => {
                GenerationPhase::Unavailable(document_synthesis_message(&code).into())
            }
            Ok(GenerationOutcome::Failed(code)) => {
                GenerationPhase::Error(document_synthesis_message(&code).into())
            }
            Err(RuntimeError::InvalidResponse) => {
                GenerationPhase::Error(document_synthesis_message("response_invalid").into())
            }
            Err(RuntimeError::Conflict) => GenerationPhase::Error(
                "La selezione sull’host è cambiata durante la richiesta. Riprova.".into(),
            ),
            Err(error) => GenerationPhase::Error(ui_error(error)),
        };
        cx.notify();
    }

    /// Un cambio di scheda chiude la richiesta in volo, invece di lasciarla «in corso».
    pub(super) fn interrupt_synthesis(&mut self) {
        match self.patient.synthesis.area.phase {
            GenerationPhase::Running { .. } => self.patient.synthesis.area.end(GenerationPhase::Ended(
                "Generazione interrotta da un cambio di contesto. Nessuna proposta e nessuna modifica alla scheda.".into(),
            )),
            GenerationPhase::Checking => self.patient.synthesis.area.end(GenerationPhase::Idle),
            _ => {}
        }
    }

    /// Interrompe la generazione in corso: la richiesta HTTP viene annullata.
    pub(super) fn synthesis_stop(&mut self, cx: &mut Context<Self>) {
        if matches!(
            self.patient.synthesis.area.phase,
            GenerationPhase::Running { .. }
        ) {
            self.patient.synthesis.area.end(GenerationPhase::Ended(
                "Generazione interrotta. Nessuna proposta e nessuna modifica al documento.".into(),
            ));
            cx.notify();
        }
    }

    /// Scarta (revoca) la proposta mostrata. Non era stata salvata da nessuna parte.
    pub(super) fn synthesis_discard(&mut self, cx: &mut Context<Self>) {
        if matches!(
            self.patient.synthesis.area.phase,
            GenerationPhase::Proposal { .. }
        ) {
            self.patient.synthesis.area.end(GenerationPhase::Ended(
                "Proposta scartata. La sintesi salvata del documento non è cambiata.".into(),
            ));
            cx.notify();
        }
    }

    pub(super) fn synthesis_chat_notice(&self) -> Option<&'static str> {
        #[cfg(unix)]
        if self.patient.synthesis.area.chat.0.is_some() {
            return match self.patient.synthesis.area.phase {
                GenerationPhase::Checking if !self.patient.synthesis.area.chat_ready() => {
                    Some("Verifica della sintesi dei documenti…")
                }
                GenerationPhase::Idle => Some(
                    if self.patient.attachments.ready().is_some_and(Vec::is_empty) {
                        "Nessun documento da sintetizzare. Aggiungi un documento oppure revoca la richiesta dalla chat."
                    } else {
                        "Scegli un documento e apri Sintesi e fonte."
                    },
                ),
                _ => None,
            };
        }
        None
    }

    pub(super) fn document_synthesis_view(&self, row: &Attachment, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let id = row.id.clone();
        let mut pane = div()
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(section(
                SharedString::from(format!("document-synthesis-heading-{id}")),
                "NUOVA SINTESI · PROPOSTA",
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
            let document = id.clone();
            button("document-synthesis-prepare", label, theme, primary, true)
                .on_click(cx.listener(move |this, _, _, cx| this.synthesis_prepare(&document, cx)))
        };
        if !self.patient.synthesis.area.chat_ready() {
            return pane.child(notice(
                "document-synthesis-chat-admission",
                "Verifica della sintesi dei documenti…",
                theme,
                false,
            ));
        }
        let synthesis = &self.patient.synthesis;
        if !synthesis.belongs_to(&id) {
            if self.local_host.access().is_none() {
                return pane.child(notice(
                    "document-synthesis-host-closed",
                    HOST_CLOSED,
                    theme,
                    false,
                ));
            }
            let other_open = synthesis.document.is_some()
                && matches!(
                    synthesis.area.phase,
                    GenerationPhase::Running { .. }
                        | GenerationPhase::Proposal { .. }
                        | GenerationPhase::Consent(_)
                );
            return pane
                .when(other_open, |el| {
                    el.child(muted(
                        "Preparare questa sintesi chiude quella aperta su un altro documento."
                            .into(),
                    ))
                })
                .child(prepare("Prepara la richiesta", true));
        }
        match &synthesis.area.phase {
            GenerationPhase::Idle => {
                pane = pane.child(prepare("Prepara la richiesta", true));
            }
            GenerationPhase::Checking => {
                pane = pane.child(notice(
                    "document-synthesis-checking",
                    "Verifica della funzione e lettura del documento…",
                    theme,
                    false,
                ));
            }
            GenerationPhase::Unavailable(reason) => {
                pane = pane
                    .child(notice(
                        "document-synthesis-unavailable",
                        reason.clone(),
                        theme,
                        false,
                    ))
                    .when(self.local_host.access().is_some(), |el| {
                        el.child(prepare("Verifica di nuovo", false))
                    });
            }
            GenerationPhase::Consent(request) => {
                pane = pane
                    .child(line(format!(
                        "Verrà inviato all’host il documento «{}» ({}, {}). L’host ne estrae il testo e lo passa al modello locale.",
                        request.name,
                        request.mime_type,
                        format_size(request.byte_length() as u64)
                    )))
                    .child(muted("Il testo non lascia il computer dell’host. La risposta resta una proposta: la sintesi salvata del documento non cambia.".into()))
                    .child(
                        button("document-synthesis-confirm", "Invia e genera", theme, true, true)
                            .on_click(cx.listener(|this, _, _, cx| this.synthesis_confirm(cx))),
                    )
                    .child(
                        button("document-synthesis-decline", "Annulla", theme, false, true)
                            .on_click(cx.listener(|this, _, _, cx| this.synthesis_decline(cx))),
                    );
            }
            GenerationPhase::Running { .. } => {
                pane = pane
                    .child(notice(
                        "document-synthesis-running",
                        "Estrazione e generazione in corso sull’host.",
                        theme,
                        false,
                    ))
                    .child(
                        button("document-synthesis-stop", "Interrompi", theme, false, true)
                            .on_click(cx.listener(|this, _, _, cx| this.synthesis_stop(cx))),
                    );
            }
            GenerationPhase::Proposal { request, proposal } => {
                match self.synthesis_currency(request) {
                    SynthesisCurrency::Current => {}
                    currency => {
                        return pane
                            .child(notice(
                                "document-synthesis-superseded",
                                if currency == SynthesisCurrency::Reading {
                                    "Documenti in rilettura: la proposta torna visibile se il documento non è cambiato."
                                } else {
                                    "Proposta superata: il documento è cambiato o è stato tolto dopo la generazione."
                                },
                                theme,
                                false,
                            ))
                            .child(
                                button("document-synthesis-discard", "Chiudi", theme, false, true)
                                    .on_click(cx.listener(|this, _, _, cx| this.synthesis_discard(cx))),
                            )
                            .when(currency == SynthesisCurrency::Superseded, |el| {
                                el.child(prepare("Prepara una nuova richiesta", false))
                            });
                    }
                }
                pane = pane
                    .child(
                        pencil_block(theme)
                            .child(line("Proposta da rivedere. La sintesi salvata del documento resta invariata.".into()))
                            .child(
                                div()
                                    .id(SharedString::from(format!("document-synthesis-summary-{id}")))
                                    .min_w_0()
                                    .text_color(theme.ink)
                                    .child(text!(proposal.summary.clone())),
                            )
                            .children(proposal.citations.iter().enumerate().map(|(index, citation)| {
                                div()
                                    .id(SharedString::from(format!("document-synthesis-citation-{index}")))
                                    .min_w_0()
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .child(muted(format!("{} · {}", citation.label, request.name)))
                                    .child(div().min_w_0().text_color(theme.ink).child(text!(citation.quote.clone())))
                            })),
                    )
                    .child(muted(format!(
                        "Ricevuta: {} · {} · esecuzione locale, nessuna uscita in rete · nessun passaggio ad altro modello · 0 scritture · qualità dichiarata dal modello: {} · output {}",
                        proposal.provider, proposal.model, quality(&proposal.quality_level), proposal.output_sha256
                    )))
                    .child(
                        button("document-synthesis-discard", "Scarta la proposta", theme, false, true)
                            .on_click(cx.listener(|this, _, _, cx| this.synthesis_discard(cx))),
                    )
                    .child(prepare("Nuova proposta", false));
            }
            GenerationPhase::Ended(message) => {
                pane = pane
                    .child(notice(
                        "document-synthesis-ended",
                        message.clone(),
                        theme,
                        false,
                    ))
                    .child(prepare("Prepara la richiesta", false));
            }
            GenerationPhase::Error(message) => {
                pane = pane
                    .child(notice(
                        "document-synthesis-error",
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

fn quality(level: &str) -> &'static str {
    match level {
        "green" => "buona",
        "yellow" => "parziale",
        _ => "scarsa",
    }
}

#[cfg(test)]
mod tests;
