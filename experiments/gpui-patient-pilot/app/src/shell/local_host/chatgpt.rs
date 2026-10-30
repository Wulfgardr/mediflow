use super::*;
use mediflow_runtime_client::{
    AccountState, ChatGptAccountObservation, ChatGptAccountOperation, ChatGptAccountStatus,
};
#[derive(Default)]
pub(super) struct ChatGptArea {
    busy: bool,
    status: Option<ChatGptAccountStatus>,
    observation: Option<ChatGptAccountObservation>,
    observed_at: Option<std::time::Instant>,
    message: Option<String>,
    generation: u64,
}
impl ChatGptArea {
    pub(super) fn busy(&self) -> bool {
        self.busy
    }
    pub(super) fn withdraw(&mut self) {
        self.generation += 1;
        self.busy = false;
        self.status = None;
        self.observation = None;
        self.observed_at = None;
        self.message = None;
    }
}
impl ClinicalApp {
    pub(in crate::shell) fn chatgpt_account_view(&self, cx: &Context<Self>) -> Div {
        let area = &self.local_host.chatgpt;
        let theme = self.theme;
        let enabled = self.local_host.access().is_some() && !self.local_host.has_work();
        let mut pane=div().min_w_0().flex().flex_col().gap(px(12.))
            .child(section("chatgpt-account","ChatGPT · OpenAI",theme))
            .child(text!("Servizio esterno · account personale. Qui gestisci l’accesso e consulti modelli e utilizzo. Questo accesso non abilita le funzioni, non invia dati del paziente e non avvia elaborazioni."))
            .child(text!("La quota dell’abbonamento ChatGPT non è credito API e non garantisce l’esecuzione di una funzione. Un dato assente non significa utilizzo zero."))
            .child(button("chatgpt-status","Rileggi stato",theme,false,enabled).on_click(cx.listener(|this,_,_,cx|this.read_chatgpt_account(cx))));
        if area.busy {
            pane = pane.child(text!("Operazione account in corso…")).child(
                button("chatgpt-cancel-busy", "Annulla accesso", theme, false, true).on_click(
                    cx.listener(|this, _, _, cx| {
                        this.operate_chatgpt_account(ChatGptAccountOperation::CancelLogin, cx)
                    }),
                ),
            );
        }
        if let Some(status) = &area.status {
            pane = pane.child(text!(status.state.title()));
            if let Some(notice) = status.notice_description() {
                pane = pane.child(text!(notice));
            }
            if status.state == AccountState::Connected {
                pane = pane.child(text!(format!(
                    "Piano restituito dal servizio: {}",
                    status.plan_label()
                )));
            }
            if status.state == AccountState::Unavailable {
                pane=pane.child(text!("Il componente account deve essere predisposto dall’operatore sul computer che ospita MediFlow. Rileggi dopo la configurazione. Questa pagina non installa componenti e non recupera credenziali esistenti."));
            }
            for (index, operation) in [
                ChatGptAccountOperation::Connect,
                ChatGptAccountOperation::CompleteLogin,
                ChatGptAccountOperation::CancelLogin,
                ChatGptAccountOperation::Logout,
                ChatGptAccountOperation::Refresh,
                ChatGptAccountOperation::Models,
                ChatGptAccountOperation::Limits,
            ]
            .into_iter()
            .enumerate()
            {
                if status.allows(operation) {
                    pane = pane.child(
                        button(
                            format!("chatgpt-op-{index}"),
                            operation.title(),
                            theme,
                            false,
                            enabled,
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.operate_chatgpt_account(operation, cx)
                        })),
                    );
                }
            }
        }
        if let Some(observation) = area.observation.as_ref().filter(|_| {
            area.observed_at
                .is_some_and(|time| time.elapsed() < std::time::Duration::from_secs(60))
        }) {
            if observation.auth_url.is_some() {
                pane=pane.child(button("chatgpt-open-login","Apri accesso ufficiale",theme,true,enabled).on_click(cx.listener(|this,_,_,cx|{
                if let Some(url)=this.local_host.chatgpt.observation.as_mut().and_then(|o|o.auth_url.take()) {cx.open_url(&url);}
                cx.notify();
            }))).child(text!("Completa l’accesso sul computer che ospita MediFlow, poi rileggi lo stato e verifica l’accesso. Il collegamento di accesso è transitorio."));
            }
            if let Some(models) = &observation.models {
                pane = pane.child(text!("Modelli dell’account · sola consultazione"));
                for model in models {
                    pane = pane.child(text!(format!(
                        "{}{}",
                        model.model,
                        if model.is_default {
                            " · predefinito dell’account, non di MediFlow"
                        } else {
                            ""
                        }
                    )));
                }
                if models.is_empty() {
                    pane = pane.child(text!("Nessun modello restituito dal servizio."));
                }
            }
            if let Some(limits) = &observation.limits {
                for (title, window) in ["Limite principale", "Limite aggiuntivo"]
                    .into_iter()
                    .zip(limits)
                {
                    pane = pane.child(text!(match window {
                        None => format!("{title}: dato non disponibile."),
                        Some(w) => format!(
                            "{title}: {:.0}% utilizzato. Periodo: {} minuti. Rinnovo: {}.",
                            w.used_percent,
                            w.window_duration_mins
                                .map(|m| m.to_string())
                                .unwrap_or_else(|| "non disponibile".into()),
                            w.resets_at
                                .and_then(|t| chrono::DateTime::from_timestamp(
                                    i64::try_from(t).ok()?,
                                    0
                                ))
                                .map(|d| d
                                    .with_timezone(&chrono::Local)
                                    .format("%d/%m/%Y %H:%M")
                                    .to_string())
                                .unwrap_or_else(|| "non disponibile".into())
                        ),
                    }));
                }
            }
        }
        if let Some(message) = &area.message {
            pane = pane.child(notice("chatgpt-message", message.clone(), theme, false));
        }
        pane.child(text!("Modelli e utilizzo si leggono solo su richiesta e vengono nascosti dopo un minuto o quando lo stato cambia. Rileggi stato non aggiorna questi dati."))
            .child(section("chatgpt-consent","Consenso per le proposte",theme))
            .child(text!("Collegare l’account o avere un piano a pagamento non autorizza l’invio di dati. Ogni proposta richiede revisione del contesto redatto e consenso sul contenuto esatto. Il consenso e l’accesso dedicato alla prova DEMO sono separati da questo account. I consensi per le proposte e la prova DEMO non sono ancora gestibili da questa pagina nativa."))
    }
    pub(in crate::shell) fn read_chatgpt_account(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.chatgpt.withdraw();
        self.local_host.chatgpt.busy = true;
        let request_generation = self.local_host.chatgpt.generation;
        self.run_local_host(
            move || access.read_chatgpt_account(),
            move |this, result, cx| {
                if this.local_host.chatgpt.generation != request_generation {
                    return;
                }
                let area = &mut this.local_host.chatgpt;
                area.busy = false;
                match result {
                    Ok(status) => area.status = Some(status),
                    Err(error) => area.message = Some(ui_error(error)),
                };
                cx.notify();
            },
            cx,
        );
    }
    fn operate_chatgpt_account(
        &mut self,
        operation: ChatGptAccountOperation,
        cx: &mut Context<Self>,
    ) {
        let interrupt = self.local_host.chatgpt.busy
            && matches!(
                operation,
                ChatGptAccountOperation::CancelLogin | ChatGptAccountOperation::Logout
            );
        if self.local_host.has_work() && !interrupt {
            return;
        }

        let Some(access) = self.local_host.access() else {
            return;
        };
        if !interrupt
            && !self
                .local_host
                .chatgpt
                .status
                .as_ref()
                .is_some_and(|s| s.allows(operation))
        {
            return;
        }
        self.local_host.chatgpt.withdraw();
        self.local_host.chatgpt.busy = true;
        let request_generation = self.local_host.chatgpt.generation;
        self.run_local_host(
            move || access.operate_chatgpt_account(operation),
            move |this, result, cx| {
                if this.local_host.chatgpt.generation != request_generation {
                    return;
                }
                let area = &mut this.local_host.chatgpt;
                area.busy = false;
                match result {
                    Ok(observation) => {
                        area.status = Some(observation.status.clone());
                        area.observation = Some(observation);
                        area.observed_at = Some(std::time::Instant::now());
                    }
                    Err(error) => {
                        area.withdraw();
                        area.message = Some(format!(
                            "{} Esito non confermato. Rileggi lo stato prima di riprovare.",
                            ui_error(error)
                        ));
                    }
                }
                let generation = area.generation;
                let host_generation = this.local_host.generation;
                cx.spawn(async move |this, cx| {
                    cx.background_executor()
                        .timer(std::time::Duration::from_secs(60))
                        .await;
                    let _ = this.update(cx, |this, cx| {
                        if this.local_host.generation == host_generation
                            && this.local_host.chatgpt.generation == generation
                        {
                            this.local_host.chatgpt.observation = None;
                            this.local_host.chatgpt.observed_at = None;
                            cx.notify();
                        }
                    });
                })
                .detach();
                cx.notify();
            },
            cx,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn chatgpt_navigation_and_lock_erase_transient_account_details(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let observation = || {
            ChatGptAccountObservation {
            status:serde_json::from_value(serde_json::json!({"state":"awaiting_login","notice":null,"plan":null,"loginExpiresAt":123,"actions":["cancel_login"],"inferenceEnabled":false,"executionBlock":"data_boundary_unqualified"})).unwrap(),
            auth_url:Some(Zeroizing::new("https://auth.openai.com/oauth/authorize?state=synthetic".into())), models:None, limits:None,
        }
        };
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Functions;
            app.local_host.chatgpt.observation = Some(observation());
            app.local_host.chatgpt.observed_at = Some(std::time::Instant::now());
            let generation = app.local_host.chatgpt.generation;
            app.navigate(Area::Scales, cx);
            assert!(app.local_host.chatgpt.observation.is_none());
            assert_eq!(app.local_host.chatgpt.generation, generation + 1);
            app.local_host.chatgpt.observation = Some(observation());
            app.local_host.chatgpt.busy = true;
            assert!(!app.local_host.command_visible());
            let _ = app.chatgpt_account_view(cx);
            app.request_discard(Discard::Lock, cx);
            assert!(app.local_host.chatgpt.observation.is_none());
            assert!(!app.local_host.chatgpt.busy);
        });
    }
}
