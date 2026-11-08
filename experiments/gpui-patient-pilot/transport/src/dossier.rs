//! Verifica client dell'estrazione preparata, condivisa con il corpus Web di ADR 0176.
use chrono::{DateTime, NaiveDate};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("static dossier expression")
}
pub fn string(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}
fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn normalized(value: &str) -> String {
    value
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}
fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}
fn slice(value: &str, start: usize, end: usize) -> String {
    String::from_utf16_lossy(
        &value
            .encode_utf16()
            .skip(start)
            .take(end.saturating_sub(start))
            .collect::<Vec<_>>(),
    )
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Token {
    text: String,
    start: usize,
    end: usize,
    numeric: bool,
}
pub fn tokens(text: &str) -> Vec<Token> {
    re(r"[0-9]+(?:[.,][0-9]+)*|[\p{L}\p{M}]+")
        .find_iter(text)
        .map(|m| Token {
            text: normalized(m.as_str()),
            start: utf16_len(&text[..m.start()]),
            end: utf16_len(&text[..m.end()]),
            numeric: m.as_str().chars().any(|c| c.is_ascii_digit()),
        })
        .collect()
}
fn words(text: &str) -> Vec<String> {
    tokens(text).into_iter().map(|t| t.text).collect()
}
fn num(text: &str) -> bool {
    text.as_bytes().first().is_some_and(u8::is_ascii_digit)
}
fn numbers(text: &str) -> Vec<String> {
    words(text).into_iter().filter(|w| num(w)).collect()
}
fn contiguous(passage: &[String], wanted: &[String], from: usize) -> Option<usize> {
    if wanted.is_empty() {
        return Some(from);
    }
    if from > passage.len() {
        return None;
    }
    passage[from..]
        .windows(wanted.len())
        .position(|window| window == wanted)
        .map(|p| from + p + wanted.len())
}
fn in_order(passage: &[String], wanted: &[String]) -> Option<usize> {
    let long: Vec<_> = wanted
        .iter()
        .filter(|w| num(w) || utf16_len(w) >= 4)
        .cloned()
        .collect();
    if long.is_empty() {
        return contiguous(passage, wanted, 0);
    }
    for start in 0..passage.len() {
        if passage[start] != long[0] {
            continue;
        }
        let mut at = start + 1;
        let mut k = 1;
        while k < long.len() && at < passage.len() && at < start + long.len() * 3 + 2 {
            if passage[at] == long[k] {
                k += 1;
            }
            at += 1;
        }
        if k == long.len() {
            return Some(at);
        }
    }
    None
}
fn first_numbers(passage: &[String], from: usize, wanted: &[String]) -> Option<usize> {
    let mut at = from;
    for number in wanted {
        while at < passage.len() && !num(&passage[at]) {
            at += 1;
        }
        if passage.get(at) != Some(number) {
            return None;
        }
        at += 1;
    }
    Some(at)
}
fn one_edit(a: &str, b: &str) -> bool {
    let a: Vec<_> = a.encode_utf16().collect();
    let b: Vec<_> = b.encode_utf16().collect();
    if a.len().abs_diff(b.len()) > 1 {
        return false;
    }
    let (mut i, mut j, mut edits) = (0, 0, 0);
    while i < a.len() && j < b.len() {
        if a[i] == b[j] {
            i += 1;
            j += 1;
            continue;
        }
        edits += 1;
        if edits > 1 {
            return false;
        }
        if a.len() > b.len() {
            i += 1;
        } else if b.len() > a.len() {
            j += 1;
        } else {
            i += 1;
            j += 1;
        }
    }
    edits + a.len() - i + b.len() - j <= 1
}
fn long_enough(quote: &str) -> bool {
    tokens(quote).len() >= 3 && utf16_len(&re(r"[^\p{L}\p{N}]").replace_all(quote, "")) >= 12
}
fn unit_text(text: &str, unit: &Value) -> String {
    slice(
        text,
        unit["start"].as_u64().unwrap_or(0) as usize,
        unit["end"].as_u64().unwrap_or(0) as usize,
    )
}
pub fn anchor(text: &str, units: &[Value], quote: &str) -> Value {
    if !long_enough(quote) {
        return Value::Null;
    }
    let wanted = words(quote);
    let allowed = (wanted.len() / 6).max(1);
    let mut best: Option<(usize, Value)> = None;
    for unit in units {
        let body = unit_text(text, unit);
        let passage = tokens(&body);
        for window in passage.windows(wanted.len()) {
            let mut differences = 0;
            let mut ok = true;
            for (doc, want) in window.iter().zip(&wanted) {
                if doc.text == *want {
                    continue;
                }
                if !doc.numeric
                    && !num(want)
                    && utf16_len(&doc.text) >= 5
                    && utf16_len(want) >= 5
                    && one_edit(&doc.text, want)
                {
                    differences += 1;
                } else {
                    ok = false;
                    break;
                }
            }
            if !ok || differences > allowed {
                continue;
            }
            if best.as_ref().is_none_or(|(diff, _)| differences < *diff) {
                let first = &window[0];
                let last = &window[window.len() - 1];
                best = Some((
                    differences,
                    json!({"match":if differences==0 {"exact"} else {"approximate"}, "words":window.iter().map(|t| &t.text).collect::<Vec<_>>(), "evidence":{"unit":unit["index"],"start":first.start,"end":last.end,"excerpt":re(r"\s+").replace_all(&slice(&body,first.start,last.end)," ").trim()}}),
                ));
            }
            if differences == 0 {
                break;
            }
        }
        if best.as_ref().is_some_and(|(diff, _)| *diff == 0) {
            break;
        }
    }
    best.map(|(_, v)| v).unwrap_or(Value::Null)
}
fn family(word: &str) -> bool {
    re(r"^(?:padre|madre|fratell|sorell|figli|nonn|zi[oaie]$|familiar|genitor|mamma|papa$|coniug|moglie$|marito$|consorte$|nipot|cugin|suocer|cognat)").is_match(word)
}
fn negation(word: &str) -> bool {
    [
        "non", "nega", "negano", "negato", "negata", "assenza", "assente", "esclusa", "escluso",
        "escluse", "esclusi", "no", "senza",
    ]
    .contains(&word)
}
fn name_words_present(passage: &[String], wanted: &[String]) -> bool {
    let long: Vec<_> = wanted
        .iter()
        .filter(|w| !num(w) && utf16_len(w) >= 4)
        .collect();
    if long.is_empty() {
        wanted.iter().all(|w| passage.contains(w))
    } else {
        long.iter().all(|w| passage.contains(w))
    }
}
pub fn verify_fields(kind: &str, values: &Value, passage: &[String]) -> Value {
    let mut out = json!({"check":"ok","negated":false,"notes":[],"drop":[]});
    let fail = |mut out: Value, check: &str| {
        out["check"] = json!(check);
        out
    };
    if ["dosage", "value", "scaleTotal", "scaleMax", "percentage"]
        .iter()
        .any(|k| re(r"[\p{N}&&[^0-9]]").is_match(string(&values[*k])))
    {
        return fail(out, "value_missing");
    }
    let mut subject_at = 0;
    match kind {
        "therapy" => {
            let drug = words(string(&values["drugName"]));
            let end = contiguous(passage, &drug, 0);
            if drug.is_empty() || end.is_none() {
                return fail(out, "value_missing");
            }
            let end = end.unwrap();
            subject_at = end - drug.len();
            if first_numbers(passage, end, &numbers(string(&values["dosage"]))).is_none() {
                return fail(out, "value_missing");
            }
            if values["status"] == "active"
                && passage.iter().any(|w| {
                    re(r"^(?:sospes|sospend|interrott|interromp|sospensione|stop)").is_match(w)
                })
            {
                return fail(out, "status_conflict");
            }
            if values["subject"] != "familiare" && passage.iter().any(|w| family(w)) {
                return fail(out, "subject_conflict");
            }
            let principle = words(string(&values["activePrinciple"]));
            if !principle.is_empty()
                && contiguous(&drug, &principle, 0).is_none()
                && contiguous(
                    &passage[subject_at.saturating_sub(6)..(end + 6).min(passage.len())],
                    &principle,
                    0,
                )
                .is_none()
            {
                out["notes"] = json!([format!(
                    "Principio attivo proposto, non scritto nel documento accanto al farmaco: {}.",
                    string(&values["activePrinciple"])
                )]);
                out["drop"] = json!(["activePrinciple"]);
            }
        }
        "observation" => {
            let display = words(string(&values["display"]));
            let end = contiguous(passage, &display, 0);
            if display.is_empty() || end.is_none() {
                return fail(out, "value_missing");
            }
            let end = end.unwrap();
            subject_at = end - display.len();
            let value = words(string(&values["value"]));
            let numeric = value.iter().any(|w| num(w));
            let value_end = if numeric {
                first_numbers(
                    passage,
                    end,
                    &value.iter().filter(|w| num(w)).cloned().collect::<Vec<_>>(),
                )
            } else {
                contiguous(&passage[..(end + 4).min(passage.len())], &value, end)
            };
            let Some(value_end) = value_end else {
                return fail(out, "value_missing");
            };
            let unit = words(string(&values["unit"]));
            if !unit.is_empty()
                && contiguous(
                    &passage[..(value_end + unit.len() + 2).min(passage.len())],
                    &unit,
                    value_end,
                )
                .is_none()
            {
                return fail(out, "value_missing");
            }
        }
        "reported_scale" => {
            let Some(end) = in_order(passage, &words(string(&values["scaleName"]))) else {
                return fail(out, "value_missing");
            };
            let mut n = numbers(string(&values["scaleTotal"]));
            n.extend(numbers(string(&values["scaleMax"])));
            if first_numbers(passage, end, &n).is_none() {
                return fail(out, "value_missing");
            }
        }
        "diagnosis" => {
            if !string(&values["code"]).is_empty()
                && contiguous(passage, &words(string(&values["code"])), 0).is_none()
            {
                return fail(out, "value_missing");
            }
            let description = words(string(&values["description"]));
            let Some(end) = in_order(passage, &description) else {
                return fail(out, "value_missing");
            };
            subject_at = end.saturating_sub(description.len() * 3);
            if values["subject"] != "familiare" && passage.iter().any(|w| family(w)) {
                return fail(out, "subject_conflict");
            }
        }
        "exemption" => {
            let code = words(string(&values["code"]));
            let Some(end) = contiguous(passage, &code, 0) else {
                return fail(out, "value_missing");
            };
            subject_at = end - code.len();
        }
        "service_prescription" | "prosthetic" => {
            let field = if kind == "prosthetic" {
                "description"
            } else {
                "serviceName"
            };
            let code = if kind == "prosthetic" {
                "isoCode"
            } else {
                "requestReference"
            };
            if !name_words_present(passage, &words(string(&values[field])))
                || (!string(&values[code]).is_empty()
                    && contiguous(passage, &words(string(&values[code])), 0).is_none())
            {
                return fail(out, "value_missing");
            }
        }
        _ => {}
    }
    out["negated"] = json!(subject_at > 0 && passage[..subject_at].iter().any(|w| negation(w)));
    out
}
fn date(value: &str) -> Option<NaiveDate> {
    if !re(r"^\d{4}-\d{2}-\d{2}$").is_match(value) {
        return None;
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}
fn not_future(value: &str, now: &str) -> bool {
    date(value)
        .zip(
            DateTime::parse_from_rfc3339(now)
                .ok()
                .map(|d| d.date_naive()),
        )
        .is_some_and(|(v, n)| v <= n)
}
fn fact_id(kind: &str, values: &Value) -> String {
    let mut keys: Vec<_> = values.as_object().unwrap().keys().collect();
    keys.sort();
    let body = keys
        .into_iter()
        .map(|k| format!("{k}={}", string(&values[k])))
        .collect::<Vec<_>>()
        .join("|");
    let hash = body.encode_utf16().fold(0x811c9dc5u32, |h, c| {
        (h ^ u32::from(c)).wrapping_mul(0x01000193)
    });
    format!("p-f-{kind}-0-0-{hash:08x}")
}
fn set_default(values: &mut Value, key: &str, value: &str) {
    if string(&values[key]).is_empty() {
        values[key] = json!(value);
    }
}
fn catalog(analyte: &str, unit: &str) -> Value {
    let entries: Value = serde_json::from_str(include_str!(
        "../../../../native/contracts/dossier-conformance/catalog.json"
    ))
    .unwrap();
    let wanted = normalized_name(analyte);
    array(&entries)
        .iter()
        .find(|e| string(&e["name"]) == wanted && string(&e["unit"]) == unit.trim())
        .map(|e| json!({"code":e["code"],"unitCode":e["unit"]}))
        .unwrap_or(Value::Null)
}
fn normalized_name(value: &str) -> String {
    re(r"[^\p{L}\p{N}]+")
        .replace_all(&normalized(value), " ")
        .trim()
        .to_owned()
}
fn same_identity(fact: &Value, values: &Value) -> bool {
    let v = &fact["values"];
    match string(&fact["kind"]) {
        "diagnosis" => {
            !string(&v["code"]).is_empty()
                && !string(&values["code"]).is_empty()
                && string(&v["code"]).to_uppercase() == string(&values["code"]).to_uppercase()
        }
        "exemption" => string(&v["code"]).to_uppercase() == string(&values["code"]).to_uppercase(),
        "observation" => {
            v["code"] == values["code"]
                && v["observedAt"] == values["observedAt"]
                && words(string(&v["value"])) == words(string(&values["value"]))
        }
        _ => false,
    }
}
pub fn prepared_facts(input: &Value) -> Value {
    let source = &input["source"];
    let text = input["text"].as_str();
    let units = array(&input["units"]);
    let now = string(&input["now"]);
    let app_date = input["documentDate"].as_str();
    let source_date = string(&source["documentDate"]);
    let doc_date = app_date.or_else(|| not_future(source_date, now).then_some(source_date));
    let day = doc_date.unwrap_or("");
    let mut notes = vec![];
    if app_date.is_none() && !source_date.is_empty() && doc_date.is_none() {
        notes.push(json!(
            "La data del documento proposta dall’estrazione è futura o non valida: ignorata."
        ));
    }
    let mut facts = array(&input["parserFacts"]).to_vec();
    let mut ids = BTreeSet::new();
    let mut uncoded = 0;
    for item in array(&source["facts"]) {
        let kind = string(&item["kind"]);
        let mut raw = item["values"].clone();
        raw["quote"] = json!(string(&item["quote"]));
        raw["source"] = source["sha256"].clone();
        let id = fact_id(kind, &raw);
        if !ids.insert(id.clone()) {
            continue;
        }
        let mut v = item["values"].clone();
        let mut fact_notes = vec![];
        v.as_object_mut().unwrap().retain(|k, v| {
            ![
                "date",
                "startDate",
                "endDate",
                "observedAt",
                "prescribedAt",
                "birthDate",
            ]
            .contains(&k.as_str())
                || not_future(string(v), now)
        });
        match kind {
            "therapy" => {
                set_default(&mut v, "startDate", day);
                set_default(&mut v, "dosage", "non indicata nel documento");
                if !["active", "suspended", "completed"].contains(&string(&v["status"])) {
                    v["status"] = json!("completed");
                }
                if v["status"] == "active"
                    && (day.is_empty()
                        || date(day)
                            .zip(
                                DateTime::parse_from_rfc3339(now)
                                    .ok()
                                    .map(|d| d.date_naive()),
                            )
                            .is_some_and(|(d, n)| (n - d).num_days() > 120))
                {
                    v["status"] = json!("completed");
                    v["temporality"] = json!(
                        [
                            string(&v["temporality"]),
                            "indicata in corso dal documento, non recente"
                        ]
                        .into_iter()
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join("; ")
                    );
                }
            }
            "observation" => {
                set_default(&mut v, "observedAt", day);
                v.as_object_mut().unwrap().remove("code");
                v.as_object_mut().unwrap().remove("unitCode");
                let coded = catalog(string(&v["display"]), string(&v["unit"]));
                if coded.is_null() {
                    uncoded += 1;
                    continue;
                }
                v["code"] = coded["code"].clone();
                v["unitCode"] = coded["unitCode"].clone();
                v["codeSource"] = json!("catalogo locale: nome e unità coincidenti");
            }
            "diagnosis" => {
                set_default(&mut v, "date", day);
                if !string(&v["code"]).is_empty() {
                    set_default(&mut v, "system", "ICD-10");
                }
            }
            "service_prescription" => set_default(&mut v, "prescribedAt", day),
            "prosthetic" => {
                set_default(&mut v, "prescribedAt", day);
                set_default(&mut v, "status", "prescribed");
            }
            "exemption" => v["code"] = json!(string(&v["code"]).to_uppercase()),
            _ => set_default(&mut v, "date", day),
        }
        let mut evidence = Value::Null;
        let mut check = "no_text".to_owned();
        let mut negated = false;
        if let Some(text) = text.filter(|_| !units.is_empty()) {
            if [
                "anamnesis",
                "assessment",
                "imaging_report",
                "care_context",
                "document_entry",
                "invalidity",
            ]
            .contains(&kind)
            {
                v["title"] = json!(match kind {
                    "anamnesis" => "Anamnesi da documento",
                    "assessment" => "Valutazione da documento",
                    "imaging_report" => "Referto di imaging",
                    "care_context" => "Contesto assistenziale da documento",
                    "invalidity" => "Invalidità da documento",
                    _ => "Passo del documento",
                });
                let passage = anchor(text, units, string(&v["text"]));
                let quoted = anchor(text, units, string(&item["quote"]));
                evidence = if !passage.is_null() {
                    passage["evidence"].clone()
                } else {
                    quoted["evidence"].clone()
                };
                check = if passage.is_null() {
                    "paraphrase"
                } else if passage["match"] == "exact" {
                    "verified"
                } else {
                    "approximate"
                }
                .into();
                if !passage.is_null()
                    && kind == "invalidity"
                    && !string(&v["percentage"]).is_empty()
                {
                    let n = numbers(string(&v["percentage"]));
                    let ok = n.first().is_some_and(|n| {
                        re(&format!(
                            r"(?i)(?:^|[^0-9.,]){}\s*(?:%|per\s*cento)",
                            regex::escape(n).replace(r"\.", "[.,]").replace(',', "[.,]")
                        ))
                        .is_match(string(&evidence["excerpt"]))
                    });
                    if !ok {
                        check = "value_missing".into();
                    }
                }
                if !passage.is_null()
                    && kind == "anamnesis"
                    && v["subject"] != "familiare"
                    && array(&passage["words"]).iter().any(|w| family(string(w)))
                {
                    check = "subject_conflict".into();
                }
            } else if string(&item["quote"]).is_empty() {
                check = "no_quote".into();
            } else if !long_enough(string(&item["quote"])) {
                check = "short_quote".into();
            } else {
                let found = anchor(text, units, string(&item["quote"]));
                if found.is_null() {
                    check = "not_found".into();
                } else {
                    evidence = found["evidence"].clone();
                    let passage: Vec<_> = array(&found["words"])
                        .iter()
                        .map(|w| string(w).to_owned())
                        .collect();
                    let mut fields = verify_fields(kind, &v, &passage);
                    negated = fields["negated"] == true;
                    let unit = units.iter().find(|u| u["index"] == evidence["unit"]);
                    let before = unit
                        .map(|u| {
                            let head = slice(
                                &unit_text(text, u),
                                0,
                                evidence["start"].as_u64().unwrap_or(0) as usize,
                            );
                            let boundary = head
                                .char_indices()
                                .filter(|(at, c)| {
                                    *c == '\n'
                                        || (".;!?".contains(*c)
                                            && head[at + c.len_utf8()..]
                                                .chars()
                                                .next()
                                                .is_some_and(char::is_whitespace))
                                })
                                .map(|(at, c)| at + c.len_utf8())
                                .max()
                                .unwrap_or(0);
                            words(&head[boundary..])
                        })
                        .unwrap_or_default();
                    if before.iter().any(|w| negation(w)) {
                        negated = true;
                    }
                    if fields["check"] == "ok"
                        && ["therapy", "diagnosis"].contains(&kind)
                        && v["subject"] != "familiare"
                        && before.iter().any(|w| family(w))
                    {
                        fields["check"] = json!("subject_conflict");
                    }
                    for field in array(&fields["drop"]) {
                        v.as_object_mut().unwrap().remove(string(field));
                    }
                    fact_notes.extend(array(&fields["notes"]).iter().map(|n| string(n).to_owned()));
                    check = if fields["check"] == "ok" {
                        if found["match"] == "exact" {
                            "verified"
                        } else {
                            "approximate"
                        }
                        .to_owned()
                    } else {
                        string(&fields["check"]).to_owned()
                    };
                }
            }
        }
        if kind == "therapy"
            && !string(&v["activePrinciple"]).is_empty()
            && !["verified", "approximate"].contains(&check.as_str())
        {
            fact_notes.push(format!(
                "Principio attivo proposto: {}.",
                string(&v["activePrinciple"])
            ));
            v.as_object_mut().unwrap().remove("activePrinciple");
        }
        v["preparedCheck"] = json!(check);
        if !fact_notes.is_empty() {
            v["preparedNotes"] = json!(fact_notes.join(" "));
        }
        if array(&input["parserFacts"]).iter().any(|f| {
            (["parser:icd", "parser:exemption"].contains(&string(&f["origin"]))
                || (f["origin"] == "parser:lab" && !string(&f["values"]["code"]).is_empty()))
                && f["kind"] == kind
                && same_identity(f, &v)
        }) {
            continue;
        }
        facts.push(json!({"factId":id,"kind":kind,"origin":"prepared","evidence":evidence,"negated":negated,"values":v,"decision":"pending"}));
    }
    if uncoded > 0 {
        notes.push(json!(format!(
            "{uncoded} {} nella sintesi e nel testo conservato.",
            if uncoded == 1 {
                "valore di laboratorio senza codice LOINC verificato resta"
            } else {
                "valori di laboratorio senza codice LOINC verificato restano"
            }
        )));
    }
    if source["summary"].is_object() {
        let summary = &source["summary"];
        let mut v = json!({"title":summary["title"],"date":if not_future(string(&summary["date"]),now){string(&summary["date"])}else{day},"text":summary["text"],"textSource":"prepared","preparedCheck":"summary","preparedCoverage":if source["coverage"]["complete"]==true{"complete"}else{"partial"}});
        if source["coverage"]["pages"].as_u64().is_some_and(|p| p > 0) {
            v["preparedPages"] = json!(source["coverage"]["pages"].to_string());
        }
        if !notes.is_empty() {
            v["preparedNotes"] = json!(notes.iter().map(string).collect::<Vec<_>>().join(" "));
        }
        let id = fact_id(
            "document_entry",
            &json!({"title":v["title"],"text":v["text"],"source":source["sha256"]}),
        );
        facts.push(json!({"factId":id,"kind":"document_entry","origin":"prepared","evidence":null,"negated":false,"values":v,"decision":"pending"}));
    } else {
        notes.push(json!("L’estrazione preparata non contiene una sintesi: resta la voce di diario col testo completo."));
    }
    json!({"facts":facts,"notes":notes,"documentDate":doc_date})
}
fn name_words(value: &str) -> Vec<String> {
    re(r"\p{L}+")
        .find_iter(&normalized(value))
        .map(|m| m.as_str().to_owned())
        .collect()
}
pub fn patient_names(text: &str) -> Value {
    let mut names = vec![];
    for line in text.lines() {
        let pattern = re(
            r"(?i)^[\s>*#_-]*(?:paziente|assistit[oa]|nominativo|cognome\s+e\s+nome|nome\s+e\s+cognome)[\s*_]*[:.][\s*_]*(.+)$",
        );
        let Some(c) = pattern.captures(line) else {
            continue;
        };
        let head = c[1].replace(['*', '_'], " ");
        let head = re(r"[,;(|]|\d").split(&head).next().unwrap_or("");
        let mut words = vec![];
        let mut clinical = false;
        for raw in re(r"[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*").find_iter(head) {
            if !raw.as_str().chars().next().is_some_and(char::is_uppercase) {
                break;
            }
            let parts = name_words(raw.as_str());
            if parts.iter().any(|p|re(r"^(?:nat[oa]|cf|c|codice|cod|data|nascita|eta|anni|residente|tel|sesso|n|id|e|ed|o|od|di|del|della|dei|degli|in|con|per|a|al|alla|non|ha|se|su|da|dal|dalla)$").is_match(p)){break;}
            if parts.iter().any(|p|re(r"^(?:vigil|collabor|orientat|disorientat|lucid|cosci|svegli|apiret|febbril|eupnoic|dispnoic|stabil|allettat|deambul|ricoverat|dimess|affett|portator|sedat|agitat|tranquill|sofferent|algic|asintomatic|sintomatic|autonom|dipendent|fragil|anzian|giovane|adult|maschio|femmina|uomo|donna|not[oa]$|nega|riferisc|presenta|lamenta|in$)").is_match(p)){clinical=true;break;}
            words.extend(parts);
        }
        if !clinical && words.len() >= 2 {
            names.push(words);
        }
    }
    json!(names)
}
fn professional(code: &Value) -> bool {
    code["role"] == "professional_cf"
        && code["explicitProfessional"] == true
        && code["professionalLabelScope"] == "same_line"
}
pub fn identity(documents: &[Value], patients: &[Value], linked: Option<&str>) -> Value {
    let codes: BTreeSet<_> = documents
        .iter()
        .flat_map(|d| array(&d["taxCodes"]))
        .filter(|c| c["checksumValid"] == true && !professional(c))
        .map(|c| string(&c["value"]).trim().to_uppercase())
        .collect();
    let codes: Vec<_> = codes.into_iter().collect();
    let unattributed = documents
        .iter()
        .flat_map(|d| array(&d["taxCodes"]))
        .any(|c| c["checksumValid"] == true && c["role"] != "patient_cf" && !professional(c));
    let result = |status: &str, blocking: bool, ids: Vec<Value>, message: &str| json!({"status":status,"blocking":blocking,"confirmationRequired":true,"documentPatientCodes":codes,"candidatePatientIds":ids,"message":message});
    if codes.len() > 1 {
        return result(
            "mixed",
            true,
            vec![],
            "I documenti contengono più codici fiscali distinti, inclusi quelli di attribuzione incerta. Controlla a chi si riferiscono ed escludi le fonti discordanti prima di procedere.",
        );
    }
    let holders = || {
        patients
            .iter()
            .filter(|p| {
                codes
                    .first()
                    .is_some_and(|c| string(&p["taxCode"]).trim().to_uppercase() == *c)
            })
            .map(|p| p["id"].clone())
            .collect::<Vec<_>>()
    };
    if let Some(patient) = linked.and_then(|id| patients.iter().find(|p| p["id"] == id)) {
        if let Some(code) = codes.first() {
            if string(&patient["taxCode"]).trim().to_uppercase() != *code {
                return result(
                    "discordant",
                    true,
                    holders(),
                    "Il codice fiscale nei documenti non corrisponde alla scheda scelta. Nessuna fonte verrà salvata su questa scheda.",
                );
            }
            return result(
                "matched",
                false,
                vec![patient["id"].clone()],
                if unattributed {
                    "Il codice fiscale letto coincide con la scheda scelta, ma la sua attribuzione nel documento è incerta. Verifica a chi si riferisce prima di confermare."
                } else {
                    "Il codice fiscale nei documenti coincide con la scheda scelta. Conferma comunque il collegamento."
                },
            );
        }
        let mut wanted = name_words(string(&patient["lastName"]));
        wanted.extend(name_words(string(&patient["firstName"])));
        let foreign = documents.iter().any(|d| {
            !array(&d["patientNames"]).is_empty()
                && !array(&d["patientNames"]).iter().any(|name| {
                    !wanted.is_empty()
                        && wanted
                            .iter()
                            .all(|w| array(name).iter().any(|n| string(n) == w))
                })
        });
        if !string(&patient["lastName"]).is_empty()
            && !string(&patient["firstName"]).is_empty()
            && foreign
        {
            return result(
                "discordant_name",
                true,
                vec![],
                "Il paziente nominato nei documenti non corrisponde alla scheda scelta e manca il codice fiscale. Nessuna fonte verrà salvata su questa scheda.",
            );
        }
        return result(
            "no_document_cf",
            false,
            vec![patient["id"].clone()],
            "Nessun codice fiscale paziente leggibile: verifica i documenti e conferma il collegamento.",
        );
    }
    if codes.is_empty() {
        return result(
            "no_document_cf",
            false,
            vec![],
            "Nessun codice fiscale paziente leggibile: scegli la scheda dopo aver controllato i documenti.",
        );
    }
    let owners = holders();
    match owners.len() {
        0 => result(
            "unmatched_cf",
            false,
            owners,
            "Nessuna scheda con questo codice fiscale: crea una nuova scheda o scegline una esistente.",
        ),
        1 => result(
            "suggested",
            false,
            owners,
            "Una scheda ha lo stesso codice fiscale. Il codice non prova l’identità: conferma il collegamento.",
        ),
        _ => result(
            "ambiguous_cf",
            false,
            owners,
            "Più schede hanno lo stesso codice fiscale: scegli quella corretta.",
        ),
    }
}
pub fn patient_key(patient: &Value, text: Option<&str>) -> Value {
    let Some(text) = text.filter(|t| !t.is_empty() && !patient.is_null()) else {
        return Value::Null;
    };
    let cf = string(&patient["taxCode"]);
    if crate::patient_identity::validate_identifier("cf", cf).is_ok()
        && re(&format!(
            r"(?:^|[^A-Z0-9]){}(?:[^A-Z0-9]|$)",
            regex::escape(cf)
        ))
        .is_match(&text.to_uppercase())
    {
        return json!(format!("cf:{cf}"));
    }
    let first = string(&patient["firstName"]);
    let last = string(&patient["lastName"]);
    let written = words(text);
    if !first.is_empty()
        && !last.is_empty()
        && contiguous(&written, &words(first), 0).is_some()
        && contiguous(&written, &words(last), 0).is_some()
    {
        return json!(format!(
            "nome:{}|{}|{}",
            re(r"\s+").replace_all(&last.to_lowercase(), " ").trim(),
            re(r"\s+").replace_all(&first.to_lowercase(), " ").trim(),
            string(&patient["birthDate"])
        ));
    }
    Value::Null
}
const DATE_FIELDS: &[&str] = &["date", "startDate", "endDate", "observedAt", "prescribedAt"];
fn required(kind: &str) -> &'static [&'static str] {
    match kind {
        "diagnosis" => &["description", "date"],
        "exemption" => &["code"],
        "therapy" => &["drugName", "dosage", "status", "startDate"],
        "observation" => &["display", "value", "code", "unitCode", "observedAt"],
        "service_prescription" => &["serviceName", "category", "prescribedAt"],
        "prosthetic" => &["description", "category", "status", "prescribedAt"],
        "reported_scale" => &["scaleName", "scaleTotal", "date"],
        _ => &["text", "date"],
    }
}
pub fn blockers(fact: &Value, exemptions: Option<&[Value]>) -> Value {
    let mut out = vec![];
    let kind = string(&fact["kind"]);
    let v = &fact["values"];
    if fact["negated"] == true {
        out.push("Il testo nega questa informazione: correggi il fatto o rifiutalo.".to_owned());
    }
    for field in required(kind) {
        if *field == "text" && v["textSource"] == "document" {
            continue;
        }
        if string(&v[*field]).trim().is_empty() {
            out.push(if DATE_FIELDS.contains(field) {
                "Data mancante nel documento: inseriscila solo se nota.".to_owned()
            } else {
                format!("Campo obbligatorio mancante: {field}.")
            });
        }
    }
    for field in DATE_FIELDS {
        let value = string(&v[*field]).trim();
        if !value.is_empty()
            && (date(value).is_none() || !("1900-01-01"..="2100-12-31").contains(&value))
        {
            out.push(format!("Data non valida: {field}."));
        }
    }
    if kind == "diagnosis"
        && !string(&v["code"]).is_empty()
        && !["ICD-9", "ICD-10", "ICD-11"].contains(&string(&v["system"]))
    {
        out.push("Un codice di diagnosi richiede il sistema di codifica.".into());
    }
    if kind == "exemption"
        && exemptions.is_some_and(|codes| {
            !codes
                .iter()
                .any(|c| string(c) == string(&v["code"]).to_uppercase())
        })
    {
        out.push("Codice di esenzione assente dal catalogo locale.".into());
    }
    if kind == "therapy" && !["active", "suspended", "completed"].contains(&string(&v["status"])) {
        out.push("Stato della terapia non valido.".into());
    }
    if kind == "reported_scale"
        && !re(r"^-?\d+(?:[.,]\d+)?$").is_match(string(&v["scaleTotal"]).trim())
    {
        out.push("Il totale della scala deve essere un numero trascritto dal documento.".into());
    }
    let mut unique = vec![];
    for item in out {
        if !unique.contains(&item) {
            unique.push(item);
        }
    }
    json!(unique)
}
pub fn eligible(fact: &Value, exemptions: &[Value], summaries: bool) -> bool {
    if fact["negated"] == true || !array(&blockers(fact, Some(exemptions))).is_empty() {
        return false;
    }
    if fact["origin"] == "prepared" {
        if fact["values"]["preparedCheck"] == "summary" {
            return summaries;
        }
        return !fact["evidence"].is_null()
            && ["verified", "approximate"].contains(&string(&fact["values"]["preparedCheck"]));
    }
    ["parser:lab", "parser:icd", "parser:exemption"].contains(&string(&fact["origin"]))
        && ["diagnosis", "exemption", "observation"].contains(&string(&fact["kind"]))
        && !fact["evidence"].is_null()
}
fn fields(kind: &str) -> Vec<&'static str> {
    let mut fields = match kind {
        "diagnosis" => vec!["description", "code", "system", "date"],
        "exemption" => vec!["code"],
        "therapy" => vec![
            "drugName",
            "activePrinciple",
            "dosage",
            "status",
            "startDate",
            "endDate",
            "aic",
            "atc",
        ],
        "observation" => vec![
            "display",
            "value",
            "unit",
            "code",
            "unitCode",
            "refText",
            "refLow",
            "refHigh",
            "observedAt",
        ],
        "service_prescription" => vec![
            "serviceName",
            "items",
            "category",
            "priority",
            "prescribedAt",
            "requestReference",
            "clinicalQuestion",
        ],
        "prosthetic" => vec![
            "description",
            "isoCode",
            "category",
            "status",
            "prescribedAt",
        ],
        "reported_scale" => vec!["scaleName", "scaleTotal", "scaleMax", "date", "text"],
        "invalidity" => vec!["title", "date", "text", "percentage", "allowance"],
        _ => vec!["title", "date", "text"],
    };
    fields.extend(["subject", "temporality", "certainty"]);
    fields
}
fn trimmed(value: &Value, max: usize) -> String {
    slice(string(value).trim(), 0, max)
}
pub fn parse_prepared(text: &str) -> Value {
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return json!({"ok":false,"error":"Il file non è JSON valido."});
    };
    if !parsed.is_object()
        || parsed["schema"] != "mediflow.dossier_prepared_extraction.v1"
        || !parsed["sources"].is_array()
    {
        return json!({"ok":false,"error":"Il file non è un’estrazione preparata (mediflow.dossier_prepared_extraction.v1)."});
    }
    let mut warnings = vec![];
    let mut sources = vec![];
    let mut seen = BTreeSet::new();
    for (index, raw) in array(&parsed["sources"]).iter().enumerate() {
        let n = index + 1;
        if !raw.is_object() {
            warnings.push(format!("Fonte {n}: formato non valido, ignorata."));
            continue;
        }
        let sha = trimmed(&raw["sha256"], 20000).to_lowercase();
        if !re(r"^[a-f0-9]{64}$").is_match(&sha) {
            warnings.push(format!(
                "Fonte {n}: sha256 mancante o non valido, ignorata."
            ));
            continue;
        }
        if !seen.insert(sha.clone()) {
            warnings.push(format!("Fonte {n}: sha256 ripetuto, ignorata."));
            continue;
        }
        let mut patient = Value::Null;
        if raw["patient"].is_object() {
            patient = json!({});
            for (field, max) in [
                ("taxCode", 16),
                ("lastName", 120),
                ("firstName", 120),
                ("birthDate", 10),
            ] {
                let mut v = trimmed(&raw["patient"][field], max);
                if field == "taxCode" {
                    v = v.to_uppercase();
                }
                if !v.is_empty() && (field != "birthDate" || date(&v).is_some()) {
                    patient[field] = json!(v);
                }
            }
        }
        let doc = trimmed(&raw["documentDate"], 10);
        let doc = date(&doc).map(|_| doc);
        let mut summary = Value::Null;
        if raw["summary"].is_object() {
            let txt = trimmed(&raw["summary"]["text"], 20000);
            if !txt.is_empty() {
                let title = trimmed(&raw["summary"]["title"], 200);
                let d = trimmed(&raw["summary"]["date"], 10);
                summary = json!({"title":if title.is_empty(){"Sintesi del documento"}else{&title},"text":txt,"date":if date(&d).is_some(){d}else{doc.clone().unwrap_or_default()}});
            }
        }
        let mut facts = vec![];
        for (i, item) in array(&raw["facts"]).iter().enumerate() {
            let kind = string(&item["kind"]);
            if !item.is_object()
                || ![
                    "diagnosis",
                    "exemption",
                    "therapy",
                    "observation",
                    "service_prescription",
                    "prosthetic",
                    "reported_scale",
                    "invalidity",
                    "anamnesis",
                    "assessment",
                    "imaging_report",
                    "care_context",
                    "document_entry",
                ]
                .contains(&kind)
                || !item["values"].is_object()
            {
                warnings.push(format!(
                    "Fonte {n}, fatto {}: tipo o valori non validi, ignorato.",
                    i + 1
                ));
                continue;
            }
            let mut values = json!({});
            for field in fields(kind) {
                let v = trimmed(&item["values"][field], 20000);
                if !v.is_empty() {
                    values[field] = json!(v);
                }
            }
            let mut fact = json!({"kind":kind,"values":values});
            let quote = trimmed(&item["quote"], 600);
            if !quote.is_empty() {
                fact["quote"] = json!(quote);
            }
            facts.push(fact);
        }
        let coverage = &raw["coverage"];
        let pages = coverage["pages"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= crate::MAX_SAFE_VERSION);
        let unreadable: Vec<_> = array(&coverage["unreadablePages"])
            .iter()
            .filter(|p| {
                p.as_u64()
                    .is_some_and(|n| n > 0 && n <= crate::MAX_SAFE_VERSION)
            })
            .cloned()
            .collect();
        sources.push(json!({"sha256":sha,"fileName":trimmed(&raw["fileName"],400),"patient":patient,"documentDate":doc,"documentType":trimmed(&raw["documentType"],80),"summary":summary,"facts":facts,"coverage":{"pages":pages,"complete":coverage["complete"]==true&&unreadable.is_empty(),"unreadablePages":unreadable,"note":trimmed(&coverage["note"],2000)}}));
    }
    json!({"ok":true,"value":{"schema":"mediflow.dossier_prepared_extraction.v1","preparedAt":trimmed(&parsed["preparedAt"],40),"preparedBy":trimmed(&parsed["preparedBy"],120),"sources":sources},"warnings":warnings})
}
fn supersedable(f: &Value) -> bool {
    ["parser:section", "parser:scale"].contains(&string(&f["origin"]))
}
fn summary(f: &Value) -> bool {
    f["origin"] == "prepared" && f["values"]["preparedCheck"] == "summary"
}
fn written(record: &Value, f: &Value) -> bool {
    array(&record["applied"])
        .iter()
        .rev()
        .find(|a| a["factId"] == f["factId"])
        .is_some_and(|a| ["applied", "already_present"].contains(&string(&a["outcome"])))
}
fn same_subject(a: &Value, b: &Value) -> bool {
    let field = match string(&a["kind"]) {
        "therapy" => "drugName",
        "diagnosis" | "prosthetic" => "description",
        "observation" => "display",
        "service_prescription" => "serviceName",
        "reported_scale" => "scaleName",
        _ => return false,
    };
    let a: Vec<_> = words(string(&a["values"][field]))
        .into_iter()
        .filter(|w| utf16_len(w) >= 4)
        .collect();
    let b: Vec<_> = words(string(&b["values"][field]))
        .into_iter()
        .filter(|w| utf16_len(w) >= 4)
        .collect();
    !a.is_empty()
        && !b.is_empty()
        && (a.iter().all(|w| b.contains(w)) || b.iter().all(|w| a.contains(w)))
}
pub fn bulk(input: &Value) -> Value {
    let record = &input["record"];
    let key = string(&input["documentKey"]);
    let mut facts = array(&record["facts"]).to_vec();
    let mut accepted = vec![];
    let mut counts = json!({"accepted":0,"alreadyPresent":0,"superseded":0,"leftPending":0});
    let inc = |counts: &mut Value, key: &str| {
        counts[key] = json!(counts[key].as_u64().unwrap() + 1);
    };
    if !facts.iter().any(|f| f["origin"] == "prepared") {
        counts["leftPending"] = json!(facts.iter().filter(|f| f["decision"] == "pending").count());
        return json!({"facts":facts,"acknowledgeResidual":false,"accepted":accepted,"counts":counts});
    }
    let mut accepted_now: BTreeSet<_> = array(&input["acceptedElsewhere"])
        .iter()
        .map(|v| string(v).to_owned())
        .collect();
    let supersedable_here: BTreeSet<_> = facts
        .iter()
        .filter(|f| supersedable(f) && f["decision"] == "pending")
        .map(|f| format!("{key}#{}", string(&f["factId"])))
        .collect();
    for fact in &mut facts {
        if fact["decision"] != "pending"
            || supersedable(fact)
            || fact["origin"] == "parser:document"
        {
            continue;
        }
        let reference = format!("{key}#{}", string(&fact["factId"]));
        let mut assessment = input["assessments"][&reference].clone();
        if fact["origin"] == "prepared" && assessment["status"] == "duplicate_in_dossier" {
            let others: Vec<_> = array(&assessment["relatedFactRefs"])
                .iter()
                .filter(|v| !supersedable_here.contains(string(v)))
                .cloned()
                .collect();
            assessment["relatedFactRefs"] = json!(others);
            if others.is_empty() {
                assessment["status"] = json!("new");
            }
        }
        if assessment["status"] == "already_present" {
            inc(&mut counts, "alreadyPresent");
            fact["decision"] = json!("already_present");
            continue;
        }
        let related = array(&assessment["relatedFactRefs"]);
        if assessment["status"] == "duplicate_in_dossier"
            && !related.is_empty()
            && related.iter().all(|v| accepted_now.contains(string(v)))
        {
            inc(&mut counts, "alreadyPresent");
            fact["decision"] = json!("already_present");
            fact["note"] = json!("Stesso contenuto di un’altra fonte accettata.");
            continue;
        }
        if (assessment.is_null() || assessment["status"] == "new")
            && eligible(
                fact,
                array(&input["exemptionCodes"]),
                input["includeSummaries"] == true,
            )
        {
            inc(&mut counts, "accepted");
            accepted.push(reference.clone());
            accepted_now.insert(reference);
            fact["decision"] = json!("accepted");
        }
    }
    let summary_written = facts
        .iter()
        .any(|f| summary(f) && f["decision"] == "accepted" && written(record, f));
    let accepted_prepared: Vec<_> = facts
        .iter()
        .filter(|f| f["origin"] == "prepared" && f["decision"] == "accepted" && !summary(f))
        .cloned()
        .collect();
    for fact in &mut facts {
        if fact["decision"] != "pending" {
            continue;
        }
        if (fact["origin"] == "parser:document" && summary_written)
            || (supersedable(fact)
                && accepted_prepared
                    .iter()
                    .any(|o| o["kind"] == fact["kind"] && same_subject(o, fact)))
        {
            inc(&mut counts, "superseded");
            fact["decision"] = json!("rejected");
            fact["note"] = json!(if fact["origin"] == "parser:document" {
                "Sostituita dalla sintesi accettata; il testo completo resta nell’allegato."
            } else {
                "Sostituita dall’estrazione preparata verificata dello stesso tipo."
            });
        } else {
            inc(&mut counts, "leftPending");
        }
    }
    let pages = if record["extraction"]["state"] == "extracted"
        && record["extraction"]["unitBasis"] == "pages"
    {
        Some(array(&record["extraction"]["units"]).len().to_string())
    } else {
        None
    };
    let acknowledged = facts.iter().find(|f| summary(f)).is_some_and(|f| {
        f["decision"] == "accepted"
            && written(record, f)
            && f["values"]["preparedCoverage"] == "complete"
            && pages.is_none_or(|p| f["values"]["preparedPages"] == p)
    });
    json!({"facts":facts,"acknowledgeResidual":acknowledged,"accepted":accepted,"counts":counts})
}
/// Entry point usato dalla conformità; nessun campo del risultato viene escluso.
pub fn verify_call(call: &Value) -> Value {
    let a = array(&call["args"]);
    match string(&call["op"]) {
        "catalog" => catalog(string(&a[0]), string(&a[1])),
        "preparedTokens" => json!(tokens(string(&a[0]))),
        "anchorPreparedQuote" => anchor(string(&a[0]), array(&a[1]), string(&a[2])),
        "verifyPreparedFields" => verify_fields(
            string(&a[0]),
            &a[1],
            &array(&a[2])
                .iter()
                .map(|v| string(v).to_owned())
                .collect::<Vec<_>>(),
        ),
        "preparedDossierFacts" => prepared_facts(&a[0]),
        "evaluateDossierGroupIdentity" => {
            identity(array(&a[0]), array(&a[1]), a.get(2).and_then(Value::as_str))
        }
        "collectDossierPatientNames" => patient_names(string(&a[0])),
        "preparedPatientKey" => patient_key(&a[0], a[1].as_str()),
        "parsePreparedExtraction" => parse_prepared(string(&a[0])),
        "preparedBulkDecisions" => bulk(&a[0]),
        "preparedFactEligible" => json!(eligible(
            &a[0],
            array(&a[1]),
            a.get(2) == Some(&Value::Bool(true))
        )),
        "dossierFactBlockers" => blockers(
            &a[0],
            a.get(1)
                .and_then(|c| c["exemptionCodes"].as_array())
                .map(Vec::as_slice),
        ),
        _ => panic!("unknown conformance call"),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn canonical(value: &Value) -> String {
        match value {
            Value::Array(items) => format!(
                "[{}]",
                items.iter().map(canonical).collect::<Vec<_>>().join(",")
            ),
            Value::Object(fields) => {
                let mut keys: Vec<_> = fields.keys().collect();
                keys.sort();
                format!(
                    "{{{}}}",
                    keys.into_iter()
                        .map(|key| format!(
                            "{}:{}",
                            serde_json::to_string(key).unwrap(),
                            canonical(&fields[key])
                        ))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            }
            _ => value.to_string(),
        }
    }
    #[test]
    fn all_ten_falsifications_are_blocked_by_both_verifier_layers() {
        let calls: Vec<Value> = serde_json::from_str(include_str!(
            "../../../../native/contracts/dossier-conformance/banco-cases.json"
        ))
        .unwrap();
        let index: Vec<Value> = serde_json::from_str(include_str!(
            "../../../../native/contracts/dossier-conformance/banco-index.json"
        ))
        .unwrap();
        let mutations: Vec<_> = index.iter().filter(|row| row["mutation"] == true).collect();
        assert_eq!(mutations.len(), 10);
        for mutation in mutations {
            let identity = verify_call(&calls[mutation["identity"].as_u64().unwrap() as usize]);
            let eligible = array(&mutation["eligible"]);
            assert!(!eligible.is_empty(), "non-vacuous: {}", mutation["name"]);
            assert!(
                identity["blocking"] == true
                    || eligible
                        .iter()
                        .all(|i| verify_call(&calls[i.as_u64().unwrap() as usize]) == false),
                "{}",
                mutation["name"]
            );
        }
    }
    #[test]
    fn web_conformance_entire_canonical_json() {
        let cases: Value = json!(
            [
                include_str!("../../../../native/contracts/dossier-conformance/ts-cases.json"),
                include_str!("../../../../native/contracts/dossier-conformance/banco-cases.json"),
                include_str!("../../../../native/contracts/dossier-conformance/catalog-cases.json")
            ]
            .iter()
            .flat_map(|s| serde_json::from_str::<Vec<Value>>(s).unwrap())
            .collect::<Vec<_>>()
        );
        let expected: Value = serde_json::from_str(include_str!(
            "../../../../native/contracts/dossier-conformance/expected.json"
        ))
        .unwrap();
        let mut failures = vec![];
        for (index, call) in array(&cases).iter().enumerate() {
            let actual = verify_call(call);
            if canonical(&actual) != canonical(&expected[index]) {
                failures.push(format!(
                    "case {index} {}: actual {actual}\nexpected {}",
                    call["op"], expected[index]
                ));
                if failures.len() >= 8 {
                    break;
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}
