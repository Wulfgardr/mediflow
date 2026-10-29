//! Ordinary patient registration fields. Sparse patches preserve every field
//! outside this form; omission, clearing and setting remain distinct intentions.

use crate::editing::FieldSpec;
use mediflow_runtime_client::{
    NullableStringPatch, PatientCreateDraft, PatientDetail, PatientProfilePatch,
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
    ];
    let specifications = [
        ("clinical-workspace-patient-first-name", "Nome", false),
        ("clinical-workspace-patient-last-name", "Cognome", false),
        (
            "clinical-workspace-patient-tax-code",
            "Codice fiscale",
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
                choices: if index == 7 {
                    &[("true", "ADI"), ("false", "Non ADI")]
                } else {
                    &[]
                },
            }
        })
        .collect()
}

fn validate(values: &[String]) -> Result<(), String> {
    if values.len() != 8 {
        return Err("L'anagrafica non è completa. Riapri il modulo.".into());
    }
    if values.iter().any(|value| {
        value.contains('\0')
            || value.encode_utf16().count() > mediflow_patient_client::MAX_NOTES_UTF16
    }) {
        return Err("Un campo contiene troppo testo o caratteri non accettati.".into());
    }
    if [0, 1, 2]
        .into_iter()
        .any(|index| values[index].trim().is_empty())
    {
        return Err("Nome, cognome e codice fiscale sono richiesti.".into());
    }
    if !matches!(values[7].as_str(), "true" | "false") {
        return Err("Scegli se la scheda riguarda l'assistenza domiciliare integrata.".into());
    }
    Ok(())
}

pub fn create_draft(values: &[String]) -> Result<PatientCreateDraft, String> {
    validate(values)?;
    Ok(PatientCreateDraft {
        first_name: values[0].clone(),
        last_name: values[1].clone(),
        tax_code: values[2].clone().into(),
        birth_date: date(&values[3])?,
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
    let birth_date = if values[3] == previous[3].value {
        NullableStringPatch::Unchanged
    } else {
        date(&values[3])?.map_or(NullableStringPatch::Clear, NullableStringPatch::Set)
    };
    Ok(PatientProfilePatch {
        first_name: (values[0] != original.first_name).then(|| values[0].clone()),
        last_name: (values[1] != original.last_name).then(|| values[1].clone()),
        tax_code: (values[2] != original.tax_code.raw_for_editor()).then(|| values[2].clone()),
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
        values[2] = "SYNTHETIC02".into();
        assert!(create_draft(&values).unwrap().birth_date.is_none());
        values[3] = "2026-02-31".into();
        assert!(create_draft(&values).is_err());
        values[3] = "2000-02-29".into();
        assert_eq!(
            create_draft(&values).unwrap().birth_date.as_deref(),
            Some("2000-02-29T00:00:00.000Z")
        );
    }
}
