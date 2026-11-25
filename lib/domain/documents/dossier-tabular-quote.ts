import { clinicalTokens } from './clinical-context-lexicon';
import { unitText, type DossierEvidence, type DossierUnit } from './dossier-import';

type Token = ReturnType<typeof clinicalTokens>[number];

export interface TabularQuoteMatch {
    evidence: DossierEvidence;
    match: 'exact';
    words: string[];
    complete: boolean;
}

interface QuoteLine {
    raw: string;
    words: string[];
}

interface CellCursor {
    start: number;
    pos: number;
}

const MIN_QUOTE_WORDS = 3;
const MIN_QUOTE_CHARS = 12;
const MAX_ROW_CELLS = 24;
const MAX_QUOTE_LINES = 16;
const MAX_SEARCH_STEPS = 2000;
const TABLE_SEPARATOR_ROW = /^\|(?:\s*:?-{3,}:?\s*\|)+$/u;
const COLUMN_GAP = /[ \t]*\|[ \t]*|\t|[ ]{2,}/u;

function quoteHasMinimumLength(quote: string, tokenCount: number): boolean {
    return tokenCount >= MIN_QUOTE_WORDS && quote.replace(/[^\p{L}\p{N}]/gu, '').length >= MIN_QUOTE_CHARS;
}

function splitRowCells(body: string, lineStart: number, lineEnd: number): Token[][] {
    const open = body.indexOf('|', lineStart);
    const close = body.lastIndexOf('|', lineEnd - 1);
    if (open < lineStart || close <= open) return [];
    const cells: Token[][] = [];
    let segStart = open + 1;
    let backslashes = 0;
    for (let i = open + 1; i <= close; i += 1) {
        const ch = body[i];
        if (ch === '\\') {
            backslashes += 1;
            continue;
        }
        const isUnescapedPipe = i === close || (ch === '|' && backslashes % 2 === 0);
        backslashes = 0;
        if (!isUnescapedPipe) continue;
        const tokens = clinicalTokens(body.slice(segStart, i)).map((token) => ({
            ...token,
            start: token.start + segStart,
            end: token.end + segStart,
        }));
        if (tokens.length > 0) cells.push(tokens);
        segStart = i + 1;
    }
    return cells;
}

export function extractMarkdownTableRows(body: string): Token[][][] {
    const lines: Array<{ start: number; end: number; trimmed: string }> = [];
    let pos = 0;
    while (pos <= body.length) {
        const nl = body.indexOf('\n', pos);
        const rawEnd = nl < 0 ? body.length : nl;
        const end = rawEnd > pos && body[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
        lines.push({ start: pos, end, trimmed: body.slice(pos, end).trim() });
        if (nl < 0) break;
        pos = nl + 1;
    }
    const rows: Token[][][] = [];
    let i = 0;
    while (i < lines.length) {
        const isPipe = (trimmed: string) => trimmed.length >= 3 && trimmed.startsWith('|') && trimmed.endsWith('|');
        if (!isPipe(lines[i].trimmed)) {
            i += 1;
            continue;
        }
        let j = i;
        let hasSeparator = false;
        while (j < lines.length && isPipe(lines[j].trimmed)) {
            if (TABLE_SEPARATOR_ROW.test(lines[j].trimmed)) hasSeparator = true;
            j += 1;
        }
        if (hasSeparator) {
            for (let k = i; k < j; k += 1) {
                if (TABLE_SEPARATOR_ROW.test(lines[k].trimmed)) continue;
                const cells = splitRowCells(body, lines[k].start, lines[k].end);
                if (cells.length >= 2 && cells.length <= MAX_ROW_CELLS) rows.push(cells);
            }
        }
        i = j;
    }
    return rows;
}

function matchesAt(cell: readonly Token[], start: number, wanted: readonly string[]): boolean {
    if (start + wanted.length > cell.length) return false;
    for (let k = 0; k < wanted.length; k += 1) {
        if (cell[start + k].text !== wanted[k]) return false;
    }
    return true;
}

function buildResult(
    body: string,
    unitIndex: number,
    first: Token,
    last: Token,
    words: string[],
    complete: boolean,
): TabularQuoteMatch {
    return {
        match: 'exact',
        complete,
        words,
        evidence: {
            unit: unitIndex,
            start: first.start,
            end: last.end,
            excerpt: body.slice(first.start, last.end).replace(/\s+/gu, ' ').trim(),
        },
    };
}

function canInterleaveLines(activeCells: readonly (readonly Token[])[], lines: readonly QuoteLine[]): boolean {
    const pos = new Array<number>(activeCells.length).fill(0);
    let steps = 0;
    const dfs = (lineIdx: number, wordIdx: number, minCell: number): boolean => {
        if (lineIdx === lines.length) return true;
        if (steps >= MAX_SEARCH_STEPS) return false;
        steps += 1;
        const line = lines[lineIdx].words;
        if (wordIdx === line.length) return dfs(lineIdx + 1, 0, 0);
        for (let c = minCell; c < activeCells.length; c += 1) {
            const cell = activeCells[c];
            const start = pos[c];
            let maxLen = 0;
            while (
                start + maxLen < cell.length
                && wordIdx + maxLen < line.length
                && cell[start + maxLen].text === line[wordIdx + maxLen]
            ) {
                maxLen += 1;
            }
            for (let len = maxLen; len >= 1; len -= 1) {
                pos[c] = start + len;
                if (dfs(lineIdx, wordIdx + len, c + 1)) return true;
                pos[c] = start;
            }
        }
        return false;
    };
    return dfs(0, 0, 0);
}

function matchCompleteRow(
    body: string,
    unitIndex: number,
    cells: readonly (readonly Token[])[],
    lines: readonly QuoteLine[],
    wanted: readonly string[],
): TabularQuoteMatch | null {
    const flat: Array<{ token: Token; cell: number }> = [];
    cells.forEach((cell, cellIdx) => {
        for (const token of cell) flat.push({ token, cell: cellIdx });
    });
    if (flat.length < wanted.length) return null;
    const balance = new Map<string, number>();
    for (const word of wanted) balance.set(word, (balance.get(word) ?? 0) + 1);
    let nonzero = balance.size;
    const adjust = (word: string, delta: number) => {
        const before = balance.get(word) ?? 0;
        const after = before + delta;
        if (before === 0 && after !== 0) nonzero += 1;
        else if (before !== 0 && after === 0) nonzero -= 1;
        if (after === 0) balance.delete(word);
        else balance.set(word, after);
    };
    for (let i = 0; i < wanted.length; i += 1) adjust(flat[i].token.text, -1);
    for (let start = 0; start + wanted.length <= flat.length; start += 1) {
        if (start > 0) {
            adjust(flat[start - 1].token.text, 1);
            adjust(flat[start + wanted.length - 1].token.text, -1);
        }
        if (nonzero !== 0) continue;
        const firstCell = flat[start].cell;
        const lastCell = flat[start + wanted.length - 1].cell;
        if (firstCell === lastCell) continue;
        const activeCells: Token[][] = [];
        let currentCell = -1;
        for (let k = start; k < start + wanted.length; k += 1) {
            if (flat[k].cell !== currentCell) {
                currentCell = flat[k].cell;
                activeCells.push([]);
            }
            activeCells[activeCells.length - 1].push(flat[k].token);
        }
        if (!canInterleaveLines(activeCells, lines)) continue;
        const first = flat[start].token;
        const last = flat[start + wanted.length - 1].token;
        const words = flat.slice(start, start + wanted.length).map((entry) => entry.token.text);
        return buildResult(body, unitIndex, first, last, words, true);
    }
    return null;
}

function matchVisualLinesRow(
    body: string,
    unitIndex: number,
    cells: readonly (readonly Token[])[],
    segmentedLines: readonly (readonly (readonly string[])[])[],
    wantedCount: number,
): TabularQuoteMatch | null {
    const entered: Array<CellCursor | null> = new Array(cells.length).fill(null);
    let steps = 0;
    const dfs = (lineIdx: number, segIdx: number, prevCell: number): boolean => {
        if (lineIdx === segmentedLines.length) {
            let touched = 0;
            for (const slot of entered) if (slot !== null) touched += 1;
            return touched >= 2;
        }
        if (steps >= MAX_SEARCH_STEPS) return false;
        steps += 1;
        const segments = segmentedLines[lineIdx];
        if (segIdx === segments.length) return dfs(lineIdx + 1, 0, -1);
        const seg = segments[segIdx];
        if (prevCell >= 0) {
            const slot = entered[prevCell]!;
            if (matchesAt(cells[prevCell], slot.pos, seg)) {
                const previousPos = slot.pos;
                slot.pos = previousPos + seg.length;
                if (dfs(lineIdx, segIdx + 1, prevCell)) return true;
                slot.pos = previousPos;
            }
        }
        for (let c = prevCell + 1; c < cells.length; c += 1) {
            const existing = entered[c];
            if (existing !== null) {
                if (matchesAt(cells[c], existing.pos, seg)) {
                    const previousPos = existing.pos;
                    existing.pos = previousPos + seg.length;
                    if (dfs(lineIdx, segIdx + 1, c)) return true;
                    existing.pos = previousPos;
                }
                continue;
            }
            const cell = cells[c];
            for (let s = 0; s + seg.length <= cell.length; s += 1) {
                if (!matchesAt(cell, s, seg)) continue;
                entered[c] = { start: s, pos: s + seg.length };
                if (dfs(lineIdx, segIdx + 1, c)) return true;
                entered[c] = null;
            }
        }
        return false;
    };
    if (!dfs(0, 0, -1)) return null;
    const firstCell = entered.findIndex((slot) => slot !== null);
    let lastCell = entered.length - 1;
    while (lastCell >= 0 && entered[lastCell] === null) lastCell -= 1;
    const first = cells[firstCell][entered[firstCell]!.start];
    const last = cells[lastCell][entered[lastCell]!.pos - 1];
    const spanWords = clinicalTokens(body.slice(first.start, last.end)).map((token) => token.text);
    return buildResult(body, unitIndex, first, last, spanWords, spanWords.length === wantedCount);
}

export function anchorTabularQuote(text: string, units: readonly DossierUnit[], quote: string): TabularQuoteMatch | null {
    const lines: QuoteLine[] = [];
    for (const raw of quote.split(/\r?\n/u)) {
        const words = clinicalTokens(raw).map((token) => token.text);
        if (words.length > 0) lines.push({ raw, words });
    }
    const wanted = lines.flatMap((line) => line.words);
    if (!lines.length || lines.length > MAX_QUOTE_LINES || !quoteHasMinimumLength(quote, wanted.length)) return null;
    const unitRows = units.map((unit) => {
        const body = unitText(text, unit);
        return { unit, body, rows: extractMarkdownTableRows(body) };
    });
    for (const { unit, body, rows } of unitRows) {
        for (const cells of rows) {
            const matched = matchCompleteRow(body, unit.index, cells, lines, wanted);
            if (matched) return matched;
        }
    }
    const segmentedLines = lines.map((line) =>
        line.raw
            .split(COLUMN_GAP)
            .map((part) => clinicalTokens(part).map((token) => token.text))
            .filter((part) => part.length > 0),
    );
    if (!segmentedLines.some((segments) => segments.length >= 2)) return null;
    for (const { unit, body, rows } of unitRows) {
        for (const cells of rows) {
            const matched = matchVisualLinesRow(body, unit.index, cells, segmentedLines, wanted.length);
            if (matched) return matched;
        }
    }
    return null;
}
