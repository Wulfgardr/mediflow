//! Import assistito (Smart Import, G-5c) tramite l'host locale.
//!
//! GPUI segue la stessa catena del Web (`createSmartImportReviewBrowserController`):
//! fonti della scheda raccolte come `buildPatientSmartImportProjectionCaptureInput`,
//! normalizzate come `createSmartImportProjectionAttachmentBrowserNormalizer`,
//! selezione di paziente e ambulatorio sulla sessione Web dell'host, ingest della
//! proiezione e anteprima. Il server resta l'autorità su kill switch, governo,
//! proiezione, validazione della proposta e ricevuta.
//!
//! È un'anteprima da rivedere: nessuna route di scrittura, nessun apply. L'apply
//! legacy è ritirato (risponde 410) e qui non esiste; una scrittura derivata arriva
//! soltanto con il contratto G-6j.

use super::*;
use regex::Regex;
use std::sync::OnceLock;
use std::sync::atomic::AtomicU64;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroize;

/// La selezione è la stessa route della sintesi dei documenti.
pub const SMART_IMPORT_SELECTION_PATH: &[&str] = DOCUMENT_SYNTHESIS_SELECTION_PATH;
pub const SMART_IMPORT_INGEST_PATH: &[&str] = &["api", "ai", "smart-import", "ingest"];
pub const SMART_IMPORT_PREVIEW_PATH: &[&str] = &["api", "ai", "smart-import", "preview"];
const ATTACHMENT_SCHEMA: &str = "mediflow.smart-import.projection-attachment.v1";
const PROPOSAL_SCHEMA: &str = "mediflow.smart-import.proposal.v1";
const MAX_SOURCES: usize = 32;
const THERAPY_HINT_LIMIT: usize = 14;
const KINDS: [&str; 4] = [
    "patient-notes",
    "clinical-entry",
    "document-insight",
    "attachment-summary",
];

fn safe(n: u64) -> bool {
    (1..=9_007_199_254_740_991).contains(&n)
}
fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `normalizeClinicalText`: NFKD, senza segni diacritici, minuscolo, solo `[a-z0-9]`.
fn normalize_clinical(value: &str) -> String {
    let folded: String = value
        .nfkd()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .collect::<String>()
        .to_lowercase();
    let mut output = String::with_capacity(folded.len());
    let mut gap = false;
    for c in folded.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if gap && !output.is_empty() {
                output.push(' ');
            }
            gap = false;
            output.push(c);
        } else {
            gap = true;
        }
    }
    output
}

/// `value.replace(/\s+/g, ' ').trim()`.
fn collapse(value: &str) -> String {
    value
        .split(js_space)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

const SNIPPET_SUFFIX: &str = "...";
/// `trimPatientSmartImportSnippet`: spazi compressi; oltre `max` unità UTF-16 accorcia
/// in modo che testo e tre punti stiano in `max`, senza spezzare un carattere.
fn snippet(value: &str, max: usize) -> String {
    let normalized = collapse(value);
    if units(&normalized) <= max {
        return normalized;
    }
    let mut taken = 0;
    let mut cut = 0;
    for (index, c) in normalized.char_indices() {
        if taken + c.len_utf16() > max - SNIPPET_SUFFIX.len() {
            break;
        }
        taken += c.len_utf16();
        cut = index + c.len_utf8();
    }
    format!(
        "{}{SNIPPET_SUFFIX}",
        normalized[..cut].trim_matches(js_space)
    )
}

/// `splitPromptSourceSegments`: righe e punti elenco; un solo segmento resta intero.
fn prompt_segments(content: &str, max: usize) -> Vec<String> {
    let segments: Vec<String> = content
        .split(['\r', '\n', ';', '•'])
        .map(collapse)
        .filter(|part| !part.is_empty())
        .collect();
    if segments.len() <= 1 {
        return vec![collapse(content)];
    }
    segments.into_iter().take(max).collect()
}

/// `splitSourceClauses`: righe, punti elenco, barre, poi frasi dopo `.`, `!` o `?`.
fn source_clauses(content: &str) -> Vec<String> {
    let mut clauses = Vec::new();
    for part in content.split(['\r', '\n', ';', '•', '|']) {
        let mut start = 0;
        let chars: Vec<(usize, char)> = part.char_indices().collect();
        let mut index = 0;
        while index < chars.len() {
            let (at, c) = chars[index];
            if matches!(c, '.' | '!' | '?')
                && chars
                    .get(index + 1)
                    .is_some_and(|(_, next)| js_space(*next))
            {
                let end = at + c.len_utf8();
                clauses.push(part[start..end].to_owned());
                index += 1;
                while chars.get(index).is_some_and(|(_, next)| js_space(*next)) {
                    index += 1;
                }
                start = chars.get(index).map_or(part.len(), |(at, _)| *at);
                continue;
            }
            index += 1;
        }
        clauses.push(part[start..].to_owned());
    }
    clauses
        .into_iter()
        .map(|clause| collapse(&clause))
        .filter(|clause| !clause.is_empty())
        .collect()
}

const THERAPY_SECTION_HINTS: [&str; 9] = [
    "terapia",
    "terapia domiciliare",
    "farmaco",
    "farmaci",
    "posologia",
    "prescr",
    "assume",
    "medicazione",
    "schema terapeutico",
];
const DRUG_QUERY_STOPWORDS: [&str; 31] = [
    "al",
    "alla",
    "alle",
    "con",
    "da",
    "del",
    "della",
    "dopo",
    "fare",
    "giorno",
    "giorni",
    "mattino",
    "mezza",
    "ogni",
    "per",
    "poi",
    "pranzo",
    "prima",
    "sera",
    "volta",
    "volte",
    "verificare",
    "confermare",
    "dose",
    "dosi",
    "ore",
    "uno",
    "una",
    "due",
    "tre",
    "quattro",
];

fn dosage_token(clause: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(
        &CELL,
        r"(?i)(?-u:\b)[0-9]+(?:[.,][0-9]+)?[\t\n\x0B\x0C\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)(?-u:\b)",
    )
    .is_match(clause)
}

fn therapy_like(clause: &str) -> bool {
    let normalized = normalize_clinical(clause);
    if normalized.is_empty() {
        return false;
    }
    if THERAPY_SECTION_HINTS
        .iter()
        .any(|hint| normalized.contains(hint))
    {
        return true;
    }
    dosage_token(clause)
        && normalized
            .split(' ')
            .any(|token| token.len() >= 4 && !DRUG_QUERY_STOPWORDS.contains(&token))
}

/// `splitTherapyCandidateClause`: passaggi («poi», «quindi», «successivamente»), poi
/// virgole non seguite da una cifra quando almeno due parti sembrano terapie.
fn therapy_parts(clause: &str) -> Vec<String> {
    static CELL: OnceLock<Regex> = OnceLock::new();
    let compact = collapse(clause);
    let transitions: Vec<String> =
        pattern(&CELL, r"(?i)(?-u:\b)(?:poi|quindi|successivamente)(?-u:\b)")
            .split(&compact)
            .map(|part| part.trim_matches(js_space).to_owned())
            .filter(|part| !part.is_empty())
            .collect();
    let base = if transitions.len() > 1 {
        transitions
    } else {
        vec![compact]
    };
    base.into_iter()
        .flat_map(|part| {
            let mut pieces = Vec::new();
            let mut start = 0;
            for (index, c) in part.char_indices() {
                if c == ','
                    && !part[index + 1..]
                        .chars()
                        .next()
                        .is_some_and(|next| next.is_ascii_digit())
                {
                    pieces.push(part[start..index].to_owned());
                    start = index + 1;
                }
            }
            pieces.push(part[start..].to_owned());
            let pieces: Vec<String> = pieces
                .into_iter()
                .map(|piece| piece.trim_matches(js_space).to_owned())
                .filter(|piece| !piece.is_empty())
                .collect();
            if pieces.len() > 1 && pieces.iter().filter(|piece| therapy_like(piece)).count() >= 2 {
                pieces
            } else {
                vec![part]
            }
        })
        .collect()
}

/// Una fonte della scheda, come `PatientSmartImportSourceRecord` del Web.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SmartImportSource {
    /// Identificativo inviato all'host (`source.local.…`); vuoto finché non si invia.
    pub id: String,
    pub kind: &'static str,
    pub origin_key: String,
    pub label: String,
    pub date: Option<String>,
    pub content: String,
}

fn therapy_hints(sources: &[SmartImportSource]) -> Vec<Value> {
    let mut seen = Vec::<String>::new();
    let mut hints = Vec::new();
    for source in sources {
        for clause in source_clauses(&source.content) {
            if !therapy_like(&clause) {
                continue;
            }
            for candidate in therapy_parts(&clause) {
                let excerpt = snippet(&candidate, 180);
                if excerpt.is_empty() {
                    continue;
                }
                let key = format!("{}:{}", source.origin_key, normalize_clinical(&excerpt));
                if seen.contains(&key) {
                    continue;
                }
                seen.push(key);
                hints.push(json!({
                    "kind": source.kind,
                    "originKey": source.origin_key,
                    "label": source.label,
                    "excerpt": excerpt,
                }));
                if hints.len() >= THERAPY_HINT_LIMIT {
                    return hints;
                }
            }
        }
    }
    hints
}

/// Data come `new Date(value)`: ISO completo o solo giorno (UTC).
fn parse_date(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&chrono::Utc))
        .ok()
        .or_else(|| {
            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .ok()
                .and_then(|day| day.and_hms_opt(0, 0, 0))
                .map(|time| time.and_utc())
        })
}
fn iso(date: chrono::DateTime<chrono::Utc>) -> String {
    date.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}
/// `toLocaleDateString('it-IT')` di Node e dei browser: `gg/mm/aaaa`, nell'ora italiana.
fn italian_day(date: chrono::DateTime<chrono::Utc>) -> String {
    date.with_timezone(&chrono_tz::Europe::Rome)
        .format("%d/%m/%Y")
        .to_string()
}
fn blank_to_null(value: Option<&str>) -> Value {
    match value.map(str::trim) {
        None | Some("") => Value::Null,
        Some(_) => json!(value.unwrap_or_default()),
    }
}
fn locked(fields: &[String], name: &str) -> bool {
    fields.iter().any(|field| field == name)
}

/// La scheda già letta e decifrata da GPUI, da cui nascono le fonti.
pub struct SmartImportChart<'a> {
    pub patient: &'a crate::PatientDetail,
    pub scope: Option<&'a str>,
    pub therapies: &'a [crate::Therapy],
    pub entries: &'a [crate::Entry],
    pub attachments: &'a [crate::Attachment],
}

/// Fonti in forma Web (`buildPatientSmartImportSourceRecords`) dai dati della
/// scheda. Le analisi dei documenti salvate nella scheda non sono lette dal client
/// abbinato: dei documenti valgono le sintesi salvate. Righe con campi illeggibili
/// restano fuori, non diventano testo vuoto.
fn chart_sources(chart: &SmartImportChart) -> Vec<SmartImportSource> {
    let mut records = Vec::new();
    let patient = chart.patient;
    if let Some(notes) = patient.notes.as_deref()
        && !locked(&patient.locked_fields, "notes")
        && !notes.trim_matches(js_space).is_empty()
    {
        for (index, segment) in prompt_segments(notes, 6).into_iter().enumerate() {
            records.push(SmartImportSource {
                id: String::new(),
                kind: "patient-notes",
                origin_key: format!("patient-notes:{}", index + 1),
                label: if index == 0 {
                    "Note paziente".into()
                } else {
                    format!("Note paziente · segmento {}", index + 1)
                },
                date: None,
                content: snippet(&segment, 900),
            });
        }
    }
    let mut entries: Vec<&crate::Entry> = chart
        .entries
        .iter()
        .filter(|row| {
            row.deleted_at.is_none()
                && row.locked_fields.is_empty()
                && !row.content.trim_matches(js_space).is_empty()
        })
        .collect();
    let time = |value: &str| parse_date(value).map_or(i64::MIN, |date| date.timestamp_millis());
    entries.sort_by_key(|row| std::cmp::Reverse(time(&row.date)));
    for entry in entries.into_iter().take(6) {
        let date = parse_date(&entry.date);
        let heading = match date {
            Some(date) => format!("{} {}", entry.entry_type.to_uppercase(), italian_day(date)),
            None => entry.entry_type.to_uppercase(),
        };
        // `clinicalRichTextToPlainText` del Web, non la copia leggibile della scheda.
        let plain = rich_text_plain(&entry.content);
        for (index, segment) in prompt_segments(&plain, 4).into_iter().enumerate() {
            let content = snippet(&segment, 650);
            if content.is_empty() {
                continue;
            }
            records.push(SmartImportSource {
                id: String::new(),
                kind: "clinical-entry",
                origin_key: format!("entry:{}:{}", entry.id, index + 1),
                label: if index == 0 {
                    heading.clone()
                } else {
                    format!("{heading} · segmento {}", index + 1)
                },
                date: date.map(iso),
                content,
            });
        }
    }
    let mut attachments: Vec<&crate::Attachment> = chart
        .attachments
        .iter()
        .filter(|row| {
            row.patient_id == patient.id
                && !locked(&row.locked_fields, "summarySnapshot")
                && !locked(&row.locked_fields, "name")
                && row
                    .summary_snapshot
                    .as_deref()
                    .is_some_and(|text| !text.trim_matches(js_space).is_empty())
        })
        .collect();
    attachments
        .sort_by_key(|row| std::cmp::Reverse(row.created_at.as_deref().map_or(i64::MIN, time)));
    for attachment in attachments.into_iter().take(3) {
        records.push(SmartImportSource {
            id: String::new(),
            kind: "attachment-summary",
            origin_key: format!("attachment:{}", attachment.id),
            label: format!("Allegato {}", attachment.name),
            date: attachment
                .created_at
                .as_deref()
                .and_then(parse_date)
                .map(iso),
            content: snippet(
                attachment.summary_snapshot.as_deref().unwrap_or_default(),
                500,
            ),
        });
    }
    records
}

/// Specchio di `buildPatientSmartImportProjectionCaptureInput`: la cattura che il Web
/// passa al normalizzatore, nella stessa forma.
pub fn smart_import_capture(chart: &SmartImportChart) -> Result<Value> {
    if locked(&chart.patient.locked_fields, "diagnoses") {
        return Err(RuntimeError::LockedField);
    }
    let diagnoses: Vec<Value> = match chart.patient.diagnoses.as_deref().map(str::trim) {
        None | Some("") => Vec::new(),
        Some(text) => serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|value| value.as_array().cloned())
            .ok_or(RuntimeError::InvalidInput)?,
    }
    .into_iter()
    .filter_map(|item| {
        let field = |key: &str| {
            item[key]
                .as_str()
                .filter(|text| !text.trim().is_empty())
                .map(str::to_owned)
        };
        Some(json!({
            "system": field("system")?,
            "code": field("code")?,
            "description": field("description")?,
        }))
    })
    .collect();
    let therapies: Vec<Value> = chart
        .therapies
        .iter()
        .filter(|row| {
            row.deleted_at.is_none() && row.locked_fields.is_empty() && row.status == "active"
        })
        .map(|row| {
            json!({
                "drugName": row.drug_name,
                "activePrinciple": blank_to_null(row.active_principle.as_deref()),
                "dosage": blank_to_null(Some(&row.dosage)),
                "aic": blank_to_null(row.aic.as_deref()),
                "atc": blank_to_null(row.atc.as_deref()),
            })
        })
        .collect();
    let sources = chart_sources(chart);
    let hints = therapy_hints(&sources);
    Ok(json!({
        "patient": {"version": chart.patient.version},
        "currentDiagnoses": diagnoses,
        "currentActiveTherapies": therapies,
        "sources": sources.iter().map(|source| json!({
            "kind": source.kind,
            "originKey": source.origin_key,
            "label": source.label,
            "date": source.date,
            "content": source.content,
        })).collect::<Vec<_>>(),
        "therapyCandidateHints": hints,
    }))
}

/// Testo come `text` del normalizzatore: non vuoto, entro `max`, senza i caratteri
/// di controllo che il Web rifiuta.
fn capture_text(value: &Value, max: usize) -> Option<String> {
    let text = value.as_str()?;
    (!text.trim_matches(js_space).is_empty()
        && units(text) <= max
        && !text.chars().any(|c| {
            matches!(
                c,
                '\u{0}' | '\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}'
            )
        }))
    .then(|| text.to_owned())
}
fn origin_key(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^[A-Za-z][A-Za-z0-9._:-]{0,159}$").is_match(value)
}
fn base36(mut n: u64, width: usize) -> String {
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut output = Vec::new();
    loop {
        output.push(digits[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    while output.len() < width {
        output.push(b'0');
    }
    output.reverse();
    String::from_utf8(output).unwrap_or_default()
}

/// La richiesta pronta: la cattura che il Web invierebbe e le sue fonti nell'ordine
/// del normalizzatore. Gli identificativi `source.local.…` nascono all'invio.
#[derive(Clone, Debug, PartialEq)]
pub struct SmartImportRequest {
    pub patient_id: String,
    pub ambulatory_id: String,
    pub patient_revision: u64,
    /// La cattura in forma Web: è ciò che una richiesta fatta adesso invierebbe.
    pub capture: Value,
    pub sources: Vec<SmartImportSource>,
    pub diagnosis_count: usize,
    pub therapy_count: usize,
    hints: Vec<(String, String, String)>,
    attachment: Option<Value>,
    request_ids: Option<(String, String)>,
}

static SOURCE_REVISION: AtomicU64 = AtomicU64::new(1);

impl SmartImportRequest {
    /// Controlli e ordine di `capture` nel normalizzatore Web. Il profilo abbinato non
    /// espone l'ambulatorio interno: vale l'ambulatorio con cui GPUI ha letto la scheda.
    pub fn new(
        patient: &crate::PatientDetail,
        scope: Option<&str>,
        capture: Value,
    ) -> Result<Self> {
        let ambulatory_id = match (patient.ambulatory_id.as_deref(), scope) {
            (Some(own), Some(scope)) if own != scope => return Err(RuntimeError::InvalidInput),
            (Some(id), _) | (None, Some(id)) => id.to_owned(),
            (None, None) => return Err(RuntimeError::InvalidInput),
        };
        let invalid = RuntimeError::InvalidInput;
        let root = exact_object(
            &capture,
            &[
                "patient",
                "currentDiagnoses",
                "currentActiveTherapies",
                "sources",
                "therapyCandidateHints",
            ],
        )
        .ok_or(invalid)?;
        let revision = exact_object(&root["patient"], &["version"])
            .and_then(|p| p["version"].as_u64())
            .filter(|n| safe(*n))
            .ok_or(invalid)?;
        if revision != patient.version {
            return Err(invalid);
        }
        let mut by_origin: Vec<SmartImportSource> = Vec::new();
        for item in root["sources"].as_array().ok_or(invalid)? {
            let item = exact_object(item, &["kind", "originKey", "label", "date", "content"])
                .ok_or(invalid)?;
            let kind = KINDS
                .iter()
                .find(|kind| item["kind"] == **kind)
                .copied()
                .ok_or(invalid)?;
            let origin = capture_text(&item["originKey"], 160)
                .filter(|key| origin_key(key))
                .ok_or(invalid)?;
            let date = match &item["date"] {
                Value::Null => None,
                value => Some(canonical_iso(value).ok_or(invalid)?),
            };
            let source = SmartImportSource {
                id: String::new(),
                kind,
                origin_key: origin,
                label: capture_text(&item["label"], 160).ok_or(invalid)?,
                date,
                content: capture_text(&item["content"], 900).ok_or(invalid)?,
            };
            match by_origin
                .iter()
                .find(|prior| prior.kind == source.kind && prior.origin_key == source.origin_key)
            {
                Some(prior) if *prior != source => return Err(invalid),
                Some(_) => {}
                None => by_origin.push(source),
            }
        }
        let kind_index = |kind: &str| KINDS.iter().position(|k| *k == kind).unwrap_or(0);
        by_origin.sort_by(|left, right| {
            kind_index(left.kind)
                .cmp(&kind_index(right.kind))
                .then_with(|| match (&left.date, &right.date) {
                    (Some(a), Some(b)) => b.cmp(a),
                    (None, None) => std::cmp::Ordering::Equal,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (Some(_), None) => std::cmp::Ordering::Less,
                })
                .then_with(|| left.origin_key.cmp(&right.origin_key))
        });
        if by_origin.is_empty() {
            return Err(RuntimeError::Missing);
        }
        if by_origin.len() > MAX_SOURCES {
            return Err(RuntimeError::TooLarge);
        }
        let mut hints: Vec<(String, String, String)> = Vec::new();
        for item in root["therapyCandidateHints"].as_array().ok_or(invalid)? {
            let item =
                exact_object(item, &["kind", "originKey", "label", "excerpt"]).ok_or(invalid)?;
            let origin = item["originKey"].as_str().unwrap_or_default();
            if !by_origin
                .iter()
                .any(|source| item["kind"] == source.kind && source.origin_key == origin)
            {
                return Err(invalid);
            }
            let hint = (
                format!("{}\u{0}{origin}", item["kind"].as_str().unwrap_or_default()),
                capture_text(&item["label"], 160).ok_or(invalid)?,
                capture_text(&item["excerpt"], 600).ok_or(invalid)?,
            );
            if !hints.contains(&hint) {
                hints.push(hint);
            }
        }
        if hints.len() > MAX_SOURCES {
            return Err(invalid);
        }
        let diagnosis_count = root["currentDiagnoses"].as_array().ok_or(invalid)?.len();
        let therapy_count = root["currentActiveTherapies"]
            .as_array()
            .ok_or(invalid)?
            .len();
        Ok(Self {
            patient_id: patient.id.clone(),
            ambulatory_id,
            patient_revision: revision,
            capture,
            sources: by_origin,
            diagnosis_count,
            therapy_count,
            hints,
            attachment: None,
            request_ids: None,
        })
    }

    /// Fonti per tipo: note, diario, sintesi dei documenti.
    pub fn count(&self, kind: &str) -> usize {
        self.sources.iter().filter(|s| s.kind == kind).count()
    }

    /// Prepara l'invio con un ordinale locale nuovo e l'ora di adesso: assegna gli
    /// identificativi alle fonti e fissa gli identificativi delle due richieste.
    pub fn bind(&mut self) -> Result<()> {
        let revision = SOURCE_REVISION.fetch_add(1, Ordering::Relaxed);
        let ids = (smart_import_request_id()?, smart_import_request_id()?);
        self.bind_with(revision, &iso_now(), ids)
    }

    /// Come `bind`, con valori dati (contratto condiviso e test).
    pub fn bind_with(
        &mut self,
        revision: u64,
        captured_at: &str,
        request_ids: (String, String),
    ) -> Result<()> {
        if !safe(revision)
            || request_ids.0 == request_ids.1
            || ![&request_ids.0, &request_ids.1]
                .iter()
                .all(|id| request_id(id))
        {
            return Err(RuntimeError::InvalidInput);
        }
        let captured_at = canonical_iso(&json!(captured_at)).ok_or(RuntimeError::InvalidInput)?;
        for (index, source) in self.sources.iter_mut().enumerate() {
            source.id = format!(
                "source.local.{}.{}",
                base36(revision, 11),
                base36(index as u64 + 1, 2)
            );
        }
        let id_of = |key: &str| {
            self.sources
                .iter()
                .find(|s| format!("{}\u{0}{}", s.kind, s.origin_key) == key)
                .map(|s| s.id.clone())
                .unwrap_or_default()
        };
        let mut hints: Vec<(String, String, String)> = self
            .hints
            .iter()
            .map(|(key, label, excerpt)| (id_of(key), label.clone(), excerpt.clone()))
            .collect();
        hints.sort();
        self.attachment = Some(json!({
            "schemaVersion": ATTACHMENT_SCHEMA,
            "capability": "smart_import",
            "patientRevision": self.patient_revision,
            "sourceRevision": revision,
            "capturedAt": captured_at,
            "currentDiagnoses": self.capture["currentDiagnoses"],
            "currentActiveTherapies": self.capture["currentActiveTherapies"],
            "therapyCandidateHints": hints.into_iter().map(|(id, label, excerpt)| json!({
                "sourceId": id, "label": label, "excerpt": excerpt,
            })).collect::<Vec<_>>(),
            "sources": self.sources.iter().map(|s| json!({
                "id": s.id, "kind": s.kind, "label": s.label, "date": s.date, "content": s.content,
            })).collect::<Vec<_>>(),
        }));
        self.request_ids = Some(request_ids);
        Ok(())
    }

    /// La fonte inviata con questo identificativo.
    pub fn source(&self, id: &str) -> Option<&SmartImportSource> {
        self.sources.iter().find(|s| !s.id.is_empty() && s.id == id)
    }

    /// Corpo della selezione, come `selection.select` del Web.
    pub fn selection_body(&self, expected_epoch: u64) -> Value {
        json!({
            "expectedEpoch": expected_epoch,
            "patientId": self.patient_id,
            "ambulatoryId": self.ambulatory_id,
        })
    }
    /// Corpo dell'ingest: tupla della selezione, proiezione, identificativo.
    pub fn ingest_body(&self, tuple: &Value) -> Result<Value> {
        let (Some(attachment), Some((ingest, _))) = (&self.attachment, &self.request_ids) else {
            return Err(RuntimeError::InvalidInput);
        };
        Ok(json!({ "tuple": tuple, "attachment": attachment, "requestId": ingest }))
    }
    /// Corpo dell'anteprima: la maniglia dell'ingest e un altro identificativo.
    pub fn preview_body(&self, handle: &str) -> Result<Value> {
        let Some((_, preview)) = &self.request_ids else {
            return Err(RuntimeError::InvalidInput);
        };
        Ok(json!({ "handle": handle, "requestId": preview }))
    }

    /// Toglie dalla memoria i testi clinici; restano gli identificativi.
    pub fn wipe(&mut self) {
        for source in &mut self.sources {
            source.content.zeroize();
            source.label.zeroize();
        }
        for (_, label, excerpt) in &mut self.hints {
            label.zeroize();
            excerpt.zeroize();
        }
        self.capture = Value::Null;
        self.attachment = None;
    }
}

fn request_id(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    static UUID: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"^[A-Za-z][A-Za-z0-9._:-]{15,159}$").is_match(value)
        && !pattern(
            &UUID,
            r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        )
        .is_match(value)
}
/// `req_` e 32 cifre esadecimali casuali, come il Web.
fn smart_import_request_id() -> Result<String> {
    Ok(format!("req_{}", operation_uuid()?.replace('-', "")))
}

/// La tupla della selezione concessa (`{"selection": …}`), con un'epoca che segue
/// quella attesa.
pub fn smart_import_selection_tuple(body: &[u8], expected_epoch: u64) -> Result<Value> {
    check_selection_lease(body, expected_epoch)?;
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    let lease = &value["selection"];
    Ok(json!({
        "sessionRef": lease["sessionRef"],
        "selectionEpoch": lease["selectionEpoch"],
        "patientRef": lease["patientRef"],
        "ambulatoryRef": lease["ambulatoryRef"],
        "leaseRef": lease["leaseRef"],
    }))
}

/// Un candidato da rivedere, con la fonte che l'ha prodotto.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SmartImportCandidate {
    pub title: String,
    pub details: Vec<(&'static str, String)>,
    pub confidence: &'static str,
    pub evidence: String,
    pub source_id: String,
    pub items: Vec<SmartImportCandidate>,
}

/// Una proposta da rivedere: nessuna scrittura, nessuna applicazione.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SmartImportProposal {
    pub summary: String,
    pub diagnoses: Vec<SmartImportCandidate>,
    pub therapies: Vec<SmartImportCandidate>,
    pub services: Vec<SmartImportCandidate>,
    pub generated_at: String,
    pub provider: String,
    pub model: String,
    pub venue: String,
    pub egress: String,
    pub fallback_count: u64,
    pub review_ref: String,
    pub writes_performed: u64,
}
impl SmartImportProposal {
    pub fn candidates(&self) -> impl Iterator<Item = &SmartImportCandidate> {
        self.diagnoses
            .iter()
            .chain(&self.therapies)
            .chain(&self.services)
            .flat_map(|c| std::iter::once(c).chain(&c.items))
    }
    /// Ogni candidato cita una fonte inviata con la richiesta.
    pub fn cites_only(&self, request: &SmartImportRequest) -> bool {
        self.candidates()
            .all(|c| request.source(&c.source_id).is_some())
    }
}

pub type SmartImportOutcome = GenerationOutcome<SmartImportProposal>;

const DENIAL_CODES: [&str; 12] = [
    "input_invalid",
    "kill_switch_disabled",
    "kill_switch_unavailable",
    "projection_unavailable",
    "lifecycle_missing",
    "lifecycle_corrupt",
    "lifecycle_unavailable",
    "provider_binding_denied",
    "provider_unready",
    "model_unavailable",
    "fabric_denied",
    "source_invalid",
];
const FAILURE_CODES: [&str; 3] = ["provider_failed", "proposal_invalid", "response_truncated"];
/// Codici che dicono «funzione non disponibile» e non «errore».
const UNAVAILABLE_CODES: [&str; 9] = [
    "kill_switch_disabled",
    "function_disabled",
    "lifecycle_missing",
    "lifecycle_corrupt",
    "lifecycle_unavailable",
    "provider_binding_denied",
    "provider_unready",
    "model_unavailable",
    "kill_switch_unavailable",
];

fn classify(code: String) -> SmartImportOutcome {
    if UNAVAILABLE_CODES.contains(&code.as_str()) {
        GenerationOutcome::Unavailable(code)
    } else {
        GenerationOutcome::Failed(code)
    }
}

/// Esito di un rifiuto HTTP: un codice, mai testo del server.
fn denied(status: u16, body: &[u8]) -> SmartImportOutcome {
    let code = denial_code(body);
    classify(match status {
        401 => "session_unavailable".into(),
        403 if code == "function_disabled" => code,
        403 => "fabric_denied".into(),
        _ if code.is_empty() => "operation_unavailable".into(),
        _ => code,
    })
}

/// Testo per un codice dell'host.
pub fn smart_import_message(code: &str) -> &'static str {
    match code {
        "kill_switch_disabled" | "function_disabled" => {
            "L’import assistito è spento sull’home-base. Si riattiva in Impostazioni, Funzioni IA."
        }
        "kill_switch_unavailable" => {
            "L’home-base non riesce a leggere se l’import assistito è acceso. Verifica Impostazioni, Funzioni IA."
        }
        "lifecycle_missing"
        | "lifecycle_corrupt"
        | "lifecycle_unavailable"
        | "provider_binding_denied"
        | "provider_unready"
        | "model_unavailable" => {
            "Il modello locale dell’home-base non è disponibile. Verifica Impostazioni, Modelli locali."
        }
        "fabric_denied" => "L’home-base non ha autorizzato l’esecuzione sul modello locale.",
        "provider_failed" => "Il modello locale non ha risposto.",
        "proposal_invalid" => "La risposta del modello non ha superato i controlli dell’home-base.",
        "response_truncated" => {
            "La risposta del modello si è interrotta prima della fine. Riprova."
        }
        "projection_unavailable"
        | "projection_stale"
        | "lease_expired"
        | "selection_changed"
        | "stale_selection"
        | "epoch_conflict"
        | "request_replayed"
        | "broker_revoked"
        | "selection_busy"
        | "owner_unavailable" => {
            "La selezione sull’home-base è cambiata durante la richiesta. Riprova."
        }
        "session_unavailable" | "session_ineligible" => {
            "La sessione dell’home-base non è più valida. Riapri l’accesso locale."
        }
        "response_invalid" => "La risposta dell’home-base non ha superato i controlli dell’app.",
        _ => "L’home-base ha rifiutato la richiesta.",
    }
}

/// Risposta dell'ingest: la maniglia della proiezione, oppure un esito finale.
pub fn smart_import_ingest_step(
    status: u16,
    body: &[u8],
) -> Result<std::result::Result<String, SmartImportOutcome>> {
    static CELL: OnceLock<Regex> = OnceLock::new();
    if status != 200 {
        return Ok(Err(denied(status, body)));
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    exact_object(&value, &["handle"])
        .and_then(|object| object["handle"].as_str())
        .filter(|handle| pattern(&CELL, r"^prj_[0-9a-f]{32}$").is_match(handle))
        .map(|handle| Ok(handle.to_owned()))
        .ok_or(RuntimeError::InvalidResponse)
}

/// Testo come `text` del parser della proposta: entro `max` unità UTF-16.
fn wire_text(value: &Value, max: usize, empty: bool) -> Option<String> {
    let text = value.as_str()?;
    ((empty || !text.is_empty()) && units(text) <= max).then(|| text.to_owned())
}
fn wire_iso(value: &Value) -> Option<String> {
    canonical_iso(value)
}
/// Oggetto con chiavi obbligatorie e facoltative, nessun'altra.
fn shaped<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    let object = value.as_object()?;
    (required.iter().all(|key| object.contains_key(*key))
        && object
            .keys()
            .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str())))
    .then_some(object)
}
fn confidence(value: &Value) -> Option<&'static str> {
    match value.as_str()? {
        "high" => Some("alta"),
        "medium" => Some("media"),
        "low" => Some("bassa"),
        _ => None,
    }
}
fn category(value: &Value) -> Option<String> {
    Some(
        match value.as_str()? {
            "lab" => "laboratorio",
            "imaging" => "immagini",
            "visit" => "visita",
            "rehab" => "riabilitazione",
            "screening" => "screening",
            "procedure" => "procedura",
            "other" => "altro",
            _ => return None,
        }
        .into(),
    )
}
fn therapy_state(value: &Value) -> Option<String> {
    Some(
        match value.as_str()? {
            "active" => "in corso",
            "transition" => "in cambiamento",
            "uncertain" => "incerta",
            "inactive" => "sospesa",
            _ => return None,
        }
        .into(),
    )
}
/// Un campo facoltativo: assente, oppure valido. `null` non è ammesso sul filo.
fn optional_field(
    object: &serde_json::Map<String, Value>,
    key: &str,
    label: &'static str,
    parse: impl Fn(&Value) -> Option<String>,
    details: &mut Vec<(&'static str, String)>,
) -> Option<()> {
    match object.get(key) {
        None => Some(()),
        Some(value) => {
            details.push((label, parse(value)?));
            Some(())
        }
    }
}
fn base_candidate(
    object: &serde_json::Map<String, Value>,
    title_key: &str,
) -> Option<SmartImportCandidate> {
    Some(SmartImportCandidate {
        title: wire_text(&object[title_key], 220, false)?,
        details: Vec::new(),
        confidence: confidence(&object["confidence"])?,
        evidence: wire_text(&object["evidence"], 220, false)?,
        source_id: wire_text(&object["sourceId"], 80, false)?,
        items: Vec::new(),
    })
}
fn diagnosis(value: &Value) -> Option<SmartImportCandidate> {
    let object = shaped(
        value,
        &["label", "icdQuery", "confidence", "evidence", "sourceId"],
        &["explicitCode"],
    )?;
    let mut candidate = base_candidate(object, "label")?;
    candidate
        .details
        .push(("Ricerca ICD", wire_text(&object["icdQuery"], 220, false)?));
    optional_field(
        object,
        "explicitCode",
        "Codice nel testo",
        |v| wire_text(v, 32, false),
        &mut candidate.details,
    )?;
    Some(candidate)
}
fn therapy(value: &Value) -> Option<SmartImportCandidate> {
    let object = shaped(
        value,
        &[
            "drugMention",
            "drugQuery",
            "confidence",
            "evidence",
            "sourceId",
        ],
        &[
            "activePrinciple",
            "dosage",
            "motivation",
            "therapyState",
            "reviewNote",
        ],
    )?;
    let mut candidate = base_candidate(object, "drugMention")?;
    candidate.details.push((
        "Ricerca farmaco",
        wire_text(&object["drugQuery"], 220, false)?,
    ));
    let text = |v: &Value| wire_text(v, 220, false);
    for (key, label) in [
        ("activePrinciple", "Principio attivo"),
        ("dosage", "Posologia"),
        ("motivation", "Motivo"),
    ] {
        optional_field(object, key, label, text, &mut candidate.details)?;
    }
    optional_field(
        object,
        "therapyState",
        "Stato",
        therapy_state,
        &mut candidate.details,
    )?;
    optional_field(
        object,
        "reviewNote",
        "Da verificare",
        text,
        &mut candidate.details,
    )?;
    Some(candidate)
}
fn service_item(value: &Value) -> Option<SmartImportCandidate> {
    let object = shaped(
        value,
        &["serviceName", "confidence", "evidence", "sourceId"],
        &["category", "codeSystem", "serviceCode"],
    )?;
    let mut candidate = base_candidate(object, "serviceName")?;
    let reference = |v: &Value| wire_text(v, 80, false);
    optional_field(object, "category", "Tipo", category, &mut candidate.details)?;
    optional_field(
        object,
        "codeSystem",
        "Sistema di codifica",
        reference,
        &mut candidate.details,
    )?;
    optional_field(
        object,
        "serviceCode",
        "Codice",
        reference,
        &mut candidate.details,
    )?;
    Some(candidate)
}
fn service(value: &Value) -> Option<SmartImportCandidate> {
    let object = shaped(
        value,
        &["serviceName", "confidence", "evidence", "sourceId"],
        &[
            "category",
            "priority",
            "codeSystem",
            "serviceCode",
            "clinicalQuestion",
            "provider",
            "prescribedAt",
            "requestReference",
            "items",
        ],
    )?;
    let mut candidate = base_candidate(object, "serviceName")?;
    let text = |v: &Value| wire_text(v, 220, false);
    let reference = |v: &Value| wire_text(v, 80, false);
    optional_field(object, "category", "Tipo", category, &mut candidate.details)?;
    optional_field(
        object,
        "priority",
        "Priorità",
        |v| wire_text(v, 16, false),
        &mut candidate.details,
    )?;
    optional_field(
        object,
        "codeSystem",
        "Sistema di codifica",
        reference,
        &mut candidate.details,
    )?;
    optional_field(
        object,
        "serviceCode",
        "Codice",
        reference,
        &mut candidate.details,
    )?;
    optional_field(
        object,
        "clinicalQuestion",
        "Quesito",
        text,
        &mut candidate.details,
    )?;
    optional_field(
        object,
        "provider",
        "Erogatore",
        text,
        &mut candidate.details,
    )?;
    optional_field(
        object,
        "prescribedAt",
        "Data della richiesta",
        |v| wire_text(v, 32, false),
        &mut candidate.details,
    )?;
    optional_field(
        object,
        "requestReference",
        "Riferimento",
        reference,
        &mut candidate.details,
    )?;
    if let Some(items) = object.get("items") {
        candidate.items = list(items, 20, service_item)?;
    }
    Some(candidate)
}
fn list(
    value: &Value,
    max: usize,
    parse: impl Fn(&Value) -> Option<SmartImportCandidate>,
) -> Option<Vec<SmartImportCandidate>> {
    let items = value.as_array()?;
    if items.len() > max {
        return None;
    }
    items.iter().map(parse).collect()
}
fn local_model(value: &Value) -> Option<String> {
    static CELL: OnceLock<Regex> = OnceLock::new();
    value
        .as_str()
        .filter(|m| pattern(&CELL, r"^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$").is_match(m))
        .map(str::to_owned)
}
/// Ricevuta Fabric locale (`snapshotSmartImportFabricResolutionReceipt`): Ollama sul
/// computer dell'host, nessuna uscita, nessun ripiego. Il canale remoto non è accettato:
/// GPUI non lo chiede mai.
fn local_receipt(value: &Value) -> Option<String> {
    let receipt = exact_object(
        value,
        &[
            "schemaVersion",
            "capability",
            "class",
            "venue",
            "egressProfile",
            "provider",
            "model",
            "providerReceipt",
            "fallbackCount",
        ],
    )?;
    let profile = exact_object(&receipt["egressProfile"], &["id", "version", "egress"])?;
    let nested = exact_object(
        &receipt["providerReceipt"],
        &[
            "schemaVersion",
            "authorityPlane",
            "task",
            "provider",
            "model",
            "execution",
            "endpointClass",
            "egress",
            "runtimeReadiness",
            "fallbackCount",
        ],
    )?;
    let model = local_model(&receipt["model"])?;
    (receipt["schemaVersion"] == "mediflow.ai.fabric-resolution.v1"
        && receipt["capability"] == "smart_import"
        && receipt["class"] == "generative"
        && receipt["venue"] == "local_process"
        && profile["id"] == "local_only"
        && profile["version"] == "mediflow.ai.egress-profile.v1"
        && profile["egress"] == "none"
        && receipt["provider"] == "ollama"
        && receipt["fallbackCount"] == json!(0)
        && nested["schemaVersion"] == "mediflow.ai.provider-selection.v1"
        && nested["authorityPlane"] == "clinical_application"
        && nested["task"] == "clinical"
        && nested["provider"] == "ollama"
        && nested["model"] == model.as_str()
        && nested["execution"] == "local"
        && nested["endpointClass"] == "loopback"
        && nested["egress"] == "none"
        && nested["runtimeReadiness"] == "required"
        && nested["fallbackCount"] == json!(0))
    .then_some(model)
}
fn local_provenance(value: &Value, receipt: &Value, model: &str) -> Option<()> {
    let provenance = exact_object(
        value,
        &[
            "schemaVersion",
            "capability",
            "venue",
            "provider",
            "model",
            "preprocessing",
            "receipt",
        ],
    )?;
    (provenance["schemaVersion"] == "mediflow.ai.fabric-provenance.v1"
        && provenance["capability"] == "smart_import"
        && provenance["venue"] == "local_process"
        && provenance["provider"] == "ollama"
        && provenance["model"] == model
        && provenance["preprocessing"] == json!(["context_minimization", "envelope_validation"])
        && provenance["receipt"] == *receipt)
        .then_some(())
}

/// Specchio di `parseSmartImportPreviewWireRoot` per l'esecuzione locale.
pub fn parse_smart_import_preview(value: &Value) -> Result<SmartImportOutcome> {
    let invalid = RuntimeError::InvalidResponse;
    let preview = exact_object(value, &["preview"]).ok_or(invalid)?;
    let preview = exact_object(
        &preview["preview"],
        &[
            "writesPerformed",
            "apply",
            "status",
            "code",
            "proposal",
            "receipt",
            "provenance",
            "reviewRef",
        ],
    )
    .ok_or(invalid)?;
    if preview["writesPerformed"] != json!(0) || preview["apply"] != "denied" {
        return Err(invalid);
    }
    match preview["status"].as_str() {
        Some("denied") => {
            let code = preview["code"]
                .as_str()
                .filter(|code| DENIAL_CODES.contains(code))
                .ok_or(invalid)?;
            if !["proposal", "receipt", "provenance", "reviewRef"]
                .iter()
                .all(|key| preview[*key].is_null())
            {
                return Err(invalid);
            }
            Ok(classify(code.to_owned()))
        }
        Some("failed") => {
            let code = preview["code"]
                .as_str()
                .filter(|code| FAILURE_CODES.contains(code))
                .ok_or(invalid)?;
            let model = local_receipt(&preview["receipt"]).ok_or(invalid)?;
            local_provenance(&preview["provenance"], &preview["receipt"], &model).ok_or(invalid)?;
            if !preview["proposal"].is_null() || !preview["reviewRef"].is_null() {
                return Err(invalid);
            }
            Ok(classify(code.to_owned()))
        }
        Some("available") => {
            static REVIEW: OnceLock<Regex> = OnceLock::new();
            if !preview["code"].is_null() {
                return Err(invalid);
            }
            let review_ref = preview["reviewRef"]
                .as_str()
                .filter(|r| pattern(&REVIEW, r"^review_[0-9a-f]{32}$").is_match(r))
                .ok_or(invalid)?;
            let model = local_receipt(&preview["receipt"]).ok_or(invalid)?;
            local_provenance(&preview["provenance"], &preview["receipt"], &model).ok_or(invalid)?;
            let proposal = exact_object(
                &preview["proposal"],
                &[
                    "schemaVersion",
                    "generatedAt",
                    "contract",
                    "summary",
                    "diagnoses",
                    "therapies",
                    "servicePrescriptions",
                    "writesPerformed",
                ],
            )
            .ok_or(invalid)?;
            let contract = exact_object(
                &proposal["contract"],
                &["validJson", "validTask", "legacyContract"],
            )
            .ok_or(invalid)?;
            if proposal["schemaVersion"] != PROPOSAL_SCHEMA
                || proposal["writesPerformed"] != json!(0)
                || contract["validJson"] != true
                || contract["validTask"] != true
                || !contract["legacyContract"].is_boolean()
            {
                return Err(invalid);
            }
            Ok(GenerationOutcome::Proposal(Box::new(SmartImportProposal {
                summary: wire_text(&proposal["summary"], 220, true).ok_or(invalid)?,
                generated_at: wire_iso(&proposal["generatedAt"]).ok_or(invalid)?,
                diagnoses: list(&proposal["diagnoses"], 5, diagnosis).ok_or(invalid)?,
                therapies: list(&proposal["therapies"], 10, therapy).ok_or(invalid)?,
                services: list(&proposal["servicePrescriptions"], 10, service).ok_or(invalid)?,
                provider: "ollama".into(),
                model,
                venue: "local_process".into(),
                egress: "none".into(),
                fallback_count: 0,
                review_ref: review_ref.to_owned(),
                writes_performed: 0,
            })))
        }
        _ => Err(invalid),
    }
}

/// Risposta HTTP dell'anteprima letta come esito.
pub fn smart_import_outcome(status: u16, body: &[u8]) -> Result<SmartImportOutcome> {
    if status != 200 {
        return Ok(denied(status, body));
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| RuntimeError::InvalidResponse)?;
    parse_smart_import_preview(&value)
}

impl LocalHostAccess {
    /// Il kill switch dell'import assistito come lo legge il Web, prima di ogni richiesta.
    pub fn smart_import_enabled(&self) -> Result<bool> {
        Ok(matches!(
            self.setting_value(HostSettingKey::SmartImport)?.as_deref(),
            Some("enabled" | "true" | "1")
        ))
    }
    /// Selezione, ingest e anteprima: un tentativo per passaggio, annullabile con
    /// `context`. Soltanto route di anteprima: l'host risponde con `writesPerformed: 0`
    /// e `apply: "denied"`. `request` deve essere passata da `bind`.
    pub fn preview_smart_import(
        &self,
        request: &SmartImportRequest,
        context: &RequestContext,
    ) -> Result<SmartImportOutcome> {
        let client = self.client.with_request_context(context.clone());
        let epoch = parse_selection_epoch(
            &client
                .dedicated_web_raw(
                    Method::GET,
                    SMART_IMPORT_SELECTION_PATH,
                    self.headers()?,
                    None,
                    false,
                )?
                .body,
        )?;
        let lease = client.dedicated_web_raw(
            Method::POST,
            SMART_IMPORT_SELECTION_PATH,
            self.headers()?,
            Some(&request.selection_body(epoch)),
            false,
        )?;
        let tuple = smart_import_selection_tuple(&lease.body, epoch)?;
        let ingested = client.dedicated_web_raw(
            Method::POST,
            SMART_IMPORT_INGEST_PATH,
            self.headers()?,
            Some(&request.ingest_body(&tuple)?),
            false,
        )?;
        let handle = match smart_import_ingest_step(ingested.status, &ingested.body)? {
            Ok(handle) => handle,
            Err(outcome) => return Ok(outcome),
        };
        let raw = client.dedicated_web_raw(
            Method::POST,
            SMART_IMPORT_PREVIEW_PATH,
            self.headers()?,
            Some(&request.preview_body(&handle)?),
            false,
        )?;
        smart_import_outcome(raw.status, &raw.body)
    }
}

#[cfg(test)]
mod tests;
