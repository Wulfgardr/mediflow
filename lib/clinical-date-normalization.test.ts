import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeEntryCreateInput, normalizeEntryUpdateInput,
    normalizeTherapyCreateInput, normalizeTherapyUpdateInput,
    normalizeCheckupCreateInput, normalizeCheckupUpdateInput,
    normalizeObservationCreateInput, normalizeObservationUpdateInput,
} from './api-v1-clinical-write-normalization';

const iso = '2026-10-09T09:30:00.000Z';
const context = { id: 'synthetic-record', patientId: 'synthetic-patient', now: new Date(iso) };
type Result = { ok: true; values: object } | { ok: false; error: string };
type DateField = { name: string; optional?: boolean; nullable?: boolean };
type Case = {
    name: string;
    normalize: (input: Record<string, unknown>) => Result;
    valid: Record<string, unknown>;
    dates: DateField[];
};
const updatedAt = { name: 'updatedAt', optional: true };
const deletedAt = { name: 'deletedAt', optional: true, nullable: true };
const endDate = { name: 'endDate', optional: true, nullable: true };
const cases: Case[] = [
    { name: 'entry create', normalize: input => normalizeEntryCreateInput(input, context),
        valid: { type: 'visit', content: 'ENC:synthetic:entry', date: iso }, dates: [{ name: 'date' }, updatedAt] },
    { name: 'entry update', normalize: normalizeEntryUpdateInput,
        valid: { content: 'ENC:synthetic:entry' }, dates: [{ name: 'date', optional: true }, updatedAt, deletedAt] },
    { name: 'therapy create', normalize: input => normalizeTherapyCreateInput(input, context),
        valid: { drugName: 'Synthetic', dosage: 'Synthetic', startDate: iso }, dates: [{ name: 'startDate' }, endDate] },
    { name: 'therapy update', normalize: normalizeTherapyUpdateInput,
        valid: { dosage: 'Synthetic' }, dates: [{ name: 'startDate', optional: true }, endDate, updatedAt, deletedAt] },
    { name: 'checkup create', normalize: input => normalizeCheckupCreateInput(input, context),
        valid: { title: 'Synthetic', date: iso }, dates: [{ name: 'date' }] },
    { name: 'checkup update', normalize: normalizeCheckupUpdateInput,
        valid: { title: 'Synthetic' }, dates: [{ name: 'date', optional: true }, updatedAt, deletedAt] },
    { name: 'observation create', normalize: input => normalizeObservationCreateInput(input, context),
        valid: { codeSystem: 'LOINC', code: 'synthetic', display: 'Synthetic', unitSystem: 'UCUM',
            unitCode: '1', value: '1', observedAt: iso }, dates: [{ name: 'observedAt' }] },
    { name: 'observation update', normalize: normalizeObservationUpdateInput,
        valid: { value: '1' }, dates: [{ name: 'observedAt', optional: true }, updatedAt, deletedAt] },
];

for (const entry of cases) {
    for (const field of entry.dates) {
        test(`${entry.name}: ${field.name} rejects coercible JSON values without throwing`, () => {
            for (const value of [true, false, [iso], [], {}, { toString: 7 }]) {
                assert.deepEqual(entry.normalize({ ...entry.valid, [field.name]: value }),
                    { ok: false, error: `Invalid ${field.name}` }, JSON.stringify(value));
            }
        });

        test(`${entry.name}: ${field.name} preserves supported dates and absence semantics`, () => {
            for (const value of [iso, Date.parse(iso), new Date(iso), new Date(0)]) {
                const result = entry.normalize({ ...entry.valid, [field.name]: value });
                assert.equal(result.ok, true);
                if (!result.ok) return;
                const date = (result.values as Record<string, unknown>)[field.name];
                assert.ok(date instanceof Date);
                assert.equal(date.getTime(), value instanceof Date ? value.getTime() : new Date(value).getTime());
            }
            for (const value of [0, NaN, Infinity, 'not-a-date', new Date(NaN)]) {
                assert.deepEqual(entry.normalize({ ...entry.valid, [field.name]: value }),
                    { ok: false, error: `Invalid ${field.name}` });
            }
            for (const value of [null, '']) {
                const result = entry.normalize({ ...entry.valid, [field.name]: value });
                if (field.nullable) {
                    assert.equal(result.ok, true);
                    if (result.ok) assert.equal((result.values as Record<string, unknown>)[field.name], null);
                } else {
                    assert.deepEqual(result, { ok: false, error: `Invalid ${field.name}` });
                }
            }
            const omitted = { ...entry.valid };
            delete omitted[field.name];
            const result = entry.normalize(omitted);
            if (field.optional) {
                assert.equal(result.ok, true);
            } else {
                assert.deepEqual(result, { ok: false, error: `Invalid ${field.name}` });
            }
        });
    }
}
