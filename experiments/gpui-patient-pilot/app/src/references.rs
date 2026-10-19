//! Read-only catalog views. Names, codes and provenance come from the linked
//! archive; selecting or copying a result never prescribes or changes a record.

use gpui::{ClipboardItem, Div, FontWeight, div, prelude::*, px, text};
use mediflow_runtime_client::{
    DrugCatalogItem, ExemptionCatalogItem, TerminologyItem, TerminologySystem,
};

use crate::components::{button, display_date};
use crate::theme::{CODES, Theme};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReferenceKind {
    Drugs,
    Exemptions,
    Atc,
    Loinc,
    Ucum,
}
impl ReferenceKind {
    pub const ALL: [Self; 5] = [
        Self::Drugs,
        Self::Exemptions,
        Self::Atc,
        Self::Loinc,
        Self::Ucum,
    ];
    pub fn id(self) -> &'static str {
        match self {
            Self::Drugs => "clinical-workspace-reference-drugs",
            Self::Exemptions => "clinical-workspace-reference-exemptions",
            Self::Atc => "clinical-workspace-reference-atc",
            Self::Loinc => "clinical-workspace-reference-loinc",
            Self::Ucum => "clinical-workspace-reference-ucum",
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            Self::Drugs => "Farmaci",
            Self::Exemptions => "Esenzioni",
            Self::Atc => "ATC",
            Self::Loinc => "LOINC",
            Self::Ucum => "UCUM",
        }
    }
    pub fn system(self) -> Option<TerminologySystem> {
        match self {
            Self::Atc => Some(TerminologySystem::Atc),
            Self::Loinc => Some(TerminologySystem::Loinc),
            Self::Ucum => Some(TerminologySystem::Ucum),
            Self::Drugs | Self::Exemptions => None,
        }
    }
    pub fn limit(self) -> u16 {
        if self == Self::Drugs { 50 } else { 200 }
    }
}

pub enum ReferenceRows {
    Drugs(Vec<DrugCatalogItem>),
    Exemptions(Vec<ExemptionCatalogItem>),
    Terminology(Vec<TerminologyItem>),
}
impl ReferenceRows {
    pub fn len(&self) -> usize {
        match self {
            Self::Drugs(rows) => rows.len(),
            Self::Exemptions(rows) => rows.len(),
            Self::Terminology(rows) => rows.len(),
        }
    }
    pub fn render(&self, theme: Theme) -> Div {
        let list = div().min_w_0().max_w_full().flex().flex_col();
        match self {
            Self::Drugs(rows) => {
                list.children(rows.iter().map(|row| {
                    let copied = drug_text(row);
                    result_row(theme)
                        .child(drug_description(row, theme))
                        .children([
                            optional_line("Azienda", row.company.as_deref(), theme),
                            optional_line("Classe", row.class.as_deref(), theme),
                        ])
                        .child(div().text_color(theme.secondary).child(text!(
                            row.price.map_or_else(
                                || "Prezzo non riportato".into(),
                                |price| {
                                    format!("Prezzo di catalogo: € {price:.2}").replace('.', ",")
                                }
                            )
                        )))
                        .child(
                            button(
                                format!("clinical-workspace-copy-drug-{}", row.aic),
                                "Copia riferimento",
                                theme,
                                false,
                                true,
                            )
                            .on_click(move |_, _, cx| {
                                cx.write_to_clipboard(ClipboardItem::new_string(copied.clone()))
                            }),
                        )
                }))
            }
            Self::Exemptions(rows) => list.children(rows.iter().map(|row| {
                let copied = exemption_text(row);
                result_row(theme)
                    .child(code_line("Esenzione", &row.code, theme))
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .child(text!(row.description.clone())),
                    )
                    .children([
                        optional_line("Tipo", row.kind.as_deref(), theme),
                        optional_line("Fonte", row.source.as_deref(), theme),
                    ])
                    .when(row.start_date.is_some() || row.end_date.is_some(), |el| {
                        el.child(div().text_color(theme.secondary).child(text!(format!(
                            "Validità riportata: {} — {}",
                            display_date(row.start_date.as_deref()),
                            display_date(row.end_date.as_deref())
                        ))))
                    })
                    .when(row.updated_at.is_some(), |el| {
                        el.child(div().text_color(theme.secondary).child(text!(format!(
                            "Aggiornamento: {}",
                            display_date(row.updated_at.as_deref())
                        ))))
                    })
                    .children([
                        flag_line("Farmaceutica", row.is_pharma, theme),
                        flag_line("Specialistica", row.is_specialist, theme),
                        flag_line("Nazionale", row.is_national, theme),
                    ])
                    .child(
                        button(
                            format!("clinical-workspace-copy-exemption-{}", row.code),
                            "Copia riferimento",
                            theme,
                            false,
                            true,
                        )
                        .on_click(move |_, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(copied.clone()))
                        }),
                    )
            })),
            Self::Terminology(rows) => list.children(rows.iter().map(|row| {
                let copied = terminology_text(row);
                result_row(theme)
                    .child(code_line(row.system.as_str(), &row.code, theme))
                    .child(div().font_weight(FontWeight::MEDIUM).child(text!(
                        row.display_it.as_ref().unwrap_or(&row.display).clone()
                    )))
                    .when(
                        row.display_it
                            .as_ref()
                            .is_some_and(|display| display != &row.display),
                        |el| {
                            el.child(
                                div()
                                    .text_color(theme.secondary)
                                    .child(text!(row.display.clone())),
                            )
                        },
                    )
                    .children([
                        optional_line(
                            "Unità predefinita del repertorio",
                            row.default_unit.as_deref(),
                            theme,
                        ),
                        optional_line("Versione", row.version.as_deref(), theme),
                        optional_line("Fonte", Some(&row.source), theme),
                    ])
                    .child(
                        button(
                            format!(
                                "clinical-workspace-copy-terminology-{}-{}",
                                row.system.as_str(),
                                row.code
                            ),
                            "Copia riferimento",
                            theme,
                            false,
                            true,
                        )
                        .on_click(move |_, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(copied.clone()))
                        }),
                    )
            })),
        }
    }
}

/// The same identity and packaging are shown in the catalog and the therapy
/// chooser; each caller supplies its own explicit action.
pub fn drug_description(row: &DrugCatalogItem, theme: Theme) -> Div {
    drug_identity(
        &row.name,
        Some(&row.aic),
        row.atc.as_deref(),
        row.active_principle.as_deref(),
        theme,
    )
    .child(optional_line("Confezione", row.packaging.as_deref(), theme))
}

pub fn drug_identity(
    name: &str,
    aic: Option<&str>,
    atc: Option<&str>,
    active_principle: Option<&str>,
    theme: Theme,
) -> Div {
    div()
        .min_w_0()
        .max_w_full()
        .flex()
        .flex_col()
        .gap(px(8.))
        .when_some(aic, |el, code| el.child(code_line("AIC", code, theme)))
        .child(
            div()
                .font_weight(FontWeight::SEMIBOLD)
                .child(text!(name.to_owned())),
        )
        .child(optional_line("Principio attivo", active_principle, theme))
        .when_some(atc, |el, code| el.child(code_line("ATC", code, theme)))
}

fn result_row(theme: Theme) -> Div {
    div()
        .min_w_0()
        .max_w_full()
        .border_b_1()
        .border_color(theme.rule)
        .py(px(20.))
        .flex()
        .flex_col()
        .gap(px(8.))
}
fn code_line(label: &str, code: &str, theme: Theme) -> Div {
    div()
        .min_w_0()
        .max_w_full()
        .flex()
        .flex_wrap()
        .when(theme.scale >= 2.5, |el| el.flex_col().items_stretch())
        .gap(px(8.))
        .text_size(px(theme.size(12.)))
        .child(
            div()
                .min_w_0()
                .max_w_full()
                .whitespace_normal()
                .text_color(theme.secondary)
                .child(text!(label.to_owned())),
        )
        .child(
            div()
                .min_w_0()
                .max_w_full()
                .whitespace_normal()
                .font_family(CODES)
                .child(text!(code.to_owned())),
        )
}
fn optional_line(label: &str, value: Option<&str>, theme: Theme) -> Div {
    div()
        .text_color(theme.secondary)
        .when_some(value, |el, value| {
            el.child(text!(format!("{label}: {value}")))
        })
}
fn flag_line(label: &str, value: Option<bool>, theme: Theme) -> Div {
    div()
        .text_color(theme.secondary)
        .when_some(value, |el, value| {
            el.child(text!(format!(
                "{label}: {}",
                if value { "sì" } else { "no" }
            )))
        })
}
fn push_optional(out: &mut Vec<String>, label: &str, value: Option<&str>) {
    if let Some(value) = value {
        out.push(format!("{label}: {value}"));
    }
}
pub fn drug_text(row: &DrugCatalogItem) -> String {
    let mut out = vec![row.name.clone(), format!("AIC: {}", row.aic)];
    for (label, value) in [
        ("Principio attivo", row.active_principle.as_deref()),
        ("Confezione", row.packaging.as_deref()),
        ("Azienda", row.company.as_deref()),
        ("Classe", row.class.as_deref()),
        ("ATC", row.atc.as_deref()),
    ] {
        push_optional(&mut out, label, value);
    }
    if let Some(price) = row.price {
        out.push(format!("Prezzo di catalogo EUR: {price}"));
    }
    out.join("\n")
}
fn exemption_text(row: &ExemptionCatalogItem) -> String {
    let mut out = vec![format!("Esenzione: {}", row.code), row.description.clone()];
    for (label, value) in [
        ("Tipo", row.kind.as_deref()),
        ("Fonte", row.source.as_deref()),
        ("Inizio validità", row.start_date.as_deref()),
        ("Fine validità", row.end_date.as_deref()),
        ("Aggiornamento", row.updated_at.as_deref()),
    ] {
        push_optional(&mut out, label, value);
    }
    for (label, value) in [
        ("Farmaceutica", row.is_pharma),
        ("Specialistica", row.is_specialist),
        ("Nazionale", row.is_national),
    ] {
        if let Some(value) = value {
            out.push(format!("{label}: {}", if value { "sì" } else { "no" }));
        }
    }
    out.join("\n")
}
fn terminology_text(row: &TerminologyItem) -> String {
    let mut out = vec![
        format!("{}: {}", row.system.as_str(), row.code),
        row.display.clone(),
    ];
    for (label, value) in [
        ("Italiano", row.display_it.as_deref()),
        (
            "Unità predefinita del repertorio",
            row.default_unit.as_deref(),
        ),
        ("Versione", row.version.as_deref()),
        ("Fonte", Some(row.source.as_str())),
    ] {
        push_optional(&mut out, label, value);
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_systems_implemented_by_this_search_contract_are_offered() {
        assert_eq!(
            ReferenceKind::ALL
                .into_iter()
                .filter_map(ReferenceKind::system)
                .collect::<Vec<_>>(),
            [
                TerminologySystem::Atc,
                TerminologySystem::Loinc,
                TerminologySystem::Ucum
            ]
        );
        assert_eq!(ReferenceKind::Drugs.limit(), 50);
        assert!(
            ReferenceKind::ALL
                .into_iter()
                .filter(|kind| *kind != ReferenceKind::Drugs)
                .all(|kind| kind.limit() == 200)
        );
    }

    #[test]
    fn copies_preserve_source_labels_and_distinguish_false_from_missing() {
        let row = ExemptionCatalogItem {
            code: "000.è".into(),
            description: "Descrizione 🩺".into(),
            kind: None,
            source: Some("Fonte originale".into()),
            start_date: None,
            end_date: None,
            is_pharma: Some(false),
            is_specialist: Some(true),
            is_national: None,
            updated_at: None,
        };
        let copied = exemption_text(&row);
        assert!(copied.contains("Esenzione: 000.è\nDescrizione 🩺"));
        assert!(copied.contains("Farmaceutica: no\nSpecialistica: sì"));
        assert!(!copied.contains("Nazionale"));
        assert!(!copied.contains("validità"));
        let term = TerminologyItem {
            system: TerminologySystem::Loinc,
            code: "test-1".into(),
            display: "Exact source label".into(),
            display_it: Some("Etichetta originale".into()),
            default_unit: Some("mg/dL".into()),
            version: Some("v1".into()),
            source: "Fonte ufficiale".into(),
        };
        let copied = terminology_text(&term);
        assert!(copied.contains("Exact source label\nItaliano: Etichetta originale"));
        assert!(copied.contains("Unità predefinita del repertorio: mg/dL"));
        assert!(copied.ends_with("Versione: v1\nFonte: Fonte ufficiale"));
    }
}
