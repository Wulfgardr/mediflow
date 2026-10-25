//! Read-only host configuration. This surface never starts or configures AI.

use super::*;
use crate::theme::{TypeRole, TypeStyle};
use mediflow_runtime_client::{AiCentralState, AiFunctionSwitch, AiLocalState, AiRuntimeStatus};

pub(super) struct AiRuntimeObservation {
    status: AiRuntimeStatus,
    received_at: chrono::DateTime<chrono::Local>,
}

impl ClinicalApp {
    pub(super) fn load_ai_status(&mut self, cx: &mut Context<Self>) {
        self.next_epoch();
        let Some(session) = self.session.clone() else {
            return;
        };
        self.ai_status = Load::Loading;
        self.run(
            move || session.read_ai_runtime_status(),
            Self::receive_ai_status,
            cx,
        );
        cx.notify();
    }

    fn receive_ai_status(
        &mut self,
        result: Result<AiRuntimeStatus, RuntimeError>,
        _: &mut Context<Self>,
    ) {
        self.ai_status = Load::from_result(result.map(|status| AiRuntimeObservation {
            status,
            received_at: chrono::Local::now(),
        }));
    }

    pub(super) fn ai_status_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let enabled = self.session.is_some() && !matches!(self.ai_status, Load::Loading);
        let pane = div()
            .min_w_0()
            .max_w_full()
            .border_t_1()
            .border_color(theme.rule)
            .pt(px(24.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(section(
                "clinical-workspace-ai-status-heading",
                "STATO FUNZIONI AI",
                theme,
            ))
            .child(notice(
                "clinical-workspace-ai-status-boundary",
                "Questa pagina mostra la configurazione dell'archivio. Non verifica se i modelli sono disponibili.",
                theme,
                false,
            ))
            .child(
                self.ai_refresh_target
                    .attach_enabled(
                        button(
                            "clinical-workspace-ai-status-refresh",
                            "Rileggi stato AI",
                            theme,
                            false,
                            enabled,
                        ),
                        enabled,
                    )
                    .when(enabled, |el| {
                        el.on_click(cx.listener(|this, _, _, cx| this.load_ai_status(cx)))
                    }),
            );
        let Some(observed) = self.ai_status.ready() else {
            return pane.child(notice(
                "clinical-workspace-ai-status-state",
                match &self.ai_status {
                    Load::Idle => "Stato AI non ancora letto.".to_owned(),
                    Load::Loading => "Lettura dello stato AI dall'archivio…".to_owned(),
                    Load::Failed(message) => format!("{message} Lo stato AI non è disponibile. Puoi riprovare con Rileggi stato AI."),
                    Load::Ready(_) => unreachable!(),
                },
                theme,
                matches!(self.ai_status, Load::Failed(_)),
            ));
        };
        let status = &observed.status;
        pane.child(notice(
            "clinical-workspace-ai-status-observed",
            format!(
                "Stato ricevuto il {} (ora locale). Rileggi per aggiornare la configurazione mostrata.",
                observed.received_at.format("%d/%m/%Y · %H:%M:%S"),
            ),
            theme,
            false,
        ))
        .children([
            ("patient-insight", "Riepilogo assistito del paziente", status.kill_switches.patient_insight),
            ("document-synthesis", "Sintesi dei documenti", status.kill_switches.document_synthesis),
            ("smart-import", "Importazione assistita", status.kill_switches.smart_import),
            ("treatment-reasoning", "Ragionamento sul trattamento", status.kill_switches.treatment_reasoning),
        ].map(|(id, title, state)| status_row(id, title, match state {
            AiFunctionSwitch::Enabled => "Abilitata nella configurazione",
            AiFunctionSwitch::Disabled => "Disabilitata nella configurazione",
        }, theme)))
        .child(status_row("local-runtime", "Runtime locale dell'archivio", match status.local_runtime.state {
            AiLocalState::Configured => "Ollama · Configurazione presente",
            AiLocalState::Misconfigured => "Ollama · Configurazione da correggere",
        }, theme))
        .child(status_row("central-runtime", "Runtime centrale", match status.central_runtime.state {
            AiCentralState::Available => "Configurazione presente · Solo consultazione",
            AiCentralState::Unavailable => "Configurazione non disponibile · Solo consultazione",
            AiCentralState::Disabled => "Disabilitato · Solo consultazione",
        }, theme))
        .children([
            ("clinical-model", "Modello clinico configurato", &status.local_runtime.clinical_model),
            ("reasoning-model", "Modello di ragionamento configurato", &status.local_runtime.reasoning_model),
        ].map(|(id, title, model)| status_row(id, title, model.as_deref().filter(|model| !model.trim().is_empty()).unwrap_or("Non riportato"), theme)))
    }
}

fn status_row(id: &str, title: &str, value: &str, theme: Theme) -> Stateful<Div> {
    let id = SharedString::from(format!("clinical-workspace-ai-status-{id}"));
    div()
        .id(id.clone())
        .accessibility_id(id)
        .role(Role::Note)
        .aria_label(SharedString::from(format!("{title}: {value}")))
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .border_b_1()
        .border_color(theme.rule)
        .py(px(8.))
        .flex()
        .flex_col()
        .gap(px(4.))
        .child(
            div()
                .type_role(theme, TypeRole::Strong)
                .child(text!(title.to_owned())),
        )
        .child(
            div()
                .text_color(theme.secondary)
                .child(text!(value.to_owned())),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status() -> AiRuntimeStatus {
        serde_json::from_value(serde_json::json!({
            "localRuntime": { "state":"configured", "clinicalModel":"synthetic-model", "reasoningModel":null, "ocrModel":null },
            "centralRuntime": { "state":"available" },
            "killSwitches": { "patientInsight":"enabled", "smartImport":"disabled", "documentSynthesis":"enabled", "treatmentReasoning":"disabled" }
        })).unwrap()
    }

    #[gpui::test]
    fn g1a2_r2_ai_same_authority_retirement_survives_navigation(cx: &mut gpui::TestAppContext) {
        let host = crate::shell::notes_recovery_tests::Host::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let editor = view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            let editor = app.account_profile.synthetic_draft(cx);
            app.run(
                || Err(RuntimeError::Authentication),
                ClinicalApp::receive_ai_status,
                cx,
            );
            app.navigate(Area::Scales, cx);
            editor
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.session.is_none());
            assert!(app.form.is_none());
            assert!(matches!(app.ai_status, Load::Idle));
            assert!(
                app.message
                    .as_ref()
                    .unwrap()
                    .0
                    .contains(&ui_error(RuntimeError::Authentication))
            );
        });
        editor.read_with(cx, |input, _| {
            assert!(input.value().is_empty());
            assert!(input.read_only);
        });
        let requests = host.request_count();
        assert_eq!(
            host.session
                .update_patient_notes("scope-a", "patient-a", 1, "late write"),
            Err(RuntimeError::Locked)
        );
        assert_eq!(host.request_count(), requests);
    }

    #[gpui::test]
    fn ai_status_results_are_retired_by_refresh_navigation_and_lock(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.ai_status = Load::Loading;
            app.run(|| Ok(status()), ClinicalApp::receive_ai_status, cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            let current = app.ai_status.ready().unwrap();
            assert!(current.status.kill_switches.patient_insight == AiFunctionSwitch::Enabled);
            assert!(current.status.kill_switches.smart_import == AiFunctionSwitch::Disabled);
            assert_eq!(
                current.status.local_runtime.clinical_model.as_deref(),
                Some("synthetic-model")
            );
            // A new read clears the displayed snapshot before its response.
            app.next_epoch();
            assert!(matches!(app.ai_status, Load::Idle));
            app.ai_status = Load::Loading;
            app.run(
                || Err(RuntimeError::Transport),
                ClinicalApp::receive_ai_status,
                cx,
            );
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(matches!(app.ai_status, Load::Failed(_)));
            app.run(|| Ok(status()), ClinicalApp::receive_ai_status, cx);
            app.navigate(Area::Analytics, cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(matches!(app.ai_status, Load::Idle));
            app.run(
                || Err(RuntimeError::Transport),
                ClinicalApp::receive_ai_status,
                cx,
            );
            app.navigate(Area::Scales, cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(app.message.is_none());
            app.run(|| Ok(status()), ClinicalApp::receive_ai_status, cx);
            app.disconnect(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| assert!(matches!(app.ai_status, Load::Idle)));
    }
}
