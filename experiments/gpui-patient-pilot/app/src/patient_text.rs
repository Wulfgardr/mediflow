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
/// dice che cosa sia. STP ed ENI solo se seguiti da 13 cifre: un codice fiscale
/// può iniziare con le stesse lettere. Stessa regola del web (`lib/patient-identifier-label.ts`) e
/// dell'app Apple (`PairedPatientsWorkspaceSupport.identifierLabel`).
pub fn identifier_label(code: &ClinicalCode) -> &'static str {
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
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifier_carries_its_name() {
        assert_eq!(identifier_label(&"RSSMRA80A01H501U".into()), "CF");
        assert_eq!(identifier_label(&"STP0300010000123".into()), "STP");
        assert_eq!(identifier_label(&" eni0300010000123".into()), "ENI");
        assert_eq!(identifier_label(&"STPMRA80A01H501U".into()), "CF");
        assert_eq!(identifier_label(&"ENIXXX80A01H501U".into()), "CF");
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
