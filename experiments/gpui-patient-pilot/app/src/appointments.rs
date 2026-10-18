//! Checkups are instants, presented and edited in the computer's local timezone.
//! Other date-only clinical fields retain their existing calendar contract.

use chrono::{DateTime, NaiveDateTime, SecondsFormat, TimeZone, Timelike, Utc};

pub fn for_write<T: TimeZone>(day: &str, time: &str, zone: &T) -> Result<String, String> {
    let value = format!("{} {}", day.trim(), time.trim());
    let format = if time.trim().len() == 5 {
        "%Y-%m-%d %H:%M"
    } else {
        "%Y-%m-%d %H:%M:%S%.f"
    };
    let local = NaiveDateTime::parse_from_str(&value, format)
        .ok()
        .filter(|date| {
            let canonical = if value.len() == 16 {
                date.format("%Y-%m-%d %H:%M").to_string() == value
            } else {
                date.format("%Y-%m-%d %H:%M:%S").to_string() == value.get(..19).unwrap_or("")
                    && (value.len() == 19
                        || (21..=29).contains(&value.len())
                            && value.as_bytes()[19] == b'.'
                            && value.as_bytes()[20..].iter().all(u8::is_ascii_digit))
            };
            canonical && date.nanosecond() < 1_000_000_000
        })
        .ok_or_else(|| {
            "Inserisci una data valida (AAAA-MM-GG) e un'ora locale completa (HH:MM, con secondi facoltativi).".to_owned()
        })?;
    // A timezone gap/fold does not identify one instant. Never choose an offset
    // on the user's behalf or normalize a nonexistent clock time.
    let instant = zone.from_local_datetime(&local).single().ok_or_else(|| {
        "Questa data e ora non sono univoche nel fuso del computer. Scegli un altro orario."
            .to_owned()
    })?;
    // checkups.date uses Drizzle's SQLite timestamp mode: integer seconds.
    // Reject fractions before submitting; truncation would change the reviewed instant and
    // could never satisfy an exact readback. Unchanged originals return earlier
    // from edited(), preserving their source bytes.
    if local.nanosecond() != 0 {
        return Err(
            "Indica secondi interi: le frazioni di secondo non possono essere registrate.".into(),
        );
    }
    Ok(instant
        .with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true))
}

pub fn fields<T: TimeZone>(original: &str, zone: &T) -> Result<(String, String), String> {
    let local = DateTime::parse_from_rfc3339(original)
        .map_err(|_| "Rileggi la data e l'ora del controllo prima di modificarlo.".to_owned())?
        .with_timezone(zone)
        .naive_local();
    let time = if local.second() == 0 && local.nanosecond() == 0 {
        local.format("%H:%M").to_string()
    } else {
        local.format("%H:%M:%S%.f").to_string()
    };
    Ok((local.date().to_string(), time))
}

pub fn edited<T: TimeZone>(
    day: &str,
    time: &str,
    original: &str,
    zone: &T,
) -> Result<String, String> {
    let (original_day, original_time) = fields(original, zone)?;
    if day.trim() == original_day && time.trim() == original_time {
        // Title/status/notes edits must retain the exact original timestamp,
        // including offset and subsecond precision, even during a DST fold.
        return Ok(original.to_owned());
    }
    for_write(day, time, zone)
}
