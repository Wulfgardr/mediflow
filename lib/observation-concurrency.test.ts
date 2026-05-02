import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { buildObservationVersionConflictPayload, parseObservationExpectedVersion } from './observation-concurrency.ts';

test('parseObservationExpectedVersion requires a positive integer', () => {
    assert.equal(parseObservationExpectedVersion(1), 1);
    assert.equal(parseObservationExpectedVersion(0), null);
    assert.equal(parseObservationExpectedVersion(1.5), null);
    assert.equal(parseObservationExpectedVersion('1'), null);
});

test('buildObservationVersionConflictPayload returns a PHI-safe observation snapshot', () => {
    const payload = buildObservationVersionConflictPayload(2, 'observation-1', {
        id: 'observation-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: new Date('2026-05-02T08:00:00.000Z'),
        deletedAt: new Date('2026-05-02T09:00:00.000Z'),
    });

    assert.equal(payload.code, 'VERSION_CONFLICT');
    assert.equal(payload.entity, 'observation');
    assert.equal(payload.currentVersion, 3);
    assert.deepEqual(payload.currentSnapshot, {
        id: 'observation-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: '2026-05-02T08:00:00.000Z',
        deletedAt: '2026-05-02T09:00:00.000Z',
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload.currentSnapshot ?? {}, 'value'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.currentSnapshot ?? {}, 'notes'), false);
});
