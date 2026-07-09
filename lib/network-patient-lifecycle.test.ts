import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import {
    validateNetworkDeletionReason,
    validateNetworkPatientCreateBody,
} from './network-patient-lifecycle.ts';

test('validateNetworkPatientCreateBody accepts sealed sensitive fields and scoped ambulatory id', () => {
    const result = validateNetworkPatientCreateBody(
        {
            id: 'patient-1',
            firstName: ' Ada ',
            lastName: ' Lovelace ',
            taxCode: 'LVLDAA',
            address: 'ENC:iv:cipher',
            phone: null,
            caregiver: undefined,
            exemptions: 'ENC:iv:exemptions',
            diagnoses: 'ENC:iv:diagnoses',
            statusReason: 'ENC:iv:status',
            notes: 'ENC:iv:notes',
            ambulatoryId: 'amb-1',
        },
        'amb-1',
    );

    assert.deepEqual(result, { ok: true });
});

test('validateNetworkPatientCreateBody rejects plaintext sensitive create fields', () => {
    const result = validateNetworkPatientCreateBody(
        {
            firstName: 'Ada',
            lastName: 'Lovelace',
            taxCode: 'LVLDAA',
            address: 'plain address',
        },
        'amb-1',
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
    assert.deepEqual(result.value, { error: 'Network create requires sealed sensitive fields' });
});

test('validateNetworkPatientCreateBody rejects AI and server-controlled fields', () => {
    const aiResult = validateNetworkPatientCreateBody(
        {
            firstName: 'Ada',
            lastName: 'Lovelace',
            taxCode: 'LVLDAA',
            aiSummary: 'ENC:iv:summary',
        },
        'amb-1',
    );
    assert.equal(aiResult.ok, false);
    if (!aiResult.ok) {
        assert.equal(aiResult.status, 403);
        assert.deepEqual(aiResult.value, { error: 'Network patient write boundary excludes AI fields' });
    }

    const serverResult = validateNetworkPatientCreateBody(
        {
            firstName: 'Ada',
            lastName: 'Lovelace',
            taxCode: 'LVLDAA',
            version: 2,
        },
        'amb-1',
    );
    assert.equal(serverResult.ok, false);
    if (!serverResult.ok) {
        assert.equal(serverResult.status, 400);
        assert.deepEqual(serverResult.value, { error: 'Network create excludes server-controlled fields' });
    }
});

test('validateNetworkPatientCreateBody rejects missing required identity and scope mismatch', () => {
    const missing = validateNetworkPatientCreateBody(
        {
            firstName: 'Ada',
            lastName: ' ',
            taxCode: 'LVLDAA',
        },
        'amb-1',
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) {
        assert.equal(missing.status, 400);
        assert.deepEqual(missing.value, { error: 'Missing required fields' });
    }

    const scope = validateNetworkPatientCreateBody(
        {
            firstName: 'Ada',
            lastName: 'Lovelace',
            taxCode: 'LVLDAA',
            ambulatoryId: 'amb-2',
        },
        'amb-1',
    );
    assert.equal(scope.ok, false);
    if (!scope.ok) {
        assert.equal(scope.status, 403);
        assert.deepEqual(scope.value, { error: 'Network scope violation' });
    }
});

test('validateNetworkDeletionReason requires sealed optional deletion reason', () => {
    assert.deepEqual(validateNetworkDeletionReason(undefined), { ok: true });
    assert.deepEqual(validateNetworkDeletionReason(null), { ok: true });
    assert.deepEqual(validateNetworkDeletionReason('ENC:iv:reason'), { ok: true });

    const result = validateNetworkDeletionReason('plain reason');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
    assert.deepEqual(result.value, { error: 'Network delete requires a sealed deletion reason' });
});
