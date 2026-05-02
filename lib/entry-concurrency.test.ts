import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { buildEntryVersionConflictPayload, parseEntryExpectedVersion } from './entry-concurrency.ts';

test('parseEntryExpectedVersion requires a positive integer', () => {
    assert.equal(parseEntryExpectedVersion(1), 1);
    assert.equal(parseEntryExpectedVersion(0), null);
    assert.equal(parseEntryExpectedVersion(1.5), null);
    assert.equal(parseEntryExpectedVersion('1'), null);
});

test('buildEntryVersionConflictPayload returns a PHI-safe entry snapshot', () => {
    const payload = buildEntryVersionConflictPayload(2, 'entry-1', {
        id: 'entry-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: new Date('2026-05-02T08:00:00.000Z'),
        deletedAt: null,
    });

    assert.equal(payload.code, 'VERSION_CONFLICT');
    assert.equal(payload.entity, 'entry');
    assert.equal(payload.currentVersion, 3);
    assert.deepEqual(payload.currentSnapshot, {
        id: 'entry-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: '2026-05-02T08:00:00.000Z',
        deletedAt: null,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload.currentSnapshot ?? {}, 'content'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.currentSnapshot ?? {}, 'metadata'), false);
});
