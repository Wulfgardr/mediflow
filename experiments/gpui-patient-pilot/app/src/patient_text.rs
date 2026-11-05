use mediflow_patient_client::{ClinicalCode, PersonName};
pub fn search_name(name: &PersonName) -> String {
    name.raw_for_search().to_lowercase()
}
pub fn copy_name(name: &PersonName) -> String {
    name.raw_for_clipboard().to_owned()
}
pub fn copy_code(code: &ClinicalCode) -> String {
    code.raw_for_clipboard().to_owned()
}
pub fn edit_code(code: &ClinicalCode) -> String {
    code.raw_for_editor().to_owned()
}

/// Nome breve dell'identificativo accanto al valore: un codice senza etichetta non
/// dice che cosa sia. Il tipo dichiarato dalla home-base vince (ADR 0179); il prefisso
/// serve solo ai record che non lo portano, e STP ed ENI valgono solo se seguiti da
/// 13 cifre, perché un codice fiscale può iniziare con le stesse lettere. Stessa
/// regola del web (`lib/patient-identifier-label.ts`) e dell'app Apple
/// (`PairedPatientsWorkspaceSupport.identifierLabel`).
pub fn identifier_label(code: &ClinicalCode, identifier_type: Option<&str>) -> &'static str {
    match identifier_type {
        Some("cf") => return "CF",
        Some("stp") => return "STP",
        Some("eni") => return "ENI",
        Some("passport") => return "Documento",
        Some("other") => return "Identificativo",
        _ => {}
    }
    let normalized = code.raw_for_clipboard().trim().to_uppercase();
    for prefix in ["STP", "ENI"] {
        let temporary = normalized
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.len() == 13 && rest.bytes().all(|b| b.is_ascii_digit()));
        if temporary {
            return prefix;
        }
    }
    "CF"
}

/// Titolo per esteso, per la copia del profilo.
pub fn identifier_title(code: &ClinicalCode, identifier_type: Option<&str>) -> &'static str {
    if identifier_type == Some("none") {
        return "Identificativo";
    }
    match identifier_label(code, identifier_type) {
        "CF" => "Codice fiscale",
        "STP" => "Codice STP",
        "ENI" => "Codice ENI",
        other => other,
    }
}

/// Nascita da mostrare: la data esatta, oppure l'anno dichiarato come stima.
/// Senza questa regola un paziente con il solo anno stimato risulta «Non indicata».
pub fn birth_text(
    birth_date: Option<&str>,
    precision: Option<&str>,
    birth_year: Option<i32>,
) -> String {
    match (precision, birth_year) {
        (Some("estimated"), Some(year)) => format!("{year}, stimato"),
        _ => crate::components::display_date(birth_date),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifier_carries_its_name() {
        assert_eq!(identifier_label(&"RSSMRA80A01H501U".into(), None), "CF");
        assert_eq!(identifier_label(&"STP0300010000123".into(), None), "STP");
        assert_eq!(identifier_label(&" eni0300010000123".into(), None), "ENI");
        assert_eq!(identifier_label(&"STPMRA80A01H501U".into(), None), "CF");
        assert_eq!(identifier_label(&"ENIXXX80A01H501U".into(), None), "CF");
    }
    #[test]
    fn declared_identifier_type_wins_over_the_prefix() {
        assert_eq!(
            identifier_label(&"STP0300010000123".into(), Some("passport")),
            "Documento"
        );
        assert_eq!(
            identifier_label(&"AB1234567".into(), Some("other")),
            "Identificativo"
        );
        assert_eq!(
            identifier_label(&"ENI0300010000123".into(), Some("eni")),
            "ENI"
        );
        assert_eq!(identifier_title(&"".into(), Some("none")), "Identificativo");
        assert_eq!(
            identifier_title(&"RSSMRA80A01H501U".into(), None),
            "Codice fiscale"
        );
        assert_eq!(
            identifier_title(&"STP0300010000123".into(), Some("stp")),
            "Codice STP"
        );
    }
    #[test]
    fn estimated_birth_year_is_not_shown_as_missing() {
        assert_eq!(
            birth_text(None, Some("estimated"), Some(1982)),
            "1982, stimato"
        );
        assert_eq!(
            birth_text(Some("1954-04-18T00:00:00.000Z"), Some("exact"), None),
            "18/04/1954"
        );
        assert_eq!(birth_text(None, Some("unknown"), None), "Non indicata");
    }
    #[test]
    fn non_rendering_projections_preserve_original_text_except_search_case() {
        let name: PersonName = "D’Ángelo Мария".into();
        let code: ClinicalCode = "S52.521A".into();
        assert_eq!(search_name(&name), "d’ángelo мария");
        assert_eq!(copy_name(&name), "D’Ángelo Мария");
        assert_eq!(copy_code(&code), "S52.521A");
        assert_eq!(edit_code(&code), "S52.521A");
    }
}
