use super::*;
use mediflow_runtime_client::{
    HardwareProfile, InstalledLocalModel, LocalModelConfiguration, PreparedLocalModels,
};

pub(super) struct ModelsArea {
    fields: [Entity<TextInput>; 3],
    snapshot: Load<LocalModelConfiguration>,
    inventory: Load<Vec<InstalledLocalModel>>,
    inventory_endpoint: Option<String>,
    hardware: HardwareProfile,
    current: bool,
    operation: ModelOperation,
    message: Option<String>,
    _subscriptions: Vec<Subscription>,
}
enum ModelOperation {
    Idle,
    Reading,
    Review(Arc<PreparedLocalModels>),
    Applying,
    Unconfirmed,
}
impl ModelsArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let fields = [
            ("models-url", "Indirizzo di Ollama sul computer"),
            ("models-clinical", "Sintesi e organizzazione"),
            ("models-reasoning", "Ragionamento testuale"),
        ]
        .map(|(id, title)| cx.new(|cx| TextInput::new(id, title, title, false, theme, cx)));
        let subscriptions = fields
            .iter()
            .map(|field| cx.subscribe(field, |_, _, _: &InputChanged, cx| cx.notify()))
            .collect();
        Self {
            fields,
            snapshot: Load::Idle,
            inventory: Load::Idle,
            inventory_endpoint: None,
            hardware: HardwareProfile::Custom,
            current: false,
            operation: ModelOperation::Idle,
            message: None,
            _subscriptions: subscriptions,
        }
    }
    pub(super) fn has_work(&self) -> bool {
        !matches!(self.operation, ModelOperation::Idle)
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        for field in &self.fields {
            field.update(cx, |input, cx| input.retire(cx));
        }
        self.snapshot = Load::Idle;
        self.current = false;
        self.inventory = Load::Idle;
        self.inventory_endpoint = None;
        self.operation = ModelOperation::Idle;
        self.message = None;
    }
    pub(super) fn configure(&mut self, theme: Theme, cx: &mut Context<ClinicalApp>) {
        let disabled = self.has_work() || !matches!(self.snapshot, Load::Ready(_));
        for field in &self.fields {
            field.update(cx, |input, cx| input.configure(theme, disabled, cx));
        }
    }
}
impl ClinicalApp {
    pub(in crate::shell) fn models_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.models;
        let enabled = self.local_host.access().is_some() && !self.local_host.has_work();
        let mut pane = div().min_w_0().flex().flex_col().gap(px(16.))
            .child(self.local_host_panel(cx))
            .child(button("models-read", "Rileggi configurazione", theme, false, enabled).on_click(cx.listener(|this, _, _, cx| this.read_model_configuration(cx))))
            .child(text!("Collega Ollama, scegli i modelli installati e salva. Le funzioni cliniche richiedono un’abilitazione separata e revisione delle proposte."));
        if matches!(area.snapshot, Load::Ready(_)) {
            for (field, label) in area.fields.iter().zip([
                "Indirizzo di Ollama sul computer",
                "Sintesi e organizzazione",
                "Ragionamento testuale",
            ]) {
                pane = pane.child(
                    div()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(text!(label))
                        .child(crate::text_input::themed(field.clone(), theme)),
                );
            }
            pane = pane.child(button("models-inventory", "Aggiorna modelli installati", theme, false, enabled).on_click(cx.listener(|this, _, _, cx| this.read_installed_models(cx))))
                .child(text!("La presenza in elenco non abilita le funzioni cliniche. La lettura non genera testo."));
            let current_endpoint = area.fields[0].read(cx).value();
            if area.inventory_endpoint.as_deref() == Some(current_endpoint) {
                match &area.inventory {
                    Load::Ready(rows) if rows.is_empty() => {
                        pane = pane.child(notice(
                            "models-empty",
                            "Nessun modello installato in Ollama.",
                            theme,
                            false,
                        ))
                    }
                    Load::Ready(rows) => {
                        for (index, row) in rows.iter().enumerate() {
                            let name = row.name.clone();
                            let name2 = name.clone();
                            pane = pane.child(
                                div()
                                    .min_w_0()
                                    .flex()
                                    .flex_col()
                                    .gap(px(8.))
                                    .child(text!(format!(
                                        "{} · {}",
                                        name,
                                        row.size
                                            .map(|size| format!(
                                                "{:.1} GB",
                                                size as f64 / 1_000_000_000.
                                            ))
                                            .unwrap_or_else(|| "Dimensione non disponibile".into())
                                    )))
                                    .child(
                                        button(
                                            format!("models-clinical-{index}"),
                                            "Usa per sintesi e organizzazione",
                                            theme,
                                            false,
                                            enabled,
                                        )
                                        .on_click(
                                            cx.listener(move |this, _, _, cx| {
                                                this.set_model_field(1, &name, cx)
                                            }),
                                        ),
                                    )
                                    .child(
                                        button(
                                            format!("models-reasoning-{index}"),
                                            "Usa per ragionamento testuale",
                                            theme,
                                            false,
                                            enabled,
                                        )
                                        .on_click(
                                            cx.listener(move |this, _, _, cx| {
                                                this.set_model_field(2, &name2, cx)
                                            }),
                                        ),
                                    ),
                            );
                        }
                    }
                    Load::Failed(message) => {
                        pane = pane.child(notice(
                            "models-inventory-error",
                            message.clone(),
                            theme,
                            true,
                        ))
                    }
                    _ => {}
                }
            } else if area.inventory_endpoint.is_some() {
                pane = pane.child(notice(
                    "models-inventory-stale",
                    "Connessione non ancora verificata per questa configurazione.",
                    theme,
                    false,
                ));
            }
            pane = pane.child(section(
                "models-presets",
                "Configurazioni consigliate",
                theme,
            ));
            for (profile, label) in [
                (HardwareProfile::Low, "Leggero · meno di 16 GB"),
                (HardwareProfile::Medium, "Bilanciato · 16–32 GB"),
                (HardwareProfile::High, "Avanzato · oltre 32 GB"),
            ] {
                pane = pane.child(
                    button(
                        format!("models-hardware-{}", profile.wire()),
                        label,
                        theme,
                        false,
                        enabled,
                    )
                    .aria_selected(area.hardware == profile)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if this.local_host.has_work() {
                            return;
                        }
                        if let Some(model) = profile.recommended_model() {
                            this.set_model_field(1, model, cx);
                            this.set_model_field(2, model, cx);
                            this.local_host.models.hardware = profile;
                            cx.notify();
                        }
                    })),
                );
            }
            pane = pane.child(text!("La configurazione consigliata aggiorna la bozza, senza scaricarla o salvarla. La memoria è un’indicazione orientativa: compatibilità e qualità vanno verificate. OCR e revisione terapeutica ATHENA hanno una configurazione separata."))
                .child(button("models-prepare", "Rivedi configurazione", theme, true, enabled && area.current).on_click(cx.listener(|this, _, window, cx| this.prepare_models(window, cx))))
                .child(text!("Per scaricare un modello, usa gli strumenti di Ollama sul computer che lo ospita. Poi aggiorna l’elenco. Il servizio di MediFlow non offre scaricamento o rimozione."));
        }
        if let Load::Failed(message) = &area.snapshot {
            pane = pane.child(notice("models-config-error", message.clone(), theme, true));
        }
        if let Some(message) = &area.message {
            pane = pane.child(notice("models-message", message.clone(), theme, false));
        }
        pane
    }
    fn set_model_field(&mut self, index: usize, value: &str, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        self.local_host.models.fields[index].update(cx, |input, cx| input.set_content(value, cx));
        self.local_host.models.hardware = HardwareProfile::Custom;
        self.local_host.models.message = None;
        cx.notify();
    }
    pub(in crate::shell) fn read_model_configuration(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.models.current = false;
        self.local_host.models.operation = ModelOperation::Reading;
        self.run_local_host(move || access.read_local_model_configuration(), |this, result, cx| {
            this.local_host.models.operation = ModelOperation::Idle;
            match result {
                Ok(config) => {
                    let area = &mut this.local_host.models;
                    let preserve = area.snapshot.ready().is_some_and(|old| [old.endpoint.as_str(), old.clinical.as_str(), old.reasoning.as_str()].into_iter().zip(&area.fields).any(|(value, field)| value != field.read(cx).value()) || area.hardware != old.hardware);
                    if !preserve {
                        for (field, value) in area.fields.iter().zip([&config.endpoint, &config.clinical, &config.reasoning]) { field.update(cx, |input, cx| input.set_content(value, cx)); }
                        area.hardware = config.hardware;
                    }
                    area.snapshot = Load::Ready(config);
                    area.current = true;
                    area.message = Some(if preserve { "Configurazione riletta. La bozza è conservata: confrontala prima di confermare." } else { "Configurazione riletta dall’host." }.into());
                }
                Err(error) => {
                    this.local_host.models.current = false;
                    this.local_host.models.message = Some(format!("{} Configurazione non disponibile. La bozza è conservata.", ui_error(error)));
                }
            }
            cx.notify();
        }, cx);
    }
    fn read_installed_models(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let endpoint = self.local_host.models.fields[0].read(cx).value().to_owned();
        self.local_host.models.inventory_endpoint = Some(endpoint.clone());
        self.local_host.models.operation = ModelOperation::Reading;
        self.run_local_host(
            move || access.installed_local_models(&endpoint),
            |this, result, cx| {
                this.local_host.models.operation = ModelOperation::Idle;
                this.local_host.models.inventory = Load::from_result(result);
                cx.notify();
            },
            cx,
        );
    }
    fn prepare_models(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.local_host.has_work() || !self.local_host.models.current {
            return;
        }
        let (Some(access), Some(before)) = (
            self.local_host.access(),
            self.local_host.models.snapshot.ready().cloned(),
        ) else {
            return;
        };
        let values = self
            .local_host
            .models
            .fields
            .each_ref()
            .map(|field| field.read(cx).value().to_owned());
        let hardware = self.local_host.models.hardware;
        self.local_host.return_focus = window.focused(cx);
        self.local_host.models.operation = ModelOperation::Reading;
        self.run_local_host(
            move || {
                access.prepare_local_models(&before, &values[0], &values[1], &values[2], hardware)
            },
            |this, result, cx| {
                match result {
                    Ok(command) => {
                        this.local_host.models.operation = ModelOperation::Review(Arc::new(command))
                    }
                    Err(error) => {
                        this.local_host.models.operation = ModelOperation::Idle;
                        this.local_host.models.message = Some(ui_error(error));
                    }
                }
                this.local_host.focus_confirmation = true;
                cx.notify();
            },
            cx,
        );
    }
    pub(super) fn cancel_models_review(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !matches!(self.local_host.models.operation, ModelOperation::Review(_)) {
            return false;
        }
        self.local_host.models.operation = ModelOperation::Idle;
        if let Some(focus) = self.local_host.return_focus.take() {
            window.focus(&focus, cx);
        }
        cx.notify();
        true
    }
    fn apply_models(&mut self, cx: &mut Context<Self>) {
        let ModelOperation::Review(command) = &self.local_host.models.operation else {
            return;
        };
        let command = command.clone();
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.models.operation = ModelOperation::Applying;
        self.run_local_host(move || access.apply_local_models(&command), |this, result, cx| {
            match result {
                Ok(true) => {
                    this.local_host.models.operation = ModelOperation::Idle;
                    this.local_host.models.current = false;
                    this.local_host.models.message = Some("Configurazione salvata e riletta. Le funzioni mantengono abilitazioni e consensi separati.".into());
                }
                _ => {
                    this.local_host.models.current = false;
                    this.local_host.models.operation = ModelOperation::Unconfirmed;
                    this.local_host.models.message = Some("Salvataggio non confermato. Alcune impostazioni possono essere già cambiate. Nessun reinvio automatico: rileggi lo stato e confronta la bozza prima di preparare una nuova operazione.".into());
                }
            }
            this.local_host.focus_confirmation = true;
            cx.notify();
        }, cx);
    }
    pub(super) fn models_threshold(
        &self,
        threshold: Stateful<Div>,
        cx: &Context<Self>,
    ) -> Option<Stateful<Div>> {
        let theme = self.theme;
        let area = &self.local_host.models;
        Some(match &area.operation {
            ModelOperation::Idle => return None,
            ModelOperation::Reading | ModelOperation::Applying => threshold.child(notice("models-pending", if matches!(area.operation, ModelOperation::Reading) { "Lettura della configurazione e dei modelli…" } else { "Salvataggio e rilettura della configurazione…" }, theme, false)),
            ModelOperation::Review(command) => threshold
                .child(confirmation_heading(crate::title::TitleText::from("Salvare la configurazione dei modelli?"), theme))
                .child(text!(format!("{} · Sintesi e organizzazione: {} · Ragionamento testuale: {}", command.endpoint(), command.clinical(), command.reasoning())))
                .child(text!("Le impostazioni sono salvate separatamente. Un errore può lasciare una modifica parziale. Salvare il modello non ammette il provider e non abilita una funzione clinica."))
                .child(self.local_host.targets[0].attach(button("models-cancel", "Annulla", theme, false, true)).on_click(cx.listener(|this, _, window, cx| {
                    this.cancel_models_review(window, cx);
                })))
                .child(self.local_host.targets[1].attach(button("models-confirm", "Salva configurazione", theme, true, true)).on_click(cx.listener(|this, _, _, cx| this.apply_models(cx)))),
            ModelOperation::Unconfirmed => threshold
                .child(notice("models-unconfirmed", area.message.clone().unwrap_or_default(), theme, true))
                .child(self.local_host.targets[0].attach(button("models-reconcile", "Rileggi e confronta la bozza", theme, false, true)).on_click(cx.listener(|this, _, _, cx| {
                    this.local_host.models.operation = ModelOperation::Idle;
                    this.read_model_configuration(cx);
                }))),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn models_keep_draft_on_navigation_but_lock_clears_draft_and_inventory(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.update(|window, cx| {
            view.update(cx, |app, cx| {
                app.area = Area::Settings;
                app.settings_page = SettingsPage::Models;
                let editor = app.local_host.models.fields[1].clone();
                editor.update(cx, |input, cx| input.set_content("synthetic-model:7b", cx));
                app.select_settings_page(SettingsPage::Overview, window, cx);
                assert_eq!(editor.read(cx).value(), "synthetic-model:7b");
                app.local_host.models.operation = ModelOperation::Unconfirmed;
                app.select_settings_page(SettingsPage::Models, window, cx);
                assert_eq!(app.settings_page, SettingsPage::Overview);
                app.request_discard(Discard::Lock, cx);
                assert!(editor.read(cx).value().is_empty());
                assert!(matches!(app.local_host.models.inventory, Load::Idle));
            })
        });
    }
}
