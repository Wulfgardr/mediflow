use super::*;

#[derive(Default)]
pub(super) struct AgendaFlow {
    pub origin: Option<AgendaOrigin>,
    pub selected: Option<String>,
    pub targets: HashMap<String, ScrollTarget>,
    pub refresh: Option<ReadLoad<()>>,
    agenda_request: u64,
    names_request: u64,
    refresh_origin: Option<AgendaOrigin>,
    refresh_focused: bool,
    reconciliation: Option<String>,
    previous_rows: Option<Vec<Checkup>>,
    restore: Option<AgendaOrigin>,
}

#[derive(Clone)]
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
        let object = state.object;
        state.render(
            id,
            self.theme,
            &self.read_state_focus[state.object.index()],
            cx.listener(move |this, _, _, cx| this.retry_global_read_command(object, cx)),
        )
    }

    pub(super) fn agenda_state(&self) -> Option<ViewState> {
        self.agenda_state_after(std::time::Instant::now())
    }

    pub(super) fn agenda_state_after(&self, now: std::time::Instant) -> Option<ViewState> {
        self.agenda_flow
            .refresh
            .as_ref()
            .and_then(|load| load.state_after(ReadObject::Agenda, now))
            .or_else(|| self.agenda.state_after(ReadObject::Agenda, now))
    }

    pub(super) fn agenda_status(&self, state: Option<ViewState>) -> String {
        if let Some(state) = state {
            let (first, second) = state.lines();
            let text = match second {
                Some(second) => format!("{first} {second}"),
                None => first,
            };
            match (state.kind, self.agenda.ready().is_some()) {
                (ViewStateKind::Caricamento, true) => "Aggiornamento in corso".into(),
                (ViewStateKind::AttesaLunga { .. }, _) | (_, false) => text,
                (_, true) => format!("Risultati da rileggere. {text}"),
            }
        } else {
            self.agenda_flow
                .reconciliation
                .clone()
                .unwrap_or_else(|| "Agenda letta".into())
        }
    }

    pub(super) fn retry_global_read_command(&mut self, object: ReadObject, cx: &mut Context<Self>) {
        if object == ReadObject::Agenda {
            self.agenda_flow.restore = self.agenda_flow.selected.as_ref().map(|row| AgendaOrigin {
                row: row.clone(),
                offset: self.area_scroll.offset(),
            });
        }
        self.retry_global_read(object, cx);
    }

    pub(super) fn retry_global_read(&mut self, object: ReadObject, cx: &mut Context<Self>) {
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            if object == ReadObject::Agenda {
                self.agenda_flow.refresh = Some(ReadLoad::Interrupted);
            }
            cx.notify();
            return;
        };
        match object {
            ReadObject::NomiPazienti => {
                self.agenda_flow.names_request += 1;
                let request = self.agenda_flow.names_request;
                self.global_patients = ReadLoad::loading();
                self.run(
                    move || {
                        let mut patients = session.list_patients(&scope, false)?;
                        patients.extend(session.list_patients(&scope, true)?);
                        Ok(patients)
                    },
                    move |this, result, _| {
                        if this.agenda_flow.names_request == request {
                            this.finish_agenda_names_read(result);
                        }
                    },
                    cx,
                );
            }
            ReadObject::Agenda => {
                self.agenda_flow.agenda_request += 1;
                let request = self.agenda_flow.agenda_request;
                self.agenda_flow.reconciliation = None;
                self.agenda_flow.previous_rows = None;
                self.agenda_flow.refresh_origin = self.agenda_flow.restore.clone().or_else(|| {
                    self.agenda_flow.selected.as_ref().map(|row| AgendaOrigin {
                        row: row.clone(),
                        offset: self.area_scroll.offset(),
                    })
                });
                if self.agenda.ready().is_some() {
                    self.agenda_flow.refresh = Some(ReadLoad::loading());
                } else {
                    self.agenda_flow.refresh = None;
                    self.agenda = ReadLoad::loading();
                }
                let filter = AgendaFilter {
                    date_from: self.global_interval.from.clone(),
                    date_to: self.global_interval.to.clone(),
                    limit: Some(200),
                    ..Default::default()
                };
                self.run(
                    move || session.list_agenda_with_filter(&scope, &filter),
                    move |this, result, _| {
                        if this.agenda_flow.agenda_request == request {
                            this.finish_agenda_read(result);
                        }
                    },
                    cx,
                );
            }
            _ => return,
        }
        self.watch_patient_reads(cx);
        cx.notify();
    }

    pub(super) fn visible_agenda_rows(&self) -> Vec<&Checkup> {
        self.filtered_agenda_rows(self.agenda.ready().map(Vec::as_slice).unwrap_or_default())
    }

    fn filtered_agenda_rows<'a>(&self, rows: &'a [Checkup]) -> Vec<&'a Checkup> {
        let query = self.global_query.trim().to_lowercase();
        let today = chrono::Local::now().date_naive();
        let mut rows: Vec<_> = rows
            .iter()
            .filter(|row| {
                row.deleted_at.is_none()
                    && (self
                        .global_patient_name(&row.patient_id)
                        .to_lowercase()
                        .contains(&query)
                        || row.title.to_lowercase().contains(&query)
                        || !row.locked_fields.iter().any(|field| field == "notes")
                            && row
                                .notes
                                .as_deref()
                                .unwrap_or_default()
                                .to_lowercase()
                                .contains(&query))
            })
            .collect();
        rows.sort_by_key(|row| {
            (
                AgendaGroup::ALL
                    .iter()
                    .position(|group| *group == agenda_group(&row.status, &row.date, today))
                    .unwrap(),
                &row.date,
            )
        });
        rows
    }

    fn finish_agenda_names_read(&mut self, result: Result<Vec<PatientSummary>, RuntimeError>) {
        self.global_patients = ReadLoad::from_result(result);
        self.reconcile_agenda_selection();
    }

    fn finish_agenda_read(&mut self, result: Result<Vec<Checkup>, RuntimeError>) {
        match result {
            Ok(rows) => {
                let previous = std::mem::replace(&mut self.agenda, ReadLoad::Ready(rows));
                self.agenda_flow.previous_rows = Some(match previous {
                    ReadLoad::Ready(rows) => rows,
                    _ => Vec::new(),
                });
                self.agenda_flow.refresh = None;
                self.reconcile_agenda_selection();
            }
            Err(error) if self.agenda.ready().is_some() => {
                self.agenda_flow.refresh = Some(ReadLoad::Failed(error))
            }
            Err(error) => self.agenda = ReadLoad::Failed(error),
        }
    }

    fn reconcile_agenda_selection(&mut self) {
        if !self.global_query.trim().is_empty() && self.global_patients.ready().is_none() {
            return;
        }
        let Some(old_rows) = self.agenda_flow.previous_rows.take() else {
            return;
        };
        let old = self.filtered_agenda_rows(&old_rows);
        let selected = self.agenda_flow.selected.as_ref();
        let previous = old.iter().position(|row| Some(&row.id) == selected);
        let date = old_rows
            .iter()
            .find(|row| Some(&row.id) == selected)
            .map(|row| row.date.clone());
        let visible = self.visible_agenda_rows();
        if selected.is_some() && !visible.iter().any(|row| Some(&row.id) == selected) {
            let nearest = visible
                .iter()
                .enumerate()
                .min_by_key(|(index, row)| {
                    (
                        date.as_ref()
                            .map(|date| {
                                let day = |value: &str| {
                                    chrono::DateTime::parse_from_rfc3339(value)
                                        .map(|date| date.with_timezone(&chrono::Local).date_naive())
                                        .or_else(|_| {
                                            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                                        })
                                        .ok()
                                };
                                day(&row.date)
                                    .zip(day(date))
                                    .map(|(a, b)| (a - b).num_days().abs())
                                    .unwrap_or(i64::MAX)
                            })
                            .unwrap_or(0),
                        index.abs_diff(previous.unwrap_or(0)),
                    )
                })
                .map(|(_, row)| row.id.clone());
            self.agenda_flow.selected = nearest;
            self.agenda_flow.reconciliation = Some(if self.agenda_flow.selected.is_some() { "Il controllo selezionato non è più presente nei risultati. Selezionato il controllo più vicino." } else { "Il controllo selezionato non è più presente nei risultati. Nessun controllo selezionato." }.into());
        }
        if let Some(mut origin) = self.agenda_flow.refresh_origin.take() {
            origin.row = self.agenda_flow.selected.clone().unwrap_or_default();
            if self.agenda_flow.refresh_focused || self.agenda_flow.restore.is_some() {
                self.agenda_flow.restore = Some(origin);
            } else {
                self.area_scroll.set_offset(origin.offset);
            }
        }
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
        self.agenda_flow.restore = self.agenda_flow.origin.take();
        self.retry_global_read(ReadObject::Agenda, cx);
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
        if self
            .agenda_flow
            .refresh
            .as_ref()
            .is_some_and(|load| matches!(load, ReadLoad::Loading { .. }))
        {
            self.agenda_flow.refresh_focused = self
                .agenda_flow
                .targets
                .values()
                .any(|target| target.focus.is_focused(window));
            if let Some(origin) = &mut self.agenda_flow.refresh_origin {
                origin.offset = self.area_scroll.offset();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell::notes_recovery_tests::Host;
    use gpui::Focusable;
    use serde_json::json;
    use std::time::{Duration, Instant};

    fn row_values() -> serde_json::Value {
        json!((0..16).map(|index| json!({"id":format!("control-{index}"), "patientId":"patient-a", "version":1, "date":"2026-10-27", "title":format!("Controllo sintetico {index}"), "status":"pending"})).collect::<Vec<_>>())
    }

    fn agenda_calls(host: &Host) -> Vec<String> {
        host.routes()
            .into_iter()
            .filter(|route| route.starts_with("GET /api/v1/network/checkups?"))
            .collect()
    }

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

    fn activate_focused(cx: &mut gpui::VisualTestContext) {
        cx.update(|window, cx| {
            let keystroke = gpui::Keystroke::parse("enter").unwrap();
            window.dispatch_event(
                gpui::PlatformInput::KeyDown(gpui::KeyDownEvent {
                    keystroke: keystroke.clone(),
                    is_held: false,
                    prefer_character_input: false,
                }),
                cx,
            );
            window.dispatch_event(
                gpui::PlatformInput::KeyUp(gpui::KeyUpEvent { keystroke }),
                cx,
            );
        });
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
                let calls = agenda_calls(&host).len();
                host.plan("GET /api/v1/network/checkups?")
                    .send((200, row_values()))
                    .unwrap();
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
                    assert!(app.agenda_flow.refresh.is_none());
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
                assert!(
                    node.label()
                        .unwrap()
                        .starts_with("Apri scheda di Amina Sintetica")
                );
                assert!(!node.label().unwrap().contains("rileggere"));
                assert_eq!(
                    returned_row, row,
                    "return must preserve the row position as well as the scroll offset"
                );
                assert_eq!(
                    agenda_calls(&host).len(),
                    calls + 1,
                    "return starts exactly one collective read"
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
            host.plan("GET /api/v1/network/checkups?")
                .send((200, row_values()))
                .unwrap();
            app.navigate(Area::Agenda, cx);
            sender.send(()).unwrap();
        });
        draw(cx);
        view.read_with(cx, |app, _| {
            assert!(app.area == Area::Agenda);
            assert!(matches!(app.global_patients, ReadLoad::Interrupted));
            assert!(app.patient.entries.ready().is_none());
            assert_eq!(app.agenda.ready().unwrap().len(), 16);
            assert!(app.agenda_flow.refresh.is_none());
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
    fn g7b_return_and_retry_send_applied_interval_not_unapplied_date_edits(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            app.global_dates[0]
                .editor
                .update(cx, |input, cx| input.set_content("2030-01-01", cx));
            app.global_dates[1]
                .editor
                .update(cx, |input, cx| input.set_content("2030-01-31", cx));
            app.open_agenda_patient("control-2", "patient-a", cx);
        });
        cx.run_until_parked();
        host.plan("GET /api/v1/network/checkups?")
            .send((503, json!({"error":"unavailable"})))
            .unwrap();
        view.update(cx, |app, cx| app.return_to_agenda(cx));
        draw(cx);
        assert_eq!(agenda_calls(&host).len(), 1);
        let command = cx
            .debug_bounds("clinical-workspace-agenda-state-command")
            .unwrap();
        host.plan("GET /api/v1/network/checkups?")
            .send((200, row_values()))
            .unwrap();
        cx.simulate_click(command.center(), gpui::Modifiers::default());
        draw(cx);
        let calls = agenda_calls(&host);
        assert_eq!(calls.len(), 2);
        let interval = calendar_interval("2026-10-01", "2026-10-31", &chrono::Utc).unwrap();
        for route in calls {
            let query: HashMap<_, _> = route
                .split('?')
                .nth(1)
                .unwrap()
                .split('&')
                .map(|pair| {
                    let (key, value) = pair.split_once('=').unwrap();
                    (key, value.replace("%3A", ":"))
                })
                .collect();
            assert_eq!(query.get("dateFrom"), interval.from.as_ref());
            assert_eq!(query.get("dateTo"), interval.to.as_ref());
            assert_eq!(query.get("limit"), Some(&"200".to_owned()));
        }
        view.update(cx, |app, cx| {
            assert!(app.agenda_flow.refresh.is_none());
            assert_eq!(app.global_query, "Sintetica");
            app.open_agenda_patient("control-2", "patient-a", cx);
            app.navigate(Area::Patients, cx);
            assert!(app.agenda_flow.origin.is_none());
            assert!(app.agenda_flow.selected.is_none());
        });
        cx.run_until_parked();
    }

    #[gpui::test]
    fn g7b_refresh_keeps_rows_scroll_and_focus_then_reconciles_visible_selection(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        for variant in [
            "same",
            "reordered",
            "removed",
            "empty",
            "filtered",
            "editor",
            "retry",
        ] {
            let (view, cx) =
                cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
            cx.simulate_resize(gpui::size(px(390.), px(640.)));
            view.update(cx, |app, cx| {
                install(app, &host, cx);
                app.agenda_flow.selected = Some("control-8".into());
            });
            draw(cx);
            cx.update_window_entity(&view, |app, window, cx| {
                app.agenda_flow.targets["control-8"].scroll_to(window, cx);
                window.focus(&app.agenda_flow.targets["control-8"].focus, cx);
                if variant == "editor" {
                    app.global_search
                        .update(cx, |input, cx| input.focus(window, cx));
                }
            });
            draw(cx);
            if variant == "retry" {
                view.update(cx, |app, cx| {
                    app.agenda_flow.refresh = Some(ReadLoad::Failed(RuntimeError::Transport));
                    cx.notify();
                });
                draw(cx);
            }
            let before = cx
                .debug_bounds("clinical-workspace-agenda-checkup-control-8")
                .unwrap();
            let offset = view.read_with(cx, |app, _| app.area_scroll.offset());
            let response = host.plan("GET /api/v1/network/checkups?");
            if variant == "retry" {
                activate_focused(cx);
            } else {
                view.update(cx, |app, cx| app.retry_global_read(ReadObject::Agenda, cx));
            }
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            });
            if variant != "retry" {
                assert_eq!(
                    cx.debug_bounds("clinical-workspace-agenda-checkup-control-8")
                        .unwrap(),
                    before
                );
            }
            assert!(
                rendered_command::node("clinical-workspace-agenda-list")
                    .0
                    .label()
                    .unwrap()
                    .contains("Aggiornamento in corso")
            );
            let mut values = row_values().as_array().unwrap().clone();
            match variant {
                "reordered" => values.reverse(),
                "removed" => {
                    values.remove(8);
                    for row in &mut values {
                        row["date"] = json!("2026-10-30");
                    }
                    values[8]["date"] = json!("2026-10-27");
                }
                "empty" => values.clear(),
                "filtered" => {
                    for row in &mut values {
                        row["patientId"] = json!("other");
                    }
                }
                _ => {}
            }
            response.send((200, json!(values))).unwrap();
            draw(cx);
            view.read_with(cx, |app, _| {
                let expected = match variant {
                    "removed" => Some("control-9"),
                    "empty" | "filtered" => None,
                    _ => Some("control-8"),
                };
                assert_eq!(app.agenda_flow.selected.as_deref(), expected, "{variant}");
                assert!(app.agenda_flow.refresh.is_none());
                assert_eq!(
                    app.agenda_flow.reconciliation.is_some(),
                    matches!(variant, "removed" | "empty" | "filtered")
                );
                if matches!(
                    variant,
                    "same" | "reordered" | "removed" | "editor" | "retry"
                ) {
                    assert_eq!(app.area_scroll.offset(), offset);
                }
            });
            cx.update_window_entity(&view, |app, window, cx| {
                if variant == "editor" {
                    assert!(
                        app.global_search
                            .read(cx)
                            .focus_handle(cx)
                            .is_focused(window)
                    );
                } else if let Some(row) = &app.agenda_flow.selected {
                    assert!(
                        app.agenda_flow.targets[row].focus.is_focused(window),
                        "{variant}"
                    );
                } else {
                    assert!(app.global_apply_target.focus.is_focused(window));
                }
            });
        }
    }

    #[gpui::test]
    fn g7b_selection_waits_for_agenda_and_names_in_either_order(cx: &mut gpui::TestAppContext) {
        let host = Host::new();
        for names_first in [false, true] {
            for removed in [false, true] {
                let (view, cx) =
                    cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
                view.update(cx, |app, cx| {
                    install(app, &host, cx);
                    app.patients = Load::Ready(vec![]);
                    app.agenda_flow.selected = Some("control-8".into());
                });
                draw(cx);
                let mut values = row_values().as_array().unwrap().clone();
                if removed {
                    values.remove(8);
                    for row in &mut values {
                        row["date"] = json!("2026-10-30");
                    }
                    values[8]["date"] = json!("2026-10-27");
                } else {
                    values.reverse();
                }
                let names_value = json!([{
                    "id":"patient-a", "firstName":"Amina", "lastName":"Sintetica",
                    "taxCode":"SYNTHETIC", "version":1
                }]);
                view.update(cx, |app, cx| {
                    app.global_patients = ReadLoad::loading();
                    app.agenda_flow.refresh = Some(ReadLoad::loading());
                    if names_first {
                        app.finish_agenda_names_read(Ok(serde_json::from_value(
                            names_value.clone(),
                        )
                        .unwrap()));
                    } else {
                        app.finish_agenda_read(Ok(
                            serde_json::from_value(json!(values.clone())).unwrap()
                        ));
                    }
                    cx.notify();
                });
                draw(cx);
                view.read_with(cx, |app, _| {
                    assert_eq!(app.agenda_flow.selected.as_deref(), Some("control-8"));
                    assert!(app.agenda_flow.reconciliation.is_none());
                    assert!(
                        !app.agenda_status(app.agenda_state())
                            .contains("non è più presente")
                    );
                    if names_first {
                        assert!(app.global_patients.ready().is_some());
                        assert!(app.agenda_flow.refresh.is_some());
                    } else {
                        assert!(app.global_patients.ready().is_none());
                        assert!(app.agenda_flow.refresh.is_none());
                    }
                });
                view.update(cx, |app, cx| {
                    if names_first {
                        app.finish_agenda_read(Ok(serde_json::from_value(json!(values)).unwrap()));
                    } else {
                        app.finish_agenda_names_read(Ok(
                            serde_json::from_value(names_value).unwrap()
                        ));
                    }
                    cx.notify();
                });
                draw(cx);
                view.read_with(cx, |app, _| {
                    assert_eq!(app.visible_agenda_rows().len(), if removed { 15 } else { 16 });
                    assert_eq!(app.agenda_flow.selected.as_deref(), Some(if removed {
                        "control-9"
                    } else {
                        "control-8"
                    }));
                    assert_eq!(app.agenda_status(app.agenda_state()), if removed {
                        "Il controllo selezionato non è più presente nei risultati. Selezionato il controllo più vicino."
                    } else {
                        "Agenda letta"
                    });
                });
                assert_eq!(
                    rendered_command::node("clinical-workspace-agenda-list")
                        .0
                        .label(),
                    Some(if removed {
                        "Agenda. Il controllo selezionato non è più presente nei risultati. Selezionato il controllo più vicino."
                    } else {
                        "Agenda. Agenda letta"
                    })
                );
            }
        }
    }

    #[gpui::test]
    fn g7b_refresh_renders_phase_and_elapsed_time_with_an_injected_clock(
        cx: &mut gpui::TestAppContext,
    ) {
        struct TimedAgenda {
            app: Entity<ClinicalApp>,
            now: Instant,
        }
        impl Render for TimedAgenda {
            fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
                self.app
                    .update(cx, |app, cx| app.agenda_view_after(true, self.now, cx))
            }
        }
        let host = Host::new();
        let (app, app_cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let started = Instant::now();
        app.update(app_cx, |app, cx| {
            install(app, &host, cx);
            app.agenda_flow.refresh = Some(ReadLoad::Loading { started });
        });
        draw(app_cx);
        let (fixture, cx) = cx.add_window_view(|_, _| TimedAgenda {
            app: app.clone(),
            now: started,
        });
        for elapsed in [
            Duration::from_millis(4999),
            Duration::from_secs(5),
            Duration::from_secs(12),
            Duration::from_secs(61),
        ] {
            fixture.update(cx, |fixture, cx| {
                fixture.now = started + elapsed;
                cx.notify();
            });
            rendered_command::take_text_nodes();
            draw(cx);
            let status = if elapsed.as_secs() < 5 {
                "Aggiornamento in corso".to_owned()
            } else {
                format!(
                    "Lettura dell’agenda… L'archivio sta ancora rispondendo, {} s",
                    elapsed.as_secs()
                )
            };
            assert_eq!(
                rendered_command::node("clinical-workspace-agenda-list")
                    .0
                    .label(),
                Some(format!("Agenda. {status}").as_str())
            );
            let texts = rendered_command::take_text_nodes();
            assert!(
                texts
                    .iter()
                    .any(|(_, node)| node.value() == Some(status.as_str())),
                "visible refresh text must include phase and elapsed time: {status}"
            );
            assert!(
                cx.debug_bounds("clinical-workspace-agenda-checkup-control-8")
                    .is_some()
            );
            assert!(
                cx.debug_bounds("clinical-workspace-agenda-state-command")
                    .is_none()
            );
            app.read_with(cx, |app, _| {
                assert_eq!(app.agenda.ready().unwrap().len(), 16);
                assert!(matches!(
                    app.agenda_flow.refresh,
                    Some(ReadLoad::Loading { .. })
                ));
            });
            assert!(agenda_calls(&host).is_empty());
        }
    }

    #[gpui::test]
    fn g7b_names_retry_preserves_agenda_and_agenda_retry_preserves_names(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            app.global_patients = ReadLoad::Failed(RuntimeError::Transport);
        });
        draw(cx);
        let start = host.request_count();
        let command = cx
            .debug_bounds("clinical-workspace-global-patient-names-command")
            .unwrap();
        cx.simulate_click(command.center(), gpui::Modifiers::default());
        view.read_with(cx, |app, _| {
            assert_eq!(app.agenda.ready().unwrap().len(), 16)
        });
        draw(cx);
        assert_eq!(agenda_calls(&host).len(), 0);
        assert_eq!(
            host.routes()[start..]
                .iter()
                .filter(|route| route.as_str() == "GET /api/v1/network/patients")
                .count(),
            2
        );
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            app.retry_global_read(ReadObject::Agenda, cx);
            assert_eq!(app.global_patients.ready().unwrap().len(), 1);
        });
        draw(cx);
        view.read_with(cx, |app, _| {
            assert_eq!(app.global_patients.ready().unwrap().len(), 1)
        });
        assert_eq!(agenda_calls(&host).len(), 1);
    }

    #[gpui::test]
    fn g7b_global_state_commands_receive_focus_without_stealing_an_editor(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            app.agenda = ReadLoad::loading();
        });
        draw(cx);
        for error in [
            RuntimeError::InvalidResponse,
            RuntimeError::Transport,
            RuntimeError::ReadRequired,
        ] {
            view.update(cx, |app, cx| {
                app.agenda = ReadLoad::Failed(error);
                cx.notify();
            });
            draw(cx);
            cx.update_window_entity(&view, |app, window, _| {
                assert!(app.read_state_focus[ReadObject::Agenda.index()].is_focused(window))
            });
        }
        view.update(cx, |app, cx| {
            app.agenda = ReadLoad::loading();
            cx.notify();
        });
        draw(cx);
        cx.update_window_entity(&view, |app, window, cx| {
            app.global_search
                .update(cx, |input, cx| input.focus(window, cx))
        });
        view.update(cx, |app, cx| {
            app.agenda = ReadLoad::Failed(RuntimeError::Transport);
            cx.notify();
        });
        draw(cx);
        cx.update_window_entity(&view, |app, window, cx| {
            assert!(
                app.global_search
                    .read(cx)
                    .focus_handle(cx)
                    .is_focused(window)
            )
        });
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            app.global_patients = ReadLoad::loading();
            app.open_agenda_patient("control-2", "patient-a", cx);
        });
        cx.run_until_parked();
        host.plan("GET /api/v1/network/checkups?")
            .send((200, row_values()))
            .unwrap();
        view.update(cx, |app, cx| app.return_to_agenda(cx));
        draw(cx);
        cx.update_window_entity(&view, |app, window, cx| {
            assert!(app.read_state_focus[ReadObject::NomiPazienti.index()].is_focused(window));
            super::super::tests::synthetic_notes_form(app, FormState::Draft, cx);
            app.patient.therapies = ReadLoad::Failed(RuntimeError::Transport);
            app.global_search
                .update(cx, |input, cx| input.focus(window, cx));
        });
        draw(cx);
        cx.update_window_entity(&view, |app, window, cx| {
            assert!(
                app.global_search
                    .read(cx)
                    .focus_handle(cx)
                    .is_focused(window)
            )
        });
    }

    #[gpui::test]
    fn g7b_row_is_one_touch_target_and_wide_summary_stays_on_one_line(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        for (width, height) in [(390., 640.), (1200., 840.)] {
            let (view, cx) =
                cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
            cx.simulate_resize(gpui::size(px(width), px(height)));
            view.update(cx, |app, cx| install(app, &host, cx));
            draw(cx);
            let row = cx
                .debug_bounds("clinical-workspace-agenda-checkup-control-0")
                .unwrap();
            assert!(row.size.height >= px(44.));
            let name = cx.debug_bounds("agenda-name-control-0").unwrap();
            let title = cx.debug_bounds("agenda-title-control-0").unwrap();
            let status = cx.debug_bounds("agenda-status-control-0").unwrap();
            let date = cx.debug_bounds("agenda-date-control-0").unwrap();
            if width == 1200. {
                for bounds in [title, status, date] {
                    assert!((bounds.center().y - name.center().y).abs() < px(2.));
                }
                assert!(date.origin.x > status.origin.x);
            } else {
                assert!(title.origin.y > name.origin.y);
                assert!(status.origin.y > title.origin.y);
            }
            cx.update_window_entity(&view, |app, window, cx| {
                window.focus(&app.agenda_flow.targets["control-0"].focus, cx)
            });
            draw(cx);
            activate_focused(cx);
            cx.run_until_parked();
            view.read_with(cx, |app, _| {
                assert_eq!(app.selected_id.as_deref(), Some("patient-a"))
            });
        }
    }

    #[gpui::test]
    fn g7b_return_with_read_in_flight_and_interval_change_reject_retired_results(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        host.plan("GET /api/v1/network/checkups?")
            .send((200, json!([])))
            .unwrap();
        view.update(cx, |app, cx| {
            install(app, &host, cx);
            app.retry_global_read(ReadObject::Agenda, cx);
        });
        while cx.dispatcher.tick(true) {}
        assert_eq!(agenda_calls(&host).len(), 1);
        view.read_with(cx, |app, _| assert!(app.agenda_flow.refresh.is_some()));
        host.plan("GET /api/v1/network/checkups?")
            .send((200, row_values()))
            .unwrap();
        view.update(cx, |app, cx| {
            app.open_agenda_patient("control-3", "patient-a", cx);
            app.return_to_agenda(cx);
            assert!(app.agenda_flow.refresh.is_some());
        });
        draw(cx);
        view.read_with(cx, |app, _| {
            assert_eq!(app.agenda.ready().unwrap().len(), 16);
            assert!(app.agenda_flow.refresh.is_none());
        });
        host.plan("GET /api/v1/network/checkups?")
            .send((200, json!([])))
            .unwrap();
        view.update(cx, |app, cx| app.retry_global_read(ReadObject::Agenda, cx));
        while cx.dispatcher.tick(true) {}
        assert_eq!(agenda_calls(&host).len(), 3);
        host.plan("GET /api/v1/network/checkups?")
            .send((200, row_values()))
            .unwrap();
        view.update(cx, |app, cx| {
            app.global_dates[0]
                .editor
                .update(cx, |input, cx| input.set_content("2026-11-01", cx));
            app.global_dates[1]
                .editor
                .update(cx, |input, cx| input.set_content("2026-11-30", cx));
            app.apply_global_interval(cx);
        });
        while cx.dispatcher.tick(true) {}
        draw(cx);
        view.read_with(cx, |app, _| {
            assert_eq!(app.global_interval.from_day, "2026-11-01");
            assert_eq!(app.agenda.ready().unwrap().len(), 16);
        });
        let expected = calendar_interval("2026-11-01", "2026-11-30", &chrono::Local)
            .unwrap()
            .from
            .unwrap()
            .replace(':', "%3A");
        assert!(
            agenda_calls(&host)
                .iter()
                .any(|route| route.contains(&expected))
        );
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
