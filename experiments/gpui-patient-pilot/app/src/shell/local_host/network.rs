use super::*;
use mediflow_runtime_client::NetworkModeSnapshot;

#[derive(Default)]
pub(super) struct NetworkArea {
    snapshot: Option<NetworkModeSnapshot>,
}
impl ClinicalApp {
    pub(in crate::shell) fn read_network_mode(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.network.snapshot = None;
        self.local_host.operation = Operation::Reading;
        self.run_local_host(
            move || access.read_network_mode(),
            |this, result, cx| {
                this.local_host.operation = Operation::Idle;
                match result {
                    Ok(snapshot) => this.local_host.network.snapshot = Some(snapshot),
                    Err(error) => this.local_host.operation = Operation::Failed(ui_error(error)),
                }
                cx.notify();
            },
            cx,
        );
    }
    fn prepare_network_mode(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let (Some(access), Some(snapshot)) = (
            self.local_host.access(),
            self.local_host.network.snapshot.clone(),
        ) else {
            return;
        };
        let Ok(mode) = snapshot.mode() else {
            return;
        };
        self.local_host.return_focus = window.focused(cx);
        self.local_host.operation = Operation::Reading;
        self.run_local_host(
            move || access.prepare_network_mode(&snapshot, mode.alternative()),
            |this, result, cx| {
                this.local_host.operation = match result {
                    Ok(command) => Operation::Review(Command::Network(Arc::new(command))),
                    Err(error) => Operation::Failed(ui_error(error)),
                };
                this.local_host.focus_confirmation = true;
                cx.notify();
            },
            cx,
        );
    }
    pub(in crate::shell) fn network_mode_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div().min_w_0().flex().flex_col().gap(px(16.))
            .child(heading("network-mode-heading", "Modo host", theme))
            .child(text!("Solo locale limita i servizi di rete. Nodo della rete fidata abilita le capacità previste per i dispositivi abbinati. La scelta non modifica da sola firewall, porte o abbinamenti."))
            .child(self.local_host_panel(cx));
        if self.local_host.access().is_none() {
            return pane;
        }
        pane = pane.child(
            button(
                "network-mode-read",
                "Rileggi modo host",
                theme,
                false,
                !self.local_host.has_work(),
            )
            .on_click(cx.listener(|this, _, _, cx| this.read_network_mode(cx))),
        );
        if let Some(mode) = self
            .local_host
            .network
            .snapshot
            .as_ref()
            .and_then(|s| s.mode().ok())
        {
            pane = pane
                .child(text!(format!("Modo host: {}", mode.title())))
                .child(
                    button(
                        "network-mode-prepare",
                        format!("Rivedi passaggio a {}", mode.alternative().title()),
                        theme,
                        false,
                        !self.local_host.has_work(),
                    )
                    .on_click(
                        cx.listener(|this, _, window, cx| this.prepare_network_mode(window, cx)),
                    ),
                );
        } else {
            pane = pane.child(text!("Modo host non ancora letto."));
        }
        pane
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn network_review_cancel_reread_and_authority_retirement(cx: &mut gpui::TestAppContext) {
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
            app.settings_page = SettingsPage::Host;
            app.local_host.authority = Authority::Open(access);
        });
        for preparing in [false, true] {
            host.plan("GET /api/settings/network.mode")
                .send((200, serde_json::json!({"key":"network.mode","value":null})))
                .unwrap();
            cx.update(|window, cx| {
                view.update(cx, |app, cx| {
                    if preparing {
                        app.prepare_network_mode(window, cx);
                    } else {
                        app.read_network_mode(cx);
                    }
                })
            });
            cx.run_until_parked();
        }
        let commands = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            });
        });
        assert_eq!(
            commands
                .iter()
                .filter(|s| s.as_str() == "local-host-command-cancel")
                .count(),
            1
        );
        cx.update(|window, cx| {
            view.update(cx, |app, cx| {
                app.cancel_local_command(window, cx);
                assert!(!app.local_host.has_work());
                assert!(app.local_host.network.snapshot.is_some());
                app.request_discard(Discard::Lock, cx);
                assert!(app.local_host.network.snapshot.is_none());
            })
        });
        assert!(
            !host
                .routes()
                .iter()
                .any(|r| r.starts_with("PUT /api/settings/network.mode"))
        );
    }
    #[gpui::test]
    fn network_and_danger_are_separate_and_fail_closed_without_local_authority(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        for page in [SettingsPage::Host, SettingsPage::Danger] {
            view.update(cx, |app, _| {
                app.area = Area::Settings;
                app.settings_page = page;
            });
            let commands = rendered_command::button_ids(|| {
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                });
            });
            assert!(!commands.iter().any(|s| matches!(
                s.as_str(),
                "network-mode-prepare" | "security-prepare" | "danger-reset"
            )));
        }
    }
}
