/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ProjectionBrokerError } from '../typed-projection-broker.ts';
import { SmartImportProjectionError } from '../smart-import-projection.ts';
import { ServerSessionSmartImportAttachmentIngestError } from './server-session-smart-import-attachment-ingest.ts';
import {
    createSmartImportIngestHttpHandler,
} from './server-session-smart-import-ingest-http.ts';
import { ServerSessionProjectionOwnerError } from './server-session-projection-owner.ts';

const INPUT = Object.freeze({
    tuple: Object.freeze({ sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1,
        patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`,
        leaseRef: `lsr_${'4'.repeat(32)}` }),
    attachment: Object.freeze({ synthetic: true }), requestId: `req_${'5'.repeat(32)}`,
});
const HANDLE = `prj_${'6'.repeat(32)}`;

function request(body: unknown = INPUT): Request {
    return new Request('http://127.0.0.1/api/ai/smart-import/ingest', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function handler(error?: unknown) {
    let calls = 0; let received: unknown;
    return Object.freeze({ calls: () => calls, received: () => received,
        handle: createSmartImportIngestHttpHandler({ ingest: async (input) => {
            calls += 1; received = input; if (error) throw error; return HANDLE;
        } }),
    });
}
async function rejects(response: Response, status: number, code: string) {
    assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: status === 500 ? 'Errore interno del server.' : 'Ingest Smart Import non disponibile.', code });
}

test('emits only an opaque handle with no-store through one composition call', async () => {
    const subject = handler(); const response = await subject.handle(request()); const body = await response.json();

    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(body, { handle: HANDLE }); assert.equal(subject.calls(), 1); assert.deepEqual(subject.received(), INPUT);
    for (const marker of [INPUT.tuple.sessionRef, INPUT.tuple.patientRef, INPUT.tuple.ambulatoryRef,
        INPUT.tuple.leaseRef, INPUT.requestId]) assert.equal(JSON.stringify(body).includes(marker), false);
});

test('rejects malformed and plainly non-object JSON before invoking composition', async () => {
    const subject = handler();
    const malformed = new Request('http://127.0.0.1', { method: 'POST', body: '{' });
    const hostile = { json: async () => Object.create(null) } as Request;
    for (const value of [malformed, request(null), request([]), request('synthetic'), hostile]) {
        await rejects(await subject.handle(value), 400, 'input_invalid');
    }
    assert.equal(subject.calls(), 0);
});

test('maps every typed ingest error to its stable HTTP status', async () => {
    const cases: readonly (readonly [unknown, number, string])[] = [
        ...(['input_invalid', 'owner_unavailable', 'session_unavailable'] as const).map((code) => [
            new ServerSessionSmartImportAttachmentIngestError(code),
            code === 'input_invalid' ? 400 : code === 'session_unavailable' ? 401 : 409, code,
        ] as const),
        ...(['broker_locked', 'broker_revoked', 'capability_mismatch', 'handle_collision', 'handle_missing',
            'input_invalid', 'lease_expired', 'patient_mismatch', 'projection_invalid', 'projection_stale',
            'request_replayed', 'selection_changed', 'source_invalid'] as const).map((code) => [
            new ProjectionBrokerError(code),
            ['input_invalid', 'capability_mismatch', 'patient_mismatch', 'projection_invalid'].includes(code) ? 400
                : ['broker_locked', 'broker_revoked', 'request_replayed', 'selection_changed'].includes(code) ? 409
                    : ['lease_expired', 'projection_stale'].includes(code) ? 410 : 500,
            code,
        ] as const),
        ...(['broker_factory_failed', 'broker_unavailable', 'epoch_conflict', 'input_invalid', 'lease_expired',
            'owner_disposed', 'owner_acquiring', 'owner_exists', 'reference_unavailable', 'selection_busy',
            'selection_unavailable', 'session_ineligible', 'session_unavailable', 'stale_selection'] as const).map((code) => [
            new ServerSessionProjectionOwnerError(code),
            code === 'input_invalid' ? 400 : ['session_ineligible', 'session_unavailable'].includes(code) ? 401
                : ['broker_unavailable', 'epoch_conflict', 'owner_disposed', 'owner_acquiring', 'owner_exists',
                    'selection_busy', 'stale_selection'].includes(code) ? 409 : code === 'lease_expired' ? 410
                    : code === 'reference_unavailable' ? 503 : 500,
            code,
        ] as const),
        ...(['projection_invalid', 'projection_stale'] as const).map((code) => [
            new SmartImportProjectionError(code), code === 'projection_invalid' ? 400 : 410, code,
        ] as const),
    ];
    const originalError = console.error; console.error = () => undefined;
    try {
        for (const [error, status, code] of cases) {
            const subject = handler(error); const response = await subject.handle(request());
            if (status === 500) await rejects(response, 500, 'internal_error');
            else await rejects(response, status, code);
        }
    } finally { console.error = originalError; }
});

test('passes unexpected original errors to server logging while sanitizing the response', async () => {
    const originalError = console.error; const entries: unknown[][] = [];
    const error = new Error('synthetic raw path and attachment detail'); console.error = (...values: unknown[]) => { entries.push(values); };
    try {
        const subject = handler(error); const response = await subject.handle(request()); const body = await response.json();
        assert.equal(response.status, 500); assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(body, { error: 'Errore interno del server.', code: 'internal_error' });
        assert.equal(JSON.stringify(body).includes('synthetic raw'), false); assert.equal(entries.length, 1);
        assert.equal(entries[0]?.[1], error);
    } finally { console.error = originalError; }
});

test('route remains a thin dynamic Node adapter over production ingest composition', () => {
    const source = readFileSync(new URL('../../app/api/ai/smart-import/ingest/route.ts', import.meta.url), 'utf8');
    assert.match(source, /runtime\s*=\s*'nodejs'|runtime\s*=\s*"nodejs"/u);
    assert.match(source, /dynamic\s*=\s*'force-dynamic'|dynamic\s*=\s*"force-dynamic"/u);
    assert.match(source, /ingestAuthenticatedSmartImportAttachment/u);
    assert.doesNotMatch(source, /requireSession|createServerSessionProjectionOwnerRegistry|issueSelection|createTypedProjectionBroker|preview|apply/u);
});
