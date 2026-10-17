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
        let effective = width / text_scale.clamp(1.0, 4.0);
        let compact = effective < 700.;
        let wide = effective > 1000.;
        Self {
            compact,
            wide,
            magnified: text_scale >= 2.5 || effective < 360.,
            navigation: if wide { 192. } else { 160. },
            margin: if compact { 16. } else { 28. },
            gap: if wide { 40. } else { 24. },
            row: if compact { 44. } else { 40. },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
