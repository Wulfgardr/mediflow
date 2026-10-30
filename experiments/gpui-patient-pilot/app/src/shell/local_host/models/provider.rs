use super::*;
use mediflow_runtime_client::{LocalProviderOutcome, LocalProviderStatus};

#[derive(Default)]
pub(super) struct ProviderArea {
    pub(super) busy: bool,
    status: Option<LocalProviderStatus>,
    message: Option<String>,
}
impl ClinicalApp {
    pub(in crate::shell) fn local_provider_view(&self, cx: &Context<Self>) -> Div {
        let area = &self.local_host.models.provider;
        let enabled = self.local_host.access().is_some() && !self.local_host.has_work();
        let mut pane = div().min_w_0().flex().flex_col().gap(px(12.))
            .child(section("local-provider-title", "Collegamento locale", self.theme))
            .child(text!("Apri Ollama sul computer che ospita MediFlow, scegli un modello installato e salva la configurazione. La verifica può caricare il modello in memoria, senza scaricare o generare testo. Il limite è di 60 secondi."))
            .child(button("local-provider-read", "Aggiorna stato", self.theme, false, enabled)
                .on_click(cx.listener(|this, _, _, cx| this.read_local_provider(cx))));
        if let Some(status) = &area.status {
            pane = pane.child(text!(status.description())).child(text!(format!(
                "Modello salvato: {}",
                status.model.as_deref().unwrap_or("Non configurato")
            )));
            pane = pane.child(
                button(
                    "local-provider-activate",
                    if status.state == "degraded" {
                        "Verifica e recupera locale"
                    } else {
                        "Verifica e attiva locale"
                    },
                    self.theme,
                    true,
                    enabled && status.can_activate,
                )
                .on_click(cx.listener(|this, _, _, cx| this.activate_local_provider(cx))),
            );
        }
        if area.busy {
            pane = pane.child(text!("Verifica o rilettura in corso…")).child(
                button(
                    "local-provider-cancel",
                    "Annulla e chiudi gestione locale",
                    self.theme,
                    false,
                    true,
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.withdraw_local_host(cx);
                    cx.notify();
                })),
            );
        }
        if let Some(message) = &area.message {
            pane = pane.child(notice(
                "local-provider-result",
                message.clone(),
                self.theme,
                false,
            ));
        }
        pane.child(section("local-model-files", "File dei modelli", self.theme))
            .child(text!("Download e rimozione da MediFlow non disponibili. L’inventario mostra i file già installati. Per installare il modello locale consigliato, apri il Terminale sul computer che ospita MediFlow ed esegui:"))
            .child(text!("ollama pull qwen3.5:35b-a3b"))
            .child(text!("Poi aggiorna i modelli installati, scegli il modello, salva e verifica il collegamento locale. L’installazione nel Terminale è un’operazione separata e non viene eseguita da questa pagina."))
    }
    pub(in crate::shell) fn read_local_provider(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.models.provider = ProviderArea {
            busy: true,
            ..Default::default()
        };
        self.run_local_host(
            move || access.read_local_provider(),
            |this, result, cx| {
                let area = &mut this.local_host.models.provider;
                area.busy = false;
                match result {
                    Ok(status) => area.status = Some(status),
                    Err(error) => area.message = Some(ui_error(error)),
                }
                cx.notify();
            },
            cx,
        );
    }
    fn activate_local_provider(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let (Some(access), Some(status)) = (
            self.local_host.access(),
            self.local_host.models.provider.status.take(),
        ) else {
            return;
        };
        if !status.can_activate {
            return;
        }
        self.local_host.models.provider.busy = true;
        self.local_host.models.provider.message = None;
        self.run_local_host(move || access.activate_local_provider(&status), |this, result, cx| {
            let area = &mut this.local_host.models.provider;
            area.busy = false;
            match result {
                Ok(LocalProviderOutcome::Confirmed(status)) => {
                    area.status = Some(status);
                    area.message = Some("Collegamento attivo e riletto. L’attivazione non prova una generazione riuscita né l’idoneità clinica.".into());
                    this.load_ai_status(cx);
                    this.read_local_switches(cx);
                }
                Ok(LocalProviderOutcome::Denied(message)) => area.message = Some(message),
                Err(error) => area.message = Some(format!("{} Esito non confermato. Rileggi lo stato prima di una nuova verifica.", ui_error(error))),
            }
            cx.notify();
        }, cx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn provider_verification_blocks_navigation_and_lock_clears_it(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.update(|window, cx| {
            view.update(cx, |app, cx| {
                app.area = Area::Settings;
                app.settings_page = SettingsPage::Models;
                app.local_host.models.provider.busy = true;
                assert!(!app.local_host.command_visible());
                let _ = app.models_view(cx);
                app.select_settings_page(SettingsPage::Overview, window, cx);
                assert_eq!(app.settings_page, SettingsPage::Models);
                app.request_discard(Discard::Lock, cx);
                assert!(!app.local_host.models.provider.busy);
                assert!(app.local_host.models.provider.status.is_none());
            })
        });
    }
}
