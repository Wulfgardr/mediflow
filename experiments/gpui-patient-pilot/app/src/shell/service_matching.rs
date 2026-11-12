#[cfg(unix)]
use super::generation::{ChatArea, ChatHold};
use super::*;
use crate::theme::TypeStyle;
use mediflow_runtime_client::{
    PreparedServiceMatch, ProfileQueryIntent, ServiceMatchReceipt, ServiceMatchingRead,
};
use std::sync::Arc;

pub(super) struct ServiceMatching {
    patient: Option<String>,
    rows: Load<ServiceMatchingRead>,
    query: Option<Entity<TextInput>>,
    item: Option<usize>,
    prepared: Option<Arc<PreparedServiceMatch>>,
    receipt: Option<ServiceMatchReceipt>,
    error: Option<String>,
    pub(super) saving: bool,
    ticket: Arc<()>,
    intent: Option<ProfileQueryIntent>,
    #[cfg(unix)]
    chat: ChatHold,
}
impl Default for ServiceMatching {
    fn default() -> Self {
        Self {
            patient: None,
            rows: Load::Idle,
            query: None,
            item: None,
            prepared: None,
            receipt: None,
            error: None,
            saving: false,
            ticket: Arc::new(()),
            intent: None,
            #[cfg(unix)]
            chat: ChatHold::default(),
        }
    }
}
impl ServiceMatching {
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
impl ChatArea for ServiceMatching {
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
    pub(super) fn open_service_matching(&mut self, cx: &mut Context<Self>) {
        let Some(patient) = self
            .patient
            .detail
            .ready()
            .filter(|p| self.selected_id.as_deref() == Some(&p.id))
        else {
            return;
        };
        let patient = patient.id.clone();
        self.area = Area::Patients;
        self.directory = false;
        if self.patient_section != PatientSection::Overview {
            self.section_selected(PatientSection::Overview, cx);
        }
        self.who.reset();
        self.open_loops.reset();
        self.evidence_queue.reset();
        self.service_matching.patient = Some(patient);
        self.service_matching.query = Some(cx.new(|cx| {
            TextInput::new(
                "service-matching-query",
                "Cerca nel repertorio prestazioni",
                "Nome o codice",
                false,
                self.theme,
                cx,
            )
        }));
        self.request_service_matching(cx);
    }
    fn matching_location(&self) -> bool {
        self.area == Area::Patients
            && !self.directory
            && self.patient_section == PatientSection::Overview
            && self.selected_id.as_deref().is_some_and(|id| {
                self.service_matching.patient.as_deref() == Some(id)
                    && self
                        .patient
                        .detail
                        .ready()
                        .is_some_and(|patient| patient.id == id)
            })
    }
    pub(super) fn prepare_service_matching_render(&mut self, cx: &mut Context<Self>) {
        if let Some(query) = &self.service_matching.query {
            let disabled =
                self.service_matching.saving || matches!(self.service_matching.rows, Load::Loading);
            query.update(cx, |input, cx| input.configure(self.theme, disabled, cx));
        }
    }
    fn request_service_matching(&mut self, cx: &mut Context<Self>) {
        if !self.matching_location()
            || !self.service_matching.chat_ready()
            || self.service_matching.saving
            || matches!(self.service_matching.rows, Load::Loading)
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
        if let Some(intent) = self.service_matching.intent.take() {
            intent.cancel();
        }
        let intent = session.profile_query_intent();
        self.service_matching.intent = Some(intent.clone());
        let query = self
            .service_matching
            .query
            .as_ref()
            .map(|q| q.read(cx).value().to_owned())
            .unwrap_or_default();
        let ticket = Arc::new(());
        self.service_matching.ticket = ticket.clone();
        let authority = self.account_profile.generation;
        let epoch = self.epoch;
        self.service_matching.rows = Load::Loading;
        self.service_matching.item = None;
        self.service_matching.prepared = None;
        self.service_matching.error = None;
        self.service_matching.receipt = None;
        let task = cx
            .background_executor()
            .spawn(async move { session.read_service_matching(&scope, &patient, &query, &intent) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if !matches!(
                    this.check_callback(authority, result.as_ref().err().copied(), cx),
                    CallbackState::Current
                ) || this.epoch != epoch
                    || !Arc::ptr_eq(&ticket, &this.service_matching.ticket)
                    || !this.matching_location()
                    || !this.service_matching.chat_ready()
                {
                    return;
                }
                this.service_matching.rows = match result {
                    Ok(read)
                        if this
                            .session
                            .as_ref()
                            .is_some_and(|s| s.service_matching_is_current(&read)) =>
                    {
                        Load::Ready(read)
                    }
                    _ => {
                        #[cfg(unix)]
                        if let Some(chat) = this.service_matching.chat.0.take()
                            && let Ok(mut chat) = chat.lock()
                        {
                            chat.withdraw();
                        }
                        Load::Failed("Prestazioni non disponibili. Riprova dalla scheda.".into())
                    }
                };
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    fn choose_service_item(&mut self, index: usize, cx: &mut Context<Self>) {
        if self.service_matching.saving || !self.service_matching.chat_ready() {
            return;
        }
        if self.service_matching.rows.ready().is_some_and(|r| {
            r.items().get(index).is_some()
                && self
                    .session
                    .as_ref()
                    .is_some_and(|s| s.service_matching_is_current(r))
        }) {
            self.service_matching.item = Some(index);
            self.service_matching.prepared = None;
            cx.notify();
        }
    }
    fn choose_service_catalog(&mut self, index: usize, cx: &mut Context<Self>) {
        if self.service_matching.saving || !self.service_matching.chat_ready() {
            return;
        }
        let (Some(read), Some(item), Some(session)) = (
            self.service_matching.rows.ready(),
            self.service_matching.item,
            self.session.as_ref(),
        ) else {
            return;
        };
        self.service_matching.prepared = session
            .prepare_service_match(read, item, index)
            .ok()
            .map(Arc::new);
        cx.notify();
    }
    fn confirm_service_matching(&mut self, cx: &mut Context<Self>) {
        if !self.matching_location()
            || !self.service_matching.chat_ready()
            || self.service_matching.saving
        {
            return;
        }
        let (Some(prepared), Some(session)) =
            (self.service_matching.prepared.take(), self.session.clone())
        else {
            return;
        };
        let ticket = self.service_matching.ticket.clone();
        let authority = self.account_profile.generation;
        let epoch = self.epoch;
        self.service_matching.saving = true;
        self.service_matching.error = None;
        let task = cx
            .background_executor()
            .spawn(async move { session.confirm_service_match(&prepared) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if !matches!(
                    this.check_callback(authority, result.as_ref().err().copied(), cx),
                    CallbackState::Current
                ) || this.epoch != epoch
                    || !Arc::ptr_eq(&ticket, &this.service_matching.ticket)
                    || !this.matching_location()
                    || !this.service_matching.chat_ready()
                {
                    return;
                }
                this.service_matching.saving = false;
                match result {
                    Ok(receipt) => {
                        this.service_matching.receipt = Some(receipt);
                        #[cfg(unix)]
                        if let Some(chat) = this.service_matching.chat.0.take()
                            && let Ok(mut chat) = chat.lock()
                        {
                            chat.close_function();
                        }
                    }
                    Err(error) => {
                        #[cfg(unix)]
                        if let Some(chat) = this.service_matching.chat.0.take()
                            && let Ok(mut chat) = chat.lock()
                        {
                            chat.withdraw();
                        }
                        this.service_matching.error = Some(if error.is_conflict() {
                            "La prestazione è cambiata. Rileggi prima di confermare.".into()
                        } else if error.is_indeterminate() {
                            "Esito da verificare. Rileggi la prestazione prima di un nuovo invio."
                                .into()
                        } else {
                            "Abbinamento non registrato. Rileggi prima di confermare.".into()
                        });
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub(super) fn service_matching_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let saving = self.service_matching.saving;
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(heading(
                "service-matching-heading",
                "Abbinamento prestazioni",
                theme,
            ))
            .child(
                button(
                    "service-matching-close",
                    "Chiudi abbinamento",
                    theme,
                    false,
                    !saving,
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.service_matching.reset();
                    cx.notify();
                })),
            );
        if let Some(receipt) = &self.service_matching.receipt {
            if !self
                .session
                .as_ref()
                .is_some_and(|s| s.service_match_receipt_is_current(receipt))
            {
                return pane.child(notice(
                    "service-matching-stale",
                    "Contesto cambiato. Riapri l’abbinamento.",
                    theme,
                    false,
                ));
            }
            return pane.child(match_text(
                "service-matching-receipt",
                format!(
                    "{} → {} · {}. Registrato il {} · versione {}",
                    receipt.service_name,
                    receipt.service_code,
                    receipt.display_name,
                    receipt.read_at,
                    receipt.version
                ),
                theme,
            ));
        }
        if saving {
            return pane.child(notice(
                "service-matching-saving",
                "Registrazione in corso…",
                theme,
                false,
            ));
        }
        if let Some(error) = &self.service_matching.error {
            return pane
                .child(notice("service-matching-error", error.clone(), theme, true))
                .child(
                    button(
                        "service-matching-reload",
                        "Rileggi prestazioni",
                        theme,
                        false,
                        true,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.request_service_matching(cx))),
                );
        }
        let read = match &self.service_matching.rows {
            Load::Ready(read)
                if self
                    .session
                    .as_ref()
                    .is_some_and(|s| s.service_matching_is_current(read)) =>
            {
                read
            }
            Load::Loading => {
                return pane.child(notice(
                    "service-matching-loading",
                    "Lettura in corso…",
                    theme,
                    false,
                ));
            }
            _ => {
                return pane
                    .child(notice(
                        "service-matching-unavailable",
                        "Rileggi le prestazioni per continuare.",
                        theme,
                        false,
                    ))
                    .child(
                        button(
                            "service-matching-reload",
                            "Rileggi prestazioni",
                            theme,
                            false,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| this.request_service_matching(cx))),
                    );
            }
        };
        if read.items().is_empty() {
            return pane.child(notice(
                "service-matching-empty",
                "Nessuna prestazione da abbinare.",
                theme,
                false,
            ));
        }
        pane = pane.child(match_text(
            "service-matching-items-label",
            "Prestazione da abbinare",
            theme,
        ));
        for (index, item) in read.items().iter().enumerate() {
            pane = pane.child(
                button(
                    SharedString::from(format!("service-matching-item-{index}")),
                    format!(
                        "{} · {} · v{}",
                        item.service_name,
                        match_status_label(&item.status),
                        item.version
                    ),
                    theme,
                    self.service_matching.item == Some(index),
                    true,
                )
                .on_click(cx.listener(move |this, _, _, cx| this.choose_service_item(index, cx))),
            );
        }
        if let Some(query) = &self.service_matching.query {
            pane = pane.child(query.clone());
        }
        pane = pane.child(
            button(
                "service-matching-search",
                "Cerca prestazioni",
                theme,
                false,
                true,
            )
            .on_click(cx.listener(|this, _, _, cx| this.request_service_matching(cx))),
        );
        if read.catalog().is_empty() {
            pane = pane.child(notice(
                "service-matching-no-results",
                "Nessuna voce nel repertorio.",
                theme,
                false,
            ));
        }
        for (index, entry) in read.catalog().iter().enumerate() {
            let chosen = self
                .service_matching
                .prepared
                .as_ref()
                .is_some_and(|p| p.entry().id == entry.id);
            pane = pane.child(
                button(
                    SharedString::from(format!("service-matching-catalog-{index}")),
                    format!("{} · {}", entry.service_code, entry.display_name),
                    theme,
                    chosen,
                    self.service_matching.item.is_some(),
                )
                .on_click(
                    cx.listener(move |this, _, _, cx| this.choose_service_catalog(index, cx)),
                ),
            );
        }
        if read.catalog().len() == 100 {
            pane = pane.child(match_text(
                "service-matching-limit",
                "Mostrati 100 risultati. Affina la ricerca.",
                theme,
            ));
        }
        if let Some(prepared) = &self.service_matching.prepared {
            pane = pane
                .child(match_text(
                    "service-matching-preview",
                    format!(
                        "{} → {} · {}",
                        prepared.item().service_name,
                        prepared.entry().service_code,
                        prepared.entry().display_name
                    ),
                    theme,
                ))
                .child(
                    button(
                        "service-matching-confirm",
                        "Conferma abbinamento",
                        theme,
                        true,
                        true,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.confirm_service_matching(cx))),
                );
        }
        pane
    }
}
fn match_text(id: &'static str, value: impl Into<SharedString>, theme: Theme) -> Stateful<Div> {
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

fn match_status_label(status: &str) -> &str {
    match status {
        "prescribed" => "Prescritta",
        "booked" => "Prenotata",
        "performed" => "Eseguita",
        "report_received" => "Referto ricevuto",
        "cancelled" => "Annullata",
        _ => "Stato non riconosciuto",
    }
}
