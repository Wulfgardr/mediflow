use super::*;
use crate::chat_access::references::{CommandReferences, ReferenceScan};
use crate::chat_access::{
    self,
    owner::{Pending, State},
};
use mediflow_runtime_client::ChatWriteResolution;
use std::{collections::BTreeMap, time::Duration};

pub(super) struct ChatAccess {
    pub(super) voice: super::local_voice::LocalVoice,
    listener: Option<chat_access::Listener>,
    references: CommandReferences,
    recovery_messages: BTreeMap<String, ChatWriteResolution>,
    recovery_namespace: Option<String>,
    recovery_error: bool,
    recovery_busy: bool,
    owner: Option<(String, RuntimeSession)>,
    recovery_epoch: u64,
    pub(super) pending: Option<Pending>,
    patient: mediflow_patient_client::PersonName,
    archive: String,
    pin: Entity<TextInput>,
    task: Option<gpui::Task<()>>,
    message: Option<String>,
    last_state: Option<(State, bool)>,
}

impl ChatAccess {
    pub(super) fn new(
        theme: Theme,
        directory: Option<std::path::PathBuf>,
        cx: &mut Context<ClinicalApp>,
    ) -> Self {
        Self {
            voice: super::local_voice::LocalVoice::new(theme, cx),
            listener: chat_access::Listener::configured(),
            references: CommandReferences::new(directory),
            recovery_messages: BTreeMap::new(),
            recovery_namespace: None,
            recovery_error: false,
            recovery_busy: false,
            owner: None,
            recovery_epoch: 0,
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
    fn owns_session(&self, session: &RuntimeSession) -> bool {
        self.owner.as_ref().is_some_and(|(namespace, owner)| {
            !owner.is_locked()
                && !session.is_locked()
                && *namespace == session.chat_write_reference_namespace()
        })
    }
    fn unattached_commands(&self, session: &RuntimeSession) -> std::io::Result<ReferenceScan> {
        let active = self
            .pending
            .as_ref()
            .filter(|_| self.owns_session(session))
            .and_then(|p| {
                p.lock().ok().and_then(|p| {
                    p.therapy()
                        .and_then(|t| t.selected.as_ref().map(|s| s.1.clone()))
                })
            });
        let mut scan = self.references.for_session(session).scan()?;
        scan.ids.retain(|id| Some(id) != active.as_ref());
        Ok(scan)
    }
    pub(super) fn detach(&mut self, cx: &mut App) {
        self.retire(cx);
        if let Some(pending) = self.pending.take()
            && let Ok(mut pending) = pending.lock()
        {
            pending.detach();
        }
        self.owner = None;
    }
    pub(super) fn retire(&mut self, cx: &mut App) {
        self.voice.retire(cx);
        if let Some(pending) = self.pending.as_ref()
            && let Ok(mut pending) = pending.lock()
        {
            pending.withdraw();
        }
        if self.pending.as_ref().is_some_and(|p| {
            p.lock().is_ok_and(|mut p| {
                matches!(
                    p.status(),
                    State::Withdrawn | State::Write(ChatWriteResolution::Confirmed(_))
                )
            })
        }) {
            self.pending = None;
        }
        self.patient = mediflow_patient_client::PersonName::default();
        self.archive.clear();
        self.last_state = None;
        self.recovery_messages.clear();
        self.recovery_namespace = None;
        self.recovery_error = false;
        self.recovery_busy = false;
        self.recovery_epoch = self.recovery_epoch.wrapping_add(1);
        self.message = None;
        self.pin.update(cx, |input, cx| input.set_content("", cx));
    }
}

fn catalog_copy(prosthetics: bool) -> (&'static str, &'static str) {
    if prosthetics {
        (
            "Mostra protesica e ausili nella vista della chat?",
            "Ricerca nel repertorio protesico locale, in sola lettura. Controlla query e risultati sotto. La data di aggiornamento non è verificata. Conferma una sola consultazione entro 30 secondi; nessuna prescrizione o invio al modello.",
        )
    } else {
        (
            "Mostra i farmaci nella vista della chat?",
            "Ricerca nel catalogo AIFA locale, in sola lettura. Controlla query e risultati sotto. La data di aggiornamento non è verificata. Conferma una sola consultazione entro 30 secondi; nessuna prescrizione o invio al modello.",
        )
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
        self.poll_chat_voice(cx);
        if self.chat_access.pending.is_some()
            && self
                .session
                .as_ref()
                .is_none_or(|s| !self.chat_access.owns_session(s))
        {
            self.chat_access.detach(cx);
            cx.notify();
        }
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
            if pending.lock().is_ok_and(|mut p| p.voice_requested()) {
                self.open_chat_voice(&pending, cx);
                return;
            }
            if self.chat_access.voice.is_open() {
                if let Ok(mut p) = pending.lock() {
                    p.withdraw();
                }
                return;
            }
            if pending.lock().is_ok_and(|mut p| p.document_requested()) {
                self.open_chat_patient_document(&pending, cx);
                return;
            }
            self.chat_access.retire(cx);
            if self.chat_access.pending.as_ref().is_some_and(|p| {
                p.lock()
                    .is_ok_and(|mut p| p.status() == State::Write(ChatWriteResolution::Uncertain))
            }) {
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
                if let Ok(mut p) = pending.lock() {
                    p.references = self.chat_access.references.clone();
                }
                if pending
                    .lock()
                    .is_ok_and(|mut pending| pending.bind(session.clone(), context))
                {
                    let preparing = pending.clone();
                    std::thread::spawn(move || crate::chat_access::owner::prepare_card(&preparing));
                    self.chat_access.owner =
                        Some((session.chat_write_reference_namespace(), session.clone()));
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

    fn open_chat_patient_document(&mut self, pending: &Pending, cx: &mut Context<Self>) {
        let available = pending.lock().is_ok_and(|mut p| p.document_requested())
            && !self.patient_document.is_open()
            && self.chat_access.pending.is_none()
            && !self.privacy_shield;
        if available {
            self.open_patient_document(cx);
        }
        if let Ok(mut p) = pending.lock() {
            p.finish_document_open(available && self.patient_document.is_open());
        }
        cx.notify();
    }

    fn approve_chat_access(&mut self, with_pin: bool, cx: &mut Context<Self>) {
        let Some(pending) = self.chat_access.pending.clone() else {
            return;
        };
        let Some((session, context, attempt)) = pending
            .lock()
            .ok()
            .and_then(|mut p| p.begin_confirmation(with_pin))
        else {
            return;
        };
        let therapy_write = pending.lock().is_ok_and(|p| p.therapy().is_some());
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

    fn reread_chat_recovery(&mut self, cx: &mut Context<Self>) {
        if self.chat_access.recovery_busy {
            return;
        }
        let Some(session) = self.session.clone().filter(|s| !s.is_locked()) else {
            return;
        };
        let Some(scope) = self.scope.clone() else {
            return;
        };
        let scan = match self.chat_access.unattached_commands(&session) {
            Ok(scan) => scan,
            Err(_) => {
                self.chat_access.recovery_error = true;
                cx.notify();
                return;
            }
        };
        self.chat_access.recovery_error = false;
        if scan.ids.is_empty() {
            cx.notify();
            return;
        }
        self.chat_access.recovery_busy = true;
        let namespace = session.chat_write_reference_namespace();
        if self.chat_access.recovery_namespace.as_ref() != Some(&namespace) {
            self.chat_access.recovery_messages.clear();
        }
        self.chat_access.recovery_namespace = Some(namespace.clone());
        self.chat_access.recovery_error = false;
        let references = self.chat_access.references.for_session(&session);
        let epoch = self.chat_access.recovery_epoch;
        let task = cx.background_executor().spawn(async move {
            let mut resolutions = BTreeMap::new();
            let mut storage_error = false;
            for id in scan.ids {
                let resolution = session
                    .recover_chat_therapy_command(&scope, &id)
                    .map_or(ChatWriteResolution::Uncertain, |r| r.reconcile());
                if let ChatWriteResolution::Confirmed(outcome) = resolution {
                    storage_error |= references.confirm(&id, outcome).is_err();
                }
                resolutions.insert(id, resolution);
            }
            (resolutions, storage_error, session)
        });
        cx.spawn(async move |this, cx| {
            let (resolutions, storage_error, owner) = task.await;
            let _ = this.update(cx, |this, cx| {
                if !owner.is_locked()
                    && this.session.as_ref().is_some_and(|s| {
                        !s.is_locked() && s.chat_write_reference_namespace() == namespace
                    })
                    && this.chat_access.recovery_epoch == epoch
                {
                    this.chat_access.recovery_busy = false;
                    this.chat_access.recovery_messages.extend(resolutions);
                    this.chat_access.recovery_error = storage_error;
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    pub(super) fn chat_recovery_view(&self, cx: &Context<Self>) -> Option<Stateful<Div>> {
        let session = self.session.as_ref().filter(|s| !s.is_locked())?;
        let recovery = self.chat_access.unattached_commands(session);
        let mut messages = if self.chat_access.recovery_namespace.as_ref()
            == Some(&session.chat_write_reference_namespace())
        {
            self.chat_access.recovery_messages.clone()
        } else {
            BTreeMap::new()
        };
        let mut storage_error = self.chat_access.recovery_error || recovery.is_err();
        let mut invalid = false;
        let mut pending = false;
        if let Ok(scan) = recovery {
            pending = !scan.ids.is_empty();
            invalid = !scan.invalid.is_empty();
            for id in scan.ids {
                messages.entry(id).or_insert(ChatWriteResolution::Uncertain);
            }
        }
        storage_error |= invalid;
        if messages.is_empty() && !storage_error {
            return None;
        }
        let confirmed = messages
            .values()
            .any(|r| matches!(r, ChatWriteResolution::Confirmed(_)));
        Some(div().id("native-chat-recovery").flex().flex_col().gap(px(12.)).p(px(20.))
            .children(messages.into_iter().enumerate().map(|(index, (id, resolution))|
                notice(format!("native-chat-recovery-warning-{index}"), format!("Comando {id}: {}", resolution.message()), self.theme, resolution == ChatWriteResolution::Uncertain)))
            .when(storage_error, |el| el.child(notice("native-chat-recovery-storage", "Problema di conservazione locale dei riferimenti. Gli esiti confermati restano confermati. I comandi riconoscibili dal nome possono essere riletti anche se il file è difettoso. Gli altri elementi non sono comandi e vengono ignorati.", self.theme, true)))
            .when(pending, |el| el.child(button("native-chat-recovery-reread", "Rileggi esito e completa il ritiro", self.theme, false, self.scope.is_some() && !self.chat_access.recovery_busy)
                .on_click(cx.listener(|this, _, _, cx| this.reread_chat_recovery(cx)))))
            .when(storage_error && !pending, |el| el.child(button("native-chat-recovery-retry-storage", "Riprova lettura riferimenti locali", self.theme, false, self.scope.is_some())
                .on_click(cx.listener(|this, _, _, cx| this.reread_chat_recovery(cx)))))
            .when(confirmed, |el| el.child(button("native-chat-recovery-dismiss", "Chiudi gli esiti confermati", self.theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| {
                    this.chat_access.recovery_messages.retain(|_, r| !matches!(r, ChatWriteResolution::Confirmed(_)));
                    cx.notify();
                })))))
    }

    pub(super) fn chat_access_view(&self, cx: &Context<Self>) -> Option<Stateful<Div>> {
        let session = self.session.as_ref()?;
        if !self.chat_access.owns_session(session) {
            return None;
        }
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
        let catalog_mode = pending.lock().is_ok_and(|p| p.is_catalog());
        let (catalog_title, catalog_notice) = if pending.lock().is_ok_and(|p| p.is_agenda()) {
            (
                "Mostra l’agenda interna nella vista della chat?",
                "Sola lettura dei primi 20 controlli interni, ordinati per data. Solo date e stato, senza nomi, titoli o note. Non sono candidati da calendario né prenotazioni confermate. Conferma una sola consultazione entro 30 secondi.",
            )
        } else {
            catalog_copy(pending.lock().is_ok_and(|p| p.is_prosthetics_catalog()))
        };
        let theme = self.theme;
        Some(div().id("native-chat-access-confirmation").role(Role::Group)
            .aria_label("Conferma accesso della chat").flex_1().min_h_0().overflow_y_scroll()
            .p(px(20.)).border_1().border_color(theme.rule)
            .flex().flex_col().gap(px(12.))
            .child(heading("native-chat-access-title", if therapy_mode { "Conferma il cambio di stato della terapia" } else if catalog_mode { catalog_title } else { "Condividi la scheda di prova nella chat?" }, theme))
            .child(text!(format!("App richiedente: {app}")).with_id("native-chat-access-app"))
            .child(text!(format!("Archivio: {}", self.chat_access.archive)).with_id("native-chat-access-archive"))
            .child(div().id("native-chat-access-patient").child(crate::title::title(crate::title::TitleText::patient_question("Paziente: ", self.chat_access.patient.clone(), ""), theme)))
            .child(notice("native-chat-access-operation", if therapy_mode { "Scegli la terapia della cartella selezionata e controlla il nuovo stato. La scrittura usa il PIN nativo, una sola volta entro 30 secondi. I nomi restano qui. Touch ID per questa scrittura non è ancora abilitato." } else if catalog_mode { catalog_notice } else { "Scheda sintetica «basic», indipendente dalla cartella selezionata. Controlla i byte sotto: verranno mostrati soltanto nella vista della chat. Nomi e fonti restano qui. Hai 30 secondi per confermare una sola lettura; nessun rinnovo automatico." }, theme, false))
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
            .when(state == State::Write(ChatWriteResolution::Uncertain), |el| el
                .child(notice("native-chat-therapy-uncertain", "Esito da verificare. Il ritiro non è confermato: la scrittura potrebbe essere avvenuta. Rileggi l’esito prima di proseguire.", theme, true))
                .child(button("native-chat-therapy-reread", "Rileggi esito e completa il ritiro", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| {
                        if let Some(p) = this.chat_access.pending.clone() {
                            std::thread::spawn(move || { if let Ok(mut p) = p.lock() { p.revoke(); } });
                        }
                        cx.notify();
                    }))))
            .when_some(if let State::Write(resolution) = state { Some(resolution) } else { None }, |el, resolution| el.child(notice("native-chat-therapy-outcome", resolution.message(), theme, resolution == ChatWriteResolution::Uncertain)))
            .child(button("native-chat-access-deny", "Nega e ritira", theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| { this.chat_access.retire(cx); cx.notify(); })))
            .when(state != State::Challenge, |el| el.child(notice("native-chat-access-state",
                if matches!(state, State::Write(ChatWriteResolution::Confirmed(_)) | State::Write(ChatWriteResolution::Uncertain)) { "" } else if state == State::Consumed && therapy_mode { "Operazione terminata. Controlla ricevuta e rilettura; nessuna ripetizione automatica." } else if state == State::Consumed { "Scheda consegnata. Puoi revocare la vista; i byte già ricevuti dall’host non vengono cancellati." } else if state == State::Approved { "Scheda autorizzata per una sola lettura nella vista chat." } else { "Conferma in corso…" }, theme, false))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::EntityInputHandler;

    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn document_handoff_opens_existing_flow_once_without_staging_or_writing(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = super::super::notes_recovery_tests::Host::new();
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            let before = host.request_count();
            let (pending, _peer) = crate::chat_access::owner::tests::document_request();
            app.open_chat_patient_document(&pending, cx);
            assert_eq!(pending.lock().unwrap().status(), State::DocumentOpened);
            assert!(app.patient_document.is_open());
            assert_eq!(host.request_count(), before);
            let (second, _other) = crate::chat_access::owner::tests::document_request();
            app.open_chat_patient_document(&second, cx);
            assert_eq!(second.lock().unwrap().status(), State::Withdrawn);
            assert!(app.patient_document.is_open());
            assert_eq!(host.request_count(), before);
            app.withdraw_patient_document(cx);
        });
    }

    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn document_handoff_cannot_open_without_native_authority(cx: &mut gpui::TestAppContext) {
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, cx| {
            let (pending, _peer) = crate::chat_access::owner::tests::document_request();
            app.open_chat_patient_document(&pending, cx);
            assert_eq!(pending.lock().unwrap().status(), State::Withdrawn);
            assert!(!app.patient_document.is_open());
            assert!(app.chat_access.pending.is_none());
        });
    }

    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn reopened_authenticated_shell_shows_unresolved_command_without_a_live_request(
        cx: &mut gpui::TestAppContext,
    ) {
        let directory = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("mf-chat-shell-{}", std::process::id()));
        let (session, _host) = crate::chat_access::owner::tests::native_session();
        let references = CommandReferences::new(Some(directory.clone())).for_session(&session);
        references
            .remember("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
            .unwrap();
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            assert!(app.chat_access.pending.is_none());
            assert!(
                app.chat_recovery_view(cx).is_none(),
                "recovery must wait for authentication"
            );
            app.session = Some(session);
            assert!(
                app.chat_recovery_view(cx).is_some(),
                "restart lost the persistent warning"
            );
            assert_eq!(
                app.chat_access
                    .references
                    .for_session(app.session.as_ref().unwrap())
                    .pending()
                    .unwrap()
                    .len(),
                1
            );
            assert!(
                app.chat_access.pending.is_none(),
                "recovery must not recreate execute authority"
            );
        });
        std::fs::remove_dir_all(directory).unwrap();
    }

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

#[cfg(all(test, target_os = "macos"))]
mod recovery_regressions {
    use super::*;
    use mediflow_runtime_client::ChatWriteOutcome;
    const A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    fn directory() -> std::path::PathBuf {
        std::env::temp_dir().canonicalize().unwrap().join(format!(
            "mf729-giro3-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn click(cx: &mut gpui::VisualTestContext, label: &'static str) {
        super::super::notes_recovery_tests::draw(cx);
        let target = cx.debug_bounds(label).expect("control rendered");
        cx.simulate_click(target.center(), gpui::Modifiers::default());
        cx.run_until_parked();
    }
    fn painted(cx: &mut gpui::VisualTestContext) -> Vec<String> {
        let _probe = super::super::rendered_command::begin_inks();
        super::super::notes_recovery_tests::draw(cx);
        super::super::rendered_command::take_inks()
            .into_iter()
            .map(|ink| ink.label)
            .collect()
    }
    #[gpui::test]
    fn logout_detaches_uncertain_request_and_renders_login(cx: &mut gpui::TestAppContext) {
        let directory = directory();
        let (session, _host) = crate::chat_access::owner::tests::native_session();
        let references = CommandReferences::new(Some(directory.clone()));
        let (pending, _remote) = crate::chat_access::owner::tests::unresolved_request(
            session.clone(),
            references.clone(),
        );
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            app.chat_access.owner =
                Some((session.chat_write_reference_namespace(), session.clone()));
            app.chat_access.pending = Some(pending.clone());
            app.session = Some(session.clone());
            assert!(app.chat_access_view(cx).is_some());
            app.disconnect(cx);
            assert!(app.session.is_none());
            assert!(
                app.chat_access.pending.is_none(),
                "logout retained the old Request"
            );
            assert!(app.chat_access_view(cx).is_none());
            assert_eq!(references.for_session(&session).pending().unwrap(), [A]);
            assert!(
                pending.lock().unwrap().begin().is_none(),
                "logout retained execute authority"
            );
            pending.lock().unwrap().revoke();
            assert_eq!(
                pending.lock().unwrap().status(),
                State::Write(ChatWriteResolution::Uncertain),
                "detached Request used a closed session to reconcile"
            );
        });
        let labels = painted(cx);
        assert!(!labels.iter().any(|s| s.contains(A)));
        assert!(
            cx.debug_bounds("control-label:Continua con l'accesso")
                .is_some(),
            "login is hidden"
        );
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            directory
                .join(session.chat_write_reference_namespace())
                .join(A),
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        let reopened = crate::chat_access::owner::tests::relogin(&session);
        app.update(cx, |app, cx| {
            app.session = Some(reopened);
            app.scope = Some("scope-a".into());
            assert!(app.chat_access.pending.is_none());
            assert!(app.chat_recovery_view(cx).is_some());
        });
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains(A) && s.contains("Esito da verificare"))
        );
        assert!(
            labels
                .iter()
                .any(|s| s.contains("Problema di conservazione locale"))
        );
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        assert!(
            references
                .for_session(&session)
                .pending()
                .unwrap()
                .is_empty(),
            "new login did not recover the original partition"
        );
        assert!(
            painted(cx)
                .iter()
                .any(|s| s.contains(A) && s.contains("Modifica registrata"))
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[gpui::test]
    fn owner_change_hides_and_detaches_previous_request(cx: &mut gpui::TestAppContext) {
        let directory = directory();
        let (first, _host1) = crate::chat_access::owner::tests::native_session_as("first-operator");
        let (second, _host2) =
            crate::chat_access::owner::tests::native_session_as("second-operator");
        let references = CommandReferences::new(Some(directory.clone()));
        let (pending, _remote) =
            crate::chat_access::owner::tests::unresolved_request(first.clone(), references.clone());
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            app.chat_access.owner = Some((first.chat_write_reference_namespace(), first.clone()));
            app.chat_access.pending = Some(pending);
            app.session = Some(second.clone());
            assert!(
                app.chat_access_view(cx).is_none(),
                "old reference escaped its owner partition"
            );
            app.poll_chat_access(cx);
            assert!(app.chat_access.pending.is_none());
            assert!(app.chat_recovery_view(cx).is_none());
            assert!(
                references
                    .for_session(&second)
                    .pending()
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(references.for_session(&first).pending().unwrap(), [A]);
            app.session = Some(first);
            assert!(
                app.chat_recovery_view(cx).is_some(),
                "original partition lost durable recovery"
            );
        });
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[gpui::test]
    fn reread_confirmed_command_is_not_uncertain_and_new_command_stays_visible(
        cx: &mut gpui::TestAppContext,
    ) {
        let directory = directory();
        let (session, _host) = crate::chat_access::owner::tests::native_session();
        let references = CommandReferences::new(Some(directory.clone())).for_session(&session);
        references.remember(A).unwrap();
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            app.session = Some(session);
            app.scope = Some("scope-a".into());
        });
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        app.read_with(cx, |app, _| {
            assert!(references.pending().unwrap().is_empty());
            assert_eq!(
                app.chat_access.recovery_messages.get(A),
                Some(&ChatWriteResolution::Confirmed(ChatWriteOutcome::Applied))
            );
        });
        app.update(cx, |app, cx| app.reread_chat_recovery(cx));
        cx.run_until_parked();
        assert!(
            !painted(cx)
                .iter()
                .any(|s| s.contains("Il ritiro non è confermato")),
            "empty reread fabricated an uncertainty"
        );
        assert!(
            cx.debug_bounds("control-label:Rileggi esito e completa il ritiro")
                .is_none()
        );
        references.remember(B).unwrap();
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains(B) && s.contains("Esito da verificare")),
            "new pending command hidden behind old receipt"
        );
        assert!(
            labels
                .iter()
                .any(|s| s.contains(A) && s.contains("Modifica registrata"))
        );
        click(cx, "control-label:Chiudi gli esiti confermati");
        let labels = painted(cx);
        assert!(!labels.iter().any(|s| s.contains(A)));
        assert!(
            labels
                .iter()
                .any(|s| s.contains(B) && s.contains("Esito da verificare"))
        );
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        click(cx, "control-label:Chiudi gli esiti confermati");
        app.update(cx, |app, cx| assert!(app.chat_recovery_view(cx).is_none()));
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[gpui::test]
    fn incomplete_marker_does_not_block_shell_recovery_or_claim_withdrawal(
        cx: &mut gpui::TestAppContext,
    ) {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let directory = directory();
        let (session, _host) = crate::chat_access::owner::tests::native_session();
        let references = CommandReferences::new(Some(directory.clone())).for_session(&session);
        references.remember(A).unwrap();
        let partition = directory.join(session.chat_write_reference_namespace());
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(partition.join(B))
            .unwrap();
        let (app, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1440.), px(1200.)));
        app.update(cx, |app, cx| {
            app.chat_access = ChatAccess::new(app.theme, Some(directory.clone()), cx);
            app.session = Some(session);
            app.scope = Some("scope-a".into());
        });
        assert!(
            painted(cx)
                .iter()
                .any(|s| s.contains("Problema di conservazione locale"))
        );
        let labels = painted(cx);
        for id in [A, B] {
            assert!(
                labels
                    .iter()
                    .any(|s| s.contains(id) && s.contains("Esito da verificare"))
            );
        }
        assert!(
            cx.debug_bounds("control-label:Accantona gli elementi locali non validi")
                .is_none()
        );
        click(cx, "control-label:Rileggi esito e completa il ritiro");
        assert!(
            references.pending().unwrap().is_empty(),
            "damaged marker blocked command recovery"
        );
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains(A) && s.contains("Modifica registrata"))
        );
        assert!(
            labels
                .iter()
                .any(|s| s.contains(B) && s.contains("Modifica registrata"))
        );
        assert!(references.scan().unwrap().invalid.is_empty());
        click(cx, "control-label:Chiudi gli esiti confermati");
        app.update(cx, |app, cx| assert!(app.chat_recovery_view(cx).is_none()));
        std::fs::write(partition.join("not-a-command"), A).unwrap();
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains("Problema di conservazione locale"))
        );
        assert!(!labels.iter().any(|s| s.contains("Esito da verificare")));
        assert!(references.pending().unwrap().is_empty());
        std::fs::remove_file(partition.join("not-a-command")).unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        app.update(cx, |app, cx| app.reread_chat_recovery(cx));
        let labels = painted(cx);
        assert!(
            labels
                .iter()
                .any(|s| s.contains("Problema di conservazione locale"))
        );
        assert!(
            !labels
                .iter()
                .any(|s| s.contains("Il ritiro non è confermato"))
        );
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }
}
