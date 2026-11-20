use chrono::{DateTime, Datelike, NaiveDate, TimeZone, Utc};
use mediflow_runtime_client::{Attachment, Entry, Observation, Therapy};

pub(super) const BAND_ROWS: usize = 5;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct VisitAnchor {
    pub(super) at: DateTime<Utc>,
    pub(super) visit_day: String,
    pub(super) recorded_by: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ChangeKind {
    Started,
    Updated,
    Suspended,
    Concluded,
    OutOfRange,
    DocumentAdded,
}

impl ChangeKind {
    const READING_ORDER: [Self; 6] = [
        Self::Suspended,
        Self::Concluded,
        Self::Updated,
        Self::Started,
        Self::OutOfRange,
        Self::DocumentAdded,
    ];

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Started => "Avviata",
            Self::Updated => "Aggiornata",
            Self::Suspended => "Sospesa",
            Self::Concluded => "Conclusa",
            Self::OutOfRange => "▲ Fuori intervallo",
            Self::DocumentAdded => "Documento aggiunto",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ChangeSource {
    Therapy,
    Observation,
    Document,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Change {
    pub(super) key: String,
    pub(super) source: ChangeSource,
    pub(super) kind: ChangeKind,
    pub(super) subject: String,
    pub(super) at: DateTime<Utc>,
    pub(super) detail: Vec<Detail>,
    pub(super) more: Vec<Detail>,
    pub(super) measure: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Detail {
    pub(super) term: &'static str,
    pub(super) value: String,
}

fn detail(term: &'static str, value: impl Into<String>) -> Detail {
    Detail {
        term,
        value: value.into(),
    }
}

pub(super) fn instant(value: &str) -> Option<DateTime<Utc>> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Some(parsed.with_timezone(&Utc));
    }
    let day = NaiveDate::parse_from_str(value.get(..10)?, "%Y-%m-%d").ok()?;
    Some(day.and_hms_opt(0, 0, 0)?.and_utc())
}

pub(super) fn day_in_zone<T: TimeZone>(at: DateTime<Utc>, zone: &T) -> String
where
    T::Offset: std::fmt::Display,
{
    at.with_timezone(zone).format("%d/%m/%Y").to_string()
}

pub(super) fn visit_anchor(entries: &[Entry]) -> Option<VisitAnchor> {
    entries
        .iter()
        .filter(|entry| entry.deleted_at.is_none() && entry.entry_type == "visit")
        .filter_map(|entry| {
            let at = entry
                .created_at
                .as_deref()
                .and_then(instant)
                .or_else(|| instant(&entry.date))?;
            Some(VisitAnchor {
                at,
                visit_day: crate::components::display_instant_date(&entry.date),
                recorded_by: entry
                    .recorded_by
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_owned),
            })
        })
        .max_by_key(|anchor| anchor.at)
}

fn therapy_change(row: &Therapy, after: DateTime<Utc>) -> Option<Change> {
    if row.deleted_at.is_some() {
        return None;
    }
    let at = row
        .updated_at
        .as_deref()
        .or(row.created_at.as_deref())
        .and_then(instant)?;
    if at <= after {
        return None;
    }
    let kind = match row.status.as_str() {
        "active" if row.version <= 1 => ChangeKind::Started,
        "active" => ChangeKind::Updated,
        "suspended" => ChangeKind::Suspended,
        "completed" | "stopped" => ChangeKind::Concluded,
        _ => return None,
    };
    let date = |value: &str| crate::components::display_date(Some(value));
    let status = super::therapy_status(&row.status);
    let mut details = vec![detail(
        "Stato attuale",
        if row.status == "active" && !row.dosage.trim().is_empty() {
            format!("{status} · {}", row.dosage)
        } else {
            status.to_owned()
        },
    )];
    if kind != ChangeKind::Started {
        details.push(detail("Prima", "Valore precedente non conservato."));
    }
    let mut more = vec![];
    if row.status != "active" && !row.dosage.trim().is_empty() {
        more.push(detail("Posologia registrata", row.dosage.clone()));
    }
    if let Some(indication) = row
        .motivation
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        more.push(detail("Indicazione", indication));
    }
    if !row.start_date.trim().is_empty() {
        more.push(detail("Inizio", date(&row.start_date)));
    }
    if let Some(end) = row.end_date.as_deref().filter(|end| !end.trim().is_empty()) {
        more.push(detail("Fine", date(end)));
    }
    Some(Change {
        key: format!("therapy-{}", row.id),
        source: ChangeSource::Therapy,
        kind,
        subject: row.drug_name.clone(),
        at,
        detail: details,
        more,
        measure: None,
    })
}

fn number(value: &str) -> Option<f64> {
    value.trim().replace(',', ".").parse::<f64>().ok()
}

fn out_of_range(row: &Observation) -> bool {
    let Some(value) = number(&row.value) else {
        return false;
    };
    let low = row.ref_low.as_deref().and_then(number);
    let high = row.ref_high.as_deref().and_then(number);
    (low.is_some() || high.is_some())
        && (low.is_some_and(|low| value < low) || high.is_some_and(|high| value > high))
}

fn observation_change<T: TimeZone>(
    row: &Observation,
    rows: &[Observation],
    after: DateTime<Utc>,
    zone: &T,
) -> Option<Change>
where
    T::Offset: std::fmt::Display,
{
    if row.deleted_at.is_some() || !out_of_range(row) {
        return None;
    }
    let observed = instant(&row.observed_at)?;
    let at = row
        .created_at
        .as_deref()
        .and_then(instant)
        .unwrap_or(observed);
    if at <= after {
        return None;
    }
    let previous = rows
        .iter()
        .filter(|other| {
            other.id != row.id
                && other.deleted_at.is_none()
                && other.code_system == row.code_system
                && other.code == row.code
        })
        .filter_map(|other| Some((instant(&other.observed_at)?, other)))
        .filter(|(when, _)| *when < observed)
        .max_by_key(|(when, _)| *when);
    let unit = |value: &str| crate::clinical_units::value(value, &row.unit_code);
    let measured =
        |other: &Observation| crate::clinical_units::value(&other.value, &other.unit_code);
    let short = |when: DateTime<Utc>| {
        day_in_zone(when, zone)
            .get(..5)
            .unwrap_or_default()
            .to_owned()
    };
    let range = match (row.ref_low.as_deref(), row.ref_high.as_deref()) {
        (Some(low), Some(high)) => format!("Riferimento {}–{}", unit(low), unit(high)),
        (Some(low), None) => format!("Riferimento da {}", unit(low)),
        (None, Some(high)) => format!("Riferimento fino a {}", unit(high)),
        (None, None) => String::new(),
    };
    Some(Change {
        key: format!("observation-{}", row.id),
        source: ChangeSource::Observation,
        kind: ChangeKind::OutOfRange,
        subject: row.display.clone(),
        measure: Some(unit(&row.value)),
        at,
        detail: vec![previous.map_or_else(
            || {
                detail(
                    "Valore",
                    format!(
                        "{} ({}) · Nessuna misura precedente",
                        unit(&row.value),
                        short(observed)
                    ),
                )
            },
            |(when, other)| {
                let comparison = format!(
                    "{} ({}) → {} ({})",
                    measured(other),
                    short(when),
                    measured(row),
                    short(observed)
                );
                detail(
                    "Valori",
                    if other.unit_code == row.unit_code {
                        comparison
                    } else {
                        format!("{comparison} · unità diverse, valori non convertiti")
                    },
                )
            },
        )],
        more: [
            (!range.is_empty()).then(|| {
                detail(
                    "Riferimento",
                    range.trim_start_matches("Riferimento ").to_owned(),
                )
            }),
            Some(detail("Misura del", day_in_zone(observed, zone))),
        ]
        .into_iter()
        .flatten()
        .collect(),
    })
}

fn document_change(row: &Attachment, after: DateTime<Utc>) -> Option<Change> {
    let at = row.created_at.as_deref().and_then(instant)?;
    (at > after).then(|| Change {
        key: format!("document-{}", row.id),
        source: ChangeSource::Document,
        kind: ChangeKind::DocumentAdded,
        subject: row.name.clone(),
        at,
        detail: vec![],
        more: vec![],
        measure: None,
    })
}

pub(super) type KindGroup = (ChangeKind, Vec<Change>);

pub(super) fn by_day_and_kind<T: TimeZone>(
    changes: Vec<Change>,
    zone: &T,
) -> Vec<(String, Vec<KindGroup>)>
where
    T::Offset: std::fmt::Display,
{
    let mut days: Vec<(String, Vec<Change>)> = vec![];
    for change in changes {
        let day = day_in_zone(change.at, zone);
        match days.last_mut() {
            Some((current, rows)) if *current == day => rows.push(change),
            _ => days.push((day, vec![change])),
        }
    }
    days.into_iter()
        .map(|(day, rows)| {
            let groups = ChangeKind::READING_ORDER
                .into_iter()
                .filter_map(|kind| {
                    let named: Vec<_> = rows
                        .iter()
                        .filter(|row| row.kind == kind)
                        .cloned()
                        .collect();
                    (!named.is_empty()).then_some((kind, named))
                })
                .collect();
            (day, groups)
        })
        .collect()
}

pub(super) fn documents_since(anchor: &VisitAnchor, rows: &[Attachment]) -> Vec<Change> {
    rows.iter()
        .filter_map(|row| document_change(row, anchor.at))
        .collect()
}

pub(super) fn latest_therapy_events<T: TimeZone>(therapies: &[Therapy], zone: &T) -> Vec<Change>
where
    T::Offset: std::fmt::Display,
{
    let everything = VisitAnchor {
        at: DateTime::<Utc>::MIN_UTC,
        visit_day: String::new(),
        recorded_by: None,
    };
    changes_since(&everything, therapies, &[], zone)
}

pub(super) fn changes_since<T: TimeZone>(
    anchor: &VisitAnchor,
    therapies: &[Therapy],
    observations: &[Observation],
    zone: &T,
) -> Vec<Change>
where
    T::Offset: std::fmt::Display,
{
    let mut changes: Vec<Change> = therapies
        .iter()
        .filter_map(|row| therapy_change(row, anchor.at))
        .chain(
            observations
                .iter()
                .filter_map(|row| observation_change(row, observations, anchor.at, zone)),
        )
        .collect();
    changes.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.subject.cmp(&b.subject)));
    changes
}

const ENTRY_KINDS: [(&str, &str, &str); 8] = [
    ("phone", "telefonata", "telefonate"),
    ("remote", "contatto remoto", "contatti remoti"),
    ("access", "accesso", "accessi"),
    ("note", "nota", "note"),
    ("visit", "visita", "visite"),
    ("exam", "esame", "esami"),
    ("hospitalization", "ricovero", "ricoveri"),
    ("scale", "scala", "scale"),
];

pub(super) fn entry_kind_label(kind: &str) -> String {
    let label = ENTRY_KINDS
        .iter()
        .find(|(known, _, _)| *known == kind)
        .map_or("voce", |(_, one, _)| *one);
    let mut letters = label.chars();
    letters
        .next()
        .map(|first| first.to_uppercase().chain(letters).collect())
        .unwrap_or_default()
}

fn registered(entry: &Entry) -> Option<DateTime<Utc>> {
    entry
        .created_at
        .as_deref()
        .and_then(instant)
        .or_else(|| instant(&entry.date))
}

pub(super) fn diary_after(anchor: &VisitAnchor, entries: &[Entry]) -> Option<String> {
    let mut counts = std::collections::BTreeMap::<String, usize>::new();
    for entry in entries {
        if entry.deleted_at.is_none() && registered(entry).is_some_and(|at| at > anchor.at) {
            counts
                .entry(entry.entry_type.clone())
                .and_modify(|count| *count += 1)
                .or_insert(1);
        }
    }
    let mut parts = vec![];
    for (kind, one, many) in ENTRY_KINDS {
        if let Some(count) = counts.remove(kind) {
            parts.push(format!("{count} {}", if count == 1 { one } else { many }));
        }
    }
    let others: usize = counts.into_values().sum();
    if others > 0 {
        parts.push(format!(
            "{others} {}",
            if others == 1 { "voce" } else { "voci" }
        ));
    }
    (!parts.is_empty()).then(|| parts.join(" · "))
}

pub(super) fn entries_on_day<'a, T: TimeZone>(
    at: DateTime<Utc>,
    entries: &'a [Entry],
    zone: &T,
) -> Vec<&'a Entry>
where
    T::Offset: std::fmt::Display,
{
    let day = day_in_zone(at, zone);
    let mut rows: Vec<_> = entries
        .iter()
        .filter(|entry| entry.deleted_at.is_none())
        .filter(|entry| registered(entry).is_some_and(|when| day_in_zone(when, zone) == day))
        .collect();
    rows.sort_by_key(|entry| registered(entry));
    rows
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct MeasureRow {
    pub(super) key: String,
    pub(super) display: String,
    pub(super) amount: String,
    pub(super) unit: String,
    pub(super) arrow: Option<&'static str>,
    pub(super) day: String,
    pub(super) trend: Option<Vec<f64>>,
    pub(super) spoken: String,
}

pub(super) fn measured_number(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    let mut parts = trimmed.strip_prefix('-').unwrap_or(trimmed).splitn(2, ',');
    let digits = |part: Option<&str>| {
        part.is_some_and(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
    };
    let decimal_comma = digits(parts.next()) && digits(parts.next());
    let normalized = if decimal_comma {
        trimmed.replacen(',', ".", 1)
    } else {
        trimmed.to_owned()
    };
    normalized.parse::<f64>().ok().filter(|n| n.is_finite())
}

pub(super) fn measure_rows<T: TimeZone>(
    rows: &[Observation],
    today: NaiveDate,
    zone: &T,
) -> Vec<MeasureRow>
where
    T::Offset: std::fmt::Display,
{
    type Series<'a> = (String, Vec<&'a Observation>);
    let mut series: Vec<Series> = vec![];
    for row in rows.iter().filter(|row| row.deleted_at.is_none()) {
        let key = serde_json::json!([
            row.patient_id,
            row.code_system,
            row.code,
            row.unit_system,
            row.unit_code
        ])
        .to_string();
        match series.iter_mut().find(|(other, _)| *other == key) {
            Some((_, values)) => values.push(row),
            None => series.push((key, vec![row])),
        }
    }
    let order = |row: &Observation| {
        (
            instant(&row.observed_at),
            row.created_at.as_deref().and_then(instant),
            row.id.clone(),
        )
    };
    for (_, values) in &mut series {
        values.sort_by_key(|row| order(row));
    }
    series.sort_by(|a, b| {
        let latest = |values: &Vec<&Observation>| values.last().map(|row| order(row));
        latest(&b.1).cmp(&latest(&a.1))
    });
    series
        .into_iter()
        .map(|(key, values)| {
            let latest = *values.last().expect("a series has a measure");
            let value = measured_number(&latest.value);
            let high = latest.ref_high.as_deref().and_then(measured_number);
            let low = latest.ref_low.as_deref().and_then(measured_number);
            let (arrow, side) = match value {
                Some(value) if high.is_some_and(|high| value > high) => {
                    (Some("↑"), ", sopra l’intervallo")
                }
                Some(value) if low.is_some_and(|low| value < low) => {
                    (Some("↓"), ", sotto l’intervallo")
                }
                _ => (None, ""),
            };
            let observed = instant(&latest.observed_at);
            let full = observed.map(|at| day_in_zone(at, zone));
            let day = match observed {
                Some(at) if at.with_timezone(zone).year() == today.year() => {
                    at.with_timezone(zone).format("%d/%m").to_string()
                }
                Some(_) => full.clone().unwrap_or_default(),
                None => "Data non registrata".to_owned(),
            };
            let trend: Vec<f64> = values
                .iter()
                .filter(|row| instant(&row.observed_at).is_some())
                .filter_map(|row| measured_number(&row.value))
                .collect();
            let shown = crate::clinical_units::value(&latest.value, &latest.unit_code);
            let (amount, unit) = shown
                .rsplit_once(' ')
                .map_or((shown.clone(), String::new()), |(amount, unit)| {
                    (amount.to_owned(), unit.to_owned())
                });
            let trend = (trend.len() >= 2).then_some(trend);
            let spoken = format!(
                "{}: {shown}{side}, {}{}",
                latest.display,
                full.map_or_else(
                    || "data non registrata".to_owned(),
                    |day| format!("misura del {day}")
                ),
                trend
                    .as_ref()
                    .map(|values| format!(", andamento di {} misure", values.len()))
                    .unwrap_or_default()
            );
            MeasureRow {
                key,
                display: latest.display.clone(),
                amount,
                unit,
                arrow,
                day,
                trend,
                spoken,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(id: &str, kind: &str, created: &str, by: Option<&str>) -> Entry {
        serde_json::from_value(
            json!({"id":id,"patientId":"p","type":kind,"title":"t","date":created,
            "content":"c","version":1,"createdAt":created,"recordedBy":by}),
        )
        .unwrap()
    }
    fn therapy(id: &str, status: &str, version: u64, updated: &str) -> Therapy {
        serde_json::from_value(
            json!({"id":id,"patientId":"p","drugName":format!("Farmaco {id}"),
            "dosage":"1 cp","status":status,"startDate":"2026-01-01","version":version,
            "createdAt":"2026-01-01T08:00:00Z","updatedAt":updated}),
        )
        .unwrap()
    }
    fn observation(
        id: &str,
        value: &str,
        low: Option<&str>,
        high: Option<&str>,
        at: &str,
    ) -> Observation {
        serde_json::from_value(json!({"id":id,"patientId":"p","codeSystem":"http://loinc.org","code":"2823-3",
            "display":"Potassio","unitSystem":"http://unitsofmeasure.org","unitCode":"mmol/L","value":value,
            "refLow":low,"refHigh":high,"observedAt":at,"version":1,"createdAt":at}))
        .unwrap()
    }

    #[test]
    fn anchor_is_the_latest_recorded_visit_of_anyone_and_ignores_notes() {
        let rows = [
            entry("a", "visit", "2026-11-01T09:00:00Z", Some("Dott.ssa Prova")),
            entry("b", "note", "2026-11-10T09:00:00Z", Some("Inf. Sintetica")),
            entry("c", "visit", "2026-11-04T09:00:00Z", Some(" ")),
        ];
        let anchor = visit_anchor(&rows).unwrap();
        assert_eq!(anchor.at, instant("2026-11-04T09:00:00Z").unwrap());
        assert_eq!(anchor.recorded_by, None);
        assert_eq!(visit_anchor(&rows[1..2]), None, "a note is not a visit");
        assert_eq!(visit_anchor(&[]), None);
    }

    #[test]
    fn therapy_rows_carry_only_the_attested_event_after_the_visit() {
        let anchor = VisitAnchor {
            at: instant("2026-11-04T09:00:00Z").unwrap(),
            visit_day: "04/11/2026".into(),
            recorded_by: None,
        };
        let rows = [
            therapy("old", "active", 3, "2026-10-01T08:00:00Z"),
            therapy("new", "active", 1, "2026-11-12T08:00:00Z"),
            therapy("upd", "active", 2, "2026-11-11T08:00:00Z"),
            therapy("sus", "suspended", 2, "2026-11-12T09:00:00Z"),
            therapy("end", "completed", 2, "2026-11-05T08:00:00Z"),
        ];
        let changes = changes_since(&anchor, &rows, &[], &Utc);
        let seen: Vec<_> = changes
            .iter()
            .map(|c| (c.subject.as_str(), c.kind))
            .collect();
        assert_eq!(
            seen,
            [
                ("Farmaco sus", ChangeKind::Suspended),
                ("Farmaco new", ChangeKind::Started),
                ("Farmaco upd", ChangeKind::Updated),
                ("Farmaco end", ChangeKind::Concluded),
            ]
        );
        assert!(
            changes[0]
                .detail
                .contains(&detail("Prima", "Valore precedente non conservato."))
        );
        assert!(
            !changes[1]
                .detail
                .iter()
                .any(|line| line.value.contains("precedente"))
        );
        assert_eq!(changes[0].detail[0], detail("Stato attuale", "Sospesa"));
        assert!(
            changes[0]
                .more
                .iter()
                .any(|line| line.term == "Posologia registrata"),
            "a suspended therapy keeps its recorded dose out of the current state"
        );
        assert!(changes[1].detail[0].value.starts_with("Attiva · "));
    }

    #[test]
    fn parameters_enter_only_out_of_numeric_range_with_the_previous_measure_if_any() {
        let anchor = VisitAnchor {
            at: instant("2026-11-04T09:00:00Z").unwrap(),
            visit_day: "04/11/2026".into(),
            recorded_by: None,
        };
        let rows = [
            observation(
                "k1",
                "4,8",
                Some("3.5"),
                Some("5.0"),
                "2026-10-02T08:00:00Z",
            ),
            observation(
                "k2",
                "5,6",
                Some("3.5"),
                Some("5.0"),
                "2026-11-10T08:00:00Z",
            ),
            observation(
                "k3",
                "4,9",
                Some("3.5"),
                Some("5.0"),
                "2026-11-11T08:00:00Z",
            ),
            observation("k4", "9", Some("normale"), None, "2026-11-11T08:00:00Z"),
        ];
        let changes = changes_since(&anchor, &[], &rows, &Utc);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::OutOfRange);
        assert_eq!(
            changes[0].detail[0].value,
            "4,8 mmol/L (02/10) → 5,6 mmol/L (10/11)"
        );
        let alone = changes_since(&anchor, &[], &rows[1..2], &Utc);
        assert_eq!(
            alone[0].detail[0].value,
            "5,6 mmol/L (10/11) · Nessuna misura precedente"
        );
    }

    #[test]
    fn a_previous_measure_in_another_unit_keeps_its_own_unit_and_is_not_converted() {
        let anchor = VisitAnchor {
            at: instant("2026-11-04T09:00:00Z").unwrap(),
            visit_day: "04/11/2026".into(),
            recorded_by: None,
        };
        let mut before = observation("k1", "19", Some("14"), Some("20"), "2026-10-02T08:00:00Z");
        before.unit_code = "mg/dL".into();
        let after = observation(
            "k2",
            "5,6",
            Some("3.5"),
            Some("5.0"),
            "2026-11-10T08:00:00Z",
        );
        let changes = changes_since(&anchor, &[], &[before, after], &Utc);
        assert_eq!(
            changes[0].detail[0].value,
            "19 mg/dL (02/10) → 5,6 mmol/L (10/11) · unità diverse, valori non convertiti"
        );
        assert_eq!(
            changes[0].more,
            [
                detail("Riferimento", "3,5 mmol/L–5,0 mmol/L"),
                detail("Misura del", "10/11/2026")
            ]
        );
    }

    #[test]
    fn twelve_changes_of_one_day_group_by_kind_and_keep_every_name() {
        let at = instant("2026-11-18T08:00:00Z").unwrap();
        let change = |subject: &str, kind| Change {
            key: subject.into(),
            source: ChangeSource::Therapy,
            kind,
            subject: subject.into(),
            at,
            detail: vec![],
            more: vec![],
            measure: None,
        };
        let mut rows: Vec<_> = (0..7)
            .map(|index| change(&format!("Farmaco {index}"), ChangeKind::Started))
            .collect();
        rows.push(change("Allopurinolo", ChangeKind::Concluded));
        rows.push(change("Spironolattone", ChangeKind::Suspended));
        for name in ["Creatinina", "Emoglobina glicata", "Potassio"] {
            rows.push(change(name, ChangeKind::OutOfRange));
        }
        let days = by_day_and_kind(rows.clone(), &Utc);
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].0, "18/11/2026");
        let lines: Vec<_> = days[0]
            .1
            .iter()
            .map(|(kind, named)| (*kind, named.len()))
            .collect();
        assert_eq!(
            lines,
            [
                (ChangeKind::Suspended, 1),
                (ChangeKind::Concluded, 1),
                (ChangeKind::Started, 7),
                (ChangeKind::OutOfRange, 3),
            ]
        );
        let mut seen: Vec<_> = days[0]
            .1
            .iter()
            .flat_map(|(_, named)| named.iter().map(|row| row.subject.clone()))
            .collect();
        let mut expected: Vec<_> = rows.into_iter().map(|row| row.subject).collect();
        seen.sort();
        expected.sort();
        assert_eq!(seen, expected, "every name, no cap");
    }

    #[test]
    fn diary_after_the_visit_is_counted_by_recorded_type_in_a_fixed_order() {
        let anchor = VisitAnchor {
            at: instant("2026-11-04T09:00:00Z").unwrap(),
            visit_day: "04/11/2026".into(),
            recorded_by: None,
        };
        let rows = [
            entry("a", "note", "2026-11-05T09:00:00Z", None),
            entry("b", "remote", "2026-11-06T09:00:00Z", None),
            entry("c", "remote", "2026-11-07T09:00:00Z", None),
            entry("d", "visit", "2026-11-03T09:00:00Z", None),
            entry("e", "scale", "2026-11-08T09:00:00Z", None),
        ];
        assert_eq!(
            diary_after(&anchor, &rows).as_deref(),
            Some("2 contatti remoti · 1 nota · 1 scala")
        );
        assert_eq!(diary_after(&anchor, &rows[3..4]), None);
        let same_day = entries_on_day(instant("2026-11-06T18:00:00Z").unwrap(), &rows, &Utc);
        assert_eq!(
            same_day
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            ["b"]
        );
    }
    fn measure(id: &str, code: &str, unit: &str, value: &str, at: &str) -> Observation {
        serde_json::from_value(
            json!({"id":id,"patientId":"p","codeSystem":"http://loinc.org","code":code,
            "display":"Peso","unitSystem":"http://unitsofmeasure.org","unitCode":unit,"value":value,
            "refHigh":"5.1","observedAt":at,"version":1,"createdAt":at}),
        )
        .unwrap()
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 19).unwrap()
    }

    #[test]
    fn a_series_keeps_one_unit_and_draws_a_trend_only_from_two_comparable_measures() {
        let kg = measure("a", "29463-7", "kg", "70", "2026-10-01T08:00:00Z");
        let lb = measure("b", "29463-7", "[lb_av]", "154", "2026-11-01T08:00:00Z");
        let rows = measure_rows(&[kg.clone(), lb.clone()], today(), &Utc);
        assert_eq!(rows.len(), 2, "kilograms and pounds are two series");
        assert_eq!(rows[0].amount, "154");
        assert!(
            rows.iter().all(|row| row.trend.is_none()),
            "one measure per unit: no trend"
        );
        let again = measure("c", "29463-7", "kg", "71,4", "2026-11-10T08:00:00Z");
        let rows = measure_rows(&[kg, lb, again], today(), &Utc);
        let kilograms = rows.iter().find(|row| row.unit == "kg").unwrap();
        assert_eq!(kilograms.trend, Some(vec![70., 71.4]));
        assert_eq!(kilograms.amount, "71,4");
        assert!(
            rows.iter()
                .find(|row| row.unit != "kg")
                .unwrap()
                .trend
                .is_none()
        );
    }

    #[test]
    fn an_older_measure_names_its_year_and_a_missing_date_says_so() {
        let older = measure("a", "2823-3", "mmol/L", "4,8", "2025-11-10T08:00:00Z");
        let rows = measure_rows(&[older.clone()], today(), &Utc);
        assert_eq!(rows[0].day, "10/11/2025");
        assert!(
            rows[0].spoken.contains("misura del 10/11/2025"),
            "{}",
            rows[0].spoken
        );
        let recent = measure("b", "2823-3", "mmol/L", "5,6", "2026-11-10T08:00:00Z");
        let rows = measure_rows(&[older.clone(), recent], today(), &Utc);
        assert_eq!(rows[0].day, "10/11");
        assert_eq!(rows[0].arrow, Some("↑"));
        assert!(
            rows[0].spoken.contains("sopra l’intervallo"),
            "{}",
            rows[0].spoken
        );
        let new_year = NaiveDate::from_ymd_opt(2027, 1, 2).unwrap();
        let december = measure("c", "2823-3", "mmol/L", "4,1", "2026-12-31T08:00:00Z");
        assert_eq!(
            measure_rows(&[december], new_year, &Utc)[0].day,
            "31/12/2026"
        );
        let undated = measure("d", "2823-3", "mmol/L", "9,9", "");
        let rows = measure_rows(&[older, undated.clone()], today(), &Utc);
        assert_eq!(
            rows[0].amount, "4,8",
            "a dated measure wins over an undated one"
        );
        assert!(rows[0].trend.is_none());
        let rows = measure_rows(&[undated], today(), &Utc);
        assert_eq!(rows[0].day, "Data non registrata");
        assert!(rows[0].spoken.contains("data non registrata"));
    }

    #[test]
    fn the_latest_measure_is_chosen_by_instant_whatever_the_notation() {
        let earlier = measure("a", "2823-3", "mmol/L", "4.0", "2026-11-10T09:00:00+02:00");
        let later = measure("b", "2823-3", "mmol/L", "5.0", "2026-11-10T08:00:00Z");
        let rows = measure_rows(&[later, earlier], today(), &Utc);
        assert_eq!(
            format!("{} {}", rows[0].amount, rows[0].unit),
            crate::clinical_units::value("5.0", "mmol/L")
        );
        assert_eq!(rows[0].trend, Some(vec![4., 5.]));
    }

    #[test]
    fn measured_numbers_follow_the_web_rules() {
        assert_eq!(measured_number(" 5,6 "), Some(5.6));
        assert_eq!(measured_number("-0,5"), Some(-0.5));
        assert_eq!(measured_number("1.32"), Some(1.32));
        assert_eq!(measured_number("1.234,5"), None);
        assert_eq!(measured_number("120/80"), None);
        assert_eq!(measured_number("positivo"), None);
        assert_eq!(measured_number(""), None);
    }
}
