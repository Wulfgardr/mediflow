import { clinicalIdentifierSpans, ClinicalRowDenied, type KnownClinicalIdentifiers } from './clinical-identifiers';
import { z } from 'zod';
import { jsonEmissionPlan } from '../ai-preparation/emission-plan';
import type { PreparedContentRead } from '../ai-preparation/preparation-core';
import { evaluateEgress } from '../ai-egress-gate';

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
export function clinicalEmissionPlan(value: ClinicalProfile) {
    clinicalSchema.parse(value);
    return jsonEmissionPlan(value, path => path.at(-1) !== 'text');
}
export function assertClinicalBoundary(read: PreparedContentRead, expected: ClinicalProfile, known: KnownClinicalIdentifiers): void {
    const got = clinicalSchema.parse(JSON.parse(read.payload));
    if (Buffer.byteLength(read.payload, 'utf8') > 16384 || JSON.stringify(got) !== read.payload
        || JSON.stringify(read.content) !== read.payload || got.pseudonym !== expected.pseudonym) return fail();
    for (const key of ['diagnoses', 'noteExcerpts'] as const) {
        if (got[key].length !== expected[key].length) return fail();
        got[key].forEach((row, i) => {
            for (const match of row.text.matchAll(/\{\{MF_PII_[a-f0-9]{32}_[1-9][0-9]{0,3}\}\}/gu)) {
                const original = read.restoreText(match[0]);
                const spans = clinicalIdentifierSpans(original, known);
                if ([...original.matchAll(/[\p{L}\p{N}]/gu)].some(m => !spans.some(s => s.start <= m.index && s.end >= m.index + m[0].length))) throw new ClinicalRowDenied(key, i + 1);
            }
            const visible = row.text.replace(/\{\{MF_PII_[a-f0-9]{32}_[1-9][0-9]{0,3}\}\}/gu, ' ');
            if (!/\p{L}{2}/u.test(visible) || clinicalIdentifierSpans(visible, known).length) throw new ClinicalRowDenied(key, i + 1);
            if (row.sourceRef !== expected[key][i].sourceRef || (row.text.includes('MF_PII') ? read.restoreText(row.text) : row.text) !== expected[key][i].text) return fail();
        });
    }
    const bare = read.payload.replace(/\{\{MF_PII_[a-f0-9]{32}_[1-9][0-9]{0,3}\}\}/gu, token => { read.restoreText(token); return 'redacted'; });
    if (/MF_PII|\{\{|\}\}|\b(?:19|20)\d{2}-\d{2}-\d{2}\b/u.test(bare) || Object.keys(evaluateEgress({ text: bare, lane: 'redaction' }).entityCounts).length) return fail();
}
