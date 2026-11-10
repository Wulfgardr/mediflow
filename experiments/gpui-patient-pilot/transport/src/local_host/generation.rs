//! Parti comuni alle funzioni che generano tramite l'host locale (G-5): Quadro
//! paziente, sintesi dei documenti e, in seguito, import assistito.
//!
//! Testo normalizzato come in JavaScript, oggetti a chiavi esatte, date ISO,
//! citazioni `[Sx]`, esito di una richiesta e contesto annullabile. Ogni funzione
//! ha poi il proprio contratto di richiesta e di risposta.

use super::*;
use regex::Regex;
use std::sync::OnceLock;

/// Esito di una richiesta di generazione. Il server decide; GPUI distingue
/// soltanto come mostrarlo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GenerationOutcome<P> {
    Proposal(Box<P>),
    /// Funzione spenta, provider o modello non pronti: nessuna generazione è avvenuta.
    Unavailable(String),
    /// Generazione rifiutata o fallita: nessuna proposta.
    Failed(String),
}

/// Il codice di una risposta di rifiuto (`{"error":…,"code":…}`); vuoto se manca.
/// Il testo del server non arriva mai all'interfaccia.
pub fn denial_code(body: &[u8]) -> String {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| value["code"].as_str().map(str::to_owned))
        .unwrap_or_default()
}

pub(crate) fn pattern(cell: &'static OnceLock<Regex>, source: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(source).expect("static pattern"))
}

/// Spazi riconosciuti da `\s` (flag `u`) e da `String.prototype.trim` in JavaScript.
pub fn js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `boundedText` del Web: spazi compressi, taglio a `max` unità UTF-16, nessun testo vuoto.
/// Una coppia surrogata a cavallo del limite resta intera fuori dal taglio.
pub fn bounded_text(value: &str, max: usize) -> Option<String> {
    let mut normalized = String::with_capacity(value.len());
    let mut pending_space = false;
    for c in value.chars() {
        if js_space(c) {
            pending_space = true;
            continue;
        }
        if pending_space && !normalized.is_empty() {
            normalized.push(' ');
        }
        pending_space = false;
        normalized.push(c);
    }
    let mut units = 0;
    let mut cut = normalized.len();
    for (index, c) in normalized.char_indices() {
        units += c.len_utf16();
        if units > max {
            cut = index;
            break;
        }
    }
    normalized.truncate(cut);
    let trimmed = normalized.trim_end_matches(js_space);
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// Oggetto con esattamente queste chiavi, come `exact` nei contratti TypeScript.
pub fn exact_object<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    let object = value.as_object()?;
    (object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key)))
        .then_some(object)
}

/// Data ISO con millisecondi e `Z`, identica a `new Date(value).toISOString()`.
pub fn canonical_iso(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    if text.len() > 32 {
        return None;
    }
    let parsed = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S%.3fZ").ok()?;
    (parsed.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string() == text).then(|| text.to_owned())
}

/// Indici `Sx` citati in una riga della proposta, nell'ordine e senza ripetizioni.
/// `DATI-INCOMPLETI` non è una fonte. `None` se una citazione non è leggibile.
pub fn cited_sources(line: &str) -> Vec<usize> {
    static GROUP: OnceLock<Regex> = OnceLock::new();
    let group = pattern(
        &GROUP,
        r"\[(?:S\d+|DATI-INCOMPLETI)(?:,\s*(?:S\d+|DATI-INCOMPLETI))*\]",
    );
    let mut cited = Vec::new();
    for found in group.find_iter(line) {
        let inner = &found.as_str()[1..found.as_str().len() - 1];
        for token in inner.split(',').map(str::trim) {
            if let Some(index) = token
                .strip_prefix('S')
                .and_then(|n| n.parse::<usize>().ok())
                && !cited.contains(&index)
            {
                cited.push(index);
            }
        }
    }
    cited
}

/// Ora corrente nel formato di `Date.prototype.toISOString`.
pub fn iso_now() -> String {
    chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

impl LocalHostAccess {
    /// Contesto annullabile di una sola generazione, figlio di quello dell'host.
    pub fn generation_context(&self) -> RequestContext {
        self.client.context.child()
    }
}
