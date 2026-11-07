//! Ordinary patient registration fields. Sparse patches preserve every field
//! outside this form; omission, clearing and setting remain distinct intentions.

use crate::editing::FieldSpec;
use chrono::Datelike;
use mediflow_runtime_client::patient_identity::{inferred_type, normalize, validate_identifier};
use mediflow_runtime_client::{
    NullableStringPatch, NullableYearPatch, PatientCreateDraft, PatientDetail, PatientProfilePatch,
    ProfileQueryIntent, RuntimeError, RuntimeSession,
};

const LOCKED_LABEL: &str = "Dato non leggibile con questo accesso. Il campo resta invariato.";

pub fn fields(original: Option<&PatientDetail>) -> Vec<FieldSpec> {
    let values = if let Some(row) = original {
        vec![
            row.first_name.clone(),
            row.last_name.clone(),
            row.tax_code.raw_for_editor().to_owned(),
            row.birth_date.as_deref().map(day).unwrap_or_default(),
            row.address.clone().unwrap_or_default(),
            row.phone.clone().unwrap_or_default(),
            row.caregiver.clone().unwrap_or_default(),
            row.is_adi.to_string(),
            row.identifier_type
                .clone()
                .unwrap_or_else(|| inferred_type(row.tax_code.raw_for_editor()).into()),
            effective_precision(row).into(),
            row.birth_year
                .map(|year| year.to_string())
                .unwrap_or_default(),
        ]
    } else {
        vec![
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            "false".into(),
            "cf".into(),
            "unknown".into(),
            String::new(),
        ]
    };
    let names = [
        "firstName",
        "lastName",
        "taxCode",
        "birthDate",
        "address",
        "phone",
        "caregiver",
        "isAdi",
        "identifierType",
        "birthDatePrecision",
        "birthYear",
    ];
    let specifications = [
        ("clinical-workspace-patient-first-name", "Nome", false),
        ("clinical-workspace-patient-last-name", "Cognome", false),
        (
            "clinical-workspace-patient-tax-code",
            "Valore identificativo",
            false,
        ),
        (
            "clinical-workspace-patient-birth-date",
            "Data di nascita, se presente (AAAA-MM-GG)",
            false,
        ),
        ("clinical-workspace-patient-address", "Indirizzo", true),
        ("clinical-workspace-patient-phone", "Telefono", false),
        (
            "clinical-workspace-patient-caregiver",
            "Persona di riferimento",
            true,
        ),
        (
            "clinical-workspace-patient-adi",
            "Assistenza domiciliare integrata",
            false,
        ),
        (
            "clinical-workspace-patient-identifier-type",
            "Identificativo",
            false,
        ),
        (
            "clinical-workspace-patient-birth-precision",
            "Nascita",
            false,
        ),
        (
            "clinical-workspace-patient-birth-year",
            "Anno di nascita stimato",
            false,
        ),
    ];
    specifications
        .into_iter()
        .zip(values)
        .enumerate()
        .map(|(index, ((id, label, multiline), value))| {
            let locked = original.is_some_and(|row| row.field_locked(names[index]));
            FieldSpec {
                id,
                label,
                value: if locked { LOCKED_LABEL.into() } else { value },
                multiline,
                rich: locked,
                choices: match index {
                    7 => &[("true", "ADI"), ("false", "Non ADI")],
                    8 => &[
                        ("cf", "Codice fiscale"),
                        ("stp", "Codice STP"),
                        ("eni", "Codice ENI"),
                        ("passport", "Documento estero"),
                        ("other", "Altro identificativo"),
                        ("none", "Nessun identificativo per ora"),
                    ],
                    9 => &[
                        ("unknown", "Non conosciuta"),
                        ("exact", "Data completa"),
                        ("estimated", "Conosco solo l’anno (stima)"),
                    ],
                    _ => &[],
                },
            }
        })
        .collect()
}

pub fn visible_field_indices(values: &[String]) -> Vec<usize> {
    if values.len() != 11 {
        return (0..values.len()).collect();
    }
    let mut indices = vec![0, 1, 8];
    if values[8] != "none" {
        indices.push(2);
    }
    indices.push(9);
    if values[9] == "exact" {
        indices.push(3);
    }
    if values[9] == "estimated" {
        indices.push(10);
    }
    indices.extend([4, 5, 6, 7]);
    indices
}

fn validate(values: &[String]) -> Result<(), String> {
    if values.len() != 11 {
        return Err("L'anagrafica non è completa. Riapri il modulo.".into());
    }
    if values.iter().any(|value| {
        value.contains('\0')
            || value.encode_utf16().count() > mediflow_patient_client::MAX_NOTES_UTF16
    }) {
        return Err("Un campo contiene troppo testo o caratteri non accettati.".into());
    }
    if [0, 1]
        .into_iter()
        .any(|index| values[index].trim().is_empty())
    {
        return Err("Nome e cognome sono richiesti.".into());
    }
    if !matches!(values[7].as_str(), "true" | "false") {
        return Err("Scegli se la scheda riguarda l'assistenza domiciliare integrata.".into());
    }
    Ok(())
}

pub fn create_draft(values: &[String]) -> Result<PatientCreateDraft, String> {
    validate(values)?;
    let code = normalize(&values[8], &values[2]);
    validate_identifier(&values[8], &code)?;
    let (precision, birth_date, birth_year) = birth(values)?;
    Ok(PatientCreateDraft {
        first_name: values[0].clone(),
        last_name: values[1].clone(),
        tax_code: code.into(),
        identifier_type: Some(values[8].clone()),
        birth_date_precision: Some(precision),
        birth_year,
        birth_date,
        address: nonblank(&values[4]),
        phone: nonblank(&values[5]),
        caregiver: nonblank(&values[6]),
        is_adi: values[7] == "true",
    })
}

pub fn profile_patch(
    original: &PatientDetail,
    values: &[String],
) -> Result<PatientProfilePatch, String> {
    validate(values)?;
    if original.is_archived || original.deleted_at.is_some() {
        return Err("La scheda archiviata è in sola lettura.".into());
    }
    let previous = fields(Some(original));
    if previous
        .iter()
        .zip(values)
        .all(|(field, value)| &field.value == value)
    {
        return Err("Nessuna modifica da registrare.".into());
    }
    for (field, value) in previous.iter().zip(values) {
        if field.rich && &field.value != value {
            return Err(
                "Un campo non leggibile non può essere sostituito da questo modulo.".into(),
            );
        }
    }
    let nullable = |index: usize, name: &str, previous: Option<&String>| {
        if original.field_locked(name) || values[index] == previous.map_or("", String::as_str) {
            NullableStringPatch::Unchanged
        } else if values[index].trim().is_empty() {
            NullableStringPatch::Clear
        } else {
            NullableStringPatch::Set(values[index].clone())
        }
    };
    let identity_changed = values[2] != previous[2].value || values[8] != previous[8].value;
    let birth_changed = [3, 9, 10]
        .into_iter()
        .any(|i| values[i] != previous[i].value);
    let code = normalize(&values[8], &values[2]);
    if identity_changed {
        validate_identifier(&values[8], &code)?;
    }
    let birth = if birth_changed || identity_changed {
        Some(birth(values)?)
    } else {
        None
    };
    let (birth_date, birth_date_precision, birth_year) = if birth_changed {
        let (precision, date, year) = birth.unwrap();
        (
            date.map_or(NullableStringPatch::Clear, NullableStringPatch::Set),
            Some(precision),
            year.map_or(NullableYearPatch::Clear, NullableYearPatch::Set),
        )
    } else {
        (
            NullableStringPatch::Unchanged,
            None,
            NullableYearPatch::Unchanged,
        )
    };
    Ok(PatientProfilePatch {
        first_name: (values[0] != original.first_name).then(|| values[0].clone()),
        last_name: (values[1] != original.last_name).then(|| values[1].clone()),
        tax_code: identity_changed.then_some(code),
        identifier_type: identity_changed.then(|| values[8].clone()),
        birth_date_precision,
        birth_year,
        birth_date,
        address: nullable(4, "address", original.address.as_ref()),
        phone: nullable(5, "phone", original.phone.as_ref()),
        caregiver: nullable(6, "caregiver", original.caregiver.as_ref()),
        is_adi: ((values[7] == "true") != original.is_adi).then_some(values[7] == "true"),
    })
}

pub enum Creation {
    Verified(Box<PatientDetail>),
    Unconfirmed {
        id: String,
        read_error: Option<RuntimeError>,
    },
}

pub fn create(
    session: &RuntimeSession,
    scope: &str,
    values: &[String],
    intent: &ProfileQueryIntent,
) -> Result<Creation, RuntimeError> {
    let draft = create_draft(values).map_err(|_| RuntimeError::InvalidInput)?;
    let created = session.create_patient(scope, &draft)?;
    if let Err(error) = session.bind_created_profile(scope, &created.id, intent) {
        if error.retires_session() {
            return Err(error);
        }
        return Ok(Creation::Unconfirmed {
            id: created.id,
            read_error: Some(error),
        });
    }
    match session.open_patient_profile(scope, &created.id, intent) {
        Ok(row)
            if row.id == created.id
                && row.version == 1
                && !row.is_archived
                && row.deleted_at.is_none()
                && row.first_name == draft.first_name
                && row.last_name == draft.last_name
                && row.tax_code == draft.tax_code
                && row.identifier_type == draft.identifier_type
                && effective_precision(&row)
                    == draft.birth_date_precision.as_deref().unwrap_or("unknown")
                && row.birth_year == draft.birth_year
                && same_day(row.birth_date.as_deref(), draft.birth_date.as_deref())
                && row.address == draft.address
                && row.phone == draft.phone
                && row.caregiver == draft.caregiver
                && row.is_adi == draft.is_adi
                && !["address", "phone", "caregiver"]
                    .into_iter()
                    .any(|field| row.field_locked(field)) =>
        {
            Ok(Creation::Verified(Box::new(row)))
        }
        Err(error) if error.retires_session() => Err(error),
        Err(RuntimeError::ProfileTooLarge) => Ok(Creation::Unconfirmed {
            id: created.id,
            read_error: Some(RuntimeError::ProfileTooLarge),
        }),
        _ => Ok(Creation::Unconfirmed {
            id: created.id,
            read_error: None,
        }),
    }
}

pub fn update(
    session: &RuntimeSession,
    scope: &str,
    original: &PatientDetail,
    values: &[String],
    intent: &ProfileQueryIntent,
) -> Result<Option<PatientDetail>, RuntimeError> {
    let patch = profile_patch(original, values).map_err(|_| RuntimeError::InvalidInput)?;
    let expected = original
        .version
        .checked_add(1)
        .ok_or(RuntimeError::InvalidInput)?;
    session.update_patient_profile(scope, &original.id, original.version, &patch)?;
    match session.open_patient_profile(scope, &original.id, intent) {
        Ok(row)
            if row.id == original.id
                && row.version == expected
                && !row.is_archived
                && row.deleted_at.is_none()
                && patch
                    .first_name
                    .as_ref()
                    .is_none_or(|value| &row.first_name == value)
                && patch
                    .last_name
                    .as_ref()
                    .is_none_or(|value| &row.last_name == value)
                && patch
                    .tax_code
                    .as_ref()
                    .is_none_or(|value| row.tax_code.raw_for_editor() == value)
                && patch
                    .identifier_type
                    .as_ref()
                    .is_none_or(|kind| row.identifier_type.as_ref() == Some(kind))
                && patch
                    .birth_date_precision
                    .as_ref()
                    .is_none_or(|p| effective_precision(&row) == p)
                && match patch.birth_year {
                    NullableYearPatch::Unchanged => true,
                    NullableYearPatch::Clear => row.birth_year.is_none(),
                    NullableYearPatch::Set(year) => row.birth_year == Some(year),
                }
                && matches_nullable(&patch.birth_date, row.birth_date.as_deref(), true)
                && matches_nullable(&patch.address, row.address.as_deref(), false)
                && matches_nullable(&patch.phone, row.phone.as_deref(), false)
                && matches_nullable(&patch.caregiver, row.caregiver.as_deref(), false)
                && patch.is_adi.is_none_or(|value| row.is_adi == value)
                && [
                    (&patch.address, "address"),
                    (&patch.phone, "phone"),
                    (&patch.caregiver, "caregiver"),
                ]
                .into_iter()
                .all(|(patch, field)| patch.is_unchanged() || !row.field_locked(field)) =>
        {
            Ok(Some(row))
        }
        Err(error) if error.retires_session() || error == RuntimeError::ProfileTooLarge => {
            Err(error)
        }
        _ => Ok(None),
    }
}

fn effective_precision(row: &PatientDetail) -> &str {
    if row.birth_date_precision.as_deref() == Some("estimated") {
        "estimated"
    } else if row.birth_date.is_some() {
        "exact"
    } else if row.birth_year.is_some() {
        "estimated"
    } else {
        "unknown"
    }
}
fn birth(values: &[String]) -> Result<(String, Option<String>, Option<i32>), String> {
    let (date, year) = match values[9].as_str() {
        "exact" => {
            let parsed = date(&values[3])?.ok_or("Inserisci la data di nascita completa.")?;
            let day = chrono::NaiveDate::parse_from_str(&values[3], "%Y-%m-%d")
                .map_err(|_| "Inserisci una data di nascita valida nel formato AAAA-MM-GG.")?;
            if day > chrono::Local::now().date_naive() {
                return Err("La data di nascita non può essere futura.".into());
            }
            (Some(parsed), None)
        }
        "estimated" => {
            let year = values[10]
                .parse::<i32>()
                .map_err(|_| "Inserisci un anno di nascita stimato valido.")?;
            if year < 1850 || year > chrono::Local::now().year() {
                return Err("Inserisci un anno di nascita stimato valido, non futuro.".into());
            }
            (None, Some(year))
        }
        "unknown" if values[8] != "none" => (None, None),
        "unknown" => {
            return Err(
                "Senza identificativo serve la data di nascita oppure l’anno stimato.".into(),
            );
        }
        _ => return Err("Scegli quanto conosci della data di nascita.".into()),
    };
    Ok((values[9].clone(), date, year))
}

fn day(value: &str) -> String {
    value
        .get(..10)
        .filter(|value| value.is_ascii())
        .unwrap_or(value)
        .to_owned()
}
fn same_day(left: Option<&str>, right: Option<&str>) -> bool {
    left.map(day) == right.map(day)
}
fn nonblank(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.to_owned())
}
fn date(value: &str) -> Result<Option<String>, String> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    let parsed = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "Inserisci una data di nascita valida nel formato AAAA-MM-GG.".to_owned())?;
    if parsed.format("%Y-%m-%d").to_string() != value {
        return Err("Inserisci la data di nascita completa nel formato AAAA-MM-GG.".into());
    }
    if !(1..=9999).contains(&parsed.year()) {
        return Err("Inserisci la data di nascita nel formato AAAA-MM-GG.".into());
    }
    Ok(Some(format!("{value}T00:00:00.000Z")))
}
fn matches_nullable(patch: &NullableStringPatch, value: Option<&str>, calendar_day: bool) -> bool {
    match patch {
        NullableStringPatch::Unchanged => true,
        NullableStringPatch::Clear => value.is_none(),
        NullableStringPatch::Set(expected) => {
            if calendar_day {
                same_day(value, Some(expected))
            } else {
                value == Some(expected)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn patient() -> PatientDetail {
        serde_json::from_value(serde_json::json!({"id":"patient-1","firstName":"Elena","lastName":"Moretti","taxCode":"SYNTHETIC01","birthDate":"1954-04-18T00:00:00.000Z","address":"Via di prova","phone":"123","caregiver":null,"notes":"Nota da preservare","version":5})).unwrap()
    }
    fn adr0179_values(kind: &str, code: &str, precision: &str, year: &str) -> Vec<String> {
        let mut specs = fields(None);
        for (id, value) in [
            ("clinical-workspace-patient-first-name", "Ada"),
            ("clinical-workspace-patient-last-name", "Sintetica"),
            ("clinical-workspace-patient-tax-code", code),
            ("clinical-workspace-patient-identifier-type", kind),
            ("clinical-workspace-patient-birth-precision", precision),
            ("clinical-workspace-patient-birth-year", year),
        ] {
            if let Some(field) = specs.iter_mut().find(|field| field.id == id) {
                field.value = value.into();
            }
        }
        specs.into_iter().map(|field| field.value).collect()
    }

    #[test]
    fn adr0179_create_all_declared_identifiers_and_estimated_birth() {
        for (kind, code) in [
            ("none", ""),
            ("stp", "STP1234567890123"),
            ("eni", "ENI1234567890123"),
            ("passport", "Doc-Abc"),
            ("other", "Altro-42"),
        ] {
            let draft = create_draft(&adr0179_values(kind, code, "estimated", "1974")).unwrap();
            let json = serde_json::to_value(draft).unwrap();
            assert_eq!(json["identifierType"], kind);
            assert_eq!(json["taxCode"], code);
            assert_eq!(json["birthDatePrecision"], "estimated");
            assert_eq!(json["birthYear"], 1974);
            assert!(json.get("birthDate").is_none_or(serde_json::Value::is_null));
        }
    }

    #[test]
    fn adr0179_create_validates_cf_only_for_cf() {
        assert!(create_draft(&adr0179_values("cf", "INVALIDO", "unknown", "")).is_err());
        assert!(create_draft(&adr0179_values("passport", "INVALIDO", "unknown", "")).is_ok());
    }

    #[test]
    fn adr0179_edit_loads_declared_type_and_birth_precision() {
        let row: PatientDetail = serde_json::from_value(serde_json::json!({
            "id":"p1","firstName":"Ada","lastName":"Sintetica","taxCode":"Doc-Abc",
            "identifierType":"passport","birthDatePrecision":"estimated","birthYear":1974,"version":4
        })).unwrap();
        let specs = fields(Some(&row));
        for (id, expected) in [
            ("clinical-workspace-patient-identifier-type", "passport"),
            ("clinical-workspace-patient-birth-precision", "estimated"),
            ("clinical-workspace-patient-birth-year", "1974"),
        ] {
            assert_eq!(
                specs
                    .iter()
                    .find(|field| field.id == id)
                    .map(|field| field.value.as_str()),
                Some(expected)
            );
        }
        let mut values: Vec<_> = specs.into_iter().map(|field| field.value).collect();
        values[0] = "Adele".into();
        assert_eq!(
            serde_json::to_value(profile_patch(&row, &values).unwrap()).unwrap(),
            serde_json::json!({"firstName":"Adele"})
        );
    }

    #[test]
    fn adr0179_extended_year_birth_date_is_a_validation_error_not_a_panic() {
        for value in ["-0001-01-01", "+12345-01-01", "0000-01-01"] {
            let mut values = adr0179_values("none", "", "exact", "");
            values[3] = value.into();
            let outcome = std::panic::catch_unwind(|| create_draft(&values).map(|_| ()));
            assert!(
                matches!(outcome, Ok(Err(_))),
                "{value} must be rejected with a message"
            );
        }
    }

    #[test]
    fn adr0179_exact_birth_and_identity_changes_use_explicit_nullable_patches() {
        let mut values = adr0179_values("none", "", "exact", "");
        values[3] = "1974-02-28".into();
        let draft = serde_json::to_value(create_draft(&values).unwrap()).unwrap();
        assert_eq!(draft["birthDate"], "1974-02-28T00:00:00.000Z");
        assert_eq!(draft["birthDatePrecision"], "exact");
        assert!(draft.get("birthYear").is_none());
        let row: PatientDetail = serde_json::from_value(serde_json::json!({
            "id":"p1","firstName":"Ada","lastName":"Sintetica","taxCode":"",
            "identifierType":"none","birthDatePrecision":"estimated","birthYear":1974,"version":4
        }))
        .unwrap();
        let mut values: Vec<_> = fields(Some(&row))
            .into_iter()
            .map(|field| field.value)
            .collect();
        values[0] = "Adele".into();
        assert_eq!(
            serde_json::to_value(profile_patch(&row, &values).unwrap()).unwrap(),
            serde_json::json!({"firstName":"Adele"})
        );
        values[3] = "1974-02-28".into();
        values[9] = "exact".into();
        let patch = serde_json::to_value(profile_patch(&row, &values).unwrap()).unwrap();
        assert_eq!(patch["birthDatePrecision"], "exact");
        assert_eq!(patch["birthDate"], "1974-02-28T00:00:00.000Z");
        assert!(patch["birthYear"].is_null());
        values[8] = "other".into();
        values[2] = "Doc-Abc".into();
        values[9] = "unknown".into();
        let patch = serde_json::to_value(profile_patch(&row, &values).unwrap()).unwrap();
        assert_eq!(patch["identifierType"], "other");
        assert_eq!(patch["taxCode"], "Doc-Abc");
        assert_eq!(patch["birthDatePrecision"], "unknown");
        assert!(patch["birthDate"].is_null());
        assert!(patch["birthYear"].is_null());
    }

    #[test]
    fn adr0179_historical_invalid_cf_can_be_edited_and_only_active_birth_fields_are_visible() {
        let row = patient();
        let mut values: Vec<_> = fields(Some(&row))
            .into_iter()
            .map(|field| field.value)
            .collect();
        values[0] = "Adele".into();
        assert!(profile_patch(&row, &values).is_ok());
        values[2] = "NUOVO-CF-ERRATO".into();
        assert!(profile_patch(&row, &values).is_err());
        let values = adr0179_values("none", "", "estimated", "1974");
        assert_eq!(
            visible_field_indices(&values),
            vec![0, 1, 8, 9, 10, 4, 5, 6, 7]
        );
        assert!(create_draft(&adr0179_values("none", "", "unknown", "")).is_err());
        for year in ["1849", "9999", "non noto"] {
            assert!(create_draft(&adr0179_values("none", "", "estimated", year)).is_err());
        }
        for code in ["RSSMRA80A01H501U", "RSSMRA80A01H50MM"] {
            assert!(create_draft(&adr0179_values("cf", code, "unknown", "")).is_ok());
        }
        assert!(create_draft(&adr0179_values("stp", "STP123", "unknown", "")).is_err());
        assert!(create_draft(&adr0179_values("other", "A\nB", "unknown", "")).is_err());
    }

    #[test]
    fn changing_a_name_emits_only_that_field_and_never_reserializes_notes() {
        let row = patient();
        let mut values = fields(Some(&row))
            .into_iter()
            .map(|field| field.value)
            .collect::<Vec<_>>();
        values[0] = "Èlena 🩺".into();
        let patch = profile_patch(&row, &values).unwrap();
        assert_eq!(
            serde_json::to_value(patch).unwrap(),
            serde_json::json!({"firstName":"Èlena 🩺"})
        );
    }
    #[test]
    fn clearing_a_field_differs_from_omitting_it_and_locked_fields_are_preserved() {
        let mut row = patient();
        row.locked_fields.push("address".into());
        let mut values = fields(Some(&row))
            .into_iter()
            .map(|field| field.value)
            .collect::<Vec<_>>();
        values[5].clear();
        let patch = profile_patch(&row, &values).unwrap();
        assert_eq!(
            serde_json::to_value(patch).unwrap(),
            serde_json::json!({"phone":null})
        );
        values[4] = "Sostituzione".into();
        assert!(profile_patch(&row, &values).is_err());
    }
    #[test]
    fn creation_keeps_missing_dates_missing_and_rejects_invalid_calendar_days() {
        let mut values = fields(None)
            .into_iter()
            .map(|field| field.value)
            .collect::<Vec<_>>();
        values[0] = "Nome".into();
        values[1] = "Cognome".into();
        values[2] = "RSSMRA80A01H501U".into();
        assert!(create_draft(&values).unwrap().birth_date.is_none());
        values[9] = "exact".into();
        values[3] = "2026-02-31".into();
        assert!(create_draft(&values).is_err());
        values[3] = "2000-02-29".into();
        assert_eq!(
            create_draft(&values).unwrap().birth_date.as_deref(),
            Some("2000-02-29T00:00:00.000Z")
        );
    }
}
