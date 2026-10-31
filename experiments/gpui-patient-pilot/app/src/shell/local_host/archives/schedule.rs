use super::*;
use mediflow_runtime_client::{BackupScheduleConfig, BackupScheduleStatus, PreparedBackupSchedule};

enum ScheduleOperation {
    Idle,
    Reading,
    Review(Arc<PreparedBackupSchedule>),
    Applying,
}
pub(super) struct ScheduleArea {
    fields: [Entity<TextInput>; 3],
    snapshot: Option<BackupScheduleStatus>,
    enabled: bool,
    volume_acknowledged: bool,
    conflicted: bool,
    operation: ScheduleOperation,
    message: Option<String>,
    _subscriptions: Vec<Subscription>,
}
impl ScheduleArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let fields = [
            "Ora (0-23)",
            "Minuto (0-59)",
            "Cartella dei backup sul computer host",
        ]
        .map(|label| cx.new(|cx| TextInput::new(label, label, label, false, theme, cx)));
        let subscriptions = fields
            .iter()
            .map(|field| cx.subscribe(field, |_, _, _: &InputChanged, cx| cx.notify()))
            .collect();
        Self {
            fields,
            snapshot: None,
            enabled: false,
            volume_acknowledged: false,
            conflicted: false,
            operation: ScheduleOperation::Idle,
            message: None,
            _subscriptions: subscriptions,
        }
    }
    pub(super) fn has_work(&self) -> bool {
        !matches!(self.operation, ScheduleOperation::Idle)
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        self.snapshot = None;
        self.enabled = false;
        self.volume_acknowledged = false;
        self.conflicted = false;
        self.operation = ScheduleOperation::Idle;
        self.message = None;
        for field in &self.fields {
            field.update(cx, |input, cx| input.retire(cx));
        }
    }
    pub(super) fn configure(&self, theme: Theme, cx: &mut App) {
        for field in &self.fields {
            field.update(cx, |input, cx| {
                input.configure(theme, self.snapshot.is_none() || self.has_work(), cx)
            });
        }
    }
    fn draft(&self, cx: &App) -> Result<BackupScheduleConfig, RuntimeError> {
        let mut config = self
            .snapshot
            .as_ref()
            .ok_or(RuntimeError::ReadRequired)?
            .state
            .config
            .clone();
        config.enabled = self.enabled;
        config.volume_protection_acknowledged = self.volume_acknowledged;
        config.hour = self.fields[0]
            .read(cx)
            .value()
            .parse()
            .map_err(|_| RuntimeError::InvalidInput)?;
        config.minute = self.fields[1]
            .read(cx)
            .value()
            .parse()
            .map_err(|_| RuntimeError::InvalidInput)?;
        config.destination_dir = self.fields[2].read(cx).value().to_owned();
        config.validate()?;
        Ok(config)
    }
}
impl ClinicalApp {
    pub(in crate::shell::local_host) fn backup_schedule_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.archives.schedule;
        let available = self.archive_available();
        let mut pane = div().flex().flex_col().gap(px(12.))
            .child(section("backup-schedule-heading", "Backup programmato", theme))
            .child(text!("Esportazione portabile sul computer host, nell’ora locale del sistema. Non comprende account e chiavi e non sostituisce il backup completo cifrato. Nessuna eliminazione automatica delle copie precedenti."))
            .child(button("backup-schedule-read", "Rileggi programmazione", theme, false, available)
                .on_click(cx.listener(|this, _, _, cx| this.read_backup_schedule(cx))));
        if let Some(status) = &area.snapshot {
            pane = pane.child(text!(match status.installed {
                Some(true) => "Programmazione installata sul sistema.",
                Some(false) => "Programmazione non installata sul sistema.",
                None => "Stato della programmazione non confermato.",
            }));
            if !status.supported {
                pane = pane.child(text!("Programmazione non supportata su questo sistema."));
            }
            if let Some(message) = &status.observation_message {
                pane = pane.child(text!(message.clone()));
            }
            pane = pane.child(text!(format!(
                "Ultima esecuzione: {}. Esito: {}.",
                status
                    .state
                    .run
                    .last_run_at
                    .as_deref()
                    .unwrap_or("non disponibile"),
                status
                    .state
                    .run
                    .last_run_status
                    .as_deref()
                    .unwrap_or("non disponibile")
            )));
            if let Some(message) = &status.state.run.last_run_message {
                pane = pane.child(text!(message.clone()));
            }
            if let Some(path) = &status.state.run.last_artifact_path {
                pane = pane.child(text!(format!("Ultimo file registrato: {path}")));
            }
            pane = pane.child(
                button(
                    "backup-schedule-enabled",
                    if area.enabled {
                        "Backup programmato: attivo"
                    } else {
                        "Backup programmato: disattivo"
                    },
                    theme,
                    false,
                    available && status.installed.is_some(),
                )
                .aria_selected(area.enabled)
                .on_click(cx.listener(|this, _, _, cx| {
                    if this.archive_available() {
                        this.local_host.archives.schedule.enabled =
                            !this.local_host.archives.schedule.enabled;
                        cx.notify();
                    }
                })),
            );
            for field in &area.fields {
                pane = pane.child(crate::text_input::themed(field.clone(), theme));
            }
            pane = pane.child(text!("Il backup portabile contiene identificativi in chiaro. Se la cifratura non è verificabile da MediFlow, confermo di aver verificato che la destinazione è su un volume cifrato e di conservare separatamente la chiave di ripristino. La conferma non è una verifica di MediFlow."))
                .child(button("backup-volume-acknowledgement", if area.volume_acknowledged { "Requisito del volume confermato" } else { "Confermo il requisito del volume cifrato" }, theme, true, available)
                    .aria_selected(area.volume_acknowledged)
                    .on_click(cx.listener(|this, _, _, cx| {
                        let area = &mut this.local_host.archives.schedule;
                        area.volume_acknowledged = !area.volume_acknowledged;
                        cx.notify();
                    })));
            pane = pane.child(
                button(
                    "backup-schedule-prepare",
                    "Rivedi programmazione",
                    theme,
                    false,
                    available
                        && status.installed.is_some()
                        && (!area.enabled || status.supported)
                        && area.draft(cx).is_ok(),
                )
                .on_click(cx.listener(|this, _, _, cx| this.prepare_backup_schedule(cx))),
            );
        }
        if let ScheduleOperation::Review(command) = &area.operation {
            let config = command.config();
            pane = pane.child(text!(format!("Confermi il backup {} alle {:02}:{:02} nella cartella {}? Le copie precedenti saranno conservate.", if config.enabled { "attivo" } else { "disattivato" }, config.hour, config.minute, config.destination_dir)))
                .child(button("backup-schedule-cancel", "Annulla", theme, true, true).debug_selector(|| "backup-schedule-cancel".into())
                    .on_click(cx.listener(|this, _, _, cx| this.cancel_backup_schedule(cx))))
                .child(button("backup-schedule-confirm", "Conferma programmazione", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| this.confirm_backup_schedule(cx))));
        }
        if matches!(
            area.operation,
            ScheduleOperation::Reading | ScheduleOperation::Applying
        ) {
            pane = pane.child(notice(
                "backup-schedule-progress",
                "Operazione in corso…",
                theme,
                false,
            ));
        }
        if let Some(message) = &area.message {
            pane = pane.child(notice(
                "backup-schedule-message",
                message.clone(),
                theme,
                false,
            ));
        }
        pane
    }
    fn read_backup_schedule(&mut self, cx: &mut Context<Self>) {
        if !self.archive_available() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let preserve_draft = self.local_host.archives.schedule.conflicted;
        self.local_host.archives.schedule.operation = ScheduleOperation::Reading;
        self.local_host.archives.schedule.snapshot = None;
        self.run_local_host(
            move || access.read_backup_schedule(),
            move |this, result, cx| {
                this.local_host.archives.schedule.operation = ScheduleOperation::Idle;
                match result {
                    Ok(status) => {
                        let area = &mut this.local_host.archives.schedule;
                        if !preserve_draft {
                            area.volume_acknowledged = false;
                            area.enabled = status.state.config.enabled;
                            for (field, value) in area.fields.iter().zip([
                                status.state.config.hour.to_string(),
                                status.state.config.minute.to_string(),
                                status.state.config.destination_dir.clone(),
                            ]) {
                                field.update(cx, |input, cx| input.set_content(value, cx));
                            }
                        }
                        area.conflicted = false;
                        area.snapshot = Some(status);
                        area.message = None;
                    }
                    Err(error) => this.local_host.archives.schedule.message = Some(ui_error(error)),
                }
                cx.notify();
            },
            cx,
        );
    }
    fn prepare_backup_schedule(&mut self, cx: &mut Context<Self>) {
        if !self.archive_available() {
            return;
        }
        let area = &self.local_host.archives.schedule;
        let (Some(access), Some(status), Ok(draft)) =
            (self.local_host.access(), &area.snapshot, area.draft(cx))
        else {
            return;
        };
        let expected = status.state.config.clone();
        self.local_host.archives.schedule.operation = ScheduleOperation::Reading;
        self.run_local_host(
            move || access.prepare_backup_schedule(&expected, draft),
            |this, result, cx| {
                let area = &mut this.local_host.archives.schedule;
                area.operation = match result {
                    Ok(command) => {
                        area.message = None;
                        ScheduleOperation::Review(Arc::new(command))
                    }
                    Err(error) => {
                        area.snapshot = None;
                        area.message =
                            Some(format!("{} Rileggi la programmazione.", ui_error(error)));
                        ScheduleOperation::Idle
                    }
                };
                cx.notify();
            },
            cx,
        );
    }
    pub(in crate::shell::local_host) fn cancel_backup_schedule(&mut self, cx: &mut Context<Self>) {
        if matches!(
            self.local_host.archives.schedule.operation,
            ScheduleOperation::Review(_)
        ) {
            self.local_host.archives.schedule.operation = ScheduleOperation::Idle;
            cx.notify();
        }
    }
    fn confirm_backup_schedule(&mut self, cx: &mut Context<Self>) {
        let ScheduleOperation::Review(command) = &self.local_host.archives.schedule.operation
        else {
            return;
        };
        let command = command.clone();
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.archives.schedule.operation = ScheduleOperation::Applying;
        self.run_local_host(move || access.apply_backup_schedule(&command), |this, result, cx| {
            let area = &mut this.local_host.archives.schedule;
            area.operation = ScheduleOperation::Idle;
            area.message = Some(match result {
                Ok(status) => { area.snapshot = Some(status); "Programmazione salvata e riletta dal sistema.".into() },
                Err(error) => { area.conflicted = matches!(error, RuntimeError::Conflict);
                    if !area.conflicted { area.snapshot = None; } format!("{} Bozza conservata. Salvataggio non confermato. Nessun reinvio automatico: rileggi la programmazione prima di procedere.", ui_error(error)) },
            });
            cx.notify();
        }, cx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    fn wire(enabled: bool, installed: Value) -> Value {
        json!({"supported":true,"installed":installed,"state":{"version":1,"revision":"synthetic-revision","config":{
            "enabled":enabled,"hour":2,"minute":0,"destinationDir":std::env::temp_dir().join("synthetic-backups").to_string_lossy(),"retentionKeepArtifacts":14},
            "run":{"lastRunAt":null,"lastRunStatus":null,"lastRunMessage":null,"lastArtifactPath":null}}})
    }
    fn plan(host: &notes_recovery_tests::Host, method: &str, status: u16, body: Value) {
        host.plan(&format!("{method} /api/system/backup-scheduler"))
            .send((status, body))
            .unwrap();
    }

    #[gpui::test]
    fn backup_schedule_review_cancel_lock_and_lost_response_require_fresh_read(
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
        cx.simulate_resize(gpui::size(px(1200.), px(2600.)));
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Archives;
            app.local_host.authority = Authority::Open(access);
        });
        plan(&host, "GET", 200, wire(false, json!(false)));
        view.update(cx, |app, cx| app.read_backup_schedule(cx));
        cx.run_until_parked();
        view.update(cx, |app, _| {
            assert!(app.local_host.archives.schedule.snapshot.is_some())
        });
        plan(&host, "GET", 200, wire(false, json!(false)));
        view.update(cx, |app, cx| {
            app.local_host.archives.schedule.enabled = true;
            app.prepare_backup_schedule(cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, _| {
            assert!(app.local_host.has_work());
            assert!(matches!(
                app.local_host.archives.schedule.operation,
                ScheduleOperation::Review(_)
            ));
        });
        notes_recovery_tests::draw(cx);
        let cancel = cx
            .debug_bounds("backup-schedule-cancel")
            .expect("rendered cancellation");
        cx.simulate_click(cancel.center(), gpui::Modifiers::default());
        cx.run_until_parked();
        view.read_with(cx, |app, _| assert!(!app.local_host.has_work()));
        assert!(
            !host
                .routes()
                .iter()
                .any(|route| route == "POST /api/system/backup-scheduler")
        );
        plan(&host, "GET", 200, wire(false, json!(false)));
        view.update(cx, |app, cx| app.prepare_backup_schedule(cx));
        cx.run_until_parked();
        plan(&host, "GET", 200, wire(false, json!(false)));
        plan(
            &host,
            "POST",
            503,
            json!({"code":"backup_scheduler_outcome_unconfirmed"}),
        );
        view.update(cx, |app, cx| app.confirm_backup_schedule(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(!app.local_host.has_work());
            assert!(app.local_host.archives.schedule.snapshot.is_none());
            assert!(
                app.local_host
                    .archives
                    .schedule
                    .message
                    .as_ref()
                    .unwrap()
                    .contains("Nessun reinvio")
            );
            app.confirm_backup_schedule(cx);
            app.prepare_backup_schedule(cx);
        });
        assert_eq!(
            host.routes()
                .iter()
                .filter(|route| route.as_str() == "POST /api/system/backup-scheduler")
                .count(),
            1
        );
        plan(&host, "GET", 200, wire(true, json!(true)));
        view.update(cx, |app, cx| app.read_backup_schedule(cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert_eq!(
                app.local_host
                    .archives
                    .schedule
                    .snapshot
                    .as_ref()
                    .unwrap()
                    .installed,
                Some(true)
            );
            app.disconnect(cx);
            assert!(app.local_host.archives.schedule.snapshot.is_none());
            for field in &app.local_host.archives.schedule.fields {
                assert!(field.read(cx).value().is_empty());
            }
        });
    }
    #[gpui::test]
    fn backup_schedule_post_conflict_preserves_draft_after_reread(cx: &mut gpui::TestAppContext) {
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
            app.settings_page = SettingsPage::Archives;
            app.local_host.authority = Authority::Open(access);
        });
        plan(&host, "GET", 200, wire(false, json!(false)));
        view.update(cx, |app, cx| app.read_backup_schedule(cx));
        cx.run_until_parked();
        plan(&host, "GET", 200, wire(false, json!(false)));
        view.update(cx, |app, cx| {
            app.local_host.archives.schedule.fields[0]
                .update(cx, |input, cx| input.set_content("4".to_string(), cx));
            app.prepare_backup_schedule(cx);
        });
        cx.run_until_parked();
        plan(&host, "GET", 200, wire(false, json!(false)));
        plan(
            &host,
            "POST",
            409,
            json!({"code":"backup_scheduler_conflict"}),
        );
        view.update(cx, |app, cx| app.confirm_backup_schedule(cx));
        cx.run_until_parked();
        view.read_with(cx, |app, cx| {
            let area = &app.local_host.archives.schedule;
            assert!(area.conflicted);
            assert!(area.snapshot.is_some());
            assert_eq!(area.fields[0].read(cx).value(), "4");
        });
        let mut newer = wire(false, json!(false));
        newer["state"]["revision"] = json!("synthetic-newer-revision");
        plan(&host, "GET", 200, newer);
        view.update(cx, |app, cx| app.read_backup_schedule(cx));
        cx.run_until_parked();
        view.read_with(cx, |app, cx| {
            let area = &app.local_host.archives.schedule;
            assert_eq!(area.fields[0].read(cx).value(), "4");
            assert_eq!(
                area.snapshot.as_ref().unwrap().state.revision,
                "synthetic-newer-revision"
            );
            assert!(!area.conflicted);
        });
    }
    #[gpui::test]
    fn backup_schedule_archive_replacement_retires_authority(cx: &mut gpui::TestAppContext) {
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
            app.local_host.authority = Authority::Open(access);
        });
        plan(&host, "GET", 409, json!({"code":"ARCHIVE_REPLACED"}));
        view.update(cx, |app, cx| app.read_backup_schedule(cx));
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.session.is_none());
            assert!(app.local_host.access().is_none());
            assert!(app.local_host.archives.schedule.snapshot.is_none());
        });
        assert!(
            !host
                .routes()
                .iter()
                .any(|route| route == "POST /api/system/backup-scheduler")
        );
    }
}
