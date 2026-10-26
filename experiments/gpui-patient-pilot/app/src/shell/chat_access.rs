use super::*;
use crate::chat_access::{
    self,
    owner::{Pending, State},
};
use std::time::Duration;

pub(super) struct ChatAccess {
    listener: Option<chat_access::Listener>,
    pending: Option<Pending>,
    patient: String,
    archive: String,
    pin: Entity<TextInput>,
    task: Option<gpui::Task<()>>,
    message: Option<String>,
}

impl ChatAccess {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        Self {
            listener: chat_access::Listener::configured(),
            pending: None,
            patient: String::new(),
            archive: String::new(),
            pin: cx.new(|cx| {
                TextInput::new(
                    "chat-access-pin",
                    "PIN di conferma",
                    "PIN",
                    false,
                    theme,
                    cx,
                )
                .secret()
            }),
            task: None,
            message: None,
        }
    }
    pub(super) fn retire(&mut self, cx: &mut App) {
        if let Some(pending) = self.pending.take()
            && let Ok(mut pending) = pending.lock()
        {
            pending.withdraw();
        }
        self.patient.clear();
        self.archive.clear();
        self.message = None;
        self.pin.update(cx, |input, cx| input.set_content("", cx));
    }
}

impl ClinicalApp {
    pub(super) fn start_chat_access(&mut self, cx: &mut Context<Self>) {
        if self.chat_access.listener.is_none() {
            return;
        }
        self.chat_access.task = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(250))
                    .await;
                if this
                    .update(cx, |this, cx| this.poll_chat_access(cx))
                    .is_err()
                {
                    break;
                }
            }
        }));
    }

    fn poll_chat_access(&mut self, cx: &mut Context<Self>) {
        let editable = self
            .chat_access
            .pending
            .as_ref()
            .is_some_and(|p| p.lock().is_ok_and(|mut p| p.status() == State::Challenge));
        self.chat_access
            .pin
            .update(cx, |input, cx| input.configure(self.theme, !editable, cx));
        let incoming = self
            .chat_access
            .listener
            .as_ref()
            .and_then(|l| l.incoming.try_recv().ok());
        if let Some(pending) = incoming {
            self.chat_access.retire(cx);
            let binding = self.session.as_ref().and_then(|session| {
                let scope = self.scope.as_deref()?;
                let patient = self.patient.detail.ready()?;
                if self.selected_id.as_deref() != Some(&patient.id) {
                    return None;
                }
                Some((
                    session.clone(),
                    session.chat_access_context(scope, &patient.id).ok()?,
                    format!("{} {}", patient.first_name, patient.last_name),
                    format!(
                        "{} · generazione {}",
                        session.base_url(),
                        session.user().archive_generation
                    ),
                ))
            });
            if let Some((session, context, patient, archive)) = binding {
                if pending
                    .lock()
                    .is_ok_and(|mut pending| pending.bind(session, context))
                {
                    self.chat_access.patient = patient;
                    self.chat_access.archive = archive;
                    self.chat_access.pending = Some(pending);
                }
            } else if let Ok(mut pending) = pending.lock() {
                pending.withdraw();
            }
            cx.notify();
        }
        if self.chat_access.pending.as_ref().is_some_and(|p| {
            p.lock()
                .is_ok_and(|mut p| matches!(p.status(), State::Withdrawn | State::Consumed))
        }) {
            self.chat_access.retire(cx);
            cx.notify();
        }
    }

    fn approve_chat_access(&mut self, with_pin: bool, cx: &mut Context<Self>) {
        let Some(pending) = self.chat_access.pending.clone() else {
            return;
        };
        let Some((session, context, attempt)) = pending.lock().ok().and_then(|mut p| p.begin())
        else {
            return;
        };
        if !with_pin && !pending.lock().is_ok_and(|mut p| p.prepare_biometric()) {
            if let Ok(mut p) = pending.lock() {
                p.withdraw();
            }
            return;
        }
        let pin = Zeroizing::new(self.chat_access.pin.read(cx).value().to_owned());
        self.chat_access
            .pin
            .update(cx, |input, cx| input.set_content("", cx));
        self.chat_access.message = None;
        let target = pending.clone();
        let background = cx.background_executor().spawn(async move {
            let result = if with_pin {
                session.confirm_chat_access_pin(&context, &pin).map_err(|error| if error.status_code() == Some(423) {
                    "PIN bloccato dopo troppi tentativi. Attendi lo sblocco previsto dall’host.".to_owned()
                } else { "PIN non confermato o sessione non più disponibile.".to_owned() })
            } else {
                attempt.biometric().map_err(str::to_owned).and_then(|()|
                    session.revalidate_chat_access_context(&context).map_err(|error| ui_error(error).to_owned()))
            };
            if let Ok(mut pending) = pending.lock() { pending.finish(attempt, result.is_ok()); }
            result.err()
        });
        cx.spawn(async move |this, cx| {
            let message = background.await;
            let _ = this.update(cx, |this, cx| {
                if this
                    .chat_access
                    .pending
                    .as_ref()
                    .is_some_and(|p| std::sync::Arc::ptr_eq(p, &target))
                {
                    this.chat_access.message = message;
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    pub(super) fn chat_access_view(&self, cx: &Context<Self>) -> Option<Stateful<Div>> {
        let pending = self.chat_access.pending.as_ref()?;
        let (state, app) = pending.lock().ok().map(|mut p| (p.status(), p.app()))?;
        if matches!(state, State::Consumed | State::Withdrawn) {
            return None;
        }
        let enabled = state == State::Challenge;
        let theme = self.theme;
        Some(div().id("native-chat-access-confirmation").role(Role::Group)
            .aria_label("Conferma accesso della chat").flex_1().min_h_0().overflow_y_scroll()
            .p(px(20.)).border_1().border_color(theme.rule)
            .flex().flex_col().gap(px(12.))
            .child(heading("native-chat-access-title", "Consenti l’accesso alla chat?", theme))
            .child(text!(format!("App richiedente: {app}")).with_id("native-chat-access-app"))
            .child(text!(format!("Archivio: {}", self.chat_access.archive)).with_id("native-chat-access-archive"))
            .child(text!(format!("Paziente: {}", self.chat_access.patient)).with_id("native-chat-access-patient"))
            .child(notice("native-chat-access-operation", "Una verifica monouso dell’accesso. Nessun contenuto clinico viene restituito. La richiesta scade dopo 30 secondi.", theme, false))
            .when_some(self.chat_access.message.clone(), |el, message| el.child(notice("native-chat-access-error", message, theme, true)))
            .child(button("native-chat-access-touch-id", "Conferma con Touch ID", theme, true, enabled)
                .when(enabled, |el| el.on_click(cx.listener(|this, _, _, cx| this.approve_chat_access(false, cx)))))
            .child(self.chat_access.pin.clone())
            .child(button("native-chat-access-pin-confirm", "Conferma con PIN", theme, false, enabled)
                .when(enabled, |el| el.on_click(cx.listener(|this, _, _, cx| this.approve_chat_access(true, cx)))))
            .child(button("native-chat-access-deny", "Nega e ritira", theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| { this.chat_access.retire(cx); cx.notify(); })))
            .when(state != State::Challenge, |el| el.child(notice("native-chat-access-state",
                if state == State::Approved { "Accesso autorizzato per una sola verifica nella vista chat." } else { "Conferma in corso…" }, theme, false))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::EntityInputHandler;

    #[gpui::test]
    fn confirmation_pin_is_unavailable_to_native_surrounding_text_services(
        cx: &mut gpui::TestAppContext,
    ) {
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let editor = app.read_with(cx, |app, _| app.chat_access.pin.clone());
        cx.update_window_entity(&editor, |input, window, cx| {
            input.set_content("2468", cx);
            let mut actual = Some(0..4);
            assert!(
                input
                    .text_for_range(0..4, &mut actual, window, cx)
                    .is_none()
            );
            assert_eq!(actual, None);
            input.set_content("", cx);
            assert!(input.value().is_empty());
        });
    }
}
