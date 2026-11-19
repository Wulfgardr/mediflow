import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClinicalEntry, Therapy } from './db';
import { projectTherapyRecordUpdates, projectVisitReference } from './patient-therapy-changes.ts';

const date = (day: number) => new Date(2026, 10, day, 12);
const therapy = (id: string, fields: Partial<Therapy> = {}): Therapy => ({
    id, patientId: 'synthetic', drugName: id, dosage: '1 cp', status: 'active',
    startDate: date(1), createdAt: date(1), version: 1, ...fields,
});
const entry = (type: ClinicalEntry['type'], day: number, fields: Partial<ClinicalEntry> = {}): ClinicalEntry => ({
    id: `${type}-${day}`, type, patientId: 'synthetic', title: 'Voce sintetica', content: 'Testo sintetico',
    date: date(1), createdAt: date(day), updatedAt: date(18), ...fields,
});

test('the last visit comes from the archive registration rather than clinical date, edit date or operator', () => {
    const rows = [
        entry('note', 14), entry('visit', 13, { deletedAt: date(15) }),
        entry('visit', 12, { patientId: 'other' }), entry('visit', 20),
        entry('visit', 4, { date: date(18), recordedBy: 'Autore A' }),
        entry('visit', 6, { recordedBy: 'Autore B' }),
    ];
    assert.deepEqual(projectVisitReference('synthetic', rows, date(18)), {
        latest: { id: 'visit-6', date: date(6), author: 'Autore B' }, undated: true,
    });
    assert.equal(projectVisitReference('synthetic', rows.slice(0, 4), date(18)).latest, null);
});

test('therapy rows report current status and record timestamp without inferring any changed field', () => {
    const updates = projectTherapyRecordUpdates('synthetic', [
        therapy('ended', { status: 'completed', endDate: date(12), updatedAt: date(14), version: 2 }),
        therapy('edited', { version: 3, updatedAt: date(12) }),
        therapy('suspended', { status: 'suspended', version: 2, updatedAt: date(9) }),
        therapy('new', { startDate: date(18), createdAt: date(5) }),
        therapy('wrong-patient', { patientId: 'other' }),
        therapy('deleted', { deletedAt: date(15) }),
        therapy('invalid', { createdAt: new Date('invalid') }),
    ], date(18));
    assert.deepEqual(updates.map(({ therapy, label, date }) => [therapy.id, label, date.getDate()]), [
        ['ended', 'Conclusa', 14], ['edited', 'Aggiornata', 12], ['suspended', 'Sospesa', 9], ['new', 'Avviata', 5],
    ]);
});
