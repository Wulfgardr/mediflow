use super::{WORD, contiguous, normalized, string, words};
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use std::{ops::Range, sync::LazyLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Lexicon {
    negation: Vec<String>,
    suspension: Vec<String>,
    family: Vec<String>,
    exemption_revocation: Vec<String>,
    abbreviations: Vec<String>,
    qualitative_results: Vec<String>,
    legacy_prepared_negation: Vec<String>,
    legacy_prepared_family: String,
}

static LEXICON: LazyLock<Lexicon> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../../native/contracts/clinical-context-lexicon.json"
    ))
    .expect("shared clinical context lexicon")
});

fn phrases(entries: &[String]) -> Vec<Vec<String>> {
    entries
        .iter()
        .map(|entry| entry.split_whitespace().map(normalized).collect())
        .collect()
}

static NEGATION: LazyLock<Vec<Vec<String>>> = LazyLock::new(|| phrases(&LEXICON.negation));
static SUSPENSION: LazyLock<Vec<Vec<String>>> = LazyLock::new(|| phrases(&LEXICON.suspension));
static FAMILY: LazyLock<Vec<Vec<String>>> = LazyLock::new(|| phrases(&LEXICON.family));
static EXEMPTION_REVOCATION: LazyLock<Vec<Vec<String>>> =
    LazyLock::new(|| phrases(&LEXICON.exemption_revocation));

pub(super) fn structured(kind: &str) -> bool {
    matches!(kind, "therapy" | "diagnosis" | "observation" | "exemption")
}

pub(super) fn historical_therapy(status: &Value) -> bool {
    matches!(status.as_str(), Some("suspended" | "completed"))
}

pub(super) fn legacy_negation(word: &String) -> bool {
    LEXICON.legacy_prepared_negation.contains(word)
}

pub(super) fn legacy_family(word: &str) -> bool {
    static PATTERN: LazyLock<Regex> = LazyLock::new(|| super::re(&LEXICON.legacy_prepared_family));
    PATTERN.is_match(word)
}

fn cues<'a>(
    passage: &'a [String],
    entries: &'a [Vec<String>],
) -> impl Iterator<Item = Range<usize>> + 'a {
    entries.iter().flat_map(|entry| {
        passage
            .windows(entry.len())
            .enumerate()
            .filter_map(move |(start, window)| {
                window
                    .iter()
                    .zip(entry)
                    .all(|(word, pattern)| {
                        pattern
                            .strip_suffix('*')
                            .map_or(word == pattern, |prefix| word.starts_with(prefix))
                    })
                    .then_some(start..start + entry.len())
            })
    })
}

fn contains(passage: &[String], entries: &[Vec<String>]) -> bool {
    cues(passage, entries).next().is_some()
}

static COLON_HEADING: LazyLock<Regex> =
    LazyLock::new(|| super::re(r"^[ \t]*(?:#{1,6}[ \t]*)?([\p{L}][\p{L}\p{M} \t'’()/.-]*):"));

static MARKDOWN_HEADING: LazyLock<Regex> = LazyLock::new(|| {
    super::re(r"^[ \t]*#{1,6}[ \t]+([\p{L}][\p{L}\p{M}\p{N} \t'’()/.-]*)[ \t]*\r?$")
});

static FINAL_WORD: LazyLock<Regex> = LazyLock::new(|| super::re(r"[\p{L}\p{M}]+$"));
static LETTER_OR_NUMBER: LazyLock<Regex> = LazyLock::new(|| super::re(r"^[\p{L}\p{N}]"));

fn line_heading(line: &str) -> Option<(&str, &str)> {
    let captures = COLON_HEADING
        .captures(line)
        .or_else(|| MARKDOWN_HEADING.captures(line))?;
    let body = line[captures.get(0)?.end()..].trim();
    if body.as_bytes().first().is_some_and(u8::is_ascii_digit) {
        return None;
    }
    Some((captures.get(1)?.as_str(), body))
}

fn line_start(text: &str, at: usize) -> usize {
    text[..at].rfind('\n').map_or(0, |index| index + 1)
}

fn heading(text: &str, start: usize, wrapped_exemption: bool) -> (&str, &str) {
    let mut line = line_start(text, start);
    let end = text[start..]
        .find('\n')
        .map_or(text.len(), |index| start + index);
    if let Some((label, _)) =
        line_heading(&text[start..end]).or_else(|| line_heading(&text[line..end]))
    {
        return ("", label);
    }
    while line > 0 {
        let end = line - 1;
        line = line_start(text, end);
        let previous = &text[line..end];
        if previous.trim().is_empty() {
            break;
        }
        if let Some((label, body)) = line_heading(previous) {
            if !body.is_empty() {
                break;
            }
            if wrapped_exemption
                && line > 0
                && previous.trim().strip_suffix(':').is_some_and(|name| {
                    ["esenzione", "esenzioni"]
                        .iter()
                        .any(|heading| name.trim_end().eq_ignore_ascii_case(heading))
                })
            {
                let lead_end = line - 1;
                let lead = text[line_start(text, lead_end)..lead_end].trim();
                let clause = lead.rsplit(['.', '!', '?', ';', ':']).next().unwrap_or("");
                return (clause, label);
            }
            return ("", label);
        }
    }
    ("", "")
}

fn sentence_spans(text: &str, span: Range<usize>) -> impl Iterator<Item = Range<usize>> + '_ {
    let line = line_start(text, span.start);
    let mut from = line;
    let mut boundaries = text[line..]
        .char_indices()
        .filter(move |&(offset, c)| {
            let at = line + offset;
            match c {
                '\r' | '\n' | '!' | '?' => true,
                '.' => {
                    let tail = &text[at + 1..];
                    !LETTER_OR_NUMBER.is_match(tail)
                        && (tail.is_empty()
                            || !FINAL_WORD.find(&text[..at]).is_some_and(|word| {
                                LEXICON.abbreviations.contains(&normalized(word.as_str()))
                            }))
                }
                _ => false,
            }
        })
        .map(move |(offset, _)| line + offset + 1)
        .chain(std::iter::once(text.len()))
        .skip_while(move |&end| end <= line);
    std::iter::from_fn(move || {
        for end in boundaries.by_ref() {
            let start = std::mem::replace(&mut from, end);
            if start >= span.end || start == end {
                return None;
            }
            if end > span.start {
                return Some(start..end);
            }
        }
        None
    })
}

pub(super) fn sentence_after(text: &str, start: usize, end: usize) -> &str {
    let stop = sentence_spans(text, start..text.len())
        .next()
        .map_or(text.len(), |span| span.end);
    &text[end.min(stop)..stop]
}

#[derive(Default)]
pub(super) struct ClinicalContext {
    pub negated: bool,
    pub family: bool,
    pub suspended: bool,
}

impl ClinicalContext {
    pub(super) fn review(&self, allows_suspension: bool) -> String {
        [
            (self.negated, "negation"),
            (self.suspended && !allows_suspension, "suspension"),
            (self.family, "family"),
        ]
        .into_iter()
        .filter_map(|(matched, category)| matched.then_some(category))
        .collect::<Vec<_>>()
        .join(",")
    }
}

fn qualitative_result(passage: &str, values: &Value) -> Option<Range<usize>> {
    let result = words(string(&values["value"]));
    if !LEXICON.qualitative_results.contains(&result.join(" ")) {
        return None;
    }
    let mut expected = words(string(&values["display"]));
    let display_len = expected.len();
    if display_len == 0 {
        return None;
    }
    expected.extend(result);
    let tokens: Vec<_> = WORD.find_iter(passage).collect();
    let normalized_tokens: Vec<_> = tokens.iter().map(|m| normalized(m.as_str())).collect();
    let end = contiguous(&normalized_tokens, &expected, 0)?;
    let first = tokens[end - expected.len()].start();
    let last = tokens[end - 1].end();
    if passage[first..last].contains(['.', '!', '?', ';', '\r', '\n']) {
        return None;
    }
    Some(tokens[end - expected.len() + display_len].start()..last)
}

pub(super) fn clinical_fact_context(
    kind: &str,
    values: &Value,
    text: &str,
    span: Range<usize>,
) -> ClinicalContext {
    let ignored = if kind == "observation" {
        qualitative_result(&text[span.clone()], values)
            .map(|result| span.start + result.start..span.start + result.end)
    } else {
        None
    };
    let mut context = ClinicalContext::default();
    for sentence in sentence_spans(text, span) {
        let raw = &text[sentence.clone()];
        let passage = words(raw);
        let (lead, label) = heading(text, sentence.start, kind == "exemption");
        let mut heading = words(lead);
        heading.extend(words(label));
        let negated = if let Some(ignored) = &ignored {
            let tokens: Vec<_> = WORD.find_iter(raw).collect();
            cues(&passage, &NEGATION).any(|cue| {
                sentence.start + tokens[cue.start].start() < ignored.start
                    || sentence.start + tokens[cue.end - 1].end() > ignored.end
            })
        } else {
            contains(&passage, &NEGATION)
        };
        context.negated |= negated || contains(&heading, &NEGATION);
        context.family |= contains(&passage, &FAMILY) || contains(&heading, &FAMILY);
        context.suspended |= contains(&passage, &SUSPENSION)
            || contains(&heading, &SUSPENSION)
            || (kind == "exemption"
                && (contains(&passage, &EXEMPTION_REVOCATION)
                    || contains(&heading, &EXEMPTION_REVOCATION)));
    }
    context
}
