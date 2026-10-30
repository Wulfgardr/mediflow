use super::*;
use mediflow_runtime_client::{PreparedArchiveRestore, RestoreConfirmation, RestoreLookup};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

enum ArchiveOperation {
    Idle,
    Reading,
    Review(ArchiveReview),
    Applying,
}
#[derive(Clone, Copy)]
enum FilePurpose {
    Restore,
    VerifyRecovery,
}
struct ArchiveReview {
    command: Arc<PreparedArchiveRestore>,
    name: String,
    bytes: usize,
}
enum FileResult {
    Review(ArchiveReview),
    Verified,
}
pub(super) struct ArchiveArea {
    operation: ArchiveOperation,
    confirmation: Entity<TextInput>,
    pending: Option<RestoreLookup>,
    journal: Option<PathBuf>,
    journal_error: bool,
    status: Option<String>,
    receipt_verified: bool,
    focus_review: bool,
    _subscription: Subscription,
}
impl ArchiveArea {
    pub(super) fn new(
        theme: Theme,
        journal: Option<PathBuf>,
        cx: &mut Context<ClinicalApp>,
    ) -> Self {
        let confirmation = cx.new(|cx| {
            TextInput::new(
                "archive-restore-word",
                "Scrivi RIPRISTINA",
                "RIPRISTINA",
                false,
                theme,
                cx,
            )
        });
        let subscription = cx.subscribe(&confirmation, |_, _, _: &InputChanged, cx| cx.notify());
        let (pending, journal_error) = match journal.as_ref().map(|p| read_pending(p)).transpose() {
            Ok(value) => (value.flatten(), false),
            Err(_) => (None, true),
        };
        Self {
            operation: ArchiveOperation::Idle,
            confirmation,
            pending,
            journal,
            journal_error,
            status: None,
            receipt_verified: false,
            focus_review: false,
            _subscription: subscription,
        }
    }
    fn clear_journal(&mut self) -> std::io::Result<()> {
        let (Some(path), Some(lookup)) = (&self.journal, &self.pending) else {
            return Err(std::io::ErrorKind::InvalidInput.into());
        };
        if read_pending(path)?.as_ref() != Some(lookup) {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        fs::remove_file(path)?;
        #[cfg(unix)]
        if let Some(parent) = path.parent() {
            File::open(parent)?.sync_all()?;
        }
        self.pending = None;
        Ok(())
    }
    pub(super) fn has_work(&self) -> bool {
        !matches!(self.operation, ArchiveOperation::Idle)
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        self.operation = ArchiveOperation::Idle;
        self.confirmation.update(cx, |input, cx| input.retire(cx));
        self.status = None;
        self.receipt_verified = false;
        self.focus_review = false;
    }
    pub(super) fn configure(
        &mut self,
        theme: Theme,
        window: &mut Window,
        cx: &mut Context<ClinicalApp>,
    ) {
        let focus_review = std::mem::take(&mut self.focus_review);
        self.confirmation.update(cx, |input, cx| {
            if focus_review {
                input.focus(window, cx);
            }
            input.configure(
                theme,
                !matches!(self.operation, ArchiveOperation::Review(_)),
                cx,
            );
        });
    }
}
fn read_selected(path: &Path, maximum: u64) -> std::io::Result<Zeroizing<Vec<u8>>> {
    if !fs::metadata(path)?.is_file() {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    let file = File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    let mut bytes = Zeroizing::new(Vec::new());
    file.take(maximum + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > maximum {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    Ok(bytes)
}
fn read_pending(path: &Path) -> std::io::Result<Option<RestoreLookup>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => serde_json::from_slice(&read_selected(path, 4096)?)
            .map(Some)
            .map_err(std::io::Error::other),
        Ok(_) => Err(std::io::ErrorKind::InvalidInput.into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}
pub(super) fn write_new(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    if read_selected(path, bytes.len() as u64)?.as_slice() != bytes {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    Ok(())
}
impl ClinicalApp {
    fn archive_available(&self) -> bool {
        self.local_host.access().is_some()
            && !self.local_host.has_work()
            && self.form.is_none()
            && !self.local_host.archives.journal_error
    }
    pub(in crate::shell) fn archives_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.archives;
        let available = self.archive_available();
        let mut pane = div().min_w_0().flex().flex_col().gap(px(16.))
            .child(heading("archive-heading", "Archivi e backup", theme))
            .child(self.local_host_panel(cx))
            .child(section("archive-recovery-heading", "Backup completo di recupero", theme))
            .child(text!("Copia cifrata di archivio, account, chiavi protette e storico. Richiede un kit di recupero già salvato e la sua chiave cartacea separata. Limite: 512 MiB. La verifica non prova un ripristino."))
            .child(button("archive-recovery-export", "Crea backup completo cifrato", theme, false, available).on_click(cx.listener(|this, _, _, cx| this.pick_archive_export(true, cx))))
            .child(button("archive-recovery-verify", "Verifica il file cifrato", theme, false, available).on_click(cx.listener(|this, _, _, cx| this.pick_archive_file(FilePurpose::VerifyRecovery, cx))))
            .child(section("archive-portable-heading", "Esportazione portabile", theme))
            .child(text!("Pazienti, voci, allegati e storico esportabile. Account e chiavi restano nell’archivio corrente. Limite del client: 8 MiB. Una copia già avviata può completarsi dopo il blocco; un errore può lasciare un file parziale. Le destinazioni esistenti non vengono sovrascritte."))
            .child(button("archive-export", "Scarica Backup", theme, false, available).on_click(cx.listener(|this, _, _, cx| this.pick_archive_export(false, cx))))
            .child(button("archive-select", "Seleziona file .mediflow v1", theme, false, available && area.pending.is_none() && area.journal.is_some()).on_click(cx.listener(|this, _, _, cx| this.pick_archive_file(FilePurpose::Restore, cx))));
        if area.journal_error || area.journal.is_none() {
            pane = pane.child(notice("archive-journal-error", "Registro del ripristino non disponibile. Conserva gli eventuali file di stato e verifica la cartella di recupero dell’interfaccia prima di iniziare un ripristino.", theme, true));
        }
        if let ArchiveOperation::Review(review) = &area.operation {
            pane = pane.child(div().id("archive-review").flex().flex_col().gap(px(12.))
                .child(text!(format!("File: {} ({} byte).", review.name, review.bytes)))
                .child(text!(format!("Ripristino del file portabile: {} record. I dati esportabili verranno sostituiti. Account e chiavi restano invariati; lo storico protetto viene conservato. L’operazione non è reversibile. I dispositivi abbinati dovranno essere abbinati di nuovo.", review.command.records())))
                .child(crate::text_input::themed(area.confirmation.clone(), theme))
                .child(button("archive-cancel", "Annulla", theme, true, true).on_click(cx.listener(|this, _, _, cx| this.cancel_archive_restore(cx))))
                .child(button("archive-confirm", "Ripristina adesso", theme, false, RestoreConfirmation::new(area.confirmation.read(cx).value()).is_ok()).on_click(cx.listener(|this, _, _, cx| this.confirm_archive_restore(cx)))));
        }
        if matches!(
            area.operation,
            ArchiveOperation::Reading | ArchiveOperation::Applying
        ) {
            pane = pane.child(notice(
                "archive-progress",
                if matches!(area.operation, ArchiveOperation::Applying) {
                    "Ripristino in corso…"
                } else {
                    "Lettura in corso…"
                },
                theme,
                false,
            ));
        }
        if area.pending.is_some() {
            pane = pane.child(text!("Un ripristino è stato preparato per l’invio. Riapri l’archivio e la gestione locale, poi rileggi la ricevuta. Nessun reinvio automatico."))
                .child(button("archive-receipt", "Rileggi ricevuta", theme, true, available).on_click(cx.listener(|this, _, _, cx| this.read_archive_receipt(cx))));
        }
        if area.receipt_verified {
            pane = pane.child(
                button(
                    "archive-receipt-done",
                    "Concludi verifica",
                    theme,
                    false,
                    available,
                )
                .on_click(cx.listener(|this, _, _, cx| this.finish_archive_receipt(cx))),
            );
        }
        if let Some(message) = &area.status {
            pane = pane.child(notice("archive-status", message.clone(), theme, false));
        }
        pane
    }
    fn pick_archive_export(&mut self, recovery: bool, cx: &mut Context<Self>) {
        if !self.archive_available() {
            return;
        }
        let chosen = cx.prompt_for_new_path(
            &documents::initial_save_directory(),
            Some(if recovery {
                "mediflow.mediflow-recovery"
            } else {
                "mediflow-backup.mediflow"
            }),
        );
        let generation = self.local_host.generation;
        self.local_host.archives.operation = ArchiveOperation::Reading;
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.local_host.generation != generation { return; }
                match result {
                    Ok(Ok(Some(path))) => {
                        let Some(access) = this.local_host.access() else { return; };
                        this.run_local_host(move || {
                            let bytes = if recovery { access.export_recovery_archive()? } else { access.export_archive()? };
                            access.admit_archive_file_effect()?;
                            write_new(&path, &bytes).map_err(|_| RuntimeError::Indeterminate)
                        }, |this, result, cx| {
                            this.local_host.archives.operation = ArchiveOperation::Idle;
                            this.local_host.archives.status = Some(match result { Ok(()) => "Backup creato, verificato e file riletto. Il ripristino non è ancora provato.".into(), Err(error) => ui_error(error) }); cx.notify();
                        }, cx);
                    }
                    _ => this.local_host.archives.operation = ArchiveOperation::Idle,
                }
                cx.notify();
            });
        }).detach();
    }
    fn pick_archive_file(&mut self, purpose: FilePurpose, cx: &mut Context<Self>) {
        if !self.archive_available()
            || (matches!(purpose, FilePurpose::Restore)
                && (self.local_host.archives.pending.is_some()
                    || self.local_host.archives.journal.is_none()))
        {
            return;
        }
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some(
                match purpose {
                    FilePurpose::Restore => "Seleziona file .mediflow v1",
                    FilePurpose::VerifyRecovery => "Verifica il file cifrato",
                }
                .into(),
            ),
        });
        let generation = self.local_host.generation;
        self.local_host.archives.operation = ArchiveOperation::Reading;
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.local_host.generation != generation { return; }
                match result {
                    Ok(Ok(Some(paths))) if paths.len() == 1 => {
                        let Some(access) = this.local_host.access() else { return; };
                        let path = paths.into_iter().next().unwrap();
                        this.run_local_host(move || {
                            let maximum = match purpose { FilePurpose::Restore => 8 * 1024 * 1024, FilePurpose::VerifyRecovery => 512 * 1024 * 1024 + 96 };
                            let bytes = read_selected(&path, maximum).map_err(|_| RuntimeError::InvalidInput)?;
                            match purpose {
                                FilePurpose::Restore => {
                                    let name = path.file_name().and_then(|name| name.to_str()).filter(|name| !name.chars().any(char::is_control)).ok_or(RuntimeError::InvalidInput)?.to_owned();
                                    let command = Arc::new(access.prepare_archive_restore(&bytes)?);
                                    Ok(FileResult::Review(ArchiveReview { command, name, bytes: bytes.len() }))
                                },
                                FilePurpose::VerifyRecovery => { access.verify_recovery_archive(&bytes)?; Ok(FileResult::Verified) }
                            }
                        }, |this, result, cx| {
                            this.local_host.archives.operation = match result {
                                Ok(FileResult::Review(command)) => { this.local_host.archives.focus_review = true; ArchiveOperation::Review(command) },
                                Ok(FileResult::Verified) => { this.local_host.archives.status = Some("Cifratura e integrità verificate con la chiave sbloccata. Il ripristino non è ancora provato.".into()); ArchiveOperation::Idle },
                                Err(error) => { this.local_host.archives.status = Some(ui_error(error)); ArchiveOperation::Idle }
                            };
                            this.local_host.archives.confirmation.update(cx, |input, cx| input.set_content("", cx)); cx.notify();
                        }, cx);
                    }
                    _ => this.local_host.archives.operation = ArchiveOperation::Idle,
                }
                cx.notify();
            });
        }).detach();
    }
    pub(in crate::shell::local_host) fn cancel_archive_restore(&mut self, cx: &mut Context<Self>) {
        if matches!(
            self.local_host.archives.operation,
            ArchiveOperation::Review(_)
        ) {
            self.local_host.archives.operation = ArchiveOperation::Idle;
            self.local_host
                .archives
                .confirmation
                .update(cx, |input, cx| input.set_content("", cx));
            cx.notify();
        }
    }
    fn confirm_archive_restore(&mut self, cx: &mut Context<Self>) {
        let area = &self.local_host.archives;
        let ArchiveOperation::Review(review) = &area.operation else {
            return;
        };
        let Ok(confirmation) = RestoreConfirmation::new(area.confirmation.read(cx).value()) else {
            return;
        };
        let command = review.command.clone();
        let Some(access) = self.local_host.access() else {
            return;
        };
        let Some(path) = area.journal.clone() else {
            return;
        };
        let lookup = command.lookup().clone();
        if write_new(
            &path,
            &serde_json::to_vec(&lookup).expect("lookup serialization"),
        )
        .is_err()
        {
            self.local_host.archives.journal_error = true;
            cx.notify();
            return;
        }
        self.local_host.archives.pending = Some(lookup);
        self.local_host.archives.operation = ArchiveOperation::Applying;
        self.run_local_host(
            move || access.restore_archive(&command, confirmation),
            |this, result, cx| {
                let rejected = matches!(result, Err(RuntimeError::Conflict | RuntimeError::Forbidden | RuntimeError::Rejected(400 | 412)));
                let released = rejected && this.local_host.archives.clear_journal().is_ok();
                this.local_host.archives.journal_error |= rejected && !released;
                this.disconnect(cx);
                let message = match result {
                    Ok(()) => "Ripristino eseguito. Riapri l’archivio e rileggi la ricevuta in Archivi e backup.".into(),
                    Err(error) if released => format!("{} Ripristino bloccato: i dati non sono stati modificati. Riapri l’archivio e prepara di nuovo il file; nessun reinvio automatico.", ui_error(error)),
                    Err(error) => format!("{} Riapri l’archivio e rileggi la ricevuta prima di procedere.", ui_error(error)),
                };
                this.message = Some((message, true)); cx.notify();
            }, cx,
        );
    }

    fn finish_archive_receipt(&mut self, cx: &mut Context<Self>) {
        let area = &mut self.local_host.archives;
        if !area.receipt_verified || area.has_work() {
            return;
        }
        if area.clear_journal().is_err() {
            area.journal_error = true;
            cx.notify();
            return;
        }
        area.receipt_verified = false;
        cx.notify();
    }
    fn read_archive_receipt(&mut self, cx: &mut Context<Self>) {
        if !self.archive_available() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let Some(lookup) = self.local_host.archives.pending.clone() else {
            return;
        };
        self.local_host.archives.operation = ArchiveOperation::Reading;
        self.local_host.archives.receipt_verified = false;
        self.run_local_host(
            move || access.read_restore_receipt(&lookup),
            |this, result, cx| {
                this.local_host.archives.operation = ArchiveOperation::Idle;
                this.local_host.archives.receipt_verified = result.is_ok();
                this.local_host.archives.status = Some(match result {
                    Ok(receipt) => format!(
                        "Ricevuta riletta: ripristino completato il {}. Archivio {}. Impronta {}.",
                        receipt.completed_at, receipt.archive_generation, receipt.source_checksum
                    ),
                    Err(error) => format!(
                        "Ricevuta non confermata: {} Conserva il registro e il backup.",
                        ui_error(error)
                    ),
                });
                cx.notify();
            },
            cx,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn synthetic_review(command: Arc<PreparedArchiveRestore>) -> ArchiveReview {
        ArchiveReview {
            command,
            name: "backup-sintetico.mediflow".into(),
            bytes: 14,
        }
    }
    #[gpui::test]
    fn archive_definite_conflict_releases_only_its_journal_and_never_retries(
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
        let command = Arc::new(
            access
                .prepare_archive_restore(br#"{"payload":{}}"#)
                .unwrap(),
        );
        let fixture = local_preferences::tests::Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let journal = fixture.0.join("pending.json");
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Archives;
            app.local_host.authority = Authority::Open(access);
            app.local_host.archives.journal = Some(journal.clone());
            app.local_host.archives.operation = ArchiveOperation::Review(synthetic_review(command));
            app.local_host
                .archives
                .confirmation
                .update(cx, |input, cx| input.set_content("RIPRISTINA", cx));
            app.confirm_archive_restore(cx);
            assert!(journal.exists());
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.session.is_none());
            assert!(app.local_host.archives.pending.is_none());
            assert!(!app.local_host.archives.journal_error);
        });
        assert!(!journal.exists());
        assert_eq!(
            host.routes()
                .iter()
                .filter(|route| route.as_str() == "POST /api/system/backup-restore")
                .count(),
            1
        );
    }
    #[gpui::test]
    fn archive_review_requires_keyword_cancellation_has_no_effect_and_lock_retires_review(
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
        let command = Arc::new(
            access
                .prepare_archive_restore(br#"{"payload":{}}"#)
                .unwrap(),
        );
        let fixture = local_preferences::tests::Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let journal = fixture.0.join("pending.json");
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let before = host.routes();
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Archives;
            app.local_host.authority = Authority::Open(access);
            app.local_host.archives.journal = Some(journal.clone());
            app.local_host.archives.operation =
                ArchiveOperation::Review(synthetic_review(command.clone()));
            app.confirm_archive_restore(cx);
            assert!(matches!(
                app.local_host.archives.operation,
                ArchiveOperation::Review(_)
            ));
            assert!(!journal.exists());
            app.local_host
                .archives
                .confirmation
                .update(cx, |input, cx| input.set_content("RIPRISTINA", cx));
            app.cancel_archive_restore(cx);
            assert!(!app.local_host.has_work());
            assert!(!journal.exists());
            app.local_host.archives.operation = ArchiveOperation::Review(synthetic_review(command));
            app.disconnect(cx);
            assert!(!app.local_host.has_work());
            assert!(
                app.local_host
                    .archives
                    .confirmation
                    .read(cx)
                    .value()
                    .is_empty()
            );
        });
        assert!(
            !host
                .routes()
                .iter()
                .skip(before.len())
                .any(|route| route == "POST /api/system/backup-restore")
        );
    }
    #[gpui::test]
    fn archive_journal_survives_restart_and_cannot_be_overwritten_or_cleared_before_receipt(
        cx: &mut gpui::TestAppContext,
    ) {
        let fixture = local_preferences::tests::Fixture::new();
        fs::create_dir_all(&fixture.0).unwrap();
        let journal = fixture.0.join("pending.json");
        let lookup = RestoreLookup {
            id: "12345678-1234-4123-8123-123456789012".into(),
            source_checksum: "a".repeat(64),
            origin: "http://127.0.0.1:31427".into(),
        };
        let bytes = serde_json::to_vec(&lookup).unwrap();
        write_new(&journal, &bytes).unwrap();
        assert!(write_new(&journal, b"replacement").is_err());
        assert_eq!(&*read_selected(&journal, 4096).unwrap(), &bytes);
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.local_host.archives = ArchiveArea::new(app.theme, Some(journal.clone()), cx);
            assert_eq!(app.local_host.archives.pending, Some(lookup));
            app.finish_archive_receipt(cx);
            assert!(journal.exists());
            app.local_host.archives.operation = ArchiveOperation::Reading;
            assert!(app.local_host.has_work());
            app.disconnect(cx);
            assert!(!app.local_host.has_work());
            assert!(app.local_host.archives.pending.is_some());
        });
        assert!(journal.exists());
    }
}
