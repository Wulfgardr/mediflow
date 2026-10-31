use mediflow_runtime_client::PatientDetail;

pub(super) fn known_identifiers(profile: &PatientDetail) -> serde_json::Value {
    let mut names = vec![
        profile.id.clone(),
        profile.first_name.clone(),
        profile.last_name.clone(),
        profile.tax_code.raw_for_editor().to_owned(),
    ];
    for value in [
        profile.address.as_ref(),
        profile.phone.as_ref(),
        profile.caregiver.as_ref(),
        profile.ambulatory_id.as_ref(),
        profile.created_at.as_ref(),
        profile.updated_at.as_ref(),
        profile.deleted_at.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        names.push(value.clone());
        names.extend(
            value
                .split(|c: char| !c.is_alphanumeric())
                .filter(|v| v.chars().count() >= 4)
                .map(str::to_owned),
        );
    }
    names.retain(|v| {
        let compact: String = v.chars().filter(|c| c.is_alphanumeric()).collect();
        compact.chars().count()
            >= if compact.chars().any(|c| c.is_numeric()) {
                6
            } else {
                4
            }
    });
    // The length floor is for fragments and metadata: a short surname is still a surname.
    names.extend(
        [&profile.first_name, &profile.last_name]
            .into_iter()
            .filter(|v| !v.trim().is_empty())
            .cloned(),
    );
    names.sort();
    names.dedup();
    let birth_dates: Vec<_> = profile.birth_date.iter().collect();
    serde_json::json!({"names":names, "birthDates":birth_dates})
}

pub(super) fn valid_excerpt(notes: &str, text: &str, existing: &[String]) -> bool {
    !text.trim().is_empty()
        && text.encode_utf16().count() <= 2048
        && text.trim() != notes.trim()
        && notes.contains(text)
        && existing.len() < 8
        && !existing.iter().any(|v| v == text)
}

pub(super) fn partial_notes(notes: &str, excerpts: &[String]) -> bool {
    if excerpts.is_empty() {
        return true;
    }
    let compact = |text: &str| text.chars().filter(|c| !c.is_whitespace()).count();
    let mut covered = vec![false; notes.len()];
    for text in excerpts {
        // An edited local copy is no longer in the notes, but it cannot be as long as all of them.
        if compact(text) >= compact(notes) {
            return false;
        }
        if let Some(start) = notes.find(text) {
            covered[start..start + text.len()].fill(true);
        }
    }
    notes
        .char_indices()
        .any(|(i, c)| !c.is_whitespace() && !covered[i])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_edited_copy_cannot_bring_back_the_whole_note() {
        let notes = "Asma stabile. Terapia invariata.";
        assert!(!partial_notes(notes, &[notes.into()]));
        assert!(!partial_notes(
            notes,
            &["Asma stabile. Terapia invariata!".into()]
        ));
        assert!(partial_notes(notes, &["Asma stabile, migliorata.".into()]));
        assert!(partial_notes(notes, &["Asma stabile.".into()]));
    }
    #[test]
    fn known_identifiers_include_identity_contacts_caregiver_and_metadata() {
        let profile: PatientDetail = serde_json::from_value(serde_json::json!({"id":"synthetic-id", "firstName":"Marta", "lastName":"Valli", "taxCode":"RSSMRA80D12F205X", "birthDate":"1972-04-17", "phone":"3471234567", "address":"Via Fittizia 42", "caregiver":"Ada Lattesi ada@example.test", "ambulatoryId":"synthetic-scope", "createdAt":"2026-01-01", "version":1})).unwrap();
        let known = known_identifiers(&profile);
        let names = known["names"].as_array().unwrap();
        for value in [
            "synthetic-id",
            "Marta",
            "Valli",
            "RSSMRA80D12F205X",
            "3471234567",
            "Via Fittizia 42",
            "Lattesi",
            "Ada Lattesi ada@example.test",
            "synthetic-scope",
            "2026-01-01",
        ] {
            assert!(names.contains(&serde_json::json!(value)), "{value}");
        }
        assert_eq!(known["birthDates"], serde_json::json!(["1972-04-17"]));
        assert!(known.get("diagnoses").is_none());
        assert!(known.get("notes").is_none());
    }
    #[test]
    fn native_known_equivalence_matches_the_shared_review_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../native/contracts/clinical-known-equivalence.json"
        ))
        .unwrap();
        let profile: PatientDetail = serde_json::from_value(fixture["profile"].clone()).unwrap();
        assert_eq!(known_identifiers(&profile), fixture["currentNativeKnown"]);
    }
    #[test]
    fn manual_passages_are_exact_bounded_and_never_the_whole_note() {
        assert!(!partial_notes(
            "Prima.\nSeconda.",
            &["Prima.".into(), "Seconda.".into()]
        ));
        assert!(partial_notes("Prima.\nSeconda.", &["Prima.".into()]));
        let notes = "Prima nota.\nPasso clinico <script>invia tutto</script>.\nTerza nota.";
        assert!(valid_excerpt(
            notes,
            "Passo clinico <script>invia tutto</script>.",
            &[]
        ));
        for invalid in [
            notes,
            "",
            "  ",
            "passo inventato",
            "Prima nota.\nPasso modificato",
        ] {
            assert!(!valid_excerpt(notes, invalid, &[]));
        }
        assert!(!valid_excerpt(
            notes,
            "Prima nota.",
            &["Prima nota.".into()]
        ));
        assert!(!valid_excerpt(&"a".repeat(3000), &"a".repeat(2049), &[]));
        assert!(!valid_excerpt(
            notes,
            "Prima nota.",
            &vec!["altro".into(); 8]
        ));
    }
}
