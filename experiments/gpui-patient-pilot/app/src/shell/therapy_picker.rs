//! A catalog choice belongs to one therapy draft. Query revisions and the
//! editor identity reject old results without invalidating the record's read.

use super::*;
use crate::theme::TypeStyle;
use gpui::EntityId;

struct DrugChoice {
    item: DrugCatalogItem,
    previous_name: String,
}

#[derive(Clone, Copy)]
struct SearchToken {
    authority: u64,
    editor: EntityId,
    revision: u64,
    epoch: u64,
}

struct DrugSearch {
    field: Field,
    revision: u64,
    query: String,
    rows: Load<Vec<DrugCatalogItem>>,
    run: ScrollTarget,
    cancel: ScrollTarget,
    results: Vec<ScrollTarget>,
    focus_pending: bool,
    _subscription: Subscription,
}

impl DrugSearch {
    fn new(name: &str, theme: Theme, scroll: &ScrollHandle, cx: &mut Context<ClinicalApp>) -> Self {
        let field = Field::new(
            "clinical-workspace-drug-query",
            "Nome, principio attivo o AIC",
            name,
            false,
            false,
            theme,
            cx,
        )
        .with_scroll(scroll, cx);
        let subscription = cx.subscribe(&field.editor, |this, editor, _: &InputChanged, cx| {
            this.drug_query_changed(editor.entity_id());
            cx.notify();
        });
        Self {
            field,
            revision: 0,
            query: String::new(),
            rows: Load::Idle,
            run: ScrollTarget::new(scroll, cx),
            cancel: ScrollTarget::new(scroll, cx),
            results: vec![],
            focus_pending: true,
            _subscription: subscription,
        }
    }
}

pub(super) struct TherapySelection {
    choice: Option<DrugChoice>,
    search: Option<DrugSearch>,
    open: ScrollTarget,
    undo: ScrollTarget,
    initial_focus: bool,
}

impl TherapySelection {
    pub(super) fn new(scroll: &ScrollHandle, cx: &App) -> Self {
        Self {
            choice: None,
            search: None,
            open: ScrollTarget::new(scroll, cx),
            undo: ScrollTarget::new(scroll, cx),
            initial_focus: true,
        }
    }

    pub(super) fn selected(&self) -> Option<&DrugCatalogItem> {
        self.choice.as_ref().map(|choice| &choice.item)
    }

    pub(super) fn focus_initial(&mut self, window: &mut Window, cx: &mut App) -> bool {
        if !std::mem::take(&mut self.initial_focus) {
            return false;
        }
        window.focus(&self.open.focus, cx);
        self.open.scroll_to(window, cx);
        true
    }

    pub(super) fn retire(&self, cx: &mut App) {
        if let Some(search) = &self.search {
            search.field.editor.update(cx, |input, cx| input.retire(cx));
        }
    }

    pub(super) fn prepare_render(
        &mut self,
        theme: Theme,
        enabled: bool,
        window: &mut Window,
        cx: &mut App,
    ) {
        if let Some(search) = &mut self.search {
            search
                .field
                .editor
                .update(cx, |input, cx| input.configure(theme, !enabled, cx));
            if enabled && std::mem::take(&mut search.focus_pending) {
                search
                    .field
                    .editor
                    .update(cx, |input, cx| input.focus_and_select(window, cx));
                if let Some(target) = &search.field.scroll_target {
                    target.scroll_to(window, cx);
                }
            }
        }
    }

    pub(super) fn reveal_if_focused(&self, window: &mut Window, cx: &mut App) -> bool {
        if let Some(search) = &self.search {
            search
                .field
                .scroll_target
                .as_ref()
                .is_some_and(|target| target.reveal_if_focused(window, cx))
                || search.run.reveal_if_focused(window, cx)
                || search.cancel.reveal_if_focused(window, cx)
                || search
                    .results
                    .iter()
                    .any(|target| target.reveal_if_focused(window, cx))
        } else {
            self.open.reveal_if_focused(window, cx) || self.undo.reveal_if_focused(window, cx)
        }
    }
}

impl ClinicalApp {
    pub(super) fn close_drug_search(&mut self, cx: &mut App) -> bool {
        let search = self
            .form
            .as_mut()
            .and_then(|form| form.therapy.as_mut())
            .and_then(|therapy| therapy.search.take());
        if let Some(search) = search {
            search.field.editor.update(cx, |input, cx| input.retire(cx));
            true
        } else {
            false
        }
    }

    fn open_drug_search(&mut self, cx: &mut Context<Self>) {
        let Some(form) = &self.form else {
            return;
        };
        if form.state != FormState::Draft
            || self.discard.is_some()
            || self.session.is_none()
            || form
                .therapy
                .as_ref()
                .is_none_or(|therapy| therapy.search.is_some())
        {
            return;
        }
        let name = form.fields[0].value(cx);
        let search = DrugSearch::new(&name, self.theme, &self.profile_scroll, cx);
        self.form
            .as_mut()
            .and_then(|form| form.therapy.as_mut())
            .expect("therapy draft")
            .search = Some(search);
        self.message = None;
        cx.notify();
    }

    fn drug_query_changed(&mut self, editor: EntityId) {
        if let Some(search) = self
            .form
            .as_mut()
            .and_then(|form| form.therapy.as_mut())
            .and_then(|therapy| therapy.search.as_mut())
            .filter(|search| search.field.editor.entity_id() == editor)
        {
            search.revision = search
                .revision
                .checked_add(1)
                .expect("drug query revision exhausted");
            search.query.clear();
            search.rows = Load::Idle;
            search.results.clear();
        }
    }

    fn drug_search_current(&self, token: SearchToken, cx: &App) -> bool {
        self.account_profile.generation == token.authority
            && self.epoch == token.epoch
            && self.form.as_ref().is_some_and(|form| {
                form.state == FormState::Draft
                    && form
                        .therapy
                        .as_ref()
                        .and_then(|therapy| therapy.search.as_ref())
                        .is_some_and(|search| {
                            search.field.editor.entity_id() == token.editor
                                && search.revision == token.revision
                                && search.field.value(cx).trim() == search.query
                        })
            })
    }

    fn search_drug_catalog(&mut self, cx: &mut Context<Self>) {
        if self.discard.is_some() {
            return;
        }
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            return;
        };
        let Some(search) = self
            .form
            .as_mut()
            .filter(|form| form.state == FormState::Draft)
            .and_then(|form| form.therapy.as_mut())
            .and_then(|therapy| therapy.search.as_mut())
        else {
            return;
        };
        if matches!(search.rows, Load::Loading) {
            return;
        }
        search.revision = search
            .revision
            .checked_add(1)
            .expect("drug query revision exhausted");
        search.query = search.field.value(cx).trim().to_owned();
        search.results.clear();
        if search.query.is_empty() {
            search.rows = Load::Idle;
            cx.notify();
            return;
        }
        search.rows = Load::Loading;
        let token = SearchToken {
            authority: self.account_profile.generation,
            editor: search.field.editor.entity_id(),
            revision: search.revision,
            epoch: self.epoch,
        };
        let query = search.query.clone();
        let task = cx
            .background_executor()
            .spawn(async move { session.search_drugs(&scope, &query, 50) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                this.receive_drug_results(token, result, cx);
            });
        })
        .detach();
        cx.notify();
    }

    fn receive_drug_results(
        &mut self,
        token: SearchToken,
        result: Result<Vec<DrugCatalogItem>, RuntimeError>,
        cx: &mut Context<Self>,
    ) -> bool {
        match self.check_callback(token.authority, result.as_ref().err().copied(), cx) {
            CallbackState::StaleAuthority => return false,
            CallbackState::Retired => return true,
            CallbackState::Current => {}
        }
        if !self.drug_search_current(token, cx) {
            return false;
        }
        let search = self
            .form
            .as_mut()
            .and_then(|form| form.therapy.as_mut())
            .and_then(|therapy| therapy.search.as_mut())
            .expect("current drug search");
        search.results = (0..result.as_ref().map_or(0, Vec::len))
            .map(|_| ScrollTarget::new(&self.profile_scroll, cx))
            .collect();
        search.rows = Load::from_result(result);
        cx.notify();
        true
    }

    fn choose_drug(&mut self, token: SearchToken, index: usize, cx: &mut Context<Self>) {
        if self.discard.is_some() || !self.drug_search_current(token, cx) {
            return;
        }
        let Some(drug) = self
            .form
            .as_ref()
            .and_then(|form| form.therapy.as_ref())
            .and_then(|therapy| therapy.search.as_ref())
            .and_then(|search| search.rows.ready())
            .and_then(|rows| rows.get(index))
            .cloned()
        else {
            return;
        };
        if let Err(error) = editing::validate_drug_choice(&drug.name, &drug) {
            self.message = Some((error, true));
            cx.notify();
            return;
        }
        let form = self.form.as_mut().expect("current therapy draft");
        let therapy = form.therapy.as_mut().expect("therapy selection");
        let previous_name = therapy
            .choice
            .as_ref()
            .map(|choice| choice.previous_name.clone())
            .unwrap_or_else(|| form.fields[0].value(cx));
        // One synchronous state update changes the name and all catalog codes.
        // The original record remains untouched for CAS and for undoing choice.
        form.fields[0]
            .editor
            .update(cx, |input, cx| input.set_content(drug.name.clone(), cx));
        form.fields[0].read_only = true;
        therapy.choice = Some(DrugChoice {
            item: drug,
            previous_name,
        });
        self.close_drug_search(cx);
        self.verified = None;
        self.message = None;
        self.focus_after_render = true;
        self.focus_first_field = true;
        cx.notify();
    }

    fn undo_drug_choice(&mut self, cx: &mut Context<Self>) {
        if self.discard.is_some()
            || self
                .form
                .as_ref()
                .is_none_or(|form| form.state != FormState::Draft)
        {
            return;
        }
        self.close_drug_search(cx);
        let Some(form) = &mut self.form else {
            return;
        };
        let Some(choice) = form
            .therapy
            .as_mut()
            .and_then(|therapy| therapy.choice.take())
        else {
            return;
        };
        form.fields[0]
            .editor
            .update(cx, |input, cx| input.set_content(choice.previous_name, cx));
        form.fields[0].read_only = form
            .edit
            .as_ref()
            .is_some_and(|record| record.fields()[0].rich);
        self.verified = None;
        self.message = None;
        self.focus_after_render = true;
        self.focus_first_field = true;
        cx.notify();
    }

    pub(super) fn therapy_picker_view(&self, cx: &Context<Self>) -> Div {
        let Some(form) = &self.form else {
            return div();
        };
        let Some(therapy) = &form.therapy else {
            return div();
        };
        let theme = self.theme;
        let enabled = form.state == FormState::Draft && self.discard.is_none();
        let mut pane = div().min_w_0().max_w_full().flex().flex_col().gap(px(12.));
        if let Some(choice) = &therapy.choice {
            pane = pane
                .child(section(
                    "clinical-workspace-chosen-drug-heading",
                    "FARMACO SCELTO",
                    theme,
                ))
                .child(crate::references::drug_description(&choice.item, theme));
        } else if let Some(editing::Record::Therapy(row)) = &form.edit
            && form.fields[0].read_only
        {
            pane = pane
                .child(section(
                    "clinical-workspace-recorded-drug-heading",
                    "FARMACO REGISTRATO",
                    theme,
                ))
                .child(crate::references::drug_identity(
                    &row.drug_name,
                    row.aic.as_deref(),
                    row.atc.as_deref(),
                    row.active_principle.as_deref(),
                    theme,
                ));
        }
        if form.state != FormState::Draft {
            return pane;
        }
        let Some(search) = &therapy.search else {
            return pane.child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        therapy
                            .open
                            .attach_enabled(
                                button(
                                    "clinical-workspace-choose-drug",
                                    "Scegli dal repertorio…",
                                    theme,
                                    false,
                                    enabled,
                                ),
                                enabled,
                            )
                            .when(enabled, |el| {
                                el.on_click(cx.listener(|this, _, _, cx| this.open_drug_search(cx)))
                            }),
                    )
                    .when(therapy.choice.is_some(), |el| {
                        el.child(
                            therapy
                                .undo
                                .attach_enabled(
                                    button(
                                        "clinical-workspace-undo-drug-choice",
                                        "Annulla scelta del farmaco",
                                        theme,
                                        false,
                                        enabled,
                                    ),
                                    enabled,
                                )
                                .when(enabled, |el| {
                                    el.on_click(
                                        cx.listener(|this, _, _, cx| this.undo_drug_choice(cx)),
                                    )
                                }),
                        )
                    }),
            );
        };
        let token = SearchToken {
            authority: self.account_profile.generation,
            editor: search.field.editor.entity_id(),
            revision: search.revision,
            epoch: self.epoch,
        };
        let can_search = enabled && !matches!(search.rows, Load::Loading);
        pane = pane.child(section("clinical-workspace-drug-search-heading", "CERCA NEL REPERTORIO", theme))
            .child(self.field_view(&search.field, "clinical-workspace-drug-query-field", cx))
            .child(div().flex().flex_wrap().gap(px(8.))
                .child(search.run.attach_enabled(button("clinical-workspace-drug-search", "Cerca", theme, true, can_search), can_search)
                    .when(can_search, |el| el.on_click(cx.listener(|this, _, _, cx| this.search_drug_catalog(cx)))))
                .child(search.cancel.attach_enabled(button("clinical-workspace-cancel-drug-search", "Chiudi ricerca", theme, false, enabled), enabled)
                    .when(enabled, |el| el.on_click(cx.listener(|this, _, _, cx| {
                        this.close_drug_search(cx); this.focus_after_render = true; this.focus_first_field = true; cx.notify();
                    })))))
            .child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
                .child(text!("La scelta aggiorna soltanto il farmaco nella bozza. Controlla confezione e dose prima di registrare.")));
        match &search.rows {
            Load::Idle => pane.child(notice("clinical-workspace-drug-search-state", "Inserisci nome, principio attivo o AIC e premi Cerca.", theme, false)),
            Load::Loading => pane.child(notice("clinical-workspace-drug-search-state", "Ricerca nel repertorio dell'archivio…", theme, false)),
            Load::Failed(message) => pane.child(notice("clinical-workspace-drug-search-state", format!("{message} La terapia in bozza non è cambiata. Puoi riprovare o chiudere la ricerca."), theme, true)),
            Load::Ready(rows) => pane
                .when(rows.is_empty(), |el| el.child(notice("clinical-workspace-drug-search-state", "Nessun farmaco trovato. Modifica la ricerca o chiudila per conservare il farmaco della bozza.", theme, false)))
                .children(rows.iter().enumerate().map(|(index, drug)| {
                    div().id(SharedString::from(format!("clinical-workspace-drug-result-{}", drug.aic)))
                        .min_w_0().max_w_full().border_b_1().border_color(theme.rule).py(px(12.)).flex().flex_col().gap(px(12.))
                        .child(crate::references::drug_description(drug, theme))
                        .child(search.results[index].attach_enabled(button(format!("clinical-workspace-select-drug-{index}"), format!("Usa {} · AIC {}", drug.name, drug.aic), theme, false, enabled), enabled)
                            .when(enabled, |el| el.on_click(cx.listener(move |this, _, _, cx| this.choose_drug(token, index, cx)))))
                }))
                .when(rows.len() == 50, |el| el.child(notice("clinical-workspace-drug-results-limit", "Sono mostrati i primi 50 risultati. Precisa la ricerca per trovare altre confezioni.", theme, false))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recorded_therapy(coded: bool) -> Therapy {
        serde_json::from_value(serde_json::json!({
            "id":"synthetic-therapy", "patientId":"synthetic-patient", "version":3,
            "drugName":"Terapia precedente", "aic": if coded { Some("000111111") } else { None },
            "atc": if coded { Some("SYN-OLD") } else { None },
            "activePrinciple": if coded { Some("Principio precedente") } else { None },
            "dosage":"Dose invariata", "status":"active", "startDate":"2026-10-17T00:00:00Z",
            "motivation":"Motivo riportato"
        }))
        .unwrap()
    }

    fn catalog_drug() -> DrugCatalogItem {
        serde_json::from_value(serde_json::json!({
            "name":"Farmaco sintetico scelto", "aic":"000222222", "atc":"SYN-NEW",
            "activePrinciple":"Principio scelto", "packaging":"Confezione sintetica"
        }))
        .unwrap()
    }

    fn stage(app: &mut ClinicalApp, coded: bool, cx: &mut Context<ClinicalApp>) {
        app.retire_form(cx);
        let record = editing::Record::Therapy(recorded_therapy(coded));
        app.stage_fields(FormKind::Therapy, record.fields(), Some(record), cx);
    }

    fn pending(
        app: &mut ClinicalApp,
        cx: &mut Context<ClinicalApp>,
    ) -> (SearchToken, Entity<TextInput>) {
        app.close_drug_search(cx);
        let name = app.form.as_ref().unwrap().fields[0].value(cx);
        let mut search = DrugSearch::new(&name, app.theme, &app.profile_scroll, cx);
        search.query = name.trim().to_owned();
        search.rows = Load::Loading;
        let editor = search.field.editor.clone();
        let token = SearchToken {
            authority: app.account_profile.generation,
            editor: editor.entity_id(),
            revision: search.revision,
            epoch: app.epoch,
        };
        app.form.as_mut().unwrap().therapy.as_mut().unwrap().search = Some(search);
        (token, editor)
    }

    fn callback_restore(cx: &mut gpui::TestAppContext, stale_query: bool, retained_reason: bool) {
        let host = crate::shell::notes_recovery_tests::Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let (token, editor) = view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            stage(app, true, cx);
            let (token, editor) = pending(app, cx);
            if !retained_reason {
                app.form
                    .as_mut()
                    .unwrap()
                    .therapy
                    .as_mut()
                    .unwrap()
                    .search
                    .as_mut()
                    .unwrap()
                    .rows = Load::Idle;
                host.replace_archive();
                app.search_drug_catalog(cx);
            }
            if stale_query {
                editor.update(cx, |input, cx| input.set_content("Ricerca successiva", cx));
                app.drug_query_changed(editor.entity_id());
            }
            (token, editor)
        });
        if retained_reason {
            host.replace_archive();
            assert_eq!(
                host.session
                    .search_drugs("scope-a", "synthetic", 50)
                    .map(|_| ()),
                Err(RuntimeError::ArchiveReplaced)
            );
            view.update(cx, |app, cx| {
                app.receive_drug_results(token, Err(RuntimeError::Transport), cx);
            });
        }
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(
                app.session.is_none(),
                "drug callback lost current-authority restore"
            );
            assert!(app.form.is_none());
            assert!(app.scope.is_none());
            assert!(app.selected_id.is_none());
            assert!(
                app.message
                    .as_ref()
                    .unwrap()
                    .0
                    .contains(&ui_error(RuntimeError::ArchiveReplaced))
            );
        });
        editor.read_with(cx, |input, _| {
            assert!(input.value().is_empty());
            assert!(input.read_only);
        });
        let requests = host.request_count();
        assert_eq!(
            host.session
                .update_patient_notes("scope-a", "patient-a", 1, "late write"),
            Err(RuntimeError::Locked)
        );
        assert_eq!(host.request_count(), requests);
    }

    #[gpui::test]
    fn g1a2_r2_drug_current_callback_retires_restore(cx: &mut gpui::TestAppContext) {
        callback_restore(cx, false, false);
    }

    #[gpui::test]
    fn g1a2_r2_drug_old_query_same_authority_retires_restore(cx: &mut gpui::TestAppContext) {
        callback_restore(cx, true, false);
    }

    #[gpui::test]
    fn g1a2_r2_drug_old_query_consumes_retained_retirement_reason(cx: &mut gpui::TestAppContext) {
        callback_restore(cx, true, true);
    }

    #[gpui::test]
    fn g1a2_r2_drug_old_authority_preserves_new_session_and_draft(cx: &mut gpui::TestAppContext) {
        let old = crate::shell::notes_recovery_tests::Host::new();
        let fresh = crate::shell::notes_recovery_tests::Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let old_token = view.update(cx, |app, cx| {
            app.session = Some(old.session.clone());
            app.scope = Some("scope-a".into());
            stage(app, true, cx);
            let (token, _) = pending(app, cx);
            app.disconnect(cx);
            app.session = Some(fresh.session.clone());
            app.message = None;
            app.scope = Some("scope-a".into());
            stage(app, false, cx);
            app.form.as_ref().unwrap().fields[0]
                .editor
                .update(cx, |input, cx| {
                    input.set_content("  Preparazione manuale annotata  ", cx)
                });
            pending(app, cx);
            token
        });
        view.update(cx, |app, cx| {
            assert!(!app.receive_drug_results(old_token, Err(RuntimeError::ArchiveReplaced), cx));
            assert!(
                app.session
                    .as_ref()
                    .is_some_and(|session| !session.is_locked())
            );
            assert!(app.form.is_some());
            assert!(app.message.is_none());
            assert_eq!(
                app.form.as_ref().unwrap().fields[0].value(cx),
                "  Preparazione manuale annotata  "
            );
        });
        cx.run_until_parked();
        let requests = old.request_count();
        assert_eq!(
            old.session
                .update_patient_notes("scope-a", "patient-a", 1, "late write"),
            Err(RuntimeError::Locked)
        );
        assert_eq!(old.request_count(), requests);
        assert!(
            fresh
                .session
                .can_write("network.replica.write-patient-profile")
        );
    }

    #[gpui::test]
    fn g1a2_restore_retires_nested_therapy_search_and_late_results(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let (token, editor) = view.update(cx, |app, cx| {
            stage(app, true, cx);
            let pending = pending(app, cx);
            app.save_error(RuntimeError::ArchiveReplaced, cx);
            assert!(
                app.form.is_none(),
                "restore retained therapy form and nested picker"
            );
            pending
        });
        editor.read_with(cx, |input, _| {
            assert!(input.value().is_empty());
            assert!(input.read_only);
        });
        view.update(cx, |app, cx| {
            stage(app, false, cx);
            app.receive_drug_results(token, Ok(vec![catalog_drug()]), cx);
            app.choose_drug(token, 0, cx);
            assert!(app.form.as_ref().unwrap().selected_drug().is_none());
        });
    }

    #[gpui::test]
    fn therapy_picker_helpers_accessible_ids(cx: &mut gpui::TestAppContext) {
        let mut app: Option<Entity<ClinicalApp>> = None;
        rendered_command::assert_unique_texts(
            cx,
            move |window, cx| {
                let app = app.get_or_insert_with(|| {
                    cx.new(|cx| {
                        let mut app = ClinicalApp::new(String::new(), window, cx);
                        stage(&mut app, false, cx);
                        let (token, _) = pending(&mut app, cx);
                        let first = catalog_drug();
                        let mut second = first.clone();
                        second.aic = "000333333".into();
                        assert!(app.receive_drug_results(token, Ok(vec![first, second]), cx));
                        app
                    })
                });
                app.update(cx, |app, cx| app.therapy_picker_view(cx).into_any_element())
            },
            14,
        );
    }

    #[gpui::test]
    fn drug_search_rejects_old_queries_editors_context_and_closed_results(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            stage(app, false, cx);
            let (old, editor) = pending(app, cx);
            // A -> B -> A must still retire the first query's result.
            for query in ["Altra ricerca", "Terapia precedente"] {
                editor.update(cx, |input, cx| input.set_content(query, cx));
                app.drug_query_changed(editor.entity_id());
            }
            assert!(!app.receive_drug_results(old, Ok(vec![catalog_drug()]), cx));
            app.choose_drug(old, 0, cx);
            assert!(app.form.as_ref().unwrap().selected_drug().is_none());
            let (fresh, query) = pending(app, cx);
            assert!(app.receive_drug_results(fresh, Err(RuntimeError::Transport), cx));
            assert!(matches!(
                app.form
                    .as_ref()
                    .unwrap()
                    .therapy
                    .as_ref()
                    .unwrap()
                    .search
                    .as_ref()
                    .unwrap()
                    .rows,
                Load::Failed(_)
            ));
            assert_eq!(
                app.form.as_ref().unwrap().fields[0].value(cx),
                "Terapia precedente"
            );
            app.close_drug_search(cx);
            assert!(query.read(cx).value().is_empty() && query.read(cx).read_only);
            app.disconnect(cx);
            stage(app, false, cx);
            assert!(!app.receive_drug_results(fresh, Err(RuntimeError::Authentication), cx));
            assert!(
                app.form.is_some(),
                "an old failure cannot retire the current draft"
            );

            let (current, _) = pending(app, cx);
            assert!(
                !app.receive_drug_results(fresh, Ok(vec![catalog_drug()]), cx),
                "a new editor owns its own results"
            );
            app.next_epoch();
            assert!(!app.receive_drug_results(current, Ok(vec![catalog_drug()]), cx));
            let (review, _) = pending(app, cx);
            app.form.as_mut().unwrap().state = FormState::Review;
            assert!(!app.receive_drug_results(review, Ok(vec![catalog_drug()]), cx));
            app.form.as_mut().unwrap().state = FormState::Draft;
            let (retired, query) = pending(app, cx);
            app.disconnect(cx);
            stage(app, true, cx);
            assert!(query.read(cx).value().is_empty() && query.read(cx).read_only);
            assert!(!app.receive_drug_results(retired, Err(RuntimeError::Authentication), cx));
            assert!(app.form.as_ref().unwrap().selected_drug().is_none());
        });
    }

    #[gpui::test]
    fn drug_choice_and_undo_preserve_coded_and_free_text_drafts(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            for coded in [false, true] {
                stage(app, coded, cx);
                let before = if coded {
                    "Terapia precedente"
                } else {
                    "  Preparazione manuale annotata  "
                };
                app.form.as_ref().unwrap().fields[0]
                    .editor
                    .update(cx, |input, cx| input.set_content(before, cx));
                let drug = catalog_drug();
                let (token, _) = pending(app, cx);
                assert!(app.receive_drug_results(token, Ok(vec![drug.clone()]), cx));
                app.choose_drug(token, 0, cx);
                let form = app.form.as_ref().unwrap();
                assert_eq!(form.fields[0].value(cx), drug.name);
                assert!(form.fields[0].read_only);
                assert_eq!(form.selected_drug(), Some(&drug));
                assert!(form.therapy.as_ref().unwrap().search.is_none());
                let editing::Record::Therapy(original) = form.edit.as_ref().unwrap() else {
                    panic!()
                };
                assert_eq!(original.drug_name, "Terapia precedente");
                let values: Vec<_> = form.fields.iter().map(|field| field.value(cx)).collect();
                let editing::Draft::Therapy(draft) = original_draft(form, &values) else {
                    panic!()
                };
                assert_eq!(draft.aic.as_deref(), Some("000222222"));
                assert_eq!(draft.atc, drug.atc);
                assert_eq!(draft.active_principle, drug.active_principle);
                assert_eq!(draft.dosage, "Dose invariata");
                let new_values = [
                    values[0].clone(),
                    values[1].clone(),
                    values[2].clone(),
                    values[3].clone(),
                ];
                let created = new_therapy_draft(&new_values, form.selected_drug()).unwrap();
                assert_eq!(created.aic, draft.aic);
                assert_eq!(created.atc, draft.atc);
                assert_eq!(created.active_principle, draft.active_principle);

                app.copy_draft(cx);
                let copied = cx.read_from_clipboard().unwrap().text().unwrap();
                for expected in [
                    "AIC: 000222222",
                    "ATC: SYN-NEW",
                    "Principio scelto",
                    "Dose invariata",
                ] {
                    assert!(copied.contains(expected));
                }

                // A second explicit selection still undoes to the name before
                // any selection, preserving the separately entered dose/reason.
                let mut second = drug;
                second.name = "Secondo farmaco sintetico".into();
                second.aic = "000333333".into();
                let (token, _) = pending(app, cx);
                assert!(app.receive_drug_results(token, Ok(vec![second]), cx));
                app.choose_drug(token, 0, cx);
                app.undo_drug_choice(cx);
                let form = app.form.as_ref().unwrap();
                assert_eq!(form.fields[0].value(cx), before);
                assert_eq!(form.fields[0].read_only, coded);
                assert!(form.selected_drug().is_none());
                assert_eq!(form.fields[1].value(cx), "Dose invariata");
                if !coded {
                    let values = [
                        before.to_owned(),
                        "Dose invariata".into(),
                        "2026-10-17".into(),
                        String::new(),
                    ];
                    let manual = new_therapy_draft(&values, None).unwrap();
                    assert_eq!(manual.drug_name, before.trim());
                    assert!(
                        manual.aic.is_none()
                            && manual.atc.is_none()
                            && manual.active_principle.is_none()
                    );
                }
            }
        });
    }

    fn original_draft(form: &Form, values: &[String]) -> editing::Draft {
        form.edit
            .as_ref()
            .unwrap()
            .draft(values, form.selected_drug())
            .unwrap()
    }
}
