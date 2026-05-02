import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { buildTherapyVersionConflictPayload, parseTherapyExpectedVersion } from './therapy-concurrency.ts';

test('parseTherapyExpectedVersion requires a positive integer', () => {
    assert.equal(parseTherapyExpectedVersion(1), 1);
    assert.equal(parseTherapyExpectedVersion(0), null);
    assert.equal(parseTherapyExpectedVersion(1.5), null);
    assert.equal(parseTherapyExpectedVersion('1'), null);
});

test('buildTherapyVersionConflictPayload returns a PHI-safe therapy snapshot', () => {
    const payload = buildTherapyVersionConflictPayload(2, 'therapy-1', {
        id: 'therapy-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: new Date('2026-05-02T08:00:00.000Z'),
        deletedAt: new Date('2026-05-02T09:00:00.000Z'),
    });

    assert.equal(payload.code, 'VERSION_CONFLICT');
    assert.equal(payload.entity, 'therapy');
    assert.equal(payload.currentVersion, 3);
    assert.deepEqual(payload.currentSnapshot, {
        id: 'therapy-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: '2026-05-02T08:00:00.000Z',
        deletedAt: '2026-05-02T09:00:00.000Z',
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload.currentSnapshot ?? {}, 'drugName'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.currentSnapshot ?? {}, 'dosage'), false);
});
