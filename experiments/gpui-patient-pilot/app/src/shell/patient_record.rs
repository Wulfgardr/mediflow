use super::record_changes::{BAND_ROWS, Change, ChangeKind, ChangeSource, VisitAnchor};
use gpui::{AnyElement, Hsla};
#[cfg(test)]
macro_rules! text {
    ($($args:tt)*) => { crate::shell::rendered_command::observe_ink(gpui::text!($($args)*)) };
}
use super::*;

pub(super) const READING_INSET: f32 = 12.;
const QUIET_CHROME: f32 = 221.;
const WRITING_CHROME: f32 = 286.;
pub(super) const TRAY_INSET: f32 = 10.;
const ISLAND_RADIUS: f32 = 14.;
const ZONE_GAP: f32 = 12.;

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
    pub(super) menu: bool,
    pub(super) more: Option<String>,
    pub(super) stable_column: gpui::ScrollHandle,
    pub(super) changed_column: gpui::ScrollHandle,
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
    record_heading(
        id,
        label,
        count,
        theme,
        crate::theme::TitleRole::SectionTitle,
    )
}

fn record_heading(
    id: impl Into<SharedString>,
    label: &str,
    count: Option<String>,
    theme: Theme,
    role: crate::theme::TitleRole,
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
                .child(crate::title::title(label.to_owned(), theme).with_role(role)),
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

fn zone_label(id: &'static str, label: &'static str, changed: bool, theme: Theme) -> Stateful<Div> {
    let color = if changed {
        theme.fresh
    } else {
        theme.secondary
    };
    div()
        .id(id)
        .accessibility_id(id)
        .min_w_0()
        .px(px(4.))
        .flex()
        .items_center()
        .gap(px(8.))
        .role(Role::Heading)
        .aria_label(label)
        .type_role(theme, crate::theme::TextRole::Meta)
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .text_color(color)
        .child(div().size(px(6.)).flex_none().rounded_full().bg(color))
        .child(text!(label))
}

fn zone_title(id: &'static str, label: &'static str, changed: bool, theme: Theme) -> Stateful<Div> {
    div()
        .id(id)
        .accessibility_id(id)
        .min_w_0()
        .px(px(8.))
        .pt(px(8.))
        .pb(px(2.))
        .flex()
        .items_center()
        .gap(px(8.))
        .role(Role::Heading)
        .aria_label(label)
        .text_color(theme.ink)
        .child(crate::title::title(label, theme).with_role(crate::theme::TitleRole::RecordZone))
        .when(changed, |el| {
            el.child(
                div()
                    .size(px(8.))
                    .flex_none()
                    .rounded_full()
                    .bg(theme.fresh),
            )
        })
}

fn tray(theme: Theme) -> Div {
    block(theme)
        .gap(px(TRAY_INSET))
        .p(px(TRAY_INSET))
        .bg(theme.record.tray)
        .border_1()
        .border_color(theme.record.tray_rule)
        .rounded_t(px(ISLAND_RADIUS + TRAY_INSET))
        .rounded_b(px(ISLAND_RADIUS - 4.))
        .shadow(vec![
            gpui::BoxShadow::new(px(0.), px(1.), theme.record.tray_light).inset(),
            gpui::BoxShadow::new(px(0.), px(-1.), theme.record.tray_shadow)
                .blur_radius(px(2.))
                .inset(),
        ])
}

fn island(theme: Theme, compact: bool) -> Div {
    block(theme)
        .gap(px(10.))
        .p(px(16.))
        .bg(if compact {
            theme.record.compact_island
        } else {
            theme.record.island
        })
        .border_1()
        .border_color(theme.record.island_rule)
        .rounded(px(ISLAND_RADIUS))
}

fn island_title(
    id: &'static str,
    label: &str,
    count: Option<String>,
    theme: Theme,
) -> Stateful<Div> {
    record_heading(
        id,
        label,
        count,
        theme,
        crate::theme::TitleRole::RecordIsland,
    )
}

fn glyph(kind: Icon, tint: Option<Hsla>, theme: Theme) -> Div {
    div()
        .size(px(28.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(8.))
        .bg(tint.map_or(theme.paper, |color| Theme::tint(color, 0.12)))
        .border_1()
        .border_color(tint.map_or(theme.rule, |color| Theme::tint(color, 0.35)))
        .child(icon(kind, tint.unwrap_or(theme.secondary), 15.))
}

fn card_title(
    id: &'static str,
    kind: Icon,
    label: &str,
    count: Option<String>,
    action: Option<Stateful<Div>>,
    theme: Theme,
) -> Div {
    div()
        .min_w_0()
        .flex()
        .items_center()
        .gap(px(10.))
        .child(glyph(kind, None, theme))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .child(island_title(id, label, count, theme).justify_start()),
        )
        .children(action)
}

fn link(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    theme: Theme,
) -> Stateful<Div> {
    link_enabled(id, label, theme, true)
}

fn link_enabled(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    theme: Theme,
    enabled: bool,
) -> Stateful<Div> {
    let label = label.into();
    let id = id.into();
    let selector = id.to_string();
    button(id, label, theme, false, enabled)
        .debug_selector(move || selector.clone())
        .flex_none()
        .min_h(px(28.))
        .px(px(6.))
        .py(px(2.))
        .border_color(gpui::transparent_black())
        .bg(gpui::transparent_black())
        .text_color(if enabled {
            theme.fresh
        } else {
            theme.secondary
        })
        .type_role(theme, crate::theme::TextRole::Meta)
        .font_weight(gpui::FontWeight::SEMIBOLD)
}

fn tag(text: impl Into<SharedString>, color: Hsla, theme: Theme) -> Div {
    div()
        .flex_none()
        .px(px(8.))
        .py(px(1.))
        .rounded(px(6.))
        .bg(theme.sheet.blend(Theme::tint(color, 0.14)))
        .text_color(color)
        .type_role(theme, crate::theme::TextRole::Meta)
        .font_weight(gpui::FontWeight::MEDIUM)
        .child(text!(text.into()))
}

fn given_name_first(patient: &PatientDetail) -> mediflow_patient_client::PersonName {
    let name = [patient.first_name.trim(), patient.last_name.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if name.is_empty() {
        patient.display_name()
    } else {
        name.into()
    }
}

pub(super) fn exemption_codes(value: &str) -> Option<String> {
    let value = value.trim();
    let codes = match serde_json::from_str::<serde_json::Value>(value) {
        Ok(serde_json::Value::Array(rows)) => rows
            .iter()
            .filter_map(|row| {
                row.as_str()
                    .or_else(|| row.get("code").and_then(serde_json::Value::as_str))
                    .map(str::trim)
                    .filter(|code| !code.is_empty())
                    .map(str::to_owned)
            })
            .collect::<Vec<_>>()
            .join(", "),
        _ => value.to_owned(),
    };
    (!codes.is_empty()).then_some(codes)
}

pub(super) fn diagnosis_dates(value: Option<&str>) -> Vec<Option<String>> {
    value
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .and_then(|rows| rows.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .map(|row| {
            row.get("date")
                .and_then(serde_json::Value::as_str)
                .filter(|date| date.len() >= 10)
                .map(|date| format!("Registrata il {}", display_date(Some(date))))
        })
        .collect()
}

fn drug_parts(name: &str) -> (String, String) {
    let words: Vec<&str> = name.split_whitespace().collect();
    let split = words
        .iter()
        .position(|word| word.starts_with(|c: char| c.is_ascii_digit()))
        .filter(|at| *at > 0)
        .unwrap_or(words.len());
    (words[..split].join(" "), words[split..].join(" "))
}

fn named_with_dose(name: &str, theme: Theme) -> Div {
    let (principle, dose) = drug_parts(name);
    div()
        .min_w_0()
        .flex()
        .flex_wrap()
        .items_baseline()
        .gap_x(px(6.))
        .child(
            div()
                .type_role(theme, crate::theme::TextRole::RecordRow)
                .child({
                    let text = text!(principle);
                    #[cfg(test)]
                    let text = crate::shell::rendered_command::observe_text(text);
                    text
                }),
        )
        .when(!dose.is_empty(), |el| {
            el.child(
                div()
                    .type_role(theme, crate::theme::TextRole::Body)
                    .text_color(theme.secondary)
                    .child(text!(dose)),
            )
        })
}

const MONTHS: [&str; 12] = [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
];

fn spoken_day(day: &str) -> String {
    chrono::NaiveDate::parse_from_str(day, "%d/%m/%Y").map_or_else(
        |_| day.to_owned(),
        |date| {
            use chrono::Datelike;
            format!("{} {}", date.day(), MONTHS[date.month0() as usize])
        },
    )
}

fn sparkline(values: Vec<f64>, color: Hsla) -> impl IntoElement {
    gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            if values.len() < 2 {
                return;
            }
            let low = values.iter().copied().fold(f64::INFINITY, f64::min);
            let high = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            let span = (high - low).max(f64::EPSILON);
            let width = f32::from(bounds.size.width);
            let height = f32::from(bounds.size.height) - 4.;
            let step = width / (values.len() - 1) as f32;
            let mut path = gpui::PathBuilder::stroke(px(1.5));
            for (index, value) in values.iter().enumerate() {
                let point = gpui::point(
                    bounds.origin.x + px(step * index as f32),
                    bounds.origin.y + px(2. + height * (1. - ((value - low) / span) as f32)),
                );
                if index == 0 {
                    path.move_to(point);
                } else {
                    path.line_to(point);
                }
            }
            if let Ok(path) = path.build() {
                window.paint_path(path, color);
            }
        },
    )
    .w(px(64.))
    .h(px(20.))
    .flex_none()
}

fn block(theme: Theme) -> Div {
    let _ = theme;
    div().min_w_0().max_w_full().flex().flex_col().gap(px(8.))
}

fn row(theme: Theme) -> Div {
    div()
        .min_w_0()
        .max_w_full()
        .py(px(6.))
        .flex()
        .flex_col()
        .gap(px(2.))
        .when(false, |el| el.border_color(theme.rule))
}

impl ClinicalApp {
    fn record_return(&self) -> Option<String> {
        let anchor = self.patient.record.anchor.as_ref()?;
        Some(match anchor {
            None => "Primo accesso".into(),
            Some(anchor) => {
                let days = (chrono::Local::now().date_naive()
                    - anchor.at.with_timezone(&chrono::Local).date_naive())
                .num_days();
                match days {
                    ..=0 => "Ultima visita oggi".into(),
                    1 => "Ritorno dopo 1 giorno".into(),
                    days => format!("Ritorno dopo {days} giorni"),
                }
            }
        })
    }

    pub(super) fn record_header(
        &self,
        patient: &PatientDetail,
        layout: Layout,
        cx: &Context<Self>,
    ) -> Div {
        let theme = self.theme;
        let writable = !patient.is_archived && patient.deleted_at.is_none() && self.form.is_none();
        let profile_editable =
            self.form.is_none() && self.can_write(FormKind::PatientProfile) && !patient.is_archived;
        let mut facts = identity_facts(patient, chrono::Local::now().date_naive());
        let adi = patient.is_adi;
        let archived = patient.is_archived;
        facts.retain(|fact| fact != "ADI" && fact != "Scheda archiviata");
        if let Some(exemptions) = patient
            .exemptions
            .as_deref()
            .filter(|_| !patient.field_locked("exemptions"))
            .and_then(exemption_codes)
        {
            facts.push(format!("Esenzioni {exemptions}"));
        }
        let menu = self.patient.record.menu && self.form.is_none();
        let menu_item = |id: &'static str, label: &'static str, enabled: bool| {
            button(id, label, theme, false, enabled)
                .w_full()
                .justify_start()
                .min_h(px(34.))
                .border_color(gpui::transparent_black())
                .bg(gpui::transparent_black())
                .type_role(theme, crate::theme::TextRole::Body)
        };
        div()
            .flex_shrink_0()
            .px(px(layout.margin))
            .pt(px(16.))
            .pb(px(14.))
            .flex()
            .flex_col()
            .gap(px(0.))
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
                            .when(layout.magnified, |el| el.w_full())
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(px(2.))
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(
                                        button(
                                            "clinical-workspace-back-directory",
                                            self.patient_back_label(),
                                            theme,
                                            false,
                                            self.form.is_none(),
                                        )
                                        .debug_selector(|| {
                                            "clinical-workspace-back-directory".into()
                                        })
                                        .min_h(px(18.))
                                        .px(px(2.))
                                        .py(px(0.))
                                        .border_color(gpui::transparent_black())
                                        .bg(gpui::transparent_black())
                                        .type_role(theme, crate::theme::TextRole::Meta)
                                        .text_color(theme.secondary)
                                        .when(
                                            self.form.is_none(),
                                            |el| {
                                                el.on_click(cx.listener(|this, _, _, cx| {
                                                    this.back_from_patient(cx)
                                                }))
                                            },
                                        ),
                                    )
                                    .children(
                                        self.record_return()
                                            .map(|line| div().child(text!(format!("· {line}")))),
                                    ),
                            )
                            .child(crate::components::heading_with_role(
                                "clinical-workspace-patient-name",
                                crate::title::TitleText::name(given_name_first(patient)),
                                theme,
                                crate::theme::TitleRole::RecordPerson,
                            ))
                            .child(
                                div()
                                    .id("clinical-workspace-patient-identity")
                                    .accessibility_id("clinical-workspace-patient-identity")
                                    .role(Role::Note)
                                    .aria_label(SharedString::from(facts.join(", ")))
                                    .debug_selector(|| "clinical-workspace-patient-birth".into())
                                    .min_w_0()
                                    .type_role(theme, crate::theme::TextRole::Body)
                                    .text_color(theme.secondary)
                                    .whitespace_normal()
                                    .child(text!(facts.join("  ·  "))),
                            )
                            .child(
                                div()
                                    .pt(px(6.))
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(px(6.))
                                    .child(
                                        div()
                                            .id("clinical-workspace-allergies")
                                            .accessibility_id("clinical-workspace-allergies")
                                            .role(Role::Note)
                                            .px(px(8.))
                                            .py(px(1.))
                                            .rounded(px(6.))
                                            .border_1()
                                            .border_color(theme.rule)
                                            .child(allergy_label(None, theme)),
                                    )
                                    .when(adi, |el| {
                                        el.child(tag("ADI attiva", theme.success, theme))
                                    })
                                    .when(archived, |el| {
                                        el.child(tag("Scheda archiviata", theme.secondary, theme))
                                    }),
                            ),
                    )
                    .child(
                        div()
                            .relative()
                            .flex()
                            .flex_wrap()
                            .justify_end()
                            .items_center()
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
                                .min_h(px(36.))
                                .on_click(cx.listener(|this, _, _, cx| this.close_clean_notes(cx))),
                                None => {
                                    let enabled = writable && self.can_write(FormKind::Entry);
                                    button("clinical-workspace-new-entry", "", theme, true, enabled)
                                        .aria_label("Nuova voce")
                                        .min_h(px(36.))
                                        .gap(px(6.))
                                        .child(icon(
                                            Icon::Plus,
                                            if enabled {
                                                theme.paper
                                            } else {
                                                theme.secondary
                                            },
                                            15.,
                                        ))
                                        .child(text!("Nuova voce"))
                                        .when(enabled, |el| {
                                            el.on_click(cx.listener(|this, _, window, cx| {
                                                this.patient.record.menu = false;
                                                this.open_form(FormKind::Entry, window, cx)
                                            }))
                                        })
                                }
                            })
                            .child(
                                button(
                                    "clinical-workspace-record-menu",
                                    "",
                                    theme,
                                    false,
                                    self.form.is_none(),
                                )
                                .debug_selector(|| "clinical-workspace-record-menu".into())
                                .aria_label("Altre azioni della scheda")
                                .aria_expanded(menu)
                                .min_h(px(36.))
                                .size(px(36.))
                                .px(px(0.))
                                .py(px(0.))
                                .child(icon(Icon::Ellipsis, theme.ink, 16.))
                                .when(self.form.is_none(), |el| {
                                    el.on_click(cx.listener(|this, _, _, cx| {
                                        this.patient.record.menu = !this.patient.record.menu;
                                        cx.notify();
                                    }))
                                }),
                            )
                            .when(menu, |el| {
                                el.child(gpui::deferred(
                                    div()
                                        .id("clinical-workspace-record-menu-list")
                                        .accessibility_id("clinical-workspace-record-menu-list")
                                        .role(Role::Menu)
                                        .aria_label("Altre azioni della scheda")
                                        .occlude()
                                        .absolute()
                                        .top(px(44.))
                                        .right(px(0.))
                                        .w(px(240.))
                                        .p(px(6.))
                                        .flex()
                                        .flex_col()
                                        .bg(theme.paper)
                                        .border_1()
                                        .border_color(theme.rule)
                                        .rounded(px(14.))
                                        .shadow(vec![
                                            gpui::BoxShadow::new(
                                                px(0.),
                                                px(8.),
                                                Theme::tint(theme.ink, 0.14),
                                            )
                                            .blur_radius(px(24.)),
                                        ])
                                        .child(
                                            menu_item(
                                                "clinical-workspace-refresh",
                                                "Rileggi",
                                                true,
                                            )
                                            .on_click(
                                                cx.listener(|this, _, _, cx| {
                                                    this.patient.record.menu = false;
                                                    this.request_discard(Discard::Reload, cx)
                                                }),
                                            ),
                                        )
                                        .child(
                                            menu_item(
                                                "clinical-workspace-copy-profile",
                                                "Copia scheda",
                                                true,
                                            )
                                            .on_click(
                                                cx.listener(|this, _, _, cx| {
                                                    this.patient.record.menu = false;
                                                    this.copy_profile(cx)
                                                }),
                                            ),
                                        )
                                        .child(
                                            menu_item(
                                                "clinical-workspace-edit-profile",
                                                "Modifica anagrafica",
                                                profile_editable,
                                            )
                                            .when(
                                                profile_editable,
                                                |el| {
                                                    el.on_click(cx.listener(|this, _, _, cx| {
                                                        this.patient.record.menu = false;
                                                        this.edit_patient_profile(cx)
                                                    }))
                                                },
                                            ),
                                        )
                                        .child(
                                            menu_item(
                                                "clinical-workspace-current-profile",
                                                "Altri dati della scheda…",
                                                true,
                                            )
                                            .on_click(
                                                cx.listener(|this, _, _, cx| {
                                                    this.patient.record.menu = false;
                                                    if let Some(path) =
                                                        this.current_patient_path("edit")
                                                    {
                                                        this.open_current(&path, cx);
                                                    }
                                                }),
                                            ),
                                        ),
                                ))
                            }),
                    ),
            )
    }

    pub(super) fn record_sections(&self, layout: Layout, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let count = |section: PatientSection| -> Option<usize> {
            match section {
                PatientSection::Overview | PatientSection::Observations => None,
                PatientSection::Diary => self
                    .patient
                    .entries
                    .ready()
                    .map(|rows| rows.iter().filter(|row| row.deleted_at.is_none()).count()),
                PatientSection::Therapies => self.patient.therapies.ready().map(|rows| {
                    rows.iter()
                        .filter(|row| row.status == "active" && row.deleted_at.is_none())
                        .count()
                }),
                PatientSection::Documents => self.patient.attachments.ready().map(Vec::len),
                PatientSection::Checkups => self.patient.checkups.ready().map(|rows| {
                    rows.iter()
                        .filter(|row| row.status == "pending" && row.deleted_at.is_none())
                        .count()
                }),
            }
        };
        let last_visit = self.patient.record.anchor.clone().flatten().map(|anchor| {
            let mut line = format!(
                "Ultima visita {}",
                record_changes::day_in_zone(anchor.at, &chrono::Local)
            );
            if let Some(author) = anchor.recorded_by {
                line.push_str(&format!(" · {author}"));
            }
            line
        });
        div()
            .flex_shrink_0()
            .px(px(layout.margin))
            .pb(px(4.))
            .flex()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .child(
                div()
                    .id("clinical-workspace-patient-sections")
                    .accessibility_id("clinical-workspace-patient-sections")
                    .role(Role::TabList)
                    .aria_label("Moduli del paziente")
                    .flex()
                    .flex_wrap()
                    .p(px(4.))
                    .gap(px(2.))
                    .bg(theme.record.compact_island)
                    .border_1()
                    .border_color(theme.record.island_rule)
                    .rounded(px(14.))
                    .children(PatientSection::ALL.into_iter().map(|section| {
                        let selected = self.patient_section == section;
                        div()
                            .id(section.id())
                            .accessibility_id(section.id())
                            .role(Role::Tab)
                            .aria_label(section.title())
                            .aria_selected(selected)
                            .focusable()
                            .tab_stop(true)
                            .cursor_pointer()
                            .min_h(px(34.))
                            .px(px(14.))
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .rounded(px(10.))
                            .border_1()
                            .border_color(if selected {
                                theme.rule
                            } else {
                                gpui::transparent_black()
                            })
                            .when(selected, |el| {
                                el.bg(theme.paper).shadow(vec![
                                    gpui::BoxShadow::new(
                                        px(0.),
                                        px(1.),
                                        Theme::tint(theme.ink, 0.08),
                                    )
                                    .blur_radius(px(2.)),
                                ])
                            })
                            .type_role(
                                theme,
                                if selected {
                                    crate::theme::TextRole::Strong
                                } else {
                                    crate::theme::TextRole::Body
                                },
                            )
                            .text_color(if selected { theme.ink } else { theme.secondary })
                            .when(!selected, move |el| {
                                el.hover(move |style| style.bg(theme.hover).text_color(theme.ink))
                            })
                            .focus(move |style| style.shadow(vec![theme.focus_ring(false)]))
                            .child(text!(section.title()))
                            .children(count(section).filter(|count| *count > 0).map(|count| {
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(count.to_string()))
                            }))
                            .on_click(
                                cx.listener(move |this, _, _, cx| {
                                    this.section_selected(section, cx)
                                }),
                            )
                    })),
            )
            .children(last_visit.map(|line| {
                div()
                    .type_role(theme, crate::theme::TextRole::Meta)
                    .text_color(theme.secondary)
                    .child(text!(line))
            }))
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
        let compact = zones == Zones::One;
        let changed = self
            .patient
            .record
            .anchor
            .as_ref()
            .is_some_and(Option::is_some);
        let changed_column = |column: Div, wide: bool| {
            column
                .when(wide, |el| {
                    el.child(zone_title(
                        "clinical-record-zone-changed",
                        "Cambiato",
                        changed,
                        theme,
                    ))
                })
                .when(!wide, |el| {
                    el.child(zone_label(
                        "clinical-record-zone-changed",
                        if changed {
                            "Cambiato dall’ultima visita"
                        } else {
                            "Cambiato"
                        },
                        changed,
                        theme,
                    ))
                })
                .child(
                    island(theme, compact)
                        .bg(theme.record.change)
                        .border_color(theme.record.change_rule)
                        .child(self.record_band(cx)),
                )
        };
        let work = (reading.is_some() || writing.is_some() || done.is_some()).then(|| {
            block(theme)
                .gap(px(TRAY_INSET))
                .children(reading)
                .children(writing)
                .when(drafting, |el| {
                    el.child(island(theme, compact).child(self.record_documents(cx)))
                })
                .children(done)
        });
        let context_column = |column: Div, wide: bool| {
            column
                .when(wide, |el| {
                    el.child(zone_title(
                        "clinical-record-zone-context",
                        "Contesto",
                        false,
                        theme,
                    ))
                })
                .when(!wide, |el| {
                    el.child(zone_label(
                        "clinical-record-zone-context",
                        "Contesto",
                        false,
                        theme,
                    ))
                })
                .child(self.record_context(patient, cx))
        };
        let column = || block(theme).gap(px(ZONE_GAP));
        let zone = |column: Div, id: &'static str| {
            column
                .id(id)
                .debug_selector(move || id.into())
                .h(px(zone_height))
                .overflow_y_scroll()
        };
        let framed = |id: &'static str,
                      scroll: &'static str,
                      title: Stateful<Div>,
                      body: Div,
                      handle: &gpui::ScrollHandle| {
            tray(theme)
                .id(id)
                .debug_selector(move || id.into())
                .h(px(zone_height))
                .min_h_0()
                .child(title)
                .child(
                    body.id(scroll)
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .track_scroll(handle),
                )
        };
        let band = || {
            island(theme, false)
                .bg(theme.record.change)
                .border_color(theme.record.change_rule)
                .child(self.record_band(cx))
        };
        let changed_title =
            || zone_title("clinical-record-zone-changed", "Cambiato", changed, theme);
        let body = || block(theme).gap(px(TRAY_INSET));
        match zones {
            Zones::Three => div()
                .min_w_0()
                .flex()
                .gap(px(ZONE_GAP))
                .items_start()
                .child(
                    framed(
                        "clinical-record-stable",
                        "clinical-record-stable-scroll",
                        zone_title("clinical-record-zone-stable", "Stabile", false, theme),
                        body().child(self.record_stable(patient, true, cx)),
                        &self.patient.record.stable_column,
                    )
                    .flex_basis(px(0.))
                    .flex_grow(326.1 - 2. * (TRAY_INSET + 1.)),
                )
                .child(
                    framed(
                        "clinical-record-changed",
                        "clinical-record-changed-scroll",
                        changed_title(),
                        body()
                            .child(band())
                            .child(island(theme, false).child(self.record_diary(cx))),
                        &self.patient.record.changed_column,
                    )
                    .flex_basis(px(0.))
                    .flex_grow(376.3 - 2. * (TRAY_INSET + 1.)),
                )
                .child(
                    framed(
                        "clinical-record-context",
                        "clinical-record-context-scroll",
                        zone_title("clinical-record-zone-context", "Contesto", false, theme),
                        body()
                            .children(work)
                            .child(self.record_context(patient, cx)),
                        &self.patient.record.composer_column,
                    )
                    .flex_basis(px(0.))
                    .flex_grow(313.6 - 2. * (TRAY_INSET + 1.)),
                ),
            Zones::Two => div()
                .min_w_0()
                .flex()
                .gap(px(ZONE_GAP))
                .items_start()
                .child(
                    framed(
                        "clinical-record-changed",
                        "clinical-record-changed-scroll",
                        changed_title(),
                        body()
                            .child(band())
                            .child(island(theme, false).child(self.record_diary(cx))),
                        &self.patient.record.changed_column,
                    )
                    .flex_1(),
                )
                .child(
                    zone(column(), "clinical-record-side")
                        .track_scroll(&self.patient.record.composer_column)
                        .w(px(340.))
                        .flex_none()
                        .children(work)
                        .child(
                            tray(theme)
                                .child(zone_title(
                                    "clinical-record-zone-stable",
                                    "Stabile",
                                    false,
                                    theme,
                                ))
                                .child(self.record_stable(patient, true, cx)),
                        )
                        .child(context_column(tray(theme), true)),
                ),
            Zones::One => {
                let context = context_column(column(), false);
                let content = column()
                    .id("clinical-record-single")
                    .debug_selector(|| "clinical-record-single".into())
                    .child(changed_column(column(), false))
                    .child(zone_label(
                        "clinical-record-zone-stable",
                        "Stabile",
                        false,
                        theme,
                    ))
                    .child(self.record_stable(patient, true, cx))
                    .child(island(theme, true).child(self.record_diary(cx)));
                column().children(work).child(content).child(context)
            }
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
        let years = diagnosis_dates(patient.diagnoses.as_deref());
        let compact = self.record_compact();
        let paired = compact && self.viewport_width / self.effective_text_scale() >= 700.;
        let therapies_first = compact && with_therapies;
        let profile_editable =
            self.form.is_none() && self.can_write(FormKind::PatientProfile) && !patient.is_archived;
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(TRAY_INSET))
            .child(
                div()
                    .min_w_0()
                    .flex()
                    .when(!paired, |el| el.flex_col())
                    .when(paired, |el| el.items_start())
                    .gap(px(TRAY_INSET))
                    .when(therapies_first, |el| {
                        el.child(self.record_active_therapies(cx))
                    })
                    .child(
                        island(theme, compact)
                            .flex_1()
                            .child(card_title(
                                "clinical-overview-problems",
                                Icon::Heart,
                                "Problemi",
                                Some(diagnoses.as_ref().map_or_else(
                                    |_| "Non disponibile".into(),
                                    |rows| rows.len().to_string(),
                                )),
                                profile_editable.then(|| {
                                    link("clinical-overview-problems-edit", "Modifica", theme)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.edit_patient_profile(cx)
                                        }))
                                }),
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
                            .children(diagnoses.unwrap_or_default().into_iter().enumerate().map(
                                |(index, (id, label))| {
                                    let since = years.get(index).cloned().flatten();
                                    let (code, name) = label
                                        .split_once(" · ")
                                        .map_or((None, label.clone()), |(code, name)| {
                                            (Some(code.to_owned()), name.to_owned())
                                        });
                                    div()
                                        .id(SharedString::from(id))
                                        .min_w_0()
                                        .py(px(4.))
                                        .flex()
                                        .items_baseline()
                                        .justify_between()
                                        .gap(px(12.))
                                        .child(
                                            div()
                                                .flex_1()
                                                .min_w_0()
                                                .flex()
                                                .flex_col()
                                                .child(
                                                    div()
                                                        .type_role(theme, crate::theme::TextRole::RecordRow)
                                                        .child({
                                                            let text = text!(name);
                                                            #[cfg(test)]
                                                            let text = crate::shell::rendered_command::observe_text(text);
                                                            text
                                                        }),
                                                )
                                                .children(since.map(|since| {
                                                    div()
                                                        .type_role(theme, crate::theme::TextRole::Meta)
                                                        .text_color(theme.secondary)
                                                        .child(text!(since))
                                                })),
                                        )
                                        .when_some(code, |el, code| {
                                            el.child(
                                                div()
                                                    .flex_none()
                                                    .type_role(theme, crate::theme::TextRole::Code)
                                                    .text_color(theme.secondary)
                                                    .child(text!(code)),
                                            )
                                        })
                                },
                            )),
                    )
                    .when(with_therapies && !therapies_first, |el| {
                        el.child(self.record_active_therapies(cx))
                    }),
            )
            .child(self.record_notes(patient, cx))
    }

    fn changed_since_visit(&self) -> Vec<Change> {
        let Some(Some(anchor)) = self.patient.record.anchor.as_ref() else {
            return vec![];
        };
        record_changes::changes_since(
            anchor,
            self.patient.therapies.ready().map_or(&[], Vec::as_slice),
            self.patient.observations.ready().map_or(&[], Vec::as_slice),
            &chrono::Local,
        )
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
        let changes = self.changed_since_visit();
        island(theme, self.record_compact())
            .flex_1()
            .id("clinical-record-active-therapies")
            .debug_selector(|| "clinical-record-active-therapies".into())
            .child(card_title(
                "clinical-workspace-active-therapies-heading",
                Icon::Pill,
                "Terapie attive",
                Some(
                    self.patient
                        .therapies
                        .ready()
                        .map_or_else(|| "Non disponibile".into(), |_| active.len().to_string()),
                ),
                self.form.is_none().then(|| {
                    link("clinical-overview-therapies-open", "Tutte", theme).on_click(cx.listener(
                        |this, _, _, cx| this.section_selected(PatientSection::Therapies, cx),
                    ))
                }),
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
                let key = format!("therapy-{}", therapy.id);
                let change = changes
                    .iter()
                    .find(|change| change.key == key)
                    .map(|change| change.kind);
                row(theme)
                    .id(SharedString::from(format!(
                        "clinical-overview-therapy-{}",
                        therapy.id
                    )))
                    .child(
                        div()
                            .min_w_0()
                            .flex()
                            .items_start()
                            .justify_between()
                            .gap(px(8.))
                            .child(named_with_dose(&therapy.drug_name, theme).flex_1())
                            .children(change.map(|kind| tag(kind.label(), theme.warning, theme))),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .type_role(theme, crate::theme::TextRole::Body)
                            .child({
                                let text = text!(therapy.dosage.clone());
                                #[cfg(test)]
                                let text = crate::shell::rendered_command::observe_text(text);
                                text
                            }),
                    )
            }))
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
        island(theme, self.record_compact())
            .id("clinical-record-notes")
            .when(registered.is_some(), |el| el.border_color(theme.success))
            .child(card_title(
                "clinical-workspace-notes-heading",
                Icon::Diary,
                "Note della scheda",
                None,
                Some(
                    link_enabled("clinical-workspace-edit-notes", "Modifica", theme, editable)
                        .aria_label("Modifica note")
                        .debug_selector(|| "clinical-workspace-edit-notes".into())
                        .when(editable, |el| {
                            el.on_click(cx.listener(|this, _, window, cx| {
                                this.open_form(FormKind::Notes, window, cx)
                            }))
                        }),
                ),
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
                div()
                    .id("clinical-workspace-notes-content")
                    .type_role(theme, crate::theme::TextRole::Body)
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
        let therapy_changes = changes
            .iter()
            .filter(|change| change.source == ChangeSource::Therapy)
            .count();
        let out_of_range = changes
            .iter()
            .filter(|change| change.kind == ChangeKind::OutOfRange)
            .count();
        if self.patient.record.documents {
            changes.extend(documents);
            changes.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.subject.cmp(&b.subject)));
        }
        let diary = record_changes::diary_after(&anchor, entries);
        let short_day = anchor
            .visit_day
            .get(..5)
            .unwrap_or(&anchor.visit_day)
            .to_owned();
        let mut title = format!("Dall’ultima visita · {short_day}");
        if let Some(author) = anchor.recorded_by.as_deref() {
            title.push_str(&format!(" · {author}"));
        }
        let heading = div()
            .min_w_0()
            .flex()
            .items_center()
            .gap(px(10.))
            .child(glyph(Icon::History, None, theme))
            .child(
                div()
                    .min_w_0()
                    .flex()
                    .flex_wrap()
                    .items_baseline()
                    .gap_x(px(8.))
                    .child(island_title(
                        "clinical-record-band-title",
                        "Dall’ultima visita",
                        None,
                        theme,
                    ))
                    .child(
                        div()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(format!("{short_day} → oggi"))),
                    ),
            );
        if changes.is_empty() && diary.is_none() && !new_documents {
            return div()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(heading)
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
                    .pt(px(4.))
                    .type_role(theme, crate::theme::TextRole::Meta)
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_color(theme.secondary)
                    .child(text!(spoken_day(&day)))
                    .into_any_element(),
            );
            for (_, named) in groups {
                for change in named {
                    rows.push(self.change_line(change, entries, cx).into_any_element());
                }
            }
        }
        let plural = |count: usize, one: &str, many: &str| {
            format!("{count} {}", if count == 1 { one } else { many })
        };
        div()
            .id("clinical-record-band")
            .accessibility_id("clinical-record-band")
            .role(Role::Region)
            .aria_label(SharedString::from(title.clone()))
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(heading)
            .child(
                div()
                    .min_w_0()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(6.))
                    .when(therapy_changes > 0, |el| {
                        el.child(tag(
                            plural(therapy_changes, "terapia", "terapie"),
                            theme.warning,
                            theme,
                        ))
                    })
                    .when(out_of_range > 0, |el| {
                        el.child(tag(
                            plural(
                                out_of_range,
                                "valore fuori intervallo",
                                "valori fuori intervallo",
                            ),
                            theme.critical,
                            theme,
                        ))
                    })
                    .when(new_documents, |el| {
                        el.child(
                            link(
                                "clinical-record-band-documents",
                                "Mostra anche i documenti",
                                theme,
                            )
                            .aria_selected(documents_on)
                            .when(documents_on, |el| el.underline())
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.patient.record.documents = !this.patient.record.documents;
                                cx.notify();
                            })),
                        )
                    }),
            )
            .when_some(diary, |el, line| {
                el.child(
                    div().flex().child(
                        button("clinical-record-band-diary", line, theme, false, true)
                            .min_h(px(26.))
                            .px(px(8.))
                            .py(px(2.))
                            .rounded(px(8.))
                            .bg(theme.paper)
                            .border_color(theme.record.change_rule)
                            .type_role(theme, crate::theme::TextRole::Meta)
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
            .children(rows)
            .into_any_element()
    }

    fn change_line(&self, change: Change, entries: &[Entry], cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let key = change.key.clone();
        let open = self.patient.record.open.as_deref() == Some(key.as_str());
        let day = record_changes::day_in_zone(change.at, &chrono::Local);
        let color = match change.kind {
            ChangeKind::OutOfRange => theme.critical,
            ChangeKind::DocumentAdded => theme.fresh,
            _ => theme.warning,
        };
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(
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
                    .min_w_0()
                    .min_h(px(32.))
                    .mx(px(-6.))
                    .px(px(6.))
                    .rounded(px(8.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .hover(move |style| style.bg(Theme::tint(theme.paper, 0.6)))
                    .focus(move |style| style.shadow(vec![theme.focus_ring(false)]))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_wrap()
                            .items_baseline()
                            .gap_x(px(6.))
                            .child(named_with_dose(&change.subject, theme))
                            .children(change.measure.clone().map(|value| {
                                div()
                                    .type_role(theme, crate::theme::TextRole::Body)
                                    .text_color(theme.secondary)
                                    .child(text!(value))
                            })),
                    )
                    .child(tag(change.kind.label(), color, theme))
                    .child(icon(
                        if open {
                            Icon::ChevronDown
                        } else {
                            Icon::ChevronRight
                        },
                        theme.secondary,
                        14.,
                    ))
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
                el.child(self.change_detail(&change, entries, 0., cx))
            })
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
                .map(|entry| (entry.id.clone(), entry_type_label(&entry.entry_type)))
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
        let term = |label: &'static str| {
            div()
                .w(px(92.))
                .flex_none()
                .text_color(theme.secondary)
                .child(text!(label))
        };
        let chip = |id: SharedString, label: String| {
            link(id, label, theme)
                .min_h(px(24.))
                .px(px(8.))
                .py(px(0.))
                .whitespace_nowrap()
                .rounded(px(999.))
                .bg(Theme::tint(theme.fresh, 0.08))
        };
        let more = self.patient.record.more.as_deref() == Some(change.key.as_str());
        let fact = |line: &record_changes::Detail| {
            div()
                .min_w_0()
                .flex()
                .items_baseline()
                .gap(px(10.))
                .child(term(line.term))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_color(theme.ink)
                        .child(text!(line.value.clone())),
                )
        };
        let toggle = change.key.clone();
        div()
            .ml(px(indent))
            .px(px(12.))
            .py(px(10.))
            .bg(theme.paper)
            .border_1()
            .border_color(theme.record.change_rule)
            .rounded(px(10.))
            .flex()
            .flex_col()
            .gap(px(4.))
            .type_role(theme, crate::theme::TextRole::Meta)
            .children(change.detail.iter().map(fact))
            .when(!same_day.is_empty() || document.is_some(), |el| {
                el.child(
                    div()
                        .min_w_0()
                        .flex()
                        .items_center()
                        .gap(px(10.))
                        .child(term(if document.is_some() {
                            "Documento"
                        } else {
                            "Stesso giorno"
                        }))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_wrap()
                                .gap(px(4.))
                                .children(same_day.into_iter().map(|(id, label)| {
                                    let entry = id.clone();
                                    chip(
                                        SharedString::from(format!(
                                            "clinical-record-read-entry-{id}"
                                        )),
                                        label.clone(),
                                    )
                                    .aria_label(SharedString::from(format!(
                                        "Diario del {day} · {label}"
                                    )))
                                    .on_click(cx.listener(
                                        move |this, _, _, cx| this.read_record_entry(&entry, cx),
                                    ))
                                }))
                                .when_some(document, |el, id| {
                                    el.child(
                                        chip(
                                            SharedString::from(format!(
                                                "clinical-record-open-document-{id}"
                                            )),
                                            "Apri il documento".into(),
                                        )
                                        .on_click(
                                            cx.listener(move |this, _, _, cx| {
                                                this.read_record_document(&id, cx)
                                            }),
                                        ),
                                    )
                                }),
                        ),
                )
            })
            .when(more, |el| {
                el.children(change.more.iter().map(fact))
                    .child(fact(&record_changes::Detail {
                        term: "Nella scheda",
                        value: day.clone(),
                    }))
            })
            .child(
                div()
                    .min_w_0()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .child(
                        link(
                            SharedString::from(format!(
                                "clinical-record-change-more-{}",
                                change.key
                            )),
                            if more {
                                "Meno dettagli"
                            } else {
                                "Altri dettagli"
                            },
                            theme,
                        )
                        .min_h(px(24.))
                        .px(px(0.))
                        .aria_expanded(more)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.patient.record.more =
                                if this.patient.record.more.as_deref() == Some(toggle.as_str()) {
                                    None
                                } else {
                                    Some(toggle.clone())
                                };
                            cx.notify();
                        })),
                    )
                    .child(
                        link_enabled(
                            SharedString::from(format!(
                                "clinical-record-change-section-{}",
                                change.key
                            )),
                            source_label,
                            theme,
                            self.form.is_none(),
                        )
                        .min_h(px(24.))
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
            .child(card_title(
                "clinical-record-diary-title",
                Icon::Diary,
                "Diario clinico",
                total.map(|total| {
                    if total == 1 {
                        "1 voce".into()
                    } else {
                        format!("{total} voci")
                    }
                }),
                (reading_all || total.is_some_and(|total| total > 0)).then(|| {
                    link("clinical-record-diary-all", label, theme)
                        .debug_selector(|| "clinical-record-diary-all".into())
                        .on_click(cx.listener(move |this, _, _, cx| action(this, cx)))
                }),
                theme,
            ))
            .child(if reading_all {
                self.diary_list(Some(usize::MAX), cx)
            } else {
                self.record_diary_rows(cx)
            })
    }

    fn record_diary_rows(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut rows: Vec<_> = self
            .patient
            .entries
            .ready()
            .into_iter()
            .flatten()
            .filter(|entry| entry.deleted_at.is_none())
            .collect();
        rows.sort_by(|a, b| b.date.cmp(&a.date));
        rows.truncate(BAND_ROWS);
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .when(
                self.patient.entries.state(ReadObject::Diario).is_some(),
                |el| {
                    el.child(self.patient_read_hint(
                        "clinical-workspace-entries-state",
                        &self.patient.entries,
                        ReadObject::Diario,
                        cx,
                    ))
                },
            )
            .when(
                self.patient.entries.ready().is_some() && rows.is_empty(),
                |el| {
                    el.child(self.empty_read_state(
                        "clinical-workspace-entries-empty",
                        ReadObject::Diario,
                        cx,
                    ))
                },
            )
            .children(rows.into_iter().enumerate().map(|(index, entry)| {
                let id = entry.id.clone();
                let locked_title = entry.locked_fields.iter().any(|field| field == "title");
                let locked_content = entry.locked_fields.iter().any(|field| field == "content");
                let title = if locked_title {
                    "Titolo non leggibile".to_owned()
                } else {
                    entry.title.clone()
                };
                let date = display_instant_date(&entry.date);
                let kind = match entry
                    .recorded_by
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                {
                    Some(author) => format!("{} · {author}", entry_type_label(&entry.entry_type)),
                    None => entry_type_label(&entry.entry_type).to_owned(),
                };
                div()
                    .id(SharedString::from(format!("clinical-workspace-entry-{id}")))
                    .debug_selector({
                        let id = id.clone();
                        move || format!("clinical-workspace-entry-{id}")
                    })
                    .role(Role::Button)
                    .aria_label(SharedString::from(format!("{title}, {date}")))
                    .focusable()
                    .tab_stop(true)
                    .cursor_pointer()
                    .min_w_0()
                    .py(px(10.))
                    .when(index > 0, |el| el.border_t_1().border_color(theme.rule))
                    .flex()
                    .gap(px(14.))
                    .hover(move |style| style.bg(theme.hover))
                    .focus(move |style| style.shadow(vec![theme.focus_ring(false)]))
                    .child(
                        div()
                            .w(px(44.))
                            .flex_none()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child(text!(date.get(..5).unwrap_or(&date).to_owned()))
                            .child(text!(entry_time(&entry.date))),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(theme.secondary)
                                    .child(text!(kind)),
                            )
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Body)
                                    .text_color(theme.ink)
                                    .line_clamp(2)
                                    .child(text!(if locked_content {
                                        "Il testo cifrato non è leggibile con questo accesso."
                                            .to_owned()
                                    } else {
                                        plain_text(&entry.content)
                                    })),
                            )
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(match entry
                                        .recorded_by
                                        .as_deref()
                                        .map(str::trim)
                                        .filter(|name| !name.is_empty())
                                    {
                                        Some(author) => format!("Registrata da {author}"),
                                        None => diary_registration(
                                            None,
                                            entry.created_at.as_deref(),
                                            &chrono::Local
                                        ),
                                    })),
                            ),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| this.read_record_entry(&id, cx)))
            }))
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
        let proposed = matches!(
            self.patient.insight.phase,
            patient_insight::InsightPhase::Proposal { .. }
        );
        let inline = (!open).then(|| self.current_insight()).flatten();
        block(theme)
            .gap(px(10.))
            .p(px(16.))
            .border_1()
            .border_dashed()
            .border_color(theme.record.proposal_rule)
            .rounded(px(ISLAND_RADIUS))
            .child(
                div()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .child(glyph(
                        Icon::Proposal,
                        Some(theme.record.proposal_rule),
                        theme,
                    ))
                    .child(
                        div().flex_1().min_w_0().text_color(theme.ink).child(
                            crate::title::title("Quadro paziente", theme)
                                .with_role(crate::theme::TitleRole::RecordIsland),
                        ),
                    ),
            )
            .when(proposed, |el| {
                el.child(
                    div().flex().child(
                        div()
                            .px(px(8.))
                            .py(px(1.))
                            .rounded(px(6.))
                            .border_1()
                            .border_dashed()
                            .border_color(theme.record.proposal_rule)
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .text_color(theme.record.proposal_rule)
                            .child(text!("Proposta · non registrata")),
                    ),
                )
            })
            .when_some(inline, |el, (lines, proposal)| {
                el.child(
                    div()
                        .type_role(theme, crate::theme::TextRole::Meta)
                        .text_color(theme.secondary)
                        .child(text!(
                            mediflow_runtime_client::PATIENT_INSIGHT_REVIEW_NOTICE
                        )),
                )
                .children(lines.into_iter().take(4).enumerate().map(|(index, line)| {
                    div()
                        .id(SharedString::from(format!(
                            "clinical-record-quadro-line-{index}"
                        )))
                        .min_w_0()
                        .flex()
                        .gap(px(10.))
                        .child(div().pt(px(3.)).child(icon(
                            Icon::Proposal,
                            theme.record.proposal_rule,
                            14.,
                        )))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(
                                    div()
                                        .type_role(theme, crate::theme::TextRole::Body)
                                        .text_color(theme.ink)
                                        .child(text!(patient_insight::without_citations(
                                            &line.text
                                        ))),
                                )
                                .when(!line.sources.is_empty(), |el| {
                                    el.child(div().flex().flex_wrap().gap(px(4.)).children(
                                        line.sources.into_iter().map(|source| {
                                            let text = source
                                                .split_once(": ")
                                                .map_or(source.as_str(), |(_, text)| text);
                                            let short = text
                                                .split([':', '—', '('])
                                                .next()
                                                .unwrap_or(text)
                                                .trim()
                                                .to_owned();
                                            div()
                                                .id(SharedString::from(source.clone()))
                                                .aria_label(SharedString::from(source.clone()))
                                                .px(px(8.))
                                                .py(px(1.))
                                                .rounded(px(999.))
                                                .border_1()
                                                .border_color(Theme::tint(
                                                    theme.record.proposal_rule,
                                                    0.45,
                                                ))
                                                .type_role(theme, crate::theme::TextRole::Meta)
                                                .text_color(theme.record.proposal_rule)
                                                .child(text!(short))
                                        }),
                                    ))
                                }),
                        )
                }))
                .child(
                    div()
                        .type_role(theme, crate::theme::TextRole::Meta)
                        .text_color(theme.secondary)
                        .child(text!(format!(
                            "Generata {} da {} · {} · {}",
                            crate::components::display_instant(&proposal.generated_at),
                            proposal.provider,
                            proposal.model,
                            if proposal.egress == "none" {
                                "nessuna uscita in rete"
                            } else {
                                "con uscita in rete"
                            }
                        ))),
                )
            })
            .child(
                div().flex().child(
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
                    .min_h(px(34.))
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
        let mut series: Vec<(String, Vec<&Observation>)> = vec![];
        for row in &rows {
            let key = format!("{}|{}", row.code_system, row.code);
            match series.iter_mut().find(|(other, _)| *other == key) {
                Some((_, values)) => values.push(row),
                None => series.push((key, vec![row])),
            }
        }
        for (_, values) in &mut series {
            values.sort_by(|a, b| a.observed_at.cmp(&b.observed_at));
        }
        series.sort_by(|a, b| {
            let last =
                |values: &Vec<&Observation>| values.last().map(|row| row.observed_at.clone());
            last(&b.1).cmp(&last(&a.1))
        });
        let number = |value: &str| value.trim().replace(',', ".").parse::<f64>().ok();
        block(theme)
            .gap(px(10.))
            .child(card_title(
                "clinical-overview-observations",
                Icon::Activity,
                "Parametri",
                self.patient
                    .observations
                    .ready()
                    .map(|_| series.len().to_string()),
                self.form.is_none().then(|| {
                    link("clinical-overview-observations-open", "Andamento", theme).on_click(
                        cx.listener(|this, _, _, cx| {
                            this.section_selected(PatientSection::Observations, cx)
                        }),
                    )
                }),
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
            .children(series.into_iter().map(|(_, values)| {
                let latest = *values.last().expect("series has a value");
                let value = number(&latest.value);
                let high = latest.ref_high.as_deref().and_then(number);
                let low = latest.ref_low.as_deref().and_then(number);
                let arrow = match value {
                    Some(value) if high.is_some_and(|high| value > high) => Some("↑"),
                    Some(value) if low.is_some_and(|low| value < low) => Some("↓"),
                    _ => None,
                };
                let color = if arrow.is_some() {
                    theme.critical
                } else {
                    theme.ink
                };
                let trend: Vec<f64> = values.iter().filter_map(|row| number(&row.value)).collect();
                let shown = crate::clinical_units::value(&latest.value, &latest.unit_code);
                let (amount, unit) = shown
                    .rsplit_once(' ')
                    .map_or((shown.clone(), String::new()), |(amount, unit)| {
                        (amount.to_owned(), unit.to_owned())
                    });
                div()
                    .min_w_0()
                    .py(px(4.))
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::RecordRow)
                                    .child(text!(latest.display.clone())),
                            )
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(
                                        display_instant_date(&latest.observed_at)
                                            .get(..5)
                                            .unwrap_or_default()
                                            .to_owned()
                                    )),
                            ),
                    )
                    .child(sparkline(
                        trend,
                        if arrow.is_some() {
                            theme.critical
                        } else {
                            theme.secondary
                        },
                    ))
                    .child(
                        div()
                            .flex_none()
                            .min_w(px(84.))
                            .flex()
                            .justify_end()
                            .items_baseline()
                            .gap(px(4.))
                            .text_color(color)
                            .children(arrow.map(|arrow| {
                                div()
                                    .type_role(theme, crate::theme::TextRole::Strong)
                                    .child(text!(arrow))
                            }))
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::RecordRow)
                                    .child(text!(amount)),
                            )
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .child(text!(unit)),
                            ),
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
            .gap(px(10.))
            .child(card_title(
                "clinical-record-documents",
                Icon::Diary,
                "Documenti recenti",
                self.patient
                    .attachments
                    .ready()
                    .map(|all| all.len().to_string()),
                self.form.is_none().then(|| {
                    link("clinical-record-documents-open", "Tutti", theme).on_click(cx.listener(
                        |this, _, _, cx| this.section_selected(PatientSection::Documents, cx),
                    ))
                }),
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
                div()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .child(div().text_ellipsis().child(text!(document.name.clone())))
                            .child(
                                div()
                                    .type_role(theme, crate::theme::TextRole::Meta)
                                    .text_color(theme.secondary)
                                    .child(text!(display_date(document.created_at.as_deref()))),
                            ),
                    )
                    .child(
                        link(
                            SharedString::from(format!("clinical-record-document-read-{id}")),
                            "Apri",
                            theme,
                        )
                        .aria_label("Apri il documento")
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.read_record_document(&id, cx)),
                        ),
                    )
            }))
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
            .gap(px(10.))
            .child(card_title(
                "clinical-workspace-followup-heading",
                Icon::Agenda,
                "Controlli aperti",
                self.patient
                    .checkups
                    .ready()
                    .map(|_| pending.len().to_string()),
                self.form.is_none().then(|| {
                    link("clinical-workspace-open-checkups", "Tutti", theme).on_click(cx.listener(
                        |this, _, _, cx| this.section_selected(PatientSection::Checkups, cx),
                    ))
                }),
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
                div()
                    .id(SharedString::from(format!(
                        "clinical-overview-checkup-{}",
                        checkup.id
                    )))
                    .min_w_0()
                    .flex()
                    .items_baseline()
                    .justify_between()
                    .gap(px(10.))
                    .child(div().flex_1().min_w_0().child({
                        let text = text!(checkup.title.clone());
                        #[cfg(test)]
                        let text = crate::shell::rendered_command::observe_text(text);
                        text
                    }))
                    .child(
                        div()
                            .flex_none()
                            .type_role(theme, crate::theme::TextRole::Meta)
                            .text_color(theme.secondary)
                            .child({
                                let text = text!(display_instant_date(&checkup.date));
                                #[cfg(test)]
                                let text = crate::shell::rendered_command::observe_text(text);
                                text
                            }),
                    )
            }))
            .when(self.form.is_none(), |el| {
                el.child(
                    div().flex().child(
                        link("clinical-overview-open-loops", "Follow-up aperti", theme)
                            .on_click(cx.listener(|this, _, _, cx| this.open_patient_loops(cx))),
                    ),
                )
            })
    }

    fn record_compact(&self) -> bool {
        Zones::for_width(self.viewport_width / self.effective_text_scale()) == Zones::One
    }

    pub(super) fn record_context(&self, patient: &PatientDetail, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(TRAY_INSET))
            .child(self.record_quadro(cx))
            .child(island(theme, self.record_compact()).child(self.record_measures(cx)))
            .child(island(theme, self.record_compact()).child(self.record_checkups(cx)))
            .when(self.form.is_none(), |el| {
                el.child(island(theme, self.record_compact()).child(self.record_documents(cx)))
            })
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
    fn overview_trays_and_compact_islands_follow_the_available_width(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let (view, cx) = opened_at_1180(&host, cx);
        for dark in [false, true] {
            for (width, height, scale) in [(1320., 880., 1.), (390., 760., 1.), (1320., 880., 2.)] {
                cx.simulate_resize(gpui::size(px(width), px(height)));
                view.update(cx, |app, cx| {
                    app.dark_override = Some(dark);
                    app.text_scale = scale;
                    cx.notify();
                });
                notes_recovery_tests::draw(cx);
                let therapies = cx.debug_bounds("clinical-record-active-therapies").unwrap();
                if width == 1320. && scale == 1. {
                    let stable = cx.debug_bounds("clinical-record-stable").unwrap();
                    let changed = cx.debug_bounds("clinical-record-changed").unwrap();
                    let context = cx.debug_bounds("clinical-record-context").unwrap();
                    assert!(stable.right() < changed.left() && changed.right() < context.left());
                    assert!(changed.size.width > stable.size.width);
                    assert_eq!(therapies.left() - stable.left(), px(TRAY_INSET + 1.));
                } else {
                    let column = cx.debug_bounds("clinical-record-single").unwrap();
                    assert!(cx.debug_bounds("clinical-record-stable").is_none());
                    assert_eq!(therapies.left(), column.left());
                    assert!(therapies.right() <= column.right());
                }
            }
        }
        view.update(cx, |app, cx| app.disconnect(cx));
    }

    #[test]
    fn concept_fields_read_only_what_the_record_holds() {
        assert_eq!(
            exemption_codes(r#"["013","021"]"#).as_deref(),
            Some("013, 021")
        );
        assert_eq!(
            exemption_codes(r#"[{"code":"048"}]"#).as_deref(),
            Some("048")
        );
        assert_eq!(exemption_codes("013, 021").as_deref(), Some("013, 021"));
        assert_eq!(exemption_codes("[]"), None);
        assert_eq!(
            diagnosis_dates(Some(
                r#"[{"code":"I50.9","date":"2019-09-03"},{"code":"E11.9"},"Testo"]"#
            )),
            vec![Some("Registrata il 03/09/2019".to_owned()), None, None]
        );
        assert_eq!(
            drug_parts("Bisoprololo 2,5 mg cpr"),
            ("Bisoprololo".to_owned(), "2,5 mg cpr".to_owned())
        );
        assert_eq!(
            drug_parts("Acido acetilsalicilico"),
            ("Acido acetilsalicilico".to_owned(), String::new())
        );
        assert_eq!(
            drug_parts("5-fluorouracile"),
            ("5-fluorouracile".to_owned(), String::new())
        );
        assert_eq!(spoken_day("12/11/2026"), "12 novembre");
        assert_eq!(
            patient_insight::without_citations(
                "Potassio 5,6 [S10] da ricontrollare [S2, DATI-INCOMPLETI]."
            ),
            "Potassio 5,6 da ricontrollare."
        );
        assert_eq!(
            patient_insight::without_citations("Valore [alto] stabile"),
            "Valore [alto] stabile"
        );
        assert_eq!(entry_type_label("phone"), "Telefonata");
        assert_eq!(entry_type_label("access"), "Accesso");
        assert_eq!(entry_type_label("sconosciuto"), "Voce");
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
