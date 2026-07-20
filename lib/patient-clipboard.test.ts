/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    executePatientClipboardPaste,
    type PatientClipboardState,
} from './patient-clipboard';

function makeClipboard(overrides: Partial<PatientClipboardState> = {}): PatientClipboardState {
    return {
        patientIds: ['patient-1'],
        patientVersions: {},
        operation: 'copy',
        sourceAmbulatoryId: 'ambulatory-source',
        ...overrides,
    };
}

function makeRecorder(ok: boolean) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    return {
        calls,
        request: async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return { ok };
        },
    };
}

test('copy links live patients and test targets always duplicate', async () => {
    const live = makeRecorder(true);
    assert.equal(await executePatientClipboardPaste(
        makeClipboard(),
        'ambulatory-target',
        false,
        { request: live.request },
    ), true);
    assert.equal(live.calls[0]?.url, '/api/patients/assign');

    const testTarget = makeRecorder(true);
    assert.equal(await executePatientClipboardPaste(
        makeClipboard({ operation: 'cut' }),
        'ambulatory-test',
        true,
        { request: testTarget.request },
    ), true);
    assert.equal(testTarget.calls[0]?.url, '/api/patients/duplicate');
});

test('live cut uses one versioned move request', async () => {
    const recorder = makeRecorder(true);
    assert.equal(await executePatientClipboardPaste(
        makeClipboard({
            operation: 'cut',
            patientVersions: { 'patient-1': 4 },
        }),
        'ambulatory-target',
        false,
        { request: recorder.request },
    ), true);

    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0]?.url, '/api/patients/move');
    assert.deepEqual(JSON.parse(String(recorder.calls[0]?.init.body)), {
        patientIds: ['patient-1'],
        patientVersions: { 'patient-1': 4 },
        targetAmbulatoryId: 'ambulatory-target',
        sourceAmbulatoryId: 'ambulatory-source',
    });
});

test('failed or incomplete moves do not run the success effect', async () => {
    let successCount = 0;
    const failed = makeRecorder(false);
    assert.equal(await executePatientClipboardPaste(
        makeClipboard({ operation: 'cut', patientVersions: { 'patient-1': 4 } }),
        'ambulatory-target',
        false,
        { request: failed.request, onSuccess: () => { successCount += 1; } },
    ), false);
    assert.equal(successCount, 0);

    const incomplete = makeRecorder(true);
    assert.equal(await executePatientClipboardPaste(
        makeClipboard({ operation: 'cut' }),
        'ambulatory-target',
        false,
        { request: incomplete.request, onSuccess: () => { successCount += 1; } },
    ), false);
    assert.equal(incomplete.calls.length, 0);
    assert.equal(successCount, 0);
});

test('successful paste runs the clear effect once', async () => {
    let successCount = 0;
    const recorder = makeRecorder(true);
    assert.equal(await executePatientClipboardPaste(
        makeClipboard(),
        'ambulatory-target',
        false,
        { request: recorder.request, onSuccess: () => { successCount += 1; } },
    ), true);
    assert.equal(successCount, 1);
});
