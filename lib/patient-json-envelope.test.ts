/* @Codex: WUL-720 synthetic SQLite and real patient PUT route envelope regression. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ambulatories, patients, patientsToAmbulatories } from './schema';
import { syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { clearAllSessions } from './security/server-session';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const oldToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'c05-synthetic-token';
type SyntheticAuthority = ReturnType<typeof syntheticNetworkPatientAuthority>;
const state = { web: true, v1: true, network: true, authority: null as SyntheticAuthority | null };
const stateKey = Symbol.for(`c05-auth-${dataDir}`);
(globalThis as unknown as Record<symbol, typeof state>)[stateKey] = state;

function shim(name: string, source: string) {
    const path = join(dataDir, name);
    writeFileSync(path, source, { mode: 0o600 });
    return pathToFileURL(path).href;
}
const auth = shim('auth.cjs', `const s=globalThis[Symbol.for(${JSON.stringify(`c05-auth-${dataDir}`)})];
exports.requireSession=async()=>s.web?({userId:'c05-user',role:'admin'}):null;
exports.requireLocalApiActorSession=async()=>({id:'local-api',userId:'local-api',role:'admin'});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});
exports.forbiddenResponse=()=>Response.json({error:'Forbidden'},{status:403});`);
const token = shim('token.cjs', `const s=globalThis[Symbol.for(${JSON.stringify(`c05-auth-${dataDir}`)})];
exports.requireLocalApiToken=()=>s.v1?null:Response.json({error:'Unauthorized'},{status:401});
exports.hasValidLocalApiToken=()=>s.v1;`);
const network = shim('network.cjs', `const s=globalThis[Symbol.for(${JSON.stringify(`c05-auth-${dataDir}`)})];
exports.authenticateNetworkPairedClient=async()=>s.network?s.authority?.pairedClient??null:null;
exports.getNetworkIdentitySummary=async()=>({scope:{effectiveAmbulatoryId:'c05-a'}});`);
const mode = shim('mode.cjs', `exports.getNetworkModeGateResponse=async()=>null;
const s=globalThis[Symbol.for(${JSON.stringify(`c05-auth-${dataDir}`)})];
exports.requireNetworkCapabilityContext=async(request)=>s.network&&s.authority?({ok:true,context:{request,scopeAmbulatoryId:'c05-a',pairedClient:s.authority.pairedClient,session:s.authority.session}}):({ok:false,response:Response.json({error:'Unauthorized'},{status:401})});`);
const paired = shim('paired.cjs', `const s=globalThis[Symbol.for(${JSON.stringify(`c05-auth-${dataDir}`)})];
exports.requireAccountSession=async()=>s.authority?.session??null;`);
const headers = shim('headers.cjs', `exports.cookies=async()=>({get:(name)=>name==='ambulatory_id'?{name,value:'c05-a'}:undefined});`);
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const replacements: Record<string, string> = {
    '@/lib/security/server-auth': auth,
    '@/lib/security/local-api-auth': token,
    '@/lib/network-home-base-server': network,
    '@/lib/network-write-context': mode,
    '@/lib/security/paired-native-session': paired,
    'next/headers': headers,
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    const url = replacements[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
} });

const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const web = load('../app/api/patients/[id]/route.ts') as typeof import('../app/api/patients/[id]/route.ts');
const v1 = load('../app/api/v1/patients/[id]/route.ts') as typeof import('../app/api/v1/patients/[id]/route.ts');
const native = load('../app/api/v1/network/patients/[id]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));

test.after(() => {
    clearAllSessions(); sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof state>)[stateKey];
    if (oldToken === undefined) delete process.env.MEDIFLOW_LOCAL_API_TOKEN;
    else process.env.MEDIFLOW_LOCAL_API_TOKEN = oldToken;
    rmSync(dataDir, { recursive: true, force: true });
});

function reset() {
    sql.exec('DROP TRIGGER IF EXISTS c05_audit_fail');
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values({ id: 'c05-a', name: 'Ambulatorio sintetico', type: 'live' }).run();
    state.authority = syntheticNetworkPatientAuthority(dbServer, 'c05-a', {
        clientId: 'c05-client', userId: 'c05-user', requestId: 'c05-synthetic-request',
    });
    dbServer.insert(patients).values({ id: 'c05-patient', firstName: 'Ada', lastName: 'Sintetica',
        taxCode: 'C05SYNTHETIC', ambulatoryId: 'c05-a', version: 3 }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'c05-patient', ambulatoryId: 'c05-a' }).run();
    state.web = true; state.v1 = true; state.network = true;
}

function snapshot() {
    const row = dbServer.select().from(patients).all()[0];
    return {
        firstName: row.firstName, version: row.version,
        memberships: dbServer.select().from(patientsToAmbulatories).all().map(x => x.ambulatoryId).sort(),
        audit: (sql.prepare("SELECT count(*) AS n FROM audit_events WHERE subject_ref='c05-patient'").get() as { n: number }).n,
    };
}

type Route = typeof web | typeof v1 | typeof native;
function requestFor(route: Route, body: string) {
    const networkHeaders = route === native && state.authority
        ? Object.fromEntries(state.authority.request.headers.entries()) : {};
    return new Request('http://127.0.0.1/api/patients/c05-patient', {
        method: 'PUT', headers: {
            ...networkHeaders,
            'content-type': 'application/json',
            'authorization': route === v1 ? 'Bearer c05-synthetic-token' : '',
            'x-request-id': 'c05-synthetic-request',
        }, body,
    });
}
async function put(route: Route, body: string | Request) {
    return route.PUT(typeof body === 'string' ? requestFor(route, body) : body,
        { params: Promise.resolve({ id: 'c05-patient' }) });
}

const rejected = [
    ['null', 'null'], ['array', '[]'], ['string', '"invalid"'], ['number', '42'],
    ['boolean', 'true'], ['malformed', '{"version":'], ['empty', ''],
] as const;

for (const [name, route] of [['web', web], ['v1', v1], ['network', native]] as const) {
    for (const [caseName, raw] of rejected) {
        test(`${name} rejects ${caseName} JSON envelope with 400 and no state/audit change`, async () => {
            reset();
            const before = snapshot();
            const response = await put(route, raw);
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: 'Richiesta non valida.' });
            assert.deepEqual(snapshot(), before);
        });
    }

    test(`${name} accepts valid object and required C04 audit`, async () => {
        reset();
        const before = snapshot();
        const response = await put(route, JSON.stringify({ version: 3, firstName: 'Bea', unknownCompatibilityField: 'ignored' }));
        assert.equal(response.status, 200);
        assert.deepEqual(snapshot(), { ...before, firstName: 'Bea', version: 4, audit: before.audit + 1 });
    });

    test(`${name} denies before reading a poisoned body`, async () => {
        reset();
        const before = snapshot();
        if (name === 'web') state.web = false;
        else if (name === 'v1') state.v1 = false;
        else state.network = false;
        const request = requestFor(route, '{"version":3,"firstName":"Poison"}');
        Object.defineProperty(request, 'json', { value: () => { throw new Error('poison-json-read'); } });
        Object.defineProperty(request, 'body', { get: () => { throw new Error('poison-stream-read'); } });
        const response = await put(route, request);
        assert.equal(response.status, 401);
        assert.deepEqual(snapshot(), before);
    });

    test(`${name} still treats an audit/database fault as 500 with rollback`, async () => {
        reset();
        const before = snapshot();
        sql.exec(`CREATE TRIGGER c05_audit_fail BEFORE INSERT ON audit_events
            BEGIN SELECT RAISE(FAIL, 'synthetic audit failure'); END`);
        const response = await put(route, JSON.stringify({ version: 3, firstName: 'Blocked' }));
        assert.equal(response.status, 500);
        assert.deepEqual(snapshot(), before);
    });
}

test('network JSON over its existing 4 MiB limit stays 413 before mutation', async () => {
    reset();
    const before = snapshot();
    const oversized = JSON.stringify({ version: 3, firstName: 'x'.repeat(4 * 1024 * 1024) });
    const response = await put(native, oversized);
    assert.equal(response.status, 413);
    assert.deepEqual(snapshot(), before);
});


const webCreate = load('../app/api/patients/route.ts');
const v1Create = load('../app/api/v1/patients/route.ts');
const nativeCreate = load('../app/api/v1/network/patients/route.ts');
const cap = 4_194_304;
const fullSnapshot = () => ({ patients: sql.prepare('SELECT * FROM patients ORDER BY id').all(),
    memberships: sql.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id').all(),
    audit: sql.prepare('SELECT * FROM audit_events ORDER BY event_id').all() });
for (const [name, item, collection] of [['web', web, webCreate], ['v1', v1, v1Create], ['network', native, nativeCreate]] as const) {
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
        const invoke = (request: Request) => {
            if (name === 'network' && state.authority) {
                for (const [key, value] of state.authority.request.headers) request.headers.set(key, value);
            }
            return method === 'POST' ? collection.POST(request)
                : item[method](request, { params: Promise.resolve({ id: 'c05-patient' }) });
        };
        if (method === 'POST') test(`${name} create identity adapter preserves opaque IDs and generates only for omission`, async () => {
            reset();
            const body = { firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SYNTH-IDENTITY' };
            const invokeBody = (value: Record<string, unknown>) => invoke(new Request('http://localhost/api/patients', { method, body: JSON.stringify(value) }));
            const before = fullSnapshot();
            assert.equal((await invokeBody({ ...body, id: 42 })).status, 400);
            assert.deepEqual(fullSnapshot(), before);
            const id = ' opaque patient / 42 ';
            const created = await invokeBody({ ...body, id });
            assert.equal(created.status, 201);
            assert.equal((await created.json()).id, id);
            const omitted = await invokeBody(body);
            assert.equal(omitted.status, 201);
            const generated = (await omitted.json()).id;
            assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
            assert(sql.prepare('SELECT id FROM patients WHERE id=?').get(generated));
        });
        test(`${name} ${method} admission precedes poisoned body access`, async () => {
            reset(); const before = fullSnapshot(); state[name === 'network' ? 'network' : name] = false;
            const request = new Request('http://localhost/api/patients', { method, body:'{}' });
            Object.defineProperty(request, 'body', { get() { throw new Error('poison-stream-read'); } });
            assert.equal((await invoke(request)).status, 401); assert.deepEqual(fullSnapshot(), before);
        });
        test(`${name} ${method} failed stream is bounded 400 with zero effects`, async () => {
            reset(); const before = fullSnapshot();
            const body = new ReadableStream<Uint8Array>({ start(c) { c.error(new TypeError('synthetic-stream-failure')); } });
            const response = await invoke(new Request('http://localhost/api/patients', { method, body, duplex:'half' } as RequestInit));
            assert.equal(response.status, 400); assert.deepEqual(fullSnapshot(), before);
        });
        test(`${name} ${method} pre-aborted body has zero effects`, async () => {
            reset(); const before = fullSnapshot(); const controller = new AbortController(); controller.abort();
            const response = await invoke(new Request('http://localhost/api/patients', { method, body:'{}', signal:controller.signal }));
            assert.equal(response.status, 400); assert.deepEqual(fullSnapshot(), before);
        });
        for (const raw of ['null', '[]', '{', '"scalar"', '']) test(`${name} ${method} malformed denied without effects: ${raw}`, async () => {
            reset(); const before = fullSnapshot();
            const response = await invoke(new Request('http://localhost/api/patients', { method, body: raw }));
            assert.equal(response.status, 400); assert.deepEqual(fullSnapshot(), before);
        });
        for (const declared of [undefined, '1', 'nonsense', String(cap+1)]) test(`${name} ${method} chunked oversize (${declared}) has zero effects`, async () => {
            reset(); const before = fullSnapshot(); let cancelled = false;
            const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(' '.repeat(cap))); c.enqueue(new Uint8Array([32])); }, cancel() { cancelled = true; } });
            const response = await invoke(new Request('http://localhost/api/patients', { method, body,
                headers: declared === undefined ? {} : { 'content-length': declared }, duplex: 'half' } as RequestInit));
            assert.equal(response.status, 413); assert.equal(cancelled, true);
            assert.deepEqual(await response.json(), { error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' });
            assert.deepEqual(fullSnapshot(), before);
        });
        test(`${name} ${method} abort cancels pending read without effects`, async () => {
            reset(); const before = fullSnapshot(); const controller = new AbortController(); let cancelled = false;
            const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
            const request = new Request('http://localhost/api/patients', { method, body, signal: controller.signal, duplex: 'half' } as RequestInit);
            const signal = request.signal;
            const pending = invoke(request);
            setTimeout(() => { controller.abort(); assert.equal(signal.aborted, true); }, 10);
            assert.equal((await pending).status, 400); assert.equal(cancelled, true); assert.deepEqual(fullSnapshot(), before);
        });
        for (const size of [cap-1, cap]) test(`${name} ${method} accepts ${size} bytes and preserves sealed values`, async () => {
            reset();
            const value = method === 'POST' ? { id:'c05-created', firstName:'Ada', lastName:'Sintetica', taxCode:'SYNTHETIC-CREATE', notes:'ENC:iv:ciphertext' }
                : method === 'PUT' ? { version:3, notes:'ENC:iv:ciphertext' } : {version:3, deletionReason:'ENC:iv:reason'};
            const json = JSON.stringify(value); const raw = json + ' '.repeat(size - new TextEncoder().encode(json).byteLength);
            const response = await invoke(new Request('http://localhost/api/patients', { method, body:raw }));
            assert.equal(response.status, method === 'POST' ? 201 : 200);
            const row = sql.prepare('SELECT * FROM patients WHERE id=?').get(method === 'POST' ? 'c05-created' : 'c05-patient') as Record<string,unknown>;
            assert.equal(row[method === 'DELETE' ? 'deletion_reason' : 'notes'], method === 'DELETE' ? 'ENC:iv:reason' : 'ENC:iv:ciphertext');
        });
    }
}
