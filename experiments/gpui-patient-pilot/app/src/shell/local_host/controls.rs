use super::governance::section_state;
use super::*;
use mediflow_runtime_client::{
    AiLocalState, AiRuntimeStatus, ControlsSnapshot, WhoReadiness, WhoReadinessStatus,
};
use serde_json::Value;

fn fact(label: &str, value: impl AsRef<str>, theme: Theme) -> Div {
    div()
        .id(SharedString::from(label.to_owned()))
        .child(super::governance::fact(label, value, theme))
}

#[derive(Default)]
pub(super) struct ControlsArea {
    snapshot: Option<ControlsSnapshot>,
    services: Option<HostServices>,
}
struct HostServices {
    address: String,
    authentication: Result<Value, RuntimeError>,
    runtime: Result<AiRuntimeStatus, RuntimeError>,
    who: Option<Result<WhoReadiness, RuntimeError>>,
}
fn local_runtime_label(state: AiLocalState) -> &'static str {
    match state {
        AiLocalState::Configured => "Configurazione presente",
        AiLocalState::Misconfigured => "Configurazione da correggere",
    }
}
fn who_label(status: WhoReadinessStatus) -> &'static str {
    match status {
        WhoReadinessStatus::Disabled => "Spento",
        WhoReadinessStatus::ConfigurationRequired => "Configurazione richiesta",
        WhoReadinessStatus::Configured => "Configurato, non ancora raggiunto",
        WhoReadinessStatus::Available => "Raggiunto",
        WhoReadinessStatus::Unavailable => "Non raggiunto",
    }
}
fn services_view(services: &HostServices, theme: Theme) -> Div {
    let mut pane = div()
        .flex()
        .flex_col()
        .gap(px(8.))
        .child(section("controls-services", "Servizi della postazione", theme))
        .child(text!("Risposte dei controlli di questa lettura. Non provano che un modello possa eseguire un’analisi."))
        .child(fact("Indirizzo dell’host", &services.address, theme));
    if let Some(error) = section_state("controls-auth-error", &services.authentication, theme) {
        pane = pane.child(error);
    }
    if let Ok(value) = &services.authentication {
        pane = pane.child(fact(
            "Controllo di autenticazione",
            value["status"].as_str().unwrap_or("Non indicato"),
            theme,
        ));
    }
    if let Some(error) = section_state("controls-runtime-error", &services.runtime, theme) {
        pane = pane.child(error);
    }
    if let Ok(status) = &services.runtime {
        pane = pane.child(fact(
            "Runtime AI locale",
            local_runtime_label(status.local_runtime.state),
            theme,
        ));
    }
    match &services.who {
        None => pane.child(fact(
            "ICD-11 WHO",
            "Seleziona un ambulatorio per leggerne lo stato",
            theme,
        )),
        Some(result) => {
            if let Some(error) = section_state("controls-who-error", result, theme) {
                pane = pane.child(error);
            }
            if let Ok(readiness) = result {
                pane = pane.child(fact("ICD-11 WHO", who_label(readiness.status), theme));
            }
            pane
        }
    }
}
fn fields(value: &Value, keys: &[(&str, &str)], theme: Theme) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(8.))
        .children(keys.iter().map(|(key, label)| {
            let text = match &value[*key] {
                Value::String(s) if !s.is_empty() => s.clone(),
                Value::Bool(true) => "Sì".into(),
                Value::Bool(false) => "No".into(),
                Value::Number(n) => n.to_string(),
                _ => "Non indicato".into(),
            };
            fact(label, text, theme)
        }))
}
fn compliance(theme: Theme) -> Div {
    let inventory: Value =
        serde_json::from_str(include_str!("../../../../comparison/compliance.json"))
            .expect("embedded inventory");
    let mut pane = div().flex().flex_col().gap(px(16.))
        .child(section("controls-compliance", "Evidenze e conformità", theme))
        .child(text!("Inventario di evidenze, non attestazione. Lo stato legale non è valutato. Applicabilità, ruoli, adempimenti e certificazioni richiedono una valutazione del deployment."));
    for (index, row) in inventory["records"]
        .as_array()
        .expect("inventory records")
        .iter()
        .enumerate()
    {
        let mut record = div()
            .id(SharedString::from(format!("controls-evidence-{index}")))
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(fields(
                row,
                &[
                    ("label", "Ambito"),
                    ("summary", "Evidenze"),
                    ("limitation", "Limite"),
                    ("owner", "Responsabile"),
                ],
                theme,
            ));
        let status = match row["status"].as_str() {
            Some("source_evidence") => "Evidenza nel sorgente",
            Some("source_evidence_with_limit") => "Evidenza con limite esplicito",
            _ => "Valutazione esterna necessaria",
        };
        record = record.child(fact("Stato", status, theme));
        for (index, source) in row["externalReferences"]
            .as_array()
            .expect("references")
            .iter()
            .enumerate()
        {
            record = record.child(
                div()
                    .id(SharedString::from(format!("official-reference-{index}")))
                    .child(fields(
                        source,
                        &[("label", "Fonte ufficiale"), ("href", "Indirizzo")],
                        theme,
                    )),
            );
        }
        pane = pane.child(record);
    }
    pane
}
impl ClinicalApp {
    pub(in crate::shell) fn read_controls(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let Some(session) = self.session.clone() else {
            return;
        };
        let scope = self.scope.clone();
        self.local_host.operation = Operation::Reading;
        self.local_host.controls.snapshot = None;
        self.local_host.controls.services = None;
        self.run_local_host(
            move || {
                let snapshot = access.read_controls()?;
                let services = HostServices {
                    address: session.base_url().to_owned(),
                    authentication: access.read_authentication_health(),
                    runtime: session.read_ai_runtime_status(),
                    who: scope.map(|scope| session.read_who_readiness(&scope)),
                };
                Ok((snapshot, services))
            },
            |this, result, cx| {
                this.local_host.operation = Operation::Idle;
                match result {
                    Ok((snapshot, services)) => {
                        this.local_host.controls.snapshot = Some(snapshot);
                        this.local_host.controls.services = Some(services);
                    }
                    Err(error) => this.local_host.operation = Operation::Failed(ui_error(error)),
                }
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }
    pub(in crate::shell) fn controls_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(heading("controls-heading", "Controlli", theme))
            .child(compliance(theme))
            .child(self.local_host_panel(cx));
        if self.local_host.access().is_none() {
            return pane;
        }
        pane = pane.child(
            button(
                "controls-read",
                "Rileggi controlli",
                theme,
                false,
                !self.local_host.has_work(),
            )
            .on_click(cx.listener(|this, _, _, cx| this.read_controls(cx))),
        );
        if matches!(self.local_host.operation, Operation::Reading) {
            return pane.child(notice(
                "controls-loading",
                "Lettura dei controlli…",
                theme,
                false,
            ));
        }
        let Some(snapshot) = &self.local_host.controls.snapshot else {
            return pane.child(notice(
                "controls-empty",
                "Controlli non ancora letti.",
                theme,
                false,
            ));
        };
        if let Some(services) = &self.local_host.controls.services {
            pane = pane.child(services_view(services, theme));
        }
        pane = pane.child(section("controls-updates","Aggiornamenti e revisione",theme))
            .child(text!("Informazioni del manifest locale. La lettura non cerca release in rete e non installa aggiornamenti."));
        for (id, result, keys) in [
            (
                "controls-updates-error",
                &snapshot.updates,
                &[
                    ("currentVersion", "Versione corrente"),
                    ("availableVersion", "Versione segnalata"),
                    ("updateAvailable", "Aggiornamento segnalato"),
                    ("source", "Fonte"),
                    ("channel", "Canale"),
                    ("checkedAt", "Lettura"),
                    ("changelogTitle", "Changelog"),
                    ("updateUrl", "Indirizzo aggiornamento"),
                ][..],
            ),
            (
                "controls-revision-error",
                &snapshot.revision,
                &[
                    ("revision", "Revisione host"),
                    ("branch", "Ramo host"),
                    ("sourceFingerprint", "Impronta sorgente"),
                    ("fingerprint", "Impronta build"),
                    ("worktreeHash", "Impronta checkout"),
                ][..],
            ),
        ] {
            if let Some(error) = section_state(id, result, theme) {
                pane = pane.child(error);
            }
            if let Ok(value) = result {
                pane = pane.child(fields(value, keys, theme));
            }
        }
        pane = pane.child(section("controls-audit","Audit operativo",theme))
            .child(text!("Ultimi eventi restituiti dal servizio, massimo 50. Questa finestra non rappresenta l’intero storico. Solo gli amministratori possono leggere l’audit."));
        if let Some(error) = section_state("controls-audit-error", &snapshot.audit, theme) {
            pane = pane.child(error);
        }
        if let Ok(value) = &snapshot.audit {
            let rows = value.as_array().expect("validated audit");
            if rows.is_empty() {
                pane = pane.child(fact("Eventi", "Nessun evento restituito", theme));
            }
            for (index, row) in rows.iter().enumerate() {
                pane = pane.child(
                    div()
                        .id(SharedString::from(format!("controls-audit-{index}")))
                        .child(fields(
                            row,
                            &[
                                ("eventId", "Evento"),
                                ("eventType", "Tipo"),
                                ("occurredAt", "Data"),
                                ("outcome", "Esito"),
                                ("actorType", "Tipo attore"),
                                ("actorRef", "Attore"),
                                ("subjectType", "Tipo oggetto"),
                                ("subjectRef", "Oggetto"),
                                ("sourceSurface", "Superficie"),
                                ("requestId", "Richiesta"),
                            ],
                            theme,
                        )),
                );
            }
        }
        pane=pane.child(section("controls-redaction","Servizio di redazione",theme))
            .child(text!("Il controllo health osserva la raggiungibilità. Non prova accuratezza della redazione o assenza di dati identificativi."));
        if let Some(error) = section_state("controls-redaction-error", &snapshot.redaction, theme) {
            pane = pane.child(error);
        }
        if let Ok(value) = &snapshot.redaction {
            pane = pane
                .child(fields(
                    value,
                    &[
                        ("provider", "Servizio"),
                        ("version", "Versione"),
                        ("available", "Raggiungibile"),
                        ("message", "Dettaglio"),
                    ],
                    theme,
                ))
                .child(fields(
                    &value["config"],
                    &[
                        ("baseUrl", "Indirizzo locale"),
                        ("defaultLanguage", "Lingua"),
                        ("defaultMethod", "Metodo"),
                        ("defaultConfidenceThreshold", "Soglia"),
                    ],
                    theme,
                ));
        }
        if let Ok(value) = &snapshot.redaction {
            pane = pane.child(fields(
                &value["service"],
                &[
                    ("status", "Stato del servizio"),
                    ("version", "Versione del servizio"),
                    ("profile", "Profilo"),
                ],
                theme,
            ));
        }
        pane
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn service_labels_do_not_claim_more_than_the_read_observed() {
        assert_eq!(
            who_label(WhoReadinessStatus::Configured),
            "Configurato, non ancora raggiunto"
        );
        assert_eq!(who_label(WhoReadinessStatus::Available), "Raggiunto");
        assert_eq!(
            local_runtime_label(AiLocalState::Configured),
            "Configurazione presente"
        );
    }
    fn snapshot() -> ControlsSnapshot {
        ControlsSnapshot {
            updates: Ok(serde_json::json!({"currentVersion":"0.9.1","notes":[]})),
            revision: Ok(serde_json::json!({"revision":"synthetic-head"})),
            audit: Err(RuntimeError::Forbidden),
            redaction: Ok(serde_json::json!({"provider":"openmed","available":false})),
        }
    }
    #[gpui::test]
    fn controls_draw_partial_empty_loading_and_withdraw(cx: &mut gpui::TestAppContext) {
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
        for scenario in 0..4 {
            view.update(cx, |app, _| {
                app.session = Some(host.session.clone());
                app.area = Area::Settings;
                app.settings_page = SettingsPage::Controls;
                app.local_host.authority = Authority::Open(access.clone());
                app.local_host.controls.snapshot = if scenario == 0 {
                    None
                } else {
                    Some(snapshot())
                };
                app.local_host.controls.services = (scenario != 0).then(|| HostServices {
                    address: "http://127.0.0.1:0".into(),
                    authentication: Ok(serde_json::json!({"status":"ok"})),
                    runtime: Err(RuntimeError::Forbidden),
                    who: None,
                });
                if scenario == 2 {
                    app.local_host.controls.snapshot.as_mut().unwrap().audit =
                        Ok(serde_json::json!([]));
                }
                app.local_host.operation = if scenario == 3 {
                    Operation::Reading
                } else {
                    Operation::Idle
                };
            });
            rendered_command::take_text_nodes();
            let commands = rendered_command::button_ids(|| {
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                })
            });
            assert_eq!(
                commands
                    .iter()
                    .filter(|s| s.starts_with("controls-"))
                    .count(),
                1
            );
            assert!(commands.contains(&"controls-read".into()));
            let text = rendered_command::take_text_nodes()
                .into_iter()
                .filter_map(|(_, n)| n.value().map(str::to_owned))
                .collect::<Vec<_>>();
            assert!(text.iter().any(|s| s.contains("whole-database")));
            if scenario == 1 || scenario == 2 {
                assert!(text.iter().any(|s| s == "Raggiungibile: No"));
                assert!(text.iter().any(|s| s == "Versione corrente: 0.9.1"));
            }
            if scenario == 2 {
                assert!(text.iter().any(|s| s == "Eventi: Nessun evento restituito"));
            }
        }
        view.update(cx, |app, cx| {
            app.local_host.operation = Operation::Idle;
            app.request_discard(Discard::Lock, cx);
            assert!(app.local_host.controls.snapshot.is_none());
        });
    }
    #[gpui::test]
    fn controls_no_authority_or_late_results(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Controls;
        });
        let commands = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert!(!commands.contains(&"controls-read".into()));
        view.update(cx, |app, cx| {
            app.run_local_host(
                || Ok(snapshot()),
                |this, result, _| this.local_host.controls.snapshot = result.ok(),
                cx,
            );
            app.local_host.withdraw(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.local_host.controls.snapshot.is_none())
        });
    }
}
