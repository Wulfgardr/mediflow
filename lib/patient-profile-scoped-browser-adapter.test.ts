import assert from 'node:assert/strict';
import test from 'node:test';
import { createPatientProfileScopedBrowserAdapter, PatientProfileBrowserAdapterError } from './patient-profile-scoped-browser-adapter.ts';
const result = { schemaVersion: 'mediflow.patient.profile-view.v1', operationId: 'patient-profile.read.v1', contractVersion: 1,
    handle: `pph_${'a'.repeat(64)}`, projection: 'notes', currentness: { revision: 3, selectionEpoch: 8, observedAt: 1000, expiresAt: 5000 },
    profile: { notes: 'Synthetic notes' } };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const rejects = (code: string) => (value: unknown) => value instanceof PatientProfileBrowserAdapterError && value.code === code;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(next => { resolve = next; }); return { resolve, promise }; }

test('opens through explicit epoch then reads the same handle and revision, without legacy identity fields', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createPatientProfileScopedBrowserAdapter({ now: () => 2000, fetch: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return response(init.method === 'GET' ? { contractVersion: 1, selectionEpoch: 7 } : result);
    } });
    const opened = await client.open('synthetic-patient', 'notes');
    assert.equal(Object.isFrozen(opened.profile), true);
    await client.read();
    assert.deepEqual(calls.map(v => v.init.method), ['GET', 'POST', 'POST']);
    assert.ok(calls.every(v => v.init.cache === 'no-store' && v.init.credentials === 'same-origin'));
    assert.deepEqual(JSON.parse(calls[1]!.init.body as string), { kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: 7 });
    assert.deepEqual(JSON.parse(calls[2]!.init.body as string), { kind: 'read', contractVersion: 1, projection: 'notes', handle: opened.handle, expectedRevision: opened.currentness.revision });
});

test('late epoch replies cannot post an older patient open after a newer intention', async () => {
    const old = deferred<Response>(), posted: string[] = []; let get = 0;
    const client = createPatientProfileScopedBrowserAdapter({ now: () => 2000, fetch: async (url, init = {}) => {
        if (init.method === 'GET') return ++get === 1 ? old.promise : response({ contractVersion: 1, selectionEpoch: 7 });
        posted.push(String(url)); return response(result);
    } });
    const a = client.open('synthetic-A', 'notes');
    await client.open('synthetic-B', 'notes');
    old.resolve(response({ contractVersion: 1, selectionEpoch: 6 }));
    await assert.rejects(a, rejects('operation_superseded'));
    assert.deepEqual(posted, ['/api/patients/synthetic-B/profile-query']);
});

test('failed or expired reads remain denied and never silently reopen, retry or fall back', async () => {
    for (const status of [401, 403, 409, 410, 413, 500]) {
        let calls = 0;
        const client = createPatientProfileScopedBrowserAdapter({ now: () => 2000, fetch: async (_url, init = {}) => {
            calls++; return response(init.method === 'GET' ? { contractVersion: 1, selectionEpoch: 7 } : result, calls > 2 ? status : 200);
        } });
        await client.open('synthetic-patient', 'notes');
        await assert.rejects(client.read());
        assert.equal(calls, 3); await assert.rejects(client.read(), rejects('handle_unavailable')); assert.equal(calls, 3);
    }
    let now = 2000, calls = 0;
    const client = createPatientProfileScopedBrowserAdapter({ now: () => now, fetch: async (_url, init = {}) => {
        calls++; return response(init.method === 'GET' ? { contractVersion: 1, selectionEpoch: 7 } : result);
    } });
    await client.open('synthetic-patient', 'notes'); now = 6000;
    await assert.rejects(client.read(), rejects('handle_expired')); assert.equal(calls, 2);
});

test('lock/reset, malformed epoch, mismatched projection and over-budget responses fail closed', async () => {
    const pending = deferred<Response>(), controller = new AbortController();
    const locked = createPatientProfileScopedBrowserAdapter({ fetch: async () => pending.promise });
    const work = locked.open('synthetic-patient', 'notes', controller.signal); controller.abort();
    pending.resolve(response({ contractVersion: 1, selectionEpoch: 7 })); await assert.rejects(work, rejects('session_unavailable'));
    for (const epoch of [{ selectionEpoch: 7 }, { contractVersion: 1, selectionEpoch: 7, patientId: 'forbidden' }]) {
        let calls = 0; const client = createPatientProfileScopedBrowserAdapter({ fetch: async () => { calls++; return response(epoch); } });
        await assert.rejects(client.open('synthetic-patient', 'notes'), rejects('response_invalid')); assert.equal(calls, 1);
    }
    const mismatch = createPatientProfileScopedBrowserAdapter({ now: () => 2000, fetch: async (_url, init = {}) =>
        response(init.method === 'GET' ? { contractVersion: 1, selectionEpoch: 7 } : { ...result, projection: 'profile' }) });
    await assert.rejects(mismatch.open('synthetic-patient', 'notes'), rejects('response_invalid'));
    const oversized = createPatientProfileScopedBrowserAdapter({ now: () => 2000, fetch: async (_url, init = {}) =>
        response(init.method === 'GET' ? { contractVersion: 1, selectionEpoch: 7 } : { ...result, profile: { notes: '😀'.repeat(9000) } }) });
    await assert.rejects(oversized.open('synthetic-patient', 'notes'), rejects('output_too_large'));
});
