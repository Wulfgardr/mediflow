/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
// Fixed inventory: removal of a reader must not silently remove a regression case.
const operations = [
    ['auth/native/login', 'POST'],
    ['v1/network/pairing-intents', 'POST'],
    ['v1/network/patients', 'POST'],
    ['v1/network/patients/[id]', 'PUT', 'DELETE'],
    ['v1/network/patients/[id]/restore', 'POST'],
    ['v1/network/patients/[id]/attachments', 'POST'],
    ['v1/network/ambulatories', 'POST'],
    ['v1/network/ambulatories/[id]', 'PUT', 'DELETE'],
    ['v1/network/ambulatories/clear', 'POST'],
    ['v1/network/fse/validate-document', 'POST'],
    ['v1/network/visit-draft', 'POST'],
    ...['entries', 'therapies', 'checkups', 'observations'].flatMap(kind => [
        [`v1/network/patients/[id]/${kind}`, 'POST'],
        [`v1/network/patients/[id]/${kind}/[${({ entries: 'entry', therapies: 'therapy', checkups: 'checkup', observations: 'observation' })[kind]}Id]`, 'PUT'],
    ]),
    ...['service-prescriptions', 'service-prescription-items', 'prosthetic-prescriptions'].flatMap(kind => [
        [`v1/network/${kind}`, 'POST'], [`v1/network/${kind}/[id]`, 'PUT'],
    ]),
];

function harness(route, { deny = 0, cap, stage = null } = {}) {
    const events = [], calls = [], budgets = [];
    const cache = new Map();
    const denied = () => Response.json({ error: 'synthetic denied' }, { status: deny || 403 });
    const context = { scopeAmbulatoryId: 'synthetic-scope', session: { userId: 'synthetic-user' } };
    const auth = async () => {
        events.push('auth');
        return deny ? { ok: false, response: denied() } : { ok: true, context };
    };
    const stubs = {
        NextResponse: Response,
        requireNetworkWriteContext: auth,
        requireNetworkCapabilityContext: auth,
        admitNativeBootstrapRouteRequest: async () => { events.push('auth'); return deny ? null : {}; },
        nativeLoginDeniedResponse: denied,
        unauthorizedResponse: denied,
        forbiddenResponse: denied,
        authenticateNetworkPairedClient: async () => {
            events.push('auth');
            return deny ? null : { grantedCapabilities: stage === 'capability' ? [] : ['NETWORK_PATIENT_WRITE_CAPABILITY'] };
        },
        getNetworkModeGateResponse: async () => { events.push('mode'); return stage === 'mode' ? denied() : null; },
        requireAccountSession: async () => { events.push('session'); return stage === 'session' ? null : context.session; },
        cookies: async () => ({ get: () => undefined }),
        getNetworkIdentitySummary: async () => {
            events.push('scope');
            return { scope: { effectiveAmbulatoryId: stage === 'scope' ? null : context.scopeAmbulatoryId } };
        },
        nativeLoginHttp: async (...args) => {
            events.push('service'); calls.push(args);
            return Response.json({ ok: true });
        },
    };
    const services = new Set([
        'postNetworkPairingIntent', 'createNetworkScopedPatient', 'updateNetworkScopedPatient', 'deleteNetworkScopedPatient',
        'restoreNetworkScopedPatient', 'createNetworkScopedAttachment', 'createNetworkAmbulatory', 'updateNetworkAmbulatory',
        'deleteNetworkAmbulatory', 'clearNetworkAmbulatory', 'validateFseDocumentPayload', 'createVisitDraft',
        ...['Entry', 'Therapy', 'Checkup', 'Observation', 'ServicePrescription', 'ServicePrescriptionItem', 'ProstheticPrescription']
            .flatMap(name => [`createNetworkScoped${name}`, `updateNetworkScoped${name}`]),
    ]);
    function load(relative) {
        if (cache.has(relative)) return cache.get(relative);
        assert.ok([`app/api/${route}/route.ts`, 'lib/native-network-json-body.ts', 'lib/bounded-request-body.ts', 'lib/attachment-payload.ts'].includes(relative), `unexpected production import ${relative}`);
        const source = fs.readFileSync(path.join(root, relative), 'utf8');
        const exports = {};
        cache.set(relative, exports);
        const output = ts.transpileModule(source, { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        function require(name) {
            if (name === '@/lib/native-network-json-body') {
                const actual = load('lib/native-network-json-body.ts');
                return { ...actual, readNativeNetworkJson: (request, budget) => {
                    events.push('parse'); budgets.push(budget ?? actual.NETWORK_JSON_MAX_BYTES);
                    return actual.readNativeNetworkJson(request, cap ?? budget);
                } };
            }
            if (relative.startsWith('lib/') && name.startsWith('./')) return load(`lib/${name.slice(2)}.ts`);
            return new Proxy({}, { get(_target, key) {
                if (key in stubs) return stubs[key];
                if (/^[A-Z][A-Z_]+$/.test(key)) return key;
                if (services.has(key)) return async (...args) => {
                    events.push('service'); calls.push(args);
                    return { status: 200, ok: true, value: { ok: true } };
                };
                return () => { throw new Error(`Unexpected dependency: ${name}:${String(key)}`); };
            } });
        }
        new Function('require', 'exports', output)(require, exports);
        return exports;
    }
    return { route: load(`app/api/${route}/route.ts`), events, calls, budgets };
}

function request(h, text = '{}', headers = {}) {
    const bytes = new TextEncoder().encode(text);
    let offset = 0, pulls = 0, cancels = 0;
    const body = new ReadableStream({
        pull(c) {
            pulls++;
            if (offset === bytes.length) return c.close();
            c.enqueue(bytes.slice(offset, offset += Math.min(4, bytes.length - offset)));
        },
        cancel() { cancels++; },
    }, { highWaterMark: 0 });
    // Observe even header access: denied routes must never enter the reader.
    const req = {
        url: 'http://127.0.0.1/?patientId=synthetic-patient',
        get headers() { h.events.push('headers'); return new Headers(headers); },
        get body() { h.events.push('body'); return body; },
        json() { assert.fail('unbounded request.json must never run'); },
    };
    return { req, counts: () => ({ pulls, cancels }), body };
}
const ctx = { params: Promise.resolve({ id: 'synthetic-patient', entryId: 'synthetic-entry', therapyId: 'synthetic-therapy', checkupId: 'synthetic-checkup', observationId: 'synthetic-observation' }) };

for (const [route, ...methods] of operations) {
    for (const method of methods) {
        const bootstrap = route === 'v1/network/pairing-intents';
        test(`${method} ${route}: admission precedes body; bounded 413 and valid payload`, async () => {
            if (!bootstrap) {
                for (const deny of [401, 403]) {
                    const h = harness(route, { deny });
                    const f = request(h, '{}', { 'content-length': '999999999' });
                    assert.equal((await h.route[method](f.req, ctx)).status, deny);
                    assert.deepEqual(h.events, ['auth']);
                    assert.deepEqual(f.counts(), { pulls: 0, cancels: 0 });
                }
            }
            for (const mode of ['declared', 'chunked', 'lying-length']) {
                const h = harness(route, { cap: 8 });
                const headers = mode === 'declared' ? { 'content-length': '9' } : mode === 'lying-length' ? { 'content-length': '0' } : { 'transfer-encoding': 'chunked' };
                const f = request(h, '{"note":"è"}', headers);
                const response = await h.route[method](f.req, ctx);
                assert.equal(response.status, 413);
                assert.deepEqual(await response.json(), { error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' });
                assert.equal(h.calls.length, 0);
                assert.equal(h.events.includes('service'), false);
                if (!bootstrap) assert.ok(h.events.indexOf('auth') < h.events.indexOf('parse'));
                assert.deepEqual(f.counts(), { pulls: mode === 'declared' ? 0 : 3, cancels: 1 });
                assert.equal(f.body.locked, false);
                const expectedCap = route === 'auth/native/login' || bootstrap ? 65_536 : route.endsWith('/attachments') ? 161_480_704 : 4_194_304;
                assert.deepEqual(h.budgets, [expectedCap]);
            }
            const h = harness(route);
            const payload = route === 'auth/native/login' ? { username: ' synthetic ', password: 'synthetic-pin' }
                : { version: 2, notes: 'è 🩺 ENC:aQ==:ZGF0YQ==', ambulatoryId: 'synthetic-scope',
                    ...(route === 'v1/network/visit-draft' ? { transcript: 'Nota sintetica' } : { patientId: 'synthetic-patient' }) };
            const f = request(h, JSON.stringify(payload));
            const response = await h.route[method](f.req, ctx);
            assert.equal(response.status, 200);
            assert.equal(h.calls.length, 1);
            assert.ok(h.events.indexOf('parse') < h.events.indexOf('service'));
            const delivered = h.calls[0].at(-1);
            if (route === 'auth/native/login') assert.deepEqual(delivered, { username: 'synthetic', password: 'synthetic-pin' });
            else assert.deepEqual(delivered, payload);
        });
    }
}

test('patient PUT checks mode, capability, account session and scope before reading', async () => {
    for (const stage of ['mode', 'capability', 'session', 'scope']) {
        const h = harness('v1/network/patients/[id]', { stage });
        const f = request(h, '{}', { 'content-length': '999999999' });
        assert.equal((await h.route.PUT(f.req, ctx)).status, 403);
        assert.equal(h.events.includes('parse'), false);
        assert.equal(h.events.includes('headers'), false);
        assert.equal(h.calls.length, 0);
        assert.equal(f.counts().pulls, 0);
    }
});

test('malformed login and ambulatory DELETE keep existing fallback, not size rejection', async () => {
    for (const [route, method] of [['auth/native/login', 'POST'], ['v1/network/ambulatories/[id]', 'DELETE']]) {
        for (const body of ['', '{']) {
            const h = harness(route);
            const response = await h.route[method](request(h, body).req, ctx);
            assert.equal(response.status, 200);
            assert.equal(h.calls.length, 1);
            assert.equal(Object.keys(h.calls[0].at(-1)).length, 0);
        }
    }
});

test('JSON route inventory stays bounded and has no alternate unbounded body reader', () => {
    const network = fs.readdirSync(path.join(root, 'app/api/v1/network'), { recursive: true }).filter(p => p.endsWith('route.ts'));
    const inventory = new Set(operations.map(([route]) => route));
    let readers = 0;
    for (const relative of network) {
        const source = fs.readFileSync(path.join(root, 'app/api/v1/network', relative), 'utf8');
        assert.doesNotMatch(source, /request\.(?:json|text|arrayBuffer|blob)\s*\(/);
        if (source.includes('await readNativeNetworkJson(')) {
            assert.ok(inventory.has(`v1/network/${relative.replace(/\/route\.ts$/, '')}`));
            readers += (source.match(/await readNativeNetworkJson\(/g) ?? []).length;
        }
    }
    assert.equal(readers, operations.reduce((sum, [, ...methods]) => sum + methods.length, 0) - 1);
});
