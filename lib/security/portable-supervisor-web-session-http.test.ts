/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-session-http-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const { PortableSupervisorWebSessionV1Error } =
    await import('./portable-supervisor-web-session-controller.ts');
const { createPortableSupervisorWebSessionActivationHttpHandlerV1 } =
    await import('./portable-supervisor-web-session-http.ts');

const PATIENT = 'patient.synthetic.web-http.01';
const EPOCH = 23;
const EXPIRES_AT = 2_000_000_000_000;
type RouteContextFixture = Readonly<{ params: Promise<Readonly<{ id: string }>> }>;
const CONTEXT: RouteContextFixture = Object.freeze({
    params: Promise.resolve(Object.freeze({ id: PATIENT })),
});

function request(body: unknown = { selectionEpoch: EPOCH }): Request {
    return new Request(`http://127.0.0.1/api/patients/${PATIENT}/intelligent-host/activate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}

function subject(result: unknown = Object.freeze({ state: 'active', expiresAt: EXPIRES_AT }),
    authenticated: unknown = true) {
    let authReads = 0, calls = 0; let received: unknown;
    return Object.freeze({
        authReads: () => authReads, calls: () => calls, received: () => received,
        handler: createPortableSupervisorWebSessionActivationHttpHandlerV1({
            readAuthenticated: async () => { authReads += 1; return authenticated; },
            activate: async (input) => {
                calls += 1; received = input;
                if (result instanceof Error) throw result;
                return result as never;
            },
        }),
    });
}

async function failure(response: Response, status: number, code: string): Promise<void> {
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'Host intelligente non disponibile.', code });
}

after(() => rmSync(dataDir, { recursive: true, force: true }));

test('returns only active and a safe epoch-ms expiry without echoing patient authority', async () => {
    const current = subject();
    const response = await current.handler(request(), CONTEXT);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(Reflect.ownKeys(body), ['state', 'expiresAt']);
    assert.deepEqual(body, { state: 'active', expiresAt: EXPIRES_AT });
    assert.deepEqual(current.received(), { expectedPatientId: PATIENT, selectionEpoch: EPOCH });
    assert.equal(Object.isFrozen(current.received()), true);
    assert.equal(JSON.stringify(body).includes(PATIENT), false);
    assert.equal(JSON.stringify(body).includes('ref'), false);
});

test('authenticates before observing route params or request content', async () => {
    let observations = 0;
    const hostile = new Proxy({}, { get() { observations += 1; throw new Error(PATIENT); } });
    const current = subject(undefined, false);
    await failure(await current.handler(hostile as Request, hostile as never), 401, 'session_unavailable');
    assert.equal(current.authReads(), 1);
    assert.equal(current.calls(), 0);
    assert.equal(observations, 0);
});

test('accepts only the exact selectionEpoch body and a canonical path id', async () => {
    const current = subject();
    const accessor = {};
    Object.defineProperty(accessor, 'selectionEpoch', { enumerable: true, get() { return EPOCH; } });
    const prototype = Object.assign(Object.create({ inherited: true }), { selectionEpoch: EPOCH });
    const malformed = new Request('http://127.0.0.1', { method: 'POST', body: '{' });
    const cases: Array<readonly [Request, RouteContextFixture]> = [
        [request({}), CONTEXT], [request({ selectionEpoch: EPOCH, extra: true }), CONTEXT],
        [request({ selectionEpoch: 0 }), CONTEXT], [request({ selectionEpoch: 1.5 }), CONTEXT],
        [{ json: async () => accessor } as Request, CONTEXT],
        [{ json: async () => prototype } as Request, CONTEXT],
        [malformed, CONTEXT],
        [request(), Object.freeze({ params: Promise.resolve({ id: '../patient' }) })],
    ];
    for (const [candidate, context] of cases) {
        await failure(await current.handler(candidate, context), 400, 'input_invalid');
    }
    assert.equal(current.calls(), 0);
});

test('maps currentness and selection failures to 409 for explicit client resync', async () => {
    for (const code of ['selection_unavailable', 'selection_conflict'] as const) {
        const current = subject(new PortableSupervisorWebSessionV1Error(code));
        await failure(await current.handler(request(), CONTEXT), 409, code);
    }
});

test('maps an unsupervised or terminal host to a detail-free 503', async () => {
    for (const code of ['host_unavailable', 'session_terminal'] as const) {
        const current = subject(new PortableSupervisorWebSessionV1Error(code));
        await failure(await current.handler(request(), CONTEXT), 503, code);
    }
});

test('sanitizes malformed output and unexpected sensitive errors without logging or echoing', async () => {
    const originalError = console.error; const logged: unknown[][] = [];
    console.error = (...values: unknown[]) => { logged.push(values); };
    try {
        for (const result of [
            { state: 'active', expiresAt: EXPIRES_AT, patientId: PATIENT },
            { state: 'active', expiresAt: Number.MAX_SAFE_INTEGER + 1 },
            new Error(`${PATIENT}:parent.${'a'.repeat(64)}`),
        ]) {
            const response = await subject(result).handler(request(), CONTEXT);
            const text = await response.text();
            assert.equal(response.status, 503);
            assert.equal(response.headers.get('Cache-Control'), 'no-store');
            assert.equal(text.includes(PATIENT), false);
            assert.equal(text.includes('parent.'), false);
        }
        assert.deepEqual(logged, []);
    } finally { console.error = originalError; }
});

test('route is a thin dynamic Node adapter with no direct capture or database authority', () => {
    const route = readFileSync(new URL(
        '../../app/api/patients/[id]/intelligent-host/activate/route.ts', import.meta.url,
    ), 'utf8');
    assert.match(route, /runtime\s*=\s*'nodejs'|runtime\s*=\s*"nodejs"/u);
    assert.match(route, /dynamic\s*=\s*'force-dynamic'|dynamic\s*=\s*"force-dynamic"/u);
    assert.match(route, /readAuthenticatedWebSession/u);
    assert.match(route, /activatePortableSupervisorWebSessionV1/u);
    assert.doesNotMatch(route, /\bdb\b|database|capture|patientRef|sessionRef|parentRef|userRef|console\./iu);
});
