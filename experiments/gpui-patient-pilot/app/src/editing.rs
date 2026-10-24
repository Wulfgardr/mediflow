//! Typed edits of already-read clinical records. Rich content and optional
//! metadata remain byte-for-byte unchanged unless their editable field changes.

use crate::appointments;
use mediflow_runtime_client::{
    Checkup, CheckupDraft, DrugCatalogItem, Entry, EntryDraft, Observation, ObservationDraft,
    RuntimeError, RuntimeSession, Therapy, TherapyDraft,
};

#[derive(Clone)]
pub enum Record {
    Entry(Entry),
    Therapy(Therapy),
    Observation(Observation),
    Checkup(Checkup),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Entry,
    Therapy,
    Observation,
    Checkup,
}

pub struct FieldSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub value: String,
    pub multiline: bool,
    pub rich: bool,
    pub choices: &'static [(&'static str, &'static str)],
}
impl FieldSpec {
    fn new(id: &'static str, label: &'static str, value: String, multiline: bool) -> Self {
        Self {
            id,
            label,
            rich: multiline && rich_text(&value),
            value,
            multiline,
            choices: &[],
        }
    }
}

pub enum Draft {
    Entry(EntryDraft),
    Therapy(TherapyDraft),
    Observation(ObservationDraft),
    Checkup(CheckupDraft),
}

impl Record {
    pub fn kind(&self) -> Kind {
        match self {
            Self::Entry(_) => Kind::Entry,
            Self::Therapy(_) => Kind::Therapy,
            Self::Observation(_) => Kind::Observation,
            Self::Checkup(_) => Kind::Checkup,
        }
    }
    pub fn title(&self) -> &'static str {
        match self {
            Self::Entry(_) => "Modifica voce",
            Self::Therapy(_) => "Modifica terapia",
            Self::Observation(_) => "Modifica parametro",
            Self::Checkup(_) => "Modifica controllo",
        }
    }
    pub fn id(&self) -> &str {
        match self {
            Self::Entry(row) => &row.id,
            Self::Therapy(row) => &row.id,
            Self::Observation(row) => &row.id,
            Self::Checkup(row) => &row.id,
        }
    }
    pub fn patient_id(&self) -> &str {
        match self {
            Self::Entry(row) => &row.patient_id,
            Self::Therapy(row) => &row.patient_id,
            Self::Observation(row) => &row.patient_id,
            Self::Checkup(row) => &row.patient_id,
        }
    }
    fn version(&self) -> u64 {
        match self {
            Self::Entry(row) => row.version,
            Self::Therapy(row) => row.version,
            Self::Observation(row) => row.version,
            Self::Checkup(row) => row.version,
        }
    }
    pub fn readable(&self) -> bool {
        match self {
            Self::Entry(row) => row.locked_fields.is_empty() && row.deleted_at.is_none(),
            Self::Therapy(row) => row.locked_fields.is_empty() && row.deleted_at.is_none(),
            Self::Observation(row) => row.locked_fields.is_empty() && row.deleted_at.is_none(),
            Self::Checkup(row) => row.locked_fields.is_empty() && row.deleted_at.is_none(),
        }
    }
    pub fn fields(&self) -> Vec<FieldSpec> {
        self.fields_in_zone(&chrono::Local)
    }

    fn fields_in_zone<T: chrono::TimeZone>(&self, zone: &T) -> Vec<FieldSpec> {
        let f = FieldSpec::new;
        match self {
            Self::Entry(row) => {
                let mut fields = vec![
                    f(
                        "clinical-workspace-edit-entry-title",
                        "Titolo della voce",
                        row.title.clone(),
                        false,
                    ),
                    f(
                        "clinical-workspace-edit-entry-date",
                        "Data (AAAA-MM-GG)",
                        day(&row.date),
                        false,
                    ),
                    f(
                        "clinical-workspace-edit-entry-content",
                        "Contenuto della voce",
                        row.content.clone(),
                        true,
                    ),
                ];
                // Structured visits and remote contacts have their own existing
                // editor. A general text field must never flatten their format.
                fields[2].rich |= row.entry_type != "note";
                fields
            }
            Self::Therapy(row) => {
                let mut fields = vec![
                    f(
                        "clinical-workspace-edit-therapy-name",
                        "Farmaco",
                        row.drug_name.clone(),
                        false,
                    ),
                    f(
                        "clinical-workspace-edit-therapy-dosage",
                        "Dose e modalità di assunzione",
                        row.dosage.clone(),
                        true,
                    ),
                    f(
                        "clinical-workspace-edit-therapy-start",
                        "Data di inizio (AAAA-MM-GG)",
                        day(&row.start_date),
                        false,
                    ),
                    f(
                        "clinical-workspace-edit-therapy-reason",
                        "Motivo della terapia",
                        row.motivation.clone().unwrap_or_default(),
                        true,
                    ),
                    f(
                        "clinical-workspace-edit-therapy-status",
                        "Stato della terapia",
                        row.status.clone(),
                        false,
                    ),
                    f(
                        "clinical-workspace-edit-therapy-end",
                        "Data di fine, se presente (AAAA-MM-GG)",
                        row.end_date.as_deref().map(day).unwrap_or_default(),
                        false,
                    ),
                ];
                fields[4].choices = &[
                    ("active", "Attiva"),
                    ("suspended", "Sospesa"),
                    ("completed", "Conclusa"),
                ];
                // The drug name belongs to the same identity as its codes and
                // active principle. A free text rename must not leave those
                // fields describing a different drug.
                if has_drug_identity(row) {
                    fields[0].rich = true;
                    fields[0].label = "Farmaco codificato";
                }
                fields
            }
            Self::Observation(row) => vec![
                f(
                    "clinical-workspace-edit-observation-name",
                    "Nome del parametro",
                    row.display.clone(),
                    false,
                ),
                f(
                    "clinical-workspace-edit-observation-code",
                    "Codice del parametro",
                    row.code.clone(),
                    false,
                ),
                f(
                    "clinical-workspace-edit-observation-value",
                    "Valore",
                    row.value.clone(),
                    false,
                ),
                f(
                    "clinical-workspace-edit-observation-unit",
                    "Unità",
                    row.unit_code.clone(),
                    false,
                ),
                f(
                    "clinical-workspace-edit-observation-date",
                    "Data (AAAA-MM-GG)",
                    day(&row.observed_at),
                    false,
                ),
                f(
                    "clinical-workspace-edit-observation-notes",
                    "Note del parametro",
                    row.notes.clone().unwrap_or_default(),
                    true,
                ),
                f(
                    "clinical-workspace-edit-observation-ref-low",
                    "Limite inferiore riportato, se presente",
                    row.ref_low.clone().unwrap_or_default(),
                    false,
                ),
                f(
                    "clinical-workspace-edit-observation-ref-high",
                    "Limite superiore riportato, se presente",
                    row.ref_high.clone().unwrap_or_default(),
                    false,
                ),
                f(
                    "clinical-workspace-edit-observation-ref-text",
                    "Intervallo descritto nel referto, se presente",
                    row.ref_text.clone().unwrap_or_default(),
                    true,
                ),
            ],
            Self::Checkup(row) => {
                let (day, time) = appointments::fields(&row.date, zone)
                    .unwrap_or_else(|_| (row.date.clone(), String::new()));
                let mut fields = vec![
                    f(
                        "clinical-workspace-edit-checkup-title",
                        "Titolo del controllo",
                        row.title.clone(),
                        false,
                    ),
                    f(
                        "clinical-workspace-edit-checkup-date",
                        "Data (AAAA-MM-GG)",
                        day,
                        false,
                    ),
                    f(
                        "clinical-workspace-edit-checkup-time",
                        "Ora locale (HH:MM, secondi facoltativi)",
                        time,
                        false,
                    ),
                    f(
                        "clinical-workspace-edit-checkup-status",
                        "Stato del controllo",
                        row.status.clone(),
                        false,
                    ),
                    f(
                        "clinical-workspace-edit-checkup-notes",
                        "Note del controllo",
                        row.notes.clone().unwrap_or_default(),
                        true,
                    ),
                ];
                fields[3].choices = &[
                    ("pending", "Da completare"),
                    ("completed", "Completato"),
                    ("cancelled", "Annullato"),
                ];
                fields
            }
        }
    }
    pub fn draft(
        &self,
        values: &[String],
        selected_drug: Option<&DrugCatalogItem>,
    ) -> Result<Draft, String> {
        self.draft_in_zone(values, selected_drug, &chrono::Local)
    }

    fn draft_in_zone<T: chrono::TimeZone>(
        &self,
        values: &[String],
        selected_drug: Option<&DrugCatalogItem>,
        zone: &T,
    ) -> Result<Draft, String> {
        if !self.readable() {
            return Err("L'elemento non è interamente leggibile o risulta eliminato. Rileggi prima di modificarlo.".into());
        }
        let fields = self.fields_in_zone(zone);
        if values.len() != fields.len() {
            return Err("Il modulo non corrisponde all'elemento letto.".into());
        }
        let changed_drug = if let Some(drug) = selected_drug {
            let Self::Therapy(row) = self else {
                return Err("La scelta del farmaco appartiene soltanto alla terapia.".into());
            };
            validate_drug_choice(&values[0], drug)?;
            row.drug_name != drug.name
                || row.aic.as_ref() != Some(&drug.aic)
                || row.atc != drug.atc
                || row.active_principle != drug.active_principle
        } else {
            false
        };
        for (index, (field, value)) in fields.iter().zip(values).enumerate() {
            if value.contains('\0')
                || value.encode_utf16().count() > mediflow_patient_client::MAX_NOTES_UTF16
            {
                return Err("Un campo contiene troppo testo o caratteri non accettati.".into());
            }
            if field.rich && value != &field.value && !(index == 0 && selected_drug.is_some()) {
                return Err("Questo campo deve restare invariato in questa modifica. Usa la gestione dell'elemento per sostituirlo.".into());
            }
            if !field.choices.is_empty()
                && value != &field.value
                && !field.choices.iter().any(|(code, _)| value == code)
            {
                return Err("Scegli uno degli stati disponibili.".into());
            }
        }
        if !changed_drug
            && fields
                .iter()
                .zip(values)
                .all(|(field, value)| &field.value == value)
        {
            return Err("Nessuna modifica da registrare.".into());
        }
        let required = match self {
            Self::Entry(_) => vec![0, 1, 2],
            Self::Therapy(_) => vec![0, 1, 2, 4],
            Self::Observation(_) => vec![0, 1, 2, 3, 4],
            Self::Checkup(_) => vec![0, 1, 2, 3],
        };
        if required
            .into_iter()
            .any(|index| contract_trim(&values[index]).is_empty())
        {
            return Err("Completa i campi richiesti prima di rivedere la modifica.".into());
        }
        Ok(match self {
            Self::Entry(row) => Draft::Entry(EntryDraft {
                entry_type: row.entry_type.clone(),
                title: values[0].clone(),
                content: values[2].clone(),
                date: edited_date(&values[1], &row.date)?,
                setting: row.setting.clone(),
            }),
            Self::Therapy(row) => {
                let start_date = edited_date(&values[2], &row.start_date)?;
                let end_date = edited_optional_date(&values[5], row.end_date.as_deref())?;
                if let Some(end) = &end_date
                    && parse_instant(end)? < parse_instant(&start_date)?
                {
                    return Err("La fine della terapia precede l'inizio. Controlla le date.".into());
                }
                let mut draft = TherapyDraft {
                    drug_name: values[0].clone(),
                    dosage: values[1].clone(),
                    status: values[4].clone(),
                    start_date,
                    end_date,
                    motivation: optional(&values[3], row.motivation.as_ref()),
                    aic: row.aic.clone(),
                    atc: row.atc.clone(),
                    active_principle: row.active_principle.clone(),
                    diagnosis_code: row.diagnosis_code.clone(),
                    diagnosis_name: row.diagnosis_name.clone(),
                };
                if let Some(drug) = selected_drug {
                    apply_drug_choice(&mut draft, drug)?;
                }
                Draft::Therapy(draft)
            }
            Self::Observation(row) => {
                Draft::Observation(ObservationDraft {
                    code_system: row.code_system.clone(),
                    code: edited_trimmed_string(&values[1], &row.code),
                    display: edited_trimmed_string(&values[0], &row.display),
                    unit_system: row.unit_system.clone(),
                    unit_code: edited_trimmed_string(&values[3], &row.unit_code),
                    // The ordinary writer accepts a nonblank string, including
                    // qualified results such as "<5". Punctuation and reference
                    // text are clinical content, never a numeric coercion.
                    value: edited_trimmed_string(&values[2], &row.value),
                    observed_at: edited_date(&values[4], &row.observed_at)?,
                    notes: optional(&values[5], row.notes.as_ref()),
                    ref_low: optional(&values[6], row.ref_low.as_ref()),
                    ref_high: optional(&values[7], row.ref_high.as_ref()),
                    ref_text: optional(&values[8], row.ref_text.as_ref()),
                    source: row.source.clone(),
                })
            }
            Self::Checkup(row) => Draft::Checkup(CheckupDraft {
                title: values[0].clone(),
                date: appointments::edited(&values[1], &values[2], &row.date, zone)?,
                status: values[3].clone(),
                notes: optional(&values[4], row.notes.as_ref()),
                source: row.source.clone(),
            }),
        })
    }

    pub fn submit(
        &self,
        session: &RuntimeSession,
        scope: &str,
        values: &[String],
        selected_drug: Option<&DrugCatalogItem>,
    ) -> Result<bool, RuntimeError> {
        let draft = self
            .draft(values, selected_drug)
            .map_err(|_| RuntimeError::InvalidInput)?;
        let expected = self
            .version()
            .checked_add(1)
            .ok_or(RuntimeError::InvalidInput)?;
        let read = match &draft {
            Draft::Entry(draft) => {
                session.update_entry(scope, self.patient_id(), self.id(), self.version(), draft)?;
                session
                    .read_entry(scope, self.patient_id(), self.id())
                    .map(Record::Entry)
            }
            Draft::Therapy(draft) => {
                session.update_therapy(
                    scope,
                    self.patient_id(),
                    self.id(),
                    self.version(),
                    draft,
                )?;
                session
                    .read_therapy(scope, self.patient_id(), self.id())
                    .map(Record::Therapy)
            }
            Draft::Observation(draft) => {
                session.update_observation(
                    scope,
                    self.patient_id(),
                    self.id(),
                    self.version(),
                    draft,
                )?;
                session
                    .read_observation(scope, self.patient_id(), self.id())
                    .map(Record::Observation)
            }
            Draft::Checkup(draft) => {
                session.update_checkup(
                    scope,
                    self.patient_id(),
                    self.id(),
                    self.version(),
                    draft,
                )?;
                session
                    .read_checkup(scope, self.patient_id(), self.id())
                    .map(Record::Checkup)
            }
        };
        match read {
            Ok(row) => Ok(row.readable()
                && row.id() == self.id()
                && row.patient_id() == self.patient_id()
                && row.version() == expected
                && draft.matches(&row)),
            Err(error) if error.retires_session() => Err(error),
            Err(_) => Ok(false), // An acknowledged write is never a resendable failure.
        }
    }
}

impl Draft {
    fn matches(&self, row: &Record) -> bool {
        match (self, row) {
            (Self::Entry(draft), Record::Entry(row)) => {
                row.entry_type == draft.entry_type
                    && row.title == draft.title
                    && row.content == draft.content
                    && same_instant(&row.date, &draft.date)
                    && row.setting == draft.setting
            }
            (Self::Therapy(draft), Record::Therapy(row)) => therapy_matches(row, draft),
            (Self::Observation(draft), Record::Observation(row)) => {
                row.code_system == draft.code_system
                    && row.code == draft.code
                    && row.display == draft.display
                    && row.unit_system == draft.unit_system
                    && row.unit_code == draft.unit_code
                    && row.value == draft.value
                    && same_instant(&row.observed_at, &draft.observed_at)
                    && row.notes == draft.notes
                    && row.ref_low == draft.ref_low
                    && row.ref_high == draft.ref_high
                    && row.ref_text == draft.ref_text
                    && row.source == draft.source
            }
            (Self::Checkup(draft), Record::Checkup(row)) => {
                row.title == draft.title
                    && same_instant(&row.date, &draft.date)
                    && row.status == draft.status
                    && row.notes == draft.notes
                    && row.source == draft.source
            }
            _ => false,
        }
    }
}

pub fn validate_drug_choice(name: &str, drug: &DrugCatalogItem) -> Result<(), String> {
    let valid = |value: &str| {
        !contract_trim(value).is_empty()
            && !value.chars().any(char::is_control)
            && value.encode_utf16().count() <= mediflow_patient_client::MAX_NOTES_UTF16
    };
    if name != drug.name || !valid(&drug.name) || !valid(&drug.aic) {
        return Err("Il farmaco e il codice AIC non corrispondono alla scelta. Cerca e scegli di nuovo la confezione.".into());
    }
    Ok(())
}

/// A selection replaces the whole drug identity. Absent catalog fields clear
/// the old identity's values; no dose, indication or clinical choice is inferred.
pub fn apply_drug_choice(draft: &mut TherapyDraft, drug: &DrugCatalogItem) -> Result<(), String> {
    validate_drug_choice(&draft.drug_name, drug)?;
    draft.drug_name = drug.name.clone();
    draft.aic = Some(drug.aic.clone());
    draft.atc = drug.atc.clone();
    draft.active_principle = drug.active_principle.clone();
    Ok(())
}

/// Creation and update confirm the same complete therapy projection.
pub fn therapy_matches(row: &Therapy, draft: &TherapyDraft) -> bool {
    row.drug_name == draft.drug_name
        && row.dosage == draft.dosage
        && row.status == draft.status
        && same_instant(&row.start_date, &draft.start_date)
        && same_optional_instant(row.end_date.as_deref(), draft.end_date.as_deref())
        && row.motivation == draft.motivation
        && row.aic == draft.aic
        && row.atc == draft.atc
        && row.active_principle == draft.active_principle
        && row.diagnosis_code == draft.diagnosis_code
        && row.diagnosis_name == draft.diagnosis_name
}

fn day(value: &str) -> String {
    value
        .get(..10)
        .filter(|date| date.is_ascii())
        .unwrap_or(value)
        .to_owned()
}
fn edited_date(value: &str, original: &str) -> Result<String, String> {
    if value == day(original) {
        return Ok(original.to_owned());
    }
    let value = value.trim();
    let parsed = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "Inserisci una data valida nel formato AAAA-MM-GG.".to_owned())?;
    if parsed.format("%Y-%m-%d").to_string() != value {
        return Err("Inserisci la data completa nel formato AAAA-MM-GG.".into());
    }
    if original.is_empty() {
        // A newly supplied optional date has no previous clock time to retain.
        return Ok(format!("{value}T00:00:00.000Z"));
    }
    parse_instant(original)?;
    let suffix = original
        .get(10..)
        .ok_or_else(|| "Rileggi la data e l'ora dell'elemento prima di modificarlo.".to_owned())?;
    // This field edits a calendar day only. Retain the original clock time,
    // subsecond precision and explicit offset; never assume the workstation's
    // timezone or silently change the time to midnight.
    let updated = format!("{value}{suffix}");
    parse_instant(&updated)?;
    Ok(updated)
}
fn edited_optional_date(value: &str, original: Option<&str>) -> Result<Option<String>, String> {
    if value == original.map(day).unwrap_or_default() {
        return Ok(original.map(str::to_owned));
    }
    if value.trim().is_empty() {
        Ok(None)
    } else {
        edited_date(value, original.unwrap_or_default()).map(Some)
    }
}
fn parse_instant(value: &str) -> Result<chrono::DateTime<chrono::FixedOffset>, String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| "Rileggi la data e l'ora dell'elemento prima di modificarlo.".to_owned())
}
fn same_instant(left: &str, right: &str) -> bool {
    match (parse_instant(left), parse_instant(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}
fn same_optional_instant(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => same_instant(left, right),
        _ => false,
    }
}
fn has_drug_identity(row: &Therapy) -> bool {
    [&row.aic, &row.atc, &row.active_principle]
        .into_iter()
        .any(|value| {
            value
                .as_deref()
                .is_some_and(|value| !contract_trim(value).is_empty())
        })
}
fn optional(value: &str, original: Option<&String>) -> Option<String> {
    if value == original.map_or("", String::as_str) {
        return original.cloned();
    }
    if value.trim().is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}
fn edited_trimmed_string(value: &str, original: &str) -> String {
    if value == original {
        original.to_owned()
    } else {
        contract_trim(value).to_owned()
    }
}
pub(crate) fn contract_trim(value: &str) -> &str {
    // Match the writer's JavaScript String.trim(), including FEFF and excluding
    // U+0085. This normalization applies only to explicitly edited fields whose
    // ordinary contract trims them; unchanged content always keeps its bytes.
    value.trim_matches(|ch| {
        matches!(ch, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
            | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
            | '\u{205f}' | '\u{3000}' | '\u{feff}')
    })
}
fn rich_text(source: &str) -> bool {
    source
        .as_bytes()
        .windows(2)
        .any(|pair| pair[0] == b'<' && (pair[1].is_ascii_alphabetic() || pair[1] == b'/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checkup(date: &str) -> Checkup {
        serde_json::from_value(serde_json::json!({
            "id": "synthetic-checkup", "patientId": "synthetic-patient", "date": date,
            "title": "Controllo sintetico", "notes": "Note sintetiche", "status": "pending",
            "source": "manual", "version": 3
        }))
        .unwrap()
    }

    #[test]
    fn checkup_edit_reopens_the_chosen_local_day_and_preserves_unchanged_timestamps() {
        for zone in [chrono_tz::America::New_York, chrono_tz::Europe::Rome] {
            for time in ["00:00", "23:59", "09:30:45"] {
                let date = appointments::for_write("2026-10-18", time, &zone).unwrap();
                let record = Record::Checkup(checkup(&date));
                let fields = record.fields_in_zone(&zone);
                assert_eq!(fields[1].value, "2026-10-18", "{zone}");
                assert_eq!(fields[2].value, time, "{zone}");
                assert_eq!(fields[3].choices[0], ("pending", "Da completare"));
                let mut values: Vec<_> = fields.into_iter().map(|field| field.value).collect();
                values[0] = "Titolo modificato".into();
                let Draft::Checkup(draft) = record.draft_in_zone(&values, None, &zone).unwrap()
                else {
                    panic!("checkup draft expected");
                };
                assert_eq!(draft.date, date, "{zone}");
                assert_eq!(draft.status, "pending");
                assert_eq!(draft.notes.as_deref(), Some("Note sintetiche"));
                values[3] = "completed".into();
                values[4] = String::new();
                let Draft::Checkup(draft) = record.draft_in_zone(&values, None, &zone).unwrap()
                else {
                    panic!("checkup draft expected");
                };
                assert_eq!(draft.date, date);
                assert_eq!(draft.status, "completed");
                assert_eq!(draft.notes, None);
            }
        }
    }

    #[test]
    fn moving_a_checkup_day_keeps_its_local_clock_across_a_timezone_change() {
        for (zone, original_day, next_day, expected) in [
            (
                chrono_tz::America::New_York,
                "2026-03-07",
                "2026-03-08",
                "2026-03-08T13:30:45.000Z",
            ),
            (
                chrono_tz::Europe::Rome,
                "2026-03-28",
                "2026-03-29",
                "2026-03-29T07:30:45.000Z",
            ),
        ] {
            let date = appointments::for_write(original_day, "09:30:45", &zone).unwrap();
            let record = Record::Checkup(checkup(&date));
            let mut values: Vec<_> = record
                .fields_in_zone(&zone)
                .into_iter()
                .map(|field| field.value)
                .collect();
            values[1] = next_day.into();
            let Draft::Checkup(draft) = record.draft_in_zone(&values, None, &zone).unwrap() else {
                panic!("checkup draft expected");
            };
            assert_eq!(draft.date, expected, "{zone}");
            assert_eq!(
                appointments::fields(&draft.date, &zone).unwrap(),
                (next_day.into(), "09:30:45".into())
            );
        }
    }

    #[test]
    fn ambiguous_checkup_edits_are_rejected_but_known_original_instants_are_preserved() {
        for (zone, target_day, target_time) in [
            (chrono_tz::America::New_York, "2026-03-08", "02:30"),
            (chrono_tz::America::New_York, "2026-11-01", "01:30"),
            (chrono_tz::Europe::Rome, "2026-03-29", "02:30"),
            (chrono_tz::Europe::Rome, "2026-10-25", "02:30"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:20.1"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:20.125"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:20.1234"),
            (chrono_tz::Europe::Rome, "2026-10-18", "09:30:20.123456789"),
        ] {
            let date = appointments::for_write("2026-10-18", "09:30", &zone).unwrap();
            let record = Record::Checkup(checkup(&date));
            let mut values: Vec<_> = record
                .fields_in_zone(&zone)
                .into_iter()
                .map(|field| field.value)
                .collect();
            values[1] = target_day.into();
            values[2] = target_time.into();
            assert!(
                record.draft_in_zone(&values, None, &zone).is_err(),
                "{zone}: {target_day} {target_time}"
            );
        }
        for original in [
            "2026-11-01T01:30:20.125-04:00",
            "2026-11-01T01:30:20.123456789-05:00",
        ] {
            let zone = chrono_tz::America::New_York;
            let record = Record::Checkup(checkup(original));
            let mut values: Vec<_> = record
                .fields_in_zone(&zone)
                .into_iter()
                .map(|field| field.value)
                .collect();
            values[0] = "Titolo modificato".into();
            let Draft::Checkup(draft) = record.draft_in_zone(&values, None, &zone).unwrap() else {
                panic!("checkup draft expected");
            };
            assert_eq!(
                draft.date, original,
                "a known instant must not be reinterpreted through a DST fold"
            );
            values[2] = "01:31".into();
            assert!(record.draft_in_zone(&values, None, &zone).is_err());
        }
    }

    fn entry() -> Entry {
        serde_json::from_value(serde_json::json!({"id":"entry-1","patientId":"patient-1","type":"note","title":"Titolo","date":"2026-10-17T13:25:40.000Z","content":"<p><s>Voce precedente</s> <strong>Città 🩺</strong></p>","setting":"home","version":7})).unwrap()
    }
    #[test]
    fn title_edit_preserves_rich_body_setting_and_recorded_time_exactly() {
        let original = entry();
        let record = Record::Entry(original.clone());
        let mut values = record
            .fields()
            .into_iter()
            .map(|field| field.value)
            .collect::<Vec<_>>();
        assert!(record.draft(&values, None).is_err());
        values[0] = "  Titolo corretto 🩺  ".into();
        let Draft::Entry(draft) = record.draft(&values, None).unwrap() else {
            panic!()
        };
        assert_eq!(draft.content, original.content);
        assert_eq!(draft.title, values[0]);
        assert_eq!(draft.date, original.date);
        assert_eq!(draft.setting, original.setting);
        values[2] = "Voce precedente Città 🩺".into();
        assert!(
            record.draft(&values, None).is_err(),
            "a lossy plain replacement must not erase existing formatting"
        );
    }
    #[test]
    fn dates_and_nullable_values_change_only_when_explicitly_edited() {
        assert_eq!(
            edited_date("2026-10-17", "2026-10-17T13:25:40.000Z").unwrap(),
            "2026-10-17T13:25:40.000Z"
        );
        assert_eq!(
            edited_date("2026-10-18", "2026-10-17T13:25:40.000Z").unwrap(),
            "2026-10-18T13:25:40.000Z"
        );
        let original_time = "2026-10-17T00:25:40.125+02:00";
        let changed = edited_date("2026-10-18", original_time).unwrap();
        assert_eq!(changed, "2026-10-18T00:25:40.125+02:00");
        assert_eq!(
            edited_optional_date("2026-10-18", Some(original_time)).unwrap(),
            Some(changed.clone())
        );
        assert_eq!(edited_optional_date("", Some(original_time)).unwrap(), None);
        assert_eq!(
            edited_optional_date("2026-10-18", None).unwrap(),
            Some("2026-10-18T00:00:00.000Z".into())
        );
        let mut original = entry();
        original.title = "  Titolo conservato  ".into();
        original.date = original_time.into();
        let record = Record::Entry(original.clone());
        let mut values = record
            .fields()
            .into_iter()
            .map(|field| field.value)
            .collect::<Vec<_>>();
        values[1] = "2026-10-18".into();
        let draft = record.draft(&values, None).unwrap();
        original.date = "2026-10-17T22:25:40.125Z".into();
        assert!(
            draft.matches(&Record::Entry(original.clone())),
            "the writer's UTC serialization is the exact same instant, with untouched title and content"
        );
        original.date = "2026-10-18T00:00:00.000Z".into();
        assert!(
            !draft.matches(&Record::Entry(original)),
            "a readback at midnight must not confirm the retained clock time"
        );
        assert!(edited_date("2026-02-31", "2026-10-17T13:25:40.000Z").is_err());
        assert!(edited_date("2026-10-18", "2026-10-17").is_err());
        assert_eq!(optional("", None), None);
        assert_eq!(optional("", Some(&String::new())), Some(String::new()));
        assert_eq!(optional("", Some(&"prima".into())), None);
        assert!(!rich_text("PCR <5 e 4 < x > 2"));
        assert!(rich_text("<p>Test</p>"));
    }
    #[test]
    fn qualified_observation_results_and_reference_text_survive_unrelated_edits() {
        let original: Observation = serde_json::from_value(serde_json::json!({
            "id":"observation-1", "patientId":"patient-1", "codeSystem":"LOINC",
            "code":"SYN-TEST", "display":"Parametro di prova", "unitSystem":"UCUM",
            "unitCode":"mg/L", "value":"<5", "refLow":"  <10  ", "refHigh":"≥15",
            "refText":"Intervallo riportato, senza deduzioni", "notes":"Prima",
            "observedAt":"2026-10-17T13:25:40.000Z", "source":"manual", "version":7
        }))
        .unwrap();
        for value in ["<5", "3,50", "positivo, debole", "\u{0085}5"] {
            let mut row = original.clone();
            row.value = value.into();
            let record = Record::Observation(row.clone());
            let mut values = record
                .fields()
                .into_iter()
                .map(|field| field.value)
                .collect::<Vec<_>>();
            values[5] = "Nota corretta 🩺".into();
            let Draft::Observation(draft) = record.draft(&values, None).unwrap() else {
                panic!()
            };
            assert_eq!(draft.value, row.value);
            assert_eq!(draft.ref_low, row.ref_low);
            assert_eq!(draft.ref_high, row.ref_high);
            assert_eq!(draft.ref_text, row.ref_text);
            assert_eq!(draft.observed_at, row.observed_at);
            values[2] = "\u{feff}  positivo, debole  \u{feff}".into();
            values[6] = "  <2,5  ".into();
            let Draft::Observation(draft) = record.draft(&values, None).unwrap() else {
                panic!()
            };
            assert_eq!(draft.value, "positivo, debole");
            assert_eq!(draft.ref_low.as_deref(), Some("  <2,5  "));
            values[2] = "\u{feff}".into();
            assert!(record.draft(&values, None).is_err());
        }
    }
    #[test]
    fn coded_therapy_name_cannot_diverge_from_its_preserved_identity() {
        let original: Therapy = serde_json::from_value(serde_json::json!({
            "id":"therapy-1", "patientId":"patient-1", "drugName":"  Farmaco di prova  ",
            "dosage":"Dose sintetica", "status":"active", "startDate":"2026-10-17T08:15:00.000Z",
            "motivation":"<p>Motivazione <strong>conservata</strong></p>", "version":4
        }))
        .unwrap();
        for field in ["aic", "atc", "activePrinciple"] {
            let mut row = original.clone();
            match field {
                "aic" => row.aic = Some("SYN-AIC".into()),
                "atc" => row.atc = Some("SYN-ATC".into()),
                _ => row.active_principle = Some("Principio di prova".into()),
            }
            let record = Record::Therapy(row.clone());
            let fields = record.fields();
            assert!(
                fields[0].rich,
                "a coded identity must be displayed as a retained field"
            );
            let mut values = fields
                .into_iter()
                .map(|field| field.value)
                .collect::<Vec<_>>();
            values[1] = "Dose corretta esplicitamente".into();
            let Draft::Therapy(draft) = record.draft(&values, None).unwrap() else {
                panic!()
            };
            assert_eq!(draft.drug_name, row.drug_name);
            assert_eq!(draft.aic, row.aic);
            assert_eq!(draft.atc, row.atc);
            assert_eq!(draft.active_principle, row.active_principle);
            assert_eq!(draft.motivation, row.motivation);
            values[0] = "Un altro farmaco".into();
            assert!(
                record.draft(&values, None).is_err(),
                "the draft guard must also reject a tampered retained field"
            );
        }
        let record = Record::Therapy(original);
        assert!(!record.fields()[0].rich);
        let mut values = record
            .fields()
            .into_iter()
            .map(|field| field.value)
            .collect::<Vec<_>>();
        values[0] = "Preparazione manuale corretta".into();
        assert!(record.draft(&values, None).is_ok());
    }

    #[test]
    fn catalog_drug_selection_replaces_the_whole_identity_and_readback_checks_every_part() {
        let original: Therapy = serde_json::from_value(serde_json::json!({
            "id":"therapy-synthetic", "patientId":"patient-synthetic", "version":7,
            "drugName":"Farmaco sintetico", "aic":"000111111", "atc":"SYN-OLD",
            "activePrinciple":"Principio precedente", "dosage":"Dose riportata",
            "motivation":"<p>Motivo conservato</p>", "status":"active",
            "startDate":"2026-10-17T08:15:00Z", "diagnosisCode":"SYN-DIAG",
            "diagnosisName":"Indicazione riportata"
        }))
        .unwrap();
        let selected: DrugCatalogItem = serde_json::from_value(serde_json::json!({
            "name":"Farmaco sintetico", "aic":"000222222", "atc":null, "activePrinciple":null,
            "packaging":"Confezione sintetica diversa"
        }))
        .unwrap();
        let record = Record::Therapy(original.clone());
        let mut values: Vec<_> = record
            .fields()
            .into_iter()
            .map(|field| field.value)
            .collect();
        // A different AIC with the same name is still an explicit drug change.
        let Draft::Therapy(draft) = record.draft(&values, Some(&selected)).unwrap() else {
            panic!()
        };
        assert_eq!(draft.aic.as_deref(), Some("000222222"));
        assert!(draft.atc.is_none() && draft.active_principle.is_none());
        assert_eq!(draft.dosage, original.dosage);
        assert_eq!(draft.motivation, original.motivation);
        assert_eq!(draft.diagnosis_code, original.diagnosis_code);
        assert_eq!(draft.diagnosis_name, original.diagnosis_name);
        assert_eq!(draft.start_date, original.start_date);
        let mut readback = original.clone();
        readback.aic = draft.aic.clone();
        readback.atc = draft.atc.clone();
        readback.active_principle = draft.active_principle.clone();
        assert!(therapy_matches(&readback, &draft));
        for part in ["name", "aic", "atc", "principle"] {
            let mut wrong = readback.clone();
            match part {
                "name" => wrong.drug_name = "Altra descrizione".into(),
                "aic" => wrong.aic = original.aic.clone(),
                "atc" => wrong.atc = original.atc.clone(),
                _ => wrong.active_principle = original.active_principle.clone(),
            }
            assert!(
                !therapy_matches(&wrong, &draft),
                "unconfirmed identity component: {part}"
            );
        }
        values[0] = "Rinomina isolata".into();
        assert!(record.draft(&values, Some(&selected)).is_err());
        let mut invalid = selected.clone();
        invalid.aic.clear();
        assert!(validate_drug_choice(&invalid.name, &invalid).is_err());
        values[0] = selected.name.clone();
        assert!(record.draft(&values, Some(&invalid)).is_err());
        // The same choice cannot grant permission to replace a rich indication.
        values[3] = "Motivo riscritto fuori dall'editor".into();
        assert!(record.draft(&values, Some(&selected)).is_err());
    }
    #[test]
    fn decrypted_and_live_record_is_required_before_constructing_any_update() {
        let mut original = entry();
        original.locked_fields.push("content".into());
        let record = Record::Entry(original);
        let mut values = record
            .fields()
            .into_iter()
            .map(|field| field.value)
            .collect::<Vec<_>>();
        values[0] = "Corretto".into();
        assert!(record.draft(&values, None).is_err());
        let mut original = entry();
        original.deleted_at = Some("2026-10-17".into());
        assert!(Record::Entry(original).draft(&values, None).is_err());
    }
}
