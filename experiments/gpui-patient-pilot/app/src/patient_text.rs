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

#[cfg(test)]
mod tests {
    use super::*;
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
