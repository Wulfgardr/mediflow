import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVersionConflictPayload, isVersionConflictPayload, parseExpectedVersion } from './version-concurrency.ts';

test('parseExpectedVersion accepts only positive safe integers', () => {
    assert.equal(parseExpectedVersion(1), 1);
    assert.equal(parseExpectedVersion(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
    for (const value of [0, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, -1, null, undefined]) {
        assert.equal(parseExpectedVersion(value), null);
    }
});

// The write operations hand over the whole stored row: the conflict answer must keep only identity and version.
const clinicalRows = {
    therapy: { drugName: 'Metformina', dosage: '500 mg' },
    observation: { value: '7.2', notes: 'a digiuno' },
    checkup: { title: 'Controllo diabete', notes: 'portare esami' },
    entry: { content: 'Visita', metadata: '{}' },
} as const;

for (const [entity, clinicalFields] of Object.entries(clinicalRows)) {
    test(`buildVersionConflictPayload returns a PHI-safe ${entity} snapshot`, () => {
        const deletedAt = entity === 'entry' ? null : new Date('2026-05-02T09:00:00.000Z');
        const payload = buildVersionConflictPayload(entity as keyof typeof clinicalRows, 2, `${entity}-1`, {
            id: `${entity}-1`,
            patientId: 'patient-1',
            version: 3,
            updatedAt: new Date('2026-05-02T08:00:00.000Z'),
            deletedAt,
            ...clinicalFields,
        } as Parameters<typeof buildVersionConflictPayload>[3]);

        assert.equal(isVersionConflictPayload(payload), true);
        assert.equal(payload.entity, entity);
        assert.equal(payload.currentVersion, 3);
        assert.deepEqual(payload.currentSnapshot, {
            id: `${entity}-1`,
            patientId: 'patient-1',
            version: 3,
            updatedAt: '2026-05-02T08:00:00.000Z',
            deletedAt: deletedAt ? '2026-05-02T09:00:00.000Z' : null,
        });
    });
}

test('buildVersionConflictPayload reports a missing record without a snapshot', () => {
    const payload = buildVersionConflictPayload('therapy', 2, 'therapy-1', null);
    assert.equal(payload.currentState, 'missing');
    assert.equal(payload.currentVersion, null);
    assert.equal(payload.currentSnapshot, null);
});
