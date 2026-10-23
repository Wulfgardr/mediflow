//! ADR 0155 account-profile presentation. The host owns the version and the
//! normalized values; this editor only echoes the version it last observed and
//! never resends on its own after a conflict or an uncertain outcome.

use super::*;
use crate::shell::view_state::ViewStateKind;
use crate::theme::{TypeRole, TypeStyle};
use mediflow_runtime_client::{
    AccountProfileRead, AccountProfileSnapshot, AccountProfileUpdate, AccountProfileUpdateOutcome,
};

const REREAD_MESSAGE: &str =
    "Profilo riletto. Confronta i valori salvati con la tua bozza prima di salvare.";
const CONFLICT_MESSAGE: &str = "Il profilo è cambiato su un altro dispositivo. La tua bozza è conservata. Rileggi e confronta i valori prima di salvare.";
const SAVE_CONFIRMED: &str = "Profilo aggiornato.";
const SAVE_ALREADY_CURRENT: &str = "Il profilo è già aggiornato.";
const SAVE_UNCONFIRMED: &str = "Salvataggio non confermato. La bozza è conservata. Verifica l’accesso e rileggi il profilo prima di riprovare.";
const READ_FAILED: &str =
    "Lettura non riuscita. Verifica l’accesso e rileggi il profilo. La bozza è conservata.";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Working {
    Read,
    Save,
}

pub(super) struct AccountProfile {
    pub(super) load: ReadLoad<()>,
    /// Values and version of the last accepted read or write. A 409 never
    /// replaces this base: only an explicit reread does.
    snapshot: Option<AccountProfileSnapshot>,
    /// Current values received with a `PROFILE_VERSION_CONFLICT`, shown next to
    /// the preserved draft until an explicit reread succeeds.
    conflict: Option<AccountProfileSnapshot>,
    requires_read: bool,
    working: Option<Working>,
    /// Bumped whenever the account authority is replaced, so a late reply from
    /// the previous session or archive cannot reach this editor. The workspace
    /// epoch is deliberately not involved: AI status refreshes and navigation
    /// belong to other surfaces.
    generation: u64,
    /// The automatic initial read of the current authority has already been
    /// requested. Navigation must not turn that into an implicit reread.
    auto_read: bool,
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
            conflict: None,
            requires_read: true,
            working: None,
            generation: 0,
            auto_read: false,
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
        self.generation = self.generation.wrapping_add(1);
        self.load = ReadLoad::Idle;
        self.snapshot = None;
        self.conflict = None;
        self.requires_read = true;
        self.working = None;
        self.auto_read = false;
        self.message.clear();
        self.message_failed = false;
        self.failure = None;
        self.set_editors("", "", cx);
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
            && self.dirty(cx)
    }

    /// The values to show beside the message: the ones received with a conflict
    /// while it is unresolved, otherwise the base this editor would update.
    fn saved_values(&self) -> Option<&AccountProfileSnapshot> {
        self.conflict.as_ref().or(self.snapshot.as_ref())
    }

    pub(super) fn read_only(&self) -> bool {
        self.working.is_some() || self.snapshot.is_none()
    }
}

fn normalized(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

impl ClinicalApp {
    /// The explicit command behind both the reread button and the state hint.
    /// It is the only operation that clears `requires_read` by rereading.
    pub(super) fn load_account_profile(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else {
            return;
        };
        if self.account_profile.working.is_some() {
            return;
        }
        self.begin_account_profile_read(move || session.read_account_profile(), cx);
    }

    /// The automatic entry point for Settings. It reads at most once per
    /// account authority; navigation and remounting never imply a reread.
    pub(super) fn ensure_account_profile_loaded(&mut self, cx: &mut Context<Self>) {
        if self.session.is_none() {
            return;
        }
        let state = &self.account_profile;
        if state.auto_read || state.snapshot.is_some() || state.working.is_some() {
            return;
        }
        self.load_account_profile(cx);
    }

    fn begin_account_profile_read(
        &mut self,
        operation: impl FnOnce() -> Result<AccountProfileRead, RuntimeError> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        let generation = self.account_profile.generation;
        let state = &mut self.account_profile;
        state.auto_read = true;
        state.load = ReadLoad::loading();
        state.working = Some(Working::Read);
        state.failure = None;
        state.requires_read = true;
        state.message.clear();
        state.message_failed = false;
        self.run_account_profile(
            generation,
            operation,
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
                state.conflict = None;
                state.message_failed = false;
                if initial {
                    state.set_editors_from(&snapshot, cx);
                    state.message.clear();
                } else {
                    // A reread follows an uncertain outcome or an explicit
                    // request. The draft stays exactly where the operator left it.
                    state.message = REREAD_MESSAGE.into();
                }
            }
            Err(error) => {
                state.working = None;
                state.requires_read = true;
                if state.snapshot.is_some() {
                    // The base and the draft survive; the operator still needs
                    // an explicit reread before another save.
                    state.load = ReadLoad::Ready(());
                    state.failure = None;
                    state.message = READ_FAILED.into();
                    state.message_failed = true;
                } else {
                    // Nothing was ever read for this authority: keep the shared
                    // read state, whose command retries the initial read.
                    state.load = ReadLoad::Failed(error);
                    state.message.clear();
                    state.message_failed = false;
                }
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
        let generation = self.account_profile.generation;
        self.run_account_profile(
            generation,
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
                state.conflict = None;
                state.message_failed = false;
                state.set_editors_from(&profile, cx);
                state.message = if changed {
                    SAVE_CONFIRMED
                } else {
                    SAVE_ALREADY_CURRENT
                }
                .into();
            }
            Ok(AccountProfileUpdateOutcome::VersionConflict { current }) => {
                // Nothing was written. Keep both the draft and the old base:
                // the version from the conflict is never usable until the
                // operator's explicit reread.
                state.conflict = Some(current);
                state.working = None;
                state.failure = None;
                state.requires_read = true;
                state.message = CONFLICT_MESSAGE.into();
                state.message_failed = false;
            }
            Err(error) => {
                state.working = None;
                state.requires_read = !matches!(error, RuntimeError::InvalidInput);
                state.message_failed = true;
                state.message = match error {
                    RuntimeError::Indeterminate
                    | RuntimeError::InvalidResponse
                    | RuntimeError::Transport => SAVE_UNCONFIRMED.into(),
                    _ => String::new(),
                };
                state.failure = Some(match error {
                    RuntimeError::ArchiveReplaced => ViewStateKind::ArchivioSostituito,
                    RuntimeError::Forbidden | RuntimeError::Rejected(403) => {
                        ViewStateKind::AccessoNegato
                    }
                    RuntimeError::Transport => ViewStateKind::NonInLinea { copia: None },
                    RuntimeError::Indeterminate | RuntimeError::InvalidResponse => {
                        ViewStateKind::EsitoDaVerificare
                    }
                    _ => ViewStateKind::Errore,
                });
            }
        }
    }

    /// Profile requests belong to the account authority, not to the workspace
    /// epoch: an AI status refresh or a scope change must not drop the pending
    /// read, which would leave the section loading with no active request. Only
    /// a replacement of the authority (which resets the editor) retires a reply.
    fn run_account_profile<T: Send + 'static>(
        &self,
        generation: u64,
        operation: impl FnOnce() -> Result<T, RuntimeError> + Send + 'static,
        apply: impl FnOnce(&mut Self, Result<T, RuntimeError>, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let task = cx.background_executor().spawn(async move { operation() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.account_profile.generation != generation {
                    return;
                }
                if let Err(error) = &result
                    && error.is_auth_failure()
                {
                    let message = ui_error(error);
                    this.disconnect(cx);
                    this.message = Some((message, true));
                    return;
                }
                apply(this, result, cx);
                cx.notify();
            });
        })
        .detach();
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
            .child(
                div()
                    .type_role(theme, TypeRole::Body)
                    .text_color(theme.secondary)
                    .child(text!(
                        "Mostrati in intestazione, ricette e referti generati."
                    )),
            );
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
                    .child(div().type_role(theme, TypeRole::Body).child(text!(label)))
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
        if !state.message.is_empty()
            && let Some(values) = state.saved_values()
        {
            view = view.child(
                div()
                    .id("clinical-workspace-profile-values")
                    .type_role(theme, TypeRole::Meta)
                    .text_color(theme.secondary)
                    .child(text!(format!(
                        "Valori salvati: {} · {}",
                        values
                            .display_name
                            .as_deref()
                            .unwrap_or("Nome medico vuoto"),
                        values
                            .ambulatory_name
                            .as_deref()
                            .unwrap_or("Nome ambulatorio vuoto"),
                    ))),
            );
        }
        if !state.message.is_empty() {
            view = view.child(notice(
                "clinical-workspace-profile-message",
                state.message.clone(),
                theme,
                state.message_failed,
            ));
        }
        let reread_enabled = self.session.is_some() && state.working.is_none();
        view.child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(8.))
                .child(
                    button(
                        "clinical-workspace-profile-save",
                        "Salva profilo",
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
                .child(
                    button(
                        "clinical-workspace-profile-reread",
                        "Rileggi profilo mantenendo la bozza",
                        theme,
                        false,
                        reread_enabled,
                    )
                    .when(reread_enabled, |el| {
                        el.on_click(cx.listener(|this, _, _, cx| {
                            this.load_account_profile(cx);
                        }))
                    }),
                ),
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
    use std::{
        io::{Read, Write},
        net::{SocketAddr, TcpListener, TcpStream},
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, Ordering},
        },
        thread,
        time::Duration,
    };

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
            assert_eq!(app.account_profile.message, "Profilo aggiornato.");
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

            app.receive_account_profile_write(
                Ok(AccountProfileUpdateOutcome::Saved {
                    changed: false,
                    profile: snapshot("sha256_v2", Some("Dr. Rossi Nuovo"), Some("Studio Centro")),
                }),
                cx,
            );
            assert_eq!(app.account_profile.message, "Il profilo è già aggiornato.");
        });
    }

    #[gpui::test]
    fn account_profile_conflict_keeps_the_draft_and_never_adopts_the_conflict_version(
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
                    current: snapshot("sha256_v2", Some("Dr. Altro"), Some("Studio Altro")),
                }),
                cx,
            );

            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Nuovo");
            assert_eq!(app.account_profile.save_attempts, 1);
            assert!(app.account_profile.requires_read);
            assert!(!app.account_profile.can_save(cx));
            assert!(
                app.begin_account_profile_save(cx).is_none(),
                "a conflict must not allow another PUT before an explicit reread"
            );
            assert_eq!(app.account_profile.save_attempts, 1);
            assert_eq!(
                app.account_profile
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .profile_version,
                "sha256_v1",
                "the version from the conflict is never the base"
            );
            assert_eq!(
                app.account_profile
                    .conflict
                    .as_ref()
                    .unwrap()
                    .profile_version,
                "sha256_v2"
            );
            assert_eq!(app.account_profile.message, CONFLICT_MESSAGE);
            assert!(!app.account_profile.message_failed);

            // The explicit reread updates the base and the version, never the draft.
            app.receive_account_profile_read(
                Ok(read("sha256_v3", Some("Dr. Terzo"), Some("Studio Terzo"))),
                cx,
            );
            assert_eq!(app.account_profile.message, REREAD_MESSAGE);
            assert!(!app.account_profile.requires_read);
            assert!(app.account_profile.conflict.is_none());
            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Nuovo");
            assert_eq!(
                app.account_profile
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .profile_version,
                "sha256_v3"
            );
            assert!(app.account_profile.can_save(cx));
            let (base, _, _) = app
                .begin_account_profile_save(cx)
                .expect("a new save follows the explicit reread");
            assert_eq!(base.profile_version, "sha256_v3");
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
            assert_eq!(app.account_profile.message, SAVE_UNCONFIRMED);
            assert!(app.account_profile.message_failed);
            assert!(app.account_profile.requires_read);
            assert!(!app.account_profile.can_save(cx));
            assert!(app.begin_account_profile_save(cx).is_none());
            assert_eq!(app.account_profile.save_attempts, 1);
            app.receive_account_profile_read(Ok(read("sha256_v2", Some("Dr. Rossi"), None)), cx);
            assert!(!app.account_profile.requires_read);
            assert_eq!(app.account_profile.message, REREAD_MESSAGE);
            assert!(app.account_profile.can_save(cx));
            let (base, _, _) = app.begin_account_profile_save(cx).unwrap();
            assert_eq!(base.profile_version, "sha256_v2");
            assert_eq!(app.account_profile.save_attempts, 2);
        });
    }

    #[gpui::test]
    fn account_profile_read_is_not_retired_by_an_unrelated_epoch(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.begin_account_profile_read(|| Ok(read("sha256_v1", Some("Dr. Rossi"), None)), cx);
            // "Rileggi stato AI" advances the workspace epoch while the GET runs.
            app.next_epoch();
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(
                app.account_profile.working.is_none(),
                "the profile must never stay loading without an active read"
            );
            assert!(matches!(app.account_profile.load, ReadLoad::Ready(())));
            assert_eq!(
                app.account_profile
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .profile_version,
                "sha256_v1"
            );
            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Rossi");
            assert!(!app.account_profile.requires_read);
        });
    }

    struct HostState {
        current: serde_json::Value,
        conflict: serde_json::Value,
        put_status: u16,
        requests: Vec<String>,
        profile_pause: Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>,
    }

    struct SyntheticProfileHost {
        session: RuntimeSession,
        socket: SocketAddr,
        state: Arc<Mutex<HostState>>,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl SyntheticProfileHost {
        fn new() -> Self {
            Self::with_context(RequestContext::default())
        }

        fn with_context(context: RequestContext) -> Self {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let socket = listener.local_addr().unwrap();
            let state = Arc::new(Mutex::new(HostState {
                current: profile_wire("p1:synthetic", Some("Dr. Rossi"), None),
                conflict: conflict_wire("p1:other", Some("Dr. Altro"), Some("Studio Altro")),
                put_status: 200,
                requests: Vec::new(),
                profile_pause: None,
            }));
            let shared = state.clone();
            let stop = Arc::new(AtomicBool::new(false));
            let stopping = stop.clone();
            let worker = thread::spawn(move || {
                loop {
                    let (mut stream, _) = listener.accept().unwrap();
                    if stopping.load(Ordering::Acquire) {
                        break;
                    }
                    stream
                        .set_read_timeout(Some(Duration::from_secs(10)))
                        .unwrap();
                    let request = read_request(&mut stream);
                    let route = request.lines().next().unwrap().to_owned();
                    let mut host = shared.lock().unwrap();
                    host.requests.push(route.clone());
                    let (code, response) = if route.starts_with("GET /api/auth/check ") {
                        (
                            200,
                            serde_json::json!({"status":"ok", "isSetup":true,
                                "archiveGeneration":"synthetic-generation",
                                "unlock":{"credential":"passphrase", "kdfVersion":3,
                                    "salt":"AwMDAwMDAwMDAwMDAwMDAw=="}}),
                        )
                    } else if route.starts_with("POST /api/auth/native/login ") {
                        (
                            200,
                            serde_json::json!({"success":true, "id":"synthetic-user",
                                "username":"synthetic", "role":"admin",
                                "archiveGeneration":"synthetic-generation",
                                "salt":"AwMDAwMDAwMDAwMDAwMDAw==",
                                "encryptedMasterKey":"v3:BQUFBQUFBQUFBQUFAm40aZvQGpityOwyLKhsE40tJdbsjtrugIXzoJ/lk9gjlh5j7pIPeh7DLQ7ikGhA"}),
                        )
                    } else if route.starts_with("GET /api/v1/network/capabilities ") {
                        (
                            200,
                            serde_json::json!({"protocolVersion":"1.14.0", "hostPorts": serde_json::from_str::<serde_json::Value>(include_str!("../../../transport/tests/fixtures/host-ports.json")).unwrap(),
                                "operatingMode":"network-home-base",
                                "capabilities":[{"key":"network.replica.write-clinical-diary",
                                    "requiresPairing":true, "status":"available"}]}),
                        )
                    } else if route.starts_with("GET /api/auth/profile ") {
                        (200, host.current.clone())
                    } else if route.starts_with("PUT /api/auth/profile ") {
                        if host.put_status == 200 {
                            let mut confirmed = host.current.clone();
                            confirmed.as_object_mut().unwrap().remove("operation");
                            confirmed.as_object_mut().unwrap().remove("contractVersion");
                            confirmed["changed"] = serde_json::json!(true);
                            (200, confirmed)
                        } else {
                            (host.put_status, host.conflict.clone())
                        }
                    } else if route.starts_with("POST /api/auth/native/logout ") {
                        (200, serde_json::json!({"success":true}))
                    } else {
                        (200, serde_json::json!({}))
                    };
                    if route.contains("/api/auth/profile ")
                        && let Some((seen, release)) = host.profile_pause.take()
                    {
                        seen.send(()).unwrap();
                        release.recv_timeout(Duration::from_secs(5)).unwrap();
                    }
                    let response = response.to_string();
                    write!(
                        stream,
                        "HTTP/1.1 {code} Synthetic\r\nContent-Type: application/json\r\nSet-Cookie: mediflow_session={}; Path=/; HttpOnly\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                        "a".repeat(64),
                        response.len()
                    )
                    .unwrap_or_else(|error| {
                        assert!(matches!(error.kind(), std::io::ErrorKind::BrokenPipe | std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted));
                    });
                }
            });
            let client = RuntimeClient::new(RuntimeConfig {
                base_url: format!("http://{socket}"),
                tls_pin_sha256: None,
            })
            .unwrap()
            .with_request_context(context);
            let session = client
                .login(
                    PairingCredentials::new("synthetic-device", "x".repeat(64)).unwrap(),
                    "synthetic",
                    "Synthetic scales fixture passphrase",
                )
                .unwrap();
            Self {
                session,
                socket,
                state,
                stop,
                worker: Some(worker),
            }
        }

        fn serve(&self, current: serde_json::Value, conflict: serde_json::Value, put: u16) {
            let mut state = self.state.lock().unwrap();
            state.current = current;
            state.conflict = conflict;
            state.put_status = put;
        }

        fn profile_reads(&self) -> usize {
            self.state
                .lock()
                .unwrap()
                .requests
                .iter()
                .filter(|route| route.starts_with("GET /api/auth/profile "))
                .count()
        }

        fn profile_writes(&self) -> usize {
            self.state
                .lock()
                .unwrap()
                .requests
                .iter()
                .filter(|route| route.starts_with("PUT /api/auth/profile "))
                .count()
        }
    }

    impl Drop for SyntheticProfileHost {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            let _ = TcpStream::connect(self.socket);
            self.worker.take().unwrap().join().unwrap();
        }
    }

    fn profile_wire(
        version: &str,
        display: Option<&str>,
        ambulatory: Option<&str>,
    ) -> serde_json::Value {
        serde_json::json!({
            "operation": "account-profile.read.v1",
            "contractVersion": 1,
            "userId": "synthetic-user",
            "username": "synthetic",
            "displayName": display,
            "ambulatoryName": ambulatory,
            "profileVersion": version,
            "archiveGeneration": "synthetic-generation",
        })
    }

    fn conflict_wire(
        version: &str,
        display: Option<&str>,
        ambulatory: Option<&str>,
    ) -> serde_json::Value {
        serde_json::json!({
            "userId": "synthetic-user",
            "username": "synthetic",
            "displayName": display,
            "ambulatoryName": ambulatory,
            "profileVersion": version,
            "archiveGeneration": "synthetic-generation",
            "code": "PROFILE_VERSION_CONFLICT",
            "error": "Il profilo è cambiato su un altro client.",
        })
    }

    fn read_request(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut byte = [0];
        while !bytes.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            bytes.push(byte[0]);
            assert!(bytes.len() < 16384);
        }
        let header = String::from_utf8(bytes).unwrap();
        let size = header
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length: ")
                    .map(|length| length.parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        let mut body = vec![0; size];
        stream.read_exact(&mut body).unwrap();
        header
    }

    #[gpui::test]
    fn account_profile_reads_once_per_authority_and_never_recovers_by_navigation(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticProfileHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| app.session = Some(host.session.clone()));

        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.ensure_account_profile_loaded(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Rossi");
            assert!(!app.account_profile.requires_read);
        });
        assert_eq!(host.profile_reads(), 1);

        // A conflict received by the host: the draft stays and nothing new can
        // be sent until the operator rereads.
        host.serve(
            profile_wire("p1:third", Some("Dr. Terzo"), Some("Studio Terzo")),
            conflict_wire("p1:other", Some("Dr. Altro"), Some("Studio Altro")),
            409,
        );
        view.update(cx, |app, cx| {
            app.account_profile
                .display
                .update(cx, |input, cx| input.set_content("Dr. Nuovo", cx));
            app.save_account_profile(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(app.account_profile.message, CONFLICT_MESSAGE);
            assert!(app.account_profile.requires_read);
            assert!(!app.account_profile.can_save(cx));
            assert_eq!(
                app.account_profile
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .profile_version,
                "p1:synthetic"
            );
            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Nuovo");
        });
        assert_eq!(host.profile_writes(), 1);

        // Leaving and returning to Settings must not read again nor clear the
        // guard. The AI status refresh on entry advances the workspace epoch.
        view.update(cx, |app, cx| {
            app.navigate(Area::Analytics, cx);
            app.navigate(Area::Settings, cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(app.account_profile.requires_read);
            assert!(!app.account_profile.can_save(cx));
            assert!(app.begin_account_profile_save(cx).is_none());
            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Nuovo");
        });
        assert_eq!(host.profile_reads(), 1);
        assert_eq!(host.profile_writes(), 1);

        // Only the explicit gesture rereads: the base takes the new version and
        // the draft is untouched.
        view.update(cx, |app, cx| app.load_account_profile(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(host.profile_reads(), 2);
            assert_eq!(app.account_profile.message, REREAD_MESSAGE);
            assert!(!app.account_profile.requires_read);
            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Nuovo");
            assert_eq!(
                app.account_profile
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .profile_version,
                "p1:third"
            );
            let (base, _, _) = app
                .begin_account_profile_save(cx)
                .expect("the explicit reread enables a new save");
            assert_eq!(base.profile_version, "p1:third");
        });
        assert_eq!(host.profile_writes(), 1);
    }

    #[gpui::test]
    fn account_profile_uncertain_save_stays_guarded_after_leaving_settings(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticProfileHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| app.session = Some(host.session.clone()));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.ensure_account_profile_loaded(cx);
        });
        cx.run_until_parked();

        // A 5xx is an unconfirmed write: the request may have been applied.
        host.serve(
            profile_wire("p1:synthetic", Some("Dr. Rossi"), None),
            conflict_wire("p1:other", Some("Dr. Altro"), None),
            500,
        );
        view.update(cx, |app, cx| {
            app.account_profile
                .display
                .update(cx, |input, cx| input.set_content("Dr. Nuovo", cx));
            app.save_account_profile(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, _| {
            assert!(app.account_profile.requires_read);
            assert_eq!(app.account_profile.message, SAVE_UNCONFIRMED);
            assert_eq!(app.account_profile.save_attempts, 1);
        });

        view.update(cx, |app, cx| {
            app.navigate(Area::Analytics, cx);
            app.navigate(Area::Settings, cx);
        });
        cx.run_until_parked();
        assert_eq!(host.profile_reads(), 1);
        assert_eq!(host.profile_writes(), 1);
        view.update(cx, |app, cx| {
            assert!(
                app.account_profile.requires_read,
                "navigation must not recover an unconfirmed save"
            );
            assert!(!app.account_profile.can_save(cx));
            assert!(app.begin_account_profile_save(cx).is_none());
            assert_eq!(app.account_profile.save_attempts, 1);
            assert_eq!(app.account_profile.display.read(cx).value(), "Dr. Nuovo");
        });
    }
    #[gpui::test]
    fn review_pending_account_read_survives_workspace_epoch(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let host = SyntheticProfileHost::with_context(
            view.read_with(cx, |app, _| app.request_context.clone()),
        );
        view.update(cx, |app, _| app.session = Some(host.session.clone()));
        let (seen_tx, seen_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        host.state.lock().unwrap().profile_pause = Some((seen_tx, release_rx));
        let reader = host.session.clone();
        let worker = thread::spawn(move || reader.read_account_profile());
        seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        view.update(cx, |app, cx| {
            app.begin_account_profile_read(move || worker.join().unwrap(), cx);
            app.next_epoch();
        });
        release_tx.send(()).unwrap();
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(
                matches!(app.account_profile.load, ReadLoad::Ready(())),
                "workspace epoch cancelled an account-authority read"
            );
            assert!(!app.account_profile.requires_read);
        });
    }

    #[gpui::test]
    fn pending_account_save_survives_workspace_epoch(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let host = SyntheticProfileHost::with_context(
            view.read_with(cx, |app, _| app.request_context.clone()),
        );
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.load_account_profile(cx);
        });
        cx.run_until_parked();
        let (snapshot, display, ambulatory) = view.update(cx, |app, cx| {
            app.account_profile
                .display
                .update(cx, |input, cx| input.set_content("Dr. Nuovo", cx));
            app.begin_account_profile_save(cx).unwrap()
        });
        host.serve(
            profile_wire("p1:updated", Some("Dr. Nuovo"), None),
            serde_json::json!({}),
            200,
        );
        let (seen_tx, seen_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        host.state.lock().unwrap().profile_pause = Some((seen_tx, release_rx));
        let writer = host.session.clone();
        let worker = thread::spawn(move || {
            writer.update_account_profile(&snapshot, Some(&display), Some(&ambulatory))
        });
        seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        view.update(cx, |app, cx| {
            app.run_account_profile(
                app.account_profile.generation,
                move || worker.join().unwrap(),
                ClinicalApp::receive_account_profile_write,
                cx,
            );
            app.next_epoch();
        });
        release_tx.send(()).unwrap();
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert_eq!(app.account_profile.message, SAVE_CONFIRMED);
            assert!(!app.account_profile.requires_read);
            assert_eq!(
                app.account_profile
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .profile_version,
                "p1:updated"
            );
        });
        assert_eq!(host.profile_writes(), 1);
    }
}
