import { clinicalIdentifierSpans, ClinicalRowDenied, type KnownClinicalIdentifiers } from './clinical-identifiers';
import { z } from 'zod';
import type { ClinicalPreparedRead } from './clinical-preparation';

export const CLINICAL_PROFILE_VERSION = 'mediflow.clinical-chat-profile.v1';
const row = z.strictObject({ text: z.string().min(1).max(4096), sourceRef: z.string().regex(/^src_[a-f0-9]{32}$/u) });
export const clinicalSchema = z.strictObject({ profile: z.literal(CLINICAL_PROFILE_VERSION), version: z.literal(1),
    pseudonym: z.string().regex(/^card_[a-f0-9]{32}$/u), diagnoses: z.array(row).max(16), noteExcerpts: z.array(row).max(8) });
export const clinicalSelectionSchema = z.strictObject({ diagnoses: z.array(z.string().min(1).max(2048)).max(16),
    noteExcerpts: z.array(z.string().min(1).max(2048)).max(8) }).refine(v => v.diagnoses.length + v.noteExcerpts.length > 0)
    .refine(v => [...v.diagnoses, ...v.noteExcerpts].reduce((n, t) => n + t.length, 0) <= 6000);
export type ClinicalProfile = z.infer<typeof clinicalSchema>;
export type ClinicalSelection = z.infer<typeof clinicalSelectionSchema>;
const fail = (): never => { throw new Error('clinical_card_denied'); };
export function assertClinicalBoundary(read: ClinicalPreparedRead, expected: ClinicalProfile, known: KnownClinicalIdentifiers): void {
    const got = clinicalSchema.parse(JSON.parse(read.payload));
    if (Buffer.byteLength(read.payload, 'utf8') > 16384 || JSON.stringify(got) !== read.payload
        || JSON.stringify(read.content) !== read.payload || got.pseudonym !== expected.pseudonym) return fail();
    for (const key of ['diagnoses', 'noteExcerpts'] as const) {
        if (got[key].length !== expected[key].length) return fail();
        got[key].forEach((row, i) => {
            if (clinicalIdentifierSpans(row.text, known).length) throw new ClinicalRowDenied(key, i + 1);
            if (row.sourceRef !== expected[key][i].sourceRef || row.text !== expected[key][i].text) return fail();
        });
    }
    if (clinicalIdentifierSpans([...got.diagnoses, ...got.noteExcerpts].map(r => r.text).join('\n'), known).length) return fail();
    if (/MF_PII|\{\{|\}\}/u.test(read.payload)) return fail();
}
