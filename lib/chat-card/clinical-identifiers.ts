import { z } from 'zod';
import type { RedactionSessionEntity } from '../ai-redaction-session';

export const knownClinicalIdentifiersSchema = z.strictObject({
    names: z.array(z.string().min(1).max(256)).max(64),
    birthDates: z.array(z.string().min(1).max(256)).max(64),
});
export type KnownClinicalIdentifiers = z.infer<typeof knownClinicalIdentifiersSchema>;
const substitutions: Record<string, string> = {
    '0': 'o', '1': 'i', l: 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g',
    а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', к: 'k', м: 'm', т: 't', в: 'b', н: 'h',
    α: 'a', ε: 'e', ο: 'o', ρ: 'p', χ: 'x', υ: 'y', ι: 'i', κ: 'k', μ: 'm', τ: 't', β: 'b', ν: 'v', η: 'h', ς: 's', σ: 's',
};
const clinicalWords = new Set(['hba1c', 'fev1', 'cd4', 'cd8', 't3', 't4', 'ft3', 'ft4', 'b12', 'd3', 'spo2', 'sao2', 'pao2', 'paco2', 'co2', 'o2', 'egfr', 'ca125', 'mg/dl', 'mg/die', 'mg/kg', 'mmol/l', 'g/dl', 'ml/min', 'ui/l', 'u/l', 'ng/ml', 'pg/ml', 'mcg/die', 'follow-up']);
const unit = /^\s*(?:mmhg|mg|mcg|µg|μg|g|kg|ml|dl|l|bpm|mmol|mol|ui|u|%|cm|mm|m)(?!\p{L})/iu;
const numberWord = '(?:zero|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|trenta|quaranta|cinquanta|sessanta|settanta|ottanta|novanta|cento|mille)';

function normalized(text: string) {
    if (!text.isWellFormed()) throw new Error('clinical_card_denied');
    let compact = '', folded = '';
    const offsets: { start: number; end: number }[] = [];
    let start = 0;
    for (const char of text) {
        const end = start + char.length;
        const parts = char.normalize('NFKC').toLowerCase().replaceAll('ß', 'ss').normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '');
        if (!parts && /^[\p{M}\p{Cf}]$/u.test(char) && offsets.length) offsets[offsets.length - 1].end = end;
        for (const part of parts) {
            compact += part;
            folded += substitutions[part] ?? part;
            offsets.push({ start, end });
        }
        start = end;
    }
    return { compact, folded, offsets };
}

/** Optimal string alignment distance, stopping early above the limit. */
function withinEdits(a: string, b: string, limit: number) {
    if (Math.abs(a.length - b.length) > limit) return false;
    let before: number[] = [], previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) current[j] = Math.min(current[j], before[j - 2] + 1);
        }
        before = previous;
        previous = current;
    }
    return previous[b.length] <= limit;
}

export function clinicalIdentifierSpans(text: string, known: KnownClinicalIdentifiers): RedactionSessionEntity[] {
    const spans: RedactionSessionEntity[] = [];
    const add = (start: number, end: number) => spans.push({ start, end, text: text.slice(start, end), type: 'identifier', confidence: 1 });
    const view = normalized(text);
    if (!view.compact) throw new Error('clinical_card_denied');
    const spokenLetters: Record<string, string> = { erre: 'r', esse: 's', emme: 'm', enne: 'n', di: 'd', effe: 'f', ics: 'x', bi: 'b', ci: 'c', gi: 'g', acca: 'h', elle: 'l', pi: 'p', cu: 'q', ti: 't', vi: 'v', zeta: 'z', zero: '0', uno: '1', due: '2', tre: '3', quattro: '4', cinque: '5', sei: '6', sette: '7', otto: '8', nove: '9' };
    const spoken = normalized(text.replace(/\p{L}+/gu, word => spokenLetters[word.toLowerCase()] ?? word));
    for (const identifier of [...known.names, ...known.birthDates]) {
        const full = normalized(identifier);
        if (!full.folded) throw new Error('clinical_card_denied');
        const minimum = /\p{N}/u.test(full.compact) ? 6 : 4;
        // A known name is compared whole at any length; a typo of it is still that name.
        if (!/\p{N}/u.test(full.compact) && !/[^\p{L}\p{M}]/u.test(identifier.normalize('NFKC'))) {
            // Typing and OCR errors replace or swap letters: same length and same first letter.
            // Wider tolerance would block ordinary words such as aria or fianchi.
            const edits = full.folded.length >= 8 ? 2 : full.folded.length >= 5 ? 1 : 0;
            const nameLike = (candidate: ReturnType<typeof normalized>) => candidate.compact === full.compact
                || (candidate.folded === full.folded && full.folded.length >= minimum)
                || (edits > 0 && candidate.folded.length === full.folded.length && candidate.folded[0] === full.folded[0]
                    && withinEdits(candidate.folded, full.folded, edits));
            const source = text.normalize('NFKC');
            for (const word of source.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) if (nameLike(normalized(word[0]))) add(0, text.length);
            // A separator cannot hide a name inside a compound: Mq/rta, Va-lli.
            for (const word of source.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’/-][\p{L}\p{M}\p{N}]+)+/gu)) if (nameLike(normalized(word[0]))) add(0, text.length);
        }
        if (full.folded.length < minimum) continue;
        const needle = full.folded.slice(0, minimum);
        if (spoken.folded.includes(needle) && spoken.folded !== view.folded) add(0, text.length);
        let index = view.folded.indexOf(needle);
        while (index >= 0) {
            const start = view.offsets[index].start;
            if (!/[\p{L}\p{N}]$/u.test(text.slice(0, start))) {
                const length = view.folded.startsWith(full.folded, index) ? full.folded.length : minimum;
                add(start, view.offsets[index + length - 1].end);
            }
            index = view.folded.indexOf(needle, index + 1);
        }
    }
    for (let index = 0; index + 16 <= view.compact.length; index++) {
        if (!/^[a-z0-9]{6}[0-9oilzsbmnpqrstuv]{2}[a-z0-9][0-9oilzsbmnpqrstuv]{2}[a-z0-9][0-9oilzsbmnpqrstuv]{3}[a-z0-9]$/u.test(view.compact.slice(index, index + 16))) continue;
        if ((view.compact.slice(index, index + 6).match(/[a-z]/gu) ?? []).length < 4) continue;
        const start = view.offsets[index].start, end = view.offsets[index + 15].end;
        if (/\p{L}{7,}/u.test(text.slice(start, end))) continue;
        if (!/[\p{L}\p{N}]$/u.test(text.slice(0, start)) && !/^[\p{L}\p{N}]/u.test(text.slice(end))) add(start, end);
    }
    for (const pattern of [
        /[\p{L}\p{N}._%+-]+\s*@\s*[\p{L}\p{N}.-]+/gu,
        /\b(?:chiocciola|tessera|matricola|cf|codice fiscale|telefono|cellulare|nascita|nato|nata)\b/giu,
        /\b(?:\d{1,2}[\s/.-]+\d{1,2}[\s/.-]+(?:19|20)\d{2}|(?:19|20)\d{2}[\s/.-]+\d{1,2}[\s/.-]+\d{1,2})\b/gu,
        /\b\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(?:19|20)\d{2}\b/giu,
        /(?<!\p{L})(?:\p{L}[\s.\p{Cf}-]+){2,}\p{L}(?!\p{L})/gu,
    ]) for (const m of text.normalize('NFKC').matchAll(pattern)) {
        // NFKC can expand characters; the conservative span is the whole original row.
        if (text.normalize('NFKC') !== text) add(0, text.length); else add(m.index, m.index + m[0].length);
    }
    for (const pattern of [new RegExp(`(?<!\\p{L})(?:${numberWord}[\\s,.-]+){3,}${numberWord}(?!\\p{L})`, 'giu'), /\b\p{L}*(?:cento|mila|mille)\p{L}*\b/giu]) {
        for (const m of text.matchAll(pattern)) if (!unit.test(text.slice(m.index + m[0].length))) add(m.index, m.index + m[0].length);
    }
    const numericText = text.normalize('NFKC');
    for (const m of numericText.matchAll(/(?<![\p{L}\p{N}])\d(?:[\d\s()+.,/-]*\d)?/gu)) {
        if (/^(?:[01]?\d|2[0-3])[.:][0-5]\d$/u.test(m[0])) continue;
        if (m[0].replace(/\D/gu, '').length >= 4 && !unit.test(numericText.slice(m.index + m[0].length))) {
            if (numericText !== text) add(0, text.length); else add(m.index, m.index + m[0].length);
        }
    }
    for (const m of text.normalize('NFKC').matchAll(/[\p{L}\p{N}]+(?:[^\s\p{L}\p{N}]+[\p{L}\p{N}]+)*/gu)) {
        const word = m[0].toLowerCase();
        if (clinicalWords.has(word)) continue;
        // Compounds such as amoxicillina/acido, dell'asma: their parts are read as words.
        if (/^[\p{L}\p{M}]+(?:['’/-][\p{L}\p{M}]+)*$/u.test(word)) continue;
        if (/\p{L}/u.test(word) && ( /\p{N}/u.test(word) || /[^\p{L}\p{M}]/u.test(word))) add(0, text.length);
    }
    if (/\p{Cf}|[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{Z}\p{S}\s]/u.test(text.replace(/(?<!\p{L})[µμ]g(?!\p{L})/gu, 'mg'))) add(0, text.length);
    return spans;
}

export class ClinicalRowDenied extends Error {
    constructor(readonly section: 'diagnoses' | 'noteExcerpts', readonly row: number) {
        super('clinical_card_denied');
    }
}
