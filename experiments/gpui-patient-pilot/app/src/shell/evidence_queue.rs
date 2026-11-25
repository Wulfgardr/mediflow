#[cfg(unix)]
use super::generation::{ChatArea, ChatHold};
use super::*;
use crate::theme::TypeStyle;
use mediflow_runtime_client::{EvidenceQueueRead, ProfileQueryIntent};
use std::sync::Arc;

pub(super) struct EvidenceQueue {
    patient: Option<String>,
    pub(super) rows: Load<EvidenceQueueRead>,
    ticket: Arc<()>,
    intent: Option<ProfileQueryIntent>,
    #[cfg(unix)]
    chat: ChatHold,
}
impl Default for EvidenceQueue {
    fn default() -> Self {
        Self {
            patient: None,
            rows: Load::Idle,
            ticket: Arc::new(()),
            intent: None,
            #[cfg(unix)]
            chat: ChatHold::default(),
        }
    }
}
impl EvidenceQueue {
    pub(super) fn reset(&mut self) {
        if let Some(intent) = self.intent.take() {
            intent.cancel();
        }
        *self = Self::default();
    }
    pub(super) fn patient_is(&self, patient: &str) -> bool {
        self.patient.as_deref() == Some(patient)
    }
    fn chat_ready(&self) -> bool {
        #[cfg(unix)]
        if let Some(chat) = &self.chat.0 {
            return chat.lock().is_ok_and(|mut chat| chat.function_open());
        }
        true
    }
}
#[cfg(unix)]
impl ChatArea for EvidenceQueue {
    fn can_show(&self) -> bool {
        self.patient.is_some() && self.chat_ready()
    }
    fn close_view(&mut self) {
        self.reset();
    }
    fn occupied(&self) -> bool {
        self.patient.is_some() || self.chat.0.is_some()
    }
    fn follow_chat(&mut self) -> bool {
        if self
            .chat
            .0
            .as_ref()
            .is_some_and(|chat| !chat.lock().is_ok_and(|mut chat| chat.function_held()))
        {
            self.reset();
            return true;
        }
        false
    }
    fn hold(&mut self, chat: crate::chat_access::owner::Pending) -> Arc<()> {
        self.reset();
        self.chat.0 = Some(chat);
        self.ticket.clone()
    }
    fn holds_chat(&self, ticket: &Arc<()>, chat: &crate::chat_access::owner::Pending) -> bool {
        Arc::ptr_eq(ticket, &self.ticket)
            && self
                .chat
                .0
                .as_ref()
                .is_some_and(|held| Arc::ptr_eq(held, chat))
    }
    fn release(&mut self) {
        self.reset();
    }
    fn admitted(&mut self) {}
}

impl ClinicalApp {
    pub(super) fn open_patient_evidence_queue(&mut self, cx: &mut Context<Self>) {
        let Some(patient) = self
            .patient
            .detail
            .ready()
            .filter(|patient| self.selected_id.as_deref() == Some(&patient.id))
        else {
            return;
        };
        let patient = patient.id.clone();
        self.area = Area::Patients;
        self.directory = false;
        if self.patient_section != PatientSection::Overview {
            self.section_selected(PatientSection::Overview, cx);
        }
        if self.patient_section != PatientSection::Overview {
            return;
        }
        self.who.reset();
        self.open_loops.reset();
        self.evidence_queue.patient = Some(patient);
        self.request_evidence_queue(cx);
    }
    pub(super) fn evidence_queue_location(&self) -> bool {
        self.area == Area::Patients
            && !self.directory
            && self.patient_section == PatientSection::Overview
            && self.selected_id.as_deref().is_some_and(|id| {
                self.evidence_queue.patient_is(id)
                    && self
                        .patient
                        .detail
                        .ready()
                        .is_some_and(|patient| patient.id == id)
            })
    }
    pub(super) fn request_evidence_queue(&mut self, cx: &mut Context<Self>) {
        if !self.evidence_queue_location()
            || !self.evidence_queue.chat_ready()
            || matches!(self.evidence_queue.rows, Load::Loading)
        {
            return;
        }
        let (Some(session), Some(scope), Some(patient)) = (
            self.session.clone(),
            self.scope.clone(),
            self.selected_id.clone(),
        ) else {
            return;
        };
        if let Some(previous) = self.evidence_queue.intent.take() {
            previous.cancel();
        }
        let intent = session.profile_query_intent();
        self.evidence_queue.intent = Some(intent.clone());
        self.evidence_queue.ticket = Arc::new(());
        let ticket = self.evidence_queue.ticket.clone();
        let authority = self.account_profile.generation;
        let epoch = self.epoch;
        self.evidence_queue.rows = Load::Loading;
        let task = cx
            .background_executor()
            .spawn(async move { session.read_evidence_queue(&scope, &patient, &intent) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                let error = result.as_ref().err().copied();
                if !matches!(
                    this.check_callback(authority, error, cx),
                    CallbackState::Current
                ) || this.epoch != epoch
                    || !Arc::ptr_eq(&ticket, &this.evidence_queue.ticket)
                    || !this.evidence_queue_location()
                    || !this.evidence_queue.chat_ready()
                {
                    return;
                }
                let result = result.and_then(|read| {
                    if this
                        .session
                        .as_ref()
                        .is_some_and(|session| session.evidence_queue_is_current(&read))
                    {
                        Ok(read)
                    } else {
                        Err(RuntimeError::ReadRequired)
                    }
                });
                if let Ok(read) = &result {
                    this.patient.attachments = ReadLoad::Ready(read.source_attachments().to_vec());
                }
                #[cfg(unix)]
                if let Some(chat) = this.evidence_queue.chat.0.take() {
                    let Ok(mut chat) = chat.lock() else {
                        return;
                    };
                    if !chat.function_open() {
                        return;
                    }
                    if result.is_ok() {
                        chat.close_function();
                    } else {
                        chat.withdraw();
                    }
                }
                this.evidence_queue.rows = match result {
                    Ok(rows) => Load::Ready(rows),
                    Err(_) => Load::Failed("Coda non disponibile.".into()),
                };
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub(super) fn evidence_queue_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(
                heading("evidence-queue-heading", "Evidenze dai documenti", theme)
                    .debug_selector(|| "evidence-queue-heading".into()),
            )
            .child(
                button(
                    "evidence-queue-close",
                    "Chiudi evidenze",
                    theme,
                    false,
                    true,
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.evidence_queue.reset();
                    cx.notify();
                })),
            );
        match &self.evidence_queue.rows {
            Load::Idle => pane,
            Load::Loading => pane.child(notice(
                "evidence-queue-loading",
                "Lettura in corso…",
                theme,
                false,
            )),
            Load::Failed(message) => pane
                .child(notice("evidence-queue-error", message.clone(), theme, true))
                .child(
                    button("evidence-queue-retry", "Riprova", theme, false, true)
                        .on_click(cx.listener(|this, _, _, cx| this.request_evidence_queue(cx))),
                ),
            Load::Ready(read) => {
                if !self.session.as_ref().is_some_and(|session| {
                    self.patient.attachments.ready().is_some_and(|sources| {
                        session.evidence_queue_sources_are_current(read, sources)
                    })
                }) {
                    return pane
                        .child(notice(
                            "evidence-queue-stale",
                            "Documenti cambiati.",
                            theme,
                            true,
                        ))
                        .child(
                            button(
                                "evidence-queue-refresh",
                                "Rileggi evidenze",
                                theme,
                                false,
                                true,
                            )
                            .on_click(
                                cx.listener(|this, _, _, cx| this.request_evidence_queue(cx)),
                            ),
                        );
                }
                pane = pane.child(queue_text(
                    "evidence-queue-receipt",
                    format!(
                        "Letto il {} · {} fonti · {}",
                        read.receipt["readAt"].as_str().unwrap_or_default(),
                        read.receipt["sourceCount"],
                        read.receipt["snapshotHash"].as_str().unwrap_or_default()
                    ),
                    theme,
                ));
                if let Some(items) = read.queue["items"].as_array() {
                    if items.is_empty() {
                        pane = pane.child(notice(
                            "evidence-queue-empty",
                            "Nessuna evidenza dai documenti.",
                            theme,
                            false,
                        ));
                    }
                    for (index, item) in items.iter().enumerate() {
                        let reason = match item["governance"]["reason"].as_str().unwrap_or_default()
                        {
                            "included" => "Con fonte",
                            "needs_review" => "Da rivedere",
                            "low_signal" => "Contenuto insufficiente",
                            "invalidated" => "Fonte cambiata",
                            "superseded" => "Sostituita",
                            _ => "Non corrente",
                        };
                        let mut row = div()
                            .id(SharedString::from(format!("evidence-queue-source-{index}")))
                            .debug_selector(move || format!("evidence-queue-source-{index}"))
                            .border_b_1()
                            .border_color(theme.rule)
                            .py(px(12.))
                            .child(queue_text(
                                "source",
                                format!(
                                    "{} · {}",
                                    item["source"]["label"].as_str().unwrap_or_default(),
                                    reason
                                ),
                                theme,
                            ));
                        if item["governance"]["reason"] == "included"
                            && let Some(claims) = item["renderableClaims"].as_array()
                        {
                            for (i, claim) in claims.iter().enumerate() {
                                row = row.child(
                                    div()
                                        .id(SharedString::from(format!("claim-{i}")))
                                        .child(queue_text(
                                            "label",
                                            claim["label"].as_str().unwrap_or_default().to_owned(),
                                            theme,
                                        ))
                                        .child(queue_text(
                                            "citation",
                                            format!(
                                                "{}{}{}",
                                                claim["citation"]["page"]
                                                    .as_u64()
                                                    .map(|p| format!("Pagina {p} · "))
                                                    .unwrap_or_default(),
                                                claim["citation"]["sectionTitle"]
                                                    .as_str()
                                                    .map(|s| format!("{s} · "))
                                                    .unwrap_or_default(),
                                                claim["citation"]["snippet"]
                                                    .as_str()
                                                    .unwrap_or_default()
                                            ),
                                            theme,
                                        )),
                                );
                            }
                        }
                        pane = pane.child(row);
                    }
                }
                pane
            }
        }
    }
}
fn queue_text(id: &'static str, value: impl Into<SharedString>, theme: Theme) -> Stateful<Div> {
    div()
        .id(id)
        .debug_selector(move || id.into())
        .min_w_0()
        .whitespace_normal()
        .type_role(theme, crate::theme::TextRole::Meta)
        .text_color(theme.secondary)
        .child({
            let value: SharedString = value.into();
            let text = text!(value);
            #[cfg(test)]
            let text = rendered_command::observe_text(text);
            text
        })
}
