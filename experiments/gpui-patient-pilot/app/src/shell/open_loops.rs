#[cfg(unix)]
use super::generation::{ChatArea, ChatHold};
use super::*;
use crate::theme::TypeStyle;
use mediflow_runtime_client::{OpenLoopRow, OpenLoopSource, OpenLoopsRead, ProfileQueryIntent};
use std::sync::Arc;

pub(super) struct OpenLoops {
    patient: Option<String>,
    rows: Load<OpenLoopsRead>,
    ticket: Arc<()>,
    intent: Option<ProfileQueryIntent>,
    #[cfg(unix)]
    chat: ChatHold,
}
impl Default for OpenLoops {
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
impl OpenLoops {
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
impl ChatArea for OpenLoops {
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
    pub(super) fn open_patient_loops(&mut self, cx: &mut Context<Self>) {
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
        self.open_loops.patient = Some(patient);
        self.request_open_loops(cx);
    }
    fn loops_location(&self) -> bool {
        self.area == Area::Patients
            && !self.directory
            && self.patient_section == PatientSection::Overview
            && self.selected_id.as_deref().is_some_and(|id| {
                self.open_loops.patient_is(id)
                    && self
                        .patient
                        .detail
                        .ready()
                        .is_some_and(|patient| patient.id == id)
            })
    }
    pub(super) fn request_open_loops(&mut self, cx: &mut Context<Self>) {
        if !self.loops_location()
            || !self.open_loops.chat_ready()
            || matches!(self.open_loops.rows, Load::Loading)
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
        if let Some(previous) = self.open_loops.intent.take() {
            previous.cancel();
        }
        let intent = session.profile_query_intent();
        self.open_loops.intent = Some(intent.clone());
        self.open_loops.ticket = Arc::new(());
        let ticket = self.open_loops.ticket.clone();
        let authority = self.account_profile.generation;
        let epoch = self.epoch;
        self.open_loops.rows = Load::Loading;
        let task = cx
            .background_executor()
            .spawn(async move { session.read_open_loops(&scope, &patient, &intent) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                let error = result.as_ref().err().copied();
                if !matches!(
                    this.check_callback(authority, error, cx),
                    CallbackState::Current
                ) || this.epoch != epoch
                    || !Arc::ptr_eq(&ticket, &this.open_loops.ticket)
                    || !this.loops_location()
                    || !this.open_loops.chat_ready()
                {
                    return;
                }
                #[cfg(unix)]
                if let Some(chat) = this.open_loops.chat.0.take() {
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
                this.open_loops.rows = match result {
                    Ok(rows) => Load::Ready(rows),
                    Err(_) => {
                        Load::Failed("Follow-up non disponibili. Riprova dalla scheda.".into())
                    }
                };
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub(super) fn open_loops_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(heading(
                "clinical-open-loops-heading",
                "Follow-up aperti",
                theme,
            ))
            .child(
                button(
                    "clinical-open-loops-close",
                    "Chiudi follow-up",
                    theme,
                    false,
                    true,
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.open_loops.reset();
                    cx.notify();
                })),
            );
        pane = match &self.open_loops.rows {
            Load::Idle => pane,
            Load::Loading => pane.child(notice(
                "clinical-open-loops-state",
                "Lettura in corso…",
                theme,
                false,
            )),
            Load::Failed(message) => pane
                .child(notice(
                    "clinical-open-loops-state",
                    message.clone(),
                    theme,
                    true,
                ))
                .child(
                    button("clinical-open-loops-retry", "Riprova", theme, false, true)
                        .on_click(cx.listener(|this, _, _, cx| this.request_open_loops(cx))),
                ),
            Load::Ready(read) => {
                pane = pane
                    .child(loop_text(
                        "clinical-open-loops-receipt",
                        format!(
                            "Letto il {} · {} attese",
                            display_appointment(&read.receipt.read_at),
                            read.receipt.item_count
                        ),
                        false,
                        theme,
                    ))
                    .when(read.receipt.item_count == 0, |pane| {
                        pane.child(notice(
                            "clinical-open-loops-empty",
                            "Nessun follow-up aperto.",
                            theme,
                            false,
                        ))
                    });
                for group in &read.groups {
                    pane = pane.child(
                        div()
                            .id(SharedString::from(format!(
                                "clinical-open-loops-group-{}",
                                group.prescription_id
                            )))
                            .border_b_1()
                            .border_color(theme.rule)
                            .py(px(12.))
                            .child(loop_text(
                                "prescription-date",
                                format!(
                                    "Prescrizione del {}",
                                    display_date(Some(&group.prescribed_at))
                                ),
                                true,
                                theme,
                            ))
                            .children(group.loops.iter().map(|row| loop_row(row, theme))),
                    );
                }
                pane.children(read.standalone_loops.iter().map(|row| loop_row(row, theme)))
            }
        };
        pane
    }
}
fn loop_text(
    id: &'static str,
    label: impl Into<SharedString>,
    strong: bool,
    theme: Theme,
) -> Stateful<Div> {
    let label: SharedString = label.into();
    div()
        .id(id)
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .type_role(
            theme,
            if strong {
                crate::theme::TextRole::Strong
            } else {
                crate::theme::TextRole::Meta
            },
        )
        .when(!strong, |el| el.text_color(theme.secondary))
        .child({
            let text = text!(label);
            #[cfg(test)]
            let text = rendered_command::observe_text(text);
            text
        })
}
fn loop_row(row: &OpenLoopRow, theme: Theme) -> Stateful<Div> {
    let (source, id) = match &row.source {
        OpenLoopSource::ServiceItem { id, .. } => {
            ("Referto atteso".to_owned(), format!("service-{id}"))
        }
        OpenLoopSource::ObservationSeries { code_system, code } => (
            format!("Serie interrotta · {code_system} {code}"),
            format!("series-{code_system}-{code}"),
        ),
    };
    div()
        .id(SharedString::from(format!("clinical-open-loop-{id}")))
        .min_w_0()
        .max_w_full()
        .flex()
        .flex_col()
        .gap(px(4.))
        .py(px(8.))
        .child(loop_text("label", row.label.clone(), true, theme))
        .child(loop_text(
            "source",
            format!(
                "{source} · {} giorni · dal {}",
                row.elapsed_days,
                display_date(Some(&row.since_date))
            ),
            false,
            theme,
        ))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use serde_json::json;

    #[gpui::test]
    fn followups_view_renders_sources_and_receipt_with_existing_theme(
        cx: &mut gpui::TestAppContext,
    ) {
        let mut app: Option<Entity<ClinicalApp>> = None;
        rendered_command::assert_unique_texts(
            cx,
            move |window, cx| {
                let app = app.get_or_insert_with(|| cx.new(|cx| {
                let mut app = ClinicalApp::new(String::new(), window, cx);
                app.open_loops.rows = Load::Ready(serde_json::from_value(json!({
                    "contractVersion":1,"patientId":"patient-a","ambulatoryId":"scope-a","groups":[],
                    "standaloneLoops":[{"kind":"series_stalled","label":"Serie sintetica",
                        "sinceDate":"2026-10-01T00:00:00Z","elapsedDays":42,"typicalIntervalDays":10,
                        "source":{"type":"observation_series","codeSystem":"LOINC","code":"SYNTHETIC"}},
                        {"kind":"series_stalled","label":"Serie sintetica",
                        "sinceDate":"2026-10-01T00:00:00Z","elapsedDays":42,"typicalIntervalDays":10,
                        "source":{"type":"observation_series","codeSystem":"LOINC","code":"OTHER"}}],
                    "receipt":{"operation":"patient-open-loops.read.v1","outcome":"read",
                        "readAt":"2026-11-12T01:00:00Z","itemCount":2,"snapshotHash":"a".repeat(64)}
                })).unwrap());
                app
            }));
                app.update(cx, |app, cx| app.open_loops_view(cx).into_any_element())
            },
            5,
        );
    }
}
