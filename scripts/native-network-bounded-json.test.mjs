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
        assert.ok([`app/api/${route}/route.ts`, 'lib/native-network-json-body.ts', 'lib/bounded-request-body.ts', 'lib/attachment-payload.ts', 'lib/patient-json-object.ts',
            'lib/entry-write-input.ts', 'lib/therapy-write-input.ts', 'lib/api-v1-clinical-write-normalization.ts', 'lib/status-normalization.ts'].includes(relative), `unexpected production import ${relative}`);
        const source = fs.readFileSync(path.join(root, relative), 'utf8');
        const exports = {};
        cache.set(relative, exports);
        const output = ts.transpileModule(source, { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        function require(name) {
            if (name === './bounded-request-body') {
                const actual = load('lib/bounded-request-body.ts');
                return { ...actual, readBoundedJsonBody: (request, budget, ...rest) => {
                    events.push('parse'); budgets.push(budget);
                    return actual.readBoundedJsonBody(request, cap ?? budget, ...rest);
                } };
            }
            if (name === '@/lib/native-network-json-body') {
                return load('lib/native-network-json-body.ts');
            }
            if (name === '@/lib/patient-json-object') {
                return load('lib/patient-json-object.ts');
            }
            // @Codex: exercise the actual diary object check, not the fallback dependency stub.
            if (name === '@/lib/entry-write-input') {
                return load('lib/entry-write-input.ts');
            }
            // @Codex: preserve the real therapy envelope check when exercising admitted network bodies.
            if (name === '@/lib/therapy-write-input') {
                return load('lib/therapy-write-input.ts');
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
        signal: new AbortController().signal,
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
                const expectedCap = route === 'auth/native/login' || bootstrap ? 65_536 : route.endsWith('/attachments') ? 30_408_704 : 4_194_304;
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

function boundedReaderInventory(source, filename) {
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const named = (node, name) => ts.isIdentifier(node) && node.text === name;
    const callNamed = (node, name) => ts.isCallExpression(node) && named(node.expression, name);
    const boundedAwait = (node) => callNamed(node, 'readNativeNetworkJson') || callNamed(node, 'withNetworkAttachmentJson')
        || (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && node.expression.name.text === 'catch' && callNamed(node.expression.expression, 'readNativeNetworkJson')
            && node.arguments.length === 1 && named(node.arguments[0], 'emptyJsonUnlessTooLarge'));
    let readers = 0;
    let wrappers = 0;
    function visit(node) {
        if (ts.isCallExpression(node)) {
            const target = node.expression;
            const method = ts.isPropertyAccessExpression(target) && named(target.expression, 'request') ? target.name.text
                : ts.isElementAccessExpression(target) && named(target.expression, 'request') && ts.isStringLiteral(target.argumentExpression) ? target.argumentExpression.text
                    : null;
            assert.ok(!['json', 'text', 'arrayBuffer', 'blob'].includes(method), `${filename}: unbounded request body reader`);
        }
        if (ts.isAwaitExpression(node)) {
            const expression = node.expression;
            if (boundedAwait(expression)) readers++;
            if (callNamed(expression, 'parsePatientJsonObject')) {
                const reader = expression.arguments[0];
                assert.ok(expression.arguments.length === 1 && ts.isArrowFunction(reader) && reader.parameters.length === 0
                    && callNamed(reader.body, 'readNativeNetworkJson') && reader.body.arguments.length === 1
                    && named(reader.body.arguments[0], 'request'), `${filename}: patient JSON wrapper must pass through the bounded reader`);
                readers++;
                wrappers++;
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(file);
    if (wrappers) {
        assert.match(source, /import\s*\{\s*parsePatientJsonObject\s*\}\s*from\s*['"]@\/lib\/patient-json-object['"]/u);
        const helper = fs.readFileSync(path.join(root, 'lib/patient-json-object.ts'), 'utf8');
        assert.match(helper, /export async function parsePatientJsonObject\(read\s*:/u);
        assert.match(helper, /value\s*=\s*await read\(\)/u);
        assert.doesNotMatch(helper, /request\s*(?:\.\s*(?:json|text|arrayBuffer|blob)|\[\s*['"](?:json|text|arrayBuffer|blob)['"]\s*\])\s*\(/u);
    }
    return readers;
}

test('JSON route inventory stays bounded and has no alternate unbounded body reader', () => {
    const network = fs.readdirSync(path.join(root, 'app/api/v1/network'), { recursive: true }).filter(p => p.endsWith('route.ts'));
    const inventory = new Set(operations.map(([route]) => route));
    let readers = 0;
    for (const relative of network) {
        const source = fs.readFileSync(path.join(root, 'app/api/v1/network', relative), 'utf8');
        const count = boundedReaderInventory(source, relative);
        if (count) {
            assert.ok(inventory.has(`v1/network/${relative.replace(/\/route\.ts$/, '')}`));
            readers += count;
        }
    }
    assert.equal(readers, operations.reduce((sum, [, ...methods]) => sum + methods.length, 0) - 1);
});

test('patient JSON wrapper inventory rejects hidden alternate request readers', () => {
    const prefix = "import { parsePatientJsonObject } from '@/lib/patient-json-object';\n";
    assert.equal(boundedReaderInventory(`${prefix}async function PUT(request) { return await parsePatientJsonObject(() => readNativeNetworkJson(request)); }`, 'valid.ts'), 1);
    for (const reader of ['request.json()', "request['json']()", 'readNativeNetworkJson(request) || request.json()']) {
        assert.throws(() => boundedReaderInventory(`${prefix}async function PUT(request) { return await parsePatientJsonObject(() => ${reader}); }`, 'unbounded.ts'));
    }
});
