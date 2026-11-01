use super::*;
use mediflow_runtime_client::{
    WorkProfile, WorkProfileAction, WorkProfileAnswers, WorkProfileDraft, WorkProfileSource,
    WorkProfileState,
};

#[derive(Default)]
pub(super) struct WorkProfileArea {
    pub(super) busy: bool,
    snapshot: Option<WorkProfileState>,
    draft: Option<WorkProfileDraft>,
    rollback_review: bool,
    message: Option<String>,
}
impl ClinicalApp {
    pub(in crate::shell) fn ensure_work_profile_loaded(&mut self, cx: &mut Context<Self>) {
        let area = &self.local_host.work_profile;
        if area.snapshot.is_none() && area.message.is_none() && !area.busy {
            self.read_work_profile(cx);
        }
    }

    pub(in crate::shell) fn read_work_profile(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.work_profile.message = None;
        self.local_host.work_profile.busy = true;
        self.run_local_host(
            move || access.read_work_profile(),
            |this, result, cx| {
                let area = &mut this.local_host.work_profile;
                area.busy = false;
                match result {
                    Ok(state) => {
                        if area.draft.is_none() {
                            area.draft = state.draft.clone();
                        }
                        area.snapshot = Some(state);
                        area.message = None;
                    }
                    Err(e) => {
                        area.snapshot = None;
                        area.message = Some(ui_error(e));
                    }
                }
                cx.notify();
            },
            cx,
        );
    }
    fn save_work_profile(&mut self, action: WorkProfileAction, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let (Some(access), Some(state)) = (
            self.local_host.access(),
            self.local_host.work_profile.snapshot.as_ref(),
        ) else {
            return;
        };
        if matches!(action, WorkProfileAction::Confirm)
            && self.local_host.work_profile.draft != state.draft
        {
            self.local_host.work_profile.message =
                Some("Salva e rileggi la bozza prima di confermare.".into());
            cx.notify();
            return;
        }
        if matches!(action, WorkProfileAction::Rollback)
            && !self.local_host.work_profile.rollback_review
        {
            return;
        }
        let draft = if matches!(action, WorkProfileAction::SaveDraft) {
            self.local_host.work_profile.draft.clone()
        } else {
            None
        };
        let command = match access.prepare_work_profile(state, action, draft) {
            Ok(command) => command,
            Err(e) => {
                self.local_host.work_profile.message = Some(ui_error(e));
                cx.notify();
                return;
            }
        };
        self.local_host.work_profile.message = None;
        self.local_host.work_profile.busy = true;
        self.run_local_host(move || access.write_work_profile(&command),|this,result,cx| {
            let area=&mut this.local_host.work_profile;
            area.busy=false;
            area.rollback_review=false;
            match result {
                Ok(write)=> {
                    let confirmed=matches!(&write.current,Ok(s) if *s==write.recorded);
                    area.message=Some(if confirmed {"Profilo di lavoro salvato e riletto.".into()} else {format!("Operazione registrata alla revisione {}. Lo stato corrente non è confermato: rileggi prima di una nuova operazione.",write.recorded.revision)});
                    if confirmed {area.draft=write.recorded.draft.clone();area.snapshot=Some(write.recorded);}
                    else {area.snapshot=None;}
                },
                Err(e)=> {area.snapshot=None;area.message=Some(format!("{} La bozza locale è conservata. Rileggi prima di riprovare.",ui_error(e)));}
            }
            cx.notify();
        },cx);
    }
    pub(in crate::shell) fn work_profile_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.work_profile;
        let enabled = self.local_host.access().is_some() && !self.local_host.has_work();
        let mut pane=div().min_w_0().flex().flex_col().gap(px(12.))
            .child(section("work-profile-title","Profilo di lavoro",theme))
            .child(text!("Scegli come lavorare con MediFlow. La scelta non installa applicazioni, non collega agenti e non cambia le autorizzazioni."))
            .child(self.local_host_panel(cx))
            .child(button("work-profile-read","Rileggi il profilo di lavoro",theme,false,enabled).on_click(cx.listener(|this,_,_,cx|this.read_work_profile(cx))));
        if area.busy {
            pane = pane.child(notice(
                "work-profile-busy",
                "Lettura o salvataggio in corso…",
                theme,
                false,
            ));
        }
        if let Some(message) = &area.message {
            pane = pane.child(notice("work-profile-result", message.clone(), theme, false));
        }
        let Some(state) = &area.snapshot else {
            return pane.child(text!(if area.busy {
                "Lettura o salvataggio in corso…"
            } else {
                "Profilo di lavoro non ancora letto."
            }));
        };
        pane = pane.child(governance::fact(
            "Profilo attivo",
            state
                .active
                .as_ref()
                .map(|s| s.profile.label())
                .unwrap_or("Nessun profilo scelto"),
            theme,
        ));
        for (id, title, source) in [
            (
                "work-profile-guide",
                "Inizia la guida",
                WorkProfileSource::Guided,
            ),
            (
                "work-profile-manual",
                "Scegli manualmente",
                WorkProfileSource::Manual,
            ),
        ] {
            pane = pane.child(
                button(id, title, theme, false, enabled).on_click(cx.listener(
                    move |this, _, _, cx| {
                        if this.local_host.has_work() {
                            return;
                        }
                        this.local_host.work_profile.draft = Some(WorkProfileDraft {
                            profile: WorkProfile::Interactive,
                            source,
                            answers: WorkProfileAnswers::default(),
                            step: if source == WorkProfileSource::Manual {
                                3
                            } else {
                                0
                            },
                        });
                        cx.notify();
                    },
                )),
            );
        }
        if let Some(draft) = &area.draft {
            let mut editor = div()
                .id("work-profile-editor")
                .flex()
                .flex_col()
                .gap(px(8.));
            if draft.source == WorkProfileSource::Guided && draft.step < 3 {
                for (group, title, choices) in [
                    (
                        0,
                        "Attività prevalente",
                        vec![
                            ("records", "Cartelle cliniche"),
                            ("organization", "Organizzazione"),
                            ("repetitive", "Attività ripetitive"),
                        ],
                    ),
                    (
                        1,
                        "Come preferisci lavorare",
                        vec![
                            ("screens", "Schermate"),
                            ("delegate", "Con un agente"),
                            ("mixed", "Entrambi"),
                            ("unsure", "Da decidere"),
                        ],
                    ),
                    (
                        2,
                        "Sistema in uso",
                        vec![
                            ("macos", "macOS"),
                            ("windows", "Windows"),
                            ("linux", "Linux"),
                            ("other", "Altro"),
                        ],
                    ),
                ] {
                    let mut question = div()
                        .id(format!("work-profile-question-{group}"))
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child(text!(title));
                    for (value, title) in choices {
                        let selected = match group {
                            0 => draft.answers.activity.as_deref(),
                            1 => draft.answers.interaction.as_deref(),
                            _ => draft.answers.platform.as_deref(),
                        } == Some(value);
                        question = question.child(
                            button(
                                format!("work-profile-answer-{value}"),
                                if selected {
                                    format!("✓ {title}")
                                } else {
                                    title.into()
                                },
                                theme,
                                selected,
                                enabled,
                            )
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    if this.local_host.has_work() {
                                        return;
                                    }
                                    if let Some(d) = &mut this.local_host.work_profile.draft {
                                        let field = match group {
                                            0 => &mut d.answers.activity,
                                            1 => &mut d.answers.interaction,
                                            _ => &mut d.answers.platform,
                                        };
                                        *field = Some(value.into());
                                    }
                                    cx.notify();
                                },
                            )),
                        );
                    }
                    editor = editor.child(question);
                }
                editor = editor.child(
                    button(
                        "work-profile-preview",
                        "Mostra anteprima",
                        theme,
                        false,
                        enabled && draft.answers.complete(),
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.local_host.has_work() {
                            return;
                        }
                        if let Some(d) = &mut this.local_host.work_profile.draft {
                            d.profile = d.answers.recommended();
                            d.step = 3;
                        }
                        cx.notify();
                    })),
                );
            } else {
                editor = editor.child(section(
                    "work-profile-preview-title",
                    "Anteprima della scelta",
                    theme,
                ));
                for profile in [
                    WorkProfile::Interactive,
                    WorkProfile::Agent,
                    WorkProfile::Both,
                ] {
                    editor = editor.child(
                        button(
                            format!("work-profile-choice-{}", profile.label()),
                            profile.label(),
                            theme,
                            draft.profile == profile,
                            enabled,
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if this.local_host.has_work() {
                                return;
                            }
                            if let Some(d) = &mut this.local_host.work_profile.draft {
                                d.profile = profile;
                            }
                            cx.notify();
                        })),
                    );
                }
                editor=editor.child(governance::fact("Area iniziale della cartella Web",draft.start_area(),theme))
                    .child(text!("La scelta precedente sarà conservata per il ripristino. Il collegamento a un agente resta separato."));
            }
            let saved = state.draft.as_ref() == Some(draft);
            editor = editor
                .child(text!(if saved {
                    "Bozza salvata sulla postazione."
                } else {
                    "Bozza locale non ancora salvata."
                }))
                .child(
                    button(
                        "work-profile-save-draft",
                        "Salva la bozza",
                        theme,
                        false,
                        enabled && !saved,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.local_host.has_work() {
                            return;
                        }
                        this.save_work_profile(WorkProfileAction::SaveDraft, cx)
                    })),
                )
                .child(
                    button(
                        "work-profile-confirm",
                        "Conferma il profilo di lavoro",
                        theme,
                        true,
                        enabled && saved && draft.can_confirm(),
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.local_host.has_work() {
                            return;
                        }
                        this.save_work_profile(WorkProfileAction::Confirm, cx)
                    })),
                )
                .child(
                    button(
                        "work-profile-discard",
                        "Scarta la bozza",
                        theme,
                        false,
                        enabled,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.local_host.has_work() {
                            return;
                        }
                        this.save_work_profile(WorkProfileAction::DiscardDraft, cx)
                    })),
                );
            pane = pane.child(editor);
        }
        if state.can_rollback {
            if area.rollback_review {
                pane = pane
                    .child(governance::fact(
                        "Ripristino previsto",
                        state
                            .previous
                            .as_ref()
                            .map(|s| s.profile.label())
                            .unwrap_or("Nessun profilo scelto"),
                        theme,
                    ))
                    .child(text!("Il ripristino scarterà anche la bozza corrente."))
                    .child(
                        button(
                            "work-profile-rollback-confirm",
                            "Conferma ripristino del profilo",
                            theme,
                            true,
                            enabled,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            if this.local_host.has_work() {
                                return;
                            }
                            this.save_work_profile(WorkProfileAction::Rollback, cx)
                        })),
                    )
                    .child(
                        button(
                            "work-profile-rollback-cancel",
                            "Annulla ripristino",
                            theme,
                            false,
                            enabled,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            if this.local_host.has_work() {
                                return;
                            }
                            this.local_host.work_profile.rollback_review = false;
                            cx.notify();
                        })),
                    );
            } else {
                pane = pane.child(
                    button(
                        "work-profile-rollback",
                        "Ripristina la scelta precedente",
                        theme,
                        false,
                        enabled,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.local_host.has_work() {
                            return;
                        }
                        this.local_host.work_profile.rollback_review = true;
                        cx.notify();
                    })),
                );
            }
        }
        pane
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn page_drafts_survive_patient_navigation_and_clinical_threshold(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(bind_keys);
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    RetirementNotice::new(None),
                )
                .unwrap(),
        );
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../transport/tests/fixtures/work-profile.json"
        ))
        .unwrap();
        let initial: WorkProfileState = serde_json::from_value(fixture["initial"].clone()).unwrap();
        let draft = WorkProfileDraft {
            profile: WorkProfile::Agent,
            source: WorkProfileSource::Manual,
            answers: WorkProfileAnswers::default(),
            step: 3,
        };
        let document = Arc::new(
            access
                .prepare_prosthetics_document(
                    "source-synthetic",
                    &"a".repeat(64),
                    "originale-sintetico.txt",
                    b"Synthetic reference only",
                    None,
                )
                .unwrap(),
        );
        for case in [
            "work-profile",
            "prosthetics-document",
            "reference-preview",
            "who-consent",
            "who-rollback",
        ] {
            let (view, cx) =
                cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
            view.update(cx, |app, cx| {
                app.session = Some(host.session.clone());
                app.scope = Some("scope-a".into());
                app.area = Area::Settings;
                app.settings_page = if case == "work-profile" {
                    SettingsPage::Profile
                } else {
                    SettingsPage::References
                };
                app.local_host.authority = Authority::Open(access.clone());
                match case {
                    "work-profile" => {
                        app.local_host.work_profile.snapshot = Some(initial.clone());
                        app.local_host.work_profile.draft = Some(draft.clone());
                    }
                    "prosthetics-document" => {
                        app.local_host.references.document = Some(document.clone())
                    }
                    "reference-preview" => {
                        app.local_host.references.preview =
                            Some(Arc::new(access.prepare_aifa_update().unwrap()))
                    }
                    "who-consent" => app.local_host.references.who_consent = true,
                    "who-rollback" => {
                        let f: serde_json::Value = serde_json::from_str(include_str!(
                            "../../../../transport/tests/fixtures/who-administration.json"
                        ))
                        .unwrap();
                        app.local_host.who_administration.rollback = Some(Arc::new(
                            access
                                .prepare_who_rollback(&mediflow_runtime_client::ReferenceStatus {
                                    catalog: mediflow_runtime_client::ReferenceCatalog::Who,
                                    data: f["before"].clone(),
                                    sources: None,
                                })
                                .unwrap(),
                        ));
                    }
                    _ => unreachable!(),
                }
                app.navigate(Area::Patients, cx);
                assert_eq!(app.area, Area::Patients, "{case}");
                app.select_patient("patient-a", true, cx);
            });
            cx.run_until_parked();
            cx.update_window_entity(&view, |app, window, cx| {
                app.open_form(FormKind::Notes, window, cx)
            });
            let ids = rendered_command::button_ids(|| notes_recovery_tests::draw(cx));
            assert!(
                ids.contains(&"clinical-workspace-review-save".to_owned()),
                "{case}"
            );
            cx.update_window_entity(&view, |app, window, cx| {
                let editor = app.form.as_ref().unwrap().fields[0].editor.clone();
                editor.update(cx, |input, cx| input.focus_and_select(window, cx));
            });
            cx.simulate_input("Bozza clinica inventata");
            cx.run_until_parked();
            cx.update_window_entity(&view, |app, window, cx| app.review_form(window, cx));
            notes_recovery_tests::draw(cx);
            view.read_with(cx, |app, _| {
                assert!(
                    app.form.as_ref().unwrap().state == FormState::Review,
                    "{case}"
                )
            });
            cx.simulate_keystrokes("escape");
            notes_recovery_tests::draw(cx);
            view.read_with(cx, |app, _| {
                assert!(
                    app.form.as_ref().unwrap().state == FormState::Draft,
                    "{case}"
                )
            });
            host.plan("GET /api/auth/profile").send((200,serde_json::json!({"operation":"account-profile.read.v1","contractVersion":1,"userId":"synthetic-user","username":"synthetic","displayName":"Medico inventato","ambulatoryName":"Studio sintetico","profileVersion":"p1:synthetic","archiveGeneration":"synthetic-generation"}))).unwrap();
            host.plan("GET /api/v1/network/ai-runtime")
                .send((404, serde_json::json!({})))
                .unwrap();
            view.update(cx, |app, cx| {
                assert!(app.form.as_ref().unwrap().kind == FormKind::Notes, "{case}");
                app.finish_discard(Discard::Form, cx);
                app.navigate(Area::Settings, cx);
                assert_eq!(app.area, Area::Settings, "{case}");
                match case {
                    "work-profile" => {
                        assert_eq!(app.local_host.work_profile.draft.as_ref(), Some(&draft))
                    }
                    "prosthetics-document" => assert!(Arc::ptr_eq(
                        app.local_host.references.document.as_ref().unwrap(),
                        &document
                    )),
                    "reference-preview" => assert!(app.local_host.references.preview.is_some()),
                    "who-consent" => assert!(app.local_host.references.who_consent),
                    "who-rollback" => assert!(app.local_host.who_administration.rollback.is_some()),
                    _ => unreachable!(),
                }
            });
            notes_recovery_tests::draw(cx);
        }
        assert!(
            !host.routes().iter().any(
                |route| route.starts_with("PUT ") || route.starts_with("POST /api/prosthetics")
            )
        );
    }
    #[gpui::test]
    fn work_profile_draws_persisted_preview_and_guards_unsaved_confirmation_and_lock(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    RetirementNotice::new(None),
                )
                .unwrap(),
        );
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../transport/tests/fixtures/work-profile.json"
        ))
        .unwrap();
        let snapshot: WorkProfileState =
            serde_json::from_value(fixture["steps"][1]["state"].clone()).unwrap();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Profile;
            app.local_host.authority = Authority::Open(access);
            app.local_host.work_profile.draft = snapshot.draft.clone();
            app.local_host.work_profile.snapshot = Some(snapshot);
        });
        let ids = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert!(ids.contains(&"work-profile-confirm".to_owned()));
        assert!(ids.contains(&"work-profile-discard".to_owned()));
        view.update(cx, |app, cx| {
            app.local_host.work_profile.draft.as_mut().unwrap().profile = WorkProfile::Agent;
            app.save_work_profile(WorkProfileAction::Confirm, cx);
            assert!(!app.local_host.work_profile.busy);
            assert!(app.local_host.work_profile.message.is_some());
            assert_ne!(
                app.local_host.work_profile.draft,
                app.local_host.work_profile.snapshot.as_ref().unwrap().draft
            );
            app.withdraw_local_host(cx);
            assert!(app.local_host.work_profile.draft.is_none());
            assert!(app.local_host.work_profile.snapshot.is_none());
        });
    }
}
