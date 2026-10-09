/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    executePatientClipboardPaste,
    type PatientClipboardState,
} from './patient-clipboard';

function makeClipboard(overrides: Partial<PatientClipboardState> = {}): PatientClipboardState {
    return {
        patientIds: ['patient-1'],
        patientVersions: { 'patient-1': 4 },
        duplicateIntentId: '11cf2a9a-5448-44f2-81b1-4101267477ca',
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
    assert.deepEqual(JSON.parse(String(live.calls[0]?.init.body)), { patientIds: ['patient-1'], patientVersions: { 'patient-1': 4 }, targetAmbulatoryId: 'ambulatory-target' });

    const testTarget = makeRecorder(true);
    assert.equal(await executePatientClipboardPaste(
        makeClipboard({ operation: 'cut' }),
        'ambulatory-test',
        true,
        { request: testTarget.request },
    ), true);
    assert.equal(testTarget.calls[0]?.url, '/api/patients/duplicate');
    assert.deepEqual(JSON.parse(String(testTarget.calls[0]?.init.body)), {
        patientIds: ['patient-1'], patientVersions: { 'patient-1': 4 },
        sourceAmbulatoryId: 'ambulatory-source', targetAmbulatoryId: 'ambulatory-test',
        duplicateIntentId: '11cf2a9a-5448-44f2-81b1-4101267477ca',
    });
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
        makeClipboard({ operation: 'cut', patientVersions: {} }),
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

test('copy rejects absent, partial or extra version maps before dispatch and retains clipboard on conflict', async () => {
    for (const patientVersions of [{}, { other: 4 }, { 'patient-1': 4, other: 4 }] as Record<string, number>[]) {
        const recorder = makeRecorder(true);
        assert.equal(await executePatientClipboardPaste(makeClipboard({ patientVersions }), 'target', false, { request: recorder.request }), false);
        assert.equal(recorder.calls.length, 0);
    }
    let cleared = false;
    assert.equal(await executePatientClipboardPaste(makeClipboard(), 'target', false, {
        request: makeRecorder(false).request, onSuccess: () => { cleared = true; },
    }), false);
    assert.equal(cleared, false);
});

test('clipboard hook captures copy versions and passes the observed snapshot to live paste', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const load = createRequire(import.meta.url);
    const dir = mkdtempSync(join(tmpdir(), 'mediflow-clipboard-hook-'));
    const reactFile = join(dir, 'react.cjs');
    const liveQueryFile = join(dir, 'live-query.cjs');
    // Only React scheduling and the notification sink are replaced. The hook's
    // copy callback, captured state and production paste function all execute.
    writeFileSync(reactFile, `let state;
exports.useState=initial=>[state??=initial,value=>{state=value}];
exports.useCallback=callback=>callback;`);
    writeFileSync(liveQueryFile, 'exports.notifyDbChange=()=>{};');
    const { registerHooks } = load('node:module') as {
        registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
            next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
    };
    const hooks = registerHooks({ resolve(specifier, context, next) {
        const file = specifier === 'react' ? reactFile : specifier === '@/lib/live-query' ? liveQueryFile : null;
        return file ? { url: pathToFileURL(file).href, shortCircuit: true } : next(specifier, context);
    } });
    const originalFetch = globalThis.fetch;
    try {
        const { usePatientClipboard } = load('../hooks/use-patient-clipboard.ts') as typeof import('../hooks/use-patient-clipboard');
        const calls: Array<{ url: string; body: unknown }> = [];
        globalThis.fetch = async (url, init) => {
            calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
            return new Response(null, { status: 200 });
        };
        const ids = ['patient-1'];
        const versions = { 'patient-1': 4 };
        usePatientClipboard().copy(ids, 'source', versions);
        ids.push('patient-2');
        versions['patient-1'] = 9;
        const captured = usePatientClipboard();
        assert.match(captured.clipboard.duplicateIntentId!, /^[0-9a-f-]{36}$/);
        assert.deepEqual(captured.clipboard.patientVersions, { 'patient-1': 4 });
        assert.equal(await captured.paste('target', false), true);
        assert.deepEqual(calls, [{ url: '/api/patients/assign', body: {
            patientIds: ['patient-1'], patientVersions: { 'patient-1': 4 }, targetAmbulatoryId: 'target',
        } }]);
        assert.equal(usePatientClipboard().hasContent, false);

        usePatientClipboard().cut(['patient-1'], 'source', { 'patient-1': 4 });
        const retry = usePatientClipboard();
        const intent = retry.clipboard.duplicateIntentId;
        assert.ok(intent);
        globalThis.fetch = async () => new Response(null, { status: 409 });
        assert.equal(await retry.paste('target', true), false);
        assert.equal(usePatientClipboard().clipboard.duplicateIntentId, intent);
        globalThis.fetch = async (url, init) => {
            const body = JSON.parse(String(init?.body));
            assert.equal(String(url), '/api/patients/duplicate');
            assert.equal(body.duplicateIntentId, intent);
            assert.deepEqual(body.patientVersions, { 'patient-1': 4 });
            return new Response(null, { status: 200 });
        };
        assert.equal(await usePatientClipboard().paste('target', true), true);
        assert.equal(usePatientClipboard().clipboard.duplicateIntentId, null);
        usePatientClipboard().copy(['patient-1'], 'source', {});
        assert.equal(await usePatientClipboard().paste('target', false), false);
        assert.equal(calls.length, 1, 'the shared exact-version check rejects an incomplete captured map');
        assert.equal(usePatientClipboard().hasContent, true);
    } finally {
        globalThis.fetch = originalFetch;
        hooks.deregister();
        rmSync(dir, { recursive: true, force: true });
    }
});


test('test-target clipboard retries keep the observed versions and one intent', async () => {
    const clipboard = makeClipboard();
    const failed = makeRecorder(false);
    let successes = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
        assert.equal(await executePatientClipboardPaste(clipboard, 'target', true,
            { request: failed.request, onSuccess: () => { successes++; } }), false);
    }
    assert.equal(successes, 0);
    assert.equal(failed.calls.length, 2);
    assert.equal(failed.calls[0].init.body, failed.calls[1].init.body);
    for (const invalid of [{ patientVersions: {} }, { duplicateIntentId: null }, { sourceAmbulatoryId: null }]) {
        const recorder = makeRecorder(true);
        assert.equal(await executePatientClipboardPaste(makeClipboard(invalid), 'target', true, { request: recorder.request }), false);
        assert.equal(recorder.calls.length, 0);
    }
});
