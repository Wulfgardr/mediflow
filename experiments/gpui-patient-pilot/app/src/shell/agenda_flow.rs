use super::*;

#[derive(Default)]
pub(super) struct AgendaFlow {
    pub origin: Option<AgendaOrigin>,
    pub selected: Option<String>,
    pub targets: HashMap<String, ScrollTarget>,
    pub outdated: bool,
    restore: Option<AgendaOrigin>,
}

pub(super) struct AgendaOrigin {
    row: String,
    offset: gpui::Point<gpui::Pixels>,
}

impl ClinicalApp {
    pub(super) fn render_global_read_state(
        &self,
        id: &'static str,
        state: ViewState,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        state.render(
            id,
            self.theme,
            &self.read_state_focus[state.object.index()],
            cx.listener(|this, _, _, cx| this.load_global_area(cx)),
        )
    }

    pub(super) fn open_agenda_patient(&mut self, row: &str, patient: &str, cx: &mut Context<Self>) {
        if self.area != Area::Agenda
            || self.form.is_some()
            || !self.agenda.ready().is_some_and(|rows| {
                rows.iter().any(|item| {
                    item.id == row && item.patient_id == patient && item.deleted_at.is_none()
                })
            })
        {
            return;
        }
        let origin = AgendaOrigin {
            row: row.into(),
            offset: self.area_scroll.offset(),
        };
        self.select_patient(patient, true, cx);
        if self.area == Area::Patients && self.selected_id.as_deref() == Some(patient) {
            self.agenda_flow.selected = Some(row.into());
            self.agenda_flow.origin = Some(origin);
        }
    }

    pub(super) fn return_to_agenda(&mut self, cx: &mut Context<Self>) {
        if self.form.is_some() {
            self.message = Some((
                "Completa o scarta la bozza prima di tornare all’Agenda.".into(),
                false,
            ));
            cx.notify();
            return;
        }
        if self.ambulatory_management.is_saving() || self.ai_preferences_blocks_navigation(cx) {
            return;
        }
        if self.agenda_flow.origin.is_none() || self.session.is_none() || self.scope.is_none() {
            return;
        }
        self.next_epoch();
        self.retire_profile_selection();
        self.selected_id = None;
        self.patient = PatientData::default();
        self.core = Workspace::default();
        self.area = Area::Agenda;
        self.directory = true;
        self.show_other = false;
        self.show_sections = false;
        self.message = None;
        self.focus_after_render = false;
        self.focus_search_after_render = false;
        self.agenda_flow.outdated = self.agenda.ready().is_some();
        self.agenda_flow.restore = self.agenda_flow.origin.take();
        cx.notify();
    }

    pub(super) fn patient_back_label(&self) -> &'static str {
        if self.agenda_flow.origin.is_some() {
            "Torna all’Agenda"
        } else {
            "Pazienti"
        }
    }

    pub(super) fn back_from_patient(&mut self, cx: &mut Context<Self>) {
        if self.agenda_flow.origin.is_some() {
            self.return_to_agenda(cx);
        } else {
            self.directory = true;
            self.load_patients(cx);
            self.focus_after_render = true;
            cx.notify();
        }
    }

    pub(super) fn prepare_agenda_return(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.area != Area::Agenda {
            return;
        }
        if let Some(rows) = self.agenda.ready() {
            self.agenda_flow
                .targets
                .retain(|id, _| rows.iter().any(|row| &row.id == id));
            for row in rows {
                self.agenda_flow
                    .targets
                    .entry(row.id.clone())
                    .or_insert_with(|| ScrollTarget::new(&self.area_scroll, cx));
            }
        }
        if let Some(origin) = self.agenda_flow.restore.take() {
            self.area_scroll.set_offset(origin.offset);
            if let Some(target) = self.agenda_flow.targets.get(&origin.row) {
                window.focus(&target.focus, cx);
            } else {
                window.focus(&self.global_apply_target.focus, cx);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell::notes_recovery_tests::Host;
    use serde_json::json;
    use std::time::{Duration, Instant};

    fn rows() -> Vec<Checkup> {
        (0..16)
            .map(|index| {
                serde_json::from_value(json!({
            "id":format!("control-{index}"), "patientId":"patient-a", "version":1,
            "date":"2026-10-27", "title":format!("Controllo sintetico {index}"), "status":"pending"
        })).unwrap()
            })
            .collect()
    }

    fn draw(cx: &mut gpui::VisualTestContext) {
        for _ in 0..30 {
            let pending = cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                window.simulate_next_frame(cx)
            });
            cx.run_until_parked();
            if pending == 0 {
                return;
            }
        }
        panic!("agenda rendering did not settle");
    }

    fn install(app: &mut ClinicalApp, host: &Host, cx: &mut Context<ClinicalApp>) {
        app.session = Some(host.session.clone());
        app.scope = Some("scope-a".into());
        app.area = Area::Agenda;
        app.agenda = ReadLoad::Ready(rows());
        app.global_patients = ReadLoad::Ready(vec![serde_json::from_value(json!({
            "id":"patient-a", "firstName":"Amina", "lastName":"Sintetica", "taxCode":"SYNTHETIC", "version":1
        })).unwrap()]);
        app.global_interval = calendar_interval("2026-10-01", "2026-10-31", &chrono::Utc).unwrap();
        for (field, value) in app.global_dates.iter().zip(["2026-10-01", "2026-10-31"]) {
            field
                .editor
                .update(cx, |input, cx| input.set_content(value, cx));
        }
        app.global_query = "Sintetica".into();
        app.global_search
            .update(cx, |input, cx| input.set_content("Sintetica", cx));
        cx.notify();
    }

    #[test]
    fn g7b_reads_distinguish_loading_long_wait_empty_error_unavailable_and_obsolete() {
        for object in [
            ReadObject::Agenda,
            ReadObject::NomiPazienti,
            ReadObject::Scheda,
            ReadObject::Diario,
            ReadObject::Terapie,
            ReadObject::Controlli,
            ReadObject::Parametri,
            ReadObject::Documenti,
        ] {
            let load = ReadLoad::<Vec<Checkup>>::loading();
            assert_eq!(load.state(object).unwrap().kind, ViewStateKind::Caricamento);
            let load = ReadLoad::<Vec<Checkup>>::Loading {
                started: Instant::now() - Duration::from_secs(6),
            };
            assert!(matches!(
                load.state(object).unwrap().kind,
                ViewStateKind::AttesaLunga { elapsed: 6.., .. }
            ));
            let empty = ReadLoad::Ready(Vec::<Checkup>::new());
            assert!(empty.state(object).is_none());
            assert_eq!(ViewState::new(object, ViewStateKind::Vuoto).command(), None);
            for (error, expected, command) in [
                (
                    RuntimeError::InvalidResponse,
                    ViewStateKind::Errore,
                    Some("Riprova la lettura"),
                ),
                (
                    RuntimeError::Transport,
                    ViewStateKind::NonInLinea { copia: None },
                    Some("Riprova la lettura"),
                ),
                (
                    RuntimeError::ReadRequired,
                    ViewStateKind::DaRileggere,
                    Some("Rileggi"),
                ),
                (
                    RuntimeError::Conflict,
                    ViewStateKind::DaRileggere,
                    Some("Rileggi"),
                ),
                (RuntimeError::Forbidden, ViewStateKind::AccessoNegato, None),
                (RuntimeError::Crypto, ViewStateKind::CampoIlleggibile, None),
                (
                    RuntimeError::ArchiveReplaced,
                    ViewStateKind::ArchivioSostituito,
                    None,
                ),
            ] {
                let load = ReadLoad::<Vec<Checkup>>::from_result(Err(error));
                let state = load.state(object).unwrap();
                assert_eq!(state.kind, expected);
                assert_eq!(state.command().map(|cmd| cmd.label()), command);
                assert_ne!(
                    state.lines().0,
                    ViewState::new(object, ViewStateKind::Vuoto).lines().0
                );
            }
            let mut cancelled = ReadLoad::<Vec<Checkup>>::loading();
            cancelled.interrupt();
            assert_eq!(
                cancelled.state(object).unwrap().kind,
                ViewStateKind::DaRileggere
            );
        }
    }

    #[gpui::test]
    fn g7b_return_preserves_dates_filter_selection_scroll_and_row_focus(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        for (width, height) in [(390., 640.), (1200., 840.)] {
            for dark in [false, true] {
                let (view, cx) =
                    cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
                cx.simulate_resize(gpui::size(px(width), px(height)));
                view.update(cx, |app, cx| {
                    install(app, &host, cx);
                    app.dark_override = Some(dark);
                });
                draw(cx);
                cx.update_window_entity(&view, |app, window, cx| {
                    app.agenda_flow.targets["control-8"].scroll_to(window, cx);
                });
                draw(cx);
                let offset = view.read_with(cx, |app, _| app.area_scroll.offset());
                assert!(offset.y < px(-100.));
                let row = cx
                    .debug_bounds("clinical-workspace-agenda-checkup-control-8")
                    .unwrap();
                cx.simulate_click(row.center(), gpui::Modifiers::default());
                cx.run_until_parked();
                draw(cx);
                view.read_with(cx, |app, _| {
                    assert_eq!(app.selected_id.as_deref(), Some("patient-a"));
                    assert!(app.patient.detail.ready().is_some());
                    assert_eq!(app.patient_back_label(), "Torna all’Agenda");
                });
                let calls = host.request_count();
                let back = cx
                    .debug_bounds("clinical-workspace-back-directory")
                    .unwrap();
                cx.simulate_click(back.center(), gpui::Modifiers::default());
                draw(cx);
                view.read_with(cx, |app, cx| {
                    assert!(app.area == Area::Agenda);
                    assert!(app.selected_id.is_none());
                    assert_eq!(app.global_query, "Sintetica");
                    assert_eq!(app.global_search.read(cx).value(), "Sintetica");
                    assert_eq!(app.global_interval.from_day, "2026-10-01");
                    assert_eq!(app.global_interval.to_day, "2026-10-31");
                    assert_eq!(app.global_dates[0].value(cx), "2026-10-01");
                    assert_eq!(app.global_dates[1].value(cx), "2026-10-31");
                    assert_eq!(app.agenda_flow.selected.as_deref(), Some("control-8"));
                    assert_eq!(app.area_scroll.offset(), offset);
                    assert!(app.agenda_flow.outdated);
                    assert_eq!(app.agenda.ready().unwrap().len(), 16);
                });
                cx.update_window_entity(&view, |app, window, _| {
                    assert!(
                        app.agenda_flow.targets["control-8"]
                            .focus
                            .is_focused(window)
                    );
                });
                let (node, returned_row) =
                    rendered_command::node("clinical-workspace-agenda-checkup-control-8");
                assert!(node.label().unwrap().contains("dati da rileggere"));
                assert_eq!(
                    returned_row, row,
                    "return must preserve the row position as well as the scroll offset"
                );
                assert_eq!(
                    host.request_count(),
                    calls,
                    "return must not silently reread or write"
                );
            }
        }
    }

    #[gpui::test]
    fn g7b_return_from_unavailable_chart_and_pending_names_does_not_leave_a_spinner(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            app.global_patients = ReadLoad::loading();
            app.open_agenda_patient("control-1", "patient-a", cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            app.patient.detail = ReadLoad::Failed(RuntimeError::Transport);
            app.patient.entries = ReadLoad::loading();
            let (sender, receiver) = std::sync::mpsc::channel();
            app.run(
                move || {
                    receiver.recv().unwrap();
                    Ok(Vec::<Checkup>::new())
                },
                |app, result, _| app.agenda = ReadLoad::from_result(result),
                cx,
            );
            app.navigate(Area::Agenda, cx);
            sender.send(()).unwrap();
        });
        draw(cx);
        view.read_with(cx, |app, _| {
            assert!(app.area == Area::Agenda);
            assert!(matches!(app.global_patients, ReadLoad::Interrupted));
            assert!(app.patient.entries.ready().is_none());
            assert_eq!(app.agenda.ready().unwrap().len(), 16);
            assert!(app.agenda_flow.outdated);
        });
        assert!(
            cx.debug_bounds("clinical-workspace-global-patient-names-command")
                .is_some()
        );
        assert!(
            cx.debug_bounds("clinical-workspace-agenda-partial-search")
                .is_some()
        );
    }

    #[gpui::test]
    fn g7b_rendered_agenda_never_reports_a_failed_read_as_empty(cx: &mut gpui::TestAppContext) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| install(app, &host, cx));
        for error in [
            RuntimeError::Transport,
            RuntimeError::InvalidResponse,
            RuntimeError::ReadRequired,
            RuntimeError::Forbidden,
            RuntimeError::LockedField,
        ] {
            view.update(cx, |app, cx| {
                app.agenda = ReadLoad::Failed(error);
                cx.notify();
            });
            draw(cx);
            assert!(cx.debug_bounds("clinical-workspace-agenda-state").is_some());
            assert!(cx.debug_bounds("clinical-workspace-agenda-empty").is_none());
            assert!(
                cx.debug_bounds("clinical-workspace-agenda-filter-empty")
                    .is_none()
            );
            assert_eq!(
                cx.debug_bounds("clinical-workspace-agenda-state-command")
                    .is_some(),
                !matches!(error, RuntimeError::Forbidden | RuntimeError::LockedField)
            );
        }
        view.update(cx, |app, cx| {
            app.agenda = ReadLoad::Ready(vec![]);
            cx.notify();
        });
        draw(cx);
        assert!(cx.debug_bounds("clinical-workspace-agenda-empty").is_some());
        assert!(cx.debug_bounds("clinical-workspace-agenda-state").is_none());
    }

    #[gpui::test]
    fn g7b_explicit_reread_uses_preserved_interval_and_leaving_the_vertical_retires_origin(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            app.open_agenda_patient("control-2", "patient-a", cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| app.return_to_agenda(cx));
        draw(cx);
        let calls = host.request_count();
        let command = cx
            .debug_bounds("clinical-workspace-global-refresh")
            .unwrap();
        cx.simulate_click(command.center(), gpui::Modifiers::default());
        cx.run_until_parked();
        draw(cx);
        view.read_with(cx, |app, _| {
            assert!(!app.agenda_flow.outdated);
            assert!(app.agenda.ready().unwrap().is_empty());
            assert_eq!(app.global_query, "Sintetica");
            assert_eq!(app.global_interval.from_day, "2026-10-01");
        });
        assert!(host.request_count() > calls);
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            app.open_agenda_patient("control-2", "patient-a", cx);
            app.navigate(Area::Patients, cx);
            assert!(app.agenda_flow.origin.is_none());
            assert!(app.agenda_flow.selected.is_none());
        });
        cx.run_until_parked();
    }

    #[gpui::test]
    fn g7b_draft_blocks_return_and_lock_retires_origin(cx: &mut gpui::TestAppContext) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            let calls = host.request_count();
            app.open_agenda_patient("retired-row", "patient-a", cx);
            app.open_agenda_patient("control-2", "wrong-patient", cx);
            assert!(app.selected_id.is_none());
            assert!(app.agenda_flow.origin.is_none());
            assert_eq!(host.request_count(), calls);
            app.open_agenda_patient("control-2", "patient-a", cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            super::super::tests::synthetic_notes_form(app, FormState::Draft, cx);
            app.navigate(Area::Agenda, cx);
            assert!(app.area == Area::Patients);
            assert!(app.form.is_some());
            assert!(app.agenda_flow.origin.is_some());
            app.disconnect(cx);
            assert!(app.agenda_flow.origin.is_none());
            assert!(app.agenda_flow.targets.is_empty());
            assert!(app.agenda.ready().is_none());
        });
        cx.run_until_parked();
    }
}
