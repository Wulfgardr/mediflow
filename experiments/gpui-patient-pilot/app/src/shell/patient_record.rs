use super::record_changes::{BAND_ROWS, Change, ChangeKind, ChangeSource, VisitAnchor};
use gpui::AnyElement;
#[cfg(test)]
macro_rules! text {
    ($($args:tt)*) => { crate::shell::rendered_command::observe_ink(gpui::text!($($args)*)) };
}
use super::*;

pub(super) const READING_INSET: f32 = 12.;
const QUIET_CHROME: f32 = 195.;
const WRITING_CHROME: f32 = 260.;

#[derive(Clone, Default)]
pub(super) struct RecordState {
    pub(super) anchor: Option<Option<VisitAnchor>>,
    pub(super) open: Option<String>,
    pub(super) reading: Option<Source>,
    pub(super) documents: bool,
    pub(super) quadro: bool,
    pub(super) registered: Option<(FormKind, String)>,
    pub(super) composer_column: gpui::ScrollHandle,
    pub(super) diary_all: bool,
}

impl RecordState {
    pub(super) fn fix_anchor(&mut self, rows: &[Entry]) {
        if self.anchor.is_none() {
            self.anchor = Some(record_changes::visit_anchor(rows));
        }
    }

    pub(super) fn registered(&mut self, kind: FormKind) {
        self.registered = Some((kind, chrono::Local::now().format("%H:%M").to_string()));
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Source {
    Entry(String),
    Document(String),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Sheet {
    Stacked,
    Wide,
}

const POINT_BEFORE: usize = 160;
const POINT_AFTER: usize = 60;
const CARET: &str = "▏";

#[derive(Debug, PartialEq)]
pub(super) struct DraftPoint {
    pub(super) text: String,
    pub(super) caret: std::ops::Range<usize>,
    pub(super) selected: std::ops::Range<usize>,
    pub(super) spoken: String,
}

impl DraftPoint {
    pub(super) fn of(value: &str, selection: std::ops::Range<usize>) -> Self {
        let clamp = |at: usize| {
            let mut at = at.min(value.len());
            while !value.is_char_boundary(at) {
                at -= 1;
            }
            at
        };
        let (start, end) = (
            clamp(selection.start),
            clamp(selection.end.max(selection.start)),
        );
        let line_start = value[..start].rfind('\n').map_or(0, |at| at + 1);
        let line_end = value[end..].find('\n').map_or(value.len(), |at| end + at);
        let from = value[line_start..start]
            .char_indices()
            .rev()
            .nth(POINT_BEFORE - 1)
            .map_or(line_start, |(at, _)| line_start + at);
        let to = value[end..line_end]
            .char_indices()
            .nth(POINT_AFTER)
            .map_or(line_end, |(at, _)| end + at);
        let lead = if from > line_start { "…" } else { "" };
        let tail = if to < line_end { "…" } else { "" };
        let before = &value[from..start];
        let selected = &value[start..end];
        let after = &value[end..to];
        let selected_at = lead.len() + before.len();
        let caret_at = selected_at + selected.len();
        Self {
            text: format!("{lead}{before}{selected}{CARET}{after}{tail}"),
            caret: caret_at..caret_at + CARET.len(),
            selected: selected_at..caret_at,
            spoken: format!("{before}{selected}{after}"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Zones {
    Three,
    Two,
    One,
}

impl Zones {
    pub(super) fn for_width(effective_width: f32) -> Self {
        if effective_width >= 1280. {
            Self::Three
        } else if effective_width >= 1000. {
            Self::Two
        } else {
            Self::One
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Step {
    Write,
    Review,
    Registered,
}

pub(super) fn step_for(state: FormState) -> Step {
    match state {
        FormState::Draft => Step::Write,
        FormState::Review
        | FormState::Saving
        | FormState::Conflict
        | FormState::Uncertain
        | FormState::Rejected => Step::Review,
    }
}

pub(super) fn identity_facts(patient: &PatientDetail, today: chrono::NaiveDate) -> Vec<String> {
    use chrono::Datelike;
    let mut facts = vec![];
    let estimated = patient.birth_date_precision.as_deref() == Some("estimated");
    let birth_year = if estimated { patient.birth_year } else { None };
    let exact = patient
        .birth_date
        .as_deref()
        .filter(|_| !estimated)
        .and_then(record_changes::instant)
        .map(|at| at.date_naive());
    if let Some(born) = exact {
        if let Some(age) = today.years_since(born) {
            facts.push(format!("{age} anni"));
        }
    } else if let Some(year) = birth_year {
        facts.push(format!("circa {} anni", today.year() - year));
    }
    facts.push(format!(
        "Nascita {}",
        crate::patient_text::birth_text(
            patient.birth_date.as_deref(),
            patient.birth_date_precision.as_deref(),
            patient.birth_year
        )
    ));
    let code = crate::patient_text::copy_code(&patient.tax_code);
    if patient.identifier_type.as_deref() == Some("none") || code.trim().is_empty() {
        facts.push("Nessun identificativo per ora".into());
    } else {
        facts.push(format!(
            "{} {}",
            crate::patient_text::identifier_label(
                &patient.tax_code,
                patient.identifier_type.as_deref()
            ),
            code.trim()
        ));
    }
    if patient.is_adi {
        facts.push("ADI".into());
    }
    if patient.is_archived {
        facts.push("Scheda archiviata".into());
    }
    facts
}

pub(super) fn record_title(
    id: impl Into<SharedString>,
    label: &str,
    count: Option<String>,
    theme: Theme,
) -> Stateful<Div> {
    let id = id.into();
    div()
        .id(SharedString::from(format!("{id}-row")))
        .min_w_0()
        .flex()
        .flex_wrap()
        .items_baseline()
        .justify_between()
        .gap(px(8.))
        .child(
            div()
                .id(id.clone())
                .accessibility_id(id)
                .role(Role::Heading)
                .aria_label(SharedString::from(label.to_owned()))
                .min_w_0()
                .text_color(theme.ink)
                .child(
                    crate::title::title(label.to_owned(), theme)
                        .with_role(crate::theme::TitleRole::SectionTitle),
                ),
        )
        .when_some(count, |el, count| {
            el.child(
                div()
                    .type_role(theme, crate::theme::TextRole::Meta)
                    .text_color(theme.secondary)
                    .child(text!(count)),
            )
        })
}

fn zone_label(label: &'static str, theme: Theme) -> Div {
    div()
        .text_color(theme.secondary)
        .child(crate::title::title(label, theme).with_role(crate::theme::TitleRole::Section))
}

fn block(theme: Theme) -> Div {
    let _ = theme;
    div().min_w_0().max_w_full().flex().flex_col().gap(px(8.))
}

fn stable_block(theme: Theme) -> Div {
    block(theme)
        .flex_1()
        .w_full()
        .p(px(12.))
        .bg(theme.shade)
        .rounded(px(theme.control_radius))
}

fn row(theme: Theme) -> Div {
    div()
        .min_w_0()
        .max_w_full()
        .border_t_1()
        .border_color(theme.rule)
        .py(px(8.))
        .flex()
        .flex_col()
        .gap(px(2.))
}

impl ClinicalApp {
    pub(super) fn record_header(
        &self,
        patient: &PatientDetail,
        layout: Layout,
        cx: &Context<Self>,
    ) -> Div {
        let theme = self.theme;
        let writable = !patient.is_archived && patient.deleted_at.is_none() && self.form.is_none();
        let facts = identity_facts(patient, chrono::Local::now().date_naive());
        div()
            .flex_shrink_0()
            .px(px(layout.margin))
            .py(px(10.))
            .border_b_1()
            .border_color(theme.rule)
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .items_start()
                    .when(layout.magnified, |el| el.flex_col())
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .child(crate::components::heading_with_role(
                                "clinical-workspace-patient-name",
                                crate::title::TitleText::name(patient.display_name()),
                                theme,
                                crate::theme::TitleRole::Person { compact: true },
                            ))
                            .child(
                                div()
                                    .id("clinical-workspace-patient-identity")
                                    .accessibility_id("clinical-workspace-patient-identity")
                                    .role(Role::Note)
                                    .aria_label(SharedString::from(facts.join(", ")))
                                    .debug_selector(|| "clinical-workspace-patient-birth".into())
                                    .min_w_0()
                                    .flex()
                                    .flex_wrap()
                                    .gap_x(px(14.))
                                    .gap_y(px(2.))
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .text_color(theme.secondary)
                                    .when(layout.compact, |el| el.flex_col())
                                    .children(facts.into_iter().map(|fact| {
                                        let code = fact.split_once(' ').filter(|&(label, _)| {
                                            matches!(
                                                label,
                                                "CF" | "STP"
                                                    | "ENI"
                                                    | "Documento"
                                                    | "Identificativo"
                                            )
                                        });
                                        match code {
                                            Some((label, value)) => div()
                                                .min_w_0()
                                                .max_w_full()
                                                .flex()
                                                .items_baseline()
                                                .gap(px(4.))
                                                .child(text!(label.to_owned()))
                                                .child(
                                                    div()
                                                        .min_w_0()
                                                        .flex_1()
                                                        .type_role(
                                                            theme,
                                                            crate::theme::TextRole::Code,
                                                        )
                                                        .child(crate::title::title(
                                                            crate::title::TitleText::code(
                                                                value.to_owned(),
                                                            ),
                                                            theme,
                                                        )),
                                                ),
                                            None => div()
                                                .min_w_0()
                                                .max_w_full()
                                                .whitespace_normal()
                                                .child(text!(fact)),
                                        }
                                    }))
                                    .child(
                                        div()
                                            .id("clinical-workspace-allergies")
                                            .accessibility_id("clinical-workspace-allergies")
                                            .role(Role::Note)
                                            .child(allergy_label(None, theme)),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .justify_end()
                            .gap(px(8.))
                            .child(match self.form.as_ref().map(|form| form.kind) {
                                Some(kind) => button(
                                    "clinical-workspace-close-draft",
                                    if kind == FormKind::Notes {
                                        "Chiudi la nota"
                                    } else {
                                        "Chiudi la voce"
                                    },
                                    theme,
                                    false,
                                    true,
                                )
                                .on_click(cx.listener(|this, _, _, cx| this.close_clean_notes(cx))),
                                None => button(
                                    "clinical-workspace-new-entry",
                                    "Nuova voce",
                                    theme,
                                    true,
                                    writable && self.can_write(FormKind::Entry),
                                )
                                .when(
                                    writable && self.can_write(FormKind::Entry),
                                    |el| {
                                        el.on_click(cx.listener(|this, _, window, cx| {
                                            this.open_form(FormKind::Entry, window, cx)
                                        }))
                                    },
                                ),
                            })
                            .when(!layout.compact, |el| {
                                el.child(
                                    button(
                                        "clinical-workspace-refresh",
                                        "Rileggi",
                                        theme,
                                        false,
                                        true,
                                    )
                                    .on_click(cx.listener(
                                        |this, _, _, cx| this.request_discard(Discard::Reload, cx),
                                    )),
                                )
                                .child(
                                    button(
                                        "clinical-workspace-copy-profile",
                                        "Copia scheda",
                                        theme,
                                        false,
                                        true,
                                    )
                                    .on_click(cx.listener(|this, _, _, cx| this.copy_profile(cx))),
                                )
                            })
                            .child(
                                button(
                                    "clinical-workspace-back-directory",
                                    self.patient_back_label(),
                                    theme,
                                    false,
                                    self.form.is_none(),
                                )
                                .debug_selector(|| "clinical-workspace-back-directory".into())
                                .when(self.form.is_none(), |el| {
                                    el.on_click(
                                        cx.listener(|this, _, _, cx| this.back_from_patient(cx)),
                                    )
                                }),
                            ),
                    ),
            )
    }

    pub(super) fn record_overview(
        &self,
        patient: &PatientDetail,
        layout: Layout,
        cx: &Context<Self>,
    ) -> Div {
        let theme = self.theme;
        let zones = Zones::for_width(layout.width / self.effective_text_scale());
        let writing = self.form.is_some().then(|| self.record_composer(cx));
        let done = self.record_registered_step();
        let drafting = self.form.is_some();
        let chrome = if !layout.compact && self.quiet_record() {
            QUIET_CHROME
        } else {
            WRITING_CHROME
        };
        let zone_height = (self.viewport_height - chrome * self.theme.scale).max(280.);
        let reviewing = self
            .form
            .as_ref()
            .is_some_and(|form| form.state != FormState::Draft);
        if zones != Zones::One && self.reading_document() && !reviewing {
            return div()
                .min_w_0()
                .children(self.record_reading(Sheet::Wide, cx));
        }
        let reading = self.record_reading(Sheet::Stacked, cx);
        let column = |id: &'static str| {
            div()
                .id(id)
                .debug_selector(move || id.into())
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(24.))
        };
        let zone = |id: &'static str| column(id).max_h(px(zone_height)).overflow_y_scroll();
        match zones {
            Zones::Three => div()
                .min_w_0()
                .flex()
                .items_start()
                .child(
                    zone("clinical-record-stable")
                        .w(px(270.))
                        .flex_none()
                        .pr(px(20.))
                        .child(zone_label("Stabile", theme))
                        .child(self.record_stable(patient, true, cx)),
                )
                .child(
                    zone("clinical-record-changed")
                        .flex_1()
                        .min_w(px(360.))
                        .px(px(20.))
                        .border_l_1()
                        .border_r_1()
                        .border_color(theme.rule)
                        .child(self.record_band(cx))
                        .child(self.record_diary(cx)),
                )
                .child(
                    zone("clinical-record-context")
                        .track_scroll(&self.patient.record.composer_column)
                        .w(px(340.))
                        .flex_none()
                        .pl(px(20.))
                        .children(reading)
                        .children(writing)
                        .when(drafting, |el| el.child(self.record_documents(cx)))
                        .children(done)
                        .child(self.record_context(patient, cx)),
                ),
            Zones::Two => div()
                .min_w_0()
                .flex()
                .items_start()
                .child(
                    zone("clinical-record-changed")
                        .flex_1()
                        .pr(px(20.))
                        .child(self.record_band(cx))
                        .child(self.record_diary(cx)),
                )
                .child(
                    zone("clinical-record-side")
                        .track_scroll(&self.patient.record.composer_column)
                        .w(px(340.))
                        .flex_none()
                        .pl(px(20.))
                        .border_l_1()
                        .border_color(theme.rule)
                        .children(reading)
                        .children(writing)
                        .when(drafting, |el| {
                            el.child(self.record_active_therapies(cx))
                                .child(self.record_documents(cx))
                        })
                        .children(done)
                        .child(zone_label("Stabile", theme))
                        .child(self.record_stable(patient, !drafting, cx))
                        .child(self.record_context(patient, cx)),
                ),
            Zones::One => div().min_w_0().child(
                column("clinical-record-single")
                    .child(self.record_quadro(cx))
                    .children(reading)
                    .children(writing)
                    .children(done)
                    .when(drafting, |el| el.child(self.record_documents(cx)))
                    .child(self.record_band(cx))
                    .child(self.record_stable(patient, true, cx))
                    .child(self.record_diary(cx))
                    .child(self.record_measures(cx))
                    .child(self.record_checkups(cx))
                    .when(!drafting, |el| el.child(self.record_documents(cx))),
            ),
        }
    }

    pub(super) fn record_stable(
        &self,
        patient: &PatientDetail,
        with_therapies: bool,
        cx: &Context<Self>,
    ) -> Div {
        let theme = self.theme;
        let diagnoses = if patient.field_locked("diagnoses") {
            Err(())
        } else {
            diagnosis_labels(patient.diagnoses.as_deref())
        };
        let paired = self.stable_side_by_side();
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(
                div()
                    .min_w_0()
                    .flex()
                    .when(!paired, |el| el.flex_col())
                    .when(paired, |el| el.items_start())
                    .gap(px(16.))
                    .child(
                        stable_block(theme)
                            .child(record_title(
                                "clinical-overview-problems",
                                "Problemi",
                                Some(diagnoses.as_ref().map_or_else(
                                    |_| "Non disponibile".into(),
                                    |rows| format!("{} documentati", rows.len()),
                                )),
                                theme,
                            ))
                            .when(diagnoses.is_err(), |el| {
                                el.child(self.unreadable_field(
                                    "clinical-workspace-diagnoses-unavailable",
                                    cx,
                                ))
                            })
                            .when(diagnoses.as_ref().is_ok_and(Vec::is_empty), |el| {
                                el.child(div().text_color(theme.secondary).child({
                                    let text = text!("Nessun problema riportato nella scheda.");
                                    #[cfg(test)]
                                    let text = crate::shell::rendered_command::observe_text(text);
                                    text
                                }))
                            })
                            .children(diagnoses.unwrap_or_default().into_iter().map(
                                |(id, label)| {
                                    let (code, name) = label
                                        .split_once(" · ")
                                        .map_or((None, label.clone()), |(code, name)| {
                                            (Some(code.to_owned()), name.to_owned())
                                        });
                                    row(theme)
                                        .id(SharedString::from(id))
                                        .child({
                                            let text = text!(name);
                                            #[cfg(test)]
                                            let text =
                                                crate::shell::rendered_command::observe_text(text);
                                            text
                                        })
                                        .when_some(code, |el, code| {
                                            el.child(
                                                div()
                                                    .type_role(theme, crate::theme::TextRole::Code)
                                                    .text_color(theme.secondary)
                                                    .child(text!(code)),
                                            )
                                        })
                                },
                            )),
                    )
                    .when(with_therapies, |el| {
                        el.child(self.record_active_therapies(cx))
                    }),
            )
            .child(self.record_notes(patient, cx))
    }

    pub(super) fn record_active_therapies(&self, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let active: Vec<_> = self
            .patient
            .therapies
            .ready()
            .into_iter()
            .flatten()
            .filter(|row| row.status == "active" && row.deleted_at.is_none())
            .collect();
        stable_block(theme)
            .id("clinical-record-active-therapies")
            .debug_selector(|| "clinical-record-active-therapies".into())
            .child(record_title(
                "clinical-workspace-active-therapies-heading",
                "Terapie attive",
                Some(
                    self.patient
                        .therapies
                        .ready()
                        .map_or_else(|| "Non disponibile".into(), |_| active.len().to_string()),
                ),
                theme,
            ))
            .when(
                self.patient.therapies.state(ReadObject::Terapie).is_some(),
                |el| {
                    el.child(self.patient_read_hint(
                        "clinical-workspace-therapies-state",
                        &self.patient.therapies,
                        ReadObject::Terapie,
                        cx,
                    ))
                },
            )
            .when(
                self.patient.therapies.ready().is_some() && active.is_empty(),
                |el| {
                    el.child(self.empty_read_state(
                        "clinical-workspace-therapies-empty",
                        ReadObject::Terapie,
                        cx,
                    ))
                },
            )
            .children(active.into_iter().map(|therapy| {
                row(theme)
                    .id(SharedString::from(format!(
                        "clinical-overview-therapy-{}",
                        therapy.id
                    )))
                    .flex_row()
                    .flex_wrap()
                    .items_baseline()
                    .justify_between()
                    .gap_x(px(10.))
                    .py(px(4.))
                    .child(
                        div()
                            .min_w_0()
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child({
                                let text = text!(therapy.drug_name.clone());
                                #[cfg(test)]
                                let text = crate::shell::rendered_command::observe_text(text);
                                text
                            }),
                    )
                    .child(div().min_w_0().text_color(theme.secondary).child({
                        let text = text!(therapy.dosage.clone());
                        #[cfg(test)]
                        let text = crate::shell::rendered_command::observe_text(text);
                        text
                    }))
            }))
    }

    fn stable_side_by_side(&self) -> bool {
        let width = self.viewport_width / self.effective_text_scale();
        Zones::for_width(width) == Zones::One && width >= 700.
    }

    pub(super) fn record_notes(
        &self,
        patient: &PatientDetail,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        let theme = self.theme;
        let editable = self.form.is_none()
            && !patient.is_archived
            && patient.deleted_at.is_none()
            && !patient.field_locked("notes")
            && self.can_write(FormKind::Notes);
        let registered = self
            .patient
            .record
            .registered
            .as_ref()
            .filter(|(kind, _)| *kind == FormKind::Notes && self.verified.is_some())
            .map(|(_, at)| at.clone());
        let unavailable = patient.field_locked("notes");
        let content = patient
            .notes
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned);
        stable_block(theme)
            .id("clinical-record-notes")
            .when(registered.is_some(), |el| {
                el.p(px(10.))
                    .border_1()
                    .border_color(theme.success)
                    .rounded(px(theme.control_radius))
            })
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .child(record_title(
                        "clinical-workspace-notes-heading",
                        "Note della scheda",
                        None,
                        theme,
                    ))
                    .when_some(registered, |el, at| {
                        el.child(
                            div()
                                .id("clinical-record-notes-registered")
                                .accessibility_id("clinical-record-notes-registered")
                                .role(Role::Status)
                                .aria_label(SharedString::from(format!("Registrata alle {at}")))
                                .type_role(theme, crate::theme::TextRole::Strong)
                                .text_color(theme.success)
                                .child(text!(format!("Registrata alle {at}"))),
                        )
                    })
                    .child(
                        button(
                            "clinical-workspace-edit-notes",
                            "Modifica",
                            theme,
                            false,
                            editable,
                        )
                        .aria_label("Modifica note")
                        .debug_selector(|| "clinical-workspace-edit-notes".into())
                        .when(editable, |el| {
                            el.on_click(cx.listener(|this, _, window, cx| {
                                this.open_form(FormKind::Notes, window, cx)
                            }))
                        }),
                    ),
            )
            .child(
                div()
                    .id("clinical-workspace-notes-content")
                    .type_role(theme, crate::theme::TextRole::Prose)
                    .text_color(theme.ink)
                    .child(if unavailable {
                        self.unreadable_field("clinical-workspace-notes-unreadable", cx)
                            .into_any_element()
                    } else if let Some(content) = content {
                        clinical_text::render(&content, WritingInk::Dry, theme)
                    } else {
                        div()
                            .text_color(theme.secondary)
                            .type_role(theme, crate::theme::TextRole::Body)
                            .child(text!("Nessuna nota presente nella scheda."))
                            .into_any_element()
                    }),
            )
    }

    pub(super) fn record_band(&self, cx: &Context<Self>) -> AnyElement {
        let theme = self.theme;
        let Some(anchor) = self.patient.record.anchor.clone() else {
            return match self.patient.entries.state(ReadObject::Diario) {
                Some(_) => self
                    .patient_read_hint(
                        "clinical-record-band-state",
                        &self.patient.entries,
                        ReadObject::Diario,
                        cx,
                    )
                    .into_any_element(),
                None => div().into_any_element(),
            };
        };
        if anchor.is_some()
            && (self.patient.therapies.ready().is_none()
                || self.patient.observations.ready().is_none())
        {
            return div()
                .id("clinical-record-band-incomplete")
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(8.))
                .when(
                    self.patient.therapies.state(ReadObject::Terapie).is_some(),
                    |el| {
                        el.child(self.patient_read_hint(
                            "clinical-record-band-therapies-state",
                            &self.patient.therapies,
                            ReadObject::Terapie,
                            cx,
                        ))
                    },
                )
                .when(
                    self.patient
                        .observations
                        .state(ReadObject::Parametri)
                        .is_some(),
                    |el| {
                        el.child(self.patient_read_hint(
                            "clinical-record-band-observations-state",
                            &self.patient.observations,
                            ReadObject::Parametri,
                            cx,
                        ))
                    },
                )
                .into_any_element();
        }
        let therapies = self
            .patient
            .therapies
            .ready()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let observations = self
            .patient
            .observations
            .ready()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let entries = self
            .patient
            .entries
            .ready()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let Some(anchor) = anchor else {
            return div()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(
                    div()
                        .id("clinical-record-no-visit")
                        .accessibility_id("clinical-record-no-visit")
                        .role(Role::Note)
                        .text_color(theme.secondary)
                        .child(text!("Nessuna visita registrata.")),
                )
                .child(self.record_latest_therapy(therapies, entries, cx))
                .into_any_element();
        };
        let mut changes =
            record_changes::changes_since(&anchor, therapies, observations, &chrono::Local);
        let documents = record_changes::documents_since(
            &anchor,
            self.patient
                .attachments
                .ready()
                .map(Vec::as_slice)
                .unwrap_or(&[]),
        );
        let new_documents = !documents.is_empty();
        if self.patient.record.documents {
            changes.extend(documents);
            changes.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.subject.cmp(&b.subject)));
        }
        let diary = record_changes::diary_after(&anchor, entries);
        let mut title = format!(
            "Dall’ultima visita · {}",
            anchor.visit_day.get(..5).unwrap_or(&anchor.visit_day)
        );
        if let Some(author) = anchor.recorded_by.as_deref() {
            title.push_str(&format!(" · {author}"));
        }
        if changes.is_empty() && diary.is_none() && !new_documents {
            return div()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(
                    div()
                        .id("clinical-record-no-changes")
                        .accessibility_id("clinical-record-no-changes")
                        .role(Role::Note)
                        .text_color(theme.secondary)
                        .child(text!(format!("{title}: nessuna variazione registrata."))),
                )
                .child(self.record_latest_therapy(therapies, entries, cx))
                .into_any_element();
        }
        let documents_on = self.patient.record.documents;
        let mut rows: Vec<AnyElement> = vec![];
        for (day, groups) in record_changes::by_day_and_kind(changes, &chrono::Local) {
            rows.push(
                div()
                    .pt(px(6.))
                    .type_role(theme, crate::theme::TextRole::Meta)
                    .text_color(theme.secondary)
                    .child(text!(format!("Registrate il {day}")))
                    .into_any_element(),
            );
            for (kind, named) in groups {
                rows.push(self.kind_group(kind, named, entries, cx).into_any_element());
            }
        }
        div()
            .id("clinical-record-band")
            .accessibility_id("clinical-record-band")
            .role(Role::Region)
            .aria_label(SharedString::from(title.clone()))
            .min_w_0()
            .p(px(14.))
            .border_1()
            .border_color(theme.strong_rule)
            .bg(theme.selected)
            .rounded(px(theme.control_radius))
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .child(record_title("clinical-record-band-title", &title, None, theme).flex_1())
                    .child(
                        button(
                            "clinical-record-band-documents",
                            "Mostra anche i documenti",
                            theme,
                            false,
                            true,
                        )
                        .aria_selected(documents_on)
                        .flex_none()
                        .px(px(4.))
                        .border_color(gpui::transparent_black())
                        .bg(gpui::transparent_black())
                        .text_color(theme.fresh)
                        .when(documents_on, |el| el.underline())
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.patient.record.documents = !this.patient.record.documents;
                            cx.notify();
                        })),
                    ),
            )
            .children(rows)
            .when_some(diary, |el, line| {
                el.child(
                    div()
                        .border_t_1()
                        .border_color(theme.rule)
                        .pt(px(8.))
                        .flex()
                        .child(
                            button("clinical-record-band-diary", line, theme, false, true)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if this.form.is_some() {
                                        this.read_whole_diary(cx)
                                    } else {
                                        this.section_selected(PatientSection::Diary, cx)
                                    }
                                })),
                        ),
                )
            })
            .into_any_element()
    }

    fn kind_group(
        &self,
        kind: ChangeKind,
        named: Vec<Change>,
        entries: &[Entry],
        cx: &Context<Self>,
    ) -> Div {
        let theme = self.theme;
        let open = named
            .iter()
            .find(|change| self.patient.record.open.as_deref() == Some(change.key.as_str()))
            .cloned();
        div()
            .min_w_0()
            .border_t_1()
            .border_color(theme.rule)
            .py(px(4.))
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(
                div()
                    .min_w_0()
                    .flex()
                    .items_baseline()
                    .gap(px(12.))
                    .child(
                        div()
                            .w(px(132.))
                            .flex_none()
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .text_color(theme.warning)
                            .child(text!(kind.counted(named.len()))),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_wrap()
                            .gap_x(px(6.))
                            .children(named.iter().map(|change| self.change_name(change, cx))),
                    ),
            )
            .when_some(open, |el, change| {
                el.child(self.change_detail(&change, entries, 144., cx))
            })
    }

    fn change_name(&self, change: &Change, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let key = change.key.clone();
        let open = self.patient.record.open.as_deref() == Some(key.as_str());
        let day = record_changes::day_in_zone(change.at, &chrono::Local);
        div()
            .id(SharedString::from(format!("clinical-record-change-{key}")))
            .accessibility_id(SharedString::from(format!("clinical-record-change-{key}")))
            .debug_selector({
                let key = key.clone();
                move || format!("clinical-record-change-{key}")
            })
            .role(Role::Button)
            .aria_label(SharedString::from(format!(
                "{}, {} il {day}",
                change.subject,
                change.kind.label()
            )))
            .aria_expanded(open)
            .focusable()
            .tab_stop(true)
            .cursor_pointer()
            .min_h(px(28.))
            .px(px(4.))
            .rounded(px(Theme::nested(theme.control_radius, 4.)))
            .flex()
            .items_center()
            .type_role(theme, crate::theme::TextRole::Strong)
            .when(open, |el| el.underline())
            .hover(move |style| style.bg(theme.hover))
            .focus(move |style| style.shadow(vec![theme.focus_ring(false)]))
            .child(text!(change.subject.clone()))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.patient.record.open =
                    if this.patient.record.open.as_deref() == Some(key.as_str()) {
                        None
                    } else {
                        Some(key.clone())
                    };
                cx.notify();
            }))
    }

    fn record_latest_therapy(
        &self,
        therapies: &[Therapy],
        entries: &[Entry],
        cx: &Context<Self>,
    ) -> Div {
        let theme = self.theme;
        let events = record_changes::latest_therapy_events(therapies, &chrono::Local);
        block(theme)
            .child(record_title(
                "clinical-record-latest-therapy",
                "Ultime modifiche di terapia",
                self.patient
                    .therapies
                    .ready()
                    .map(|_| events.len().to_string()),
                theme,
            ))
            .when(
                self.patient.therapies.ready().is_some() && events.is_empty(),
                |el| {
                    el.child(
                        div()
                            .text_color(theme.secondary)
                            .child(text!("Nessuna terapia registrata.")),
                    )
                },
            )
            .children(
                events
                    .into_iter()
                    .map(|change| self.record_change_row(change, entries, true, cx)),
            )
    }

    fn record_change_row(
        &self,
        change: Change,
        entries: &[Entry],
        dated: bool,
        cx: &Context<Self>,
    ) -> Div {
        let theme = self.theme;
        let open = self.patient.record.open.as_deref() == Some(change.key.as_str());
        let key = change.key.clone();
        let day = record_changes::day_in_zone(change.at, &chrono::Local);
        div()
            .min_w_0()
            .border_t_1()
            .border_color(theme.rule)
            .pt(px(6.))
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(
                div()
                    .id(SharedString::from(format!("clinical-record-change-{key}")))
                    .accessibility_id(SharedString::from(format!("clinical-record-change-{key}")))
                    .role(Role::Button)
                    .aria_label(SharedString::from(format!(
                        "{}, {} il {day}",
                        change.subject,
                        change.kind.label()
                    )))
                    .aria_expanded(open)
                    .focusable()
                    .tab_stop(true)
                    .cursor_pointer()
                    .min_h(px(36.))
                    .rounded(px(theme.control_radius - 4.))
                    .px(px(4.))
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .hover(move |style| style.bg(theme.hover))
                    .focus(move |style| style.shadow(vec![theme.focus_ring(false)]))
                    .when(dated, |el| {
                        el.child(
                            div()
                                .w(px(76.))
                                .flex_none()
                                .type_role(theme, crate::theme::TextRole::Meta)
                                .text_color(theme.secondary)
                                .child(text!(day.clone())),
                        )
                    })
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child(text!(change.subject.clone())),
                    )
                    .child(
                        div()
                            .flex_none()
                            .px(px(8.))
                            .py(px(2.))
                            .rounded(px(999.))
                            .border_1()
                            .border_color(theme.warning)
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.warning)
                            .child(text!(change.kind.label())),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.patient.record.open =
                            if this.patient.record.open.as_deref() == Some(key.as_str()) {
                                None
                            } else {
                                Some(key.clone())
                            };
                        cx.notify();
                    })),
            )
            .when(open, |el| {
                el.child(self.change_detail(&change, entries, if dated { 90. } else { 4. }, cx))
            })
    }

    fn change_detail(
        &self,
        change: &Change,
        entries: &[Entry],
        indent: f32,
        cx: &Context<Self>,
    ) -> Div {
        let theme = self.theme;
        let day = record_changes::day_in_zone(change.at, &chrono::Local);
        let same_day: Vec<(String, String)> = if change.source == ChangeSource::Therapy {
            record_changes::entries_on_day(change.at, entries, &chrono::Local)
                .into_iter()
                .map(|entry| {
                    (
                        entry.id.clone(),
                        format!(
                            "Diario del {}: {}",
                            day.get(..5).unwrap_or_default(),
                            entry_type_label(&entry.entry_type)
                        ),
                    )
                })
                .collect()
        } else {
            vec![]
        };
        let (section, source_label) = match change.source {
            ChangeSource::Therapy => (PatientSection::Therapies, "Apri in Terapie"),
            ChangeSource::Observation => (PatientSection::Observations, "Apri in Parametri"),
            ChangeSource::Document => (PatientSection::Documents, "Apri in Documenti"),
        };
        let document = (change.source == ChangeSource::Document)
            .then(|| change.key.trim_start_matches("document-").to_owned());
        div()
            .pl(px(indent))
            .flex()
            .flex_col()
            .gap(px(4.))
            .type_role(theme, crate::theme::TextRole::Meta)
            .children(
                change
                    .detail
                    .iter()
                    .map(|line| div().child(text!(line.clone()))),
            )
            .child(
                div()
                    .text_color(theme.secondary)
                    .child(text!(format!("Registrata il {day}"))),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .children(same_day.into_iter().map(|(id, label)| {
                        let entry = id.clone();
                        button(
                            SharedString::from(format!("clinical-record-read-entry-{id}")),
                            label,
                            theme,
                            false,
                            true,
                        )
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.read_record_entry(&entry, cx)),
                        )
                    }))
                    .when_some(document, |el, id| {
                        el.child(
                            button(
                                SharedString::from(format!("clinical-record-open-document-{id}")),
                                "Apri il documento",
                                theme,
                                false,
                                true,
                            )
                            .on_click(
                                cx.listener(move |this, _, _, cx| {
                                    this.read_record_document(&id, cx)
                                }),
                            ),
                        )
                    })
                    .child(
                        button(
                            SharedString::from(format!(
                                "clinical-record-change-section-{}",
                                change.key
                            )),
                            source_label,
                            theme,
                            false,
                            self.form.is_none(),
                        )
                        .when(self.form.is_none(), |el| {
                            el.on_click(
                                cx.listener(move |this, _, _, cx| {
                                    this.section_selected(section, cx)
                                }),
                            )
                        }),
                    ),
            )
    }

    pub(super) fn read_record_document(&mut self, id: &str, cx: &mut Context<Self>) {
        self.patient.record.reading = Some(Source::Document(id.to_owned()));
        self.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
        if !self
            .patient
            .document_original
            .as_ref()
            .is_some_and(|original| original.id == id)
        {
            self.patient.document_original = None;
            self.open_document_original(id, documents::pdf::Resolution::Screen, cx);
        }
        cx.notify();
    }

    pub(super) fn read_record_entry(&mut self, id: &str, cx: &mut Context<Self>) {
        self.patient.document_original = None;
        self.patient.record.reading = Some(Source::Entry(id.to_owned()));
        cx.notify();
    }

    pub(super) fn close_record_reading(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let wide = self.reading_document();
        self.patient.record.reading = None;
        self.patient.document_original = None;
        if wide {
            self.profile_scroll.set_offset(gpui::point(px(0.), px(0.)));
            if let Some(editor) = self
                .form
                .as_ref()
                .and_then(|form| first_text_editor(&form.fields))
                .map(|field| field.editor.clone())
            {
                editor.update(cx, |input, cx| input.focus_in_place(window, cx));
            }
        } else if self.form.is_some() {
            self.focus_after_render = true;
            self.focus_first_field = true;
        }
        cx.notify();
    }

    fn reading_document(&self) -> bool {
        matches!(self.patient.record.reading, Some(Source::Document(_)))
    }

    pub(super) fn record_reading(&self, sheet: Sheet, cx: &Context<Self>) -> Option<Stateful<Div>> {
        let theme = self.theme;
        let writing = self.form.is_some();
        let (title, body, registration): (String, AnyElement, String) =
            match self.patient.record.reading.as_ref()? {
                Source::Entry(id) => {
                    let entry = self
                        .patient
                        .entries
                        .ready()?
                        .iter()
                        .find(|entry| &entry.id == id)?;
                    (
                        format!(
                            "{} · {}",
                            display_instant_date(&entry.date),
                            entry_type_label(&entry.entry_type)
                        ),
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Strong)
                                    .child(text!(entry.title.clone())),
                            )
                            .child(if entry.locked_fields.is_empty() {
                                clinical_text::render(&entry.content, WritingInk::Dry, theme)
                            } else {
                                self.unreadable_field("clinical-record-reading-unreadable", cx)
                                    .into_any_element()
                            })
                            .into_any_element(),
                        diary_registration(
                            entry.recorded_by.as_deref(),
                            entry.created_at.as_deref(),
                            &chrono::Local,
                        ),
                    )
                }
                Source::Document(id) => {
                    let document = self
                        .patient
                        .attachments
                        .ready()?
                        .iter()
                        .find(|row| &row.id == id)?;
                    let original = self
                        .patient
                        .document_original
                        .as_ref()
                        .filter(|original| &original.id == id);
                    let reload = id.clone();
                    (
                        document.name.clone(),
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(text!(format!(
                                "{} · {}",
                                document.mime_type,
                                format_size(document.size)
                            )))
                            .child(match original {
                                Some(original) => self
                                    .document_original_content(
                                        original,
                                        document_details::OriginalPlace::Record { save: !writing },
                                        cx,
                                    )
                                    .into_any_element(),
                                None => div()
                                    .flex()
                                    .child(
                                        button(
                                            "clinical-record-reading-document-load",
                                            "Mostra l’originale",
                                            theme,
                                            false,
                                            true,
                                        )
                                        .on_click(
                                            cx.listener(move |this, _, _, cx| {
                                                this.read_record_document(&reload, cx)
                                            }),
                                        ),
                                    )
                                    .into_any_element(),
                            })
                            .when(!writing, |el| {
                                el.child(
                                    div().flex().child(
                                        button(
                                            "clinical-record-reading-document-open",
                                            "Apri in Documenti",
                                            theme,
                                            false,
                                            true,
                                        )
                                        .on_click(
                                            cx.listener(|this, _, window, cx| {
                                                this.close_record_reading(window, cx);
                                                this.section_selected(PatientSection::Documents, cx)
                                            }),
                                        ),
                                    ),
                                )
                            })
                            .into_any_element(),
                        format!(
                            "Aggiunto il {}",
                            display_date(document.created_at.as_deref())
                        ),
                    )
                }
            };
        Some(
            div()
                .id("clinical-record-reading")
                .accessibility_id("clinical-record-reading")
                .debug_selector(|| "clinical-record-reading-sheet".into())
                .role(Role::Region)
                .aria_label(SharedString::from(title.clone()))
                .min_w_0()
                .p(px(READING_INSET))
                .border_1()
                .border_color(theme.secondary)
                .rounded(px(theme.around_control(READING_INSET)))
                .bg(theme.paper)
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .child(record_title(
                            "clinical-record-reading-title",
                            &title,
                            None,
                            theme,
                        ))
                        .child(
                            button(
                                "clinical-record-reading-close",
                                if writing {
                                    "Torna alla bozza"
                                } else {
                                    "Chiudi"
                                },
                                theme,
                                false,
                                true,
                            )
                            .on_click(cx.listener(
                                |this, _, window, cx| this.close_record_reading(window, cx),
                            )),
                        ),
                )
                .map(|el| {
                    let registration = div()
                        .type_role(theme, crate::theme::TextRole::Meta)
                        .text_color(theme.secondary)
                        .child(text!(registration));
                    match sheet {
                        Sheet::Stacked => el.child(body).child(registration).when(writing, |el| {
                            el.child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .text_color(theme.fresh)
                                    .child(text!("La bozza resta aperta qui sotto.")),
                            )
                        }),
                        Sheet::Wide => el.child(body).child(registration),
                    }
                }),
        )
    }

    pub(super) fn draft_folded(&self, layout: Layout) -> bool {
        Zones::for_width(layout.width / self.effective_text_scale()) != Zones::One
            && self.reading_document()
            && self
                .form
                .as_ref()
                .is_some_and(|form| form.state == FormState::Draft)
    }

    pub(super) fn draft_point(&self, cx: &Context<Self>) -> Option<Stateful<Div>> {
        let theme = self.theme;
        let form = self.form.as_ref()?;
        let editor = first_text_editor(&form.fields)?.editor.read(cx);
        let point = DraftPoint::of(editor.value(), editor.selection());
        let mut highlights = vec![];
        if !point.selected.is_empty() {
            highlights.push((
                point.selected.clone(),
                gpui::HighlightStyle {
                    background_color: Some(theme.selected),
                    ..Default::default()
                },
            ));
        }
        highlights.push((
            point.caret.clone(),
            gpui::HighlightStyle {
                color: Some(theme.fresh),
                font_weight: Some(gpui::FontWeight::BOLD),
                ..Default::default()
            },
        ));
        Some(
            div()
                .id("clinical-record-draft-point")
                .accessibility_id("clinical-record-draft-point")
                .debug_selector(|| "clinical-record-draft-point".into())
                .role(Role::Button)
                .aria_label(SharedString::from(format!(
                    "Torna alla bozza: {}",
                    point.spoken
                )))
                .focusable()
                .tab_stop(true)
                .cursor_pointer()
                .flex_none()
                .min_w_0()
                .px(px(12.))
                .py(px(8.))
                .bg(theme.draft)
                .border_1()
                .border_dashed()
                .border_color(theme.fresh)
                .rounded(px(Theme::nested(
                    theme.around_control(READING_INSET),
                    READING_INSET,
                )))
                .type_role(theme, crate::theme::TextRole::Prose)
                .text_color(theme.fresh)
                .hover(move |style| style.bg(theme.hover))
                .focus(move |style| style.shadow(vec![theme.focus_ring(false)]))
                .child(gpui::StyledText::new(point.text).with_highlights(highlights))
                .on_click(cx.listener(|this, _, window, cx| this.close_record_reading(window, cx))),
        )
    }

    pub(super) fn record_diary(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let total = self
            .patient
            .entries
            .ready()
            .map(|rows| rows.iter().filter(|row| row.deleted_at.is_none()).count());
        let drafting = self.form.is_some();
        let reading_all = self.reading_whole_diary();
        let (label, action): (&'static str, fn(&mut Self, &mut Context<Self>)) =
            match (drafting, reading_all) {
                (true, true) => ("Torna alla bozza", Self::close_diary_reading),
                (true, false) => ("Tutto il diario", Self::read_whole_diary),
                (false, _) => ("Tutto il diario", |this, cx| {
                    this.section_selected(PatientSection::Diary, cx)
                }),
            };
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(record_title(
                "clinical-record-diary-title",
                "Ultime voci del diario",
                total.map(|total| total.to_string()),
                theme,
            ))
            .child(self.diary_list(Some(if reading_all { usize::MAX } else { BAND_ROWS }), cx))
            .when(
                reading_all || total.is_some_and(|total| total > BAND_ROWS),
                |el| {
                    el.child(
                        div().flex().child(
                            button("clinical-record-diary-all", label, theme, false, true)
                                .debug_selector(|| "clinical-record-diary-all".into())
                                .on_click(cx.listener(move |this, _, _, cx| action(this, cx))),
                        ),
                    )
                },
            )
    }

    fn reading_whole_diary(&self) -> bool {
        self.form.is_some() && self.patient.record.diary_all
    }

    pub(super) fn read_whole_diary(&mut self, cx: &mut Context<Self>) {
        self.patient.record.diary_all = true;
        cx.notify();
    }

    pub(super) fn close_diary_reading(&mut self, cx: &mut Context<Self>) {
        self.patient.record.diary_all = false;
        if self.form.is_some() {
            self.focus_after_render = true;
            self.focus_first_field = true;
        }
        cx.notify();
    }

    pub(super) fn record_quadro(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let open = self.patient.record.quadro;
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(12.))
            .bg(theme.draft)
            .border_1()
            .border_dashed()
            .border_color(theme.pencil)
            .rounded(px(theme.control_radius))
            .child(
                div()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(px(8.))
                    .child(
                        div().w_full().min_w_0().flex().flex_col().child(
                            div()
                                .type_role(theme, crate::theme::TextRole::Strong)
                                .text_color(theme.pencil)
                                .child(text!("Quadro paziente · proposta")),
                        ),
                    )
                    .child(
                        button(
                            "clinical-record-quadro",
                            if open {
                                "Chiudi il Quadro"
                            } else {
                                "Apri il Quadro e le fonti"
                            },
                            theme,
                            false,
                            true,
                        )
                        .aria_expanded(open)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.patient.record.quadro = !this.patient.record.quadro;
                            cx.notify();
                        })),
                    ),
            )
            .when(open, |el| el.child(self.patient_insight_view(cx)))
    }

    pub(super) fn record_measures(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let rows: Vec<_> = self
            .patient
            .observations
            .ready()
            .into_iter()
            .flatten()
            .filter(|row| row.deleted_at.is_none())
            .collect();
        block(theme)
            .child(record_title(
                "clinical-overview-observations",
                "Parametri recenti",
                self.patient
                    .observations
                    .ready()
                    .map(|_| rows.len().to_string()),
                theme,
            ))
            .when(
                self.patient
                    .observations
                    .state(ReadObject::Parametri)
                    .is_some(),
                |el| {
                    el.child(self.patient_read_hint(
                        "clinical-overview-observations-state",
                        &self.patient.observations,
                        ReadObject::Parametri,
                        cx,
                    ))
                },
            )
            .when(
                self.patient.observations.ready().is_some() && rows.is_empty(),
                |el| {
                    el.child(self.empty_read_state(
                        "clinical-overview-observations-empty",
                        ReadObject::Parametri,
                        cx,
                    ))
                },
            )
            .children(rows.into_iter().map(|observation| {
                row(theme)
                    .child(record_header(
                        theme,
                        div().child(text!(observation.display.clone())),
                        div()
                            .type_role(theme, crate::theme::TextRole::Strong)
                            .child(text!(crate::clinical_units::value(
                                &observation.value,
                                &observation.unit_code
                            ))),
                    ))
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(display_instant_date(&observation.observed_at))),
                    )
            }))
    }

    pub(super) fn record_documents(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let rows: Vec<_> = self
            .patient
            .attachments
            .ready()
            .into_iter()
            .flatten()
            .take(3)
            .collect();
        block(theme)
            .child(record_title(
                "clinical-record-documents",
                "Documenti recenti",
                self.patient
                    .attachments
                    .ready()
                    .map(|all| all.len().to_string()),
                theme,
            ))
            .when(
                self.patient.attachments.ready().is_some_and(Vec::is_empty),
                |el| {
                    el.child(
                        div()
                            .text_color(theme.secondary)
                            .child(text!("Nessun documento nella scheda.")),
                    )
                },
            )
            .children(rows.into_iter().map(|document| {
                let id = document.id.clone();
                row(theme)
                    .child(record_header(
                        theme,
                        div().child(text!(document.name.clone())),
                        div().child(
                            button(
                                SharedString::from(format!("clinical-record-document-read-{id}")),
                                "Apri il documento",
                                theme,
                                false,
                                true,
                            )
                            .on_click(
                                cx.listener(move |this, _, _, cx| {
                                    this.read_record_document(&id, cx)
                                }),
                            ),
                        ),
                    ))
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(display_date(document.created_at.as_deref()))),
                    )
            }))
            .child(
                div().flex().child(
                    button(
                        "clinical-record-documents-open",
                        "Apri Documenti",
                        theme,
                        false,
                        self.form.is_none(),
                    )
                    .when(self.form.is_none(), |el| {
                        el.on_click(cx.listener(|this, _, _, cx| {
                            this.section_selected(PatientSection::Documents, cx)
                        }))
                    }),
                ),
            )
    }

    pub(super) fn record_checkups(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let pending: Vec<_> = self
            .patient
            .checkups
            .ready()
            .into_iter()
            .flatten()
            .filter(|row| row.status == "pending" && row.deleted_at.is_none())
            .collect();
        block(theme)
            .child(record_title(
                "clinical-workspace-followup-heading",
                "Controlli aperti",
                self.patient
                    .checkups
                    .ready()
                    .map(|_| pending.len().to_string()),
                theme,
            ))
            .when(
                self.patient.checkups.state(ReadObject::Controlli).is_some(),
                |el| {
                    el.child(self.patient_read_hint(
                        "clinical-workspace-checkups-state",
                        &self.patient.checkups,
                        ReadObject::Controlli,
                        cx,
                    ))
                },
            )
            .when(
                self.patient.checkups.ready().is_some() && pending.is_empty(),
                |el| {
                    el.child(self.empty_read_state(
                        "clinical-workspace-checkups-empty",
                        ReadObject::Controlli,
                        cx,
                    ))
                },
            )
            .children(pending.into_iter().map(|checkup| {
                row(theme)
                    .id(SharedString::from(format!(
                        "clinical-overview-checkup-{}",
                        checkup.id
                    )))
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child({
                                let text = text!(display_instant_date(&checkup.date));
                                #[cfg(test)]
                                let text = crate::shell::rendered_command::observe_text(text);
                                text
                            }),
                    )
                    .child({
                        let text = text!(checkup.title.clone());
                        #[cfg(test)]
                        let text = crate::shell::rendered_command::observe_text(text);
                        text
                    })
            }))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        button(
                            "clinical-workspace-open-checkups",
                            "Tutti i controlli",
                            theme,
                            false,
                            self.form.is_none(),
                        )
                        .when(self.form.is_none(), |el| {
                            el.on_click(cx.listener(|this, _, _, cx| {
                                this.section_selected(PatientSection::Checkups, cx)
                            }))
                        }),
                    )
                    .child(
                        button(
                            "clinical-overview-open-loops",
                            "Follow-up aperti",
                            theme,
                            false,
                            self.form.is_none(),
                        )
                        .when(self.form.is_none(), |el| {
                            el.on_click(cx.listener(|this, _, _, cx| this.open_patient_loops(cx)))
                        }),
                    ),
            )
    }

    pub(super) fn record_context(&self, patient: &PatientDetail, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let profile_editable =
            self.form.is_none() && self.can_write(FormKind::PatientProfile) && !patient.is_archived;
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(24.))
            .child(zone_label("Contesto", theme))
            .child(self.record_quadro(cx))
            .child(self.record_measures(cx))
            .child(self.record_checkups(cx))
            .when(self.form.is_none(), |el| {
                el.child(self.record_documents(cx))
            })
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        button(
                            "clinical-workspace-edit-profile",
                            "Modifica anagrafica",
                            theme,
                            false,
                            profile_editable,
                        )
                        .when(profile_editable, |el| {
                            el.on_click(cx.listener(|this, _, _, cx| this.edit_patient_profile(cx)))
                        }),
                    )
                    .child(
                        button(
                            "clinical-workspace-current-profile",
                            "Altri dati della scheda…",
                            theme,
                            false,
                            true,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(path) = this.current_patient_path("edit") {
                                this.open_current(&path, cx);
                            }
                        })),
                    ),
            )
            .when(!patient.locked_fields.is_empty(), |el| {
                el.child(self.unreadable_field("clinical-workspace-locked-fields", cx))
            })
    }

    fn steps_view(&self, current: Step) -> Stateful<Div> {
        let theme = self.theme;
        div()
            .id("clinical-record-steps")
            .accessibility_id("clinical-record-steps")
            .role(Role::List)
            .aria_label("Passi della scrittura")
            .flex()
            .flex_wrap()
            .gap(px(6.))
            .children(
                [
                    (Step::Write, "1 · Scrivi"),
                    (Step::Review, "2 · Rivedi"),
                    (Step::Registered, "3 · Registrata"),
                ]
                .into_iter()
                .map(|(step, label)| {
                    let on = step == current;
                    div()
                        .id(label)
                        .role(Role::ListItem)
                        .aria_label(label)
                        .aria_selected(on)
                        .px(px(10.))
                        .py(px(4.))
                        .rounded(px(999.))
                        .type_role(
                            theme,
                            if on {
                                crate::theme::TextRole::Strong
                            } else {
                                crate::theme::TextRole::Meta
                            },
                        )
                        .bg(if on {
                            if step == Step::Registered {
                                theme.paper
                            } else {
                                theme.selected
                            }
                        } else {
                            theme.shade
                        })
                        .border_1()
                        .border_color(if on {
                            if step == Step::Registered {
                                theme.success
                            } else {
                                theme.fresh
                            }
                        } else {
                            theme.shade
                        })
                        .text_color(if on {
                            if step == Step::Registered {
                                theme.success
                            } else {
                                theme.fresh
                            }
                        } else {
                            theme.secondary
                        })
                        .child(text!(label))
                }),
            )
    }

    pub(super) fn record_composer(&self, cx: &Context<Self>) -> Stateful<Div> {
        let theme = self.theme;
        let form = self.form.as_ref().expect("composer needs an open form");
        let step = step_for(form.state);
        let patient = self.patient.detail.ready();
        div()
            .id("clinical-record-composer")
            .accessibility_id("clinical-record-composer")
            .debug_selector(|| "clinical-record-composer".into())
            .role(Role::Region)
            .aria_label(if step == Step::Write {
                "Bozza non registrata"
            } else {
                "Revisione prima della registrazione"
            })
            .min_w_0()
            .p(px(14.))
            .rounded(px(theme.control_radius))
            .flex()
            .flex_col()
            .gap(px(12.))
            .when(step == Step::Write, |el| {
                el.bg(theme.draft)
                    .border_1()
                    .border_dashed()
                    .border_color(theme.fresh)
            })
            .when(step == Step::Review, |el| {
                el.bg(theme.paper).border_2().border_color(theme.ink)
            })
            .child(self.steps_view(step))
            .when(step == Step::Review, |el| {
                el.child(
                    div()
                        .id("clinical-record-review-summary")
                        .accessibility_id("clinical-record-review-summary")
                        .role(Role::Group)
                        .aria_label("Che cosa verrà registrato")
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child(
                            div()
                                .type_role(theme, crate::theme::TextRole::Strong)
                                .child(text!("Che cosa verrà registrato")),
                        )
                        .children(
                            [
                                (
                                    "Paziente",
                                    patient
                                        .map(|row| {
                                            let mut facts = identity_facts(
                                                row,
                                                chrono::Local::now().date_naive(),
                                            );
                                            facts.retain(|fact| {
                                                !fact.starts_with("Nascita")
                                                    && !fact.ends_with("anni")
                                            });
                                            format!(
                                                "{}{}",
                                                crate::title::TitleText::name(row.display_name())
                                                    .text(),
                                                facts
                                                    .first()
                                                    .map(|fact| format!(" · {fact}"))
                                                    .unwrap_or_default()
                                            )
                                        })
                                        .unwrap_or_default(),
                                ),
                                (
                                    "Oggetto",
                                    form.edit
                                        .as_ref()
                                        .map_or(form.kind.title(), editing::Record::title)
                                        .to_owned(),
                                ),
                            ]
                            .into_iter()
                            .map(|(term, value)| {
                                div()
                                    .flex()
                                    .gap(px(12.))
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .child(
                                        div()
                                            .w(px(72.))
                                            .flex_none()
                                            .text_color(theme.secondary)
                                            .child(text!(term)),
                                    )
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_w_0()
                                            .text_color(theme.ink)
                                            .child(text!(value)),
                                    )
                            }),
                        ),
                )
            })
            .child(self.form_body(step == Step::Review, cx))
    }

    pub(super) fn record_registered_step(&self) -> Option<Div> {
        let theme = self.theme;
        if self.form.is_some() || self.verified.is_none() {
            return None;
        }
        let (kind, at) = self.patient.record.registered.as_ref()?;
        let reread = (*kind == FormKind::Notes)
            .then(|| {
                self.patient
                    .detail
                    .ready()
                    .and_then(|row| row.notes.clone())
            })
            .flatten();
        Some(
            div()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(self.steps_view(Step::Registered))
                .child(
                    div()
                        .id("clinical-record-registered")
                        .accessibility_id("clinical-record-registered")
                        .role(Role::Status)
                        .aria_label(SharedString::from(format!(
                            "Registrata alle {at}. Testo riletto dalla scheda."
                        )))
                        .p(px(10.))
                        .rounded(px(theme.control_radius))
                        .border_1()
                        .border_color(theme.success)
                        .type_role(theme, crate::theme::TextRole::Strong)
                        .text_color(theme.success)
                        .child(text!(format!(
                            "Registrata alle {at}. Testo riletto dalla scheda."
                        ))),
                )
                .when_some(reread, |el, notes| {
                    el.child(
                        div()
                            .id("clinical-record-registered-text")
                            .type_role(theme, crate::theme::TextRole::Prose)
                            .child(clinical_text::render(&notes, WritingInk::Dry, theme)),
                    )
                }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use serde_json::json;

    fn patient(value: serde_json::Value) -> PatientDetail {
        let mut base =
            json!({"id":"p","firstName":"Bianca","lastName":"Ferraldi","taxCode":"","version":1});
        base.as_object_mut()
            .unwrap()
            .extend(value.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn identity_names_the_identifier_or_its_absence_and_keeps_estimated_age() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 18).unwrap();
        let with_cf = patient(
            json!({"taxCode":"FRRBNC47H52Z000K","identifierType":"cf","birthDate":"1947-06-12"}),
        );
        assert_eq!(
            identity_facts(&with_cf, today),
            ["79 anni", "Nascita 12/06/1947", "CF FRRBNC47H52Z000K"]
        );
        let without = patient(
            json!({"identifierType":"none","birthDatePrecision":"estimated","birthYear":1950}),
        );
        assert_eq!(
            identity_facts(&without, today),
            [
                "circa 76 anni",
                "Nascita 1950, stimato",
                "Nessun identificativo per ora"
            ]
        );
        let unknown = patient(json!({}));
        assert_eq!(
            identity_facts(&unknown, today)[1],
            "Nessun identificativo per ora"
        );
    }

    #[gpui::test]
    fn a_report_alone_after_the_visit_keeps_the_command_that_shows_it(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let visit: Entry = serde_json::from_value(json!({"id":"v","patientId":"p","type":"visit",
            "title":"Visita","date":"2026-11-04","content":"c","version":1,"createdAt":"2026-11-04T09:00:00Z"}))
        .unwrap();
        let report: Attachment = serde_json::from_value(json!({"id":"d","patientId":"p",
            "name":"Referto sintetico.pdf","path":"r.pdf","type":"application/pdf","size":4,
            "createdAt":"2026-11-10T09:00:00Z"}))
        .unwrap();
        let buttons = |view: &Entity<ClinicalApp>, cx: &mut gpui::VisualTestContext| {
            view.update(cx, |app, cx| {
                rendered_command::button_ids(|| {
                    let _ = app.record_band(cx);
                })
            })
        };
        view.update(cx, |app, _| {
            app.selected_id = Some("p".into());
            app.patient.entries = ReadLoad::Ready(vec![visit.clone()]);
            app.patient.therapies = ReadLoad::Ready(vec![]);
            app.patient.observations = ReadLoad::Ready(vec![]);
            app.patient.attachments = ReadLoad::Ready(vec![report.clone()]);
            app.patient.record.fix_anchor(&[visit]);
        });
        let shown = buttons(&view, cx);
        assert!(
            shown
                .iter()
                .any(|id| id == "clinical-record-band-documents"),
            "the only news is a report: {shown:?}"
        );
        view.update(cx, |app, _| {
            app.patient.record.documents = true;
            app.patient.record.open = Some("document-d".into());
        });
        assert!(
            buttons(&view, cx)
                .iter()
                .any(|id| id == "clinical-record-open-document-d")
        );
        view.update(cx, |app, _| {
            app.patient.record.documents = false;
            app.patient.attachments = ReadLoad::Ready(vec![]);
        });
        assert!(
            !buttons(&view, cx)
                .iter()
                .any(|id| id == "clinical-record-band-documents"),
            "nothing new: no command"
        );
    }

    fn opened_at_1180<'a>(
        host: &notes_recovery_tests::Host,
        cx: &'a mut gpui::TestAppContext,
    ) -> (Entity<ClinicalApp>, &'a mut gpui::VisualTestContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.simulate_resize(gpui::size(px(1180.), px(660.)));
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.select_patient("patient-a", true, cx);
        });
        cx.run_until_parked();
        view.update(cx, |app, _| {
            app.patient.therapies = ReadLoad::Ready(
                (0..7)
                    .map(|index| {
                        serde_json::from_value(json!({"id":format!("t{index}"),"patientId":"patient-a",
                            "drugName":format!("Farmaco sintetico {index} 25 mg cpr"),"dosage":"1 cp al mattino",
                            "status":"active","startDate":"2026-01-01","version":1}))
                        .unwrap()
                    })
                    .collect(),
            );
            app.patient.attachments = ReadLoad::Ready(
                (0..6)
                    .map(|index| {
                        serde_json::from_value(json!({"id":format!("d{index}"),"patientId":"patient-a",
                            "name":format!("Referto sintetico {index}.pdf"),"path":"r.pdf","type":"application/pdf","size":4}))
                        .unwrap()
                    })
                    .collect(),
            );
        });
        notes_recovery_tests::draw(cx);
        (view, cx)
    }

    #[gpui::test]
    fn pressing_modifica_after_scrolling_the_side_column_shows_and_focuses_the_field(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let (view, cx) = opened_at_1180(&host, cx);
        let side = cx
            .debug_bounds("clinical-record-side")
            .expect("two zones at 1180");
        let start = cx.debug_bounds("clinical-workspace-edit-notes").unwrap();
        assert!(
            start.top() > side.bottom(),
            "Modifica starts below the fold: {start:?}"
        );
        let mut edit = start;
        for _ in 0..40 {
            if edit.top() > side.top() + px(20.) && edit.bottom() < side.bottom() - px(20.) {
                break;
            }
            cx.simulate_event(gpui::ScrollWheelEvent {
                position: side.center(),
                delta: gpui::ScrollDelta::Pixels(gpui::point(px(0.), px(-60.))),
                ..Default::default()
            });
            notes_recovery_tests::draw(cx);
            edit = cx.debug_bounds("clinical-workspace-edit-notes").unwrap();
        }
        assert!(
            edit.top() > side.top() && edit.bottom() < side.bottom(),
            "{edit:?} in {side:?}"
        );
        cx.simulate_click(edit.center(), gpui::Modifiers::default());
        notes_recovery_tests::draw(cx);
        let composer = cx
            .debug_bounds("clinical-record-composer")
            .expect("composer drawn");
        let side = cx.debug_bounds("clinical-record-side").unwrap();
        assert!(
            composer.top() >= side.top() && composer.top() < side.bottom() - px(120.),
            "the composer opens in view: {composer:?} in {side:?}"
        );
        cx.update_window_entity(&view, |app, window, cx| {
            let editor = app.form.as_ref().expect("notes open").fields[0]
                .editor
                .clone();
            assert!(gpui::Focusable::focus_handle(editor.read(cx), cx).is_focused(window));
        });
        view.update(cx, |app, cx| app.disconnect(cx));
    }

    fn click_in_view(cx: &mut gpui::VisualTestContext, zone: &'static str, target: &'static str) {
        let area = cx.debug_bounds(zone).unwrap();
        for _ in 0..80 {
            let bounds = cx.debug_bounds(target).unwrap();
            if bounds.top() >= area.top() && bounds.bottom() <= area.bottom() + px(1.) {
                cx.simulate_click(bounds.center(), gpui::Modifiers::default());
                notes_recovery_tests::draw(cx);
                return;
            }
            let down = bounds.top() > area.top();
            cx.simulate_event(gpui::ScrollWheelEvent {
                position: area.center(),
                delta: gpui::ScrollDelta::Pixels(gpui::point(
                    px(0.),
                    px(if down { -60. } else { 60. }),
                )),
                ..Default::default()
            });
            notes_recovery_tests::draw(cx);
        }
        panic!(
            "{target} never came into view in {zone}: {:?} in {area:?}",
            cx.debug_bounds(target)
        );
    }

    #[gpui::test]
    fn the_sixth_diary_entry_is_readable_while_drafting_and_the_draft_comes_back(
        cx: &mut gpui::TestAppContext,
    ) {
        use gpui::EntityInputHandler;
        let host = notes_recovery_tests::Host::new();
        let (view, cx) = opened_at_1180(&host, cx);
        view.update(cx, |app, _| {
            app.patient.entries = ReadLoad::Ready(
                (0..6)
                    .map(|index| {
                        serde_json::from_value(json!({"id":format!("e{index}"),"patientId":"patient-a",
                            "type":"remote","title":format!("Contatto sintetico {index}"),
                            "date":format!("2026-11-{:02}T09:00:00Z", 12 - index),
                            "content":format!("Testo sintetico del contatto {index}."),"version":1}))
                        .unwrap()
                    })
                    .collect(),
            );
        });
        notes_recovery_tests::draw(cx);
        click_in_view(cx, "clinical-record-side", "clinical-workspace-edit-notes");
        cx.simulate_input(" Rivalutare.");
        cx.run_until_parked();
        let caret = |view: &Entity<ClinicalApp>, cx: &mut gpui::VisualTestContext| {
            cx.update_window_entity(view, |app, window, cx| {
                let editor = app.form.as_ref().unwrap().fields[0].editor.clone();
                let focused = gpui::Focusable::focus_handle(editor.read(cx), cx).is_focused(window);
                editor.update(cx, |input, cx| {
                    (
                        input
                            .selected_text_range(false, window, cx)
                            .unwrap()
                            .range
                            .end,
                        input.value().to_owned(),
                        focused,
                    )
                })
            })
        };
        let typed = caret(&view, cx);
        assert!(
            typed.2 && typed.1 == " Rivalutare.A: note iniziali",
            "{typed:?}"
        );
        assert!(cx.debug_bounds("clinical-workspace-entry-e5").is_none());
        let before = host.routes().len();
        click_in_view(cx, "clinical-record-changed", "clinical-record-diary-all");
        assert!(
            cx.debug_bounds("clinical-workspace-entry-e5").is_some(),
            "the sixth entry is listed while drafting"
        );
        view.read_with(cx, |app, _| {
            assert!(app.form.is_some());
            assert!(
                !app.can_edit_record(editing::Kind::Entry),
                "no concurrent write"
            );
        });
        click_in_view(cx, "clinical-record-changed", "clinical-record-diary-all");
        assert!(cx.debug_bounds("clinical-workspace-entry-e5").is_none());
        assert_eq!(caret(&view, cx), typed, "text, caret and focus come back");
        assert!(
            host.routes()[before..]
                .iter()
                .all(|route| route.starts_with("GET ")),
            "reading writes nothing"
        );
        view.update(cx, |app, cx| app.disconnect(cx));
    }

    #[test]
    fn the_draft_point_shows_the_line_around_the_caret_and_the_selection() {
        let value = "Prima riga.\nIniziata il bisoprololo alla dose di  e da rivalutare.\nTerza.";
        let caret = value.find("di  e").unwrap() + 3;
        let point = DraftPoint::of(value, caret..caret);
        assert_eq!(
            point.text,
            "Iniziata il bisoprololo alla dose di ▏ e da rivalutare."
        );
        assert_eq!(&point.text[point.caret.clone()], "▏");
        assert!(point.selected.is_empty());
        let word = value.find("rivalutare").unwrap();
        let point = DraftPoint::of(value, word..word + "rivalutare".len());
        assert_eq!(&point.text[point.selected.clone()], "rivalutare");
        assert_eq!(&point.text[point.caret.clone()], "▏");
        let long = format!("{}è{}", "à".repeat(400), "ù".repeat(400));
        let at = long.find('è').unwrap();
        let point = DraftPoint::of(&long, at..at);
        assert!(point.text.starts_with('…') && point.text.ends_with('…'));
        assert_eq!(
            point.text.chars().filter(|c| *c == 'à').count(),
            POINT_BEFORE
        );
        assert_eq!(
            point.text.chars().filter(|c| *c == 'ù').count(),
            POINT_AFTER - 1
        );
        let inside_a_character = "aè".len() - 1;
        assert_eq!(
            DraftPoint::of("aè", inside_a_character..inside_a_character).text,
            "a▏è"
        );
    }

    #[gpui::test]
    fn a_report_opened_from_the_draft_takes_the_width_and_the_strip_brings_the_draft_back(
        cx: &mut gpui::TestAppContext,
    ) {
        use base64::Engine;
        use gpui::EntityInputHandler;
        let host = notes_recovery_tests::Host::new();
        let (view, cx) = opened_at_1180(&host, cx);
        cx.update(|_, cx| {
            bind_keys(cx);
            crate::text_input::bind_keys(cx);
        });
        let report = "Bisoprololo: alla dimissione 1,25 mg al mattino.";
        view.update(cx, |app, _| {
            app.patient.attachments = ReadLoad::Ready(vec![
                serde_json::from_value(json!({
                "id":"r","patientId":"patient-a","name":"Lettera sintetica.txt","path":"l.txt",
                "type":"text/plain","size":report.len()}))
                .unwrap(),
            ]);
        });
        click_in_view(cx, "clinical-record-side", "clinical-workspace-edit-notes");
        cx.simulate_input("Iniziato il bisoprololo alla dose di  e da rivalutare.");
        let state = |view: &Entity<ClinicalApp>, cx: &mut gpui::VisualTestContext| {
            cx.update_window_entity(view, |app, window, cx| {
                let editor = app.form.as_ref().unwrap().fields[0].editor.clone();
                let focused = gpui::Focusable::focus_handle(editor.read(cx), cx).is_focused(window);
                editor.update(cx, |input, cx| {
                    (
                        input.selected_text_range(false, window, cx).unwrap().range,
                        input.value().to_owned(),
                        focused,
                    )
                })
            })
        };
        let word = cx.update_window_entity(&view, |app, window, cx| {
            let editor = app.form.as_ref().unwrap().fields[0].editor.clone();
            editor.update(cx, |input, cx| {
                let value = input.value().to_owned();
                let start = value.encode_utf16().count()
                    - " e da rivalutare.A: note iniziali".encode_utf16().count();
                input.set_selected_text_range(start..start + 1, window, cx);
                start..start + 1
            })
        });
        let before = state(&view, cx);
        assert_eq!(before.0, word);
        assert!(before.2);
        let routes = host.routes().len();
        host.plan("GET /api/v1/network/patients/patient-a/attachments/r")
            .send((200, json!({"id":"r","patientId":"patient-a","name":"Lettera sintetica.txt","path":"l.txt",
                "type":"text/plain","size":report.len(),
                "data":format!("data:text/plain;base64,{}", base64::engine::general_purpose::STANDARD.encode(report))})))
            .unwrap();
        view.update(cx, |app, cx| app.read_record_document("r", cx));
        cx.run_until_parked();
        notes_recovery_tests::draw(cx);
        assert!(cx.debug_bounds("clinical-record-composer").is_none());
        assert!(cx.debug_bounds("clinical-record-side").is_none());
        let sheet = cx.debug_bounds("clinical-record-reading-sheet").unwrap();
        let strip = cx.debug_bounds("clinical-record-draft-point").unwrap();
        let bar = cx.debug_bounds("threshold-bar").unwrap();
        assert!(
            sheet.size.width > px(800.),
            "the report takes the width: {sheet:?}"
        );
        assert!(
            bar.contains(&strip.center()),
            "the note point sits in the draft bar"
        );
        assert!(strip.top() >= sheet.top(), "under the report");
        view.update(cx, |app, cx| {
            let editor = app.form.as_ref().unwrap().fields[0].editor.read(cx);
            let point = DraftPoint::of(editor.value(), editor.selection());
            assert!(
                point.text.contains("alla dose di  ▏e da rivalutare."),
                "{}",
                point.text
            );
            let _ = cx;
        });
        view.update(cx, |app, _| {
            app.profile_scroll
                .set_offset(gpui::point(px(0.), px(-400.)))
        });
        notes_recovery_tests::draw(cx);
        let strip = cx.debug_bounds("clinical-record-draft-point").unwrap();
        cx.simulate_click(strip.center(), gpui::Modifiers::default());
        notes_recovery_tests::draw(cx);
        assert_eq!(
            view.read_with(cx, |app, _| app.profile_scroll.offset().y),
            px(0.),
            "the identity header is back in view"
        );
        assert!(cx.debug_bounds("clinical-record-draft-point").is_none());
        assert!(cx.debug_bounds("clinical-record-composer").is_some());
        assert_eq!(state(&view, cx), before, "selection, caret, text and focus");
        cx.simulate_input("1,25 mg ");
        let typed = state(&view, cx);
        assert!(
            typed.1.contains("alla dose di 1,25 mg e da rivalutare."),
            "{}",
            typed.1
        );
        for _ in "1,25 mg ".chars() {
            cx.simulate_keystrokes("secondary-z");
        }
        assert_eq!(
            state(&view, cx).1,
            before.1,
            "undo goes back to the text before"
        );
        cx.simulate_keystrokes("secondary-z");
        assert_eq!(
            state(&view, cx).1,
            before.1.replacen("rivalutare.", "rivalutare", 1),
            "the history from before the report is still there"
        );
        for _ in 0..9 {
            cx.simulate_keystrokes("secondary-shift-z");
        }
        assert_eq!(state(&view, cx).1, typed.1);
        let consulted = &host.routes()[routes..];
        assert!(
            consulted.iter().all(|route| route.starts_with("GET ")),
            "{consulted:?}"
        );
        cx.update_window_entity(&view, |app, window, cx| app.review_form(window, cx));
        notes_recovery_tests::draw(cx);
        let before_confirm = host.routes().len();
        view.update(cx, |app, cx| app.confirm_form(cx));
        cx.run_until_parked();
        assert_eq!(
            host.routes()[before_confirm..]
                .iter()
                .filter(|route| !route.starts_with("GET ") && !route.ends_with("/profile-query"))
                .collect::<Vec<_>>(),
            ["PUT /api/v1/network/patients/patient-a"]
        );
        view.update(cx, |app, cx| app.disconnect(cx));
    }

    #[test]
    fn zones_follow_the_window_classes() {
        assert_eq!(Zones::for_width(1440.), Zones::Three);
        assert_eq!(Zones::for_width(1280.), Zones::Three);
        assert_eq!(Zones::for_width(1180.), Zones::Two);
        assert_eq!(Zones::for_width(1000.), Zones::Two);
        assert_eq!(Zones::for_width(999.), Zones::One);
    }

    #[test]
    fn every_unsettled_write_stays_on_the_review_step() {
        assert_eq!(step_for(FormState::Draft), Step::Write);
        for state in [
            FormState::Review,
            FormState::Saving,
            FormState::Conflict,
            FormState::Uncertain,
            FormState::Rejected,
        ] {
            assert_eq!(step_for(state), Step::Review);
        }
    }
}
