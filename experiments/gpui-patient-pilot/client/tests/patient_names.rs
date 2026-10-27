use mediflow_patient_client::PatientProfile;

#[test]
fn patient_names_follow_surname_then_given_name_without_changing_identity() {
    let patient: PatientProfile = serde_json::from_value(serde_json::json!({
        "id":"synthetic-name", "firstName":"Luca", "lastName":"Conti", "birthDate":null,
        "taxCode":"SYNTHETIC", "notes":null, "version":1, "isArchived":false
    }))
    .unwrap();
    assert_eq!(patient.display_name(), "Conti Luca");
    assert!(patient.matches_query("conti luca"));
    assert_eq!(patient.first_name, "Luca");
    assert_eq!(patient.last_name, "Conti");
}

#[test]
fn patient_name_preserves_compound_names_and_handles_missing_parts() {
    use mediflow_patient_client::format_patient_name;
    for (first, last, expected) in [
        (
            " Maria Luisa ",
            " D’Angelo Rossi ",
            "D’Angelo Rossi Maria Luisa",
        ),
        ("Luca", "", "Luca"),
        ("", "Conti", "Conti"),
        (" ", " ", ""),
    ] {
        assert_eq!(format_patient_name(first, last), expected);
    }
}
