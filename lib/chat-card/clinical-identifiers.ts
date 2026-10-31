import { z } from 'zod';
import type { RedactionSessionEntity } from '../ai-redaction-session';

export const knownClinicalIdentifiersSchema = z.strictObject({
    names: z.array(z.string().min(1).max(256)).max(64),
    birthDates: z.array(z.string().min(1).max(256)).max(64),
});
export type KnownClinicalIdentifiers = z.infer<typeof knownClinicalIdentifiersSchema>;
const substitutions: Record<string, string> = { '0': 'o', '1': 'i', l: 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g', 'ς': 'σ' };

function normalized(text: string) {
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

/** Matches locally; offsets always refer to the original UTF-16 input. */
export function clinicalIdentifierSpans(text: string, known: KnownClinicalIdentifiers): RedactionSessionEntity[] {
    const spans: RedactionSessionEntity[] = [];
    const add = (start: number, end: number) => spans.push({ start, end, text: text.slice(start, end), type: 'identifier', confidence: 1 });
    const view = normalized(text);
    const match = (value: string, pattern: RegExp) => {
        for (const m of value.matchAll(pattern)) add(view.offsets[m.index].start, view.offsets[m.index + m[0].length - 1].end);
    };
    for (const identifier of [...known.names, ...known.birthDates]) {
        const needle = normalized(identifier).folded;
        if (!needle) throw new Error('clinical_card_denied');
        let index = view.folded.indexOf(needle);
        while (index >= 0) {
            add(view.offsets[index].start, view.offsets[index + needle.length - 1].end);
            index = view.folded.indexOf(needle, index + 1);
        }
    }
    // OCR substitutions are admitted in both letter and numeric CF positions.
    for (let index = 0; index + 16 <= view.compact.length; index++) {
        if (!/^[a-z0-9]{6}[0-9oilzsbmnpqrstuv]{2}[a-z0-9][0-9oilzsbmnpqrstuv]{2}[a-z0-9][0-9oilzsbmnpqrstuv]{3}[a-z0-9]$/u.test(view.compact.slice(index, index + 16))) continue;
        const start = view.offsets[index].start, end = view.offsets[index + 15].end;
        if (!/[\p{L}\p{N}]/u.test(text.slice(Math.max(0, start - 1), start)) && !/[\p{L}\p{N}]/u.test(text.slice(end, end + 1))) add(start, end);
    }
    match(view.compact, /[0-9]{4,}/gu);
    match(view.compact, /(?:(?:zero|uno|due|tre|quattro|cinque|sei|sette|otto|nove)){3,}/gu);
    for (const pattern of [
        /[\p{L}\p{N}._%+-]+\s*@\s*[\p{L}\p{N}.-]+/gu,
        /\b[^\s,;:]+(?:\s+(?:punto|dot)\s+[^\s,;:]+)*\s+(?:chiocciola|at)\s+[^,;:\n]+/giu,
        /\b(?:nato|nata|nascita|telefono|tel|cellulare|contatto|codice|identificativo|riferimento|cf)\b[^\n;.]*/giu,
        /(?<!\p{L})(?:\p{L}[\s.\p{Cf}-]+){2,}\p{L}(?!\p{L})/gu,
        /(?<![\p{L}\p{N}])[\p{L}\p{N}]*\p{L}[\p{L}\p{N}]*\p{N}[\p{L}\p{N}]*(?![\p{L}\p{N}])/gu,
        /(?<![\p{L}\p{N}])[\p{L}\p{N}]*\p{N}[\p{L}\p{N}]*\p{L}[\p{L}\p{N}]*(?![\p{L}\p{N}])/gu,
    ]) for (const m of text.matchAll(pattern)) add(m.index, m.index + m[0].length);
    if (/chiocciola|millenovecento|duemila/iu.test(view.compact) || text.normalize('NFKC').includes('@') || /[\p{Cf}]|[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{Z}\p{S}\s]/u.test(text)) add(0, text.length);
    return spans;
}

export class ClinicalRowDenied extends Error {
    constructor(readonly section: 'diagnoses' | 'noteExcerpts', readonly row: number) {
        super('clinical_card_denied');
    }
}
