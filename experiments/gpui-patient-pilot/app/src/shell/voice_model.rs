//! Impostazioni, Voce locale: stato del modello vocale, installazione e
//! rimozione. Solo macOS. Nessuna connessione parte prima di «Installa».

use super::*;
use crate::local_voice::model::{self, Catalog, Download, InstallError, ModelStatus};
use gpui::Task;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Status {
    /// Lettura dei file sul disco in corso.
    Checking,
    Missing,
    Verified,
    Invalid,
    Downloading,
    Cancelling,
    Failed(InstallError),
    RemoveFailed,
    /// Cartella dell'utente non trovata.
    NoFolder,
}

pub(super) struct VoiceModelArea {
    catalog: Option<Catalog>,
    status: Status,
    download: Option<Download>,
    check: Option<Arc<Mutex<Option<ModelStatus>>>>,
    poller: Option<Task<()>>,
}
impl Default for VoiceModelArea {
    fn default() -> Self {
        Self::with_catalog(Catalog::installed())
    }
}
impl VoiceModelArea {
    /// All'avvio si tolgono i parziali di un'uscita brusca: nessuno
    /// scaricamento può essere in corso prima di questo stato.
    pub(super) fn with_catalog(catalog: Option<Catalog>) -> Self {
        if let Some(catalog) = &catalog {
            catalog.remove_partials();
        }
        Self {
            status: if catalog.is_some() {
                Status::Checking
            } else {
                Status::NoFolder
            },
            catalog,
            download: None,
            check: None,
            poller: None,
        }
    }
    /// Uscita dall'app: ferma `curl` e toglie i parziali senza aspettare.
    pub(super) fn shutdown(&self) {
        if let Some(download) = &self.download {
            download.shutdown();
        }
    }
    fn network_disabled(&self) -> bool {
        self.catalog
            .as_ref()
            .is_some_and(|catalog| (catalog.network_disabled)())
    }
    fn can_install(&self) -> bool {
        self.catalog.is_some()
            && self.download.is_none()
            && self.check.is_none()
            && !self.network_disabled()
            && matches!(
                self.status,
                Status::Missing | Status::Invalid | Status::Failed(_) | Status::RemoveFailed
            )
    }
    fn can_remove(&self) -> bool {
        self.download.is_none()
            && self.check.is_none()
            && matches!(
                self.status,
                Status::Verified | Status::Invalid | Status::RemoveFailed
            )
    }
}

fn from_disk(status: ModelStatus) -> Status {
    match status {
        ModelStatus::Missing => Status::Missing,
        ModelStatus::Invalid => Status::Invalid,
        ModelStatus::Verified => Status::Verified,
    }
}

/// Byte in GB con la virgola, due decimali.
fn gigabytes(bytes: u64) -> String {
    format!("{:.2}", bytes as f64 / 1e9).replace('.', ",")
}

fn failure(error: InstallError, host: &str) -> String {
    match error {
        InstallError::NetworkDisabled => NETWORK_DISABLED.to_owned(),
        InstallError::Unreachable => {
            format!("{host} non risponde. Controlla la connessione.")
        }
        InstallError::Interrupted => "Lo scaricamento si è interrotto.".to_owned(),
        InstallError::Refused => {
            format!("{host} ha rifiutato la richiesta. Riprova più tardi.")
        }
        InstallError::Write => {
            "Impossibile scrivere nella cartella del modello. Controlla lo spazio libero sul disco."
                .to_owned()
        }
        InstallError::HashMismatch => {
            "I file arrivati sono diversi da quelli attesi e sono stati scartati.".to_owned()
        }
        InstallError::Cancelled => "Scaricamento annullato.".to_owned(),
    }
}

fn caption(message: String, theme: Theme) -> Div {
    div().text_color(theme.secondary).child({
        let text = gpui::text!(message);
        #[cfg(test)]
        let text = rendered_command::observe_text(text);
        text
    })
}

const NETWORK_DISABLED: &str = "Le uscite verso Internet sono disattivate su questo Mac (MEDIFLOW_NETWORK_DISABLED): il modello non si può scaricare.";

impl ClinicalApp {
    /// Apertura della pagina: solo lettura dei file sul disco, mai la rete.
    pub(super) fn open_voice_model(&mut self, cx: &mut Context<Self>) {
        let area = &mut self.voice_model;
        if area.download.is_some() || area.check.is_some() {
            return;
        }
        let Some(catalog) = area.catalog.clone() else {
            area.status = Status::NoFolder;
            return;
        };
        if catalog.quick_status() == ModelStatus::Missing {
            area.status = Status::Missing;
            return;
        }
        area.status = Status::Checking;
        let slot: Arc<Mutex<Option<ModelStatus>>> = Arc::default();
        let worker = slot.clone();
        let spawned = std::thread::Builder::new()
            .name("mediflow-voce-verifica".into())
            .spawn(move || {
                let status = catalog.verify();
                *worker.lock().unwrap_or_else(|e| e.into_inner()) = Some(status);
            });
        if spawned.is_ok() {
            area.check = Some(slot);
            self.start_voice_model_poller(cx);
        } else {
            area.status = Status::Invalid;
        }
    }

    /// Il gesto «Installa»: un solo scaricamento alla volta.
    pub(super) fn install_voice_model(&mut self, cx: &mut Context<Self>) {
        let area = &mut self.voice_model;
        if !area.can_install() {
            return;
        }
        let Some(catalog) = area.catalog.clone() else {
            return;
        };
        area.download = Some(Download::start(catalog));
        area.status = Status::Downloading;
        self.start_voice_model_poller(cx);
        cx.notify();
    }

    /// Annulla senza aspettare il thread dello scaricamento.
    pub(super) fn cancel_voice_model(&mut self, cx: &mut Context<Self>) {
        if let Some(download) = &self.voice_model.download {
            download.cancel();
            self.voice_model.status = Status::Cancelling;
            cx.notify();
        }
    }

    pub(super) fn remove_voice_model(&mut self, cx: &mut Context<Self>) {
        let area = &mut self.voice_model;
        if !area.can_remove() {
            return;
        }
        let Some(catalog) = &area.catalog else {
            return;
        };
        area.status = match catalog.remove() {
            Ok(()) => Status::Missing,
            Err(_) => Status::RemoveFailed,
        };
        cx.notify();
    }

    fn start_voice_model_poller(&mut self, cx: &mut Context<Self>) {
        if self.voice_model.poller.is_some() {
            return;
        }
        self.voice_model.poller = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(200))
                    .await;
                let busy = this.update(cx, |this, cx| {
                    this.poll_voice_model(cx);
                    let area = &this.voice_model;
                    area.download.is_some() || area.check.is_some()
                });
                if !busy.unwrap_or(false) {
                    break;
                }
            }
            let _ = this.update(cx, |this, _| this.voice_model.poller = None);
        }));
    }

    /// Legge avanzamento ed esito dai thread di lavoro.
    pub(super) fn poll_voice_model(&mut self, cx: &mut Context<Self>) {
        let area = &mut self.voice_model;
        if let Some(slot) = &area.check {
            let done = *slot.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(status) = done {
                area.check = None;
                area.status = from_disk(status);
            }
        }
        if let Some(outcome) = area.download.as_ref().and_then(Download::outcome) {
            area.download = None;
            area.status = match outcome {
                Ok(()) => Status::Verified,
                Err(InstallError::Cancelled) => area
                    .catalog
                    .as_ref()
                    .map_or(Status::NoFolder, |c| from_disk(c.quick_status())),
                Err(error) => Status::Failed(error),
            };
        }
        cx.notify();
    }

    pub(super) fn voice_model_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.voice_model;
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(heading(
                "clinical-workspace-settings-heading",
                "Voce locale",
                theme,
            ));
        let Some(catalog) = &area.catalog else {
            return pane.child(notice(
                "voice-model-status",
                "Cartella dell’utente non trovata: il modello vocale non si può installare.",
                theme,
                true,
            ));
        };
        let host = model::source_host(&catalog.files).unwrap_or("la fonte fissata");
        let (message, error) = match area.status {
            Status::Checking => ("Verifica dei file del modello…".to_owned(), false),
            Status::Missing => (
                "Modello non installato: la dettatura usa la trascrizione Apple.".to_owned(),
                false,
            ),
            Status::Verified => (
                "Modello installato e verificato: la dettatura usa whisper.".to_owned(),
                false,
            ),
            Status::Invalid => (
                "Il modello è incompleto o diverso da quello atteso e la dettatura non parte. Reinstallalo o rimuovilo."
                    .to_owned(),
                true,
            ),
            Status::Downloading => {
                let (received, total) = area
                    .download
                    .as_ref()
                    .map_or((0, catalog.total_size()), Download::progress);
                (
                    format!(
                        "Scaricamento: {} MB di {} MB ({}%).",
                        received / 1_000_000,
                        total / 1_000_000,
                        (received * 100).checked_div(total).unwrap_or(0)
                    ),
                    false,
                )
            }
            Status::Cancelling => ("Annullamento dello scaricamento…".to_owned(), false),
            Status::Failed(error) => (failure(error, host), true),
            Status::RemoveFailed => (
                "Impossibile rimuovere i file del modello.".to_owned(),
                true,
            ),
            Status::NoFolder => unreachable!("catalog present"),
        };
        pane = pane.child(notice("voice-model-status", message, theme, error));
        let offers_install = matches!(
            area.status,
            Status::Missing | Status::Invalid | Status::Failed(_)
        );
        if offers_install {
            if area.network_disabled() {
                pane = pane.child(caption(NETWORK_DISABLED.into(), theme));
            } else {
                pane = pane.child(caption(
                    format!(
                        "Il modello pesa {} GB e si scarica da {host}.",
                        gigabytes(catalog.total_size())
                    ),
                    theme,
                ));
            }
            let label = match area.status {
                Status::Missing => "Installa",
                Status::Invalid => "Reinstalla",
                _ => "Riprova",
            };
            pane = pane.child(
                button(
                    "voice-model-install",
                    label,
                    theme,
                    true,
                    area.can_install(),
                )
                .on_click(cx.listener(|this, _, _, cx| this.install_voice_model(cx))),
            );
        }
        if matches!(area.status, Status::Downloading | Status::Cancelling) {
            pane = pane.child(
                button(
                    "voice-model-cancel",
                    "Annulla",
                    theme,
                    false,
                    area.status == Status::Downloading,
                )
                .on_click(cx.listener(|this, _, _, cx| this.cancel_voice_model(cx))),
            );
        }
        if area.can_remove() {
            pane = pane.child(
                button("voice-model-remove", "Rimuovi", theme, false, true)
                    .on_click(cx.listener(|this, _, _, cx| this.remove_voice_model(cx))),
            );
        }
        pane
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_voice::model::tests::{
        LoopbackServer, alive, invented, loopback_catalog, temp,
    };

    struct Fixture {
        server: LoopbackServer,
        root: std::path::PathBuf,
        catalog: Catalog,
    }
    fn fixture(name: &str) -> Fixture {
        let server = LoopbackServer::start();
        let model = server.file("modello.bin", &invented(400_000, 7));
        let vad = server.file("vad.bin", &invented(3_000, 8));
        let root = temp(&format!("vista-{name}"));
        let catalog = loopback_catalog(root.join("modelli-voce"), vec![model, vad]);
        Fixture {
            server,
            root,
            catalog,
        }
    }
    /// Finestra finta che disegna solo la pagina delle impostazioni.
    struct Page(Entity<ClinicalApp>);
    impl Render for Page {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            self.0.update(cx, |app, cx| {
                app.settings_view(Layout::for_window(1200., 1.), cx)
            })
        }
    }
    fn open(
        catalog: Catalog,
        cx: &mut gpui::TestAppContext,
    ) -> (Entity<ClinicalApp>, &mut gpui::VisualTestContext) {
        let (page, cx) = cx.add_window_view(|window, cx| {
            Page(cx.new(|cx| ClinicalApp::new(String::new(), window, cx)))
        });
        let view = cx.update(|_, cx| page.read(cx).0.clone());
        cx.update_window_entity(&view, |app, window, cx| {
            app.voice_model = VoiceModelArea::with_catalog(Some(catalog));
            app.area = Area::Settings;
            app.select_settings_page(SettingsPage::VoiceLocal, window, cx);
        });
        (view, cx)
    }
    /// Comandi e testi accessibili della pagina, come li legge VoiceOver.
    fn rendered(
        _view: &Entity<ClinicalApp>,
        cx: &mut gpui::VisualTestContext,
    ) -> (Vec<String>, Vec<String>) {
        let ids = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            });
        });
        let mut labels = Vec::new();
        let nodes = {
            let mut nodes = Vec::new();
            rendered_command::capture_all_texts(|| {
                rendered_command::take_text_nodes();
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                });
                nodes = rendered_command::take_text_nodes();
            });
            nodes
        };
        for (_, node) in nodes {
            if let Some(value) = node.value() {
                labels.push(value.to_owned());
            }
        }
        (
            ids.into_iter()
                .filter(|id| id.starts_with("voice-model-"))
                .collect(),
            labels,
        )
    }
    fn wait_until(
        view: &Entity<ClinicalApp>,
        cx: &mut gpui::VisualTestContext,
        done: impl Fn(&VoiceModelArea) -> bool,
    ) {
        let started = std::time::Instant::now();
        loop {
            let finished = cx.update(|_, cx| {
                view.update(cx, |app, cx| {
                    app.poll_voice_model(cx);
                    done(&app.voice_model)
                })
            });
            if finished {
                return;
            }
            assert!(
                started.elapsed() < Duration::from_secs(30),
                "state never reached"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    fn status(view: &Entity<ClinicalApp>, cx: &mut gpui::VisualTestContext) -> Status {
        cx.update(|_, cx| view.read(cx).voice_model.status)
    }
    fn has(labels: &[String], text: &str) -> bool {
        labels.iter().any(|l| l.contains(text))
    }

    #[gpui::test]
    fn opening_settings_reads_the_disk_only_and_install_is_the_gesture(
        cx: &mut gpui::TestAppContext,
    ) {
        let f = fixture("apertura");
        let (view, cx) = open(f.catalog.clone(), cx);
        cx.run_until_parked();
        assert_eq!(status(&view, cx), Status::Missing);
        let (ids, labels) = rendered(&view, cx);
        assert_eq!(ids, ["voice-model-install"]);
        assert!(
            has(
                &labels,
                "Modello non installato: la dettatura usa la trascrizione Apple."
            ),
            "{labels:?}"
        );
        assert!(
            has(
                &labels,
                "Il modello pesa 0,00 GB e si scarica da 127.0.0.1:"
            ),
            "{labels:?}"
        );
        assert!(has(&labels, "Installa"), "{labels:?}");
        assert_eq!(f.server.connections(), 0, "opening the page never connects");
        cx.update_window_entity(&view, |app, window, cx| {
            app.select_settings_page(SettingsPage::Overview, window, cx);
            app.select_settings_page(SettingsPage::VoiceLocal, window, cx);
        });
        assert_eq!(
            f.server.connections(),
            0,
            "reopening the page never connects"
        );

        // Due clic, un solo scaricamento.
        cx.update(|_, cx| {
            view.update(cx, |app, cx| {
                app.install_voice_model(cx);
                app.install_voice_model(cx);
            })
        });
        assert_eq!(status(&view, cx), Status::Downloading);
        let (ids, labels) = rendered(&view, cx);
        assert_eq!(ids, ["voice-model-cancel"]);
        assert!(has(&labels, "Scaricamento: "), "{labels:?}");
        wait_until(&view, cx, |area| area.download.is_none());
        assert_eq!(status(&view, cx), Status::Verified);
        assert_eq!(f.server.connections(), 2, "one request per file, once");
        assert_eq!(f.catalog.verify(), ModelStatus::Verified);
        let (ids, labels) = rendered(&view, cx);
        assert_eq!(ids, ["voice-model-remove"]);
        assert!(
            has(
                &labels,
                "Modello installato e verificato: la dettatura usa whisper."
            ),
            "{labels:?}"
        );

        // Riapertura: verifica completa sul disco, nessuna connessione.
        cx.update_window_entity(&view, |app, window, cx| {
            app.select_settings_page(SettingsPage::Overview, window, cx);
            app.select_settings_page(SettingsPage::VoiceLocal, window, cx);
        });
        assert_eq!(status(&view, cx), Status::Checking);
        let (ids, labels) = rendered(&view, cx);
        assert!(ids.is_empty(), "{ids:?}");
        assert!(has(&labels, "Verifica dei file del modello…"), "{labels:?}");
        wait_until(&view, cx, |area| area.check.is_none());
        assert_eq!(status(&view, cx), Status::Verified);
        assert_eq!(f.server.connections(), 2);

        // Rimuovi: i file spariscono, la dettatura torna alla trascrizione Apple.
        cx.update(|_, cx| view.update(cx, |app, cx| app.remove_voice_model(cx)));
        assert_eq!(status(&view, cx), Status::Missing);
        assert!(!f.catalog.directory.exists());
        let (ids, _) = rendered(&view, cx);
        assert_eq!(ids, ["voice-model-install"]);
        std::fs::remove_dir_all(&f.root).unwrap();
    }

    #[gpui::test]
    fn cancel_returns_immediately_and_the_page_offers_install_again(cx: &mut gpui::TestAppContext) {
        use crate::local_voice::model::tests::Reply;
        let f = fixture("annulla");
        let content = invented(2_000_000, 9);
        let model = f.server.file("lento.bin", &content);
        f.server.set("/lento.bin", vec![Reply::Stall(content)]);
        let catalog = loopback_catalog(f.catalog.directory.clone(), vec![model]);
        let (view, cx) = open(catalog.clone(), cx);
        cx.update(|_, cx| view.update(cx, |app, cx| app.install_voice_model(cx)));
        wait_until(&view, cx, |area| {
            area.download.as_ref().is_some_and(|d| d.progress().0 > 0)
        });
        let started = std::time::Instant::now();
        cx.update(|_, cx| view.update(cx, |app, cx| app.cancel_voice_model(cx)));
        assert!(
            started.elapsed() < Duration::from_millis(50),
            "cancel never waits"
        );
        assert_eq!(status(&view, cx), Status::Cancelling);
        let (ids, labels) = rendered(&view, cx);
        assert_eq!(ids, ["voice-model-cancel"]);
        assert!(
            has(&labels, "Annullamento dello scaricamento…"),
            "{labels:?}"
        );
        wait_until(&view, cx, |area| area.download.is_none());
        assert!(
            started.elapsed() < Duration::from_millis(200),
            "{:?}",
            started.elapsed()
        );
        assert_eq!(status(&view, cx), Status::Missing);
        assert!(!catalog.directory.exists());
        let (ids, _) = rendered(&view, cx);
        assert_eq!(ids, ["voice-model-install"]);
        std::fs::remove_dir_all(&f.root).unwrap();
    }

    #[gpui::test]
    fn quitting_the_app_ends_the_download_and_leaves_no_partial_file(
        cx: &mut gpui::TestAppContext,
    ) {
        use crate::local_voice::model::tests::Reply;
        let f = fixture("uscita");
        let content = invented(2_000_000, 15);
        let model = f.server.file("lento.bin", &content);
        f.server.set("/lento.bin", vec![Reply::Stall(content)]);
        let catalog = loopback_catalog(f.catalog.directory.clone(), vec![model]);
        let (view, cx) = open(catalog.clone(), cx);
        cx.update(|_, cx| view.update(cx, |app, cx| app.install_voice_model(cx)));
        wait_until(&view, cx, |area| {
            area.download.as_ref().is_some_and(|d| d.progress().0 > 0)
        });
        let pid = cx.update(|_, cx| {
            view.read(cx)
                .voice_model
                .download
                .as_ref()
                .and_then(|d| d.child_pid())
                .unwrap()
        });
        assert!(alive(pid));
        let quitting = std::time::Instant::now();
        // Il vero gestore `on_app_quit` della shell, come con Cmd-Q.
        cx.cx.update(|cx| cx.shutdown());
        assert!(
            quitting.elapsed() < Duration::from_millis(200),
            "{:?}",
            quitting.elapsed()
        );
        assert!(!alive(pid), "curl {pid} still alive after quit");
        assert!(!catalog.directory.join("lento.bin.parziale").exists());
        assert!(!catalog.directory.join("lento.bin").exists());
        std::fs::remove_dir_all(&f.root).unwrap();
    }

    #[gpui::test]
    fn a_partial_file_left_by_an_abrupt_exit_is_removed_when_the_state_starts(
        cx: &mut gpui::TestAppContext,
    ) {
        let f = fixture("orfano");
        std::fs::create_dir_all(&f.catalog.directory).unwrap();
        let orphan = f.catalog.directory.join("modello.bin.parziale");
        std::fs::write(&orphan, b"mezzo").unwrap();
        let (view, cx) = open(f.catalog.clone(), cx);
        assert!(!orphan.exists());
        assert_eq!(status(&view, cx), Status::Missing);
        assert_eq!(f.server.connections(), 0);
        std::fs::remove_dir_all(&f.root).unwrap();
    }

    #[gpui::test]
    fn every_state_has_its_own_message_and_commands(cx: &mut gpui::TestAppContext) {
        let f = fixture("stati");
        let (view, cx) = open(f.catalog.clone(), cx);
        let cases: Vec<(Status, &str, Vec<&str>)> = vec![
            (
                Status::Invalid,
                "Il modello è incompleto o diverso da quello atteso e la dettatura non parte. Reinstallalo o rimuovilo.",
                vec!["voice-model-install", "voice-model-remove"],
            ),
            (
                Status::Failed(InstallError::Unreachable),
                "non risponde. Controlla la connessione.",
                vec!["voice-model-install"],
            ),
            (
                Status::Failed(InstallError::Interrupted),
                "Lo scaricamento si è interrotto.",
                vec!["voice-model-install"],
            ),
            (
                Status::Failed(InstallError::Refused),
                "ha rifiutato la richiesta. Riprova più tardi.",
                vec!["voice-model-install"],
            ),
            (
                Status::Failed(InstallError::Write),
                "Impossibile scrivere nella cartella del modello. Controlla lo spazio libero sul disco.",
                vec!["voice-model-install"],
            ),
            (
                Status::Failed(InstallError::HashMismatch),
                "I file arrivati sono diversi da quelli attesi e sono stati scartati.",
                vec!["voice-model-install"],
            ),
            (
                Status::RemoveFailed,
                "Impossibile rimuovere i file del modello.",
                vec!["voice-model-remove"],
            ),
        ];
        for (state, message, commands) in cases {
            cx.update(|_, cx| view.update(cx, |app, _| app.voice_model.status = state));
            let (ids, labels) = rendered(&view, cx);
            assert_eq!(ids, commands, "{state:?}");
            assert!(has(&labels, message), "{state:?}: {labels:?}");
            if let Status::Failed(_) = state {
                assert!(has(&labels, "Riprova"), "{state:?}: {labels:?}");
            }
        }
        // Uscite di rete disattivate: il pulsante resta, disattivato, e dice perché.
        let mut offline = f.catalog.clone();
        offline.network_disabled = || true;
        cx.update(|_, cx| {
            view.update(cx, |app, cx| {
                app.voice_model = VoiceModelArea::with_catalog(Some(offline));
                app.voice_model.status = Status::Missing;
                app.install_voice_model(cx);
                assert!(app.voice_model.download.is_none());
            })
        });
        let (ids, labels) = rendered(&view, cx);
        assert_eq!(ids, ["voice-model-install"]);
        assert!(has(&labels, NETWORK_DISABLED), "{labels:?}");
        assert!(!has(&labels, "si scarica da"), "{labels:?}");
        cx.update(|_, cx| assert!(!view.read(cx).voice_model.can_install()));
        assert_eq!(f.server.connections(), 0);
        // Nessuna cartella dell'utente.
        cx.update(|_, cx| {
            view.update(cx, |app, _| {
                app.voice_model = VoiceModelArea::with_catalog(None)
            })
        });
        let (ids, labels) = rendered(&view, cx);
        assert!(ids.is_empty());
        assert!(
            has(&labels, "Cartella dell’utente non trovata"),
            "{labels:?}"
        );
        std::fs::remove_dir_all(&f.root).unwrap();
    }

    #[test]
    fn size_is_written_with_a_decimal_comma() {
        assert_eq!(gigabytes(model::total_size(&model::FILES)), "0,57");
    }
}
