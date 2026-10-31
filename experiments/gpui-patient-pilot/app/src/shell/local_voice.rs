use super::*;
use crate::chat_access::owner::{Pending, State as RequestState};
use crate::local_voice::{Session, State, reviewed_text};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Binding {
    namespace: String,
    scope: String,
    patient: String,
    revision: u64,
    epoch: u64,
}
struct Work {
    binding: Binding,
    pending: Pending,
    session: Session,
    state: State,
}
pub(super) struct LocalVoice {
    work: Option<Work>,
    editor: Entity<TextInput>,
}
impl LocalVoice {
    pub(super) fn is_open(&self) -> bool {
        self.work.is_some()
    }
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        Self {
            work: None,
            editor: cx.new(|cx| {
                TextInput::new(
                    "chat-voice-review",
                    "Trascrizione da rivedere",
                    "",
                    true,
                    theme,
                    cx,
                )
            }),
        }
    }
    pub(super) fn retire(&mut self, cx: &mut App) {
        if let Some(work) = self.work.take()
            && let Ok(mut pending) = work.pending.lock()
        {
            pending.withdraw();
        }
        self.editor.update(cx, |input, cx| input.retire(cx));
    }
}
impl ClinicalApp {
    fn voice_binding(&self) -> Option<Binding> {
        let session = self.session.as_ref().filter(|s| !s.is_locked())?;
        let patient = self.patient.detail.ready()?;
        if self.privacy_shield
            || self.selected_id.as_ref() != Some(&patient.id)
            || patient.is_archived
            || patient.deleted_at.is_some()
        {
            return None;
        }
        Some(Binding {
            namespace: session.chat_write_reference_namespace(),
            scope: self.scope.clone()?,
            patient: patient.id.clone(),
            revision: patient.version,
            epoch: self.epoch,
        })
    }
    pub(super) fn open_chat_voice(&mut self, pending: &Pending, cx: &mut Context<Self>) {
        let binding = self.voice_binding().filter(|_| {
            self.form.is_none()
                && self.chat_access.voice.work.is_none()
                && self.chat_access.pending.is_none()
                && !self.patient_document.is_open()
                && !self.local_host.has_work()
                && self.can_write(FormKind::Entry)
        });
        let opened = binding.is_some();
        if let Some(binding) = binding {
            self.chat_access
                .voice
                .editor
                .update(cx, |input, cx| input.set_content("", cx));
            let session = Session::new();
            let state = session.state();
            self.chat_access.voice.work = Some(Work {
                binding,
                pending: pending.clone(),
                session,
                state,
            });
        }
        if let Ok(mut p) = pending.lock() {
            p.finish_voice_open(opened);
        }
        cx.notify();
    }
    pub(super) fn poll_chat_voice(&mut self, cx: &mut Context<Self>) {
        let current = self.voice_binding();
        let Some(work) = self.chat_access.voice.work.as_mut() else {
            return;
        };
        if current.as_ref() != Some(&work.binding)
            || !work
                .pending
                .lock()
                .is_ok_and(|mut p| p.status() == RequestState::VoiceOpened)
        {
            self.chat_access.voice.retire(cx);
            cx.notify();
            return;
        }
        let state = work.session.state();
        if state != work.state {
            work.state = state;
            if state == State::Review {
                if let Some(text) = work.session.transcript() {
                    self.chat_access
                        .voice
                        .editor
                        .update(cx, |input, cx| input.set_content(text.as_str(), cx));
                } else {
                    work.state = State::Unavailable;
                }
            }
            cx.notify();
        }
        self.chat_access.voice.editor.update(cx, |input, cx| {
            input.configure(self.theme, work.state != State::Review, cx)
        });
    }
    fn transfer_chat_voice(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(work) = &self.chat_access.voice.work else {
            return;
        };
        if self.voice_binding().as_ref() != Some(&work.binding)
            || !work
                .pending
                .lock()
                .is_ok_and(|mut p| p.status() == RequestState::VoiceOpened)
            || self.form.is_some()
        {
            self.chat_access.voice.retire(cx);
            return;
        }
        let Some(text) = reviewed_text(work.state, self.chat_access.voice.editor.read(cx).value())
        else {
            return;
        };
        if self.local_host.has_work()
            || self.edit_pending
            || self.document_operation != DocumentOperation::Idle
            || self.patient_document.is_open()
            || !self.can_write(FormKind::Entry)
        {
            return;
        }
        self.chat_access.voice.retire(cx);
        self.open_form(FormKind::Entry, window, cx);
        if let Some(form) = &self.form
            && form.kind == FormKind::Entry
            && form.state == FormState::Draft
        {
            form.fields[2]
                .editor
                .update(cx, |input, cx| input.set_content(text.as_str(), cx));
            self.chat_access.voice.retire(cx);
        }
        cx.notify();
    }
    pub(super) fn chat_voice_view(&self, cx: &Context<Self>) -> Option<Stateful<Div>> {
        let work = self.chat_access.voice.work.as_ref()?;
        let patient = self.patient.detail.ready()?;
        Some(
            div()
                .id("chat-local-voice")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p(px(20.))
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(heading(
                    "chat-local-voice-title",
                    "Dettatura locale",
                    self.theme,
                ))
                .child(crate::title::title(
                    crate::title::TitleText::patient_question(
                        "Paziente: ",
                        patient.display_name(),
                        "",
                    ),
                    self.theme,
                ))
                .child(notice(
                    "chat-local-voice-state",
                    work.state.message(),
                    self.theme,
                    matches!(work.state, State::PermissionDenied | State::Unavailable),
                ))
                .when(work.state == State::Disclosure, |el| {
                    el.child(
                        button(
                            "chat-voice-start",
                            "Consenti e avvia",
                            self.theme,
                            true,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.poll_chat_voice(cx);
                            if let Some(work) = &this.chat_access.voice.work {
                                work.session.start();
                            }
                            cx.notify();
                        })),
                    )
                })
                .when(work.state == State::Recording, |el| {
                    el.child(
                        button(
                            "chat-voice-stop",
                            "Termina e trascrivi",
                            self.theme,
                            true,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(work) = &this.chat_access.voice.work {
                                work.session.stop();
                            }
                            cx.notify();
                        })),
                    )
                })
                .when(work.state == State::Review, |el| {
                    el.child(self.chat_access.voice.editor.clone()).child(
                        button(
                            "chat-voice-transfer",
                            "Ho rivisto il testo: prepara la bozza",
                            self.theme,
                            true,
                            true,
                        )
                        .on_click(
                            cx.listener(|this, _, window, cx| this.transfer_chat_voice(window, cx)),
                        ),
                    )
                })
                .child(
                    button("chat-voice-discard", "Scarta", self.theme, false, true).on_click(
                        cx.listener(|this, _, _, cx| {
                            this.chat_access.voice.retire(cx);
                            cx.notify();
                        }),
                    ),
                ),
        )
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::super::notes_recovery_tests::Host;
    use super::*;
    const TEXT: &str = "Nome inventato Ada Esempio. Testo clinico sintetico da correggere.";

    #[gpui::test]
    fn local_voice_requires_review_and_current_patient_before_preparing_common_writer(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        for scenario in 0..8 {
            let (pending, _remote) = crate::chat_access::owner::tests::voice_request();
            pending.lock().unwrap().finish_voice_open(true);
            cx.update_window_entity(&view, |app, window, cx| {
                app.chat_access.voice.retire(cx);
                app.form = None;
                app.session = Some(host.session.clone());
                app.scope = Some("scope-a".into());
                app.selected_id = Some("patient-a".into());
                app.patient.detail = ReadLoad::Ready(serde_json::from_value(serde_json::json!({
                    "id":"patient-a","firstName":"Ada","lastName":"Esempio","taxCode":"SYNTHETIC","version":1
                })).unwrap());
                app.privacy_shield = false;
                let binding = app.voice_binding().unwrap();
                let state = if scenario == 1 { State::Recording } else { State::Review };
                app.chat_access.voice.work = Some(Work { binding, pending: pending.clone(), session: Session::synthetic(state, TEXT), state });
                app.chat_access.voice.editor.update(cx, |input, cx| input.set_content(TEXT, cx));
                assert!(app.form.is_none(), "transcription completion must not open a writer");
                app.open_form(FormKind::Entry, window, cx);
                app.open_patient_document(cx);
                assert!(app.form.is_none() && !app.patient_document.is_open(), "another composer replaced the voice review");
                match scenario {
                    2 => app.selected_id = Some("patient-b".into()),
                    3 => app.scope = Some("scope-b".into()),
                    4 => app.epoch += 1,
                    5 => if let ReadLoad::Ready(patient) = &mut app.patient.detail { patient.version += 1; },
                    6 => app.privacy_shield = true,
                    7 => pending.lock().unwrap().withdraw(),
                    _ => {}
                }
                let requests = host.request_count();
                app.transfer_chat_voice(window, cx);
                assert_eq!(host.request_count(), requests, "voice must never write or call a model");
                if scenario == 0 {
                    let form = app.form.as_ref().unwrap();
                    assert!(form.kind == FormKind::Entry && form.state == FormState::Draft);
                    assert_eq!(form.fields[2].editor.read(cx).value(), TEXT);
                    assert!(app.chat_access.voice.work.is_none());
                    assert_eq!(app.chat_access.voice.editor.read(cx).value(), "");
                } else {
                    assert!(app.form.is_none(), "stale or unreviewed text reached the writer");
                }
                app.chat_access.voice.retire(cx);
            });
        }
    }
}
