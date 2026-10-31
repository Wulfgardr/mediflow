use super::governance::{fact, section_state};
use super::*;
use mediflow_runtime_client::ControlsSnapshot;
use serde_json::Value;

#[derive(Default)]
pub(super) struct ControlsArea {
    snapshot: Option<ControlsSnapshot>,
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
    for row in inventory["records"].as_array().expect("inventory records") {
        pane = pane.child(fields(
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
        pane = pane.child(fact("Stato", status, theme));
        for source in row["evidence"].as_array().expect("evidence") {
            pane = pane.child(fact(
                "Fonte nel repository",
                source.as_str().unwrap_or("Non indicata"),
                theme,
            ));
        }
        for source in row["externalReferences"].as_array().expect("references") {
            pane = pane.child(fields(
                source,
                &[("label", "Fonte ufficiale"), ("href", "Indirizzo")],
                theme,
            ));
        }
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
        self.local_host.operation = Operation::Reading;
        self.local_host.controls.snapshot = None;
        self.run_local_host(
            move || access.read_controls(),
            |this, result, cx| {
                this.local_host.operation = Operation::Idle;
                match result {
                    Ok(snapshot) => this.local_host.controls.snapshot = Some(snapshot),
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
        if let Ok(value) = &snapshot.updates {
            for note in value["notes"].as_array().into_iter().flatten() {
                pane = pane.child(fact("Nota", note.as_str().unwrap_or("Non indicata"), theme));
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
            for row in rows {
                pane = pane.child(fields(
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
                ));
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
