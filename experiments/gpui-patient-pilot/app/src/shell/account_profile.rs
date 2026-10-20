//! ADR 0155 account-profile presentation. The host owns the version and the
//! normalized values; this editor only echoes the version it last observed and
//! never resends on its own after a conflict or an uncertain outcome.

use super::*;
use crate::shell::view_state::ViewStateKind;
use mediflow_runtime_client::{
    AccountProfileRead, AccountProfileSnapshot, AccountProfileUpdate, AccountProfileUpdateOutcome,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Working {
    Read,
    Save,
}

pub(super) struct AccountProfile {
    pub(super) load: ReadLoad<()>,
    snapshot: Option<AccountProfileSnapshot>,
    conflict: bool,
    requires_read: bool,
    working: Option<Working>,
    message: String,
    message_failed: bool,
    failure: Option<ViewStateKind>,
    display: Entity<TextInput>,
    ambulatory: Entity<TextInput>,
    _subscriptions: Vec<Subscription>,
    #[cfg(test)]
    save_attempts: usize,
}

impl AccountProfile {
    pub(super) fn new(scroll: &ScrollHandle, theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let display = cx.new(|cx| {
            TextInput::new(
                "clinical-workspace-profile-display",
                "Nome medico",
                "es. Dr. Mario Rossi",
                false,
                theme,
                cx,
            )
        });
        let ambulatory = cx.new(|cx| {
            TextInput::new(
                "clinical-workspace-profile-ambulatory",
                "Nome ambulatorio",
                "es. Studio Medico Centro",
                false,
                theme,
                cx,
            )
        });
        let mut subscriptions = Vec::new();
        for editor in [&display, &ambulatory] {
            subscriptions.push(cx.subscribe(editor, |_, _, _: &InputChanged, cx| {
                cx.notify();
            }));
        }
        let _ = scroll;
        Self {
            load: ReadLoad::Idle,
            snapshot: None,
            conflict: false,
            requires_read: true,
            working: None,
            message: String::new(),
            message_failed: false,
            failure: None,
            display,
            ambulatory,
            _subscriptions: subscriptions,
            #[cfg(test)]
            save_attempts: 0,
        }
    }

    pub(super) fn reset(&mut self, cx: &mut Context<ClinicalApp>) {
        self.load = ReadLoad::Idle;
        self.snapshot = None;
        self.conflict = false;
        self.requires_read = true;
        self.working = None;
        self.message.clear();
        self.message_failed = false;
        self.failure = None;
        self.set_editors("", "", cx);
    }

    /// A scope or epoch change belongs to the workspace, not to the account
    /// authority: keep the draft, but a dropped save is no longer confirmed.
    pub(super) fn prepare_epoch(&mut self) {
        if self.working == Some(Working::Save) {
            self.failure = Some(ViewStateKind::EsitoDaVerificare);
            self.requires_read = true;
            self.message.clear();
        }
        self.working = None;
        if matches!(self.load, ReadLoad::Loading { .. }) {
            self.load = ReadLoad::Idle;
        }
    }

    pub(super) fn configure(
        &mut self,
        theme: Theme,
        read_only: bool,
        cx: &mut Context<ClinicalApp>,
    ) {
        for editor in [&self.display, &self.ambulatory] {
            editor.update(cx, |input, cx| input.configure(theme, read_only, cx));
        }
    }

    fn set_editors(&mut self, display: &str, ambulatory: &str, cx: &mut Context<ClinicalApp>) {
        self.display
            .update(cx, |input, cx| input.set_content(display, cx));
        self.ambulatory
            .update(cx, |input, cx| input.set_content(ambulatory, cx));
    }

    fn set_editors_from(
        &mut self,
        snapshot: &AccountProfileSnapshot,
        cx: &mut Context<ClinicalApp>,
    ) {
        self.set_editors(
            snapshot.display_name.as_deref().unwrap_or(""),
            snapshot.ambulatory_name.as_deref().unwrap_or(""),
            cx,
        );
    }

    fn draft(&self, cx: &App) -> (String, String) {
        (
            self.display.read(cx).value().to_owned(),
            self.ambulatory.read(cx).value().to_owned(),
        )
    }

    fn names_valid(&self, cx: &App) -> bool {
        let (display, ambulatory) = self.draft(cx);
        [display, ambulatory]
            .into_iter()
            .all(|value| value.trim().encode_utf16().count() <= 200)
    }

    fn dirty(&self, cx: &App) -> bool {
        let Some(snapshot) = &self.snapshot else {
            return false;
        };
        let (display, ambulatory) = self.draft(cx);
        normalized(Some(&display)) != snapshot.display_name
            || normalized(Some(&ambulatory)) != snapshot.ambulatory_name
    }

    fn can_save(&self, cx: &App) -> bool {
        self.snapshot.is_some()
            && self.working.is_none()
            && !self.requires_read
            && self.names_valid(cx)
            && (self.conflict || self.dirty(cx))
    }

    pub(super) fn read_only(&self) -> bool {
        self.working.is_some() || self.snapshot.is_none()
    }

    fn command_label(&self) -> &'static str {
        if self.conflict {
            "Salva comunque sopra la versione attuale"
        } else {
            "Salva profilo"
        }
    }
}

fn normalized(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

impl ClinicalApp {
    pub(super) fn load_account_profile(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else {
            return;
        };
        if self.account_profile.working.is_some() {
            return;
        }
        self.account_profile.load = ReadLoad::loading();
        self.account_profile.working = Some(Working::Read);
        self.account_profile.failure = None;
        self.account_profile.requires_read = true;
        self.account_profile.message.clear();
        self.account_profile.message_failed = false;
        self.run(
            move || session.read_account_profile(),
            Self::receive_account_profile_read,
            cx,
        );
        cx.notify();
    }

    fn receive_account_profile_read(
        &mut self,
        result: Result<AccountProfileRead, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        let state = &mut self.account_profile;
        match result {
            Ok(profile) => {
                let initial = state.snapshot.is_none();
                let snapshot = profile.snapshot();
                state.snapshot = Some(snapshot.clone());
                state.load = ReadLoad::Ready(());
                state.working = None;
                state.failure = None;
                state.requires_read = false;
                state.conflict = false;
                state.message_failed = false;
                if initial {
                    state.set_editors_from(&snapshot, cx);
                    state.message.clear();
                } else {
                    // A reread follows an uncertain outcome or an explicit
                    // request. The draft stays exactly where the operator left it.
                    state.message =
                        "Profilo riletto. Confronta i valori registrati con la tua bozza prima di salvare."
                            .into();
                }
            }
            Err(error) => {
                state.load = ReadLoad::Failed(error);
                state.working = None;
                state.requires_read = true;
                state.message.clear();
            }
        }
    }

    fn begin_account_profile_save(
        &mut self,
        cx: &App,
    ) -> Option<(AccountProfileSnapshot, String, String)> {
        if !self.account_profile.can_save(cx) {
            return None;
        }
        let snapshot = self.account_profile.snapshot.clone()?;
        let (display, ambulatory) = self.account_profile.draft(cx);
        // The local builder enforces the same trim, empty and 200-unit bounds
        // as the host before any request leaves this window.
        AccountProfileUpdate::new(&snapshot, Some(&display), Some(&ambulatory)).ok()?;
        self.account_profile.working = Some(Working::Save);
        self.account_profile.failure = None;
        self.account_profile.message.clear();
        self.account_profile.message_failed = false;
        #[cfg(test)]
        {
            self.account_profile.save_attempts += 1;
        }
        Some((snapshot, display, ambulatory))
    }

    fn save_account_profile(&mut self, cx: &mut Context<Self>) {
        let Some((snapshot, display, ambulatory)) = self.begin_account_profile_save(cx) else {
            return;
        };
        let Some(session) = self.session.clone() else {
            self.account_profile.working = None;
            return;
        };
        self.run(
            move || session.update_account_profile(&snapshot, Some(&display), Some(&ambulatory)),
            Self::receive_account_profile_write,
            cx,
        );
        cx.notify();
    }

    fn receive_account_profile_write(
        &mut self,
        result: Result<AccountProfileUpdateOutcome, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        let state = &mut self.account_profile;
        match result {
            Ok(AccountProfileUpdateOutcome::Saved { changed, profile }) => {
                state.snapshot = Some(profile.clone());
                state.working = None;
                state.failure = None;
                state.requires_read = false;
                state.conflict = false;
                state.message_failed = false;
                state.set_editors_from(&profile, cx);
                state.message = if changed {
                    "Profilo salvato."
                } else {
                    "Nessuna modifica da salvare."
                }
                .into();
            }
            Ok(AccountProfileUpdateOutcome::VersionConflict { current }) => {
                // Nothing was written. Keep the draft untouched and require the
                // operator's explicit overwrite gesture with the new version.
                state.snapshot = Some(current);
                state.working = None;
                state.failure = None;
                state.requires_read = false;
                state.conflict = true;
                state.message.clear();
                state.message_failed = false;
            }
            Err(error) => {
                state.working = None;
                state.message.clear();
                state.message_failed = true;
                state.requires_read = !matches!(error, RuntimeError::InvalidInput);
                state.conflict = false;
                state.failure = Some(match error {
                    RuntimeError::ArchiveReplaced => ViewStateKind::ArchivioSostituito,
                    RuntimeError::Forbidden | RuntimeError::Rejected(403) => {
                        ViewStateKind::AccessoNegato
                    }
                    RuntimeError::Transport => ViewStateKind::NonInLinea { copia: None },
                    RuntimeError::Indeterminate => ViewStateKind::EsitoDaVerificare,
                    _ => ViewStateKind::Errore,
                });
            }
        }
    }

    pub(super) fn account_profile_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let state = &self.account_profile;
        let save_enabled = state.can_save(cx);
        let mut view = div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .border_t_1()
            .border_color(theme.rule)
            .pt(px(24.))
            .child(section(
                "clinical-workspace-profile-heading",
                "Profilo",
                theme,
            ))
            .child(div().text_color(theme.secondary).child(text!(
                "Mostrati in intestazione, ricette e referti generati."
            )));
        for (editor, id, label) in [
            (
                &state.display,
                "clinical-workspace-profile-display-field",
                "Nome medico",
            ),
            (
                &state.ambulatory,
                "clinical-workspace-profile-ambulatory-field",
                "Nome ambulatorio",
            ),
        ] {
            view = view.child(
                div()
                    .id(SharedString::from(id))
                    .min_w_0()
                    .max_w_full()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(
                        div()
                            .text_size(px(theme.body()))
                            .font_weight(FontWeight::MEDIUM)
                            .child(text!(label)),
                    )
                    .child(editor.clone()),
            );
        }
        if let Some(state) = state.load.state(ReadObject::Profilo) {
            view = view.child(self.profile_state_view(state, cx));
        }
        if let Some(kind) = state.failure.clone() {
            view =
                view.child(self.profile_state_view(ViewState::new(ReadObject::Profilo, kind), cx));
        }
        if state.conflict {
            view = view
                .child(notice(
                    "clinical-workspace-profile-conflict",
                    "Il profilo è cambiato su un altro dispositivo.",
                    theme,
                    false,
                ))
                .child(div().text_color(theme.secondary).child(text!(format!(
                            "Registrato: Nome medico {} · Nome ambulatorio {}",
                            state
                                .snapshot
                                .as_ref()
                                .and_then(|profile| profile.display_name.as_deref())
                                .unwrap_or("vuoto"),
                            state
                                .snapshot
                                .as_ref()
                                .and_then(|profile| profile.ambulatory_name.as_deref())
                                .unwrap_or("vuoto")
                        ))));
        }
        if !state.message.is_empty() {
            view = view.child(notice(
                "clinical-workspace-profile-message",
                state.message.clone(),
                theme,
                state.message_failed,
            ));
        }
        view.child(
            button(
                "clinical-workspace-profile-save",
                state.command_label(),
                theme,
                true,
                save_enabled,
            )
            .when(save_enabled, |el| {
                el.on_click(cx.listener(|this, _, _, cx| {
                    this.save_account_profile(cx);
                }))
            }),
        )
    }

    fn profile_state_view(&self, state: ViewState, cx: &Context<Self>) -> Stateful<Div> {
        state.render(
            "clinical-workspace-profile-state",
            self.theme,
            &self.read_state_focus[ReadObject::Profilo.index()],
            cx.listener(|this, _, _, cx| this.retry_patient_read(ReadObject::Profilo, cx)),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(
        version: &str,
        display: Option<&str>,
        ambulatory: Option<&str>,
    ) -> AccountProfileSnapshot {
        AccountProfileSnapshot {
            user_id: "user_1".into(),
            username: "mario.rossi".into(),
            display_name: display.map(str::to_owned),
            ambulatory_name: ambulatory.map(str::to_owned),
            profile_version: version.into(),
            archive_generation: "archive_1".into(),
        }
    }

    fn read(version: &str, display: Option<&str>, ambulatory: Option<&str>) -> AccountProfileRead {
        AccountProfileRead {
            user_id: "user_1".into(),
            username: "mario.rossi".into(),
            display_name: display.map(str::to_owned),
            ambulatory_name: ambulatory.map(str::to_owned),
            profile_version: version.into(),
            archive_generation: "archive_1".into(),
        }
    }

    #[gpui::test]
    fn account_profile_only_saves_a_dirty_draft_and_adopts_the_host_reply(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.receive_account_profile_read(
                Ok(read("sha256_v1", Some("Dr. Rossi"), Some("Studio Centro"))),
                cx,
            );
            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Rossi");
            assert!(!app.account_profile.can_save(cx));
            assert_eq!(app.account_profile.command_label(), "Salva profilo");

            app.account_profile
                .display
                .update(cx, |input, cx| input.set_content("Dr. Rossi Nuovo", cx));
            assert!(app.account_profile.dirty(cx));
            assert!(app.account_profile.can_save(cx));

            let (base, display, ambulatory) = app
                .begin_account_profile_save(cx)
                .expect("a dirty draft can be sent");
            assert_eq!(base.profile_version, "sha256_v1");
            assert_eq!(
                (display.as_str(), ambulatory.as_str()),
                ("Dr. Rossi Nuovo", "Studio Centro")
            );
            assert_eq!(app.account_profile.save_attempts, 1);

            app.receive_account_profile_write(
                Ok(AccountProfileUpdateOutcome::Saved {
                    changed: true,
                    profile: snapshot("sha256_v2", Some("Dr. Rossi Nuovo"), Some("Studio Centro")),
                }),
                cx,
            );
            assert_eq!(app.account_profile.message, "Profilo salvato.");
            assert_eq!(
                app.account_profile.display.read(cx).value(),
                "Dr. Rossi Nuovo"
            );
            assert!(!app.account_profile.dirty(cx));
            assert!(!app.account_profile.can_save(cx));
            assert_eq!(
                app.account_profile
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .profile_version,
                "sha256_v2"
            );
        });
    }

    #[gpui::test]
    fn account_profile_conflict_keeps_the_draft_and_waits_for_an_explicit_overwrite(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.receive_account_profile_read(Ok(read("sha256_v1", Some("Dr. Rossi"), None)), cx);
            app.account_profile
                .display
                .update(cx, |input, cx| input.set_content("Dr. Nuovo", cx));
            app.begin_account_profile_save(cx).unwrap();
            app.receive_account_profile_write(
                Ok(AccountProfileUpdateOutcome::VersionConflict {
                    current: snapshot("sha256_v2", Some("Dr. Altro"), None),
                }),
                cx,
            );

            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Nuovo");
            assert_eq!(app.account_profile.save_attempts, 1);
            assert!(app.account_profile.conflict);
            assert!(app.account_profile.can_save(cx));
            assert_eq!(
                app.account_profile.command_label(),
                "Salva comunque sopra la versione attuale"
            );
            assert_eq!(
                app.account_profile
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .profile_version,
                "sha256_v2"
            );

            let (base, _, _) = app
                .begin_account_profile_save(cx)
                .expect("the overwrite needs an explicit gesture");
            assert_eq!(base.profile_version, "sha256_v2");
            assert_eq!(app.account_profile.save_attempts, 2);
        });
    }

    #[gpui::test]
    fn account_profile_uncertain_outcome_blocks_any_resend_until_a_read(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.receive_account_profile_read(Ok(read("sha256_v1", Some("Dr. Rossi"), None)), cx);
            app.account_profile
                .display
                .update(cx, |input, cx| input.set_content("Dr. Nuovo", cx));
            app.begin_account_profile_save(cx).unwrap();
            app.receive_account_profile_write(Err(RuntimeError::Indeterminate), cx);

            assert_eq!(app.account_profile.save_attempts, 1);
            assert_eq!(
                app.account_profile.failure,
                Some(ViewStateKind::EsitoDaVerificare)
            );
            assert!(app.account_profile.requires_read);
            assert!(!app.account_profile.can_save(cx));
            assert!(app.begin_account_profile_save(cx).is_none());
            assert_eq!(app.account_profile.save_attempts, 1);
            app.receive_account_profile_read(Ok(read("sha256_v2", Some("Dr. Rossi"), None)), cx);
            assert!(!app.account_profile.requires_read);
            assert!(app.account_profile.can_save(cx));
            let (base, _, _) = app.begin_account_profile_save(cx).unwrap();
            assert_eq!(base.profile_version, "sha256_v2");
            assert_eq!(app.account_profile.save_attempts, 2);
        });
    }
}
