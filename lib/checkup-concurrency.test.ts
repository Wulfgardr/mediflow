import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { buildCheckupVersionConflictPayload, parseCheckupExpectedVersion } from './checkup-concurrency.ts';

test('parseCheckupExpectedVersion requires a positive integer', () => {
    assert.equal(parseCheckupExpectedVersion(1), 1);
    assert.equal(parseCheckupExpectedVersion(0), null);
    assert.equal(parseCheckupExpectedVersion(1.5), null);
    assert.equal(parseCheckupExpectedVersion('1'), null);
});

test('buildCheckupVersionConflictPayload returns a PHI-safe checkup snapshot', () => {
    const payload = buildCheckupVersionConflictPayload(2, 'checkup-1', {
        id: 'checkup-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: new Date('2026-05-02T08:00:00.000Z'),
        deletedAt: new Date('2026-05-02T09:00:00.000Z'),
    });

    assert.equal(payload.code, 'VERSION_CONFLICT');
    assert.equal(payload.entity, 'checkup');
    assert.equal(payload.currentVersion, 3);
    assert.deepEqual(payload.currentSnapshot, {
        id: 'checkup-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: '2026-05-02T08:00:00.000Z',
        deletedAt: '2026-05-02T09:00:00.000Z',
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload.currentSnapshot ?? {}, 'title'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.currentSnapshot ?? {}, 'notes'), false);
});
