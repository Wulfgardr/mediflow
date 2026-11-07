use super::*;
use mediflow_runtime_client::{NetworkModeSnapshot, TerritorialPreset, TerritorialSnapshot};

#[derive(Default)]
pub(super) struct NetworkArea {
    snapshot: Option<NetworkModeSnapshot>,
    territorial: Option<TerritorialSnapshot>,
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
        self.local_host.network.territorial = None;
        self.local_host.operation = Operation::Reading;
        self.run_local_host(
            move || {
                Ok((
                    access.read_network_mode()?,
                    access.read_territorial_packs()?,
                ))
            },
            |this, result, cx| {
                this.local_host.operation = Operation::Idle;
                match result {
                    Ok((snapshot, territorial)) => {
                        this.local_host.network.snapshot = Some(snapshot);
                        this.local_host.network.territorial = Some(territorial);
                    }
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
    fn prepare_territorial_packs(
        &mut self,
        preset: TerritorialPreset,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.local_host.has_work() {
            return;
        }
        let (Some(access), Some(snapshot)) = (
            self.local_host.access(),
            self.local_host.network.territorial.clone(),
        ) else {
            return;
        };
        self.local_host.return_focus = window.focused(cx);
        self.local_host.operation = Operation::Reading;
        self.run_local_host(
            move || access.prepare_territorial_packs(&snapshot, preset),
            |this, result, cx| {
                this.local_host.operation = match result {
                    Ok(command) => Operation::Review(Command::Territorial(Arc::new(command))),
                    Err(error) => Operation::Failed(ui_error(error)),
                };
                this.local_host.focus_confirmation = true;
                cx.notify();
            },
            cx,
        );
    }
    fn territorial_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(section("territorial-heading", "Personalizzazione territoriale", theme))
            .child(text!("L’assetto decide quali funzioni regionali compaiono in tutte le app collegate a questo archivio. Lo storico resta conservato in ogni assetto."));
        match &self.local_host.network.territorial {
            None => pane.child(text!("Assetto non ancora letto.")),
            Some(TerritorialSnapshot::Unreadable) => pane.child(notice(
                "territorial-unreadable",
                "Assetto territoriale non leggibile: restano attive solo le funzioni del nucleo.",
                theme,
                true,
            )),
            Some(TerritorialSnapshot::Ready { preset, .. }) => {
                pane = pane.child(text!(format!("Assetto attivo: {}.", preset.title())));
                for option in TerritorialPreset::ALL {
                    if option == *preset {
                        continue;
                    }
                    pane = pane.child(
                        div()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .child(
                                button(
                                    format!(
                                        "territorial-prepare-{}",
                                        option.wire().replace('+', "-")
                                    ),
                                    format!("Rivedi passaggio a {}", option.title()),
                                    theme,
                                    false,
                                    !self.local_host.has_work(),
                                )
                                .on_click(cx.listener(
                                    move |this, _, window, cx| {
                                        this.prepare_territorial_packs(option, window, cx)
                                    },
                                )),
                            )
                            .child(text!(option.detail())),
                    );
                }
                pane
            }
        }
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
        pane.child(self.territorial_view(cx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn territorial_payload(revision: u64, preset: &str) -> serde_json::Value {
        serde_json::json!({"schemaVersion":"mediflow.territorial-packs.v1","revision":revision,"status":"ready","preset":preset})
    }
    fn open_host_page<'a>(
        host: &notes_recovery_tests::Host,
        cx: &'a mut gpui::TestAppContext,
    ) -> (gpui::Entity<ClinicalApp>, &'a mut gpui::VisualTestContext) {
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
        (view, cx)
    }
    fn plan_host_read(host: &notes_recovery_tests::Host, territorial: serde_json::Value) {
        host.plan("GET /api/settings/network.mode")
            .send((200, serde_json::json!({"key":"network.mode","value":null})))
            .unwrap();
        host.plan("GET /api/system/territorial-packs")
            .send((200, territorial))
            .unwrap();
    }
    fn commands(cx: &mut gpui::VisualTestContext) -> Vec<String> {
        rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            });
        })
    }
    #[gpui::test]
    fn territorial_change_reviews_writes_the_web_contract_and_rereads(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let (view, cx) = open_host_page(&host, cx);
        plan_host_read(&host, territorial_payload(3, "core+it+lom"));
        view.update(cx, |app, cx| app.read_network_mode(cx));
        cx.run_until_parked();
        let ids = commands(cx);
        assert!(
            ids.iter().any(|id| id == "territorial-prepare-core"),
            "{ids:?}"
        );
        assert!(
            ids.iter().any(|id| id == "territorial-prepare-core-it"),
            "{ids:?}"
        );
        assert!(
            !ids.iter().any(|id| id == "territorial-prepare-core-it-lom"),
            "{ids:?}"
        );

        host.plan("GET /api/system/territorial-packs")
            .send((200, territorial_payload(3, "core+it+lom")))
            .unwrap();
        cx.update(|window, cx| {
            view.update(cx, |app, cx| {
                app.prepare_territorial_packs(TerritorialPreset::Core, window, cx)
            })
        });
        cx.run_until_parked();
        view.update(cx, |app, _| {
            let Operation::Review(Command::Territorial(command)) = &app.local_host.operation else {
                panic!("territorial review expected");
            };
            assert!(command.turns_off_lombardy());
            assert_eq!(
                territorial_consequence(command).split('.').next(),
                Some("SISS, portali e PRREG scompaiono dalle schermate e i loro writer si fermano")
            );
        });
        assert!(
            !host
                .routes()
                .iter()
                .any(|r| r == "PUT /api/system/territorial-packs")
        );

        host.plan("PUT /api/system/territorial-packs")
            .send((200, territorial_payload(4, "core")))
            .unwrap();
        host.plan("GET /api/system/territorial-packs")
            .send((200, territorial_payload(4, "core")))
            .unwrap();
        host.plan("GET /api/v1/network/capabilities")
            .send((200, serde_json::json!({"protocolVersion":"1.14.0",
                "hostPorts": serde_json::from_str::<serde_json::Value>(include_str!("../../../../transport/tests/fixtures/host-ports.json")).unwrap(),
                "operatingMode":"network-home-base","capabilities":[],
                "territorialPacks": territorial_payload(4, "core")})))
            .unwrap();
        plan_host_read(&host, territorial_payload(4, "core"));
        assert!(host.session.shows_lombardy_features());
        view.update(cx, |app, cx| app.confirm_local_command(cx));
        cx.run_until_parked();

        let sent = host.bodies("PUT /api/system/territorial-packs");
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../transport/tests/fixtures/territorial-packs-command.json"
        ))
        .unwrap();
        assert_eq!(
            sent,
            vec![contract],
            "GPUI sends the body the Web host contract accepts"
        );
        assert!(!host.session.shows_lombardy_features());
        view.update(cx, |app, _| {
            assert!(matches!(app.local_host.operation, Operation::Idle));
            assert_eq!(
                app.verified.as_deref(),
                Some("Assetto territoriale aggiornato e riletto dall’host.")
            );
            assert_eq!(
                app.local_host.network.territorial,
                Some(TerritorialSnapshot::Ready {
                    revision: 4,
                    preset: TerritorialPreset::Core
                })
            );
        });
    }
    #[gpui::test]
    fn territorial_review_stops_on_a_concurrent_change_and_on_an_unreadable_host(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let (view, cx) = open_host_page(&host, cx);
        plan_host_read(&host, territorial_payload(3, "core+it+lom"));
        view.update(cx, |app, cx| app.read_network_mode(cx));
        cx.run_until_parked();
        // Another surface changed the preset after this page read it.
        host.plan("GET /api/system/territorial-packs")
            .send((200, territorial_payload(4, "core+it")))
            .unwrap();
        cx.update(|window, cx| {
            view.update(cx, |app, cx| {
                app.prepare_territorial_packs(TerritorialPreset::Core, window, cx)
            })
        });
        cx.run_until_parked();
        view.update(cx, |app, _| {
            assert!(matches!(app.local_host.operation, Operation::Failed(_)));
        });
        assert!(
            !host
                .routes()
                .iter()
                .any(|r| r == "PUT /api/system/territorial-packs")
        );

        view.update(cx, |app, _| app.local_host.operation = Operation::Idle);
        plan_host_read(
            &host,
            serde_json::json!({"schemaVersion":"mediflow.territorial-packs.v1","revision":null,"status":"configuration_error","preset":"core"}),
        );
        view.update(cx, |app, cx| app.read_network_mode(cx));
        cx.run_until_parked();
        let ids = commands(cx);
        assert!(
            !ids.iter().any(|id| id.starts_with("territorial-prepare-")),
            "{ids:?}"
        );
        view.update(cx, |app, _| {
            assert_eq!(
                app.local_host.network.territorial,
                Some(TerritorialSnapshot::Unreadable)
            );
        });
    }
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
            if !preparing {
                host.plan("GET /api/system/territorial-packs")
                    .send((200, territorial_payload(3, "core+it+lom")))
                    .unwrap();
            }
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
