use super::super::who_administration::readiness_label;
use super::*;
use std::time::Instant;
const NAMES: [&str; 4] = [
    "Autenticazione",
    "Catalogo del provider AI locale",
    "Disponibilità WHO",
    "Impostazioni del provider AI",
];
pub(super) enum DiagnosticOutcome {
    Observed(String),
    Unavailable(String),
}
pub(super) struct DiagnosticResult {
    outcome: Result<DiagnosticOutcome, RuntimeError>,
    elapsed_ms: u128,
    checked_at: String,
}
fn diagnose(
    access: &mediflow_runtime_client::LocalHostAccess,
    index: usize,
) -> Result<DiagnosticOutcome, RuntimeError> {
    match index {
        0 => access.read_authentication_health().map(|v| {
            if v["status"] == "ok" {
                DiagnosticOutcome::Observed(
                    "Risposta del controllo di autenticazione ricevuta.".into(),
                )
            } else {
                DiagnosticOutcome::Unavailable(
                    "Il controllo non conferma la disponibilità dell’accesso.".into(),
                )
            }
        }),
        1 => {
            let provider = access.read_diagnostic_provider_setting()?;
            let Some(provider) = provider else {
                return Ok(DiagnosticOutcome::Unavailable("Nessun provider specificato nelle impostazioni. Questo controllo richiede una scelta esplicita del provider locale Ollama.".into()));
            };
            if provider != "ollama" {
                return Ok(DiagnosticOutcome::Unavailable(
                    "La verifica del catalogo è disponibile per il provider locale Ollama.".into(),
                ));
            }
            let config = access.read_local_model_configuration()?;
            access.installed_local_models(&config.endpoint).map(|models| {
                DiagnosticOutcome::Observed(format!("Risposta del catalogo locale: {} modelli dichiarati. Non verifica una generazione.", models.len()))
            })
        }
        2 => access.read_who_administration_readiness().map(|v| {
            let message = readiness_label(v["status"].as_str().unwrap_or("")).to_owned();
            if v["status"] == "available" {
                DiagnosticOutcome::Observed(message)
            } else {
                DiagnosticOutcome::Unavailable(message)
            }
        }),
        _ => access.read_diagnostic_provider_setting().map(|provider| {
            DiagnosticOutcome::Observed(match provider {
                Some(provider) => format!("Configurazione letta: {provider}."),
                None => "Impostazione letta: nessun provider specificato.".into(),
            })
        }),
    }
}

impl ClinicalApp {
    pub(in crate::shell::local_host::controls) fn run_diagnostics(
        &mut self,
        index: Option<usize>,
        cx: &mut Context<Self>,
    ) {
        if self.local_host.has_work() || index.is_some_and(|i| i >= 4) {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let indices = index.map(|i| vec![i]).unwrap_or_else(|| vec![0, 1, 2, 3]);
        self.local_host.controls.diagnostic_busy = true;
        for i in &indices {
            self.local_host.controls.diagnostics[*i] = None;
        }
        self.run_local_host(
            move || {
                let mut rows = Vec::new();
                for i in indices {
                    let start = Instant::now();
                    let outcome = diagnose(&access, i);
                    if let Err(error) = outcome
                        && (error.retires_session() || error.status_code() == Some(401))
                    {
                        return Err(error);
                    }
                    rows.push((
                        i,
                        DiagnosticResult {
                            outcome,
                            elapsed_ms: start.elapsed().as_millis(),
                            checked_at: chrono::Local::now()
                                .format("%d/%m/%Y %H:%M:%S")
                                .to_string(),
                        },
                    ));
                }
                Ok(rows)
            },
            |this, result, cx| {
                this.local_host.controls.diagnostic_busy = false;
                match result {
                    Ok(rows) => {
                        for (i, result) in rows {
                            this.local_host.controls.diagnostics[i] = Some(result);
                        }
                    }
                    Err(error) => this.local_host.operation = Operation::Failed(ui_error(error)),
                }
                cx.notify();
            },
            cx,
        );
    }
    pub(in crate::shell::local_host::controls) fn diagnostic_hub_view(
        &self,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        let a = &self.local_host.controls;
        let theme = self.theme;
        let enabled = self.local_host.access().is_some() && !self.local_host.has_work();
        let mut pane=div().id("diagnostic-hub").flex().flex_col().gap(px(12.)).child(section("diagnostic-hub-title","Diagnostica",theme))
            .child(text!("Controlli eseguiti soltanto su richiesta. Le risposte osservano accesso, cataloghi e configurazione; non provano accuratezza clinica o capacità di generazione."))
            .child(button("diagnostic-run-all","Esegui tutti i controlli",theme,false,enabled).on_click(cx.listener(|this,_,_,cx|this.run_diagnostics(None,cx))));
        if a.diagnostic_busy {
            pane = pane.child(notice(
                "diagnostic-busy",
                "Controlli in corso…",
                theme,
                false,
            ));
        }
        for (i, name) in NAMES.iter().enumerate() {
            let mut card = div()
                .id(format!("diagnostic-result-{i}"))
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(governance::fact("Controllo", name, theme));
            if let Some(r) = &a.diagnostics[i] {
                let (label, message) = match &r.outcome {
                    Ok(DiagnosticOutcome::Observed(message)) => {
                        ("Risposta ricevuta", message.clone())
                    }
                    Ok(DiagnosticOutcome::Unavailable(message)) => {
                        ("Non disponibile", message.clone())
                    }
                    Err(error) => ("Verifica non riuscita", ui_error(*error)),
                };
                card = card
                    .child(governance::fact("Esito", label, theme))
                    .child(text!(message))
                    .child(governance::fact("Data del controllo", &r.checked_at, theme))
                    .child(governance::fact(
                        "Durata osservata",
                        format!("{} ms", r.elapsed_ms),
                        theme,
                    ));
            } else {
                card = card.child(text!("Non ancora verificato"));
            }
            card = card.child(
                button(
                    format!("diagnostic-run-{i}"),
                    format!("Verifica {name}"),
                    theme,
                    false,
                    enabled,
                )
                .on_click(cx.listener(move |this, _, _, cx| this.run_diagnostics(Some(i), cx))),
            );
            pane = pane.child(card);
        }
        pane
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn diagnostics_keep_unavailable_checks_separate_and_retry_only_selected_check(
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
        for _ in 0..2 {
            host.plan("GET /api/settings/aiProvider")
                .send((
                    200,
                    serde_json::json!({"key":"aiProvider","value":"chatgpt"}),
                ))
                .unwrap();
        }
        let mut who: Value = serde_json::from_str(include_str!(
            "../../../../../transport/tests/fixtures/who-administration.json"
        ))
        .unwrap();
        who["readiness"]["status"] = serde_json::json!("unavailable");
        who["readiness"]["catalogState"] = serde_json::json!("absent");
        who["readiness"]["datasetSnapshotId"] = Value::Null;
        host.plan("GET /api/icd/proxy")
            .send((503, who["readiness"].clone()))
            .unwrap();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.local_host.authority = Authority::Open(access);
            app.area = Area::Settings;
            app.settings_page = SettingsPage::Controls;
        });
        let before = host.request_count();
        notes_recovery_tests::draw(cx);
        assert_eq!(host.request_count(), before);
        view.update(cx, |app, cx| {
            app.run_diagnostics(None, cx);
            assert!(app.local_host.has_work());
            app.run_diagnostics(Some(0), cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            let rows = &app.local_host.controls.diagnostics;
            assert!(matches!(
                rows[0].as_ref().unwrap().outcome,
                Ok(DiagnosticOutcome::Observed(_))
            ));
            assert!(matches!(
                rows[1].as_ref().unwrap().outcome,
                Ok(DiagnosticOutcome::Unavailable(_))
            ));
            assert!(matches!(
                rows[2].as_ref().unwrap().outcome,
                Ok(DiagnosticOutcome::Unavailable(_))
            ));
            assert!(matches!(
                rows[3].as_ref().unwrap().outcome,
                Ok(DiagnosticOutcome::Observed(_))
            ));
        });
        let before = host.request_count();
        host.plan("GET /api/icd/proxy")
            .send((503, serde_json::json!({"error":"synthetic unavailable"})))
            .unwrap();
        view.update(cx, |app, cx| app.run_diagnostics(Some(2), cx));
        cx.run_until_parked();
        assert_eq!(host.request_count(), before + 1);
        host.plan("GET /api/settings/aiProvider")
            .send((200, serde_json::json!({"key":"aiProvider","value":null})))
            .unwrap();
        view.update(cx, |app, cx| app.run_diagnostics(Some(3), cx));
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(matches!(
                app.local_host.controls.diagnostics[3]
                    .as_ref()
                    .unwrap()
                    .outcome,
                Ok(DiagnosticOutcome::Observed(_))
            ));
            assert!(
                app.local_host.controls.diagnostics[2]
                    .as_ref()
                    .unwrap()
                    .outcome
                    .is_err()
            );
            assert!(matches!(
                app.local_host.controls.diagnostics[1]
                    .as_ref()
                    .unwrap()
                    .outcome,
                Ok(DiagnosticOutcome::Unavailable(_))
            ));
            app.withdraw_local_host(cx);
            assert!(
                app.local_host
                    .controls
                    .diagnostics
                    .iter()
                    .all(Option::is_none)
            );
        });
        assert!(
            !host
                .routes()
                .iter()
                .any(|r| r.starts_with("POST /api/icd") || r.contains("generate"))
        );
    }
}
