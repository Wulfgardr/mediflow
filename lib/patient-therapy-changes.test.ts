import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClinicalEntry, Therapy } from './db';
import { projectTherapyDatesSinceVisit } from './patient-therapy-changes.ts';

const date = (day: number) => new Date(2026, 10, day, 12);
const therapy = (id: string, fields: Partial<Therapy> = {}): Therapy => ({
    id, patientId: 'synthetic', drugName: id, dosage: '1 cp', status: 'active',
    startDate: date(1), createdAt: date(1), version: 1, ...fields,
});
const entry = (type: ClinicalEntry['type'], day: number, fields: Partial<ClinicalEntry> = {}): ClinicalEntry => ({
    id: `${type}-${day}`, type, patientId: 'synthetic', title: 'Voce sintetica', content: 'Testo sintetico',
    date: date(day), createdAt: date(day), updatedAt: date(18), ...fields,
});
const compare = (entries: ClinicalEntry[], therapies: Therapy[]) => projectTherapyDatesSinceVisit('synthetic', entries, therapies, date(18));

test('only a dated, non-deleted visit for this patient provides the comparison date', () => {
    const notes = [
        entry('note', 14),
        entry('remote', 14),
        entry('visit', 13, { deletedAt: date(15) }),
        entry('visit', 12, { patientId: 'other' }),
        entry('visit', 20),
        entry('visit', 17, { metadata: { workflowStatus: 'draft' } }),
        entry('visit', 18, { metadata: { workflowStatus: 'sconosciuto' } }),
        entry('visit', 1, { date: new Date('invalid') }),
    ];
    assert.equal(compare(notes, [therapy('later', { startDate: date(16) })]), null);
    assert.deepEqual(compare([...notes, entry('visit', 4), entry('visit', 6)], []), { visitDate: date(6), changes: [] });
});

test('the latest visit date is compared only with explicit starts and completed end dates', () => {
    const result = compare([entry('visit', 5)], [
        therapy('both', { startDate: date(8), endDate: date(12), status: 'completed' }),
        therapy('started', { startDate: date(10) }),
        therapy('edited', { version: 3, updatedAt: date(12) }),
        therapy('suspended', { status: 'suspended', version: 2, updatedAt: date(9) }),
        therapy('unknown-end', { status: 'completed', version: 2, updatedAt: date(11) }),
        therapy('planned-end', { endDate: date(17) }),
        therapy('future-start', { startDate: date(22) }),
        therapy('future-end', { status: 'completed', endDate: date(22) }),
        therapy('same-day', { startDate: new Date(2026, 10, 5, 23) }),
        therapy('wrong-patient', { patientId: 'other', startDate: date(11) }),
        therapy('deleted', { startDate: date(11), deletedAt: date(15) }),
        therapy('invalid', { startDate: new Date('invalid') }),
    ]);
    assert.deepEqual(result?.changes.map(({ therapyId, kind, date }) => [therapyId, kind, date.getDate()]), [
        ['both', 'end', 12], ['started', 'start', 10], ['both', 'start', 8],
    ]);
});
