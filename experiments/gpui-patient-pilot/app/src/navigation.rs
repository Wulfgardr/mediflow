//! Product navigation and layout rules shared by every GPUI surface.
//! Names and breakpoints follow DESIGN.md and Punto d'inchiostro.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Area {
    Patients,
    Agenda,
    Diary,
    References,
    Analytics,
    Scales,
    Settings,
}

impl Area {
    pub const ALL: [Self; 7] = [
        Self::Patients,
        Self::Agenda,
        Self::Diary,
        Self::References,
        Self::Analytics,
        Self::Scales,
        Self::Settings,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Self::Patients => "clinical-workspace-section-patients-button",
            Self::Agenda => "clinical-workspace-section-agenda-button",
            Self::Diary => "clinical-workspace-section-diary-button",
            Self::References => "clinical-workspace-section-repertori-button",
            Self::Analytics => "clinical-workspace-section-analytics-button",
            Self::Scales => "clinical-workspace-section-scales-button",
            Self::Settings => "clinical-workspace-section-settings-button",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::Patients => "Pazienti",
            Self::Agenda => "Agenda",
            Self::Diary => "Diario",
            Self::References => "Repertori",
            Self::Analytics => "Analisi",
            Self::Scales => "Scale",
            Self::Settings => "Impostazioni",
        }
    }

    pub fn current_path(self) -> &'static str {
        match self {
            Self::Patients => "/?area=incarico",
            Self::Agenda => "/?area=turno",
            Self::Diary => "/diary",
            Self::References => "/?area=repertori",
            Self::Analytics => "/analytics",
            Self::Scales => "/scales",
            Self::Settings => "/settings",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PatientSection {
    Overview,
    Diary,
    Therapies,
    Documents,
    Observations,
    Checkups,
}

impl PatientSection {
    pub const ALL: [Self; 6] = [
        Self::Overview,
        Self::Diary,
        Self::Therapies,
        Self::Documents,
        Self::Observations,
        Self::Checkups,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Self::Overview => "patient-section-overview",
            Self::Diary => "patient-section-diary",
            Self::Therapies => "patient-section-therapies",
            Self::Documents => "patient-section-documents",
            Self::Observations => "patient-section-clinical",
            Self::Checkups => "patient-section-checkups",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::Overview => "Riepilogo",
            Self::Diary => "Diario",
            Self::Therapies => "Terapie",
            Self::Documents => "Documenti",
            Self::Observations => "Parametri",
            Self::Checkups => "Controlli",
        }
    }

    pub fn anchor(self) -> &'static str {
        match self {
            Self::Overview => "quadro",
            Self::Diary => "diario",
            Self::Therapies => "terapie",
            Self::Documents => "documenti",
            Self::Observations => "parametri",
            Self::Checkups => "follow-up",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub width: f32,
    pub compact: bool,
    pub wide: bool,
    pub magnified: bool,
    pub navigation: f32,
    pub margin: f32,
    pub gap: f32,
    pub row: f32,
}

impl Layout {
    /// Text enlargement uses the same reflow rules as a smaller container.
    pub fn for_window(width: f32, text_scale: f32) -> Self {
        let scale = text_scale.clamp(1.0, 4.0);
        let effective = width / scale;
        let compact = effective < 700.;
        let wide = effective > 1000.;
        Self {
            width,
            compact,
            wide,
            magnified: text_scale >= 2.5 || effective < 360.,
            navigation: (if wide { 192. } else { 160. }) * scale,
            margin: if compact { 16. } else { 28. },
            gap: if wide { 40. } else { 24. },
            row: if compact { 44. } else { 40. },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThresholdMode {
    Complete,
    Compact,
    FullPlane,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ThresholdLayout {
    pub mode: ThresholdMode,
    pub scrolls_with_content: bool,
}

impl ThresholdLayout {
    pub fn measured(
        plane_height: f32,
        complete_height: f32,
        essential_height: f32,
        confirming: bool,
        _layout: Layout,
    ) -> Self {
        let mode = if complete_height <= plane_height / 3. {
            ThresholdMode::Complete
        } else if confirming && essential_height > plane_height {
            ThresholdMode::FullPlane
        } else {
            ThresholdMode::Compact
        };
        Self {
            mode,
            scrolls_with_content: false,
        }
    }
}

pub fn confirmation_command_label(patient: &str) -> String {
    format!("Conferma e registra nella scheda di {patient}")
}

pub const CONFIRMATION_COMMANDS: [&str; 2] = ["Torna alla bozza", "Conferma e registra"];

pub fn confirmation_question(count: usize, single_kind: &str, patient: &str) -> String {
    let items = if count == 1 {
        format!("1 {single_kind}")
    } else {
        format!("{count} elementi")
    };
    format!("Registrare {items} nella scheda di {patient}?")
}

/// Move through the visible worklist without wrapping or using a hidden row.
/// A focused row wins over a previous preview selection; no anchor starts at
/// the first visible patient, in either direction.
pub fn adjacent_patient<'a>(
    visible_ids: &[&'a str],
    focused_id: Option<&str>,
    selected_id: Option<&str>,
    previous: bool,
) -> Option<&'a str> {
    let first = *visible_ids.first()?;
    let index = focused_id
        .and_then(|id| visible_ids.iter().position(|visible| *visible == id))
        .or_else(|| {
            selected_id.and_then(|id| visible_ids.iter().position(|visible| *visible == id))
        });
    let Some(index) = index else {
        return Some(first);
    };
    let next = if previous {
        index.saturating_sub(1)
    } else {
        (index + 1).min(visible_ids.len() - 1)
    };
    Some(visible_ids[next])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_is_anchored_at_every_width_and_text_scale() {
        for width in [390., 768., 1440.] {
            for scale in [1., 2., 4.] {
                for height in [300., 700., 900.] {
                    let decision = ThresholdLayout::measured(
                        height,
                        120. * scale,
                        100.,
                        false,
                        Layout::for_window(width, scale),
                    );
                    assert!(!decision.scrolls_with_content, "{width}/{scale}/{height}");
                }
            }
        }
    }

    #[test]
    fn threshold_compacts_strictly_above_one_third_of_its_plane() {
        for width in [390., 768., 1440.] {
            for scale in [1., 2., 4.] {
                let layout = Layout::for_window(width, scale);
                for height in [300., 600., 900.] {
                    for (complete, expected) in [
                        (height / 3. - 0.1, false),
                        (height / 3., false),
                        (height / 3. + 0.1, true),
                    ] {
                        assert_eq!(
                            ThresholdLayout::measured(height, complete, 50., false, layout).mode
                                == ThresholdMode::Compact,
                            expected
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn threshold_uses_full_plane_only_when_confirmation_essentials_do_not_fit() {
        let layout = Layout::for_window(390., 4.);
        assert_eq!(
            ThresholdLayout::measured(700., 1200., 700., true, layout).mode,
            ThresholdMode::Compact
        );
        assert_eq!(
            ThresholdLayout::measured(700., 1200., 700.1, true, layout).mode,
            ThresholdMode::FullPlane
        );
        assert_eq!(
            ThresholdLayout::measured(700., 1200., 1100., false, layout).mode,
            ThresholdMode::Compact
        );
        assert_eq!(
            confirmation_command_label("Moretti Elena"),
            "Conferma e registra nella scheda di Moretti Elena"
        );
    }

    #[test]
    fn threshold_confirmation_preserves_command_order_and_recipient() {
        assert_eq!(
            CONFIRMATION_COMMANDS,
            ["Torna alla bozza", "Conferma e registra"]
        );
        assert_eq!(
            confirmation_question(1, "terapia", "Moretti Elena"),
            "Registrare 1 terapia nella scheda di Moretti Elena?"
        );
        assert_eq!(
            confirmation_question(3, "terapia", "Moretti Elena"),
            "Registrare 3 elementi nella scheda di Moretti Elena?"
        );
    }

    #[test]
    fn worklist_navigation_uses_visible_order_and_focused_row_before_old_selection() {
        let ids = ["elena/2", "carlo%3", "sara è"];
        assert_eq!(adjacent_patient(&ids, None, None, false), Some("elena/2"));
        assert_eq!(adjacent_patient(&ids, None, None, true), Some("elena/2"));
        assert_eq!(
            adjacent_patient(&ids, Some("carlo%3"), Some("sara è"), true),
            Some("elena/2")
        );
        assert_eq!(
            adjacent_patient(&ids, Some("elena/2"), Some("sara è"), false),
            Some("carlo%3")
        );
        assert_eq!(
            adjacent_patient(&ids, Some("filtered out"), Some("carlo%3"), false),
            Some("sara è")
        );
        assert_eq!(
            adjacent_patient(&ids, None, Some("filtered out"), false),
            Some("elena/2")
        );
    }

    #[test]
    fn worklist_navigation_stops_at_both_edges_and_accepts_an_empty_result() {
        let ids = ["first", "last"];
        assert_eq!(
            adjacent_patient(&ids, Some("first"), None, true),
            Some("first")
        );
        assert_eq!(
            adjacent_patient(&ids, Some("last"), None, false),
            Some("last")
        );
        for previous in [false, true] {
            assert_eq!(
                adjacent_patient(&["only"], Some("only"), None, previous),
                Some("only")
            );
            assert_eq!(
                adjacent_patient(&[], Some("stale"), Some("stale"), previous),
                None
            );
            assert_eq!(
                adjacent_patient(&ids, Some("stale"), Some("stale"), previous),
                Some("first")
            );
        }
    }

    #[test]
    fn narrow_and_enlarged_text_reflow_without_hiding_navigation() {
        let phone = Layout::for_window(390., 1.);
        assert!(phone.compact);
        assert_eq!(phone.row, 44.);
        assert!(!Layout::for_window(768., 1.).compact);
        assert!(Layout::for_window(1440., 1.).wide);
        assert!(Layout::for_window(1440., 2.5).compact);
        for width in [390., 768., 1440.] {
            let enlarged = Layout::for_window(width, 4.);
            assert!(enlarged.compact && enlarged.magnified);
            assert!(!enlarged.wide);
        }
        assert!(
            !phone.magnified,
            "normal phone text keeps its four navigation tabs"
        );
    }

    #[test]
    fn every_product_area_has_a_distinct_test_identifier_and_current_route() {
        let ids: std::collections::HashSet<_> = Area::ALL.into_iter().map(Area::id).collect();
        assert_eq!(ids.len(), Area::ALL.len());
        assert!(
            Area::ALL
                .into_iter()
                .all(|area| area.current_path().starts_with('/'))
        );
    }
}
