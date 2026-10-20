//! Native preferences presentation over the existing host owner. Drafts never
//! execute models; only an explicitly confirmed host preview can be submitted.

use super::*;
use mediflow_runtime_client::{
    AiBindingState, AiDefaultSource, AiFunctionId, AiFunctionPreference, AiFunctionPreferences,
    AiModelState, AiPreferenceChange, AiPreferencePreset, AiPreferencesCommand,
    AiPreferencesContext, AiPreferencesPreview, AiPreferencesReadback,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Working {
    Read,
    Preview,
    Save,
}

pub(super) struct AiPreferences {
    pub(super) active: bool,
    context: Option<AiPreferencesContext>,
    snapshot: Option<AiFunctionPreferences>,
    received_at: Option<chrono::DateTime<chrono::Local>>,
    current: bool,
    draft: Option<AiPreferenceChange>,
    preview: Option<AiPreferencesPreview>,
    working: Option<Working>,
    message: String,
    failed: bool,
    targets: [ScrollTarget; 14],
    model_targets: HashMap<String, ScrollTarget>,
    focus_target: Option<usize>,
}
impl AiPreferences {
    pub(super) fn new(scroll: &ScrollHandle, cx: &App) -> Self {
        Self {
            active: false,
            context: None,
            snapshot: None,
            received_at: None,
            current: false,
            draft: None,
            preview: None,
            working: None,
            message: String::new(),
            failed: false,
            targets: std::array::from_fn(|_| ScrollTarget::new(scroll, cx)),
            model_targets: HashMap::new(),
            focus_target: None,
        }
    }
    pub(super) fn reset(&mut self) {
        if let Some(context) = self.context.take() {
            context.cancel();
        }
        self.active = false;
        self.snapshot = None;
        self.received_at = None;
        self.current = false;
        self.draft = None;
        self.preview = None;
        self.working = None;
        self.message.clear();
        self.failed = false;
        self.model_targets.clear();
        self.focus_target = None;
    }
    pub(super) fn has_work(&self) -> bool {
        self.draft.is_some() || self.working.is_some()
    }
    pub(super) fn is_saving(&self) -> bool {
        self.working == Some(Working::Save)
    }
    fn can_edit(&self) -> bool {
        self.working.is_none() && self.preview.is_none()
    }
    fn can_prepare(&self) -> bool {
        self.current && self.context.is_some() && self.draft.is_some() && self.can_edit()
    }
    fn observed(&mut self, snapshot: AiFunctionPreferences) {
        self.snapshot = Some(snapshot);
        self.received_at = Some(chrono::Local::now());
        self.current = true;
        self.working = None;
        self.failed = false;
    }
    fn failure(&mut self, error: RuntimeError) {
        let saving = self.is_saving();
        if let Some(context) = self.context.take() {
            context.cancel();
        }
        self.current = false;
        self.preview = None;
        self.working = None;
        self.failed = true;
        let reason = match error {
            RuntimeError::Forbidden => {
                "Serve un operatore amministratore. Chiedi all’amministratore di autorizzare questo operatore e questo dispositivo sul computer host."
            }
            RuntimeError::Conflict => {
                "Le preferenze o il catalogo sono cambiati sull’host. Rileggi e prepara una nuova anteprima."
            }
            RuntimeError::Missing | RuntimeError::UnsupportedProtocol => {
                "Questo host non espone una configurazione AI compatibile. Verifica la versione sul computer host."
            }
            RuntimeError::Authentication | RuntimeError::Locked => {
                "La sessione non è più valida. Accedi nuovamente."
            }
            RuntimeError::InvalidInput => {
                "Il modello della bozza non è più nel catalogo letto. Scegli un’opzione disponibile nel catalogo o il valore dell’host."
            }
            RuntimeError::Rejected(400) => {
                "L’host non accetta questa scelta. Verifica funzione e modello dopo una nuova lettura."
            }
            _ => {
                "Non è stato possibile verificare la risposta dell’host. Rileggi prima di riprovare; nessun invio automatico."
            }
        };
        self.message = format!(
            "{}{}{}",
            if saving {
                "Salvataggio non verificato. "
            } else {
                ""
            },
            reason,
            if self.draft.is_some() {
                " La bozza è conservata in questa finestra."
            } else {
                ""
            }
        );
        self.focus_target = Some(1);
    }
    pub(super) fn reveal_if_focused(&self, window: &mut Window, cx: &mut App) -> bool {
        self.targets
            .iter()
            .chain(self.model_targets.values())
            .any(|target| target.reveal_if_focused(window, cx))
    }
    pub(super) fn prepare_render(&mut self, window: &mut Window, cx: &mut App) {
        if let Some(index) = self.focus_target.take() {
            window.focus(&self.targets[index].focus, cx);
            self.targets[index].scroll_to(window, cx);
        }
    }
}

impl ClinicalApp {
    pub(super) fn load_ai_preferences(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else {
            return;
        };
        if self.ai_preferences.working.is_some() {
            return;
        }
        if let Some(context) = self.ai_preferences.context.take() {
            context.cancel();
        }
        let context = session.ai_preferences_context();
        let state = &mut self.ai_preferences;
        state.active = true;
        state.context = Some(context.clone());
        state.preview = None;
        state.current = false;
        state.working = Some(Working::Read);
        state.failed = false;
        state.message = "Lettura delle preferenze sull’host…".into();
        self.run(
            move || session.read_ai_preferences(&context),
            Self::receive_ai_preferences,
            cx,
        );
        cx.notify();
    }
    fn receive_ai_preferences(
        &mut self,
        result: Result<AiFunctionPreferences, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        match result {
            Ok(snapshot) => {
                self.ai_preferences.observed(snapshot);
                self.ai_preferences.message = if self.ai_preferences.draft.is_some() {
                    "Preferenze rilette dall’host. Verifica la bozza conservata e prepara una nuova anteprima."
                } else { "Preferenze lette dall’host." }.into();
                self.sync_ai_model_targets(cx);
            }
            Err(error) => self.ai_preferences.failure(error),
        }
    }
    fn sync_ai_model_targets(&mut self, cx: &App) {
        let mut ids = HashSet::from(["host".to_owned()]);
        if let Some(snapshot) = &self.ai_preferences.snapshot {
            for row in &snapshot.functions {
                for option in &row.options {
                    ids.insert(option.model_option_id.clone());
                }
            }
        }
        self.ai_preferences
            .model_targets
            .retain(|key, _| ids.contains(key));
        for id in ids {
            self.ai_preferences
                .model_targets
                .entry(id)
                .or_insert_with(|| ScrollTarget::new(&self.area_scroll, cx));
        }
    }
    fn start_ai_draft(&mut self, change: AiPreferenceChange, cx: &mut Context<Self>) {
        let state = &mut self.ai_preferences;
        if !state.current || state.has_work() {
            return;
        }
        state.draft = Some(change);
        state.preview = None;
        state.failed = false;
        state.message =
            "Bozza locale. Prepara l’anteprima per verificare la modifica sull’host.".into();
        state.focus_target = Some(9);
        cx.notify();
    }
    fn prepare_ai_preferences(&mut self, cx: &mut Context<Self>) {
        if !self.ai_preferences.can_prepare() {
            return;
        }
        let (Some(session), Some(context), Some(snapshot), Some(change)) = (
            self.session.clone(),
            self.ai_preferences.context.clone(),
            self.ai_preferences.snapshot.as_ref(),
            self.ai_preferences.draft.clone(),
        ) else {
            return;
        };
        let command = match AiPreferencesCommand::new(snapshot, change) {
            Ok(command) => command,
            Err(error) => {
                self.ai_preferences.failure(error);
                cx.notify();
                return;
            }
        };
        self.ai_preferences.working = Some(Working::Preview);
        self.ai_preferences.failed = false;
        self.ai_preferences.message =
            "Preparazione dell’anteprima sull’host… Nessuna preferenza viene salvata.".into();
        self.run(move || session.preview_ai_preferences(&context, &command), |this, result, _| {
            match result {
                Ok(preview) => {
                    this.ai_preferences.preview = Some(preview); this.ai_preferences.working = None;
                    this.ai_preferences.message = "Anteprima ricevuta dall’host. Nessuna modifica salvata. Controlla i valori proposti prima di confermare.".into();
                    this.ai_preferences.focus_target = Some(13);
                }
                Err(error) => this.ai_preferences.failure(error),
            }
        }, cx);
        cx.notify();
    }
    fn confirm_ai_preferences(&mut self, cx: &mut Context<Self>) {
        if self.ai_preferences.working.is_some() || !self.ai_preferences.current {
            return;
        }
        let (Some(session), Some(context), Some(preview)) = (
            self.session.clone(),
            self.ai_preferences.context.clone(),
            self.ai_preferences.preview.take(),
        ) else {
            return;
        };
        self.ai_preferences.working = Some(Working::Save);
        self.ai_preferences.failed = false;
        self.ai_preferences.message = "Salvataggio e rilettura delle preferenze sull’host…".into();
        self.run(
            move || session.apply_ai_preferences(&context, &preview),
            Self::receive_ai_preferences_readback,
            cx,
        );
        cx.notify();
    }
    fn receive_ai_preferences_readback(
        &mut self,
        result: Result<AiPreferencesReadback, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        match result {
            Ok(result) => {
                self.ai_preferences.observed(result.observed);
                if result.matches_confirmation {
                    self.ai_preferences.draft = None;
                    self.ai_preferences.message = "Preferenze salvate e rilette dall’host.".into();
                } else {
                    self.ai_preferences.message = "L’host è cambiato dopo la conferma. Mostro la configurazione riletta; verifica la bozza prima di una nuova anteprima.".into();
                    self.ai_preferences.failed = true;
                }
                self.ai_status = Load::Idle;
                self.sync_ai_model_targets(cx);
                self.ai_preferences.focus_target = Some(1);
            }
            Err(error) => self.ai_preferences.failure(error),
        }
    }
    pub(super) fn cancel_ai_preview(&mut self, cx: &mut Context<Self>) -> bool {
        if self.ai_preferences.working.is_none() && self.ai_preferences.preview.take().is_some() {
            self.ai_preferences.message = "Anteprima annullata. La bozza resta locale.".into();
            self.ai_preferences.focus_target = Some(9);
            cx.notify();
            true
        } else {
            false
        }
    }
    fn cancel_ai_draft(&mut self, cx: &mut Context<Self>) {
        if self.ai_preferences.working.is_some() {
            return;
        }
        self.ai_preferences.draft = None;
        self.ai_preferences.preview = None;
        self.ai_preferences.message = "Bozza annullata. Nessun nuovo invio all’host.".into();
        self.ai_preferences.focus_target = Some(1);
        cx.notify();
    }
    pub(super) fn ai_preferences_blocks_navigation(&mut self, cx: &mut Context<Self>) -> bool {
        if !self.ai_preferences.active || !self.ai_preferences.has_work() {
            return false;
        }
        self.show_other = false;
        self.ai_preferences.message = if self.ai_preferences.working.is_some() {
            "Attendi l’esito della verifica prima di cambiare pagina. Puoi sempre bloccare la sessione."
        } else { "Completa o annulla la bozza delle preferenze AI prima di cambiare pagina." }.into();
        cx.notify();
        true
    }
    fn close_ai_preferences(&mut self, cx: &mut Context<Self>) {
        if self.ai_preferences_blocks_navigation(cx) {
            return;
        }
        self.area_scroll.set_offset(gpui::point(px(0.), px(0.)));
        self.load_ai_status(cx);
        self.load_account_profile(cx);
        self.focus_after_render = true;
        cx.notify();
    }

    pub(super) fn ai_preferences_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let state = &self.ai_preferences;
        let idle = state.working.is_none();
        let mut view = div().w_full().min_w_0().max_w(px(760.)).flex().flex_col().gap(px(20.))
            .child(heading("clinical-workspace-ai-preferences-heading", "Preferenze funzioni AI", theme))
            .child(div().font_family(VOICE).text_size(px(theme.size(22.))).line_height(px(theme.size(30.)))
                .child(text!("Le preferenze valgono per tutti gli operatori dell’host.")))
            .child(notice("clinical-workspace-ai-preferences-scope", "Questa pagina configura le quattro funzioni. La disponibilità indicata nel catalogo non verifica che il modello possa eseguire un’analisi.", theme, false))
            .child(div().flex().flex_wrap().gap(px(8.))
                .child(state.targets[0].attach_enabled(button("clinical-workspace-ai-preferences-back", "Torna alle impostazioni", theme, false, idle), idle)
                    .on_click(cx.listener(|this, _, _, cx| this.close_ai_preferences(cx))))
                .child(state.targets[1].attach_enabled(button("clinical-workspace-ai-preferences-reload", "Rileggi preferenze dall’host", theme, false, idle), idle)
                    .on_click(cx.listener(|this, _, _, cx| this.load_ai_preferences(cx)))))
            .child(notice("clinical-workspace-ai-preferences-message", state.message.clone(), theme, state.failed));
        if let Some(received) = state.received_at {
            view = view.child(div().text_color(theme.secondary).child(text!(format!(
                "{} il {} (ora locale).",
                if state.current {
                    "Configurazione ricevuta"
                } else {
                    "Ultima configurazione ricevuta, da rileggere"
                },
                received.format("%d/%m/%Y · %H:%M:%S")
            ))));
        }
        if let Some(draft) = &state.draft {
            view = view.child(self.ai_draft_view(draft, cx));
        } else if let Some(snapshot) = &state.snapshot {
            for (index, id) in AiFunctionId::ALL.into_iter().enumerate() {
                let Some(row) = snapshot.function(id) else {
                    continue;
                };
                let change = AiPreferenceChange::Set {
                    function_id: id,
                    enabled: row.enabled,
                    default_model_option_id: if row.default_source
                        == AiDefaultSource::HostConfiguration
                    {
                        None
                    } else {
                        row.default_model_option_id.clone()
                    },
                };
                let enabled = state.current && idle;
                view = view.child(
                    function_summary(row, "observed", theme).child(
                        state.targets[index + 2]
                            .attach_enabled(
                                button(
                                    format!("clinical-workspace-ai-edit-{}", id.as_str()),
                                    format!("Modifica {}", function_title(id)),
                                    theme,
                                    false,
                                    enabled,
                                ),
                                enabled,
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.start_ai_draft(change.clone(), cx)
                            })),
                    ),
                );
            }
            let enabled = state.current && idle;
            view = view.child(div().flex().flex_col().gap(px(8.))
                .child(section("clinical-workspace-ai-presets-heading", "IMPOSTAZIONI CONDIVISE", theme))
                .child(text!("Valori host ripristina i modelli mantenendo gli interruttori attuali. Tutte disattivate spegne le quattro funzioni."))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .children([(6, AiPreferencePreset::HostDefaults, "Valori host"), (7, AiPreferencePreset::AllOff, "Tutte disattivate")].map(|(index, preset_id, label)|
                        state.targets[index].attach_enabled(button(format!("clinical-workspace-ai-preset-{index}"), label, theme, false, enabled), enabled)
                            .on_click(cx.listener(move |this, _, _, cx| this.start_ai_draft(AiPreferenceChange::Preset { preset_id }, cx)))))));
        }
        if let Some(preview) = &state.preview {
            let proposed = div()
                .id("clinical-workspace-ai-preview")
                .accessibility_id("clinical-workspace-ai-preview")
                .role(Role::Group)
                .aria_label("Anteprima delle preferenze dell’host")
                .track_focus(&state.targets[13].focus.clone().tab_stop(false))
                .anchor_scroll(Some(state.targets[13].anchor.clone()))
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(12.))
                .border_t_1()
                .border_color(theme.rule)
                .pt(px(20.))
                .child(section(
                    "clinical-workspace-ai-preview-heading",
                    "VALORI PROPOSTI DALL’HOST",
                    theme,
                ))
                .children(
                    AiFunctionId::ALL
                        .into_iter()
                        .filter_map(|id| preview.proposed.function(id))
                        .map(|row| function_summary(row, "proposed", theme)),
                )
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        // Arrival focuses the preview heading, never the save
                        // action. Confirmation requires a separate gesture.
                        .child(
                            state.targets[12]
                                .attach_enabled(
                                    button(
                                        "clinical-workspace-ai-cancel-preview",
                                        "Torna alla bozza",
                                        theme,
                                        false,
                                        idle,
                                    ),
                                    idle,
                                )
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.cancel_ai_preview(cx);
                                })),
                        )
                        .child(
                            state.targets[11]
                                .attach_enabled(
                                    button(
                                        "clinical-workspace-ai-confirm",
                                        "Conferma e salva sull’host",
                                        theme,
                                        true,
                                        idle,
                                    ),
                                    idle,
                                )
                                .on_click(
                                    cx.listener(|this, _, _, cx| this.confirm_ai_preferences(cx)),
                                ),
                        ),
                );
            view = view.child(proposed);
        }
        view
    }

    fn ai_draft_view(&self, draft: &AiPreferenceChange, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let state = &self.ai_preferences;
        let enabled = state.can_edit();
        let mut view = div()
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(section(
                "clinical-workspace-ai-draft-heading",
                "BOZZA LOCALE",
                theme,
            ));
        match draft {
            AiPreferenceChange::Preset { preset_id } => {
                view = view.child(div().font_weight(FontWeight::SEMIBOLD).child(text!(match preset_id {
                    AiPreferencePreset::HostDefaults => "Ripristina i modelli configurati sull’host, mantenendo gli interruttori attuali.",
                    AiPreferencePreset::AllOff => "Disattiva tutte le quattro funzioni AI dell’host.",
                })));
            }
            AiPreferenceChange::Set {
                function_id,
                enabled: switched_on,
                default_model_option_id,
            } => {
                view = view
                    .child(
                        div()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(text!(function_title(*function_id))),
                    )
                    .child(
                        state.targets[8]
                            .attach_enabled(
                                button(
                                    "clinical-workspace-ai-draft-switch",
                                    if *switched_on {
                                        "Funzione nella bozza: attiva"
                                    } else {
                                        "Funzione nella bozza: disattivata"
                                    },
                                    theme,
                                    false,
                                    enabled,
                                ),
                                enabled,
                            )
                            .aria_selected(*switched_on)
                            .on_click(cx.listener(|this, _, _, cx| {
                                if this.ai_preferences.can_edit()
                                    && let Some(AiPreferenceChange::Set { enabled, .. }) =
                                        this.ai_preferences.draft.as_mut()
                                {
                                    *enabled = !*enabled;
                                    cx.notify();
                                }
                            })),
                    );
                if let Some(row) = state
                    .snapshot
                    .as_ref()
                    .and_then(|snapshot| snapshot.function(*function_id))
                {
                    view = view
                        .child(div().text_color(theme.secondary).child(text!(format!(
                            "Ultimo valore letto: {} · {}.",
                            if row.enabled { "attiva" } else { "disattivata" },
                            model_label(row)
                        ))))
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(text!("Modello preferito")),
                        );
                    let options = std::iter::once((
                        "host".to_owned(),
                        "Valore configurato sull’host".to_owned(),
                        None,
                    ))
                    .chain(row.options.iter().map(|option| {
                        (
                            option.model_option_id.clone(),
                            format!(
                                "{}{}",
                                option.label,
                                if option.state == AiModelState::Unavailable {
                                    " · non disponibile nel catalogo"
                                } else {
                                    " · disponibile nel catalogo, esecuzione non verificata"
                                }
                            ),
                            Some(option.model_option_id.clone()),
                        )
                    }));
                    for (key, label, value) in options {
                        let Some(target) = state.model_targets.get(&key) else {
                            continue;
                        };
                        let selected = &value == default_model_option_id;
                        view = view.child(
                            target
                                .attach_enabled(
                                    button(
                                        format!("clinical-workspace-ai-model-{key}"),
                                        label,
                                        theme,
                                        false,
                                        enabled,
                                    ),
                                    enabled,
                                )
                                .aria_selected(selected)
                                .when(selected, |el| {
                                    el.bg(theme.selected).border_color(theme.fresh)
                                })
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    if this.ai_preferences.can_edit()
                                        && let Some(AiPreferenceChange::Set {
                                            default_model_option_id,
                                            ..
                                        }) = this.ai_preferences.draft.as_mut()
                                    {
                                        *default_model_option_id = value.clone();
                                        cx.notify();
                                    }
                                })),
                        );
                    }
                    if default_model_option_id.as_ref().is_some_and(|id| {
                        !row.options
                            .iter()
                            .any(|option| &option.model_option_id == id)
                    }) {
                        view = view.child(notice("clinical-workspace-ai-draft-missing-model", "La bozza conserva un modello salvato che non compare nel catalogo letto. Non è stato sostituito; verifica la scelta con l’host.", theme, true));
                    }
                }
            }
        }
        view.child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(8.))
                .child(
                    state.targets[9]
                        .attach_enabled(
                            button(
                                "clinical-workspace-ai-prepare",
                                "Prepara anteprima",
                                theme,
                                true,
                                state.can_prepare(),
                            ),
                            state.can_prepare(),
                        )
                        .on_click(cx.listener(|this, _, _, cx| this.prepare_ai_preferences(cx))),
                )
                .child(
                    state.targets[10]
                        .attach_enabled(
                            button(
                                "clinical-workspace-ai-cancel-draft",
                                "Annulla bozza",
                                theme,
                                false,
                                state.working.is_none(),
                            ),
                            state.working.is_none(),
                        )
                        .on_click(cx.listener(|this, _, _, cx| this.cancel_ai_draft(cx))),
                ),
        )
    }
}

fn function_title(id: AiFunctionId) -> &'static str {
    match id {
        AiFunctionId::PatientInsight => "Sintesi paziente",
        AiFunctionId::SmartImport => "Importazione assistita",
        AiFunctionId::DocumentSynthesis => "Sintesi documenti",
        AiFunctionId::TreatmentReasoning => "Ragionamento terapeutico",
    }
}
fn model_label(row: &AiFunctionPreference) -> String {
    row.options
        .iter()
        .find(|option| Some(&option.model_option_id) == row.default_model_option_id.as_ref())
        .map(|option| {
            format!(
                "{}{}",
                option.label,
                if option.state == AiModelState::Unavailable {
                    " · non disponibile nel catalogo"
                } else {
                    " · esecuzione non verificata"
                }
            )
        })
        .unwrap_or_else(|| {
            if row.default_source == AiDefaultSource::SavedPreference {
                "Modello salvato non presente nel catalogo"
            } else {
                "Modello host non disponibile in questo catalogo"
            }
            .into()
        })
}
fn function_summary(row: &AiFunctionPreference, kind: &str, theme: Theme) -> Stateful<Div> {
    let id = SharedString::from(format!("clinical-workspace-ai-{kind}-{}", row.id.as_str()));
    div()
        .id(id.clone())
        .accessibility_id(id)
        .role(Role::Group)
        .aria_label(function_title(row.id))
        .min_w_0()
        .max_w_full()
        .whitespace_normal()
        .border_b_1()
        .border_color(theme.rule)
        .py(px(12.))
        .flex()
        .flex_col()
        .gap(px(8.))
        .child(
            div()
                .font_weight(FontWeight::SEMIBOLD)
                .child(text!(function_title(row.id))),
        )
        .child(text!(format!(
            "{} · {}",
            if row.enabled {
                "Attiva nella configurazione"
            } else {
                "Disattivata nella configurazione"
            },
            model_label(row)
        )))
        .child(div().text_color(theme.secondary).child(text!(format!(
            "{}{}",
            if row.default_source == AiDefaultSource::SavedPreference {
                if kind == "proposed" {
                    "Preferenza proposta"
                } else {
                    "Preferenza salvata"
                }
            } else {
                "Valore configurato sull’host"
            },
            match row.binding_state {
                AiBindingState::Current => "",
                AiBindingState::Stale => " · associazione da rileggere sull’host",
                AiBindingState::Unsupported => " · associazione non supportata da questo catalogo",
            }
        ))))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> AiFunctionPreferences {
        serde_json::from_value(serde_json::json!({
            "schemaVersion":"mediflow.function-preferences.v1", "revision":format!("sha256_{}", "a".repeat(64)),
            "catalogRevision":format!("sha256_{}", "b".repeat(64)), "check":"configuration_only", "apply":"denied",
            "presets":["host_defaults", "all_off"], "functions":AiFunctionId::ALL.map(|id| serde_json::json!({
                "id":id,"enabled":true,"defaultModelOptionId":format!("model_option_{}", "c".repeat(32)),
                "defaultSource":"saved_preference","bindingState":"stale", "options":[]
            }))
        })).unwrap()
    }
    fn change() -> AiPreferenceChange {
        AiPreferenceChange::Set {
            function_id: AiFunctionId::PatientInsight,
            enabled: false,
            default_model_option_id: Some(format!("model_option_{}", "c".repeat(32))),
        }
    }

    #[gpui::test]
    fn ai_preferences_draft_survives_denial_conflict_and_uncertain_save_without_confirmation(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            for error in [
                RuntimeError::Forbidden,
                RuntimeError::Conflict,
                RuntimeError::Indeterminate,
                RuntimeError::Transport,
            ] {
                app.ai_preferences.active = true;
                app.receive_ai_preferences(Ok(snapshot()), cx);
                app.start_ai_draft(change(), cx);
                assert_eq!(app.ai_preferences.draft, Some(change()));
                app.ai_preferences.working = Some(Working::Save);
                app.receive_ai_preferences_readback(Err(error), cx);
                assert_eq!(app.ai_preferences.draft, Some(change()));
                assert!(
                    app.ai_preferences.snapshot.is_some(),
                    "keep the last observed context explicitly stale"
                );
                assert!(!app.ai_preferences.current && !app.ai_preferences.can_prepare());
                assert!(app.ai_preferences.preview.is_none());
                assert!(
                    app.ai_preferences
                        .message
                        .starts_with("Salvataggio non verificato.")
                );
                app.confirm_ai_preferences(cx);
                assert!(
                    app.ai_preferences.working.is_none(),
                    "no retry without a new host preview"
                );
                app.cancel_ai_draft(cx);
            }
        });
    }

    #[gpui::test]
    fn ai_preferences_only_matching_readback_releases_draft_and_confirms_save(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.ai_preferences.active = true;
            app.receive_ai_preferences(Ok(snapshot()), cx);
            app.start_ai_draft(change(), cx);
            app.ai_preferences.working = Some(Working::Save);
            let mut changed = snapshot();
            changed.functions[0].enabled = false;
            app.receive_ai_preferences_readback(
                Ok(AiPreferencesReadback {
                    observed: changed.clone(),
                    matches_confirmation: false,
                }),
                cx,
            );
            assert_eq!(app.ai_preferences.draft, Some(change()));
            assert_eq!(app.ai_preferences.snapshot, Some(changed.clone()));
            assert!(
                app.ai_preferences
                    .message
                    .contains("cambiato dopo la conferma")
            );
            assert!(app.ai_preferences.preview.is_none());
            app.ai_preferences.working = Some(Working::Save);
            app.receive_ai_preferences_readback(
                Ok(AiPreferencesReadback {
                    observed: changed,
                    matches_confirmation: true,
                }),
                cx,
            );
            assert!(app.ai_preferences.draft.is_none());
            assert_eq!(
                app.ai_preferences.message,
                "Preferenze salvate e rilette dall’host."
            );
        });
    }

    #[gpui::test]
    fn ai_preferences_expired_session_during_save_clears_context_and_requires_login(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        for error in [RuntimeError::Authentication, RuntimeError::Locked] {
            view.update(cx, |app, cx| {
                app.area = Area::Settings;
                app.ai_preferences.active = true;
                app.receive_ai_preferences(Ok(snapshot()), cx);
                app.start_ai_draft(change(), cx);
                app.ai_preferences.working = Some(Working::Save);
                app.run(
                    move || Err(error),
                    ClinicalApp::receive_ai_preferences_readback,
                    cx,
                );
            });
            cx.run_until_parked();
            view.read_with(cx, |app, _| {
                assert!(app.session.is_none());
                assert!(!app.ai_preferences.active && !app.ai_preferences.current);
                assert!(app.ai_preferences.snapshot.is_none());
                assert!(app.ai_preferences.draft.is_none() && app.ai_preferences.preview.is_none());
                assert!(
                    app.ai_preferences.context.is_none() && app.ai_preferences.working.is_none()
                );
                let (message, failed) = app.message.as_ref().unwrap();
                assert!(*failed);
                assert!(message.starts_with("Salvataggio delle preferenze AI non verificato."));
                assert!(message.contains("Accedi di nuovo"));
            });
        }
    }

    #[gpui::test]
    fn ai_preferences_navigation_requires_draft_disposal_and_epoch_lock_retire_late_results(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, cx| {
            app.area = Area::Settings;
            app.ai_preferences.active = true;
            app.receive_ai_preferences(Ok(snapshot()), cx);
            app.start_ai_draft(change(), cx);
            assert_eq!(
                model_label(&snapshot().functions[0]),
                "Modello salvato non presente nel catalogo"
            );
            app.navigate(Area::Analytics, cx);
            assert!(app.area == Area::Settings);
            assert_eq!(app.ai_preferences.draft, Some(change()));
            app.cancel_ai_draft(cx);
            app.run(|| Ok(snapshot()), ClinicalApp::receive_ai_preferences, cx);
            app.navigate(Area::Analytics, cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            assert!(app.ai_preferences.snapshot.is_none() && !app.ai_preferences.active);
            app.area = Area::Settings;
            app.ai_preferences.active = true;
            app.receive_ai_preferences(Ok(snapshot()), cx);
            app.start_ai_draft(change(), cx);
            app.run(|| Ok(snapshot()), ClinicalApp::receive_ai_preferences, cx);
            app.request_discard(Discard::Lock, cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.ai_preferences.snapshot.is_none() && app.ai_preferences.draft.is_none());
            assert!(app.ai_preferences.preview.is_none() && !app.ai_preferences.active);
        });
    }
}
