use super::references::line;
use super::*;
use mediflow_runtime_client::{PreparedRetentionCommand, RETENTION_HOLD_REASONS, RetentionOutcome};
use serde_json::{Value, json};

const WINDOW_IDS: [&str; 8] = [
    "retention-window-0",
    "retention-window-1",
    "retention-window-2",
    "retention-window-3",
    "retention-window-4",
    "retention-window-5",
    "retention-window-6",
    "retention-window-7",
];

/// Conservazione dei dati sanitari (ADR 0178): profilo, finestre del titolare, blocchi e scarto.
pub(super) struct RetentionArea {
    pub(super) busy: bool,
    pub(super) overview: Option<Value>,
    pub(super) command: Option<Arc<PreparedRetentionCommand>>,
    pub(super) message: Option<(String, bool)>,
    hold_reason: usize,
    windows: Vec<Entity<TextInput>>,
    hold_patient: Entity<TextInput>,
    hold_document: Entity<TextInput>,
}
impl RetentionArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        Self {
            busy: false,
            overview: None,
            command: None,
            message: None,
            hold_reason: 0,
            windows: WINDOW_IDS
                .iter()
                .map(|id| {
                    cx.new(|cx| {
                        TextInput::new(id, "Anni", "Anni, oppure illimitata", false, theme, cx)
                    })
                })
                .collect(),
            hold_patient: cx.new(|cx| {
                TextInput::new(
                    "retention-hold-patient",
                    "Paziente",
                    "Cognome o nome del paziente",
                    false,
                    theme,
                    cx,
                )
            }),
            hold_document: cx.new(|cx| {
                TextInput::new(
                    "retention-hold-document",
                    "Documento",
                    "Identificativo del documento (facoltativo)",
                    false,
                    theme,
                    cx,
                )
            }),
        }
    }
    fn inputs(&self) -> impl Iterator<Item = &Entity<TextInput>> {
        self.windows
            .iter()
            .chain([&self.hold_patient, &self.hold_document])
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        self.busy = false;
        self.overview = None;
        self.command = None;
        self.message = None;
        for input in self.inputs() {
            input.update(cx, |input, cx| input.retire(cx));
        }
    }
    pub(super) fn configure(&self, theme: Theme, locked: bool, cx: &mut Context<ClinicalApp>) {
        let locked = locked || self.busy || self.command.is_some();
        for input in self.inputs() {
            input.update(cx, |input, cx| input.configure(theme, locked, cx));
        }
    }
    fn categories(&self) -> Vec<(String, String)> {
        self.overview
            .as_ref()
            .and_then(|o| o["categories"].as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|c| {
                        Some((
                            c["id"].as_str()?.to_owned(),
                            c["label"].as_str()?.to_owned(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
    /// Le finestre già salvate tornano nei campi a ogni lettura.
    fn fill_windows(&self, cx: &mut Context<ClinicalApp>) {
        let Some(overview) = &self.overview else {
            return;
        };
        for (i, (id, _)) in self
            .categories()
            .iter()
            .enumerate()
            .take(self.windows.len())
        {
            let window = &overview["windows"][id];
            let text = match window["kind"].as_str() {
                Some("years") => window["years"].to_string(),
                Some("unlimited") => "illimitata".into(),
                _ => String::new(),
            };
            self.windows[i].update(cx, |input, cx| input.set_content(text, cx));
        }
    }
    fn windows_value(&self, cx: &App) -> std::result::Result<Value, String> {
        let mut windows = json!({});
        for (i, (id, label)) in self
            .categories()
            .iter()
            .enumerate()
            .take(self.windows.len())
        {
            let raw = self.windows[i].read(cx).value().trim().to_lowercase();
            if raw.is_empty() {
                continue;
            }
            windows[id] = if raw == "illimitata" {
                json!({"kind":"unlimited"})
            } else {
                let years = raw
                    .parse::<u64>()
                    .ok()
                    .filter(|y| (1..=100).contains(y))
                    .ok_or_else(|| {
                        format!("{label}: indica gli anni da 1 a 100, oppure illimitata.")
                    })?;
                json!({"kind":"years","years":years})
            };
        }
        Ok(windows)
    }
}

fn term_copy(term: &Value) -> String {
    match term["kind"].as_str() {
        Some("years") => format!("{} anni", term["years"]),
        Some("unlimited") => "illimitata".into(),
        _ => "da fissare dal titolare".into(),
    }
}

fn date_copy(seconds: &Value) -> String {
    seconds
        .as_i64()
        .and_then(|s| chrono::DateTime::from_timestamp(s, 0))
        .map(|d| d.format("%d/%m/%Y").to_string())
        .unwrap_or_else(|| "data non nota".into())
}

impl ClinicalApp {
    fn retention_patient_label(&self, patient_id: &str) -> String {
        match &self.patients {
            Load::Ready(patients) => patients
                .iter()
                .find(|p| p.id == patient_id)
                .map(|p| {
                    format!("{} {}", p.last_name, p.first_name)
                        .trim()
                        .to_owned()
                })
                .unwrap_or_else(|| "una scheda non presente nell’elenco".into()),
            _ => "una scheda non ancora letta".into(),
        }
    }
    pub(in crate::shell) fn read_retention(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let area = &mut self.local_host.retention;
        area.busy = true;
        area.command = None;
        self.run_local_host(
            move || access.read_retention(),
            |this, result, cx| {
                let area = &mut this.local_host.retention;
                area.busy = false;
                match result {
                    Ok(overview) => {
                        area.overview = Some(overview);
                        area.fill_windows(cx);
                    }
                    Err(error) if error.retires_session() => {
                        this.disconnect(cx);
                        this.message = Some((ui_error(error), true));
                    }
                    Err(error) => {
                        area.overview = None;
                        area.message = Some((ui_error(error), true));
                    }
                }
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }
    fn prepare_retention(
        &mut self,
        build: impl FnOnce(
            &LocalHostAccess,
            &Value,
            &App,
        ) -> std::result::Result<PreparedRetentionCommand, String>,
        cx: &mut Context<Self>,
    ) {
        if self.local_host.has_work() {
            return;
        }
        let (Some(access), Some(overview)) = (
            self.local_host.access(),
            self.local_host.retention.overview.clone(),
        ) else {
            return;
        };
        let outcome = build(&access, &overview, cx);
        let area = &mut self.local_host.retention;
        match outcome {
            Ok(command) => {
                area.command = Some(Arc::new(command));
                area.message = None;
            }
            Err(message) => area.message = Some((message, true)),
        }
        cx.notify();
    }
    fn prepare_retention_windows(&mut self, cx: &mut Context<Self>) {
        let windows = self.local_host.retention.windows_value(cx);
        self.prepare_retention(
            move |access, overview, _| {
                access
                    .prepare_retention_windows(overview, windows?)
                    .map_err(ui_error)
            },
            cx,
        );
    }
    fn prepare_retention_hold(&mut self, patient_id: String, cx: &mut Context<Self>) {
        let label = self.retention_patient_label(&patient_id);
        let area = &self.local_host.retention;
        let reason = RETENTION_HOLD_REASONS[area.hold_reason].0;
        let document = area.hold_document.read(cx).value().trim().to_owned();
        self.prepare_retention(
            move |access, overview, _| {
                access
                    .prepare_retention_hold(
                        overview,
                        &patient_id,
                        Some(document.as_str()),
                        reason,
                        &label,
                    )
                    .map_err(ui_error)
            },
            cx,
        );
    }
    fn prepare_retention_release(
        &mut self,
        hold_id: String,
        patient_id: String,
        cx: &mut Context<Self>,
    ) {
        let label = self.retention_patient_label(&patient_id);
        self.prepare_retention(
            move |access, overview, _| {
                access
                    .prepare_retention_release(overview, &hold_id, &label)
                    .map_err(ui_error)
            },
            cx,
        );
    }
    fn prepare_retention_discard(&mut self, patient_id: String, cx: &mut Context<Self>) {
        let label = self.retention_patient_label(&patient_id);
        self.prepare_retention(
            move |access, overview, _| {
                access
                    .prepare_retention_discard(overview, &patient_id, &label)
                    .map_err(ui_error)
            },
            cx,
        );
    }
    fn confirm_retention(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let Some(command) = self.local_host.retention.command.take() else {
            return;
        };
        self.local_host.retention.busy = true;
        self.run_local_host(
            move || access.apply_retention_command(&command),
            |this, result, cx| {
                let area = &mut this.local_host.retention;
                area.busy = false;
                match result {
                    Ok(RetentionOutcome::Done(_)) => {
                        area.message = Some(("Registrato. Stato riletto dall’host.".into(), false));
                        area.hold_document
                            .update(cx, |input, cx| input.set_content("", cx));
                    }
                    Ok(RetentionOutcome::Refused(message)) => area.message = Some((message, true)),
                    Err(error) if error.retires_session() => {
                        this.disconnect(cx);
                        this.message = Some((ui_error(error), true));
                        cx.notify();
                        return;
                    }
                    Err(error) => {
                        area.message = Some((
                            format!(
                                "{} L’esito potrebbe non essere noto: lo stato viene riletto.",
                                ui_error(error)
                            ),
                            true,
                        ))
                    }
                }
                let message = this.local_host.retention.message.clone();
                this.read_retention(cx);
                this.local_host.retention.message = message;
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }

    pub(in crate::shell) fn retention_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.retention;
        let enabled = !self.local_host.has_work();
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(heading(
                "retention-heading",
                "Conservazione dei dati",
                theme,
            ))
            .child(self.local_host_panel(cx));
        if self.local_host.access().is_none() {
            return pane;
        }
        pane = pane.child(
            button(
                "retention-read",
                "Rileggi la conservazione",
                theme,
                false,
                enabled,
            )
            .on_click(cx.listener(|this, _, _, cx| this.read_retention(cx))),
        );
        if area.busy {
            pane = pane.child(notice(
                "retention-busy",
                "Operazione in corso…",
                theme,
                false,
            ));
        }
        if let Some((message, error)) = &area.message {
            pane = pane.child(notice("retention-message", message.clone(), theme, *error));
        }
        let Some(overview) = &area.overview else {
            return pane.child(text!("Stato non ancora letto."));
        };
        if overview["status"] != "ready" {
            return pane.child(notice(
                "retention-unreadable",
                "Lo stato della conservazione non è leggibile: nessun fascicolo risulta scaduto e la cancellazione amministrata è bloccata.",
                theme,
                true,
            ));
        }
        if let Some(command) = &area.command {
            return pane
                .child(confirmation_heading(
                    crate::title::TitleText::from(command.summary().to_owned()),
                    theme,
                ))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        .child(
                            button("retention-cancel", "Annulla", theme, false, enabled).on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.local_host.retention.command = None;
                                    cx.notify();
                                }),
                            ),
                        )
                        .child(
                            button(
                                "retention-confirm",
                                if command.destructive() {
                                    "Scarta definitivamente"
                                } else {
                                    "Conferma"
                                },
                                theme,
                                true,
                                enabled,
                            )
                            .when(command.destructive(), |el| {
                                el.bg(theme.critical)
                                    .border_color(theme.critical)
                                    .text_color(theme.paper)
                            })
                            .on_click(cx.listener(|this, _, _, cx| this.confirm_retention(cx))),
                        ),
                );
        }
        // Profilo e fonti.
        pane = pane
            .child(section("retention-profile", "Profilo", theme))
            .child(text!(
                overview["profile"]["label"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned()
            ))
            .child(text!("Segue l’assetto territoriale dell’installazione."));
        for (i, source) in overview["sources"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            pane = pane.child(div().id(("retention-source", i)).child(text!(format!(
                "{} · {}",
                source["label"].as_str().unwrap_or(""),
                source["href"].as_str().unwrap_or("")
            ))));
        }
        // Finestre.
        pane = pane
            .child(section("retention-terms", "Termini per categoria", theme))
            .child(text!(
                "Lascia vuoto per usare il minimo del profilo. Le finestre possono solo allungarlo."
            ));
        for (i, (id, label)) in area
            .categories()
            .iter()
            .enumerate()
            .take(area.windows.len())
        {
            let minimum = &overview["profile"]["terms"][id];
            pane = pane.child(
                div()
                    .id(("retention-category", i))
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(text!(label.clone()))
                    .child(text!(format!("Minimo: {}.", term_copy(&minimum["term"]))))
                    .child(area.windows[i].clone()),
            );
        }
        pane = pane.child(
            button(
                "retention-windows-prepare",
                "Rivedi le finestre",
                theme,
                false,
                enabled,
            )
            .on_click(cx.listener(|this, _, _, cx| this.prepare_retention_windows(cx))),
        );
        // Blocchi.
        pane = pane.child(section("retention-holds", "Blocchi", theme));
        for (i, hold) in overview["holds"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let patient = hold["patientId"].as_str().unwrap_or("").to_owned();
            let id = hold["id"].as_str().unwrap_or("").to_owned();
            let reason = RETENTION_HOLD_REASONS
                .iter()
                .find(|(code, _)| hold["reason"] == *code)
                .map(|(_, label)| *label)
                .unwrap_or("");
            let scope = if hold["attachmentId"].is_string() {
                "documento"
            } else {
                "fascicolo"
            };
            pane = pane.child(
                div()
                    .id(("retention-hold", i))
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(line(
                        &self.retention_patient_label(&patient),
                        format!("{scope} · {reason} · dal {}", date_copy(&hold["placedAt"])),
                        theme,
                    ))
                    .child(
                        button(
                            format!("retention-release-{i}"),
                            "Revoca il blocco",
                            theme,
                            false,
                            enabled,
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.prepare_retention_release(id.clone(), patient.clone(), cx)
                        })),
                    ),
            );
        }
        pane = pane.child(text!("Nuovo blocco: cerca il paziente, scegli il motivo; per un solo documento indica il suo identificativo."));
        pane = pane
            .child(area.hold_patient.clone())
            .child(area.hold_document.clone())
            .child(
                div().flex().flex_wrap().gap(px(8.)).children(
                    RETENTION_HOLD_REASONS
                        .iter()
                        .enumerate()
                        .map(|(i, (_, label))| {
                            button(
                                format!("retention-reason-{i}"),
                                *label,
                                theme,
                                false,
                                enabled,
                            )
                            .aria_selected(area.hold_reason == i)
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    this.local_host.retention.hold_reason = i;
                                    cx.notify();
                                },
                            ))
                        }),
                ),
            );
        let query = area.hold_patient.read(cx).value().trim().to_lowercase();
        if query.chars().count() >= 2
            && let Load::Ready(patients) = &self.patients
        {
            for (i, patient) in patients
                .iter()
                .filter(|p| {
                    format!("{} {}", p.last_name, p.first_name)
                        .to_lowercase()
                        .contains(&query)
                })
                .take(5)
                .enumerate()
            {
                let id = patient.id.clone();
                pane = pane.child(
                    button(
                        format!("retention-hold-place-{i}"),
                        format!("Blocca {} {}", patient.last_name, patient.first_name),
                        theme,
                        false,
                        enabled,
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.prepare_retention_hold(id.clone(), cx)
                    })),
                );
            }
        }
        // Revisione: scaduti e sospesi.
        let counts = &overview["counts"];
        pane = pane
            .child(section("retention-review", "Fascicoli da rivedere", theme))
            .child(line("Scaduti", counts["expired"].to_string(), theme))
            .child(line(
                "Sospesi da un blocco",
                counts["held"].to_string(),
                theme,
            ))
            .child(line(
                "In conservazione",
                counts["in_retention"].to_string(),
                theme,
            ));
        for (i, item) in overview["review"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let patient = item["patientId"].as_str().unwrap_or("").to_owned();
            let label = self.retention_patient_label(&patient);
            let row = div()
                .id(("retention-item", i))
                .flex()
                .flex_col()
                .gap(px(4.));
            pane = pane.child(if item["status"] == "expired" {
                row.child(line(
                    &label,
                    format!("scaduto il {}", date_copy(&item["expiresAt"])),
                    theme,
                ))
                .child(
                    button(
                        format!("retention-discard-{i}"),
                        "Rivedi lo scarto",
                        theme,
                        false,
                        enabled,
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.prepare_retention_discard(patient.clone(), cx)
                    })),
                )
            } else {
                row.child(line(&label, "sospeso da un blocco", theme))
            });
        }
        pane
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ROUTE: &str = "/api/system/retention";

    fn overview(windows_revision: u64, windows: Value) -> Value {
        json!({"status":"ready","evaluatedAt":1,"preset":"core+it+lom","profileId":"lom",
            "windowsRevision":windows_revision,"windows":windows,"holdsRevision":0,"holds":[],
            "profile":{"id":"lom","label":"Lombardia","terms":{
                "ambulatory_record":{"term":{"kind":"years","years":10},"basis":"source","sourceId":"lom-rev04"},
                "imaging_iconography":{"term":{"kind":"unlimited"},"basis":"source","sourceId":"lom-rev04"}}},
            "sources":[{"id":"lom-rev04","label":"Regione Lombardia, titolario","href":"https://example.invalid/lom"}],
            "categories":[{"id":"ambulatory_record","label":"Fascicolo ambulatoriale"},{"id":"imaging_iconography","label":"Iconografia radiologica"}],
            "counts":{"expired":1,"held":0,"in_retention":3},
            "review":[{"patientId":"patient-a","version":4,"status":"expired","expiresAt":1646092800,"closureEstimate":1,"governing":null,"holdIds":[]}]})
    }

    #[gpui::test]
    fn retention_page_saves_windows_holds_a_patient_and_reports_a_refused_discard(
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
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let patients: Vec<mediflow_runtime_client::PatientSummary> = serde_json::from_value(json!([
            {"id":"patient-a","firstName":"Amina","lastName":"Sintetica","birthDate":null,"taxCode":"SYNTHETIC","version":1}
        ]))
        .unwrap();
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Retention;
            app.patients = Load::Ready(patients);
            app.local_host.authority = Authority::Open(access.clone());
        });
        let draw = |cx: &mut gpui::VisualTestContext| {
            rendered_command::button_ids(|| {
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                });
            })
        };

        host.plan(&format!("GET {ROUTE}"))
            .send((200, overview(0, json!({}))))
            .unwrap();
        view.update(cx, |app, cx| app.read_retention(cx));
        cx.run_until_parked();
        let ids = draw(cx);
        assert!(ids.iter().any(|id| id == "retention-discard-0"), "{ids:?}");

        // Finestra: 12 anni sul fascicolo ambulatoriale, iconografia lasciata al minimo.
        view.update(cx, |app, cx| {
            app.local_host.retention.windows[0].update(cx, |input, cx| input.set_content("12", cx));
            app.prepare_retention_windows(cx);
            assert!(app.local_host.retention.command.is_some());
        });
        assert!(
            !host.routes().iter().any(|r| r.starts_with("PUT")),
            "nothing is written before the confirmation"
        );
        host.plan(&format!("PUT {ROUTE}"))
            .send((
                200,
                json!({"schemaVersion":"mediflow.retention.v1","revision":1,"windows":{}}),
            ))
            .unwrap();
        host.plan(&format!("GET {ROUTE}"))
            .send((
                200,
                overview(1, json!({"ambulatory_record":{"kind":"years","years":12}})),
            ))
            .unwrap();
        view.update(cx, |app, cx| app.confirm_retention(cx));
        cx.run_until_parked();
        assert_eq!(
            host.bodies(&format!("PUT {ROUTE}")),
            vec![
                json!({"confirmed":true,"expectedRevision":0,"windows":{"ambulatory_record":{"kind":"years","years":12}}})
            ]
        );
        view.update(cx, |app, cx| {
            assert_eq!(
                app.local_host.retention.windows[0].read(cx).value(),
                "12",
                "the saved window comes back from the host"
            );
            assert_eq!(
                app.local_host.retention.message,
                Some(("Registrato. Stato riletto dall’host.".into(), false))
            );
            // Un valore fuori intervallo resta nella pagina con il motivo, senza comando.
            app.local_host.retention.windows[1].update(cx, |input, cx| input.set_content("0", cx));
            app.prepare_retention_windows(cx);
            assert!(app.local_host.retention.command.is_none());
            assert!(
                app.local_host
                    .retention
                    .message
                    .as_ref()
                    .is_some_and(|(m, e)| *e && m.starts_with("Iconografia radiologica"))
            );
            app.local_host.retention.windows[1].update(cx, |input, cx| input.set_content("", cx));
        });

        // Blocco: la ricerca per nome offre il paziente, il motivo scelto entra nel corpo.
        view.update(cx, |app, cx| {
            app.local_host
                .retention
                .hold_patient
                .update(cx, |input, cx| input.set_content("sint", cx));
            app.local_host.retention.hold_reason = 2;
        });
        let ids = draw(cx);
        assert!(
            ids.iter().any(|id| id == "retention-hold-place-0"),
            "{ids:?}"
        );
        view.update(cx, |app, cx| {
            app.prepare_retention_hold("patient-a".into(), cx)
        });
        view.update(cx, |app, _| {
            let command = app.local_host.retention.command.as_ref().unwrap();
            assert_eq!(command.body(), &json!({"action":"hold.place","confirmed":true,"expectedRevision":0,"patientId":"patient-a","reason":"inspection"}));
            assert!(command.summary().contains("Sintetica Amina") && !command.destructive());
            app.local_host.retention.command = None;
        });

        // Scarto: conferma distruttiva, poi il rifiuto del server arriva con il suo messaggio e lo stato si rilegge.
        view.update(cx, |app, cx| {
            app.prepare_retention_discard("patient-a".into(), cx)
        });
        view.update(cx, |app, _| {
            let command = app.local_host.retention.command.as_ref().unwrap();
            assert!(command.destructive());
            assert_eq!(command.body()["expectedVersion"], 4);
            assert_eq!(command.body()["expectedExpiresAt"], 1646092800);
        });
        let ids = draw(cx);
        assert!(
            ids.iter().any(|id| id == "retention-confirm")
                && !ids.iter().any(|id| id == "retention-windows-prepare"),
            "{ids:?}"
        );
        host.plan(&format!("POST {ROUTE}"))
            .send((409, json!({"code":"legal_hold"})))
            .unwrap();
        host.plan(&format!("GET {ROUTE}"))
            .send((200, overview(1, json!({}))))
            .unwrap();
        view.update(cx, |app, cx| app.confirm_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, _| {
            assert_eq!(
                app.local_host.retention.message,
                Some(("Il fascicolo è sospeso da un blocco.".into(), true))
            );
            assert!(
                app.local_host.retention.command.is_none()
                    && app.local_host.retention.overview.is_some()
            );
        });
        assert_eq!(
            host.routes()
                .iter()
                .filter(|r| r.starts_with("GET /api/system/retention"))
                .count(),
            3
        );
    }
}
