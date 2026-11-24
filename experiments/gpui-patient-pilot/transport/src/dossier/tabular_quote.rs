use super::{Token, long_enough, re, slice, tokens, unit_text, utf16_len, words};
use regex::Regex;
use serde_json::{Value, json};
use std::{collections::HashMap, sync::LazyLock};

const MAX_ROW_CELLS: usize = 24;
const MAX_QUOTE_LINES: usize = 16;
const MAX_SEARCH_STEPS: usize = 2000;

static TABLE_SEPARATOR_ROW: LazyLock<Regex> = LazyLock::new(|| re(r"^\|(?:\s*:?-{3,}:?\s*\|)+$"));
static COLUMN_GAP: LazyLock<Regex> = LazyLock::new(|| re(r"[ \t]*\|[ \t]*|\t|[ ]{2,}"));
static WHITESPACE: LazyLock<Regex> = LazyLock::new(|| re(r"\s+"));

type TableRow = Vec<Vec<Token>>;

#[derive(Clone, Copy)]
struct CellCursor {
    start: usize,
    pos: usize,
}

struct QuoteLine<'a> {
    raw: &'a str,
    words: Vec<String>,
}

struct UnitRows<'a> {
    body: String,
    unit_index: &'a Value,
    rows: Vec<TableRow>,
}

fn split_row_cells(body: &str, line_start: usize, line_end: usize) -> TableRow {
    let line = &body[line_start..line_end];
    let Some(open_rel) = line.find('|') else {
        return vec![];
    };
    let Some(close_rel) = line.rfind('|') else {
        return vec![];
    };
    if close_rel <= open_rel {
        return vec![];
    }
    let open = line_start + open_rel;
    let close = line_start + close_rel;
    let mut cells = vec![];
    let mut seg_start = open + 1;
    let mut backslashes = 0usize;
    for (rel, ch) in body[open + 1..close].char_indices() {
        let abs = open + 1 + rel;
        if ch == '\\' {
            backslashes += 1;
            continue;
        }
        let is_pipe = ch == '|' && backslashes.is_multiple_of(2);
        backslashes = 0;
        if !is_pipe {
            continue;
        }
        let base_utf16 = utf16_len(&body[..seg_start]);
        let cell_tokens: Vec<Token> = tokens(&body[seg_start..abs])
            .into_iter()
            .map(|mut tok| {
                tok.start += base_utf16;
                tok.end += base_utf16;
                tok
            })
            .collect();
        if !cell_tokens.is_empty() {
            cells.push(cell_tokens);
        }
        seg_start = abs + 1;
    }
    let base_utf16 = utf16_len(&body[..seg_start]);
    let last_tokens: Vec<Token> = tokens(&body[seg_start..close])
        .into_iter()
        .map(|mut tok| {
            tok.start += base_utf16;
            tok.end += base_utf16;
            tok
        })
        .collect();
    if !last_tokens.is_empty() {
        cells.push(last_tokens);
    }
    cells
}

fn extract_markdown_table_rows(body: &str) -> Vec<TableRow> {
    let mut lines = vec![];
    let mut pos = 0usize;
    loop {
        let nl = body[pos..].find('\n').map(|offset| pos + offset);
        let raw_end = nl.unwrap_or(body.len());
        let end = if raw_end > pos && body.as_bytes()[raw_end - 1] == b'\r' {
            raw_end - 1
        } else {
            raw_end
        };
        let trimmed = body[pos..end].trim_matches(crate::js_whitespace);
        lines.push((pos, end, trimmed));
        match nl {
            Some(next) => pos = next + 1,
            None => break,
        }
    }
    let is_pipe =
        |trimmed: &str| trimmed.len() >= 3 && trimmed.starts_with('|') && trimmed.ends_with('|');
    let mut rows = vec![];
    let mut i = 0usize;
    while i < lines.len() {
        if !is_pipe(lines[i].2) {
            i += 1;
            continue;
        }
        let mut j = i;
        let mut has_separator = false;
        while j < lines.len() && is_pipe(lines[j].2) {
            if TABLE_SEPARATOR_ROW.is_match(lines[j].2) {
                has_separator = true;
            }
            j += 1;
        }
        if has_separator {
            for &(start, end, trimmed) in &lines[i..j] {
                if TABLE_SEPARATOR_ROW.is_match(trimmed) {
                    continue;
                }
                let cells = split_row_cells(body, start, end);
                if cells.len() >= 2 && cells.len() <= MAX_ROW_CELLS {
                    rows.push(cells);
                }
            }
        }
        i = j;
    }
    rows
}

fn matches_at(cell: &[Token], start: usize, wanted: &[String]) -> bool {
    if start + wanted.len() > cell.len() {
        return false;
    }
    cell[start..start + wanted.len()]
        .iter()
        .zip(wanted)
        .all(|(tok, word)| tok.text == *word)
}

fn build_result(
    body: &str,
    unit_index: &Value,
    first: &Token,
    last: &Token,
    matched_words: Vec<String>,
) -> Value {
    let excerpt = WHITESPACE
        .replace_all(&slice(body, first.start, last.end), " ")
        .trim_matches(crate::js_whitespace)
        .to_owned();
    json!({
        "match": "exact",
        "words": matched_words,
        "evidence": {
            "unit": unit_index,
            "start": first.start,
            "end": last.end,
            "excerpt": excerpt,
        }
    })
}

struct InterleaveSearch<'a> {
    active_cells: &'a [Vec<&'a Token>],
    lines: &'a [QuoteLine<'a>],
    pos: Vec<usize>,
    steps: usize,
}

impl<'a> InterleaveSearch<'a> {
    fn dfs(&mut self, line_idx: usize, word_idx: usize, min_cell: usize) -> bool {
        if line_idx == self.lines.len() {
            return true;
        }
        if self.steps >= MAX_SEARCH_STEPS {
            return false;
        }
        self.steps += 1;
        let line = &self.lines[line_idx].words;
        if word_idx == line.len() {
            return self.dfs(line_idx + 1, 0, 0);
        }
        for c in min_cell..self.active_cells.len() {
            let cell = &self.active_cells[c];
            let start = self.pos[c];
            let mut max_len = 0usize;
            while start + max_len < cell.len()
                && word_idx + max_len < line.len()
                && cell[start + max_len].text == line[word_idx + max_len]
            {
                max_len += 1;
            }
            for len in (1..=max_len).rev() {
                self.pos[c] = start + len;
                if self.dfs(line_idx, word_idx + len, c + 1) {
                    return true;
                }
                self.pos[c] = start;
            }
        }
        false
    }
}

fn can_interleave_lines(active_cells: &[Vec<&Token>], lines: &[QuoteLine<'_>]) -> bool {
    let mut search = InterleaveSearch {
        active_cells,
        lines,
        pos: vec![0usize; active_cells.len()],
        steps: 0,
    };
    search.dfs(0, 0, 0)
}

struct TokenBalance<'a> {
    counts: HashMap<&'a str, isize>,
    nonzero: usize,
}

impl<'a> TokenBalance<'a> {
    fn new(wanted: &'a [String]) -> Self {
        let mut counts = HashMap::new();
        for word in wanted {
            let entry = counts.entry(word.as_str()).or_insert(0);
            let next = *entry + 1;
            counts.insert(word.as_str(), next);
        }
        let nonzero = counts.len();
        Self { counts, nonzero }
    }

    fn adjust(&mut self, word: &'a str, delta: isize) {
        let before = self.counts.get(word).copied().unwrap_or(0);
        let after = before + delta;
        if before == 0 && after != 0 {
            self.nonzero += 1;
        } else if before != 0 && after == 0 {
            self.nonzero -= 1;
        }
        if after == 0 {
            self.counts.remove(word);
        } else {
            self.counts.insert(word, after);
        }
    }
}

fn match_complete_row(
    body: &str,
    unit_index: &Value,
    cells: &[Vec<Token>],
    lines: &[QuoteLine<'_>],
    wanted: &[String],
) -> Option<Value> {
    let mut flat: Vec<(&Token, usize)> = vec![];
    for (cell_idx, cell) in cells.iter().enumerate() {
        for tok in cell {
            flat.push((tok, cell_idx));
        }
    }
    if flat.len() < wanted.len() {
        return None;
    }
    let mut balance = TokenBalance::new(wanted);
    for entry in &flat[..wanted.len()] {
        balance.adjust(entry.0.text.as_str(), -1);
    }
    for start in 0..=flat.len() - wanted.len() {
        if start > 0 {
            balance.adjust(flat[start - 1].0.text.as_str(), 1);
            balance.adjust(flat[start + wanted.len() - 1].0.text.as_str(), -1);
        }
        if balance.nonzero != 0 {
            continue;
        }
        let first_cell = flat[start].1;
        let last_cell = flat[start + wanted.len() - 1].1;
        if first_cell == last_cell {
            continue;
        }
        let mut active_cells: Vec<Vec<&Token>> = vec![];
        let mut current_cell: Option<usize> = None;
        for &(tok, cell_idx) in &flat[start..start + wanted.len()] {
            if current_cell != Some(cell_idx) {
                current_cell = Some(cell_idx);
                active_cells.push(vec![]);
            }
            active_cells.last_mut().unwrap().push(tok);
        }
        if !can_interleave_lines(&active_cells, lines) {
            continue;
        }
        let first = flat[start].0;
        let last = flat[start + wanted.len() - 1].0;
        let matched_words = flat[start..start + wanted.len()]
            .iter()
            .map(|(tok, _)| tok.text.clone())
            .collect();
        return Some(build_result(body, unit_index, first, last, matched_words));
    }
    None
}

struct VisualSearch<'a> {
    cells: &'a [Vec<Token>],
    segmented_lines: &'a [Vec<Vec<String>>],
    entered: Vec<Option<CellCursor>>,
    steps: usize,
}

impl<'a> VisualSearch<'a> {
    fn dfs(&mut self, line_idx: usize, seg_idx: usize, prev_cell: Option<usize>) -> bool {
        if line_idx == self.segmented_lines.len() {
            return self.entered.iter().filter(|slot| slot.is_some()).count() >= 2;
        }
        if self.steps >= MAX_SEARCH_STEPS {
            return false;
        }
        self.steps += 1;
        let segments = &self.segmented_lines[line_idx];
        if seg_idx == segments.len() {
            return self.dfs(line_idx + 1, 0, None);
        }
        let seg = &segments[seg_idx];
        if let Some(prev) = prev_cell {
            let slot = self.entered[prev].unwrap();
            if matches_at(&self.cells[prev], slot.pos, seg) {
                self.entered[prev] = Some(CellCursor {
                    start: slot.start,
                    pos: slot.pos + seg.len(),
                });
                if self.dfs(line_idx, seg_idx + 1, Some(prev)) {
                    return true;
                }
                self.entered[prev] = Some(slot);
            }
        }
        let start_cell = prev_cell.map_or(0, |prev| prev + 1);
        for c in start_cell..self.cells.len() {
            if let Some(existing) = self.entered[c] {
                if matches_at(&self.cells[c], existing.pos, seg) {
                    self.entered[c] = Some(CellCursor {
                        start: existing.start,
                        pos: existing.pos + seg.len(),
                    });
                    if self.dfs(line_idx, seg_idx + 1, Some(c)) {
                        return true;
                    }
                    self.entered[c] = Some(existing);
                }
                continue;
            }
            let cell = &self.cells[c];
            if seg.len() > cell.len() {
                continue;
            }
            for s in 0..=cell.len() - seg.len() {
                if !matches_at(cell, s, seg) {
                    continue;
                }
                self.entered[c] = Some(CellCursor {
                    start: s,
                    pos: s + seg.len(),
                });
                if self.dfs(line_idx, seg_idx + 1, Some(c)) {
                    return true;
                }
                self.entered[c] = None;
            }
        }
        false
    }
}

fn match_visual_lines_row(
    body: &str,
    unit_index: &Value,
    cells: &[Vec<Token>],
    segmented_lines: &[Vec<Vec<String>>],
) -> Option<Value> {
    let mut search = VisualSearch {
        cells,
        segmented_lines,
        entered: vec![None; cells.len()],
        steps: 0,
    };
    if !search.dfs(0, 0, None) {
        return None;
    }
    let first_cell = search.entered.iter().position(Option::is_some)?;
    let last_cell = search.entered.iter().rposition(Option::is_some)?;
    let first = &cells[first_cell][search.entered[first_cell]?.start];
    let last = &cells[last_cell][search.entered[last_cell]?.pos - 1];
    let span_words = words(&slice(body, first.start, last.end));
    Some(build_result(body, unit_index, first, last, span_words))
}

pub(super) fn anchor_tabular(text: &str, units: &[Value], quote: &str) -> Option<Value> {
    if !long_enough(quote) {
        return None;
    }
    let lines: Vec<QuoteLine<'_>> = quote
        .split('\n')
        .map(|raw| raw.strip_suffix('\r').unwrap_or(raw))
        .filter_map(|raw| {
            let line_words = words(raw);
            (!line_words.is_empty()).then_some(QuoteLine {
                raw,
                words: line_words,
            })
        })
        .collect();
    if lines.is_empty() || lines.len() > MAX_QUOTE_LINES {
        return None;
    }
    let wanted: Vec<String> = lines
        .iter()
        .flat_map(|line| line.words.iter().cloned())
        .collect();
    let unit_rows: Vec<UnitRows<'_>> = units
        .iter()
        .map(|unit| {
            let body = unit_text(text, unit);
            let rows = extract_markdown_table_rows(&body);
            UnitRows {
                body,
                unit_index: &unit["index"],
                rows,
            }
        })
        .collect();
    for entry in &unit_rows {
        for cells in &entry.rows {
            if let Some(matched) =
                match_complete_row(&entry.body, entry.unit_index, cells, &lines, &wanted)
            {
                return Some(matched);
            }
        }
    }
    let segmented_lines: Vec<Vec<Vec<String>>> = lines
        .iter()
        .map(|line| {
            COLUMN_GAP
                .split(line.raw)
                .map(words)
                .filter(|part| !part.is_empty())
                .collect()
        })
        .collect();
    if !segmented_lines.iter().any(|segments| segments.len() >= 2) {
        return None;
    }
    for entry in &unit_rows {
        for cells in &entry.rows {
            if let Some(matched) =
                match_visual_lines_row(&entry.body, entry.unit_index, cells, &segmented_lines)
            {
                return Some(matched);
            }
        }
    }
    None
}
