import assert from 'node:assert/strict';
import test from 'node:test';
import type { Therapy } from './db';
import { projectLastRecordedTherapyChanges as projectTherapyChanges } from './patient-therapy-changes.ts';

const therapy = (id: string, fields: Partial<Therapy>): Therapy => ({
    id, patientId: 'synthetic-patient', drugName: `Farmaco sintetico ${id}`, dosage: '1 cp', status: 'active',
    startDate: new Date('2026-01-10T08:00:00.000Z'), createdAt: new Date('2026-01-10T08:00:00.000Z'), version: 1, ...fields,
});

test('each therapy contributes its last recorded change, newest first', () => {
    const changes = projectTherapyChanges([
        therapy('started', {}),
        therapy('updated', { version: 3, updatedAt: new Date('2026-06-02T09:00:00.000Z') }),
        therapy('suspended', { status: 'suspended', version: 2, updatedAt: new Date('2026-07-16T09:00:00.000Z') }),
        therapy('completed', { status: 'completed', endDate: new Date('2026-09-20T08:00:00.000Z'), updatedAt: new Date('2026-09-21T08:00:00.000Z') }),
    ]);
    assert.deepEqual(changes.map(({ id, kind, date }) => [id, kind, date.toISOString().slice(0, 10)]), [
        ['completed', 'completed', '2026-09-20'],
        ['suspended', 'suspended', '2026-07-16'],
        ['updated', 'updated', '2026-06-02'],
        ['started', 'started', '2026-01-10'],
    ]);
});

test('a first version is a start even when the record carries an update time', () => {
    const [change] = projectTherapyChanges([therapy('first', { updatedAt: new Date('2026-03-01T08:00:00.000Z') })]);
    assert.equal(change.kind, 'started');
    assert.equal(change.date.toISOString().slice(0, 10), '2026-01-10');
});

test('a conclusion without an end date falls back to the last recorded update', () => {
    const [change] = projectTherapyChanges([therapy('ended', { status: 'completed', endDate: null, updatedAt: new Date('2026-04-05T08:00:00.000Z') })]);
    assert.deepEqual([change.kind, change.date.toISOString().slice(0, 10)], ['completed', '2026-04-05']);
});

test('deleted therapies and records without a usable date are left out, and the list is bounded', () => {
    const rows = [
        therapy('deleted', { deletedAt: new Date('2026-05-01T08:00:00.000Z') }),
        therapy('undated', { startDate: new Date('invalid') }),
        ...['a', 'b', 'c', 'd', 'e'].map((id, index) => therapy(id, { startDate: new Date(`2026-02-0${index + 1}T08:00:00.000Z`) })),
    ];
    assert.deepEqual(projectTherapyChanges(rows).map(change => change.id), ['e', 'd', 'c', 'b']);
    assert.equal(projectTherapyChanges(rows, 2).length, 2);
});
