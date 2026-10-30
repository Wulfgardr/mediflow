use super::*;
use mediflow_runtime_client::{InsightBudget, InsightParameters};

pub(super) struct ParametersArea {
    fields: [Entity<TextInput>; 4],
    snapshot: Option<InsightParameters>,
    mode: String,
    router: String,
    message: Option<String>,
    _subscriptions: Vec<Subscription>,
}
impl ParametersArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let fields = [
            "Documenti massimi (da 2 a 12)",
            "Caratteri per documento (da 120 a 480)",
            "Budget contesto documenti (da 800 a 5000)",
            "Token massimi output (da 256 a 1200)",
        ]
        .map(|label| cx.new(|cx| TextInput::new(label, label, label, false, theme, cx)));
        let subscriptions = fields
            .iter()
            .map(|field| cx.subscribe(field, |_, _, _: &InputChanged, cx| cx.notify()))
            .collect();
        Self {
            fields,
            snapshot: None,
            mode: "full_auto".into(),
            router: "shadow".into(),
            message: None,
            _subscriptions: subscriptions,
        }
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        for field in &self.fields {
            field.update(cx, |input, cx| input.retire(cx));
        }
        self.snapshot = None;
        self.message = None;
        self.mode = "full_auto".into();
        self.router = "shadow".into();
    }
    pub(super) fn configure(&self, theme: Theme, disabled: bool, cx: &mut App) {
        for field in &self.fields {
            field.update(cx, |input, cx| {
                input.configure(theme, disabled || self.snapshot.is_none(), cx)
            });
        }
    }
}
impl ClinicalApp {
    pub(in crate::shell) fn parameters_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.parameters;
        let enabled = self.local_host.access().is_some() && !self.local_host.has_work();
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(section("insight-parameters", "Parametri avanzati", theme))
            .child(
                button(
                    "parameters-read",
                    "Rileggi parametri",
                    theme,
                    false,
                    enabled,
                )
                .on_click(cx.listener(|this, _, _, cx| this.read_parameters(cx))),
            );
        if area.snapshot.is_some() {
            pane = pane.child(text!("Budget contesto e output"));
            for (mode, label) in [
                ("full_auto", "Automatica"),
                ("balanced", "Rapida"),
                ("complete", "Approfondita"),
                ("manual", "Personalizzata"),
            ] {
                pane = pane.child(
                    button(
                        format!("parameters-mode-{mode}"),
                        label,
                        theme,
                        false,
                        enabled,
                    )
                    .aria_selected(area.mode == mode)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.local_host.parameters.mode = mode.into();
                        cx.notify();
                    })),
                );
            }
            if area.mode == "manual" {
                for (field, label) in area.fields.iter().zip([
                    "Documenti massimi (da 2 a 12)",
                    "Caratteri per documento (da 120 a 480)",
                    "Budget contesto documenti (da 800 a 5000)",
                    "Token massimi output (da 256 a 1200)",
                ]) {
                    pane = pane
                        .child(text!(label))
                        .child(crate::text_input::themed(field.clone(), theme));
                }
            }
            pane = pane.child(text!("Instradamento documentale deterministico"));
            for (mode, label, description) in [
                ("off", "Spento", "Il modello analizza tutti i documenti."),
                (
                    "shadow",
                    "Osservazione",
                    "Il router registra cosa salterebbe senza cambiare la sintesi.",
                ),
                (
                    "active",
                    "Attivo",
                    "Le classi a estrazione certa saltano il modello e usano la sintesi deterministica.",
                ),
            ] {
                pane = pane.child(
                    button(
                        format!("parameters-router-{mode}"),
                        label,
                        theme,
                        false,
                        enabled,
                    )
                    .aria_selected(area.router == mode)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.local_host.parameters.router = mode.into();
                        cx.notify();
                    })),
                );
                if area.router == mode {
                    pane = pane.child(text!(description));
                }
            }
            pane = pane.child(
                button(
                    "parameters-review",
                    "Rivedi parametri",
                    theme,
                    true,
                    enabled,
                )
                .on_click(cx.listener(|this, _, window, cx| this.prepare_parameters(window, cx))),
            );
        }
        if let Some(message) = &area.message {
            pane = pane.child(notice("parameters-message", message.clone(), theme, false));
        }
        pane
    }
    pub(super) fn read_parameters(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.operation = Operation::Reading;
        self.run_local_host(
            move || access.read_insight_parameters(),
            |this, result, cx| {
                this.local_host.operation = Operation::Idle;
                let area = &mut this.local_host.parameters;
                match result {
                    Ok(snapshot) => {
                        if area.snapshot.is_none() {
                            area.mode = snapshot.mode().as_str().into();
                            area.router = snapshot.router().as_str().into();
                            for (field, value) in area.fields.iter().zip([
                                snapshot.budget().max_documents(),
                                snapshot.budget().max_document_summary_chars(),
                                snapshot.budget().max_document_context_chars(),
                                snapshot.budget().output_max_tokens(),
                            ]) {
                                field.update(cx, |input, cx| {
                                    input.set_content(value.to_string(), cx)
                                });
                            }
                        }
                        area.snapshot = Some(snapshot);
                        area.message =
                            Some("Parametri riletti. La bozza già presente è conservata.".into());
                    }
                    Err(error) => area.message = Some(ui_error(error)),
                }
                if this.local_host.return_focus.is_some() {
                    this.local_host.focus_confirmation = true;
                }
                cx.notify();
            },
            cx,
        );
    }
    fn prepare_parameters(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let (Some(access), Some(before)) = (
            self.local_host.access(),
            self.local_host.parameters.snapshot.clone(),
        ) else {
            return;
        };
        let area = &self.local_host.parameters;
        let values = area
            .fields
            .each_ref()
            .map(|field| field.read(cx).value().parse::<u32>());
        let [
            Ok(max_documents),
            Ok(max_document_summary_chars),
            Ok(max_document_context_chars),
            Ok(output_max_tokens),
        ] = values
        else {
            self.local_host.parameters.message =
                Some("Inserisci numeri interi nei limiti indicati.".into());
            cx.notify();
            return;
        };
        let budget = InsightBudget::new(
            max_documents,
            max_document_summary_chars,
            max_document_context_chars,
            output_max_tokens,
        );
        let mode = area.mode.clone();
        let router = area.router.clone();
        self.local_host.return_focus = window.focused(cx);
        self.local_host.operation = Operation::Reading;
        self.run_local_host(
            move || access.prepare_insight_parameters(&before, &mode, budget?, &router),
            |this, result, cx| {
                this.local_host.operation = match result {
                    Ok(command) => Operation::Review(Command::Parameters(Arc::new(command))),
                    Err(error) => Operation::Failed(ui_error(error)),
                };
                this.local_host.focus_confirmation = true;
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
    fn parameter_draft_survives_navigation_and_lock_retires_fields(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.update(|window, cx| {
            view.update(cx, |app, cx| {
                app.area = Area::Settings;
                app.settings_page = SettingsPage::Functions;
                let field = app.local_host.parameters.fields[0].clone();
                field.update(cx, |input, cx| input.set_content("8", cx));
                app.local_host.parameters.mode = "manual".into();
                app.select_settings_page(SettingsPage::Overview, window, cx);
                assert_eq!(field.read(cx).value(), "8");
                assert_eq!(app.local_host.parameters.mode, "manual");
                app.request_discard(Discard::Lock, cx);
                assert!(field.read(cx).value().is_empty());
                assert!(app.local_host.parameters.snapshot.is_none());
            })
        });
    }
}
