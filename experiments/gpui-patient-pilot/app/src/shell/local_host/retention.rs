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

fn normalized_window_text(raw: &str) -> String {
    let text = raw.trim().to_lowercase();
    text.parse::<u64>()
        .map(|years| years.to_string())
        .unwrap_or(text)
}

/// Conservazione dei dati sanitari (ADR 0178): profilo, finestre del titolare, blocchi e scarto.
pub(super) struct RetentionArea {
    pub(super) busy: bool,
    pub(super) overview: Option<Value>,
    pub(super) command: Option<Arc<PreparedRetentionCommand>>,
    pub(super) message: Option<(String, bool)>,
    hold_reason: usize,
    windows: Vec<Entity<TextInput>>,
    window_baselines: std::collections::HashMap<String, String>,
    hold_patient: Entity<TextInput>,
    hold_document: Entity<TextInput>,
    /// Nomi dei fascicoli citati da revisione e blocchi, letti da tutte le sedi, archiviati compresi.
    pub(super) identities: std::collections::HashMap<String, String>,
    _subscription: Subscription,
}
impl RetentionArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let hold_patient = cx.new(|cx| {
            TextInput::new(
                "retention-hold-patient",
                "Paziente",
                "Cognome o nome del paziente",
                false,
                theme,
                cx,
            )
        });
        // La ricerca del paziente aggiorna i risultati a ogni carattere.
        let subscription = cx.subscribe(&hold_patient, |_, _, _: &InputChanged, cx| cx.notify());
        Self {
            identities: std::collections::HashMap::new(),
            _subscription: subscription,
            busy: false,
            overview: None,
            command: None,
            message: None,
            hold_reason: 0,
            window_baselines: Default::default(),
            windows: WINDOW_IDS
                .iter()
                .map(|id| {
                    cx.new(|cx| {
                        TextInput::new(id, "Anni", "Anni, oppure illimitata", false, theme, cx)
                    })
                })
                .collect(),
            hold_patient,
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
        self.identities.clear();
        self.window_baselines.clear();
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
    /// Refresh clean fields; a concurrent revision must not replace a local draft.
    fn fill_windows(&mut self, cx: &mut Context<ClinicalApp>) {
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
            let baseline = self.window_baselines.get(id).map_or("", String::as_str);
            if normalized_window_text(self.windows[i].read(cx).value()) == baseline {
                self.windows[i].update(cx, |input, cx| input.set_content(text.clone(), cx));
            }
            self.window_baselines.insert(id.clone(), text);
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
            let raw = normalized_window_text(self.windows[i].read(cx).value());
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

/// Nomi dei pazienti citati nella panoramica, cercati in tutte le sedi fra attivi e archiviati.
/// Cognome, nome e nascita distinguono anche gli omonimi.
fn retention_identities(
    session: &RuntimeSession,
    overview: &Value,
) -> Result<std::collections::HashMap<String, String>, RuntimeError> {
    let wanted: std::collections::HashSet<String> = overview["review"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(overview["holds"].as_array().into_iter().flatten())
        .filter_map(|item| item["patientId"].as_str().map(str::to_owned))
        .collect();
    let mut found = std::collections::HashMap::new();
    if wanted.is_empty() {
        return Ok(found);
    }
    for ambulatory in session.list_ambulatories()? {
        for archived in [true, false] {
            for patient in session.list_patients(&ambulatory.id, archived)? {
                if wanted.contains(&patient.id) {
                    let born = patient
                        .birth_date
                        .as_deref()
                        .map(|d| format!(", nato il {d}"))
                        .unwrap_or_default();
                    found.insert(
                        patient.id.clone(),
                        format!("{} {}{born}", patient.last_name, patient.first_name)
                            .trim()
                            .to_owned(),
                    );
                }
            }
        }
        if found.len() == wanted.len() {
            break;
        }
    }
    Ok(found)
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
        if let Some(name) = self.local_host.retention.identities.get(patient_id) {
            return name.clone();
        }
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
        if matches!(self.patients, Load::Idle) {
            self.load_patients(cx);
        }
        let area = &mut self.local_host.retention;
        area.busy = true;
        area.command = None;
        let session = self.session.clone();
        self.run_local_host(
            move || {
                let overview = access.read_retention()?;
                let identities = match session {
                    Some(session) => retention_identities(&session, &overview)?,
                    None => Default::default(),
                };
                Ok((overview, identities))
            },
            |this, result, cx| {
                let area = &mut this.local_host.retention;
                area.busy = false;
                match result {
                    Ok((overview, identities)) => {
                        area.overview = Some(overview);
                        area.identities = identities;
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
        // Uno scarto definitivo si conferma solo su un fascicolo di cui si legge il nome.
        if !self
            .local_host
            .retention
            .identities
            .contains_key(&patient_id)
        {
            self.local_host.retention.message = Some((
                "Il nome di questo fascicolo non è leggibile da questa sessione: lo scarto non può essere confermato.".into(),
                true,
            ));
            cx.notify();
            return;
        }
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
                        area.message =
                            Some(("Registrato. Stato riletto dall’home-base.".into(), false));
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
            let known = area.identities.contains_key(&patient);
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
                        enabled && known,
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

    fn plan_identities(host: &notes_recovery_tests::Host, archived: Value) {
        host.plan("GET /api/v1/network/patients")
            .send((200, archived))
            .unwrap();
        host.plan("GET /api/v1/network/patients")
            .send((200, json!([])))
            .unwrap();
    }
    fn archived_patient() -> Value {
        json!([{"id":"patient-a","firstName":"Amina","lastName":"Sintetica","birthDate":"1940-01-01","taxCode":"SYNTHETIC","version":4,"isArchived":true,"deletedAt":null}])
    }

    fn saved_noncanonical_window_follows_host(
        cx: &mut gpui::TestAppContext,
        draft: &str,
        saved_term: Value,
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
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.patients = Load::Ready(Vec::new());
            app.local_host.authority = Authority::Open(access);
        });
        let plan_read = |revision, windows| {
            host.plan(&format!("GET {ROUTE}"))
                .send((200, overview(revision, windows)))
                .unwrap();
            plan_identities(&host, archived_patient());
        };
        plan_read(1, json!({"ambulatory_record":{"kind":"years","years":11}}));
        view.update(cx, |app, cx| app.read_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            app.local_host.retention.windows[0]
                .update(cx, |input, cx| input.set_content(draft, cx));
            app.prepare_retention_windows(cx);
        });
        let saved_windows = json!({"ambulatory_record":saved_term});
        host.plan(&format!("PUT {ROUTE}"))
            .send((
                200,
                json!({"schemaVersion":"mediflow.retention.v1","revision":2,"windows":saved_windows}),
            ))
            .unwrap();
        plan_read(2, saved_windows.clone());
        view.update(cx, |app, cx| app.confirm_retention(cx));
        cx.run_until_parked();
        assert_eq!(
            host.bodies(&format!("PUT {ROUTE}")),
            vec![json!({"confirmed":true,"expectedRevision":1,"windows":saved_windows})]
        );
        view.update(cx, |app, _| {
            assert!(!app.local_host.retention.message.as_ref().unwrap().1);
            assert_eq!(
                app.local_host.retention.overview.as_ref().unwrap()["windowsRevision"],
                2
            );
        });

        let concurrent_windows = json!({"ambulatory_record":{"kind":"years","years":14}});
        plan_read(3, concurrent_windows);
        view.update(cx, |app, cx| app.read_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(
                app.local_host.retention.windows[0].read(cx).value(),
                "14",
                "accepted draft {draft:?} must become clean and follow a later host revision"
            );
            app.local_host.retention.windows[1].update(cx, |input, cx| input.set_content("16", cx));
            app.prepare_retention_windows(cx);
        });
        let next_windows = json!({
            "ambulatory_record":{"kind":"years","years":14},
            "imaging_iconography":{"kind":"years","years":16}
        });
        host.plan(&format!("PUT {ROUTE}"))
            .send((
                200,
                json!({"schemaVersion":"mediflow.retention.v1","revision":4,"windows":next_windows}),
            ))
            .unwrap();
        plan_read(4, next_windows.clone());
        view.update(cx, |app, cx| app.confirm_retention(cx));
        cx.run_until_parked();
        assert_eq!(
            host.bodies(&format!("PUT {ROUTE}")),
            vec![
                json!({"confirmed":true,"expectedRevision":1,"windows":saved_windows}),
                json!({"confirmed":true,"expectedRevision":3,"windows":next_windows})
            ],
            "saving another category must not resubmit the old accepted draft"
        );
    }

    #[gpui::test]
    fn retention_saved_leading_zero_window_follows_host(cx: &mut gpui::TestAppContext) {
        saved_noncanonical_window_follows_host(cx, "012", json!({"kind":"years","years":12}));
    }

    #[gpui::test]
    fn retention_saved_trailing_space_window_follows_host(cx: &mut gpui::TestAppContext) {
        saved_noncanonical_window_follows_host(cx, "12 ", json!({"kind":"years","years":12}));
    }

    #[gpui::test]
    fn retention_saved_uppercase_unlimited_window_follows_host(cx: &mut gpui::TestAppContext) {
        saved_noncanonical_window_follows_host(cx, "ILLIMITATA", json!({"kind":"unlimited"}));
    }

    #[gpui::test]
    fn retention_conflict_preserves_window_draft_for_explicit_new_confirmation(
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
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.patients = Load::Ready(Vec::new());
            app.local_host.authority = Authority::Open(access);
        });
        let windows = |years| json!({"ambulatory_record":{"kind":"years","years":years}});
        let plan_read = |revision, years| {
            host.plan(&format!("GET {ROUTE}"))
                .send((200, overview(revision, windows(years))))
                .unwrap();
            plan_identities(&host, archived_patient());
        };
        plan_read(1, 11);
        view.update(cx, |app, cx| app.read_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            app.local_host.retention.windows[0].update(cx, |input, cx| input.set_content("12", cx));
            app.prepare_retention_windows(cx);
        });
        host.plan(&format!("PUT {ROUTE}"))
            .send((409, json!({"code":"conflict"})))
            .unwrap();
        plan_read(2, 14);
        view.update(cx, |app, cx| app.confirm_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(
                app.local_host.retention.windows[0].read(cx).value(),
                "12",
                "a rejected write must not replace the clinician's draft with the concurrent value"
            );
            assert_eq!(
                app.local_host.retention.overview.as_ref().unwrap()["windowsRevision"],
                2
            );
            assert!(app.local_host.retention.command.is_none());
            assert!(app.local_host.retention.message.as_ref().unwrap().1);
            app.prepare_retention_windows(cx);
            let command = app.local_host.retention.command.as_ref().unwrap();
            assert_eq!(command.body()["expectedRevision"], 2);
            assert_eq!(command.body()["windows"], windows(12));
        });
        assert_eq!(
            host.bodies(&format!("PUT {ROUTE}")).len(),
            1,
            "no automatic retry"
        );
        host.plan(&format!("PUT {ROUTE}"))
            .send((
                200,
                json!({"schemaVersion":"mediflow.retention.v1","revision":3,"windows":windows(12)}),
            ))
            .unwrap();
        plan_read(3, 12);
        view.update(cx, |app, cx| app.confirm_retention(cx));
        cx.run_until_parked();
        // Once the accepted draft has been read back, a later clean field follows the host.
        plan_read(4, 15);
        view.update(cx, |app, cx| app.read_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(app.local_host.retention.windows[0].read(cx).value(), "15");
        });
        assert_eq!(host.bodies(&format!("PUT {ROUTE}")).len(), 2);
    }

    #[gpui::test]
    fn wul839_retention_search_loads_people_without_visiting_the_directory(
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
        let mut empty = overview(0, json!({}));
        empty["review"] = json!([]);
        host.plan(&format!("GET {ROUTE}"))
            .send((200, empty))
            .unwrap();
        host.plan("GET /api/v1/network/patients")
            .send((
                200,
                json!([
                    {"id":"patient-a","firstName":"Amina","lastName":"Sintetica","birthDate":null,
                     "taxCode":"SYNTHETIC","version":1}
                ]),
            ))
            .unwrap();
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Retention;
            app.local_host.authority = Authority::Open(access);
            app.read_retention(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            app.local_host
                .retention
                .hold_patient
                .update(cx, |input, cx| input.set_content("Sintetica", cx));
            cx.notify();
        });
        let commands = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert!(
            commands.iter().any(|id| id == "retention-hold-place-0"),
            "retention must not depend on a prior visit to Patients: {commands:?}"
        );
        assert!(host.routes().iter().all(|route| route.starts_with("GET ")
            || route.starts_with("POST /api/auth/")
            || route == "POST /api/v1/network/pairing/confirm"));
    }

    fn conflict_with_initial_twelve(
        cx: &mut gpui::TestAppContext,
        draft: &str,
        expected_after_conflict: &str,
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
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.patients = Load::Ready(Vec::new());
            app.local_host.authority = Authority::Open(access);
        });
        let windows = |years| json!({"ambulatory_record":{"kind":"years","years":years}});
        host.plan(&format!("GET {ROUTE}"))
            .send((200, overview(1, windows(12))))
            .unwrap();
        plan_identities(&host, archived_patient());
        view.update(cx, |app, cx| app.read_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            app.local_host.retention.windows[0]
                .update(cx, |input, cx| input.set_content(draft, cx));
            assert_eq!(app.local_host.retention.windows[0].read(cx).value(), draft);
            app.prepare_retention_windows(cx);
        });
        host.plan(&format!("PUT {ROUTE}"))
            .send((409, json!({"code":"conflict"})))
            .unwrap();
        host.plan(&format!("GET {ROUTE}"))
            .send((200, overview(2, windows(14))))
            .unwrap();
        plan_identities(&host, archived_patient());
        view.update(cx, |app, cx| app.confirm_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(
                app.local_host.retention.windows[0].read(cx).value(),
                expected_after_conflict
            );
            assert_eq!(
                app.local_host.retention.overview.as_ref().unwrap()["windowsRevision"],
                2
            );
            assert!(app.local_host.retention.command.is_none());
            assert!(app.local_host.retention.message.as_ref().unwrap().1);
        });
        assert_eq!(
            host.bodies(&format!("PUT {ROUTE}")).len(),
            1,
            "no automatic retry"
        );
    }

    #[gpui::test]
    fn retention_conflict_equivalent_leading_zero_draft_follows_remote(
        cx: &mut gpui::TestAppContext,
    ) {
        conflict_with_initial_twelve(cx, "012", "14");
    }

    #[gpui::test]
    fn retention_conflict_distinct_draft_preserves_thirteen(cx: &mut gpui::TestAppContext) {
        conflict_with_initial_twelve(cx, "13", "13");
    }

    #[gpui::test]
    fn retention_conflict_distinct_normalized_draft_preserves_leading_zero(
        cx: &mut gpui::TestAppContext,
    ) {
        conflict_with_initial_twelve(cx, "013", "013");
    }

    #[gpui::test]
    fn retention_search_finds_a_patient_created_after_the_directory_was_read(
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
        host.plan("POST /api/v1/network/patients")
            .send((201, json!({"id":"patient-a", "version":1})))
            .unwrap();
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.patients = Load::Ready(vec![]);
            app.local_host.authority = Authority::Open(access);
            app.new_patient(cx);
            for (index, value) in [
                (0, "Amina"),
                (1, "Sintetica"),
                (2, "SYNTHETIC"),
                (8, "other"),
            ] {
                app.form.as_mut().unwrap().fields[index]
                    .editor
                    .update(cx, |input, cx| input.set_content(value, cx));
            }
            app.form.as_mut().unwrap().state = FormState::Review;
            app.confirm_form(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, _| {
            assert!(
                app.form.is_none(),
                "creation must be verified: {:?}",
                app.message
            );
            assert_eq!(app.patient.detail.ready().unwrap().id, "patient-a");
        });

        let mut empty = overview(0, json!({}));
        empty["review"] = json!([]);
        host.plan(&format!("GET {ROUTE}"))
            .send((200, empty))
            .unwrap();
        host.plan("GET /api/v1/network/patients")
            .send((
                200,
                json!([
                    {"id":"patient-a","firstName":"Amina","lastName":"Sintetica","birthDate":null,
                     "taxCode":"SYNTHETIC","version":1}
                ]),
            ))
            .unwrap();
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Retention;
            app.read_retention(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            app.local_host
                .retention
                .hold_patient
                .update(cx, |input, cx| input.set_content("Sintetica", cx));
            cx.notify();
        });
        let commands = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert!(
            commands.iter().any(|id| id == "retention-hold-place-0"),
            "a newly created patient must be searchable without reopening Patients: {commands:?}"
        );
        assert_eq!(
            host.routes()
                .iter()
                .filter(|route| route.as_str() == "POST /api/v1/network/patients")
                .count(),
            1
        );
    }

    #[gpui::test]
    fn retention_revisit_after_patient_creation_refreshes_previously_open_page(
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
        let mut first_overview = overview(0, json!({}));
        first_overview["review"] = json!([]);
        host.plan(&format!("GET {ROUTE}"))
            .send((200, first_overview))
            .unwrap();
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.patients = Load::Ready(vec![]);
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Retention;
            app.local_host.authority = Authority::Open(access.clone());
            app.read_retention(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, _| {
            assert!(app.local_host.retention.overview.is_some());
            app.area = Area::Patients;
        });
        host.plan("POST /api/v1/network/patients")
            .send((201, json!({"id":"patient-a", "version":1})))
            .unwrap();
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.patients = Load::Ready(vec![]);
            app.local_host.authority = Authority::Open(access);
            app.new_patient(cx);
            for (index, value) in [
                (0, "Amina"),
                (1, "Sintetica"),
                (2, "SYNTHETIC"),
                (8, "other"),
            ] {
                app.form.as_mut().unwrap().fields[index]
                    .editor
                    .update(cx, |input, cx| input.set_content(value, cx));
            }
            app.form.as_mut().unwrap().state = FormState::Review;
            app.confirm_form(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, _| {
            assert!(
                app.form.is_none(),
                "creation must be verified: {:?}",
                app.message
            );
            assert_eq!(app.patient.detail.ready().unwrap().id, "patient-a");
        });

        let mut empty = overview(0, json!({}));
        empty["review"] = json!([]);
        host.plan(&format!("GET {ROUTE}"))
            .send((200, empty))
            .unwrap();
        host.plan("GET /api/v1/network/patients")
            .send((
                200,
                json!([
                    {"id":"patient-a","firstName":"Amina","lastName":"Sintetica","birthDate":null,
                     "taxCode":"SYNTHETIC","version":1}
                ]),
            ))
            .unwrap();
        host.plan("GET /api/v1/network/ai-runtime")
            .send((503, json!({})))
            .unwrap();
        host.plan("GET /api/auth/profile")
            .send((503, json!({})))
            .unwrap();
        view.update(cx, |app, cx| {
            assert!(matches!(app.patients, Load::Idle));
            assert_eq!(app.settings_page, SettingsPage::Retention);
            app.navigate(Area::Settings, cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            app.local_host
                .retention
                .hold_patient
                .update(cx, |input, cx| input.set_content("Sintetica", cx));
            cx.notify();
        });
        let commands = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert!(
            commands.iter().any(|id| id == "retention-hold-place-0"),
            "returning to an already opened Retention page must refresh the invalidated directory: {commands:?}"
        );
        for (query, expected) in [
            ("Amina", true),
            ("Sintetica", true),
            ("Sintetica Amina", true),
            ("SYNTHETIC", false),
        ] {
            view.update(cx, |app, cx| {
                app.local_host
                    .retention
                    .hold_patient
                    .update(cx, |input, cx| input.set_content(query, cx));
                cx.notify();
            });
            let commands = rendered_command::button_ids(|| {
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                })
            });
            assert_eq!(
                commands.iter().any(|id| id == "retention-hold-place-0"),
                expected,
                "retention searches surname and given name, not identifier: {query}"
            );
        }
        assert_eq!(
            host.routes()
                .iter()
                .filter(|route| route.as_str() == "POST /api/v1/network/patients")
                .count(),
            1
        );
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
        plan_identities(&host, archived_patient());
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
                Some(("Registrato. Stato riletto dall’home-base.".into(), false))
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
        plan_identities(&host, archived_patient());
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

    /// Un fascicolo archiviato di un'altra sede si scarta solo se se ne legge il nome; la ricerca aggiorna la pagina.
    #[gpui::test]
    fn discard_needs_a_readable_identity_and_search_notifies_the_page(
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
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Retention;
            app.local_host.authority = Authority::Open(access.clone());
        });
        host.plan(&format!("GET {ROUTE}"))
            .send((200, overview(0, json!({}))))
            .unwrap();
        plan_identities(&host, json!([]));
        view.update(cx, |app, cx| app.read_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            app.prepare_retention_discard("patient-a".into(), cx);
            assert!(app.local_host.retention.command.is_none());
            assert!(
                app.local_host
                    .retention
                    .message
                    .as_ref()
                    .is_some_and(|(m, e)| *e && m.contains("non è leggibile"))
            );
        });

        host.plan(&format!("GET {ROUTE}"))
            .send((200, overview(0, json!({}))))
            .unwrap();
        plan_identities(&host, archived_patient());
        view.update(cx, |app, cx| app.read_retention(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(
                app.local_host
                    .retention
                    .identities
                    .get("patient-a")
                    .map(String::as_str),
                Some("Sintetica Amina, nato il 1940-01-01")
            );
            app.prepare_retention_discard("patient-a".into(), cx);
            assert!(
                app.local_host
                    .retention
                    .command
                    .as_ref()
                    .is_some_and(|c| c.summary().contains("Sintetica Amina"))
            );
            app.local_host.retention.command = None;
        });

        let notified = std::rc::Rc::new(std::cell::Cell::new(0));
        let seen = notified.clone();
        cx.update(|_, cx| {
            cx.observe(&view, move |_, _| seen.set(seen.get() + 1))
                .detach()
        });
        let search = view.update(cx, |app, _| app.local_host.retention.hold_patient.clone());
        cx.update(|_, cx| search.update(cx, |_, cx| cx.emit(InputChanged("sint".into()))));
        cx.run_until_parked();
        assert!(
            notified.get() > 0,
            "typing in the patient search re-renders the page"
        );
    }
}
