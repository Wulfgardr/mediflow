/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AuthenticatedWebSessionSelectionError } from './server-session-authenticated-selection.ts';
import {
    createSmartImportSelectionEpochHttpHandler,
    createSmartImportSelectionHttpHandler,
} from './server-session-smart-import-selection-http.ts';
import { ServerSessionProjectionOwnerError } from './server-session-projection-owner.ts';

const REQUEST = { expectedEpoch: 0, patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };
const LEASE = Object.freeze({ sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1,
    patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`,
    leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: 123_456 });

function request(body: unknown = REQUEST) {
    return new Request('http://127.0.0.1/api/ai/smart-import/selection', { method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1',
            'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
}
function requestValue(value: unknown) {
    return { url: 'http://127.0.0.1/api/ai/smart-import/selection',
        headers: new Headers({ 'content-type': 'application/json', origin: 'http://127.0.0.1',
            'sec-fetch-site': 'same-origin' }), json: async () => value } as Request;
}
function rejects(status: number, code: string) {
    return async (response: Response) => {
        assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await response.json(), { error: 'Selezione Smart Import non disponibile.', code });
    };
}
function postHandler(issueSelection: (input: unknown) => Promise<typeof LEASE>) {
    return createSmartImportSelectionHttpHandler({
        acquireSelection: async () => Object.freeze({ issueSelection }),
    });
}

test('emits the complete opaque selection lease with no-store through one composition call', async () => {
    let calls = 0; let received: unknown;
    const handle = postHandler(async (input) => {
        calls += 1; received = input; return LEASE;
    });

    const response = await handle(request()); const body = await response.json();

    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(body, { selection: LEASE }); assert.deepEqual(received, REQUEST); assert.equal(calls, 1);
    assert.equal(JSON.stringify(body).includes(REQUEST.patientId), false);
    assert.equal(JSON.stringify(body).includes(REQUEST.ambulatoryId), false);
});

test('fails closed for malformed, extra, prototype, and accessor JSON bodies without calling composition', async () => {
    let calls = 0;
    const handle = postHandler(async () => { calls += 1; return LEASE; });
    const accessor = { expectedEpoch: 0, patientId: REQUEST.patientId };
    Object.defineProperty(accessor, 'ambulatoryId', { enumerable: true, get() { return REQUEST.ambulatoryId; } });
    const prototype = Object.assign(Object.create({ inherited: true }), REQUEST);
    const malformed = new Request('http://127.0.0.1', { method: 'POST', headers: {
        'content-type': 'application/json', origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin',
    }, body: '{' });
    for (const value of [malformed, request({ ...REQUEST, extra: true }), requestValue(accessor),
        requestValue(prototype)]) {
        const response = await handle(value); await rejects(400, 'input_invalid')(response);
    }
    assert.equal(calls, 0);
});

test('rejects cross-port and text/plain transport before issuing a selection', async () => {
    let acquisitions = 0; let selectionCalls = 0;
    const handle = createSmartImportSelectionHttpHandler({
        acquireSelection: async () => {
            acquisitions += 1;
            return Object.freeze({ issueSelection: async () => { selectionCalls += 1; return LEASE; } });
        },
    });
    for (const headers of [
        { origin: 'http://127.0.0.1:4000', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
        { origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
    ]) {
        const denied = new Request('http://127.0.0.1/api/ai/smart-import/selection', {
            method: 'POST', headers, body: JSON.stringify(REQUEST),
        });
        await rejects(403, 'request_transport_invalid')(await handle(denied));
    }
    assert.equal(acquisitions, 2);
    assert.equal(selectionCalls, 0);
});

test('authenticates before observing a hostile selection request', async () => {
    let reads = 0;
    const hostile = new Proxy({}, {
        get() {
            reads += 1;
            throw new Error('hostile request observed');
        },
    }) as Request;
    const handle = createSmartImportSelectionHttpHandler({
        acquireSelection: async () => {
            throw new AuthenticatedWebSessionSelectionError('session_unavailable');
        },
    });

    await rejects(401, 'session_unavailable')(await handle(hostile));
    assert.equal(reads, 0);
});

test('maps every specified typed selection error to its stable HTTP status', async () => {
    const cases: readonly [string, number][] = [
        ['input_invalid', 400], ['session_unavailable', 401], ['session_ineligible', 401], ['epoch_conflict', 409],
        ['selection_busy', 409], ['selection_unavailable', 409], ['stale_selection', 409], ['owner_disposed', 409],
        ['owner_acquiring', 409], ['owner_exists', 409], ['lease_expired', 410], ['reference_unavailable', 503],
    ];
    for (const [code, status] of cases) {
        const handle = postHandler(async () => {
            throw code === 'session_unavailable' ? new AuthenticatedWebSessionSelectionError('session_unavailable')
                : new ServerSessionProjectionOwnerError(code as never);
        });
        await rejects(status, code)(await handle(request()));
    }
});

test('sanitizes unexpected and impossible owner errors without input or raw detail', async () => {
    const originalError = console.error;
    console.error = () => undefined;
    try {
        for (const error of [new ServerSessionProjectionOwnerError('broker_factory_failed'), new Error('synthetic raw database path')]) {
            const handle = postHandler(async () => { throw error; });
            const response = await handle(request()); const body = await response.json();
            assert.equal(response.status, 500); assert.equal(response.headers.get('Cache-Control'), 'no-store');
            assert.deepEqual(body, { error: 'Errore interno del server.', code: 'internal_error' });
            assert.equal(JSON.stringify(body).includes('synthetic raw'), false);
            assert.equal(JSON.stringify(body).includes(REQUEST.patientId), false);
        }
    } finally { console.error = originalError; }
});

test('returns only the current epoch with no-store through one read-only composition call', async () => {
    let calls = 0;
    const handle = createSmartImportSelectionEpochHttpHandler({ readEpoch: async () => { calls += 1; return 4; } });
    const response = await handle();

    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { selectionEpoch: 4 }); assert.equal(calls, 1);
});

test('maps session errors and sanitizes invalid epoch or internal faults without disclosing conflicts', async () => {
    const originalError = console.error; const entries: unknown[][] = []; console.error = (...values: unknown[]) => { entries.push(values); };
    try {
        for (const error of [new AuthenticatedWebSessionSelectionError('session_unavailable'), new ServerSessionProjectionOwnerError('session_ineligible')]) {
            const response = await createSmartImportSelectionEpochHttpHandler({ readEpoch: async () => { throw error; } })();
            await rejects(401, 'session_unavailable')(response);
        }
        for (const source of [async () => -1, async () => { throw new Error('synthetic raw selection conflict'); }]) {
            const response = await createSmartImportSelectionEpochHttpHandler({ readEpoch: source })(); const body = await response.json();
            assert.equal(response.status, 500); assert.equal(response.headers.get('Cache-Control'), 'no-store');
            assert.deepEqual(body, { error: 'Errore interno del server.', code: 'internal_error' });
            assert.equal(JSON.stringify(body).includes('selectionEpoch'), false);
            assert.equal(JSON.stringify(body).includes('synthetic raw'), false);
        }
        assert.equal(entries.length, 2);
    } finally { console.error = originalError; }
});

test('route keeps POST unchanged and wires GET only to the epoch composition with a dynamic Node runtime', () => {
    const source = readFileSync(new URL('../../app/api/ai/smart-import/selection/route.ts', import.meta.url), 'utf8');
    const epochProduction = readFileSync(new URL('./server-session-authenticated-selection-epoch-production.ts', import.meta.url), 'utf8');
    assert.match(source, /runtime\s*=\s*'nodejs'|runtime\s*=\s*"nodejs"/u);
    assert.match(source, /dynamic\s*=\s*'force-dynamic'|dynamic\s*=\s*"force-dynamic"/u);
    assert.match(source, /acquireAuthenticatedWebSessionSelection/u);
    assert.match(source, /readAuthenticatedWebSessionSelectionEpoch/u);
    assert.match(source, /export const GET = createSmartImportSelectionEpochHttpHandler/u);
    assert.match(epochProduction, /readAuthenticatedWebSession()[\s\S]*snapshotSelectionEpoch\(session\)/u);
    assert.doesNotMatch(epochProduction, /\.acquire\(|issueSelection|patient|ambulatory|lease|expiresAt|Ref/u);
    assert.doesNotMatch(source, /requireSession|createServerSessionProjectionOwnerRegistry|resolveProjectionService|(?:ingest|preview|apply)/u);
});
