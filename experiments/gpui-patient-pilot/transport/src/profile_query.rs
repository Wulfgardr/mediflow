use crate::{MAX_SAFE_VERSION, PatientDetail, Result, RuntimeError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProfileProjection {
    Profile,
    Notes,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileCurrentness {
    pub revision: u64,
    pub selection_epoch: u64,
    pub observed_at: u64,
    pub expires_at: u64,
}

#[derive(Clone)]
pub(crate) struct ProfileLease {
    pub handle: Zeroizing<String>,
    pub currentness: ProfileCurrentness,
    pub deadline: Instant,
}

pub(crate) struct ProfileResponse {
    pub lease: ProfileLease,
    pub projection: ProfileProjection,
    pub fields: Value,
}

const PROFILE_FIELDS: &[&str] = &[
    "firstName",
    "lastName",
    "taxCode",
    "birthDate",
    "address",
    "phone",
    "caregiver",
    "diagnoses",
    "exemptions",
    "notes",
    "isAdi",
    "isArchived",
    "statusReason",
    "archiveReason",
    "archiveNote",
];

fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}

pub(crate) fn parse_profile_response(value: Value, started: Instant) -> Result<ProfileResponse> {
    if !exact(
        &value,
        &[
            "schemaVersion",
            "operationId",
            "contractVersion",
            "handle",
            "projection",
            "currentness",
            "profile",
        ],
    ) || value["schemaVersion"] != "mediflow.patient.profile-view.v1"
        || value["operationId"] != "patient-profile.read.v1"
        || value["contractVersion"] != 1
    {
        return Err(RuntimeError::InvalidResponse);
    }
    let handle = value["handle"]
        .as_str()
        .ok_or(RuntimeError::InvalidResponse)?;
    if handle.len() != 68
        || !handle.starts_with("pph_")
        || !handle.as_bytes()[4..]
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(RuntimeError::InvalidResponse);
    }
    let currentness: ProfileCurrentness = serde_json::from_value(value["currentness"].clone())
        .map_err(|_| RuntimeError::InvalidResponse)?;
    if currentness.revision == 0
        || currentness.selection_epoch == 0
        || [
            currentness.revision,
            currentness.selection_epoch,
            currentness.observed_at,
            currentness.expires_at,
        ]
        .iter()
        .any(|number| *number > MAX_SAFE_VERSION)
        || currentness.expires_at <= currentness.observed_at
    {
        return Err(RuntimeError::InvalidResponse);
    }
    let deadline = started
        .checked_add(Duration::from_millis(
            currentness.expires_at - currentness.observed_at,
        ))
        .ok_or(RuntimeError::InvalidResponse)?;
    if Instant::now() >= deadline {
        return Err(RuntimeError::ReadRequired);
    }
    let projection: ProfileProjection = serde_json::from_value(value["projection"].clone())
        .map_err(|_| RuntimeError::InvalidResponse)?;
    let fields = value["profile"].clone();
    let keys = if projection == ProfileProjection::Profile {
        PROFILE_FIELDS
    } else {
        &["notes"]
    };
    if !exact(&fields, keys)
        || keys.iter().any(|key| {
            let field = &fields[*key];
            match *key {
                "firstName" | "lastName" | "taxCode" => !field.is_string(),
                "isAdi" | "isArchived" => !field.is_null() && !field.is_boolean(),
                _ => !field.is_null() && !field.is_string(),
            }
        })
    {
        return Err(RuntimeError::InvalidResponse);
    }
    Ok(ProfileResponse {
        lease: ProfileLease {
            handle: Zeroizing::new(handle.to_owned()),
            currentness,
            deadline,
        },
        projection,
        fields,
    })
}

pub(crate) fn display_profile(
    fields: Value,
    patient_id: &str,
    currentness: ProfileCurrentness,
    locked_fields: Vec<String>,
) -> Result<PatientDetail> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Fields {
        first_name: String,
        last_name: String,
        tax_code: String,
        birth_date: Option<String>,
        address: Option<String>,
        phone: Option<String>,
        caregiver: Option<String>,
        diagnoses: Option<String>,
        exemptions: Option<String>,
        notes: Option<String>,
        is_adi: Option<bool>,
        is_archived: Option<bool>,
        status_reason: Option<String>,
        archive_reason: Option<String>,
        archive_note: Option<String>,
    }
    let field: Fields =
        serde_json::from_value(fields).map_err(|_| RuntimeError::InvalidResponse)?;
    Ok(PatientDetail {
        id: patient_id.to_owned(),
        first_name: field.first_name,
        last_name: field.last_name,
        tax_code: field.tax_code.into(),
        birth_date: field.birth_date,
        address: field.address,
        phone: field.phone,
        caregiver: field.caregiver,
        diagnoses: field.diagnoses,
        exemptions: field.exemptions,
        notes: field.notes,
        is_adi: field.is_adi.unwrap_or(false),
        is_archived: field.is_archived.unwrap_or(false),
        status_reason: field.status_reason,
        archive_reason: field.archive_reason,
        archive_note: field.archive_note,
        version: currentness.revision,
        ambulatory_id: None,
        monitoring_profile: None,
        created_at: None,
        updated_at: None,
        deleted_at: None,
        locked_fields,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn response() -> Value {
        json!({"schemaVersion":"mediflow.patient.profile-view.v1","operationId":"patient-profile.read.v1","contractVersion":1,
            "handle":format!("pph_{}", "a".repeat(64)),"projection":"profile",
            "currentness":{"revision":7,"selectionEpoch":3,"observedAt":1000,"expiresAt":61000},
            "profile":{"firstName":"Amina","lastName":"Sintetica","taxCode":"SYNTHETIC","birthDate":null,
                "address":null,"phone":null,"caregiver":null,"diagnoses":null,"exemptions":null,"notes":null,
                "isAdi":false,"isArchived":false,"statusReason":null,"archiveReason":null,"archiveNote":null}})
    }

    #[test]
    fn exact_wire_preserves_revision_and_uses_only_the_locally_selected_identity() {
        let parsed = parse_profile_response(response(), Instant::now()).unwrap();
        let row = display_profile(
            parsed.fields,
            "selected-synthetic-patient",
            parsed.lease.currentness,
            vec![],
        )
        .unwrap();
        assert_eq!(row.id, "selected-synthetic-patient");
        assert_eq!(row.version, 7);
        assert!(row.ambulatory_id.is_none());
        assert_eq!(row.first_name, "Amina");
    }

    #[test]
    fn response_rejects_storage_ids_unknown_fields_missing_groups_and_invalid_metadata() {
        for field in ["id", "ambulatoryId", "path", "sql", "aiSummary"] {
            let mut value = response();
            value["profile"][field] = json!("forbidden");
            assert!(matches!(
                parse_profile_response(value, Instant::now()),
                Err(RuntimeError::InvalidResponse)
            ));
        }
        for field in PROFILE_FIELDS {
            let mut value = response();
            value["profile"].as_object_mut().unwrap().remove(*field);
            assert!(matches!(
                parse_profile_response(value, Instant::now()),
                Err(RuntimeError::InvalidResponse)
            ));
        }
        for (field, invalid) in [
            ("revision", json!(0)),
            ("selectionEpoch", json!(0)),
            ("observedAt", json!(-1)),
            ("expiresAt", json!(1000)),
            ("revision", json!(MAX_SAFE_VERSION + 1)),
        ] {
            let mut value = response();
            value["currentness"][field] = invalid;
            assert!(matches!(
                parse_profile_response(value, Instant::now()),
                Err(RuntimeError::InvalidResponse)
            ));
        }
        for (field, invalid) in [
            ("schemaVersion", json!("unknown")),
            ("operationId", json!("patient-profile.update.v1")),
            ("contractVersion", json!(2)),
            ("handle", json!(format!("pph_{}", "A".repeat(64)))),
        ] {
            let mut value = response();
            value[field] = invalid;
            assert!(matches!(
                parse_profile_response(value, Instant::now()),
                Err(RuntimeError::InvalidResponse)
            ));
        }
    }

    #[test]
    fn notes_is_a_distinct_projection_and_never_fills_omitted_identity_with_empty_data() {
        let mut value = response();
        value["projection"] = json!("notes");
        value["profile"] = json!({"notes":null});
        let parsed = parse_profile_response(value.clone(), Instant::now()).unwrap();
        assert!(parsed.projection == ProfileProjection::Notes);
        assert!(
            display_profile(parsed.fields, "patient-a", parsed.lease.currentness, vec![]).is_err()
        );
        value["profile"]["firstName"] = json!("extra");
        assert!(matches!(
            parse_profile_response(value, Instant::now()),
            Err(RuntimeError::InvalidResponse)
        ));
    }

    #[test]
    fn a_response_that_outlives_its_ttl_cannot_become_a_read_receipt() {
        let mut value = response();
        value["currentness"]["expiresAt"] = json!(1001);
        assert!(matches!(
            parse_profile_response(value, Instant::now() - Duration::from_secs(1)),
            Err(RuntimeError::ReadRequired)
        ));
    }
}
