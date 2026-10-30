use super::*;

impl ClinicalApp {
    pub(super) fn form_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let Some(form) = &self.form else {
            return div();
        };
        let review = form.state != FormState::Draft;
        let comparison = form.kind == FormKind::Notes && self.core.has_notes_comparison();
        div().min_w_0().max_w_full().flex().flex_col().gap(px(20.))
            .when(comparison, |el| el.child(self.notes_comparison_view()))
            .when(!comparison, |el| el.child(div().flex().flex_col().gap(px(8.))
                .child(section("clinical-workspace-draft-heading", if review { "RIVEDI PRIMA DI REGISTRARE" } else { "BOZZA NON REGISTRATA" }, theme))
                .child(div().text_color(theme.fresh).child(crate::title::title(form.edit.as_ref().map_or(form.kind.title(), editing::Record::title), theme).with_role(crate::theme::TitleRole::PageTitle)))
                .child(div().text_color(theme.secondary).child(text!(match form.kind {
                    FormKind::Notes => "La conferma sostituisce soltanto le note della scheda del paziente indicato.",
                    FormKind::Entry => "Questa voce è una nota di diario. Per una visita strutturata, un contatto remoto o allegati usa l'editor corrente.",
                    FormKind::Scale => "La valutazione utilizza il questionario letto dall'host.",
                    FormKind::Therapy => "Scegli il farmaco dal repertorio oppure riporta una terapia a testo libero. Verifica dose, motivo e date: la scelta della confezione non li modifica.",
                    FormKind::Observation => "Riporta il valore e le codifiche presenti nel referto. Non vengono dedotte unità, intervalli o interpretazioni cliniche.",
                    FormKind::Document => "Il documento scelto verrà aggiunto alla scheda del paziente indicato. Verifica nome, formato e dimensione prima di registrarlo.",
                    FormKind::Checkup if form.edit.is_none() => "Indica la data e l'ora del controllo nel fuso del computer. L'orario è richiesto e non viene scelto automaticamente.",
                    FormKind::Checkup => "Data e ora sono nel fuso del computer. Se non le modifichi, l'orario registrato resta invariato.",
                    FormKind::PatientNew => "La scheda verrà creata nell'ambulatorio selezionato. I campi non compilati resteranno senza un valore riportato.",
                    FormKind::PatientProfile => "La conferma aggiorna soltanto i campi anagrafici che hai modificato. Le note e gli altri dati clinici restano fuori da questa modifica.",
                })))))
            .when_some(form.upload.as_ref(), |el, upload| el.child(div().flex().flex_col().gap(px(12.))
                .child(div().type_role(theme, crate::theme::TextRole::Strong).child(text!(upload.name.clone())))
                .child(div().type_role(theme, crate::theme::TextRole::Meta).child(text!(upload.mime_type.clone())))
                .child(text!(format!("{} · copia scelta in memoria", format_size(upload.bytes.len() as u64))))
                .child(div().text_color(theme.secondary).child(text!("Il formato è associato all'estensione del file. La conferma non interpreta il contenuto e non apre il documento.")))))
            .when(form.kind == FormKind::Therapy, |el| el.child(self.therapy_picker_view(cx)))
            .children(form.fields.iter().enumerate()
                .filter(|(index, field)| !(form.kind == FormKind::Therapy && *index == 0 && field.read_only))
                .map(|(index, field)| self.field_view(field, format!("clinical-workspace-form-field-{index}"), cx)))
            .when(form.kind == FormKind::Entry && !review, |el| el.child(div().type_role(theme, crate::theme::TextRole::Meta).text_color(theme.secondary)
                .child(text!("Il testo della nuova nota è semplice. Le voci già presenti conservano il loro formato originale nell'archivio."))))
    }

    pub(super) fn notes_comparison_view(&self) -> Div {
        let theme = self.theme;
        let patient = self.patient.detail.ready();
        div()
            .min_w_0()
            .max_w_full()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(
                div()
                    .id("clinical-notes-recorded")
                    .debug_selector(|| "clinical-notes-recorded".into())
                    .accessibility_id("clinical-notes-recorded")
                    .role(Role::Group)
                    .aria_label("Registrato ora")
                    .min_w_0()
                    .max_w_full()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child(text!("Registrato ora")),
                    )
                    .when_some(
                        patient.and_then(|row| row.updated_at.as_deref()),
                        |el, time| {
                            el.child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(display_appointment(time))),
                            )
                        },
                    )
                    .child(div().min_w_0().max_w_full().child(clinical_text::render(
                        patient.and_then(|row| row.notes.as_deref()).unwrap_or(""),
                        WritingInk::Dry,
                        theme,
                    ))),
            )
            .child(
                div()
                    .id("clinical-notes-your-draft")
                    .debug_selector(|| "clinical-notes-your-draft".into())
                    .accessibility_id("clinical-notes-your-draft")
                    .type_role(theme, crate::theme::TextRole::Strong)
                    .text_color(theme.fresh)
                    .child(text!("La tua bozza")),
            )
    }

    pub(super) fn form_subject(
        &self,
        form: &Form,
        patient_name: &mediflow_patient_client::PersonName,
    ) -> String {
        let mut subject = format!(
            "{} · {}",
            crate::title::TitleText::name(patient_name.clone()).text(),
            form.edit
                .as_ref()
                .map_or(form.kind.title(), editing::Record::title)
        );
        if form.kind == FormKind::Notes && self.core.has_notes_comparison() && self.core.is_dirty()
        {
            subject.push_str(". La tua bozza sostituirà il testo registrato ora.");
        }
        subject
    }

    pub(super) fn threshold_detail_text(&self, mode: ThresholdMode) -> String {
        let patient = self
            .patient
            .detail
            .ready()
            .map(PatientDetail::display_name)
            .unwrap_or_default();
        if self.discard.is_some() {
            if self
                .form
                .as_ref()
                .and_then(|form| form.scale.as_ref())
                .is_some_and(ScaleAssessment::has_attempt)
            {
                "Un invio potrebbe essere già registrato. La chiusura non annulla una voce nel Diario; copia la bozza e verifica il suo identificativo prima di un nuovo inserimento.".into()
            } else {
                "Il testo non registrato verrà eliminato da questa finestra.".into()
            }
        } else if let Some(form) = &self.form {
            if form
                .scale
                .as_ref()
                .is_some_and(ScaleAssessment::is_preparing)
            {
                "Le risposte restano una bozza. Nessuna registrazione è in corso.".into()
            } else {
                match form.state {
                FormState::Draft => self.form_subject(form,&patient),
                FormState::Review if mode == ThresholdMode::FullPlane => {
                    let detail = "Per rivedere il contenuto torna alla bozza. La registrazione sarà confermata soltanto dopo la rilettura.";
                    if form.kind == FormKind::Notes && self.core.has_notes_comparison() {
                        format!("La tua bozza sostituirà il testo registrato ora. {detail}")
                    } else { detail.into() }
                }
                FormState::Review if form.kind == FormKind::Notes && self.core.has_notes_comparison() => self.form_subject(form,&patient),
                FormState::Review => "Controlla il contenuto qui sopra. La registrazione sarà confermata soltanto dopo la rilettura.".into(),
                FormState::Saving => "La bozza resta visibile fino alla verifica. Non inviare di nuovo.".into(),
                FormState::Conflict | FormState::Uncertain if form.kind == FormKind::Notes => {
                    let state=ViewState::new(ReadObject::Scheda,if form.state==FormState::Conflict {ViewStateKind::Conflitto}else{ViewStateKind::EsitoDaVerificare});
                    let (first,second)=state.lines();
                    format!("{first} {}",second.unwrap_or_default())
                }
                _ if form.kind == FormKind::Scale => "La rilettura non invia la valutazione. Le risposte restano in questa finestra fino alla verifica o alla chiusura esplicita.".into(),
                _ => "La bozza è conservata. Copia il testo se vuoi conservarlo, poi rileggi la scheda prima di una nuova modifica.".into(),
            }
            }
        } else {
            self.verified.clone().unwrap_or_else(|| {
                if self
                    .patient
                    .detail
                    .ready()
                    .is_some_and(|patient| patient.is_archived)
                {
                    "Scheda archiviata · sola lettura".into()
                } else {
                    "Scheda letta dall'archivio · nessuna bozza aperta".into()
                }
            })
        }
    }

    pub(super) fn threshold_detail(
        &self,
        mode: ThresholdMode,
        _cx: &Context<Self>,
    ) -> gpui::AnyElement {
        let detail = self.threshold_detail_text(mode);
        div()
            .id("clinical-workspace-threshold-detail")
            .debug_selector(|| "threshold-detail".into())
            .min_w_0()
            .type_role(self.theme, crate::theme::TextRole::Meta)
            .child(text!(detail))
            .into_any_element()
    }

    pub(super) fn confirmation_plane(
        &self,
        id: &'static str,
        content: impl IntoElement,
        layout: Layout,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        use gpui::{AvailableSpace, canvas, size};
        let mut measure = self
            .threshold(layout, ThresholdMode::Complete, cx)
            .into_any_element();
        let mut measure_essential = self
            .threshold(layout, ThresholdMode::Compact, cx)
            .into_any_element();
        let complete = self
            .threshold(layout, ThresholdMode::Complete, cx)
            .into_any_element();
        let compact = self
            .threshold(layout, ThresholdMode::Compact, cx)
            .into_any_element();
        let full_plane = self
            .threshold(layout, ThresholdMode::FullPlane, cx)
            .into_any_element();
        let confirming = self
            .form
            .as_ref()
            .is_some_and(|form| form.state == FormState::Review)
            && self.discard.is_none();
        let editing_text = self.discard.is_none()
            && self.form.as_ref().is_some_and(|form| {
                form.state == FormState::Draft
                    && !form.fields.is_empty()
                    && form.kind != FormKind::Scale
            });
        let detail = self.threshold_detail(ThresholdMode::Compact, cx);
        let limited = self.threshold_recovery(layout, cx);
        let has_recovery_region = limited.is_some();
        let content = content.into_any_element();
        let scroll = self.profile_scroll.clone();
        let mode = self.threshold_mode.clone();
        let scrolls_with_content = self.threshold_scrolls_with_content.clone();
        let menu_open = self.threshold_menu_open.clone();
        let question_focus = self.threshold_question.focus.clone();
        let theme = self.theme;
        div()
            .id(id)
            .flex_1()
            .min_h_0()
            .min_w_0()
            .reading_surface(theme)
            .rounded(px(theme.paper_radius))
            .overflow_hidden()
            .on_action(cx.listener(|this, _: &NextFocus, window, cx| {
                if this.threshold_mode.get() == ThresholdMode::FullPlane {
                    window.focus_next(cx);
                    this.reveal_focused(window, cx);
                    cx.stop_propagation();
                } else {
                    cx.propagate();
                }
            }))
            .on_action(cx.listener(|this, _: &PreviousFocus, window, cx| {
                if this.threshold_mode.get() == ThresholdMode::FullPlane {
                    window.focus_prev(cx);
                    this.reveal_focused(window, cx);
                    cx.stop_propagation();
                } else {
                    cx.propagate();
                }
            }))
            .on_action(cx.listener(|this, _: &Escape, window, cx| {
                if this.threshold_mode.get() == ThresholdMode::FullPlane {
                    this.cancel_review(window, cx);
                    cx.stop_propagation();
                } else {
                    cx.propagate();
                }
            }))
            .child(
                canvas(
                    move |bounds, window, cx| {
                        let available = size(
                            AvailableSpace::Definite(bounds.size.width),
                            AvailableSpace::MaxContent,
                        );
                        let measured = measure.layout_as_root(available, window, cx);
                        let essential = measure_essential.layout_as_root(available, window, cx);
                        let mut decision = ThresholdLayout::measured(
                            f32::from(bounds.size.height),
                            f32::from(measured.height),
                            f32::from(essential.height),
                            confirming,
                            layout,
                        );
                        decision.scrolls_with_content =
                            editing_text && essential.height > bounds.size.height / 3.;
                        scrolls_with_content.set(decision.scrolls_with_content);
                        let minimum_content = px(theme.role(TypeRole::Body).line_height.ceil())
                            .min(bounds.size.height);
                        let recovery_height = bounds.size.height - minimum_content;
                        let overflow = decision.mode == ThresholdMode::Compact
                            && !confirming
                            && !decision.scrolls_with_content
                            && essential.height > recovery_height;
                        if !overflow {
                            menu_open.set(false);
                        }
                        if mode.replace(decision.mode) != decision.mode
                            && decision.mode == ThresholdMode::FullPlane
                        {
                            scroll.set_offset(gpui::point(px(0.), px(0.)));
                            window.focus(&question_focus, cx);
                        }
                        let mut plane = if decision.mode == ThresholdMode::FullPlane {
                            div()
                                .id("clinical-workspace-plane-scroll")
                                .debug_selector(|| "threshold-full-plane".into())
                                .size_full()
                                .min_w_0()
                                .track_scroll(&scroll)
                                .overflow_y_scroll()
                                .child(full_plane)
                                .into_any_element()
                        } else {
                            let threshold = if decision.scrolls_with_content {
                                complete
                            } else if decision.mode == ThresholdMode::Compact {
                                if overflow {
                                    limited
                                        .map(|bar| bar.max_h(recovery_height).into_any_element())
                                        .unwrap_or_else(|| {
                                            div()
                                                .id("threshold-recovery-overflow")
                                                .flex_shrink_0()
                                                .min_h_0()
                                                .max_h(recovery_height)
                                                .overflow_y_scroll()
                                                .child(compact)
                                                .into_any_element()
                                        })
                                } else {
                                    compact
                                }
                            } else {
                                complete
                            };
                            let mut scrolling = div()
                                .id("clinical-workspace-plane-scroll")
                                .debug_selector(|| "threshold-scroll".into())
                                .track_scroll(&scroll)
                                .flex_1()
                                .min_h(if confirming { px(0.) } else { minimum_content })
                                .min_w_0()
                                .overflow_y_scroll()
                                .child(content)
                                .when(
                                    decision.mode == ThresholdMode::Compact
                                        && !decision.scrolls_with_content
                                        && (!overflow || !has_recovery_region),
                                    |el| el.child(div().p(px(layout.margin)).child(detail)),
                                );
                            let mut plane = div().size_full().flex().flex_col().min_w_0();
                            if decision.scrolls_with_content {
                                scrolling = scrolling.child(threshold);
                                plane = plane.child(scrolling);
                            } else {
                                plane = plane.child(scrolling).child(threshold);
                            }
                            plane.into_any_element()
                        };
                        plane.layout_as_root(
                            size(
                                AvailableSpace::Definite(bounds.size.width),
                                AvailableSpace::Definite(bounds.size.height),
                            ),
                            window,
                            cx,
                        );
                        plane.prepaint_at(bounds.origin, window, cx);
                        plane
                    },
                    |_, mut plane, window, cx| plane.paint(window, cx),
                )
                .size_full(),
            )
    }

    pub(super) fn threshold(
        &self,
        layout: Layout,
        mode: ThresholdMode,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        let theme = self.theme;
        let compact = mode != ThresholdMode::Complete;
        let mut threshold = div()
            .id("clinical-workspace-save-threshold")
            .debug_selector(|| "threshold-bar".into())
            .accessibility_id("clinical-workspace-save-threshold")
            .role(Role::Region)
            .aria_label("Stato della scrittura")
            .min_w_0()
            .max_w_full()
            .flex_shrink_0()
            .border_t_1()
            .border_color(theme.rule)
            .px(px(layout.margin))
            .py(px(12.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .reading_surface(theme);
        if let Some(action) = self.discard {
            return threshold.bg(theme.draft)
                .child(div().id("clinical-workspace-discard-question").accessibility_id("clinical-workspace-discard-question").role(Role::AlertDialog).aria_label("Scartare la bozza?")
                    .child(text!(if compact { "Scartare la bozza?" } else if self.form.as_ref().and_then(|form| form.scale.as_ref()).is_some_and(ScaleAssessment::has_attempt) {
                        "Chiudere la bozza? Un invio potrebbe essere già registrato. La chiusura non annulla una voce nel Diario; copia la bozza e verifica il suo identificativo prima di un nuovo inserimento."
                    } else { "Scartare la bozza? Il testo non registrato verrà eliminato da questa finestra." })))
                .child(div().flex().flex_wrap().gap(px(8.)).when(layout.compact, |el| el.w_full().flex_col().items_stretch())
                    .child(self.form_actions[4].attach(button("clinical-workspace-keep-draft", "Conserva la bozza", theme, true, true))
                        .on_click(cx.listener(|this, _, _, cx| { this.discard = None; cx.notify(); })))
                    .child(self.form_actions[5].attach(button("clinical-workspace-discard-draft", "Scarta e rileggi", theme, false, true))
                        .on_click(cx.listener(move |this, _, _, cx| this.finish_discard(action, cx)))));
        }
        let Some(form) = &self.form else {
            threshold = threshold.child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .when(layout.magnified, |el| el.flex_col().items_stretch())
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(if compact {
                                if self.verified.is_some() {
                                    "Registrata".into()
                                } else {
                                    "Scheda letta".into()
                                }
                            } else {
                                self.verified.clone().unwrap_or_else(|| {
                                    if self
                                        .patient
                                        .detail
                                        .ready()
                                        .is_some_and(|patient| patient.is_archived)
                                    {
                                        "Scheda archiviata · sola lettura".into()
                                    } else {
                                        "Scheda letta dall'archivio · nessuna bozza aperta".into()
                                    }
                                })
                            })),
                    )
                    .when(layout.compact, |el| {
                        el.child(
                            button("clinical-workspace-refresh", "Rileggi", theme, false, true)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.request_discard(Discard::Reload, cx)
                                })),
                        )
                    }),
            );
            return threshold;
        };
        if form
            .scale
            .as_ref()
            .is_some_and(ScaleAssessment::is_preparing)
        {
            return threshold
                .bg(theme.draft)
                .child(
                    div()
                        .id("clinical-scale-preparing")
                        .accessibility_id("clinical-scale-preparing")
                        .role(Role::Status)
                        .child(text!("Preparazione della valutazione nell’archivio…")),
                )
                .when(!compact, |el| el.child(self.threshold_detail(mode, cx)));
        }
        if form.kind == FormKind::Notes && form.state == FormState::Draft && !self.core.is_dirty() {
            return threshold.bg(theme.paper).child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        div()
                            .id("clinical-workspace-clean-notes-status")
                            .role(Role::Status)
                            .aria_label("Nessuna modifica da registrare.")
                            .min_h(px(theme.role(TypeRole::Body).line_height))
                            .type_role(theme, crate::theme::TextRole::Body)
                            .text_color(theme.secondary)
                            .child(text!("Nessuna modifica da registrare.")),
                    )
                    .child(
                        self.form_actions[0]
                            .attach(button(
                                "clinical-workspace-cancel-form",
                                "Torna alla scheda",
                                theme,
                                false,
                                true,
                            ))
                            .on_click(cx.listener(|this, _, _, cx| this.close_clean_notes(cx))),
                    ),
            );
        }
        let review_enabled = form.scale.as_ref().is_none_or(ScaleAssessment::can_prepare);
        let repeated_scale = form
            .scale
            .as_ref()
            .is_some_and(ScaleAssessment::has_attempt);
        let patient_name = if form.kind == FormKind::PatientNew {
            mediflow_patient_client::format_patient_name(
                &form
                    .fields
                    .first()
                    .map(|field| field.value(cx))
                    .unwrap_or_default(),
                &form
                    .fields
                    .get(1)
                    .map(|field| field.value(cx))
                    .unwrap_or_default(),
            )
            .into()
        } else {
            self.patient
                .detail
                .ready()
                .map(PatientDetail::display_name)
                .unwrap_or_default()
        };
        let subject = self.form_subject(form, &patient_name);
        match form.state {
            FormState::Draft => threshold
                .bg(theme.draft)
                .border_color(theme.draft_rule)
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .justify_between()
                        .gap(px(12.))
                        .when(layout.compact && form.kind == FormKind::Notes, |el| {
                            el.flex_col().items_stretch()
                        })
                        .when(compact, |el| el.flex_col().items_stretch())
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap(px(4.))
                                .child(writing_status(
                                    "clinical-workspace-writing-status",
                                    WritingInk::Fresh,
                                    WritingSurface::Plane,
                                    theme,
                                ))
                                .when(!compact, |el| {
                                    el.child(
                                        div()
                                            .min_w_0()
                                            .max_w_full()
                                            .whitespace_normal()
                                            .type_role(theme, crate::theme::TextRole::Meta)
                                            .child(text!(subject)),
                                    )
                                }),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_wrap()
                                .gap(px(8.))
                                .when(layout.compact, |el| el.w_full().flex_col().items_stretch())
                                .child(
                                    self.form_actions[0]
                                        .attach(button(
                                            "clinical-workspace-cancel-form",
                                            if form.kind == FormKind::Notes {
                                                "Scarta la bozza"
                                            } else {
                                                "Scarta…"
                                            },
                                            theme,
                                            false,
                                            true,
                                        ))
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.request_discard(Discard::Form, cx)
                                        })),
                                )
                                .child(
                                    self.form_actions[1]
                                        .attach_enabled(
                                            button(
                                                "clinical-workspace-review-save",
                                                threshold_actions::Command::Review
                                                    .primary_label(form.kind),
                                                theme,
                                                true,
                                                review_enabled,
                                            )
                                            .debug_selector(|| {
                                                "clinical-workspace-review-save".into()
                                            }),
                                            review_enabled,
                                        )
                                        .when(review_enabled, |el| {
                                            el.on_click(cx.listener(|this, _, window, cx| {
                                                this.review_form(window, cx)
                                            }))
                                        }),
                                ),
                        ),
                ),
            FormState::Review => threshold
                .bg(theme.paper)
                .text_color(theme.ink)
                .child(self.threshold_question.attach_enabled(
                    confirmation_heading(
                        if repeated_scale {
                            crate::title::TitleText::patient_question(
                                "Ripetere l’invio della stessa valutazione per ",
                                patient_name.clone(),
                                "?",
                            )
                        } else if form.kind == FormKind::PatientNew {
                            crate::title::TitleText::patient_question(
                                "Creare la scheda di ",
                                patient_name.clone(),
                                " nell'ambulatorio selezionato?",
                            )
                        } else {
                            crate::title::TitleText::patient_question(
                                confirmation_prefix(
                                    1,
                                    if form.edit.is_some() {
                                        "modifica"
                                    } else {
                                        form.kind.noun()
                                    },
                                ),
                                patient_name.clone(),
                                "?",
                            )
                        },
                        theme,
                    ),
                    mode == ThresholdMode::FullPlane,
                ))
                .when(!compact, |el| el.child(self.threshold_detail(mode, cx)))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        .when(layout.compact, |el| el.w_full().flex_col().items_stretch())
                        .child({
                            let command = self.form_actions[2]
                                .attach(button(
                                    "clinical-workspace-cancel-review",
                                    if repeated_scale {
                                        "Continua la verifica"
                                    } else {
                                        CONFIRMATION_COMMANDS[0]
                                    },
                                    theme,
                                    false,
                                    true,
                                ))
                                .debug_selector(|| "threshold-back".into())
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.cancel_review(window, cx)
                                }));
                            #[cfg(test)]
                            let command = rendered_command::observe(command);
                            command
                        })
                        .child({
                            let command = self.form_actions[3]
                                .attach(
                                    button(
                                        "clinical-workspace-confirm-save",
                                        CONFIRMATION_COMMANDS[1],
                                        theme,
                                        true,
                                        true,
                                    )
                                    .debug_selector(|| "clinical-workspace-confirm-save".into())
                                    .aria_label(
                                        confirmation_command_label(
                                            crate::title::TitleText::name(patient_name.clone())
                                                .text(),
                                        ),
                                    ),
                                )
                                .on_click(cx.listener(|this, _, _, cx| this.confirm_form(cx)));
                            #[cfg(test)]
                            let command = rendered_command::observe(command);
                            command
                        }),
                )
                .when(mode == ThresholdMode::FullPlane, |el| {
                    el.child(self.threshold_detail(mode, cx))
                }),
            FormState::Saving => threshold
                .bg(theme.draft)
                .child(
                    div()
                        .id("clinical-workspace-saving-status")
                        .accessibility_id("clinical-workspace-saving-status")
                        .role(Role::Status)
                        .aria_label("Registrazione e rilettura in corso")
                        .child(text!(if form.kind == FormKind::Notes
                            && self.core.phase() == mediflow_patient_client::Phase::Recovering
                        {
                            "Rilettura della scheda… La bozza resta intatta."
                        } else if form.scale.as_ref().is_some_and(ScaleAssessment::is_reading) {
                            "Rilettura della voce e verifica del contesto in corso…"
                        } else {
                            "Registrazione e rilettura in corso…"
                        })),
                )
                .when(!compact, |el| el.child(self.threshold_detail(mode, cx))),
            FormState::Conflict | FormState::Uncertain | FormState::Rejected => {
                if form.kind == FormKind::Notes
                    && form.state == FormState::Rejected
                    && self.core.phase() == mediflow_patient_client::Phase::Locked
                    && self
                        .patient
                        .detail
                        .ready()
                        .is_some_and(|patient| patient.is_archived || patient.deleted_at.is_some())
                {
                    let copy_label = "Copia la bozza";
                    let discard_label = "Scarta la bozza";
                    return threshold.bg(theme.draft)
                        .child(notice("clinical-notes-readonly", if compact { "Scheda non modificabile" } else { "La scheda non è più modificabile. La bozza resta disponibile per la copia o lo scarto." }, theme, true))
                        .child(div().flex().flex_wrap().gap(px(8.)).when(layout.compact, |el| el.w_full().flex_col().items_stretch())
                            .child(self.form_actions[6].attach(button("clinical-workspace-copy-draft", copy_label, theme, false, true).debug_selector(|| copy_label.into()))
                                .on_click(cx.listener(|this, _, _, cx| this.copy_draft(cx))))
                            .child(self.form_actions[0].attach(button("clinical-notes-discard", discard_label, theme, false, true).debug_selector(|| discard_label.into()))
                                .on_click(cx.listener(|this, _, _, cx| this.finish_discard(Discard::Form, cx)))));
                }
                if form.kind == FormKind::Notes && form.state != FormState::Rejected {
                    let kind = if form.state == FormState::Conflict {
                        ViewStateKind::Conflitto
                    } else {
                        ViewStateKind::EsitoDaVerificare
                    };
                    return threshold
                        .when(compact, |el| {
                            el.child(
                                div()
                                    .id("clinical-notes-recovery-status")
                                    .role(Role::Status)
                                    .type_role(theme, crate::theme::TextRole::Strong)
                                    .child(text!(if form.state == FormState::Conflict {
                                        "Scheda cambiata"
                                    } else {
                                        "Esito da verificare"
                                    })),
                            )
                            .child(
                                self.form_actions[7]
                                    .attach(
                                        button(
                                            "clinical-notes-recovery-command",
                                            if form.state == FormState::Conflict {
                                                "Rileggi la scheda"
                                            } else {
                                                "Rileggi e verifica"
                                            },
                                            theme,
                                            false,
                                            true,
                                        )
                                        .debug_selector(
                                            || "clinical-notes-recovery-command".into(),
                                        ),
                                    )
                                    .on_click(cx.listener(|this, _, _, cx| this.reread_notes(cx))),
                            )
                        })
                        .when(!compact, |el| {
                            el.child(ViewState::new(ReadObject::Scheda, kind).render(
                                "clinical-notes-recovery",
                                theme,
                                &self.form_actions[7].focus,
                                cx.listener(|this, _, _, cx| this.reread_notes(cx)),
                            ))
                        })
                        .child(
                            div()
                                .flex()
                                .flex_wrap()
                                .gap(px(8.))
                                .when(layout.compact, |el| el.w_full().flex_col().items_stretch())
                                .child(
                                    self.form_actions[6]
                                        .attach(button(
                                            "clinical-workspace-copy-draft",
                                            "Copia bozza",
                                            theme,
                                            false,
                                            true,
                                        ))
                                        .on_click(
                                            cx.listener(|this, _, _, cx| this.copy_draft(cx)),
                                        ),
                                )
                                .child(
                                    self.form_actions[0]
                                        .attach(button(
                                            "clinical-notes-discard",
                                            "Scarta la bozza",
                                            theme,
                                            false,
                                            true,
                                        ))
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.request_discard(Discard::Form, cx)
                                        })),
                                ),
                        );
                }
                let label = if compact {
                    match form.state {
                        FormState::Conflict => "Scheda cambiata",
                        FormState::Rejected => "Non registrata",
                        _ => "Esito da verificare",
                    }
                } else if form.kind == FormKind::Scale && !repeated_scale {
                    "Valutazione da rivedere. Le risposte sono conservate."
                } else {
                    match form.state {
                        FormState::Conflict => "La scheda è cambiata. La bozza è conservata.",
                        FormState::Rejected => {
                            "La registrazione è stata rifiutata. La bozza è conservata."
                        }
                        _ => "Esito da verificare. La bozza è conservata.",
                    }
                };
                threshold
                    .bg(theme.draft)
                    .child(
                        div()
                            .id("clinical-workspace-save-uncertain")
                            .accessibility_id("clinical-workspace-save-uncertain")
                            .role(Role::Alert)
                            .aria_label(label)
                            .child(text!(label)),
                    )
                    .when(!compact, |el| el.child(self.threshold_detail(mode, cx)))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(8.))
                            .when(layout.compact, |el| el.w_full().flex_col().items_stretch())
                            .child(
                                self.form_actions[6]
                                    .attach(button(
                                        "clinical-workspace-copy-draft",
                                        "Copia bozza",
                                        theme,
                                        false,
                                        true,
                                    ))
                                    .on_click(cx.listener(|this, _, _, cx| this.copy_draft(cx))),
                            )
                            .child(
                                self.form_actions[7]
                                    .attach(
                                        button(
                                            "clinical-workspace-reconcile",
                                            if form.kind == FormKind::Scale {
                                                "Rileggi e verifica"
                                            } else {
                                                "Rileggi scheda…"
                                            },
                                            theme,
                                            true,
                                            true,
                                        )
                                        .debug_selector(|| "clinical-workspace-reconcile".into()),
                                    )
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.request_discard(Discard::Reload, cx)
                                    })),
                            )
                            .when(form.kind == FormKind::Scale, |el| {
                                el.child(
                                    self.form_actions[0]
                                        .attach(button(
                                            "clinical-scale-close-draft",
                                            "Chiudi bozza…",
                                            theme,
                                            false,
                                            true,
                                        ))
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.request_discard(Discard::Form, cx)
                                        })),
                                )
                            })
                            .when(
                                form.scale
                                    .as_ref()
                                    .is_some_and(ScaleAssessment::retry_ready),
                                |el| {
                                    el.child(
                                        self.form_actions[1]
                                            .attach(button(
                                                "clinical-scale-review-retry",
                                                "Rivedi lo stesso invio",
                                                theme,
                                                false,
                                                true,
                                            ))
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.review_scale_retry(cx)
                                            })),
                                    )
                                },
                            ),
                    )
            }
        }
    }
}
