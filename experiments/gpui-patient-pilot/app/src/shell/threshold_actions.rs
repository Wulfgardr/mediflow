use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Command {
    Review,
    Reread,
    Copy,
    Close,
    Retry,
}

pub(super) const PRIMARY_LABELS: &[(Command, Option<FormKind>, &str)] = &[
    (Command::Review, Some(FormKind::Scale), "Prepara e rivedi"),
    (Command::Review, None, "Registra 1 elemento"),
    (Command::Reread, Some(FormKind::Scale), "Rileggi e verifica"),
    (Command::Reread, None, "Rileggi la scheda"),
    (Command::Copy, None, "Copia bozza"),
];

impl Command {
    pub(super) fn primary_label(self, kind: FormKind) -> &'static str {
        PRIMARY_LABELS
            .iter()
            .find(|(command, specific_kind, _)| {
                *command == self && specific_kind.is_none_or(|specific| specific == kind)
            })
            .expect("primary command has a label")
            .2
    }

    pub(super) fn id_and_action(self) -> (&'static str, usize) {
        match self {
            Self::Review => ("clinical-workspace-review-save", 1),
            Self::Reread => ("clinical-workspace-reconcile", 7),
            Self::Copy => ("clinical-workspace-copy-draft", 6),
            Self::Close => ("clinical-scale-close-draft", 0),
            Self::Retry => ("clinical-scale-review-retry", 1),
        }
    }
}

impl ClinicalApp {
    pub(super) fn threshold_recovery(
        &self,
        layout: Layout,
        cx: &Context<Self>,
    ) -> Option<Stateful<Div>> {
        let form = self.form.as_ref()?;
        if self.discard.is_some()
            || !matches!(
                form.state,
                FormState::Draft | FormState::Conflict | FormState::Uncertain | FormState::Rejected
            )
        {
            return None;
        }
        let readonly = form.kind == FormKind::Notes
            && form.state == FormState::Rejected
            && self.core.phase() == mediflow_patient_client::Phase::Locked
            && self
                .patient
                .detail
                .ready()
                .is_some_and(|p| p.is_archived || p.deleted_at.is_some());
        let primary = if readonly {
            Command::Copy
        } else if form.state == FormState::Draft {
            Command::Review
        } else {
            Command::Reread
        };
        let mut secondary = if readonly || form.state == FormState::Draft {
            vec![Command::Close]
        } else {
            vec![Command::Copy]
        };
        if !readonly && form.kind == FormKind::Scale && form.state != FormState::Draft {
            secondary.push(Command::Close);
        }
        if form.kind == FormKind::Notes
            && !readonly
            && form.state != FormState::Draft
            && form.state != FormState::Rejected
        {
            secondary.push(Command::Close);
        }
        if form
            .scale
            .as_ref()
            .is_some_and(ScaleAssessment::retry_ready)
        {
            secondary.push(Command::Retry);
        }
        let state = match form.state {
            FormState::Draft => "Bozza",
            FormState::Conflict => "Cambiata",
            FormState::Rejected if readonly => "Sola lettura",
            FormState::Rejected => "Rifiutata",
            _ => "Incerta",
        };
        let title = if form.kind == FormKind::Scale {
            "Scale"
        } else if form.kind == FormKind::Notes {
            "Note"
        } else if form.kind == FormKind::PatientNew {
            "Nuova anagrafica"
        } else if form.kind == FormKind::Therapy {
            "Terapia"
        } else {
            "Scrittura"
        };
        let theme = self.theme;
        let menu = div()
            .id("threshold-other-actions-menu")
            .debug_selector(|| "threshold-other-actions-menu".into())
            .role(Role::Menu)
            .aria_label("Altre azioni")
            .w(self.threshold_region_scroll.bounds().size.width)
            .max_h(px(356.))
            .overflow_y_scroll()
            .track_scroll(&self.threshold_menu_scroll)
            .occlude()
            .p(px(4.))
            .flex()
            .flex_col()
            .gap(px(8.))
            .bg(theme.paper)
            .border_1()
            .border_color(theme.strong_rule)
            .children(
                secondary
                    .into_iter()
                    .enumerate()
                    .map(|(index, command)| self.threshold_command(command, Some(index), cx)),
            );
        Some(
            div()
                .id("clinical-workspace-save-threshold")
                .debug_selector(|| "threshold-bar".into())
                .role(Role::Region)
                .aria_label("Stato della scrittura")
                .flex_shrink_0()
                .min_h_0()
                .min_w_0()
                .px(px(layout.margin))
                .py(px(12.))
                .bg(theme.draft)
                .border_t_1()
                .border_color(theme.rule)
                .flex()
                .flex_col()
                .gap(px(8.))
                .child({
                    let region = div()
                        .id("threshold-recovery-region")
                        .accessibility_id("threshold-recovery-region")
                        .debug_selector(|| "threshold-recovery-region".into())
                        .role(Role::Region)
                        .aria_label(format!("{title}, {state}"))
                        .track_focus(&self.threshold_region_focus)
                        .focus(move |style| style.bg(theme.selected))
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_h_0()
                        .min_w_0()
                        .overflow_y_scroll()
                        .track_scroll(&self.threshold_region_scroll)
                        .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, window, cx| {
                            if !this.threshold_region_focus.is_focused(window) {
                                return;
                            }
                            let scroll = &this.threshold_region_scroll;
                            let line = this.theme.role(TypeRole::Body).line_height;
                            let page = f32::from(scroll.bounds().size.height);
                            let mut offset = scroll.offset();
                            offset.y = match event.keystroke.key.as_str() {
                                "up" | "left" => offset.y + px(line),
                                "down" | "right" => offset.y - px(line),
                                "pageup" => offset.y + px(page),
                                "pagedown" => offset.y - px(page),
                                "home" => px(0.),
                                "end" => -scroll.max_offset().y,
                                _ => return,
                            };
                            scroll.set_offset(offset);
                            window.refresh();
                            cx.stop_propagation();
                        }))
                        .child(
                            div()
                                .id("threshold-recovery-status")
                                .debug_selector(|| "threshold-recovery-status".into())
                                .flex_shrink_0()
                                .role(Role::Status)
                                .type_role(theme, TypeRole::Section)
                                .child(
                                    div()
                                        .debug_selector(|| "threshold-recovery-title".into())
                                        .child(crate::title::title(title, theme)),
                                )
                                .child(
                                    div()
                                        .debug_selector(|| "threshold-recovery-state".into())
                                        .child(crate::title::title(state, theme)),
                                ),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .relative()
                                .min_w_0()
                                .child({
                                    let command = crate::components::title_button(
                                        "threshold-other-actions",
                                        crate::title::TitleText::from("Altre azioni"),
                                        theme,
                                        false,
                                        true,
                                    )
                                    .debug_selector(|| "threshold-other-actions".into())
                                    .type_role(theme, TypeRole::Section)
                                    .track_focus(&self.threshold_menu_focus)
                                    .aria_expanded(self.threshold_menu_open.get())
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.threshold_menu_open
                                            .set(!this.threshold_menu_open.get());
                                        if this.threshold_menu_open.get() {
                                            this.threshold_menu_scroll.scroll_to_item(0);
                                            window.focus(&this.threshold_menu_targets[0].focus, cx);
                                        }
                                        cx.notify();
                                    }));
                                    #[cfg(test)]
                                    let command = rendered_command::observe(command);
                                    command
                                })
                                .when(self.threshold_menu_open.get(), |el| {
                                    el.child(
                                        gpui::deferred(
                                            gpui::anchored()
                                                .anchor(gpui::Anchor::BottomLeft)
                                                .snap_to_window_with_margin(px(8.))
                                                .child(menu),
                                        )
                                        .priority(1),
                                    )
                                }),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .child(self.threshold_detail(ThresholdMode::Compact, cx)),
                        );
                    #[cfg(test)]
                    let region = rendered_command::observe(region);
                    region
                })
                .child(self.threshold_command(primary, None, cx)),
        )
    }

    fn threshold_command(
        &self,
        command: Command,
        menu_index: Option<usize>,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        let form = self.form.as_ref().unwrap();
        let (id, action) = command.id_and_action();
        let label = match command {
            Command::Review | Command::Reread | Command::Copy => command.primary_label(form.kind),
            Command::Close if form.kind == FormKind::Scale => "Chiudi bozza…",
            Command::Close => "Scarta la bozza",
            Command::Retry => "Rivedi lo stesso invio",
        };
        let enabled = !matches!(command, Command::Review)
            || form.scale.as_ref().is_none_or(ScaleAssessment::can_prepare);
        let el = button(id, label, self.theme, menu_index.is_none(), enabled)
            .debug_selector(move || id.into())
            .flex_shrink_0();
        let el = if let Some(index) = menu_index {
            self.threshold_menu_targets[index].attach_enabled(el.role(Role::MenuItem), enabled)
        } else {
            el.track_focus(&self.form_actions[action].focus.clone().tab_stop(enabled))
        };
        el.when(enabled, |el| {
            el.on_click(cx.listener(move |this, _, window, cx| {
                this.threshold_menu_open.set(false);
                if menu_index.is_some() {
                    window.focus(&this.threshold_menu_focus, cx);
                }
                match command {
                    Command::Review => this.review_form(window, cx),
                    Command::Reread => this.request_discard(Discard::Reload, cx),
                    Command::Copy => this.copy_draft(cx),
                    Command::Close => {
                        if this
                            .form
                            .as_ref()
                            .is_some_and(|f| f.kind == FormKind::Notes)
                            && this.core.phase() == mediflow_patient_client::Phase::Locked
                        {
                            this.finish_discard(Discard::Form, cx);
                        } else {
                            this.request_discard(Discard::Form, cx);
                        }
                    }
                    Command::Retry => this.review_scale_retry(cx),
                }
                cx.notify();
            }))
        })
    }
}
