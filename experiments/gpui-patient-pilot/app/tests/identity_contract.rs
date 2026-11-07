use std::{fs, path::PathBuf};

fn source(file: &str) -> String {
    let root = std::env::var_os("MEDIFLOW_UI_IDENTITY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src"));
    fs::read_to_string(root.join(file))
        .unwrap()
        .split_whitespace()
        .collect()
}

#[test]
fn primary_command_is_in_header_before_allergy_and_is_unique_per_layout() {
    let s = source("shell.rs");
    let s = &s[s.find("fnprofile_view(").unwrap()..s.find("fnoverview(").unwrap()];
    assert!(
        s.find("clinical-workspace-new-entry").unwrap()
            < s.find("clinical-workspace-allergies").unwrap()
    );
    assert_eq!(s.matches("clinical-workspace-new-entry").count(), 2);
    assert!(s.contains(".justify_end()"));
    assert!(s.contains(".child(allergy_label(None,theme))"));
    let allergy = &source("shell.rs")[source("shell.rs").find("fnallergy_label(").unwrap()..];
    assert!(allergy.contains("▲Allergie:"));
    assert!(allergy.contains(".rounded(px(999.))"));
}

#[test]
fn overview_has_four_counted_tables_including_observations() {
    let s = source("shell.rs");
    let s = &s[s.find("fnoverview(").unwrap()..s.find("fndiary_view(").unwrap()];
    assert_eq!(s.matches("overview_heading(").count(), 4);
    assert!(s.contains("Misurerecenti"));
    assert!(s.contains("Controlliaperti"));
    assert!(s.contains("self.patient.observations.ready()"));
    assert!(s.contains("ReadObject::Parametri"));
}

#[test]
fn diary_has_date_margin_place_and_dry_registration() {
    let s = source("shell.rs");
    let s = &s[s.find("fndiary_view(").unwrap()..s.find("fntherapies_view(").unwrap()];
    for expected in [
        ".w(px(84.)).flex_shrink_0()",
        "entry_time(&entry.date)",
        "entry.setting",
        "TextRole::Strong",
        "diary_registration(entry.recorded_by.as_deref(),entry.created_at.as_deref(),&chrono::Local)",
        "writing_dot(WritingInk::Dry",
        "WritingInk::Dry",
        ".border_b_1()",
    ] {
        assert!(s.contains(expected), "Missing {expected}");
    }
}

#[test]
fn prose_renderer_limits_display_lines_without_rewriting_source() {
    let s = source("clinical_text.rs");
    assert!(s.contains("prose_lines(block).into_iter()"));
    assert!(s.contains("start+64"));
    assert!(s.contains(".graphemes(true)"));
}

#[test]
fn access_threshold_uses_system_role() {
    let s = source("shell.rs");
    assert!(s.contains("heading_with_role(\"clinical-workspace-connect-heading\",ifpaired{\"Accedialtuoarchivio\"}else{\"Collegaquestodispositivo\"},theme,crate::theme::TitleRole::Threshold)"));
}

#[test]
fn new_therapy_is_secondary() {
    let s = source("shell.rs");
    assert!(s.contains("\"clinical-workspace-new-therapy\",\"Nuovaterapia\",theme,false,writable"));
}
