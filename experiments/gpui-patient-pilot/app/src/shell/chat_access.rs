use super::*;
use crate::chat_access::{
    self,
    owner::{Pending, State},
};
use std::time::Duration;

pub(super) struct ChatAccess {
    listener: Option<chat_access::Listener>,
    pending: Option<Pending>,
    patient: mediflow_patient_client::PersonName,
    archive: String,
    pin: Entity<TextInput>,
    task: Option<gpui::Task<()>>,
    message: Option<String>,
    last_state: Option<(State, bool)>,
}

impl ChatAccess {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        Self {
            listener: chat_access::Listener::configured(),
            pending: None,
            patient: mediflow_patient_client::PersonName::default(),
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
            last_state: None,
        }
    }
    pub(super) fn retire(&mut self, cx: &mut App) {
        if let Some(pending) = self.pending.as_ref()
            && let Ok(mut pending) = pending.lock()
        {
            pending.withdraw();
        }
        if self
            .pending
            .as_ref()
            .is_some_and(|p| p.lock().is_ok_and(|mut p| p.status() == State::Withdrawn))
        {
            self.pending = None;
        }
        self.patient = mediflow_patient_client::PersonName::default();
        self.archive.clear();
        self.last_state = None;
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
        let status = self.chat_access.pending.as_ref().and_then(|p| {
            p.lock().ok().map(|mut p| {
                (
                    p.status(),
                    p.therapy().is_some_and(|t| t.selected.is_some()),
                )
            })
        });
        if status != self.chat_access.last_state {
            self.chat_access.last_state = status;
            cx.notify();
        }
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
            if self
                .chat_access
                .pending
                .as_ref()
                .is_some_and(|p| p.lock().is_ok_and(|mut p| p.status() == State::Uncertain))
            {
                if let Ok(mut p) = pending.lock() {
                    p.withdraw();
                }
                return;
            }
            self.chat_access.pending = None;
            let binding = self.session.as_ref().and_then(|session| {
                let scope = self.scope.as_deref()?;
                let patient = self.patient.detail.ready()?;
                if self.selected_id.as_deref() != Some(&patient.id) {
                    return None;
                }
                Some((
                    session.clone(),
                    session.chat_access_context(scope, &patient.id).ok()?,
                    patient.display_name(),
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
                    let preparing = pending.clone();
                    std::thread::spawn(move || crate::chat_access::owner::prepare_card(&preparing));
                    self.chat_access.patient = patient;
                    self.chat_access.archive = archive;
                    self.chat_access.pending = Some(pending);
                }
            } else if let Ok(mut pending) = pending.lock() {
                pending.withdraw();
            }
            cx.notify();
        }
        if self
            .chat_access
            .pending
            .as_ref()
            .is_some_and(|p| p.lock().is_ok_and(|mut p| p.status() == State::Withdrawn))
        {
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
        let therapy_write = pending.lock().is_ok_and(|p| p.therapy().is_some());
        if therapy_write && !with_pin {
            return;
        }
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
            let result = if therapy_write {
                if crate::chat_access::owner::execute_therapy(&pending, attempt, &pin) { Ok(()) }
                else { Err("Esito non confermato. Rileggi la ricevuta; non ripetere la scrittura.".to_owned()) }
            } else if with_pin {
                session.confirm_chat_access_pin(&context, &pin).map_err(|error| if error.status_code() == Some(423) {
                    "PIN bloccato dopo troppi tentativi. Attendi lo sblocco previsto dall’host.".to_owned()
                } else { "PIN non confermato o sessione non più disponibile.".to_owned() })
            } else {
                attempt.biometric().map_err(str::to_owned).and_then(|()|
                    session.revalidate_chat_access_context(&context).map_err(|error| ui_error(error).to_owned()))
            };
            if !therapy_write && let Ok(mut pending) = pending.lock() { pending.finish(attempt, result.is_ok()); }
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
        if state == State::Withdrawn {
            return None;
        }
        let review = pending.lock().ok().and_then(|p| {
            p.review().map(|(payload, digest, source)| {
                (payload.to_owned(), digest.to_owned(), source.to_owned())
            })
        });
        let therapy = pending.lock().ok().and_then(|p| {
            p.therapy().map(|t| {
                (
                    t.target.clone(),
                    t.rows.clone(),
                    t.selected.clone(),
                    t.result.clone(),
                )
            })
        });
        let enabled = state == State::Challenge
            && (review.is_some() || therapy.as_ref().is_some_and(|t| t.2.is_some()));
        let therapy_mode = therapy.is_some();
        let theme = self.theme;
        Some(div().id("native-chat-access-confirmation").role(Role::Group)
            .aria_label("Conferma accesso della chat").flex_1().min_h_0().overflow_y_scroll()
            .p(px(20.)).border_1().border_color(theme.rule)
            .flex().flex_col().gap(px(12.))
            .child(heading("native-chat-access-title", if therapy_mode { "Conferma il cambio di stato della terapia" } else { "Condividi la scheda di prova nella chat?" }, theme))
            .child(text!(format!("App richiedente: {app}")).with_id("native-chat-access-app"))
            .child(text!(format!("Archivio: {}", self.chat_access.archive)).with_id("native-chat-access-archive"))
            .child(div().id("native-chat-access-patient").child(crate::title::title(crate::title::TitleText::patient_question("Paziente: ", self.chat_access.patient.clone(), ""), theme)))
            .child(notice("native-chat-access-operation", if therapy_mode { "Scegli la terapia della cartella selezionata e controlla il nuovo stato. La scrittura usa il PIN nativo, una sola volta entro 30 secondi. I nomi restano qui. Touch ID per questa scrittura non è ancora abilitato." } else { "Scheda sintetica «basic», indipendente dalla cartella selezionata. Controlla i byte sotto: verranno mostrati soltanto nella vista della chat. Nomi e fonti restano qui. Hai 30 secondi per confermare una sola lettura; nessun rinnovo automatico." }, theme, false))
            .when_some(therapy, |mut el, (target, rows, selected, result)| {
                el = el.child(text!(format!("Nuovo stato: {target}")).with_id("native-chat-therapy-target"));
                for (index, row) in rows.iter().enumerate() {
                    if selected.as_ref().is_none_or(|s| s.0 == index) {
                        let selectable = state == State::Challenge && selected.is_none() && row.status != target;
                        let request = pending.clone();
                        el = el.child(button(format!("native-chat-therapy-{index}"), format!("{} · {} · {} → {} · versione {}", row.drug_name, row.dosage, row.status, target, row.version), theme, false, selectable)
                            .when(selectable, |button| button.on_click(cx.listener(move |_, _, _, cx| {
                                let request = request.clone();
                                std::thread::spawn(move || crate::chat_access::owner::choose_therapy(&request, index));
                                cx.notify();
                            }))));
                    }
                }
                if let Some((_, id)) = selected { el = el.child(notice("native-chat-therapy-command", format!("Comando: {id}. Conserva questo riferimento per rileggere l’esito."), theme, false)); }
                if let Some(result) = result { el = el.child(notice("native-chat-therapy-receipt", format!("Ricevuta e rilettura: {result}"), theme, false)); }
                el
            })
            .when_some(review, |el, (payload, digest, source)| el
                .child(notice("native-chat-card-source", format!("Fonte locale sintetica: {source}"), theme, false))
                .child(notice("native-chat-card-payload", payload, theme, false))
                .child(text!(format!("SHA-256: {digest}")).with_id("native-chat-card-digest")))
            .when_some(self.chat_access.message.clone(), |el, message| el.child(notice("native-chat-access-error", message, theme, true)))
            .child(button("native-chat-access-touch-id", "Conferma con Touch ID", theme, true, enabled && !therapy_mode)
                .when(enabled && !therapy_mode, |el| el.on_click(cx.listener(|this, _, _, cx| this.approve_chat_access(false, cx)))))
            .child(self.chat_access.pin.clone())
            .child(button("native-chat-access-pin-confirm", "Conferma con PIN", theme, false, enabled)
                .when(enabled, |el| el.on_click(cx.listener(|this, _, _, cx| this.approve_chat_access(true, cx)))))
            .when(state == State::Uncertain, |el| el
                .child(notice("native-chat-therapy-uncertain", "Esito da verificare. Il ritiro non è confermato: la scrittura potrebbe essere avvenuta. Rileggi l’esito prima di proseguire.", theme, true))
                .child(button("native-chat-therapy-reread", "Rileggi esito e completa il ritiro", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if let Some(p) = this.chat_access.pending.clone() {
                            std::thread::spawn(move || { if let Ok(mut p) = p.lock() { p.revoke(); } });
                        }
                        cx.notify();
                    }))))
            .when_some(if let State::Resolved(outcome) = state { Some(outcome) } else { None }, |el, outcome| el.child(notice("native-chat-therapy-outcome", match outcome {
                mediflow_runtime_client::ChatTherapyOutcome::Applied => "Modifica registrata. Il comando non può più essere ritirato.",
                mediflow_runtime_client::ChatTherapyOutcome::Retired => "Ritiro confermato. Questo comando non ha modificato la terapia.",
                mediflow_runtime_client::ChatTherapyOutcome::Rejected => "Scrittura respinta. Questo comando non ha modificato la terapia.",
                mediflow_runtime_client::ChatTherapyOutcome::Closed => "Comando chiuso senza modifiche.",
            }, theme, false)))
            .child(button("native-chat-access-deny", "Nega e ritira", theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| { this.chat_access.retire(cx); cx.notify(); })))
            .when(state != State::Challenge, |el| el.child(notice("native-chat-access-state",
                if matches!(state, State::Resolved(_) | State::Uncertain) { "" } else if state == State::Consumed && therapy_mode { "Operazione terminata. Controlla ricevuta e rilettura; nessuna ripetizione automatica." } else if state == State::Consumed { "Scheda consegnata. Puoi revocare la vista; i byte già ricevuti dall’host non vengono cancellati." } else if state == State::Approved { "Scheda autorizzata per una sola lettura nella vista chat." } else { "Conferma in corso…" }, theme, false))))
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
