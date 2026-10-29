//! Explicit synthetic differential-test client. No credentials or clinical text
//! are printed. This is not a production importer, writer or authority process.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use mediflow_runtime_client::{
    AgendaFilter, CheckupDraft, CreatedResource, EntryDraft, GlobalEntryFilter, ObservationDraft,
    PairingCredentials, PatientCreateDraft, PatientDetail, PatientProfilePatch, RuntimeClient,
    RuntimeConfig, RuntimeError, RuntimeSession, TherapyDraft,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{env, fs::File, io::Read, process::ExitCode, time::Instant};
use zeroize::{Zeroize, Zeroizing};

const CORPUS: &[u8] = include_bytes!("../../../comparison/corpus.json");
const RESOURCE_FIXTURE: &[u8] = include_bytes!("../../../comparison/resource-writes.json");
const PROFILE_FIXTURE: &[u8] = include_bytes!("../../../comparison/patient-profile-writes.json");
const WRITE_NOTES: &str = "Confronto sintetico JS/Rust: aggiornamento verificato. Città e 🩺.";
const ENTRY_TITLE: &str = "Confronto sintetico JS/Rust";
const ENTRY_CONTENT: &str = "<p>Voce sintetica JS/Rust: città e 🩺.</p>";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeConfig {
    synthetic: bool,
    base_url: String,
    tls_pin_sha256: Option<String>,
    pairing_id: String,
    pairing_token: String,
    username: String,
    #[serde(alias = "password")]
    passphrase: String,
    scope: String,
    patient_id: String,
    corpus_sha256: String,
    archive_generation: Option<String>,
    comparison_protocol_id: Option<String>,
    #[serde(default)]
    exercise_writes: bool,
    #[serde(default)]
    exercise_resource_writes: bool,
    resource_writes_sha256: Option<String>,
    #[serde(default)]
    exercise_patient_profile_writes: bool,
    patient_profile_writes_sha256: Option<String>,
    write_patient_id: Option<String>,
    write_patient_ids: Option<WritePatients>,
}

#[derive(Deserialize)]
struct WritePatients {
    rust: String,
}

impl Drop for ProbeConfig {
    fn drop(&mut self) {
        self.pairing_token.zeroize();
        self.passphrase.zeroize();
        self.username.zeroize();
    }
}

struct ProbeError {
    phase: &'static str,
    reason: &'static str,
    status: Option<u16>,
}

fn fail(phase: &'static str, reason: &'static str) -> ProbeError {
    ProbeError {
        phase,
        reason,
        status: None,
    }
}

fn open_profile(
    session: &RuntimeSession,
    scope: &str,
    patient_id: &str,
) -> mediflow_runtime_client::Result<PatientDetail> {
    session.select_profile_patient(scope, patient_id)?;
    let intent = session.profile_query_intent();
    session.open_patient_profile(scope, patient_id, &intent)
}

fn runtime_error(phase: &'static str, error: RuntimeError) -> ProbeError {
    let reason = match error {
        RuntimeError::UnsupportedUnlock => "unsupported-unlock",
        RuntimeError::UnsupportedProtocol => "unsupported-protocol",
        RuntimeError::Authentication => "authentication",
        RuntimeError::Forbidden => "forbidden",
        RuntimeError::Missing => "missing",
        RuntimeError::Conflict => "conflict",
        RuntimeError::ArchiveReplaced => "archive-replaced",
        RuntimeError::AnalyticsCancelled => "analytics-cancelled",
        RuntimeError::Locked => "locked",
        RuntimeError::LockedField => "locked-field",
        RuntimeError::ReadRequired => "read-required",
        RuntimeError::Busy => "busy",
        RuntimeError::TooLarge => "too-large",
        RuntimeError::ProfileTooLarge => "profile-too-large",
        RuntimeError::Crypto => "crypto",
        RuntimeError::InvalidResponse => "invalid-response",
        RuntimeError::Transport => "transport",
        RuntimeError::Indeterminate => "indeterminate",
        RuntimeError::InvalidInput => "invalid-input",
        RuntimeError::Rejected(_) => "rejected",
    };
    ProbeError {
        phase,
        reason,
        status: error.status_code(),
    }
}

fn hash(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(bytes.as_ref()))
}

fn unlocked(fields: &[String], phase: &'static str) -> Result<(), ProbeError> {
    if fields.is_empty() {
        Ok(())
    } else {
        Err(fail(phase, "locked-field"))
    }
}

fn login(client: &RuntimeClient, config: &ProbeConfig) -> Result<RuntimeSession, ProbeError> {
    let pairing = PairingCredentials::new(&config.pairing_id, &config.pairing_token)
        .map_err(|error| runtime_error("pairing", error))?;
    client
        .login(pairing, &config.username, &config.passphrase)
        .map_err(|error| runtime_error("login", error))
}

fn snapshot(session: &RuntimeSession, config: &ProbeConfig) -> Result<Value, ProbeError> {
    let scope = &config.scope;
    let patient_id = &config.patient_id;
    let ambulatories = session
        .list_ambulatories()
        .map_err(|e| runtime_error("ambulatories", e))?;
    if !ambulatories.iter().any(|row| row.id == *scope) {
        return Err(fail("ambulatories", "scope-not-listed"));
    }
    let patients = session
        .list_patients(scope, false)
        .map_err(|e| runtime_error("patients", e))?;
    let archived = session
        .list_patients(scope, true)
        .map_err(|e| runtime_error("archived-patients", e))?;
    let patient =
        open_profile(session, scope, patient_id).map_err(|e| runtime_error("patient", e))?;
    unlocked(&patient.locked_fields, "patient")?;

    let mut entries = session
        .list_entries(scope, patient_id)
        .map_err(|e| runtime_error("entries", e))?;
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    let entries: Vec<_> = entries.iter().map(|row| {
        unlocked(&row.locked_fields, "entries")?;
        Ok(json!({"id":row.id, "version":row.version, "titleSha256":hash(&row.title), "contentSha256":hash(&row.content)}))
    }).collect::<Result<_, ProbeError>>()?;

    let mut therapies = session
        .list_therapies(scope, patient_id)
        .map_err(|e| runtime_error("therapies", e))?;
    therapies.sort_by(|a, b| a.id.cmp(&b.id));
    let therapies: Vec<_> = therapies.iter().map(|row| {
        unlocked(&row.locked_fields, "therapies")?;
        Ok(json!({"id":row.id, "version":row.version, "motivationSha256":hash(row.motivation.as_deref().unwrap_or(""))}))
    }).collect::<Result<_, ProbeError>>()?;

    let mut observations = session
        .list_observations(scope, patient_id)
        .map_err(|e| runtime_error("observations", e))?;
    observations.sort_by(|a, b| a.id.cmp(&b.id));
    let observations: Vec<_> = observations.iter().map(|row| {
        unlocked(&row.locked_fields, "observations")?;
        Ok(json!({"id":row.id, "version":row.version, "value":row.value, "unitCode":row.unit_code}))
    }).collect::<Result<_, ProbeError>>()?;

    let mut checkups = session
        .list_checkups(scope, patient_id)
        .map_err(|e| runtime_error("checkups", e))?;
    checkups.sort_by(|a, b| a.id.cmp(&b.id));
    let checkups: Vec<_> = checkups.iter().map(|row| {
        unlocked(&row.locked_fields, "checkups")?;
        Ok(json!({"id":row.id, "version":row.version, "notesSha256":hash(row.notes.as_deref().unwrap_or(""))}))
    }).collect::<Result<_, ProbeError>>()?;

    let mut attachments = session
        .list_attachments(scope, patient_id)
        .map_err(|e| runtime_error("attachments", e))?;
    attachments.sort_by(|a, b| a.id.cmp(&b.id));
    let attachments: Vec<_> = attachments.iter().map(|listed| {
        let row = session.read_attachment(scope, patient_id, &listed.id)
            .map_err(|e| runtime_error("attachment-read", e))?;
        unlocked(&row.locked_fields, "attachment-read")?;
        let data = row.data.as_deref().ok_or_else(|| fail("attachment-read", "missing-data"))?;
        Ok(json!({"id":row.id, "nameSha256":hash(&row.name), "size":row.size, "dataSha256":hash(data)}))
    }).collect::<Result<_, ProbeError>>()?;

    let mut snapshot = json!({
        "ambulatories":ambulatories.len(), "patients":patients.len(), "archivedPatients":archived.len(),
        "patientVersion":patient.version, "notesSha256":hash(patient.notes.as_deref().unwrap_or("")),
        "entries":entries, "therapies":therapies, "observations":observations,
        "checkups":checkups, "attachments":attachments
    });
    if config.comparison_protocol_id.as_deref() == Some("paired-v3-snapshot-2") {
        let mut agenda = session
            .list_agenda_with_filter(
                scope,
                &AgendaFilter {
                    date_from: Some("2026-10-01T00:00:00.000Z".into()),
                    date_to: Some("2026-11-01T00:00:00.000Z".into()),
                    limit: Some(500),
                    ..Default::default()
                },
            )
            .map_err(|e| runtime_error("agenda", e))?;
        agenda.sort_by(|a, b| a.id.cmp(&b.id));
        let agenda: Vec<_> = agenda
            .iter()
            .map(|row| {
                unlocked(&row.locked_fields, "agenda")?;
                Ok(
                    json!({"id":row.id, "patientId":row.patient_id, "version":row.version,
                "date":row.date, "status":row.status, "titleSha256":hash(&row.title),
                "notesSha256":hash(row.notes.as_deref().unwrap_or(""))}),
                )
            })
            .collect::<Result<_, ProbeError>>()?;
        let mut diary = session
            .list_global_entries_with_filter(
                scope,
                &GlobalEntryFilter {
                    date_from: Some("2026-10-01T00:00:00.000Z".into()),
                    date_to: Some("2026-10-16T23:59:59.999Z".into()),
                    limit: Some(100),
                    entry_type: Some("note".into()),
                },
            )
            .map_err(|e| runtime_error("global-diary", e))?;
        diary.sort_by(|a, b| a.id.cmp(&b.id));
        let diary: Vec<_> = diary
            .iter()
            .map(|row| {
                unlocked(&row.locked_fields, "global-diary")?;
                Ok(
                    json!({"id":row.id, "patientId":row.patient_id, "version":row.version,
                "type":row.entry_type, "date":row.date, "setting":row.setting,
                "titleSha256":hash(&row.title), "contentSha256":hash(&row.content)}),
                )
            })
            .collect::<Result<_, ProbeError>>()?;
        snapshot["agenda"] = json!(agenda);
        snapshot["globalDiary"] = json!(diary);
    }
    Ok(snapshot)
}

fn writes(
    client: &RuntimeClient,
    session: &RuntimeSession,
    config: &ProbeConfig,
) -> Result<Value, ProbeError> {
    let patient_id = config
        .write_patient_id
        .as_deref()
        .or_else(|| {
            config
                .write_patient_ids
                .as_ref()
                .map(|ids| ids.rust.as_str())
        })
        .ok_or_else(|| fail("writes", "missing-write-patient"))?;
    // The executable only mutates this published synthetic corpus, never a
    // guessed patient or an ambient archive from a developer machine.
    if patient_id != "d713dc01-c6e3-4a6e-a503-000000000003" {
        return Err(fail("writes", "wrong-synthetic-write-patient"));
    }
    let scope = &config.scope;
    let before =
        open_profile(session, scope, patient_id).map_err(|e| runtime_error("write-preread", e))?;
    if before.tax_code.raw_for_editor() != "SYNTHETIC0000003" {
        return Err(fail("writes", "wrong-synthetic-identity"));
    }
    if before.version != 1
        || before.notes.as_deref()
            != Some("Fixture di scrittura condivisa: versione iniziale. Città e 🩺.")
    {
        return Err(fail("writes", "synthetic-write-already-used"));
    }
    unlocked(&before.locked_fields, "write-preread")?;
    let stale_session = login(client, config)?;
    let attempt = (|| {
        stale_session
            .list_ambulatories()
            .map_err(|e| runtime_error("stale-scopes", e))?;
        let stale = open_profile(&stale_session, scope, patient_id)
            .map_err(|e| runtime_error("stale-preread", e))?;
        if stale.version != before.version {
            return Err(fail("stale-preread", "concurrent-change"));
        }
        session
            .update_patient_notes(scope, patient_id, before.version, WRITE_NOTES)
            .map_err(|e| runtime_error("notes-write", e))?;
        // The first write consumed this session's pre-read. An immediate replay
        // is locally fenced. This observation is not reported as an HTTP 409.
        if session.update_patient_notes(scope, patient_id, before.version, WRITE_NOTES)
            != Err(RuntimeError::ReadRequired)
        {
            return Err(fail("replay", "replay-not-fenced"));
        }
        let stale_error = stale_session
            .update_patient_notes(scope, patient_id, stale.version, WRITE_NOTES)
            .err()
            .ok_or_else(|| fail("stale-write", "stale-write-admitted"))?;
        if stale_error != RuntimeError::Conflict {
            return Err(runtime_error("stale-write", stale_error));
        }
        let after = open_profile(session, scope, patient_id)
            .map_err(|e| runtime_error("notes-readback", e))?;
        unlocked(&after.locked_fields, "notes-readback")?;
        if Some(after.version) != before.version.checked_add(1)
            || after.notes.as_deref() != Some(WRITE_NOTES)
        {
            return Err(fail("notes-readback", "readback-mismatch"));
        }
        let draft = EntryDraft {
            entry_type: "note".into(),
            title: ENTRY_TITLE.into(),
            content: ENTRY_CONTENT.into(),
            date: "2026-10-17T12:00:00.000Z".into(),
            setting: Some("ambulatory".into()),
        };
        let created = session
            .create_entry(scope, patient_id, &draft)
            .map_err(|e| runtime_error("entry-create", e))?;
        let entry = session
            .read_entry(scope, patient_id, &created.id)
            .map_err(|e| runtime_error("entry-readback", e))?;
        unlocked(&entry.locked_fields, "entry-readback")?;
        if entry.title != draft.title
            || entry.content != draft.content
            || entry.entry_type != draft.entry_type
            || entry.date != draft.date
            || entry.setting != draft.setting
            || entry.version != 1
        {
            return Err(fail("entry-readback", "readback-mismatch"));
        }
        Ok(json!({
            "beforeVersion":before.version, "afterVersion":after.version,
            "notesSha256":hash(WRITE_NOTES), "readback":true,
            "replay":{"source":"client", "error":"read-required"}, "staleStatus":409,
            "entry":{"version":entry.version, "titleSha256":hash(entry.title), "contentSha256":hash(entry.content), "readback":true}
        }))
    })();
    let retired = stale_session
        .logout()
        .map_err(|e| runtime_error("stale-logout", e));
    let value = attempt?;
    retired?;
    Ok(value)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceFixture {
    schema_version: u64,
    synthetic: bool,
    protocol_id: String,
    parent_version: u64,
    parent_notes: String,
    therapies: ResourceDrafts<TherapyDraft>,
    observations: ResourceDrafts<ObservationDraft>,
    checkups: ResourceDrafts<CheckupDraft>,
    attachment: AttachmentFixture,
}

#[derive(Deserialize)]
struct ResourceDrafts<T> {
    create: T,
    update: T,
}

#[derive(Deserialize)]
struct AttachmentFixture {
    name: String,
    #[serde(rename = "type")]
    mime_type: String,
    text: String,
}

struct ObservedResource {
    version: u64,
    fields: Value,
    locked_fields: Vec<String>,
}

fn canonical_hash(value: &Value) -> Result<String, ProbeError> {
    let mut ordered = value.clone();
    ordered.sort_all_objects();
    serde_json::to_vec(&ordered)
        .map(hash)
        .map_err(|_| fail("projection", "invalid-json"))
}

fn profile_projection(
    row: &PatientDetail,
    id: &str,
    tax_code: &str,
    version: u64,
    expected: &Value,
) -> Result<Value, ProbeError> {
    let phase = "profile-readback";
    unlocked(&row.locked_fields, phase)?;
    if row.id != id
        || row.tax_code.raw_for_editor() != tax_code
        || row.ambulatory_id.is_some()
        || row.version != version
        || row.is_archived
        || row.deleted_at.is_some()
    {
        return Err(fail(phase, "profile-identity-state-mismatch"));
    }
    let projection = json!({
        "firstName":row.first_name, "lastName":row.last_name,
        "birthDate":row.birth_date, "address":row.address,
        "phone":row.phone, "caregiver":row.caregiver, "isAdi":row.is_adi
    });
    if &projection != expected {
        return Err(fail(phase, "profile-fields-mismatch"));
    }
    Ok(projection)
}

fn merged_profile(base: &Value, patch: &Value) -> Result<Value, ProbeError> {
    let mut value = base.clone();
    let fields = value
        .as_object_mut()
        .ok_or_else(|| fail("profiles-config", "invalid-compiled-fixture"))?;
    for (key, value) in patch
        .as_object()
        .ok_or_else(|| fail("profiles-config", "invalid-compiled-fixture"))?
    {
        fields.insert(key.clone(), value.clone());
    }
    Ok(value)
}

fn patient_profile_writes(
    client: &RuntimeClient,
    session: &RuntimeSession,
    config: &ProbeConfig,
) -> Result<Value, ProbeError> {
    let fixture: Value = serde_json::from_slice(PROFILE_FIXTURE)
        .map_err(|_| fail("profiles-config", "invalid-compiled-fixture"))?;
    let fixture_sha256 = canonical_hash(&fixture)?;
    if config.patient_profile_writes_sha256.as_deref() != Some(&fixture_sha256)
        || fixture["synthetic"] != true
        || fixture["protocolId"] != "paired-v3-patient-profile-1"
        || fixture["taxCodes"]["rust"] != "SYNPROFILERS0001"
    {
        return Err(fail("profiles-config", "profile-fixture-mismatch"));
    }
    let tax_code = "SYNPROFILERS0001";
    let mut create_value = fixture["create"].clone();
    create_value["taxCode"] = json!(tax_code);
    let create: PatientCreateDraft = serde_json::from_value(create_value)
        .map_err(|_| fail("profiles-config", "invalid-compiled-fixture"))?;
    let update: PatientProfilePatch = serde_json::from_value(fixture["update"].clone())
        .map_err(|_| fail("profiles-config", "invalid-compiled-fixture"))?;
    let stale_update: PatientProfilePatch = serde_json::from_value(fixture["staleUpdate"].clone())
        .map_err(|_| fail("profiles-config", "invalid-compiled-fixture"))?;
    let clear: PatientProfilePatch = serde_json::from_value(fixture["clear"].clone())
        .map_err(|_| fail("profiles-config", "invalid-compiled-fixture"))?;
    let initial_expected = &fixture["create"];
    let updated_expected = merged_profile(initial_expected, &fixture["update"])?;
    let cleared_expected = merged_profile(&updated_expected, &fixture["clear"])?;
    let scope = &config.scope;
    let scopes = session
        .list_ambulatories()
        .map_err(|e| runtime_error("profiles-scopes", e))?;
    if !scopes.iter().any(|row| row.id == *scope) {
        return Err(fail("profiles-scopes", "scope-not-listed"));
    }
    for archived in [false, true] {
        let existing = session
            .list_patients(scope, archived)
            .map_err(|e| runtime_error("profiles-preread", e))?;
        if existing
            .iter()
            .any(|row| row.tax_code.raw_for_editor() == tax_code)
        {
            return Err(fail("profiles-preread", "synthetic-profile-already-used"));
        }
    }
    let created = session
        .create_patient(scope, &create)
        .map_err(|e| runtime_error("profile-create", e))?;
    if created.version != Some(1) {
        return Err(fail("profile-create", "profile-acknowledgment-mismatch"));
    }
    let read = |active: &RuntimeSession, version, expected: &Value| {
        let row = open_profile(active, scope, &created.id)
            .map_err(|e| runtime_error("profile-readback", e))?;
        // The scoped view deliberately omits ambulatoryId. Admission is instead
        // established by open_profile's selected target and bound HTTP scope.
        let intent = active.profile_query_intent();
        for (foreign_scope, foreign_patient) in [
            (scope.as_str(), "synthetic-unselected-patient"),
            ("synthetic-unselected-scope", created.id.as_str()),
        ] {
            if !matches!(
                active.read_patient_profile(foreign_scope, foreign_patient, &intent),
                Err(RuntimeError::ReadRequired)
            ) {
                return Err(fail("profile-readback", "foreign-selection-admitted"));
            }
        }
        profile_projection(&row, &created.id, tax_code, version, expected)
    };
    let before = read(session, 1, initial_expected)?;
    let stale = login(client, config)?;
    let attempt = (|| {
        stale
            .list_ambulatories()
            .map_err(|e| runtime_error("profiles-stale-scopes", e))?;
        read(&stale, 1, initial_expected)?;
        session
            .update_patient_profile(scope, &created.id, 1, &update)
            .map_err(|e| runtime_error("profile-update", e))?;
        let after = read(session, 2, &updated_expected)?;
        match stale.update_patient_profile(scope, &created.id, 1, &stale_update) {
            Err(RuntimeError::Conflict) => {}
            Err(error) => return Err(runtime_error("profile-stale-update", error)),
            Ok(()) => return Err(fail("profile-stale-update", "stale-write-admitted")),
        }
        read(session, 2, &updated_expected)?;
        session
            .update_patient_profile(scope, &created.id, 2, &clear)
            .map_err(|e| runtime_error("profile-clear", e))?;
        let cleared = read(session, 3, &cleared_expected)?;
        Ok(json!({
            "protocolId":"paired-v3-patient-profile-1", "fixtureSha256":fixture_sha256,
            "patientIdSha256":hash(&created.id), "taxCodeSha256":hash(tax_code),
            "createdVersion":1, "updatedVersion":2, "clearedVersion":3,
            "createdProjectionSha256":canonical_hash(&before)?,
            "updatedProjectionSha256":canonical_hash(&after)?,
            "clearedProjectionSha256":canonical_hash(&cleared)?,
            "sparsePreserved":true, "clearPreserved":true,
            "staleStatus":409, "stalePreserved":true, "readback":true
        }))
    })();
    let retired = stale
        .logout()
        .map_err(|e| runtime_error("profiles-stale-logout", e));
    let value = attempt?;
    retired?;
    Ok(value)
}

fn check_resource(
    row: &ObservedResource,
    version: u64,
    fields: &Value,
    phase: &'static str,
) -> Result<(), ProbeError> {
    unlocked(&row.locked_fields, phase)?;
    if row.version != version || &row.fields != fields {
        return Err(fail(phase, "resource-readback-mismatch"));
    }
    Ok(())
}

fn resource_roundtrip(
    phase: &'static str,
    session: &RuntimeSession,
    stale: &RuntimeSession,
    expected: (&Value, &Value),
    create: impl Fn() -> mediflow_runtime_client::Result<CreatedResource>,
    read: impl Fn(&RuntimeSession, &str) -> mediflow_runtime_client::Result<ObservedResource>,
    update: impl Fn(&RuntimeSession, &str, u64, bool) -> mediflow_runtime_client::Result<()>,
) -> Result<Value, ProbeError> {
    let created = create().map_err(|e| runtime_error(phase, e))?;
    let initial = read(session, &created.id).map_err(|e| runtime_error(phase, e))?;
    check_resource(&initial, 1, expected.0, phase)?;
    let stale_initial = read(stale, &created.id).map_err(|e| runtime_error(phase, e))?;
    check_resource(&stale_initial, 1, expected.0, phase)?;
    update(session, &created.id, 1, true).map_err(|e| runtime_error(phase, e))?;
    let updated = read(session, &created.id).map_err(|e| runtime_error(phase, e))?;
    check_resource(&updated, 2, expected.1, phase)?;
    match update(stale, &created.id, 1, false) {
        Err(RuntimeError::Conflict) => {}
        Err(error) => return Err(runtime_error(phase, error)),
        Ok(()) => return Err(fail(phase, "stale-write-admitted")),
    }
    let after_stale = read(session, &created.id).map_err(|e| runtime_error(phase, e))?;
    check_resource(&after_stale, 2, expected.1, phase)?;
    Ok(json!({
        "createdVersion":1, "updatedVersion":2,
        "createdProjectionSha256":canonical_hash(&initial.fields)?,
        "updatedProjectionSha256":canonical_hash(&updated.fields)?,
        "readback":true, "staleStatus":409, "stalePreserved":true
    }))
}

fn resource_writes(
    client: &RuntimeClient,
    session: &RuntimeSession,
    config: &ProbeConfig,
) -> Result<Value, ProbeError> {
    let fixture_value: Value = serde_json::from_slice(RESOURCE_FIXTURE)
        .map_err(|_| fail("resources-config", "invalid-compiled-fixture"))?;
    let fixture_sha256 = canonical_hash(&fixture_value)?;
    if config.resource_writes_sha256.as_deref() != Some(&fixture_sha256) {
        return Err(fail("resources-config", "resource-fixture-mismatch"));
    }
    let fixture: ResourceFixture = serde_json::from_value(fixture_value.clone())
        .map_err(|_| fail("resources-config", "invalid-compiled-fixture"))?;
    if !fixture.synthetic
        || fixture.schema_version != 1
        || fixture.protocol_id != "paired-v3-resource-writes-1"
    {
        return Err(fail("resources-config", "invalid-compiled-fixture"));
    }
    let patient_id = config
        .write_patient_id
        .as_deref()
        .or_else(|| {
            config
                .write_patient_ids
                .as_ref()
                .map(|ids| ids.rust.as_str())
        })
        .ok_or_else(|| fail("resources-config", "missing-write-patient"))?;
    if patient_id != "d713dc01-c6e3-4a6e-a503-000000000003" {
        return Err(fail("resources-config", "wrong-synthetic-write-patient"));
    }
    let scope = &config.scope;
    let parent = open_profile(session, scope, patient_id)
        .map_err(|e| runtime_error("resources-parent", e))?;
    unlocked(&parent.locked_fields, "resources-parent")?;
    if parent.tax_code.raw_for_editor() != "SYNTHETIC0000003"
        || parent.version != fixture.parent_version
        || parent.notes.as_deref() != Some(&fixture.parent_notes)
    {
        return Err(fail("resources-parent", "wrong-synthetic-parent-state"));
    }
    if !session
        .list_therapies(scope, patient_id)
        .map_err(|e| runtime_error("resources-preread", e))?
        .is_empty()
        || !session
            .list_observations(scope, patient_id)
            .map_err(|e| runtime_error("resources-preread", e))?
            .is_empty()
        || !session
            .list_checkups(scope, patient_id)
            .map_err(|e| runtime_error("resources-preread", e))?
            .is_empty()
        || !session
            .list_attachments(scope, patient_id)
            .map_err(|e| runtime_error("resources-preread", e))?
            .is_empty()
    {
        return Err(fail(
            "resources-preread",
            "synthetic-resources-already-used",
        ));
    }
    let stale = login(client, config)?;
    let attempt = (|| {
        stale
            .list_ambulatories()
            .map_err(|e| runtime_error("resources-stale-scopes", e))?;
        let therapies = resource_roundtrip(
            "therapy",
            session,
            &stale,
            (
                &fixture_value["therapies"]["create"],
                &fixture_value["therapies"]["update"],
            ),
            || session.create_therapy(scope, patient_id, &fixture.therapies.create),
            |active, id| {
                let row = active.read_therapy(scope, patient_id, id)?;
                Ok(ObservedResource {
                    version: row.version,
                    locked_fields: row.locked_fields,
                    fields: json!({
                        "drugName":row.drug_name, "dosage":row.dosage, "status":row.status,
                        "startDate":row.start_date, "endDate":row.end_date, "motivation":row.motivation,
                        "aic":row.aic, "atc":row.atc, "activePrinciple":row.active_principle,
                        "diagnosisCode":row.diagnosis_code, "diagnosisName":row.diagnosis_name,
                    }),
                })
            },
            |active, id, version, updated| {
                active.update_therapy(
                    scope,
                    patient_id,
                    id,
                    version,
                    if updated {
                        &fixture.therapies.update
                    } else {
                        &fixture.therapies.create
                    },
                )
            },
        )?;
        let observations = resource_roundtrip(
            "observation",
            session,
            &stale,
            (
                &fixture_value["observations"]["create"],
                &fixture_value["observations"]["update"],
            ),
            || session.create_observation(scope, patient_id, &fixture.observations.create),
            |active, id| {
                let row = active.read_observation(scope, patient_id, id)?;
                Ok(ObservedResource {
                    version: row.version,
                    locked_fields: row.locked_fields,
                    fields: json!({
                        "codeSystem":row.code_system, "code":row.code, "display":row.display,
                        "unitSystem":row.unit_system, "unitCode":row.unit_code, "value":row.value,
                        "notes":row.notes, "refLow":row.ref_low, "refHigh":row.ref_high, "refText":row.ref_text,
                        "observedAt":row.observed_at, "source":row.source,
                    }),
                })
            },
            |active, id, version, updated| {
                active.update_observation(
                    scope,
                    patient_id,
                    id,
                    version,
                    if updated {
                        &fixture.observations.update
                    } else {
                        &fixture.observations.create
                    },
                )
            },
        )?;
        let checkups = resource_roundtrip(
            "checkup",
            session,
            &stale,
            (
                &fixture_value["checkups"]["create"],
                &fixture_value["checkups"]["update"],
            ),
            || session.create_checkup(scope, patient_id, &fixture.checkups.create),
            |active, id| {
                let row = active.read_checkup(scope, patient_id, id)?;
                Ok(ObservedResource {
                    version: row.version,
                    locked_fields: row.locked_fields,
                    fields: json!({
                        "date":row.date, "title":row.title, "notes":row.notes,
                        "status":row.status, "source":row.source,
                    }),
                })
            },
            |active, id, version, updated| {
                active.update_checkup(
                    scope,
                    patient_id,
                    id,
                    version,
                    if updated {
                        &fixture.checkups.update
                    } else {
                        &fixture.checkups.create
                    },
                )
            },
        )?;
        let document = &fixture.attachment;
        let bytes = document.text.as_bytes();
        let created = session
            .create_attachment(
                scope,
                patient_id,
                &document.name,
                &document.mime_type,
                bytes,
            )
            .map_err(|e| runtime_error("document-create", e))?;
        let listed = session
            .list_attachments(scope, patient_id)
            .map_err(|e| runtime_error("document-list", e))?;
        if listed.len() != 1
            || listed[0].id != created.id
            || listed.iter().any(|row| row.data.is_some())
        {
            return Err(fail("document-list", "document-list-mismatch"));
        }
        let read = session
            .read_attachment(scope, patient_id, &created.id)
            .map_err(|e| runtime_error("document-readback", e))?;
        unlocked(&read.locked_fields, "document-readback")?;
        let expected_data = format!(
            "data:{};base64,{}",
            document.mime_type,
            STANDARD.encode(bytes)
        );
        if read.name != document.name
            || read.mime_type != document.mime_type
            || read.size != bytes.len() as u64
            || read.data.as_deref() != Some(&expected_data)
        {
            return Err(fail("document-readback", "document-readback-mismatch"));
        }
        Ok(json!({
            "protocolId":fixture.protocol_id, "fixtureSha256":fixture_sha256,
            "therapies":therapies, "observations":observations, "checkups":checkups,
            "attachment":{"created":true, "size":bytes.len(), "nameSha256":hash(&read.name),
                "dataSha256":hash(&expected_data), "bytesSha256":hash(bytes),
                "listPayloadOmitted":true, "readback":true}
        }))
    })();
    let retired = stale
        .logout()
        .map_err(|e| runtime_error("resources-stale-logout", e));
    let value = attempt?;
    retired?;
    Ok(value)
}

fn run() -> Result<Value, ProbeError> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.len() != 2 || args[0] != "--config" {
        return Err(fail("config", "usage-config-file-required"));
    }
    let file = File::open(&args[1]).map_err(|_| fail("config", "unreadable-config"))?;
    let mut raw = Zeroizing::new(Vec::new());
    file.take(65_537)
        .read_to_end(&mut raw)
        .map_err(|_| fail("config", "unreadable-config"))?;
    if raw.len() > 65_536 {
        return Err(fail("config", "oversized-config"));
    }
    let config: ProbeConfig =
        serde_json::from_slice(&raw).map_err(|_| fail("config", "invalid-config"))?;
    let protocol_id = config
        .comparison_protocol_id
        .as_deref()
        .unwrap_or("paired-v3-snapshot-1");
    if !matches!(protocol_id, "paired-v3-snapshot-1" | "paired-v3-snapshot-2") {
        return Err(fail("config", "unsupported-comparison-protocol"));
    }
    if [
        config.exercise_writes,
        config.exercise_resource_writes,
        config.exercise_patient_profile_writes,
    ]
    .iter()
    .filter(|enabled| **enabled)
    .count()
        > 1
    {
        return Err(fail("config", "separate-mutation-phases-required"));
    }
    let mut corpus: Value =
        serde_json::from_slice(CORPUS).map_err(|_| fail("config", "invalid-compiled-corpus"))?;
    // Explicit sorting also works if another workspace dependency enables
    // serde_json/preserve_order. The fixture contains only integer numbers.
    corpus.sort_all_objects();
    let canonical =
        serde_json::to_vec(&corpus).map_err(|_| fail("config", "invalid-compiled-corpus"))?;
    if !config.synthetic
        || config.corpus_sha256 != hash(canonical)
        || config.patient_id != "d713dc01-c6e3-4a6e-a503-000000000001"
    {
        return Err(fail("config", "synthetic-corpus-mismatch"));
    }
    let client = RuntimeClient::new(RuntimeConfig {
        base_url: config.base_url.clone(),
        tls_pin_sha256: config.tls_pin_sha256.clone(),
    })
    .map_err(|e| runtime_error("client", e))?;
    let start = Instant::now();
    let session = login(&client, &config)?;
    let login_ms = start.elapsed().as_secs_f64() * 1000.0;
    let attempt = (|| {
        if config
            .archive_generation
            .as_ref()
            .is_some_and(|expected| expected != &session.user().archive_generation)
        {
            return Err(fail("login", "archive-generation-mismatch"));
        }
        if config.exercise_patient_profile_writes {
            let profiles = patient_profile_writes(&client, &session, &config)?;
            return Ok(json!({
                "schemaVersion":1, "protocolId":"paired-v3-patient-profile-1", "client":"rust",
                "synthetic":true, "baseUrl":client.base_url(),
                "archiveGeneration":session.user().archive_generation,
                "corpusSha256":config.corpus_sha256,
                "snapshot":null, "snapshotCanonicalSha256":null,
                "timingsMs":{"login":login_ms, "snapshot":null}, "requestCounts":{"snapshot":0},
                "patientProfileWrites":profiles, "result":"pass"
            }));
        }
        let start = Instant::now();
        let snapshot = snapshot(&session, &config)?;
        let snapshot_ms = start.elapsed().as_secs_f64() * 1000.0;
        let writes = if config.exercise_writes {
            Some(writes(&client, &session, &config)?)
        } else {
            None
        };
        let resource_writes = if config.exercise_resource_writes {
            Some(resource_writes(&client, &session, &config)?)
        } else {
            None
        };
        Ok(json!({
            "schemaVersion":1, "protocolId":protocol_id, "client":"rust",
            "baseUrl":client.base_url(), "archiveGeneration":session.user().archive_generation,
            "corpusSha256":config.corpus_sha256, "snapshot":snapshot, "writes":writes,
            "resourceWrites":resource_writes,
            "timingsMs":{"login":login_ms, "snapshot":snapshot_ms}, "result":"pass"
        }))
    })();
    let retired = session.logout().map_err(|e| runtime_error("logout", e));
    let value = attempt?;
    retired?;
    Ok(value)
}

fn main() -> ExitCode {
    match run() {
        Ok(value) => {
            println!("{value}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            println!(
                "{}",
                json!({"schemaVersion":1, "protocolId":null, "client":"rust", "result":"fail", "phase":error.phase, "reason":error.reason, "status":error.status})
            );
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_profile_projection_uses_domain_fields_without_internal_ambulatory_id() {
        let fixture: Value = serde_json::from_slice(PROFILE_FIXTURE).unwrap();
        let mut value = fixture["create"].clone();
        value["id"] = json!("synthetic-selected-patient");
        value["taxCode"] = json!("SYNPROFILERS0001");
        value["version"] = json!(1);
        let row: PatientDetail = serde_json::from_value(value.clone()).unwrap();
        assert!(row.ambulatory_id.is_none());
        assert!(
            profile_projection(
                &row,
                "synthetic-selected-patient",
                "SYNPROFILERS0001",
                1,
                &fixture["create"]
            )
            .is_ok()
        );
        for changed in [
            "id",
            "taxCode",
            "version",
            "isArchived",
            "address",
            "ambulatoryId",
        ] {
            let mut invalid_value = value.clone();
            invalid_value[changed] = match changed {
                "version" => json!(2),
                "isArchived" => json!(true),
                _ => json!("synthetic-unexpected-value"),
            };
            let invalid: PatientDetail = serde_json::from_value(invalid_value).unwrap();
            assert!(
                profile_projection(
                    &invalid,
                    "synthetic-selected-patient",
                    "SYNPROFILERS0001",
                    1,
                    &fixture["create"]
                )
                .is_err(),
                "changed {changed} must remain rejected"
            );
        }
    }
}
