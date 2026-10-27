use super::*;

#[derive(Clone, Copy)]
pub(super) enum PreferenceChange {
    Appearance(Option<bool>),
    TextScale(f32),
    Contrast(bool),
    Privacy(bool),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PreferenceIssue {
    Read,
    Save,
}

impl ClinicalApp {
    fn visual_preferences(&self) -> LocalPreferences {
        LocalPreferences {
            dark_override: self.dark_override,
            text_scale: self.text_scale,
            increased_contrast: self.increased_contrast,
            privacy_shield: self.privacy_shield,
        }
    }

    pub(super) fn change_local_preference(
        &mut self,
        change: PreferenceChange,
        cx: &mut Context<Self>,
    ) {
        match change {
            PreferenceChange::Appearance(value) => self.dark_override = value,
            PreferenceChange::TextScale(value)
                if local_preferences::TEXT_SCALES.contains(&value) =>
            {
                self.text_scale = value
            }
            PreferenceChange::TextScale(_) => return,
            PreferenceChange::Contrast(value) => self.increased_contrast = value,
            PreferenceChange::Privacy(value) => {
                if value {
                    self.withdraw_ambulatory_command_view(cx);
                }
                self.privacy_shield = value;
            }
        }
        self.save_local_preferences(cx);
    }

    fn save_local_preferences(&mut self, cx: &mut Context<Self>) {
        self.preferences_issue = self
            .local_preferences
            .save(self.visual_preferences())
            .err()
            .map(|_| PreferenceIssue::Save);
        cx.notify();
    }

    pub(super) fn prepare_local_appearance(&mut self, window: &Window) {
        self.apply_local_appearance(matches!(
            window.appearance(),
            WindowAppearance::Dark | WindowAppearance::VibrantDark
        ));
    }

    fn apply_local_appearance(&mut self, system_dark: bool) {
        self.dark = self.dark_override.unwrap_or(system_dark);
        self.theme = Theme::for_dark(self.dark).sized(self.text_scale, self.increased_contrast);
        #[cfg(test)]
        if let Some(body) = self.test_body_size {
            self.theme.scale = body * self.text_scale / Theme::for_dark(false).body();
        }
    }

    pub(super) fn local_preferences_status(&self, cx: &Context<Self>) -> Div {
        div().flex().flex_col().gap(px(12.)).when_some(self.preferences_issue, |el, issue| {
            el.child(notice("clinical-workspace-local-preferences-error", match issue {
                PreferenceIssue::Read => "Le preferenze di questa app non sono leggibili. La finestra resta coperta finché scegli Mostra contenuti. Le scelte salvate non sono state cambiate.",
                PreferenceIssue::Save => "Le scelte valgono in questa finestra, ma non sono state salvate per la prossima apertura. Riprova a salvarle.",
            }, self.theme, true))
            .when(issue == PreferenceIssue::Save, |el| el.child(
                button("clinical-workspace-local-preferences-retry", "Riprova a salvare le scelte", self.theme, false, true)
                    .map(|el| if self.privacy_shield { self.privacy_commands[0].attach(el) } else { el })
                    .on_click(cx.listener(|this, _, _, cx| this.save_local_preferences(cx)))
            ))
        })
    }

    pub(super) fn privacy_view(&self, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        div().id("clinical-workspace-privacy-shield")
            .accessibility_id("clinical-workspace-privacy-shield")
            .role(Role::Application)
            .aria_label("MediFlow, contenuti oscurati")
            .debug_selector(|| "clinical-workspace-privacy-shield".into())
            .track_focus(&self.focus)
            .key_context("MediFlowPrivacy")
            .on_action(cx.listener(|this, _: &NextFocus, window, cx| {
                window.focus_next(cx);
                this.privacy_commands.iter().any(|target| target.reveal_if_focused(window, cx));
            }))
            .on_action(cx.listener(|this, _: &PreviousFocus, window, cx| {
                window.focus_prev(cx);
                this.privacy_commands.iter().any(|target| target.reveal_if_focused(window, cx));
            }))
            .on_action(cx.listener(|this, _: &Privacy, _, cx| this.change_local_preference(PreferenceChange::Privacy(false), cx)))
            .on_action(cx.listener(|this, _: &Lock, _, cx| this.request_discard(Discard::Lock, cx)))
            .size_full().overflow_y_scroll().track_scroll(&self.privacy_scroll).bg(theme.paper).text_color(theme.ink)
            .type_role(theme, TypeRole::Body).p(px(24.)).flex().flex_col().gap(px(16.))
            .child(heading("clinical-workspace-privacy-heading", "Contenuti oscurati", theme))
            .child(div().max_w(px(640.)).child(text!(if self.session.is_some() {
                "La finestra è coperta e la bozza è conservata. L’accesso resta aperto: scegli Blocca per chiuderlo."
            } else {
                "La finestra è coperta. Mostra i contenuti per accedere a MediFlow."
            })))
            .child(self.local_preferences_status(cx))
            .child(div().flex().flex_wrap().gap(px(12.))
                .child(button("clinical-workspace-privacy-show", "Mostra contenuti", theme, true, true)
                    .map(|el| self.privacy_commands[1].attach(el))
                    .debug_selector(|| "clinical-workspace-privacy-show".into())
                    .on_click(cx.listener(|this, _, _, cx| this.change_local_preference(PreferenceChange::Privacy(false), cx))))
                .when(self.session.is_some(), |el| el.child(
                    button("clinical-workspace-privacy-lock", "Blocca l’accesso", theme, false, true)
                        .map(|el| self.privacy_commands[2].attach(el))
                        .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Lock, cx)))
                )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use local_preferences::tests::Fixture;
    use std::fs;

    #[gpui::test]
    fn local_settings_restart_restores_only_visual_preferences(cx: &mut gpui::TestAppContext) {
        let fixture = Fixture::new();
        let (view, cx) = cx.add_window_view(|window, cx| {
            ClinicalApp::with_local_preferences(String::new(), fixture.store(), window, cx)
        });
        view.update(cx, |app, cx| {
            for change in [
                PreferenceChange::Appearance(Some(true)),
                PreferenceChange::TextScale(2.),
                PreferenceChange::Contrast(true),
                PreferenceChange::Privacy(true),
            ] {
                app.change_local_preference(change, cx);
                assert!(app.preferences_issue.is_none());
            }
        });
        let before = fs::read(fixture.0.join("preferences.json")).unwrap();
        let restarted = cx.add_window(|window, cx| {
            ClinicalApp::with_local_preferences(String::new(), fixture.store(), window, cx)
        });
        restarted
            .update(cx, |app, _, _| {
                assert_eq!(app.dark_override, Some(true));
                assert_eq!(app.text_scale, 2.);
                assert!(app.dark && app.increased_contrast && app.privacy_shield);
                assert!(app.session.is_none());
                assert!(app.form.is_none());
                assert!(app.pairing.is_none());
            })
            .unwrap();
        assert_eq!(
            fs::read(fixture.0.join("preferences.json")).unwrap(),
            before,
            "opening an app never rewrites preferences"
        );
        let value: serde_json::Value = serde_json::from_slice(&before).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 5);
    }

    #[gpui::test]
    fn local_settings_system_choice_tracks_changes_without_saving_them(
        cx: &mut gpui::TestAppContext,
    ) {
        let fixture = Fixture::new();
        let (view, cx) = cx.add_window_view(|window, cx| {
            ClinicalApp::with_local_preferences(String::new(), fixture.store(), window, cx)
        });
        view.update(cx, |app, cx| {
            app.change_local_preference(PreferenceChange::Appearance(None), cx);
            let before = fs::read(fixture.0.join("preferences.json")).unwrap();
            for system_dark in [true, false, true] {
                app.apply_local_appearance(system_dark);
                assert_eq!(app.dark, system_dark);
                assert_eq!(
                    fs::read(fixture.0.join("preferences.json")).unwrap(),
                    before
                );
            }
            app.change_local_preference(PreferenceChange::Appearance(Some(false)), cx);
            app.apply_local_appearance(true);
            assert!(!app.dark);
            app.change_local_preference(PreferenceChange::Appearance(Some(true)), cx);
            app.apply_local_appearance(false);
            assert!(app.dark);
        });
    }

    #[gpui::test]
    fn local_settings_corrupt_file_covers_the_first_render_and_preserves_the_file(
        cx: &mut gpui::TestAppContext,
    ) {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        fs::write(fixture.0.join("preferences.json"), b"corrupted").unwrap();
        let (view, cx) = cx.add_window_view(|window, cx| {
            ClinicalApp::with_local_preferences(String::new(), fixture.store(), window, cx)
        });
        notes_recovery_tests::draw(cx);
        assert!(
            cx.debug_bounds("clinical-workspace-privacy-shield")
                .is_some()
        );
        view.read_with(cx, |app, _| {
            assert_eq!(app.preferences_issue, Some(PreferenceIssue::Read))
        });
        assert_eq!(
            fs::read(fixture.0.join("preferences.json")).unwrap(),
            b"corrupted"
        );
        let show = cx.debug_bounds("clinical-workspace-privacy-show").unwrap();
        cx.simulate_click(show.center(), gpui::Modifiers::default());
        notes_recovery_tests::draw(cx);
        view.read_with(cx, |app, _| {
            assert!(!app.privacy_shield);
            assert!(app.preferences_issue.is_none());
        });
        assert!(!fixture.store().load().1);
    }

    #[gpui::test]
    fn local_settings_failed_save_keeps_the_current_choice_and_draft_until_explicit_retry(
        cx: &mut gpui::TestAppContext,
    ) {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        fs::create_dir(fixture.0.join("preferences.json")).unwrap();
        let (view, cx) = cx.add_window_view(|window, cx| {
            ClinicalApp::with_local_preferences(String::new(), fixture.store(), window, cx)
        });
        view.update(cx, |app, cx| {
            let draft = super::super::tests::synthetic_notes_form(app, FormState::Draft, cx);
            app.change_local_preference(PreferenceChange::Appearance(Some(true)), cx);
            app.change_local_preference(PreferenceChange::Privacy(false), cx);
            assert_eq!(app.preferences_issue, Some(PreferenceIssue::Save));
            assert_eq!(app.dark_override, Some(true));
            assert!(!app.privacy_shield);
            assert_eq!(draft.read(cx).value(), "Bozza sintetica da ritirare");
            fs::remove_dir(fixture.0.join("preferences.json")).unwrap();
            app.save_local_preferences(cx);
            assert!(app.preferences_issue.is_none());
            assert_eq!(fixture.store().load(), (app.visual_preferences(), false));
            assert_eq!(draft.read(cx).value(), "Bozza sintetica da ritirare");
        });
    }

    #[gpui::test]
    fn local_settings_privacy_recovery_stays_reachable_at_390_and_400_percent(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(bind_keys);
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(390.), px(640.)));
        view.update(cx, |app, cx| {
            app.change_local_preference(PreferenceChange::TextScale(4.), cx);
            app.change_local_preference(PreferenceChange::Privacy(true), cx);
        });
        notes_recovery_tests::draw(cx);
        cx.simulate_keystrokes("tab");
        notes_recovery_tests::draw(cx);
        cx.update(|window, cx| assert!(view.read(cx).privacy_commands[1].focus.is_focused(window)));
        let show = cx.debug_bounds("clinical-workspace-privacy-show").unwrap();
        assert!(show.left() >= px(0.) && show.right() <= px(390.));
        assert!(
            show.top() >= px(0.) && show.bottom() <= px(640.),
            "show contents must scroll into view: {show:?}"
        );
        cx.simulate_click(show.center(), gpui::Modifiers::default());
        notes_recovery_tests::draw(cx);
        view.read_with(cx, |app, _| assert!(!app.privacy_shield));
    }

    #[gpui::test]
    fn local_settings_privacy_shortcut_removes_the_workspace_without_locking_or_losing_the_draft(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(|cx| {
            crate::text_input::bind_keys(cx);
            bind_keys(cx);
        });
        let host = notes_recovery_tests::Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.select_patient("patient-a", true, cx);
        });
        cx.run_until_parked();
        let draft = cx.update_window_entity(&view, |app, window, cx| {
            app.open_form(FormKind::Notes, window, cx);
            let editor = app.form.as_ref().unwrap().fields[0].editor.clone();
            editor.update(cx, |input, cx| {
                input.set_content("Appunto sintetico da conservare", cx);
                input.focus(window, cx);
            });
            editor
        });
        notes_recovery_tests::draw(cx);
        let requests = host.request_count();
        let modifier = if cfg!(target_os = "macos") {
            "cmd"
        } else {
            "ctrl"
        };
        cx.simulate_keystrokes(&format!("{modifier}-shift-p"));
        notes_recovery_tests::draw(cx);
        assert!(
            cx.debug_bounds("clinical-workspace-privacy-shield")
                .is_some()
        );
        assert!(cx.debug_bounds("threshold-bar").is_none());
        view.read_with(cx, |app, cx| {
            assert!(!app.session.as_ref().unwrap().is_locked());
            assert_eq!(draft.read(cx).value(), "Appunto sintetico da conservare");
            assert!(app.form.is_some());
        });
        assert_eq!(
            host.request_count(),
            requests,
            "covering does not send requests"
        );
        cx.simulate_keystrokes(&format!("{modifier}-shift-p"));
        notes_recovery_tests::draw(cx);
        assert!(
            cx.debug_bounds("clinical-workspace-privacy-shield")
                .is_none()
        );
        view.read_with(cx, |app, cx| {
            assert!(app.form.is_some());
            assert_eq!(draft.read(cx).value(), "Appunto sintetico da conservare");
        });
        cx.simulate_keystrokes(&format!("{modifier}-shift-p"));
        notes_recovery_tests::draw(cx);
        cx.simulate_keystrokes(&format!("{modifier}-l"));
        cx.run_until_parked();
        view.read_with(cx, |app, cx| {
            assert!(app.session.is_none());
            assert!(app.form.is_none());
            assert!(draft.read(cx).value().is_empty());
        });
    }
}
