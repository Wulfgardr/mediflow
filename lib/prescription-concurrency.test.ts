import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { buildPrescriptionVersionConflictPayload, parsePrescriptionExpectedVersion } from './prescription-concurrency.ts';

test('parsePrescriptionExpectedVersion requires a positive integer', () => {
    assert.equal(parsePrescriptionExpectedVersion(1), 1);
    assert.equal(parsePrescriptionExpectedVersion(0), null);
    assert.equal(parsePrescriptionExpectedVersion(1.5), null);
    assert.equal(parsePrescriptionExpectedVersion('1'), null);
});

test('buildPrescriptionVersionConflictPayload returns a PHI-safe prescription snapshot', () => {
    const payload = buildPrescriptionVersionConflictPayload('service_prescription', 2, 'sp-1', {
        id: 'sp-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: new Date('2026-07-08T08:00:00.000Z'),
    });

    assert.equal(payload.code, 'VERSION_CONFLICT');
    assert.equal(payload.entity, 'service_prescription');
    assert.equal(payload.currentVersion, 3);
    assert.deepEqual(payload.currentSnapshot, {
        id: 'sp-1',
        patientId: 'patient-1',
        version: 3,
        updatedAt: '2026-07-08T08:00:00.000Z',
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload.currentSnapshot ?? {}, 'serviceName'), false);
});
