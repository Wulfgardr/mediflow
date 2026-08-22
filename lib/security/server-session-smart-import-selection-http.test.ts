/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AuthenticatedWebSessionSelectionError } from './server-session-authenticated-selection.ts';
import {
    createSmartImportSelectionHttpHandler,
} from './server-session-smart-import-selection-http.ts';
import { ServerSessionProjectionOwnerError } from './server-session-projection-owner.ts';

const REQUEST = { expectedEpoch: 0, patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };
const LEASE = Object.freeze({ sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1,
    patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`,
    leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: 123_456 });

function request(body: unknown = REQUEST) {
    return new Request('http://127.0.0.1/api/ai/smart-import/selection', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function rejects(status: number, code: string) {
    return async (response: Response) => {
        assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await response.json(), { error: 'Selezione Smart Import non disponibile.', code });
    };
}

test('emits the complete opaque selection lease with no-store through one composition call', async () => {
    let calls = 0; let received: unknown;
    const handle = createSmartImportSelectionHttpHandler({ issueSelection: async (input) => {
        calls += 1; received = input; return LEASE;
    } });

    const response = await handle(request()); const body = await response.json();

    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(body, { selection: LEASE }); assert.deepEqual(received, REQUEST); assert.equal(calls, 1);
    assert.equal(JSON.stringify(body).includes(REQUEST.patientId), false);
    assert.equal(JSON.stringify(body).includes(REQUEST.ambulatoryId), false);
});

test('fails closed for malformed, extra, prototype, and accessor JSON bodies without calling composition', async () => {
    let calls = 0;
    const handle = createSmartImportSelectionHttpHandler({ issueSelection: async () => { calls += 1; return LEASE; } });
    const accessor = { expectedEpoch: 0, patientId: REQUEST.patientId };
    Object.defineProperty(accessor, 'ambulatoryId', { enumerable: true, get() { return REQUEST.ambulatoryId; } });
    const prototype = Object.assign(Object.create({ inherited: true }), REQUEST);
    const malformed = new Request('http://127.0.0.1', { method: 'POST', body: '{' });
    for (const value of [malformed, request({ ...REQUEST, extra: true }), { json: async () => accessor } as Request,
        { json: async () => prototype } as Request]) {
        const response = await handle(value); await rejects(400, 'input_invalid')(response);
    }
    assert.equal(calls, 0);
});

test('maps every specified typed selection error to its stable HTTP status', async () => {
    const cases: readonly [string, number][] = [
        ['input_invalid', 400], ['session_unavailable', 401], ['session_ineligible', 401], ['epoch_conflict', 409],
        ['selection_busy', 409], ['selection_unavailable', 409], ['stale_selection', 409], ['owner_disposed', 409],
        ['owner_acquiring', 409], ['owner_exists', 409], ['lease_expired', 410], ['reference_unavailable', 503],
    ];
    for (const [code, status] of cases) {
        const handle = createSmartImportSelectionHttpHandler({ issueSelection: async () => {
            throw code === 'session_unavailable' ? new AuthenticatedWebSessionSelectionError('session_unavailable')
                : new ServerSessionProjectionOwnerError(code as never);
        } });
        await rejects(status, code)(await handle(request()));
    }
});

test('sanitizes unexpected and impossible owner errors without input or raw detail', async () => {
    const originalError = console.error;
    console.error = () => undefined;
    try {
        for (const error of [new ServerSessionProjectionOwnerError('broker_factory_failed'), new Error('synthetic raw database path')]) {
            const handle = createSmartImportSelectionHttpHandler({ issueSelection: async () => { throw error; } });
            const response = await handle(request()); const body = await response.json();
            assert.equal(response.status, 500); assert.equal(response.headers.get('Cache-Control'), 'no-store');
            assert.deepEqual(body, { error: 'Errore interno del server.', code: 'internal_error' });
            assert.equal(JSON.stringify(body).includes('synthetic raw'), false);
            assert.equal(JSON.stringify(body).includes(REQUEST.patientId), false);
        }
    } finally { console.error = originalError; }
});

test('route delegates only to production selection composition with a dynamic Node runtime', () => {
    const source = readFileSync(new URL('../../app/api/ai/smart-import/selection/route.ts', import.meta.url), 'utf8');
    assert.match(source, /runtime\s*=\s*'nodejs'|runtime\s*=\s*"nodejs"/u);
    assert.match(source, /dynamic\s*=\s*'force-dynamic'|dynamic\s*=\s*"force-dynamic"/u);
    assert.match(source, /issueAuthenticatedWebSessionSelection/u);
    assert.doesNotMatch(source, /requireSession|createServerSessionProjectionOwnerRegistry|resolveProjectionService|(?:ingest|preview|apply)/u);
});
