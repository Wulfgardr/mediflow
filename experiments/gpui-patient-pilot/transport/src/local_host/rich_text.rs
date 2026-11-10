//! Testo semplice di una voce di diario, come `clinicalRichTextToPlainText` in
//! `lib/clinical-rich-text.ts`. Le fonti che GPUI manda al modello (Quadro paziente,
//! import assistito) devono essere quelle del Web, non la copia leggibile della
//! scheda: niente tag, niente marcatori di stile, le sei entità che il Web decodifica.
//! I casi condivisi con il Web stanno in `tests/fixtures/rich_text_plain.json`.

use super::*;
use regex::{Captures, Regex};
use std::sync::OnceLock;

const ALLOWED: [&str; 13] = [
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "blockquote",
];
/// `\s` di JavaScript (flag `u`) in una classe di caratteri del crate `regex`.
const JS_SPACE_CLASS: &str = r"[\t\n\x0B\x0C\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]";

fn js_pattern(cell: &'static OnceLock<Regex>, source: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(&source.replace(r"\s", JS_SPACE_CLASS)).expect("static pattern"))
}

fn js_trim(value: &str) -> &str {
    value.trim_matches(js_space)
}

/// `isClinicalRichTextHtml`.
pub fn is_rich_text_html(value: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    js_pattern(
        &CELL,
        r"(?i)</?(?:p|br|strong|em|u|s|ul|ol|li|h[1-3]|blockquote|b|i|strike|div)(?-u:\b)",
    )
    .is_match(value)
}

fn normalize_aliases(value: &str) -> String {
    static DIV: OnceLock<Regex> = OnceLock::new();
    static B_OPEN: OnceLock<Regex> = OnceLock::new();
    static B_CLOSE: OnceLock<Regex> = OnceLock::new();
    static I_OPEN: OnceLock<Regex> = OnceLock::new();
    static I_CLOSE: OnceLock<Regex> = OnceLock::new();
    static S_OPEN: OnceLock<Regex> = OnceLock::new();
    static S_CLOSE: OnceLock<Regex> = OnceLock::new();
    static BR: OnceLock<Regex> = OnceLock::new();
    let value =
        js_pattern(&DIV, r"(?i)<\s*/?\s*div(?-u:\b)[^>]*>").replace_all(value, |c: &Captures| {
            if c[0].contains('/') { "</p>" } else { "<p>" }
        });
    let value = js_pattern(&B_OPEN, r"(?i)<\s*b(?-u:\b)[^>]*>").replace_all(&value, "<strong>");
    let value = js_pattern(&B_CLOSE, r"(?i)<\s*/\s*b\s*>").replace_all(&value, "</strong>");
    let value = js_pattern(&I_OPEN, r"(?i)<\s*i(?-u:\b)[^>]*>").replace_all(&value, "<em>");
    let value = js_pattern(&I_CLOSE, r"(?i)<\s*/\s*i\s*>").replace_all(&value, "</em>");
    let value =
        js_pattern(&S_OPEN, r"(?i)<\s*(?:strike|del)(?-u:\b)[^>]*>").replace_all(&value, "<s>");
    let value = js_pattern(&S_CLOSE, r"(?i)<\s*/\s*(?:strike|del)\s*>").replace_all(&value, "</s>");
    js_pattern(&BR, r"(?i)<\s*br\s*/?\s*>")
        .replace_all(&value, "<br>")
        .into_owned()
}

/// `<(script|…)[^>]*>[\s\S]*?<\/\1>` con la stessa scansione da sinistra di JavaScript:
/// un'apertura senza chiusura uguale non toglie nulla e la ricerca riprende dal carattere dopo.
fn drop_blocks(value: &str) -> String {
    static OPEN: OnceLock<Regex> = OnceLock::new();
    let open = js_pattern(
        &OPEN,
        r"(?i)^<(script|style|iframe|object|embed|meta|link)[^>]*>",
    );
    let lower = value.to_ascii_lowercase();
    let mut output = String::with_capacity(value.len());
    let mut index = 0;
    let mut copied = 0;
    while index < value.len() {
        if value.as_bytes()[index] == b'<'
            && let Some(found) = open.captures(&value[index..])
        {
            let closing = format!("</{}>", found[1].to_ascii_lowercase());
            let body = index + found[0].len();
            if let Some(at) = lower[body..].find(&closing) {
                output.push_str(&value[copied..index]);
                index = body + at + closing.len();
                copied = index;
                continue;
            }
        }
        index += value[index..].chars().next().map_or(1, char::len_utf8);
    }
    output.push_str(&value[copied..]);
    output
}

/// `sanitizeClinicalRichTextHtml`.
fn sanitize(value: &str) -> String {
    static VOID: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static EMPTY: OnceLock<Regex> = OnceLock::new();
    static BREAKS: OnceLock<Regex> = OnceLock::new();
    static TRAILING: OnceLock<Regex> = OnceLock::new();
    let input = js_trim(value);
    if input.is_empty() {
        return String::new();
    }
    let normalized = drop_blocks(&normalize_aliases(input));
    let normalized = js_pattern(
        &VOID,
        r"(?i)<(?:script|style|iframe|object|embed|meta|link)[^>]*>",
    )
    .replace_all(&normalized, "");
    let normalized = js_pattern(&TAG, r"(?i)<(/?)([a-z0-9]+)(?:[\s/][^>]*)?>").replace_all(
        &normalized,
        |c: &Captures| {
            let tag = c[2].to_ascii_lowercase();
            if !ALLOWED.contains(&tag.as_str()) {
                String::new()
            } else if tag == "br" {
                "<br>".into()
            } else {
                format!("<{}{tag}>", &c[1])
            }
        },
    );
    // `<(p|h1|h2|h3|blockquote)>\s*<\/\1>`: una coppia diversa resta com'è.
    let normalized = js_pattern(
        &EMPTY,
        r"<(p|h1|h2|h3|blockquote)>\s*</(p|h1|h2|h3|blockquote)>",
    )
    .replace_all(&normalized, |c: &Captures| {
        if c[1] == c[2] {
            String::new()
        } else {
            c[0].to_owned()
        }
    });
    let normalized =
        js_pattern(&BREAKS, r"(?i)(?:<br>\s*){3,}").replace_all(&normalized, "<br><br>");
    let normalized = js_pattern(&TRAILING, r"(?i)\s+</(p|h1|h2|h3|blockquote|li|ul|ol)>")
        .replace_all(&normalized, "</$1>");
    js_trim(&escape_residual_lt(&normalized)).to_owned()
}

/// `<(?!/?(?:p|br|…)>)` diventa `&lt;`.
fn escape_residual_lt(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for (index, c) in value.char_indices() {
        if c != '<' {
            output.push(c);
            continue;
        }
        let rest = &value[index + 1..];
        let rest = rest.strip_prefix('/').unwrap_or(rest);
        let allowed = ALLOWED.iter().any(|tag| {
            rest.len() > tag.len()
                && rest.as_bytes()[..tag.len()].eq_ignore_ascii_case(tag.as_bytes())
                && rest.as_bytes()[tag.len()] == b'>'
        });
        output.push_str(if allowed { "<" } else { "&lt;" });
    }
    output
}

fn decode_entities(value: &str) -> String {
    static CELL: OnceLock<Regex> = OnceLock::new();
    pattern(&CELL, r"&(nbsp|amp|lt|gt|quot|#39);")
        .replace_all(value, |c: &Captures| match &c[1] {
            "nbsp" => " ",
            "amp" => "&",
            "lt" => "<",
            "gt" => ">",
            "quot" => "\"",
            _ => "'",
        })
        .into_owned()
}

/// `clinicalRichTextToPlainText`: blocchi e righe diventano a capo, le voci di elenco
/// `- `, gli altri tag spariscono.
pub fn rich_text_plain(value: &str) -> String {
    static BR: OnceLock<Regex> = OnceLock::new();
    static LI: OnceLock<Regex> = OnceLock::new();
    static BLOCK_END: OnceLock<Regex> = OnceLock::new();
    static LI_END: OnceLock<Regex> = OnceLock::new();
    static ANY_TAG: OnceLock<Regex> = OnceLock::new();
    static SPACE_BEFORE: OnceLock<Regex> = OnceLock::new();
    static SPACE_AFTER: OnceLock<Regex> = OnceLock::new();
    static BEFORE_ITEM: OnceLock<Regex> = OnceLock::new();
    static BLANK_LINES: OnceLock<Regex> = OnceLock::new();
    let input = js_trim(value);
    if input.is_empty() {
        return String::new();
    }
    let normalized = if is_rich_text_html(input) {
        sanitize(input)
    } else {
        input.to_owned()
    };
    let text = pattern(&BR, r"(?i)<br>").replace_all(&normalized, "\n");
    let text = pattern(&LI, r"(?i)<li>").replace_all(&text, "\n- ");
    let text =
        pattern(&BLOCK_END, r"(?i)</(?:p|h1|h2|h3|blockquote|ul|ol)>").replace_all(&text, "\n");
    let text = pattern(&LI_END, r"(?i)</li>").replace_all(&text, "");
    let text = pattern(&ANY_TAG, r"<[^>]+>").replace_all(&text, "");
    let text = decode_entities(&text).replace('\u{a0}', " ");
    let text = pattern(&SPACE_BEFORE, r"[ \t]+\n").replace_all(&text, "\n");
    let text = pattern(&SPACE_AFTER, r"\n[ \t]+").replace_all(&text, "\n");
    let text = pattern(&BEFORE_ITEM, r"\n{2,}- ").replace_all(&text, "\n- ");
    let text = pattern(&BLANK_LINES, r"\n{3,}").replace_all(&text, "\n\n");
    js_trim(&text).to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Gli stessi casi che `lib/clinical-rich-text-gpui-parity.test.ts` passa alla funzione Web.
    #[test]
    fn plain_text_matches_the_web_cases() {
        let cases: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/rich_text_plain.json"))
                .unwrap();
        for case in cases.as_array().unwrap() {
            assert_eq!(
                rich_text_plain(case["input"].as_str().unwrap()),
                case["plain"].as_str().unwrap(),
                "{}",
                case["name"]
            );
        }
    }
}
