import lexicon from '../../../native/contracts/clinical-context-lexicon.json' with { type: 'json' };

const WORD = /[0-9]+(?:[.,][0-9]+)*|[\p{L}\p{M}]+/gu;

const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function clinicalTokens(text: string): Array<{ text: string; start: number; end: number; numeric: boolean }> {
    return Array.from(text.matchAll(WORD), (match) => {
        const raw = match[0];
        const start = match.index;
        return { text: normalize(raw), start, end: start + raw.length, numeric: /^[0-9]/u.test(raw) };
    });
}

const words = (text: string) => clinicalTokens(text).map((token) => token.text);
const phrases = (entries: readonly string[]) => entries.map((entry) => normalize(entry).split(/\s+/u))
    .sort((left, right) => right.length - left.length);
const negation = phrases(lexicon.negation);
const suspension = phrases(lexicon.suspension);
const family = phrases(lexicon.family);
const exemptionRevocation = phrases(lexicon.exemptionRevocation);

function matchAt(passage: readonly string[], at: number, entries: readonly string[][]): readonly string[] | undefined {
    return entries.find((entry) => entry.every((word, offset) => word.endsWith('*')
        ? passage[at + offset]?.startsWith(word.slice(0, -1))
        : passage[at + offset] === word));
}

function firstCue(passage: readonly string[], entries: readonly string[][]): number {
    return passage.findIndex((_, index) => Boolean(matchAt(passage, index, entries)));
}

export function hasNegation(text: string): boolean {
    return firstCue(words(text), negation) >= 0;
}

export function* negationCues(text: string): Generator<{ text: string; index: number }> {
    const tokens = clinicalTokens(text);
    const passage = tokens.map((token) => token.text);
    for (let at = 0; at < tokens.length; at += 1) {
        const cue = matchAt(passage, at, negation);
        if (!cue) continue;
        const index = tokens[at].start;
        at += cue.length - 1;
        yield { text: text.slice(index, tokens[at].end), index };
    }
}

export function hasFamilyContext(input: string | readonly string[]): boolean {
    return firstCue(typeof input === 'string' ? words(input) : input, family) >= 0;
}

export function hasSuspension(text: string): boolean {
    return firstCue(words(text), suspension) >= 0;
}

export function firstSuspensionOffset(text: string): number {
    const tokens = clinicalTokens(text);
    return tokens[firstCue(tokens.map((token) => token.text), suspension)]?.start ?? -1;
}

export const { suspensionHeadings, familyHeadings } = lexicon;
export const legacyPreparedNegation = new Set(lexicon.legacyPreparedNegation);
export const legacyPreparedFamily = new RegExp(lexicon.legacyPreparedFamily, 'u');
export const legacySectionFamily = new RegExp(String.raw`\b(?:${lexicon.legacySectionFamily})\b`, 'iu');
export const legacySectionNegation = new RegExp(String.raw`\b(?:${lexicon.legacySectionNegation})\b`, 'iu');
export const structuredContextApplies = (kind: string) =>
    kind === 'therapy' || kind === 'diagnosis' || kind === 'observation' || kind === 'exemption';
export const isHistoricalTherapy = (status: string | undefined) => status === 'suspended' || status === 'completed';

const headingStart = /^[ \t]*(?:#{1,6}[ \t]*)?([\p{L}][\p{L}\p{M} \t'’()/.-]*):/u;
const markdownHeading = /^[ \t]*#{1,6}[ \t]+([\p{L}][\p{L}\p{M}\p{N} \t'’()/.-]*)[ \t]*\r?$/u;
export const clinicalHeadingPattern = new RegExp(`${headingStart.source}[ \\t]*\\r?$|${markdownHeading.source}`, 'gmu');
const abbreviations = new Set(lexicon.abbreviations);

function* sentenceSpans(text: string, start: number, end: number) {
    let from = start > 0 ? text.lastIndexOf('\n', start - 1) + 1 : 0;
    const lineStart = from;
    for (const match of text.slice(lineStart).matchAll(/[\n\r.!?]/gu)) {
        const at = lineStart + match.index;
        if (match[0] === '.') {
            const next = text[at + 1] ?? '';
            if (/[\p{L}\p{N}]/u.test(next)) continue;
            const word = /[\p{L}\p{M}]+$/u.exec(text.slice(0, at))?.[0] ?? '';
            if (next && abbreviations.has(normalize(word))) continue;
        }
        const to = at + 1;
        const span = { start: from, end: to };
        if (to > start) yield span;
        if (to >= end) return;
        from = to;
    }
    yield { start: from, end: text.length };
}

function lineHeading(line: string) {
    const heading = headingStart.exec(line) ?? markdownHeading.exec(line);
    return heading && !/^\d/u.test(line.slice(heading[0].length).trimStart()) ? heading : null;
}

export function contextHeading(text: string, sentenceStart: number, wrappedExemption = false): string {
    let end = sentenceStart > 0 ? text.lastIndexOf('\n', sentenceStart - 1) : -1;
    const lineEnd = text.indexOf('\n', sentenceStart);
    const line = text.slice(end + 1, lineEnd < 0 ? text.length : lineEnd);
    const inline = lineHeading(text.slice(sentenceStart, lineEnd < 0 ? text.length : lineEnd)) ?? lineHeading(line);
    if (inline) return inline[1];
    while (end >= 0) {
        const from = end === 0 ? 0 : text.lastIndexOf('\n', end - 1) + 1;
        const previous = text.slice(from, end);
        if (!previous.trim()) break;
        const heading = lineHeading(previous);
        if (heading) {
            const body = previous.slice(heading[0].length).trim();
            if (body) break;
            if (wrappedExemption && from > 0 && /^esenzion[ei][ \t]*:$/iu.test(previous.trim())) {
                const lead = text.slice(text.lastIndexOf('\n', from - 2) + 1, from - 1).trim();
                const clause = lead.split(/[.!?;:]/u).at(-1) ?? '';
                return `${clause} ${heading[1]}`;
            }
            return heading[1];
        }
        end = from - 1;
    }
    return '';
}

export interface ClinicalContext { negated: boolean; family: boolean; suspended: boolean }

export function headingQualifiers(label: string, kind?: string): ClinicalContext {
    const passage = words(label);
    return {
        negated: firstCue(passage, negation) >= 0,
        family: firstCue(passage, family) >= 0,
        suspended: firstCue(passage, suspension) >= 0 || (kind === 'exemption' && firstCue(passage, exemptionRevocation) >= 0),
    };
}

type Span = { start: number; end: number };

function qualitativeResult(passage: string, values: Readonly<Record<string, string>>): Span | undefined {
    const result = words(values.value ?? '');
    if (!lexicon.qualitativeResults.includes(result.join(' '))) return;
    const display = words(values.display ?? '');
    if (!display.length) return;
    const tokens = clinicalTokens(passage);
    const expected = [...display, ...result];
    const at = tokens.findIndex((_, index) => expected.every((word, offset) => tokens[index + offset]?.text === word));
    if (at < 0) return;
    const first = tokens[at + display.length];
    const last = tokens[at + expected.length - 1];
    const between = passage.slice(tokens[at].start, last.end);
    if (/[.!?;\r\n]/u.test(between)) return;
    return { start: first.start, end: last.end };
}

function clinicalContext(kind: string, text: string, start: number, end: number, ignoredNegation?: Span): ClinicalContext {
    const context = { negated: false, family: false, suspended: false };
    for (const span of sentenceSpans(text, start, end)) {
        const passage = text.slice(span.start, span.end);
        const sentence = headingQualifiers(passage, kind);
        const heading = headingQualifiers(contextHeading(text, span.start, kind === 'exemption'), kind);
        const negated = ignoredNegation
            ? [...negationCues(passage)].some(cue => span.start + cue.index < ignoredNegation.start
                || span.start + cue.index + cue.text.length > ignoredNegation.end)
            : sentence.negated;
        context.negated ||= negated || heading.negated;
        context.family ||= sentence.family || heading.family;
        context.suspended ||= sentence.suspended || heading.suspended;
    }
    return context;
}

export function clinicalSentence(text: string, start: number, end: number) {
    const span = sentenceSpans(text, start, start + 1).next().value ?? { start, end };
    return { after: text.slice(Math.min(end, span.end), span.end), passage: text.slice(span.start, span.end) };
}

export function clinicalFactContext(kind: string, values: Readonly<Record<string, string>>, text: string, start: number, end: number): ClinicalContext {
    const result = kind === 'observation' ? qualitativeResult(text.slice(start, end), values) : undefined;
    return clinicalContext(kind, text, start, end, result && { start: start + result.start, end: start + result.end });
}

export function contextReview(context: ClinicalContext, allowsSuspension = false): string {
    return [
        context.negated && 'negation',
        context.suspended && !allowsSuspension && 'suspension',
        context.family && 'family',
    ].filter(Boolean).join(',');
}

export const legacyIcdPattern = new RegExp(String.raw`\bICD[-\s]?(9|10)(?:[-\s]?CM)?\s*[:.]?\s*([A-Z]?\d{2,3}(?:\.\d{1,2})?)\b`
    + String.raw`\s*[-–:]?\s*((?:(?!\bICD\b|\bICD[-\s]?\d|\b(?:${lexicon.legacyIcdDescriptionStop})\w*\b)[^\n.;]){0,160})`, 'giu');
