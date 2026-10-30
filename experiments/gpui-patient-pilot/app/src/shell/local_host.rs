use super::*;
use mediflow_runtime_client::{
    HostSettingKey, LocalHostAccess, PreparedDocumentDeletion, PreparedHostSetting,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub(super) const RETIREMENT_WARNING: &str = "Ritiro di una sessione locale non confermato. Verifica le sessioni dell’host prima di lasciare la postazione.";

#[derive(Clone)]
pub(super) struct RetirementNotice(Arc<Mutex<(usize, Option<PathBuf>)>>);
impl RetirementNotice {
    fn new(path: Option<PathBuf>) -> Self {
        let pending = path
            .as_ref()
            .map(|path| match std::fs::read(path) {
                Ok(bytes) => serde_json::from_slice::<usize>(&bytes).unwrap_or(1),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
                Err(_) => 1,
            })
            .unwrap_or(0);
        Self(Arc::new(Mutex::new((pending, path))))
    }
    pub(super) fn pending(&self) -> bool {
        self.0.lock().map(|state| state.0 > 0).unwrap_or(true)
    }
    fn change(&self, begin: bool) {
        if let Ok(mut state) = self.0.lock() {
            state.0 = if begin {
                state.0.saturating_add(1)
            } else {
                state.0.saturating_sub(1)
            };
            if let Some(path) = &state.1 {
                let saved = (|| -> std::io::Result<()> {
                    let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
                    #[cfg(windows)]
                    mediflow_local_state::create_directory(parent)?;
                    #[cfg(not(windows))]
                    std::fs::create_dir_all(parent)?;
                    std::fs::write(path, serde_json::to_vec(&state.0)?)
                })();
                if saved.is_err() {
                    eprintln!("{RETIREMENT_WARNING}");
                }
            }
        }
    }
    fn begin(&self, access: Arc<LocalHostAccess>) -> RetiringAccess {
        self.change(true);
        RetiringAccess {
            access,
            notice: self.clone(),
        }
    }
}
pub(super) struct RetiringAccess {
    access: Arc<LocalHostAccess>,
    notice: RetirementNotice,
}
impl RetiringAccess {
    pub(super) fn retire(self) -> Result<(), RuntimeError> {
        let result = self.access.retire();
        if result.is_ok() {
            self.notice.change(false);
        } else {
            eprintln!("{RETIREMENT_WARNING}");
        }
        result
    }
}

enum Authority {
    Closed,
    Authenticating,
    Open(Arc<LocalHostAccess>),
    Failed(String),
}
#[derive(Clone)]
enum Command {
    Delete(Arc<PreparedDocumentDeletion>),
    Switch(Arc<PreparedHostSetting>),
}
enum Operation {
    Idle,
    Reading,
    Review(Command),
    Applying(Command),
    Failed(String),
    Unconfirmed { command: Command, message: String },
}
pub(super) struct LocalAdministration {
    pub(super) retirement: RetirementNotice,
    authority: Authority,
    operation: Operation,
    secret: Entity<TextInput>,
    switches: ReadLoad<Vec<(HostSettingKey, bool)>>,
    generation: u64,
    targets: [ScrollTarget; 3],
    focus_confirmation: bool,
    return_focus: Option<FocusHandle>,
    _subscription: Subscription,
}
impl LocalAdministration {
    pub(super) fn new(
        theme: Theme,
        scroll: &ScrollHandle,
        retirement_path: Option<PathBuf>,
        cx: &mut Context<ClinicalApp>,
    ) -> Self {
        let secret = cx.new(|cx| {
            TextInput::new(
                "local-host-passphrase",
                "Passphrase dell’account",
                "Passphrase",
                false,
                theme,
                cx,
            )
            .secret()
        });
        let subscription = cx.subscribe(&secret, |_, _, _: &InputChanged, cx| cx.notify());
        Self {
            retirement: RetirementNotice::new(retirement_path),
            authority: Authority::Closed,
            operation: Operation::Idle,
            secret,
            switches: ReadLoad::Idle,
            generation: 0,
            targets: ScrollTarget::group(scroll, cx),
            focus_confirmation: false,
            return_focus: None,
            _subscription: subscription,
        }
    }
    pub(super) fn command_visible(&self) -> bool {
        !matches!(self.operation, Operation::Idle)
    }
    pub(super) fn has_work(&self) -> bool {
        matches!(self.authority, Authority::Authenticating)
            || matches!(
                self.operation,
                Operation::Reading
                    | Operation::Review(_)
                    | Operation::Applying(_)
                    | Operation::Unconfirmed { .. }
            )
    }
    pub(super) fn access(&self) -> Option<Arc<LocalHostAccess>> {
        match &self.authority {
            Authority::Open(access) => Some(access.clone()),
            _ => None,
        }
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) -> Option<RetiringAccess> {
        self.generation = self
            .generation
            .checked_add(1)
            .expect("local authority generation exhausted");
        self.secret.update(cx, |input, cx| input.retire(cx));
        let access = match std::mem::replace(&mut self.authority, Authority::Closed) {
            Authority::Open(access) => Some(self.retirement.begin(access)),
            _ => None,
        };
        self.operation = Operation::Idle;
        self.return_focus = None;
        self.switches = ReadLoad::Idle;
        access
    }
    pub(super) fn clear_view(&mut self) {
        self.switches.interrupt();
        if !matches!(self.operation, Operation::Applying(_)) {
            self.operation = Operation::Idle;
        }
    }
    pub(super) fn prepare_render(
        &mut self,
        theme: Theme,
        window: &mut Window,
        cx: &mut Context<ClinicalApp>,
    ) {
        self.secret.update(cx, |input, cx| {
            input.configure(
                theme,
                matches!(self.authority, Authority::Authenticating),
                cx,
            )
        });
        if std::mem::take(&mut self.focus_confirmation) {
            window.focus(&self.targets[0].focus, cx);
            self.targets[0].scroll_to(window, cx);
        }
    }
}
impl ClinicalApp {
    fn run_local_host<T: Send + 'static>(
        &mut self,
        operation: impl FnOnce() -> Result<T, RuntimeError> + Send + 'static,
        apply: impl FnOnce(&mut Self, Result<T, RuntimeError>, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let generation = self.local_host.generation;
        self.run(
            operation,
            move |this, result, cx| {
                if this.local_host.generation == generation {
                    apply(this, result, cx);
                }
            },
            cx,
        );
    }

    fn authenticate_local_host(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() || self.local_host.access().is_some() {
            return;
        }
        let Some(session) = self
            .session
            .clone()
            .filter(RuntimeSession::can_access_local_host)
        else {
            return;
        };
        let passphrase = Zeroizing::new(self.local_host.secret.read(cx).value().to_owned());
        if passphrase.is_empty() {
            return;
        }
        self.local_host
            .secret
            .update(cx, |input, cx| input.set_content("", cx));
        self.local_host.authority = Authority::Authenticating;
        let generation = self.local_host.generation;
        let authority = self.account_profile.generation;
        let task = cx
            .background_executor()
            .spawn(async move { session.authenticate_local_host(&passphrase).map(Arc::new) });
        let retirement = self.local_host.retirement.clone();
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let cleanup = result.as_ref().ok().cloned();
            let accepted = this
                .update(cx, |this, cx| {
                    if this.account_profile.generation != authority
                        || this.local_host.generation != generation
                    {
                        return false;
                    }
                    if let Err(error) = &result
                        && error.retires_session()
                    {
                        let message = ui_error(*error);
                        this.disconnect(cx);
                        this.message = Some((message, true));
                        return true;
                    }
                    this.local_host.authority = match result {
                        Ok(access) => Authority::Open(access),
                        Err(error) => Authority::Failed(ui_error(error)),
                    };
                    this.read_local_switches(cx);
                    cx.notify();
                    true
                })
                .unwrap_or(false);
            if !accepted && let Some(access) = cleanup {
                let access = retirement.begin(access);
                cx.background_executor()
                    .spawn(async move {
                        let _ = access.retire();
                    })
                    .detach();
            }
        })
        .detach();
        cx.notify();
    }
    fn close_local_host(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.withdraw(cx) else {
            return;
        };
        self.run(move ||access.retire(),|this,result,cx|{
            this.message=Some(match result {Ok(())=>("Accesso locale chiuso e ritiro confermato.".into(),false),Err(_)=>("Accesso locale chiuso in questa finestra. Ritiro remoto non confermato: verifica le sessioni dell’host.".into(),true)});
            cx.notify();
        },cx);
    }
    pub(super) fn read_local_switches(&mut self, cx: &mut Context<Self>) {
        let Some(access) = self.local_host.access() else {
            return;
        };
        if self.local_host.has_work()
            || matches!(self.local_host.switches, ReadLoad::Loading { .. })
        {
            return;
        }
        self.local_host.switches = ReadLoad::loading();
        self.run_local_host(
            move || access.read_switches(),
            |this, result, cx| {
                this.local_host.switches = ReadLoad::from_result(result);
                cx.notify();
            },
            cx,
        );
    }
    fn prepare_local_switch(
        &mut self,
        key: HostSettingKey,
        enabled: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.return_focus = window.focused(cx);
        self.local_host.operation = Operation::Reading;
        self.run_local_host(
            move || access.prepare_switch(key, enabled),
            |this, result, cx| {
                this.local_host.operation = match result {
                    Ok(command) => Operation::Review(Command::Switch(Arc::new(command))),
                    Err(error) => Operation::Failed(ui_error(error)),
                };
                this.local_host.focus_confirmation = true;
                cx.notify();
            },
            cx,
        );
    }
    pub(super) fn prepare_document_deletion(
        &mut self,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.local_host.has_work()
            || self.form.is_some()
            || self.document_operation != DocumentOperation::Idle
        {
            return;
        }
        let (Some(access), Some(patient)) = (self.local_host.access(), self.selected_id.clone())
        else {
            return;
        };
        let id = id.to_owned();
        self.local_host.return_focus = window.focused(cx);
        self.local_host.operation = Operation::Reading;
        self.verified = None;
        self.run_local_host(
            move || access.prepare_document_deletion(&patient, &id),
            |this, result, cx| {
                this.local_host.operation = match result {
                    Ok(command) => Operation::Review(Command::Delete(Arc::new(command))),
                    Err(error) => Operation::Failed(ui_error(error)),
                };
                this.local_host.focus_confirmation = true;
                cx.notify();
            },
            cx,
        );
    }
    pub(super) fn cancel_local_command(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if matches!(
            self.local_host.operation,
            Operation::Review(_) | Operation::Failed(_) | Operation::Unconfirmed { .. }
        ) {
            self.local_host.operation = Operation::Idle;
            if let Some(focus) = self.local_host.return_focus.take() {
                window.focus(&focus, cx);
            }
            cx.notify();
        }
    }
    fn confirm_local_command(&mut self, cx: &mut Context<Self>) {
        let Operation::Review(command) = &self.local_host.operation else {
            return;
        };
        let command = command.clone();
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.operation = Operation::Applying(command.clone());
        let deleting = matches!(command, Command::Delete(_));
        let retained = command.clone();
        self.run_local_host(move ||match command {Command::Delete(command)=>access.delete_document(&command),Command::Switch(command)=>access.apply_switch(&command)},move |this,result,cx| {
            match result {
                Ok(true)=>{
                    this.local_host.operation=Operation::Idle;
                    this.verified=Some(if deleting {"Documento eliminato e assenza riletta dall’archivio."}else{"Funzione aggiornata e riletta dall’host."}.into());
                    if deleting {this.patient.document_details_id=None;this.load_sections(cx);}else{this.load_ai_status(cx);this.read_local_switches(cx);}
                }
                Ok(false)=>this.local_host.operation=Operation::Unconfirmed{command:retained,message:"L’esito non è confermato dalla rilettura. Verifica lo stato corrente prima di preparare una nuova operazione.".into()},
                Err(error)=>this.local_host.operation=Operation::Unconfirmed{command:retained,message:format!("{} Nessun reinvio automatico. Rileggi prima di preparare una nuova operazione.",ui_error(error))},
            }
            this.local_host.focus_confirmation=true;cx.notify();
        },cx);
    }
    pub(super) fn local_host_panel(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(section("local-host-heading", "Gestione locale", theme));
        if !self
            .session
            .as_ref()
            .is_some_and(RuntimeSession::can_access_local_host)
        {
            return pane.child(notice("local-host-unavailable","La gestione dell’host è disponibile solo collegandosi al suo indirizzo loopback su questo computer.",theme,false));
        }
        match &self.local_host.authority {
            Authority::Open(_) => {
                pane=pane.child(notice("local-host-authority","Accesso locale confermato per questo account. Abilitare una funzione non avvia un’analisi.",theme,false))
                    .child(button("local-host-read","Rileggi funzioni",theme,false,!self.local_host.has_work()).on_click(cx.listener(|this,_,_,cx|this.read_local_switches(cx))));
                pane = pane.child(
                    button(
                        "local-host-close",
                        "Chiudi gestione locale",
                        theme,
                        false,
                        !self.local_host.has_work(),
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.close_local_host(cx))),
                );
                if let Some(rows) = self.local_host.switches.ready() {
                    pane = pane.children(rows.iter().map(|&(key, enabled)| {
                        div()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .child(text!(format!(
                                "{} · {}",
                                key.title(),
                                if enabled { "Attiva" } else { "Spenta" }
                            )))
                            .child(
                                button(
                                    format!("local-host-{}", key.wire()),
                                    if enabled {
                                        "Rivedi disattivazione"
                                    } else {
                                        "Rivedi abilitazione"
                                    },
                                    theme,
                                    false,
                                    !self.local_host.has_work(),
                                )
                                .on_click(cx.listener(
                                    move |this, _, window, cx| {
                                        this.prepare_local_switch(key, !enabled, window, cx)
                                    },
                                )),
                            )
                    }));
                }
                if let Some(state) = self.local_host.switches.state(ReadObject::Profilo) {
                    pane = pane.child(state.render(
                        "local-host-state",
                        theme,
                        &self.local_host.targets[2].focus,
                        cx.listener(|this, _, _, cx| this.read_local_switches(cx)),
                    ));
                }
            }
            state => {
                pane=pane.child(text!("Conferma la passphrase per gestire le funzioni e i documenti su questo computer. La passphrase non viene salvata."))
                    .child(crate::text_input::themed(self.local_host.secret.clone(),theme))
                    .child(button("local-host-authenticate","Apri gestione locale",theme,true,!matches!(state,Authority::Authenticating))
                        .on_click(cx.listener(|this,_,_,cx|this.authenticate_local_host(cx))));
                if matches!(state, Authority::Authenticating) {
                    pane = pane.child(notice(
                        "local-host-auth-pending",
                        "Verifica dell’accesso locale…",
                        theme,
                        false,
                    ));
                }
                if let Authority::Failed(message) = state {
                    pane = pane.child(notice(
                        "local-host-auth-error",
                        message.clone(),
                        theme,
                        true,
                    ));
                }
            }
        }
        if !matches!(self.local_host.operation, Operation::Idle) {
            pane = pane.child(self.threshold(
                Layout::for_window(760., self.text_scale),
                ThresholdMode::Complete,
                cx,
            ));
        }
        pane
    }
    pub(super) fn local_command_threshold(
        &self,
        threshold: Stateful<Div>,
        cx: &Context<Self>,
    ) -> Option<Stateful<Div>> {
        let theme = self.theme;
        match &self.local_host.operation {
            Operation::Idle => None,
            Operation::Reading => Some(threshold.child(notice(
                "local-host-command-reading",
                "Rilettura dei dati e preparazione della conferma…",
                theme,
                false,
            ))),
            Operation::Review(command) | Operation::Applying(command) => {
                let pending = matches!(self.local_host.operation, Operation::Applying(_));
                let question = match command {
                    Command::Delete(command) => format!(
                        "Eliminare il documento «{}»?",
                        if command.document().locked_fields.iter().any(|f| f == "name") {
                            "con nome non leggibile"
                        } else {
                            &command.document().name
                        }
                    ),
                    Command::Switch(command) => format!(
                        "{} {}?",
                        if command.enabled() {
                            "Abilitare"
                        } else {
                            "Disattivare"
                        },
                        command.key().title()
                    ),
                };
                Some(threshold.child(confirmation_heading(crate::title::TitleText::from(question),theme))
                    .child(text!(if pending {"Operazione in corso. L’esito richiede la rilettura."}else{"Verifica la modifica. Verrà registrata dopo questa conferma e verificata con una nuova lettura."}))
                    .child(div().flex().flex_wrap().gap(px(8.))
                        .child(self.local_host.targets[0].attach(button("local-host-command-cancel","Annulla",theme,false,!pending)).when(!pending,|el|el.on_click(cx.listener(|this,_,window,cx|this.cancel_local_command(window,cx)))))
                        .child(self.local_host.targets[1].attach(button("local-host-command-confirm",if matches!(command,Command::Delete(_)){"Elimina"}else{"Conferma"},theme,true,!pending).when(!pending && matches!(command,Command::Delete(_)),|el|el.bg(theme.critical).border_color(theme.critical).text_color(theme.paper))).when(!pending,|el|el.on_click(cx.listener(|this,_,_,cx|this.confirm_local_command(cx)))))))
            }
            Operation::Failed(message) | Operation::Unconfirmed { message, .. } => Some(
                threshold
                    .child(notice(
                        "local-host-command-error",
                        message.clone(),
                        theme,
                        true,
                    ))
                    .when_some(
                        match &self.local_host.operation {
                            Operation::Unconfirmed { command, .. } => Some(command),
                            _ => None,
                        },
                        |el, command| {
                            el.child(text!(match command {
                                Command::Delete(command) => format!(
                                    "Documento conservato nella richiesta: {}",
                                    command.document().name
                                ),
                                Command::Switch(command) => format!(
                                    "Scelta conservata: {} · {}",
                                    command.key().title(),
                                    if command.enabled() {
                                        "Abilita"
                                    } else {
                                        "Disattiva"
                                    }
                                ),
                            }))
                        },
                    )
                    .child(
                        self.local_host.targets[0]
                            .attach(button(
                                "local-host-command-close",
                                "Chiudi e rileggi",
                                theme,
                                false,
                                true,
                            ))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.local_host.operation = Operation::Idle;
                                this.verified = None;
                                if this.area == Area::Settings {
                                    this.read_local_switches(cx);
                                } else {
                                    this.load_sections(cx);
                                }
                                cx.notify();
                            })),
                    ),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unconfirmed_retirement_survives_restart_and_a_later_success_cannot_hide_it() {
        let fixture = local_preferences::tests::Fixture::new();
        std::fs::create_dir_all(&fixture.0).unwrap();
        let path = fixture.0.join("retirement.json");
        let notice = RetirementNotice::new(Some(path.clone()));
        assert!(!notice.pending());
        notice.change(true);
        assert!(notice.pending());
        let reopened = RetirementNotice::new(Some(path.clone()));
        assert!(reopened.pending());
        reopened.change(true);
        reopened.change(false);
        assert!(reopened.pending());
        reopened.change(false);
        assert!(!RetirementNotice::new(Some(path)).pending());
    }
    #[gpui::test]
    fn unconfirmed_retirement_is_visible_on_the_locked_login_screen(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.local_host.retirement.change(true);
            app.disconnect(cx);
        });
        cx.run_until_parked();
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        assert!(
            cx.debug_bounds("local-session-retirement-warning")
                .is_some()
        );
    }
    #[gpui::test]
    fn local_host_lock_retires_secret_and_pending_confirmation_and_generation(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.local_host.secret.update(cx, |input, cx| {
                input.set_content("Synthetic local host secret", cx)
            });
            app.local_host.authority = Authority::Authenticating;
            app.local_host.operation = Operation::Reading;
            let editor = app.local_host.secret.clone();
            let generation = app.local_host.generation;
            app.request_discard(Discard::Lock, cx);
            assert!(editor.read(cx).value().is_empty());
            assert!(matches!(app.local_host.authority, Authority::Closed));
            assert!(matches!(app.local_host.operation, Operation::Idle));
            assert!(app.local_host.generation > generation);
        });
    }
    #[gpui::test]
    fn local_host_pending_command_blocks_context_changes_and_reload(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Models;
            app.local_host.operation = Operation::Reading;
            let epoch = app.epoch;
            app.navigate(Area::Patients, cx);
            app.change_scope("other-scope", cx);
            app.select_patient("other-patient", true, cx);
            app.request_discard(Discard::Reload, cx);
            app.load_ai_status(cx);
            assert_eq!(app.area, Area::Settings);
            assert_eq!(app.settings_page, SettingsPage::Models);
            assert_eq!(app.epoch, epoch);
            assert!(matches!(app.local_host.operation, Operation::Reading));
        });
    }
}

#[cfg(test)]
mod callback_tests {
    use super::*;
    #[gpui::test]
    fn local_host_old_authority_cannot_publish_a_read_into_a_new_authority(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.run_local_host(
                || Ok(vec![(HostSettingKey::PatientInsight, true)]),
                |this, result, _| this.local_host.switches = ReadLoad::from_result(result),
                cx,
            );
            app.local_host.withdraw(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(matches!(app.local_host.switches, ReadLoad::Idle))
        });
    }
}
