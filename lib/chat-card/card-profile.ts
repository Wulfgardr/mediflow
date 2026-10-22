import { z } from 'zod';
import { jsonEmissionPlan } from '../ai-preparation/emission-plan';
import type { PreparedContentRead } from '../ai-preparation/preparation-core';

export const CARD_PROFILE_VERSION = 'mediflow.synthetic-chat-card.v1';
const reference = z.string().regex(/^src_[a-f0-9]{32}$/u);
const text = z.string().min(1).max(4096);
const relativeTime = z.enum(['ultimi_6_mesi', 'attuale']);
export const cardSchema = z.strictObject({
    profile: z.literal(CARD_PROFILE_VERSION),
    pseudonym: z.string().regex(/^card_[a-f0-9]{32}$/u),
    history: z.array(z.strictObject({ condition: text, note: text, relativeTime, sourceRef: reference })).max(1),
    therapies: z.array(z.strictObject({ medicine: text, dose: text, frequency: text, sourceRef: reference })).max(2),
    measures: z.array(z.strictObject({ kind: text, value: text, unit: text, relativeTime, sourceRef: reference })).max(2),
});
export type Card = z.infer<typeof cardSchema>;
export const selectionSchema = z.strictObject({ historyLimit: z.number().int().min(0).max(1),
    therapyLimit: z.number().int().min(0).max(2), measureLimit: z.number().int().min(0).max(2) })
    .refine(value => value.historyLimit + value.therapyLimit + value.measureLimit > 0);
export type CardSelection = z.infer<typeof selectionSchema>;

export const CARD_FIELD_CLASSIFICATION: Readonly<Record<string, 'protocol' | 'session_pseudonym' | 'clinical' | 'free_text' | 'local_source_reference'>> = Object.freeze({
    profile: 'protocol', pseudonym: 'session_pseudonym',
    'history.*.condition': 'clinical', 'history.*.note': 'free_text', 'history.*.relativeTime': 'clinical', 'history.*.sourceRef': 'local_source_reference',
    'therapies.*.medicine': 'clinical', 'therapies.*.dose': 'clinical', 'therapies.*.frequency': 'clinical', 'therapies.*.sourceRef': 'local_source_reference',
    'measures.*.kind': 'clinical', 'measures.*.value': 'clinical', 'measures.*.unit': 'clinical', 'measures.*.relativeTime': 'clinical', 'measures.*.sourceRef': 'local_source_reference',
});
const fail = (): never => { throw new Error('synthetic_card_denied'); };
function classification(path: readonly (string | number)[]) {
    return CARD_FIELD_CLASSIFICATION[path.map(part => typeof part === 'number' ? '*' : part).join('.')] ?? fail();
}
export function cardEmissionPlan(card: Card) {
    cardSchema.parse(card);
    return jsonEmissionPlan(card, path => {
        const kind = classification(path);
        return kind === 'protocol' || kind === 'session_pseudonym' || kind === 'local_source_reference';
    });
}

/** Closed synthetic language, not a detector for arbitrary clinical prose.
 * Check the entire serialized artifact, including keys; never strip a residue. */
export function assertCardSerializedBoundary(read: PreparedContentRead, expected: Card): void {
    const parsed = cardSchema.safeParse(JSON.parse(read.payload));
    if (!parsed.success || JSON.stringify(parsed.data) !== read.payload || JSON.stringify(read.content) !== read.payload) return fail();
    const got = parsed.data;
    if (got.profile !== expected.profile || got.pseudonym !== expected.pseudonym
        || got.history.length !== expected.history.length || got.therapies.length !== expected.therapies.length
        || got.measures.length !== expected.measures.length) return fail();
    for (let i = 0; i < got.history.length; i++) {
        const { note, ...clinical } = got.history[i];
        const { note: _originalNote, ...original } = expected.history[i];
        if (JSON.stringify(clinical) !== JSON.stringify(original)) return fail();
        const reduced = note.replace(/\{\{MF_PII_[a-f0-9]{32}_[1-9][0-9]{0,3}\}\}/gu, token => {
            if (!read.restoreText(token)) return fail();
            return '[redacted]';
        });
        if (!['diabete mellito tipo 2', 'malattia di Parkinson'].includes(clinical.condition)
            || reduced !== `${clinical.condition}. Familiare: [redacted]. Luogo: [redacted]. Nascita: [redacted]. File: [redacted]. OCR: [redacted].`) return fail();
    }
    if (JSON.stringify(got.therapies) !== JSON.stringify(expected.therapies) || JSON.stringify(got.measures) !== JSON.stringify(expected.measures)) return fail();
}
