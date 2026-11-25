use super::*;
use crate::shell::local_preferences::{read_private, write_private};
use mediflow_runtime_client::PreparedPassphraseChange;
use sha2::{Digest, Sha256};

pub(in crate::shell) const PASSPHRASE_OUTCOME_GUIDANCE: &str = "Un cambio della passphrase avviato in precedenza ha un esito da verificare. Accedi con la nuova passphrase; se non riesce, prova quella precedente. Conserva entrambi i kit di recupero, ciascuno con la sua chiave scritta su carta, finché un accesso riuscito non mostra quale coppia è valida.";

/// Survives a restart after an uncertain passphrase change. The file holds
/// only a digest of archive address and account name: no passphrase, kit,
/// recovery key or clinical data.
pub(super) struct PassphraseOutcome {
    path: Option<PathBuf>,
    /// `Some(None)` is a marker that exists but cannot be read back.
    pending: Option<Option<String>>,
}
impl PassphraseOutcome {
    pub(super) fn load(path: Option<PathBuf>) -> Self {
        let pending = path.as_ref().and_then(|path| match read_private(path) {
            Ok(bytes) => Some(
                serde_json::from_slice::<serde_json::Value>(&bytes)
                    .ok()
                    .filter(|value| value["version"] == 1)
                    .and_then(|value| value["binding"].as_str().map(str::to_owned)),
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => Some(None),
        });
        Self { path, pending }
    }
    pub(super) fn pending(&self) -> bool {
        self.pending.is_some()
    }
    fn binding(session: &RuntimeSession) -> String {
        let digest = Sha256::digest(
            format!("{}\n{}", session.base_url(), session.user().username).as_bytes(),
        );
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }
    /// Records the uncertain outcome. Returns false when it could not be
    /// stored, so the caller can say the guidance will not survive a restart.
    pub(super) fn record(&mut self, session: &RuntimeSession) -> bool {
        let binding = Self::binding(session);
        self.pending = Some(Some(binding.clone()));
        let Some(path) = &self.path else {
            return cfg!(test);
        };
        serde_json::to_vec(&serde_json::json!({"version": 1, "binding": binding}))
            .map_err(std::io::Error::other)
            .and_then(|bytes| write_private(path, &bytes))
            .is_ok()
    }
    /// A successful sign-in of the same account on the same archive shows
    /// which credential pair is valid. A marker that cannot be read back is
    /// cleared by any successful sign-in.
    pub(super) fn resolve(&mut self, session: &RuntimeSession) {
        let Some(binding) = &self.pending else {
            return;
        };
        if binding
            .as_ref()
            .is_some_and(|binding| *binding != Self::binding(session))
        {
            return;
        }
        if let Some(path) = &self.path {
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return,
            }
        }
        self.pending = None;
    }
}

pub(super) struct SecurityArea {
    pub(super) outcome: PassphraseOutcome,
    fields: [Entity<TextInput>; 3],
    operation: SecurityOperation,
    saved: bool,
    paper: bool,
    message: Option<String>,
    _subscriptions: Vec<Subscription>,
}
enum SecurityOperation {
    Idle,
    Preparing,
    Review(Arc<PreparedPassphraseChange>),
    SavingKit(Arc<PreparedPassphraseChange>),
    Applying,
}
impl SecurityArea {
    pub(super) fn new(
        theme: Theme,
        outcome: Option<PathBuf>,
        cx: &mut Context<ClinicalApp>,
    ) -> Self {
        let fields = [
            ("security-current", "Passphrase attuale"),
            ("security-new", "Nuova passphrase"),
            ("security-confirm", "Conferma nuova passphrase"),
        ]
        .map(|(id, title)| {
            cx.new(|cx| TextInput::new(id, title, title, false, theme, cx).secret())
        });
        let subscriptions = fields
            .iter()
            .map(|field| cx.subscribe(field, |_, _, _: &InputChanged, cx| cx.notify()))
            .collect();
        Self {
            outcome: PassphraseOutcome::load(outcome),
            fields,
            operation: SecurityOperation::Idle,
            saved: false,
            paper: false,
            message: None,
            _subscriptions: subscriptions,
        }
    }
    pub(super) fn has_work(&self) -> bool {
        !matches!(self.operation, SecurityOperation::Idle)
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        for field in &self.fields {
            field.update(cx, |input, cx| input.retire(cx));
        }
        self.operation = SecurityOperation::Idle;
        self.saved = false;
        self.paper = false;
        self.message = None;
    }
    pub(super) fn configure(&mut self, theme: Theme, cx: &mut Context<ClinicalApp>) {
        let disabled = self.has_work();
        for field in &self.fields {
            field.update(cx, |input, cx| input.configure(theme, disabled, cx));
        }
    }
}
impl ClinicalApp {
    pub(in crate::shell) fn access_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let user = self.session.as_ref().map(RuntimeSession::user);
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(heading("settings-access-heading", "Accesso", theme))
            .child(section(
                "settings-current-session",
                "Sessione corrente",
                theme,
            ))
            .child(text!(user.map(|u| u.username.clone()).unwrap_or_default()))
            .child(text!(
                "Il blocco richiede la frase di accesso o il PIN precedente al prossimo accesso."
            ))
            .child(
                button(
                    "settings-access-lock",
                    "Blocca sessione adesso",
                    theme,
                    false,
                    true,
                )
                .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Lock, cx))),
            )
            .child(
                button(
                    "settings-open-danger",
                    "Credenziali e recupero…",
                    theme,
                    false,
                    !self.local_host.has_work(),
                )
                .on_click(cx.listener(|this, _, window, cx| {
                    this.select_settings_page(SettingsPage::Danger, window, cx)
                })),
            )
    }
    pub(in crate::shell) fn danger_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.security;
        let mut pane = div().min_w_0().flex().flex_col().gap(px(16.))
            .child(heading("settings-danger-heading", "Zona pericolo", theme))
            .child(self.local_host_panel(cx))
            .child(section("settings-passphrase-heading", "Cambia passphrase e kit", theme))
            .child(text!("Richiede la passphrase attuale e la conservazione del nuovo kit e della chiave separata. Il PIN di conferma rimane invariato."))
            .child(text!("Nuova passphrase: da 15 a 128 caratteri, anche spazi. I caratteri equivalenti sono normalizzati; gli spazi non vengono rimossi."))
            .child(notice("danger-reset-unavailable", "Il reset degli account non è disponibile in questa finestra. Conserva account, kit e copie di recupero esistenti.", theme, false));
        if self.local_host.access().is_some() {
            for field in &area.fields {
                pane = pane.child(crate::text_input::themed(field.clone(), theme));
            }
            pane = pane.child(
                button(
                    "security-prepare",
                    "Prepara il nuovo kit",
                    theme,
                    true,
                    !self.local_host.has_work(),
                )
                .on_click(
                    cx.listener(|this, _, window, cx| this.prepare_security_change(window, cx)),
                ),
            );
        }
        if let Some(message) = &area.message {
            pane = pane.child(notice("security-message", message.clone(), theme, true));
        }
        pane
    }
    fn prepare_security_change(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let values = self
            .local_host
            .security
            .fields
            .each_ref()
            .map(|field| Zeroizing::new(field.read(cx).value().to_owned()));
        for field in &self.local_host.security.fields {
            field.update(cx, |input, cx| input.retire(cx));
        }
        self.local_host.return_focus = window.focused(cx);
        self.local_host.security.message = None;
        self.local_host.security.operation = SecurityOperation::Preparing;
        self.run_local_host(
            move || access.prepare_passphrase_change(&values[0], &values[1], &values[2]),
            |this, result, cx| {
                match result {
                    Ok(command) => {
                        this.local_host.security.operation =
                            SecurityOperation::Review(Arc::new(command));
                        this.local_host.security.saved = false;
                        this.local_host.security.paper = false;
                    }
                    Err(error) => {
                        this.local_host.security.operation = SecurityOperation::Idle;
                        this.local_host.security.message = Some(ui_error(error));
                    }
                }
                this.local_host.focus_confirmation = true;
                cx.notify();
            },
            cx,
        );
    }
    fn save_security_kit(&mut self, cx: &mut Context<Self>) {
        let SecurityOperation::Review(command) = &self.local_host.security.operation else {
            return;
        };
        let command = command.clone();
        let Some(access) = self.local_host.access() else {
            return;
        };
        let chosen = cx.prompt_for_new_path(&PathBuf::new(), Some("mediflow-recovery-kit.json"));
        let generation = self.local_host.generation;
        self.local_host.security.operation = SecurityOperation::SavingKit(command.clone());
        cx.spawn(async move |this, cx| {
            let chosen = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.local_host.generation != generation {
                    return;
                }
                match chosen {
                    Ok(Ok(Some(path))) => {
                        this.run_local_host(
                            move || {
                                access.admit_archive_file_effect()?;
                                archives::write_new(&path, command.recovery_kit())
                                    .map_err(|_| RuntimeError::Indeterminate)
                            },
                            |this, result, cx| {
                                let SecurityOperation::SavingKit(command) =
                                    &this.local_host.security.operation
                                else {
                                    return;
                                };
                                this.local_host.security.saved = result.is_ok();
                                this.local_host.security.message = result.err().map(ui_error);
                                this.local_host.security.operation =
                                    SecurityOperation::Review(command.clone());
                                cx.notify();
                            },
                            cx,
                        );
                    }
                    _ => this.local_host.security.operation = SecurityOperation::Review(command),
                }
                cx.notify();
            });
        })
        .detach();
    }
    pub(super) fn cancel_security_change(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !matches!(
            self.local_host.security.operation,
            SecurityOperation::Review(_)
        ) {
            return false;
        }
        self.local_host.security.withdraw(cx);
        if let Some(focus) = self.local_host.return_focus.take() {
            window.focus(&focus, cx);
        }
        cx.notify();
        true
    }
    fn apply_security_change(&mut self, cx: &mut Context<Self>) {
        if !self.local_host.security.saved || !self.local_host.security.paper {
            return;
        }
        let SecurityOperation::Review(command) = &self.local_host.security.operation else {
            return;
        };
        let command = command.clone();
        let Some(access) = self.local_host.access() else {
            return;
        };
        let authority = self.account_profile.generation;
        let generation = self.local_host.generation;
        self.local_host.security.operation = SecurityOperation::Applying;
        let task = cx
            .background_executor()
            .spawn(async move { access.change_passphrase(&command) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.account_profile.generation != authority || this.local_host.generation != generation { return; }
                let stored = match (&result, &this.session) {
                    (Ok(()), Some(session)) => { this.local_host.security.outcome.resolve(session); true }
                    (Err(_), Some(session)) => this.local_host.security.outcome.record(session),
                    _ => true,
                };
                this.disconnect(cx);
                this.message = Some(match result {
                    Ok(()) => ("Nuove credenziali rilette. Rinnova l’accesso e verifica lo sblocco con la nuova passphrase.".into(), false),
                    Err(error) => (format!("Cambio della passphrase: esito da verificare. {} Conserva il nuovo kit e la chiave scritta su carta, insieme ai precedenti. Accedi di nuovo e prova lo sblocco con la nuova passphrase; se non riesce, prova quella precedente. Verifica l’accesso prima di preparare un’altra operazione.{}", ui_error(error), if stored { "" } else { " Questa indicazione non è stata salvata e non sarà riproposta dopo la chiusura dell’app: annotala." }), true),
                });
                cx.notify();
            });
        }).detach();
    }
    pub(super) fn security_threshold(
        &self,
        threshold: Stateful<Div>,
        cx: &Context<Self>,
    ) -> Option<Stateful<Div>> {
        let theme = self.theme;
        let area = &self.local_host.security;
        let command = match &area.operation {
            SecurityOperation::Idle => return None,
            SecurityOperation::Preparing | SecurityOperation::Applying => {
                return Some(threshold.child(notice(
                    "security-pending",
                    if matches!(area.operation, SecurityOperation::Preparing) {
                        "Preparazione del nuovo kit…"
                    } else {
                        "Cambio della passphrase in corso…"
                    },
                    theme,
                    false,
                )));
            }
            SecurityOperation::Review(command) | SecurityOperation::SavingKit(command) => command,
        };
        let busy = matches!(area.operation, SecurityOperation::SavingKit(_));
        Some(threshold
            .child(confirmation_heading(crate::title::TitleText::from("Conserva il nuovo kit prima di continuare"), theme))
            .child(text!("Scarica il kit e scrivi questa chiave su carta. Conservali separatamente: insieme permettono di recuperare l’archivio. La chiave non è inclusa nel file."))
            .child(text!(command.recovery_key().to_owned()))
            .child(text!("La nuova credenziale non è ancora attiva. Backup e copie Time Machine precedenti non vengono ripuliti: possono conservare vecchi dati e credenziali. Questa operazione non sostituisce un backup. Una copia del kit già avviata può completarsi dopo il blocco; le destinazioni esistenti non vengono sovrascritte."))
            .child(button("security-save-kit", "Scarica kit di recupero", theme, false, !busy).on_click(cx.listener(|this, _, _, cx| this.save_security_kit(cx))))
            .child(button("security-paper", if area.paper { "Chiave scritta su carta" } else { "Ho salvato il kit e scritto la chiave su carta; li conserverò separati." }, theme, false, !busy && area.saved)
                .aria_selected(area.paper).on_click(cx.listener(|this, _, _, cx| { if this.local_host.security.saved { this.local_host.security.paper = !this.local_host.security.paper; cx.notify(); } })))
            .when_some(area.message.clone(), |el, message| el.child(notice("security-kit-error", message, theme, true)))
            .child(self.local_host.targets[0].attach(button("security-cancel", "Annulla", theme, false, !busy)).on_click(cx.listener(|this, _, window, cx| {
                this.cancel_security_change(window, cx);
            })))
            .child(self.local_host.targets[1].attach(button("security-commit", "Attiva la nuova passphrase", theme, true, !busy && area.saved && area.paper)).on_click(cx.listener(|this, _, _, cx| this.apply_security_change(cx)))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn security_draft_is_secret_preserved_on_page_return_and_retired_on_lock(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.update(|window, cx| {
            view.update(cx, |app, cx| {
                app.area = Area::Settings;
                let editor = app.local_host.security.fields[1].clone();
                editor.update(cx, |input, cx| {
                    input.set_content("New synthetic passphrase", cx)
                });
                app.select_settings_page(SettingsPage::Danger, window, cx);
                app.select_settings_page(SettingsPage::Overview, window, cx);
                assert_eq!(editor.read(cx).value(), "New synthetic passphrase");
                assert!(app.settings_targets[13].focus.is_focused(window));
                app.request_discard(Discard::Lock, cx);
                assert!(editor.read(cx).value().is_empty());
            })
        });
    }
    #[gpui::test]
    fn security_cannot_commit_without_the_kit_and_separate_paper_confirmation(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let notice = RetirementNotice::new(None);
        let access = Arc::new(
            host.session
                .authenticate_local_host("Synthetic scales fixture passphrase", notice.clone())
                .unwrap(),
        );
        let command = Arc::new(
            access
                .prepare_passphrase_change(
                    "Synthetic scales fixture passphrase",
                    "New synthetic passphrase for rotation",
                    "New synthetic passphrase for rotation",
                )
                .unwrap(),
        );
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.local_host.retirement = notice.clone();
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Danger;
            app.local_host.authority = Authority::Open(access);
            app.local_host.security.operation = SecurityOperation::Review(command.clone());
            for (saved, paper) in [(false, true), (true, false), (false, false)] {
                app.local_host.security.saved = saved;
                app.local_host.security.paper = paper;
                app.apply_security_change(cx);
                assert!(matches!(&app.local_host.security.operation, SecurityOperation::Review(retained) if Arc::ptr_eq(retained, &command)));
                assert!(!host.session.is_locked());
            }
        });
        let commands = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert_eq!(
            commands
                .iter()
                .filter(|id| id.as_str() == "security-save-kit")
                .count(),
            1,
            "the real Danger page must expose exactly one recovery review"
        );
        view.update(cx, |app, cx| {
            app.local_host.security.saved = true;
            app.local_host.security.paper = true;
            app.apply_security_change(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, cx| {
            assert!(app.session.is_none());
            assert!(host.session.is_locked());
            assert!(
                app.local_host
                    .security
                    .fields
                    .iter()
                    .all(|field| field.read(cx).value().is_empty())
            );
            assert_eq!(
                app.message.as_ref().unwrap().0,
                "Nuove credenziali rilette. Rinnova l’accesso e verifica lo sblocco con la nuova passphrase."
            );
            assert!(!app.message.as_ref().unwrap().1);
            assert!(!app.local_host.retirement.pending());
        });
    }
    #[gpui::test]
    fn preparing_credentials_blocks_navigation_and_withdraws_late_callbacks(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Danger;
            app.local_host.security.operation = SecurityOperation::Preparing;
            app.navigate(Area::Analytics, cx);
            assert_eq!(app.area, Area::Settings);
            assert_eq!(app.settings_page, SettingsPage::Danger);
            app.run_local_host(
                || Ok(()),
                |app, _, _| app.local_host.security.paper = true,
                cx,
            );
            app.local_host.withdraw(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(!app.local_host.security.has_work());
            assert!(!app.local_host.security.paper);
        });
    }
}

#[cfg(test)]
mod review738 {
    use super::*;
    #[gpui::test]
    fn preparation_errors_retire_all_secret_fields(cx: &mut gpui::TestAppContext) {
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    RetirementNotice::new(None),
                )
                .unwrap(),
        );
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        for (new, confirm, server_error) in [
            (
                "New synthetic passphrase for rotation",
                "Different confirmation for rotation",
                false,
            ),
            ("short", "short", false),
            (
                "New synthetic passphrase for rotation",
                "New synthetic passphrase for rotation",
                true,
            ),
        ] {
            if server_error {
                host.plan("GET /api/auth/check")
                    .send((500, serde_json::json!({"status":"error"})))
                    .unwrap();
            }
            cx.update(|window, cx| {
                view.update(cx, |app, cx| {
                    app.session = Some(host.session.clone());
                    app.local_host.authority = Authority::Open(access.clone());
                    app.area = Area::Settings;
                    app.settings_page = SettingsPage::Danger;
                    for (field, value) in app.local_host.security.fields.iter().zip([
                        "Synthetic scales fixture passphrase",
                        new,
                        confirm,
                    ]) {
                        field.update(cx, |input, cx| input.set_content(value, cx));
                    }
                    app.prepare_security_change(window, cx);
                    assert!(
                        app.local_host
                            .security
                            .fields
                            .iter()
                            .all(|field| field.read(cx).value().is_empty()),
                        "secret UI state must be retired before background preparation"
                    );
                })
            });
            cx.run_until_parked();
            view.read_with(cx, |app, cx| {
                assert!(matches!(
                    app.local_host.security.operation,
                    SecurityOperation::Idle
                ));
                assert!(app.local_host.security.message.is_some());
                assert!(
                    app.local_host
                        .security
                        .fields
                        .iter()
                        .all(|field| field.read(cx).value().is_empty())
                );
            });
        }
    }
    #[gpui::test]
    fn review738_success_requires_readback(cx: &mut gpui::TestAppContext) {
        let host = notes_recovery_tests::Host::new();
        let notice = RetirementNotice::new(None);
        let access = Arc::new(
            host.session
                .authenticate_local_host("Synthetic scales fixture passphrase", notice.clone())
                .unwrap(),
        );
        let command = Arc::new(
            access
                .prepare_passphrase_change(
                    "Synthetic scales fixture passphrase",
                    "New synthetic passphrase for review 738",
                    "New synthetic passphrase for review 738",
                )
                .unwrap(),
        );
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        host.plan("POST /api/auth/passphrase/change")
            .send((200, serde_json::json!({"success":true})))
            .unwrap();
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.local_host.retirement = notice;
            app.local_host.authority = Authority::Open(access);
            app.local_host.security.operation = SecurityOperation::Review(command);
            app.local_host.security.saved = true;
            app.local_host.security.paper = true;
            app.apply_security_change(cx);
        });
        cx.run_until_parked();
        let routes = host.routes();
        let post = routes
            .iter()
            .position(|route| route.starts_with("POST /api/auth/passphrase/change"))
            .unwrap();
        let reads_after = routes
            .iter()
            .skip(post + 1)
            .filter(|route| route.starts_with("GET /api/auth/check"))
            .count();
        eprintln!("review738: auth check readbacks after credential POST = {reads_after}");
        view.read_with(cx, |app,_| {
            assert!(host.session.is_locked());
            let success = app.message.as_ref().is_some_and(|(message,error)| !*error && message.starts_with("Passphrase aggiornata"));
            assert!(app.message.as_ref().unwrap().0.contains("esito da verificare"));
            assert!(reads_after > 0);
            assert!(!success, "the synthetic writer returned 200 without changing credentials: the client must not announce verified success");
        });
    }
    #[gpui::test]
    fn uncertain_passphrase_change_guidance_survives_restart_until_sign_in(
        cx: &mut gpui::TestAppContext,
    ) {
        let fixture = crate::shell::local_preferences::tests::Fixture::new();
        // Creates the private state directory on Windows, as the real store does.
        fixture.store();
        let path = fixture.0.join("passphrase-change-outcome.json");
        let host = notes_recovery_tests::Host::new();
        let notice = RetirementNotice::new(None);
        let access = Arc::new(
            host.session
                .authenticate_local_host("Synthetic scales fixture passphrase", notice.clone())
                .unwrap(),
        );
        let command = Arc::new(
            access
                .prepare_passphrase_change(
                    "Synthetic scales fixture passphrase",
                    "New synthetic passphrase for restart guidance",
                    "New synthetic passphrase for restart guidance",
                )
                .unwrap(),
        );
        // The writer answers 200 but the readback still shows the old salt.
        host.plan("POST /api/auth/passphrase/change")
            .send((200, serde_json::json!({"success":true})))
            .unwrap();
        let (first, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        first.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.local_host.retirement = notice;
            app.local_host.security.outcome = PassphraseOutcome::load(Some(path.clone()));
            app.local_host.authority = Authority::Open(access);
            app.local_host.security.operation = SecurityOperation::Review(command);
            app.local_host.security.saved = true;
            app.local_host.security.paper = true;
            app.apply_security_change(cx);
        });
        cx.run_until_parked();
        first.read_with(cx, |app, _| {
            assert!(
                app.message
                    .as_ref()
                    .unwrap()
                    .0
                    .contains("esito da verificare")
            );
        });
        let stored = std::fs::read_to_string(&path).unwrap();
        assert!(!stored.contains("passphrase"));
        assert!(!stored.contains("synthetic"));

        // Restart: a new window reads the marker from the private state directory.
        let restarted = cx.update(|window, cx| {
            window.replace_root(cx, |window, cx| {
                let mut app = ClinicalApp::new(String::new(), window, cx);
                app.local_host.security.outcome = PassphraseOutcome::load(Some(path.clone()));
                app
            })
        });
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        assert!(
            cx.debug_bounds("clinical-workspace-passphrase-outcome")
                .is_some()
        );

        // A successful sign-in of the same account settles which pair is valid.
        restarted.update(cx, |app, cx| {
            app.pairing = Some(StoredPairing {
                client: RuntimeClient::new(RuntimeConfig {
                    base_url: host.session.base_url().to_owned(),
                    tls_pin_sha256: None,
                })
                .unwrap(),
                id: "synthetic-device".into(),
                token: Zeroizing::new("x".repeat(64)),
            });
            app.login_fields[4]
                .editor
                .update(cx, |input, cx| input.set_content("synthetic", cx));
            app.login_fields[5].editor.update(cx, |input, cx| {
                input.set_content("Synthetic scales fixture passphrase", cx)
            });
            app.connect(cx);
        });
        cx.run_until_parked();
        restarted.read_with(cx, |app, _| {
            assert!(app.session.is_some());
            assert!(!app.local_host.passphrase_outcome_pending());
        });
        assert!(!PassphraseOutcome::load(Some(path)).pending());
    }
}
