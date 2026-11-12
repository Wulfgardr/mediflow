import type { RedactionEntityType } from './redaction-contracts';

type IdentifierSpan = Readonly<{ start: number; end: number; text: string; type: RedactionEntityType; confidence: number }>;
const separator = '[\\s._\\-\\p{Cf}]{0,4}';
const letter = '[A-Z]', digit = '[0-9LMNPQRSTUVOI]';
// The tax-code grammar remains the same across spaces, OCR line wraps and punctuation.
const taxCode = new RegExp(`(?<![\\p{L}\\p{N}])${[
    ...Array(6).fill(letter), ...Array(2).fill(digit), letter, ...Array(2).fill(digit),
    letter, ...Array(3).fill(digit), letter,
].join(separator)}(?![\\p{L}\\p{N}])`, 'giu');
const atom = '[\\p{L}\\p{N}]+';
const localPart = `${atom}(?:\\s+(?:punto|trattino(?:\\s+basso)?)\\s+${atom})*`;
const spokenEmail = new RegExp(`(?<![\\p{L}\\p{N}])${localPart}\\s+chiocciola\\s+(?:${atom}\\s+punto\\s+){1,8}${atom}(?![\\p{L}\\p{N}])`, 'giu');
const spokenDigit = '(?:zero|uno|due|tre|quattro|cinque|sei|sette|otto|nove)';
const spokenPhone = new RegExp(`(?<!\\p{L})(?:(?:più|piu)\\s+(?:trentanove|tre\\s+nove)\\s+)?(?:${spokenDigit}[\\s,.-]+){6,31}${spokenDigit}(?!\\p{L})`, 'giu');
const unitAfter = /^\s*(?:mmhg|mg|mcg|µg|μg|g|kg|ml|dl|mmol|ui|bpm|%)(?!\p{L})/iu;
const fileName = /[^\s"'<>()[\]{};,:]+?\.(?:pdf|docx?|xlsx?|csv|jpe?g|png|tiff?|dcm|xml|json|txt|rtf|od[tpfgsm])\b/giu;
const placeCue = '(?:(?:trasferit[oa]|trasferisc(?:e|ono|o)|domiciliat[oaie]|resident[ei]|risied(?:e|ono)|abit(?:a|ano)|viv(?:e|ono))\\s+(?:(?:da|a|in)\\s+|nel\\s+comune\\s+di\\s+)|(?:luogo(?:\\s+di\\s+nascita)?|indirizzo|residenza|domicilio|comune(?:\\s+di\\s+nascita)?)\\s*:\\s*)';
// A geographic cue owns one clause, never the clinical clause after its delimiter.
const place = new RegExp(`\\b${placeCue}([^\\r\\n;,.]+?)(?=\\s+(?:con|per|dove|mentre)\\b|[,;.\\r\\n]|$)`, 'giu');
const placeLabel = /^(?:luogo(?: di nascita)?|comune(?: di nascita)?|indirizzo|residenza|domicilio|provenienza|birthplace|birth place|address|residence)$/iu;

/** Local source-text rules shared by pseudonymization and clinical-card refusal.
 * No dictionary of people or places, and no model/egress authority. */
export function localIdentifierSpans(text: string): readonly IdentifierSpan[] {
    const spans: IdentifierSpan[] = [];
    const add = (start: number, end: number, type: RedactionEntityType) => {
        if (start < end) spans.push({ start, end, text: text.slice(start, end), type, confidence: 1 });
    };
    for (const match of text.matchAll(taxCode)) add(match.index, match.index + match[0].length, 'tax_id');
    for (const match of text.matchAll(spokenEmail)) add(match.index, match.index + match[0].length, 'email');
    for (const match of text.matchAll(spokenPhone)) {
        if (!unitAfter.test(text.slice(match.index + match[0].length))) add(match.index, match.index + match[0].length, 'phone');
    }
    for (const match of text.matchAll(fileName)) add(match.index, match.index + match[0].length, 'identifier');
    for (const match of text.matchAll(place)) {
        const value = match[1].trimEnd();
        const start = match.index + match[0].lastIndexOf(match[1]);
        add(start, start + value.length, 'address');
    }
    // Imported key/value tables can put a place in a key and its geographic
    // label in the value. Keep unrelated labels and clinical measurements.
    for (const match of text.matchAll(/("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")/gu)) {
        let key: string, value: string;
        try { key = JSON.parse(match[1]); value = JSON.parse(match[2]); } catch { continue; }
        if (placeLabel.test(value.trim())) add(match.index + 1, match.index + match[1].length - 1, 'address');
        if (placeLabel.test(key.trim())) {
            const start = match.index + match[0].lastIndexOf(match[2]) + 1;
            add(start, start + match[2].length - 2, 'address');
        }
    }
    return spans;
}
