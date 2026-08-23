/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SmartImportBrowserOrchestratorError, createSmartImportBrowserOrchestrator } from './smart-import-browser-orchestrator.ts';

const LEASE = Object.freeze({ sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 4, patientRef: `ptr_${'2'.repeat(32)}`,
    ambulatoryRef: `abr_${'3'.repeat(32)}`, leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: 9 });
const ATTACHMENT = Object.freeze({ schemaVersion: 'mediflow.smart-import.projection-attachment.v1', capability: 'smart_import' });
const HANDLE = `prj_${'5'.repeat(32)}`;
const DENIED = Object.freeze({ writesPerformed: 0, apply: 'denied', status: 'denied', code: 'projection_unavailable', proposal: null, receipt: null, provenance: null, reviewRef: null });
const IDS = [`req_${'a'.repeat(32)}`, `req_${'b'.repeat(32)}`];

function selection(context: object, enumerable = false): object {
    const value = { selectionEpoch: LEASE.selectionEpoch, lease: LEASE };
    Object.defineProperty(value, 'selectionContext', { value: context, enumerable, writable: false, configurable: false }); return Object.freeze(value);
}
function attachment(context: object, enumerable = false): object {
    const value = { attachment: ATTACHMENT };
    Object.defineProperty(value, 'selectionContext', { value: context, enumerable, writable: false, configurable: false }); return Object.freeze(value);
}
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function subject(replies: readonly Response[], current: (snapshot: unknown) => boolean = () => true) {
    const bodies: unknown[] = []; let id = 0;
    const orchestrator = createSmartImportBrowserOrchestrator({ requestId: () => IDS[id++], isCurrent: current,
        fetch: async (_path, init) => { bodies.push(JSON.parse(init?.body as string)); const next = replies[bodies.length - 1]; if (!next) throw new Error('unexpected'); return next; } });
    return Object.freeze({ orchestrator, bodies });
}
async function rejects(value: Promise<unknown>, code: string) {
    await assert.rejects(value, (error: unknown) => error instanceof SmartImportBrowserOrchestratorError && error.code === code);
}

test('posts one exact ingest followed by one exact preview without sending the selection sidecar', async () => {
    const context = Object.freeze({}); const current = subject([response({ handle: HANDLE }), response({ preview: DENIED })]);
    const result = await current.orchestrator.run(selection(context), attachment(context));
    assert.deepEqual(result, { preview: DENIED }); assert.equal('handle' in result, false); assert.equal(current.bodies.length, 2);
    assert.deepEqual(current.bodies[0], { tuple: { sessionRef: LEASE.sessionRef, selectionEpoch: LEASE.selectionEpoch, patientRef: LEASE.patientRef, ambulatoryRef: LEASE.ambulatoryRef, leaseRef: LEASE.leaseRef }, attachment: ATTACHMENT, requestId: IDS[0] });
    assert.deepEqual(current.bodies[1], { handle: HANDLE, requestId: IDS[1] }); assert.notEqual(current.bodies[0].requestId, current.bodies[1].requestId);
    assert.equal(JSON.stringify(current.bodies[0]).includes('selectionContext'), false); assert.equal(JSON.stringify(current.bodies[0]).includes('expiresAt'), false);
});

test('fails closed before IO for invalid current selection-bound snapshots', async () => {
    const context = Object.freeze({}); const current = subject([]);
    for (const [selected, bound] of [[selection(context), attachment(Object.freeze({}))], [selection(context, true), attachment(context)], [selection(context), attachment(context, true)]]) {
        await rejects(current.orchestrator.run(selected, bound), 'selection_invalid');
    }
    const embedded = { attachment: Object.freeze({ ...ATTACHMENT, selectionContext: context }) }; Object.defineProperty(embedded, 'selectionContext', { value: context, enumerable: false }); Object.freeze(embedded);
    await rejects(current.orchestrator.run(selection(context), embedded), 'selection_invalid');
    const stale = subject([], () => false); await rejects(stale.orchestrator.run(selection(context), attachment(context)), 'selection_invalid');
    assert.equal(current.bodies.length, 0);
});

test('does not retry unknown, unavailable, malformed, or invalid ingest and preview outcomes', async () => {
    const context = Object.freeze({});
    for (const [replies, code, calls] of [
        [[response({}, 500)], 'ingest_outcome_unknown', 1], [[response({ handle: 'bad' })], 'response_invalid', 1],
        [[response({ handle: HANDLE }), response({}, 503)], 'preview_outcome_unknown', 2], [[response({ handle: HANDLE }), response({ preview: { status: 'bad' } })], 'response_invalid', 2],
    ] as const) {
        const current = subject(replies); await rejects(current.orchestrator.run(selection(context), attachment(context)), code); assert.equal(current.bodies.length, calls);
    }
});

test('rejects raw UUID request identifiers and network failures without retrying', async () => {
    const context = Object.freeze({}); let fetchCalls = 0; let raw = 0; let ids = 0;
    const invalid = createSmartImportBrowserOrchestrator({ isCurrent: () => true, requestId: () => [`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`][raw++], fetch: async () => { fetchCalls += 1; return response({}); } });
    await rejects(invalid.run(selection(context), attachment(context)), 'input_invalid'); assert.equal(fetchCalls, 0);
    const unavailable = createSmartImportBrowserOrchestrator({ isCurrent: () => true, requestId: () => IDS[ids++], fetch: async () => { fetchCalls += 1; throw new Error('synthetic'); } });
    await rejects(unavailable.run(selection(context), attachment(context)), 'ingest_unavailable'); assert.equal(fetchCalls, 1);
});

test('fences every awaited or parsed result when currentness changes', async () => {
    const context = Object.freeze({});
    for (const failureAt of [2, 3, 4, 5, 6, 7, 8]) {
        let checks = 0; const current = subject([response({ handle: HANDLE }), response({ preview: DENIED })], () => ++checks !== failureAt);
        await rejects(current.orchestrator.run(selection(context), attachment(context)), 'selection_invalid');
    }
});

test('invalidates overlapping and reset runs without publishing their results', async () => {
    const context = Object.freeze({}); let resolveFirst!: (value: Response) => void; let calls = 0;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; }); const replies = [response({ handle: HANDLE }), response({ preview: DENIED })]; let id = 0;
    const orchestrator = createSmartImportBrowserOrchestrator({ requestId: () => `req_${(id++).toString(16).padStart(32, 'a')}`, isCurrent: () => true,
        fetch: async () => { calls += 1; return calls === 1 ? first : replies[calls - 2]; } });
    const stale = orchestrator.run(selection(context), attachment(context)); const fresh = orchestrator.run(selection(context), attachment(context));
    assert.deepEqual(await fresh, { preview: DENIED }); resolveFirst(response({ handle: HANDLE })); await rejects(stale, 'operation_superseded');
    const resetStale = orchestrator.run(selection(context), attachment(context)); orchestrator.reset(); await rejects(resetStale, 'operation_superseded');
});

test('keeps the orchestrator browser-only and outside selection, UI, storage, or apply scope', () => {
    const source = readFileSync(new URL('./smart-import-browser-orchestrator.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /server-only|node:|localStorage|sessionStorage|console\.|\.select\(|\/selection|\.apply\(|provider|lifecycle|retry\s*\(/u);
});
