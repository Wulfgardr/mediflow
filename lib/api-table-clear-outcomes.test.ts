import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from './db';

const attachment = (id: string) => ({ id, patientId: 'synthetic-patient', name: 'synthetic', path: 'synthetic',
    type: 'text/plain', size: 1, currentness: { sourceRef: 'a'.repeat(64), revision: 1, freshnessEpoch: 1 } });

test('clear fallback rejects an unavailable authenticated list instead of reporting an empty success', async t => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        calls.push(options?.method ?? 'GET');
        return new Response(null, { status: options?.method === 'DELETE' ? 405 : 401 });
    });
    await assert.rejects(db.attachments.clear(), /Authenticated list unavailable/);
    assert.deepEqual(calls, ['DELETE', 'GET']);
});

test('clear fallback waits for already-started deletes before returning an incomplete error', async t => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const deleted: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
        if (url === '/api/attachments') {
            return options?.method === 'DELETE'
                ? new Response(null, { status: 405 })
                : Response.json([attachment('synthetic-pending'), attachment('synthetic-rejected')]);
        }
        assert.deepEqual(JSON.parse(options!.body as string), {
            patientId: 'synthetic-patient', expected: attachment('').currentness,
        });
        if (url.endsWith('synthetic-rejected')) return Response.json({}, { status: 409 });
        await pending;
        deleted.push(url);
        return Response.json({ success: true });
    });
    let settled = false;
    const run = db.attachments.clear().finally(() => { settled = true; });
    const rejection = assert.rejects(run, /Clear incomplete for attachments: 1\/2 deletions confirmed/);
    try {
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(settled, false, 'a pending deletion must finish before reporting the error');
    } finally {
        release();
        await rejection;
    }
    assert.deepEqual(deleted, ['/api/attachments/synthetic-pending']);
});
