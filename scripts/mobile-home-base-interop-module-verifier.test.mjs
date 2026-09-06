/* @Codex: Pure checkpoint/record assertions only; no host or UI proof. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { validateStep, compareRecords, acceptVerifiedStep, readRoutesForStep } from './mobile-home-base-interop-module-verifier.mjs';
import { sealField } from './mobile-home-base-interop.mjs';

const descriptor = { fixtureId: 'synthetic-fixture', patient: { id: 'synthetic-patient' } };
function step() {
    return { schemaVersion: 1, synthetic: true, fixtureId: descriptor.fixtureId, runID: 'test-run', clientPlatform: 'ios',
        stepID: 'step-001', module: 'therapy', recordId: 'synthetic-therapy', patientId: descriptor.patient.id,
        version: 1, deleted: false, expected: { drugName: 'Synthetic unit-only', dosage: 'Synthetic dosage' } };
}
function record() {
    return { id: 'synthetic-therapy', patientId: descriptor.patient.id, version: 1, deletedAt: null,
        drugName: 'Synthetic unit-only', dosage: 'Synthetic dosage' };
}

test('module checkpoints bind exact fixture, run, platform, patient and supported fields', () => {
    assert.equal(validateStep(step(), descriptor, 'test-run', 'ios').module, 'therapy');
    for (const patch of [{ synthetic: false }, { runID: 'stale' }, { fixtureId: 'other' }, { patientId: 'other' },
        { clientPlatform: 'ipados' }, { module: '../runtime' }, { recordId: '../record' },
        { version: 0 }, { expected: {} }, { expected: { masterKey: 'unsupported' } }]) {
        assert.throws(() => validateStep({ ...step(), ...patch }, descriptor, 'test-run', 'ios'));
    }
});

test('record comparison requires exact values, identity, count and both CAS versions', async () => {
    assert.equal((await compareRecords(step(), [record()], [record()])).version, 1);
    for (const changed of [{ ...record(), version: 2 }, { ...record(), patientId: 'other' },
        { ...record(), dosage: 'stale' }, { ...record(), deletedAt: '2026-01-01T00:00:00Z' }]) {
        await assert.rejects(compareRecords(step(), [changed], [record()]));
        await assert.rejects(compareRecords(step(), [record()], [changed]));
    }
    await assert.rejects(compareRecords(step(), [record(), record()], [record()]));
    await assert.rejects(compareRecords(step(), [record()], []));
});

test('historical therapy explicitly distinguishes web active-list absence from paired tombstone read', async () => {
    const deletedStep = { ...step(), deleted: true, version: 3 };
    const deleted = { ...record(), deletedAt: '2026-01-01T00:00:00Z', version: 3 };
    const result = await compareRecords(deletedStep, [], [deleted]);
    assert.equal(result.webObservation, 'absent-from-active-list');
    assert.equal(result.pairedObservation, 'exact-record-fields-and-version');
    await assert.rejects(compareRecords(deletedStep, [deleted], [deleted]));
    await assert.rejects(compareRecords(deletedStep, [], [record()]));
});

function patientStep(stage = 'created') {
    const stages = ['created', 'profile-updated', 'archived', 'reactivated', 'trashed', 'restored', 'restored-reread'];
    const index = stages.indexOf(stage);
    const identity = { firstName: 'Sintetico', lastName: 'Interop test-run ios', taxCode: 'SYN-test-run-ios' };
    return { ...step(), module: 'patient', recordId: 'new-ui-patient', patientId: 'new-ui-patient',
        stepID: `step-${String(index + 1).padStart(3, '0')}`, lifecycleStage: stage,
        version: Math.min(index + 1, 6), deleted: stage === 'trashed',
        expected: stage === 'trashed' ? { ...identity, deletionReason: 'Eliminazione sintetica test-run' }
            : { ...identity, address: 'Synthetic address', phone: '0000000000', caregiver: 'Synthetic contact' },
        expectedFlags: { isArchived: stage === 'archived', isAdi: false },
        expectedNulls: stage === 'trashed' ? ['birthDate'] : ['birthDate', 'deletionReason'] };
}

test('patient lifecycle binds one newly UI-created identity and advances only after verified checkpoints', () => {
    const history = new Map();
    const created = patientStep();
    assert.equal(validateStep(created, descriptor, 'test-run', 'ios', history), created);
    assert.throws(() => validateStep(patientStep('profile-updated'), descriptor, 'test-run', 'ios', history));
    for (const stage of ['created', 'profile-updated', 'archived', 'reactivated', 'trashed', 'restored', 'restored-reread']) {
        const candidate = patientStep(stage);
        assert.equal(validateStep(candidate, descriptor, 'test-run', 'ios', history), candidate);
        acceptVerifiedStep(candidate, history);
    }
    assert.throws(() => validateStep(patientStep('restored'), descriptor, 'test-run', 'ios', history));
    for (const patch of [{ recordId: descriptor.patient.id, patientId: descriptor.patient.id },
        { expected: { ...created.expected, lastName: 'Unrelated patient' } },
        { expectedFlags: { isArchived: true, isAdi: false } }, { expectedNulls: [] }, { version: 2 }]) {
        assert.throws(() => validateStep({ ...created, ...patch }, descriptor, 'test-run', 'ios'));
    }
    const bound = new Map();
    acceptVerifiedStep(created, bound);
    assert.throws(() => validateStep({ ...patientStep('profile-updated'), recordId: 'other', patientId: 'other' },
                                    descriptor, 'test-run', 'ios', bound));
});

test('patient rereads distinguish complete active detail from permitted tombstone summary', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const created = patientStep();
    const full = { id: created.recordId, version: 1, deletedAt: null, birthDate: null, deletionReason: null,
        ...created.expectedFlags, ...created.expected };
    for (const field of ['address', 'phone', 'caregiver']) full[field] = await sealField(full[field], key);
    const comparison = await compareRecords(created, [full], [full], key, key);
    assert.equal(comparison.webObservation, 'exact-record-fields-and-version');
    assert.deepEqual(comparison.comparedNulls, ['birthDate', 'deletionReason']);
    for (const changed of [{ ...full, isArchived: true }, { ...full, birthDate: '2000-01-01' },
        { ...full, deletionReason: '' }, { ...full, address: created.expected.address }]) {
        await assert.rejects(compareRecords(created, [changed], [changed], key, key));
    }
    const trash = patientStep('trashed');
    const tombstone = { id: trash.recordId, version: 5, deletedAt: '2026-01-01T00:00:00Z', birthDate: null,
        ...trash.expected, ...trash.expectedFlags, deletionReason: await sealField(trash.expected.deletionReason, key) };
    const result = await compareRecords(trash, [], [tombstone], key, key);
    assert.equal(result.webObservation, 'exact-patient-detail-404');
    await assert.rejects(compareRecords(trash, [tombstone], [tombstone], key, key));
    await assert.rejects(compareRecords(trash, [], [{ ...tombstone, version: 4 }], key, key));
    assert.deepEqual(readRoutesForStep(created), { web: '/api/patients/new-ui-patient',
        paired: '/api/v1/network/patients/new-ui-patient', webStatus: 200 });
    assert.deepEqual(readRoutesForStep(trash), { web: '/api/patients/new-ui-patient',
        paired: '/api/v1/network/patients?includeDeleted=true', webStatus: 404 });
});

test('each clinical module requires authenticated sealed fields while canonical codes and statuses remain plain', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const cases = [
        ['therapy', 'motivation', 'status', 'active'], ['checkup', 'notes', 'title', 'Synthetic title'],
        ['observation', 'notes', 'code', '29463-7'], ['service', 'serviceName', 'status', 'prescribed'],
        ['service-item', 'serviceName', 'serviceCode', 'SYN001'],
        ['prosthetic', 'description', 'status', 'prescribed'], ['entry', 'content', 'type', 'visit'],
    ];
    for (const [module, encryptedField, plainField, plainValue] of cases) {
        const expected = { [encryptedField]: 'Synthetic encrypted content', [plainField]: plainValue };
        const candidate = { ...step(), module, expected };
        const sealed = await sealField(expected[encryptedField], key);
        const wire = { id: candidate.recordId, patientId: candidate.patientId, version: 1, deletedAt: null,
            [encryptedField]: sealed, [plainField]: plainValue };
        await compareRecords(candidate, [wire], [wire], key, key);
        const plainClinical = { ...wire, [encryptedField]: expected[encryptedField] };
        await assert.rejects(compareRecords(candidate, [plainClinical], [wire], key, key), module);
        await assert.rejects(compareRecords(candidate, [wire], [plainClinical], key, key), module);
        await assert.rejects(compareRecords(candidate, [plainClinical], [plainClinical], key, key), module);
        const unauthenticated = { ...wire, [encryptedField]: 'ENC:invalid:invalid' };
        await assert.rejects(compareRecords(candidate, [unauthenticated], [unauthenticated], key, key), module);
        const encryptedCode = { ...wire, [plainField]: await sealField(plainValue, key) };
        await assert.rejects(compareRecords(candidate, [encryptedCode], [encryptedCode], key, key), module);
    }
});
