import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { LOCAL_CHECKUP_JSON_MAX_BYTES as CAP, readCheckupJsonObject } from './checkup-json-body';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mf-checkup-envelope-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'synthetic-checkup-token';
const state = { web: true, v1: true, events: [] as string[] };
const stateKey = `checkup-envelope-${dataDir}`;
(globalThis as unknown as Record<symbol, typeof state>)[Symbol.for(stateKey)] = state;
function seam(name: string, source: string) {
    const path = join(dataDir, name);
    writeFileSync(path, `const s=globalThis[Symbol.for(${JSON.stringify(stateKey)})];\n${source}`, { mode: 0o600 });
    return pathToFileURL(path).href;
}
const auth = seam('auth.cjs', `exports.requireSession=async()=>{s.events.push('session');return s.web?{id:'synthetic-web',userId:'synthetic-admin',role:'admin',authChannel:'web'}:null;};
exports.requireLocalApiActorSession=async()=>{s.events.push('actor');return {id:'synthetic-local',userId:'synthetic-local',role:'admin',authChannel:'system'};};
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});`);
const token = seam('token.cjs', `exports.requireLocalApiToken=()=>{s.events.push('token');return s.v1?null:Response.json({error:'Unauthorized'},{status:401});};
exports.hasValidLocalApiToken=()=>s.v1;`);
const replacements: Record<string, string> = { '@/lib/security/server-auth': auth, '@/lib/security/local-api-auth': token };
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    const url = replacements[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
} });
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { ambulatories, patients, patientsToAmbulatories, checkups } = load('./schema.ts') as typeof import('./schema.ts');
const webCreate = load('../app/api/checkups/route.ts') as typeof import('../app/api/checkups/route.ts');
const webItem = load('../app/api/checkups/[id]/route.ts') as typeof import('../app/api/checkups/[id]/route.ts');
const v1Create = load('../app/api/v1/patients/[id]/checkups/route.ts') as typeof import('../app/api/v1/patients/[id]/checkups/route.ts');
const v1Item = load('../app/api/v1/patients/[id]/checkups/[checkupId]/route.ts') as typeof import('../app/api/v1/patients/[id]/checkups/[checkupId]/route.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const records: { name: string; status: number; unchanged: boolean }[] = [];
test.after(() => {
    if (process.env.MEDIFLOW_CHECKUP_ENVELOPE_REPORT) writeFileSync(process.env.MEDIFLOW_CHECKUP_ENVELOPE_REPORT,
        `${JSON.stringify({ cap: CAP, records }, null, 2)}\n`);
    sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof state>)[Symbol.for(stateKey)];
    rmSync(dataDir, { recursive: true, force: true });
});

type Surface = 'web' | 'v1';
type Operation = 'POST' | 'PUT';
const ids = { patientId: 'synthetic-envelope-patient', checkupId: 'synthetic-envelope-checkup' };
function reset(operation: Operation) {
    sql.exec('DELETE FROM checkups; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories;');
    dbServer.insert(ambulatories).values({ id: 'synthetic-envelope-ambulatory', name: 'Synthetic', type: 'live' }).run();
    dbServer.insert(patients).values({ id: ids.patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: 'SYNTHETICENVELOPE', version: 7 }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: ids.patientId, ambulatoryId: 'synthetic-envelope-ambulatory' }).run();
    if (operation === 'PUT') dbServer.insert(checkups).values({ id: ids.checkupId, patientId: ids.patientId,
        date: new Date('2026-01-01T00:00:00Z'), title: 'Before', notes: 'ENC:synthetic:before', status: 'pending', source: 'manual', version: 3 }).run();
    state.web = true; state.v1 = true; state.events = [];
}
function snapshot() {
    const fresh = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return Object.fromEntries(['checkups', 'patients', 'patients_to_ambulatories', 'audit_events'].map(table =>
            [table, fresh.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])) as Record<string, Record<string, unknown>[]>;
    } finally { fresh.close(); }
}
function validBody(surface: Surface, operation: Operation) {
    return operation === 'POST'
        ? { id: ids.checkupId, ...(surface === 'web' ? { patientId: ids.patientId } : {}), date: '2026-05-02T09:00:00.000Z',
            title: 'Synthetic checkup', notes: 'ENC:synthetic:notes', status: 'pending', source: 'manual' }
        : { version: 3, title: 'Synthetic update', notes: 'ENC:synthetic:notes' };
}
function request(operation: Operation, body?: string | Uint8Array | ReadableStream<Uint8Array>, headers: Record<string, string> = {}, signal?: AbortSignal) {
    const init = { method: operation, body, signal, headers: { 'content-type': 'application/json', ...headers },
        ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit;
    return new Request('http://127.0.0.1/api/checkups', init);
}
async function invoke(surface: Surface, operation: Operation, req: Request, missing = false) {
    if (surface === 'web') return operation === 'POST' ? webCreate.POST(req)
        : webItem.PUT(req, { params: Promise.resolve({ id: missing ? 'synthetic-missing' : ids.checkupId }) });
    return operation === 'POST' ? v1Create.POST(req, { params: Promise.resolve({ id: ids.patientId }) })
        : v1Item.PUT(req, { params: Promise.resolve({ id: ids.patientId, checkupId: missing ? 'synthetic-missing' : ids.checkupId }) });
}
const invalidResponse = { error: 'Invalid JSON body' };
const largeResponse = { error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' };
async function denied(surface: Surface, operation: Operation, name: string, req: Request, status = 400) {
    const before = snapshot();
    const response = await invoke(surface, operation, req);
    assert.equal(response.status, status, name);
    assert.deepEqual(await response.json(), status === 413 ? largeResponse : invalidResponse, name);
    assert.deepEqual(snapshot(), before, `${name}: row/version/parent/membership/audit must be unchanged`);
    records.push({ name: `${surface}-${operation}-${name}`, status, unchanged: true });
}
function chunked(bytes: Uint8Array, chunkSize = 16381) {
    let offset = 0, pulls = 0, cancels = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) {
        pulls++;
        if (offset === bytes.length) return c.close();
        const end = Math.min(offset + chunkSize, bytes.length);
        c.enqueue(bytes.slice(offset, end)); offset = end;
    }, cancel() { cancels++; } }, { highWaterMark: 0 });
    return { body, counts: () => ({ pulls, cancels }) };
}
function padded(body: Record<string, unknown>, size: number, multibyte: boolean) {
    const empty = JSON.stringify({ ...body, notes: 'ENC:' });
    const budget = size - new TextEncoder().encode(empty).byteLength;
    const notes = 'ENC:' + (multibyte ? '🩺'.repeat(Math.floor(budget / 4)) + 'x'.repeat(budget % 4) : 'x'.repeat(budget));
    const text = JSON.stringify({ ...body, notes });
    assert.equal(new TextEncoder().encode(text).byteLength, size);
    return { text, notes };
}

for (const surface of ['web', 'v1'] as const) for (const operation of ['POST', 'PUT'] as const) {
    for (const [name, raw] of [['malformed', '{'], ['empty', ''], ['null', 'null'], ['array', '[]'],
        ['string', '"x"'], ['number', '42'], ['boolean', 'true']] as const) test(`${surface} ${operation}: ${name} is 400 without SQLite effects`, async () => {
        reset(operation); await denied(surface, operation, name, request(operation, raw));
    });
    test(`${surface} ${operation}: no body is 400 without effects`, async () => {
        reset(operation); await denied(surface, operation, 'absent-body', request(operation));
    });
    for (const multibyte of [false, true]) for (const size of [CAP - 1, CAP]) test(`${surface} ${operation}: ${multibyte ? 'multibyte' : 'ASCII'} ${size} bytes admitted unchanged`, async () => {
        reset(operation);
        const { text, notes } = padded(validBody(surface, operation), size, multibyte);
        const stream = chunked(new TextEncoder().encode(text));
        const before = snapshot();
        const response = await invoke(surface, operation, request(operation, stream.body, { 'content-length': 'invalid' }));
        assert.equal(response.status, operation === 'POST' ? 201 : 200);
        const after = snapshot();
        assert.equal(after.checkups[0].notes, notes);
        assert.equal(after.checkups[0].version, operation === 'POST' ? 1 : 4);
        assert.equal(after.checkups[0].status, 'pending');
        assert.equal(after.checkups[0].date, operation === 'POST' ? Date.parse('2026-05-02T09:00:00.000Z') / 1000 : before.checkups[0].date);
        assert.equal(after.audit_events.length, before.audit_events.length + 1);
        assert.deepEqual(after.patients, before.patients); assert.deepEqual(after.patients_to_ambulatories, before.patients_to_ambulatories);
        assert.equal(stream.body.locked, false); assert.equal(stream.counts().cancels, 0);
        records.push({ name: `${surface}-${operation}-${size}-${multibyte}`, status: response.status, unchanged: false });
    });
    for (const header of [undefined, '0', 'invalid', '-1', '4194305']) test(`${surface} ${operation}: over cap with Content-Length ${header} denies without effects`, async () => {
        reset(operation);
        const { text } = padded(validBody(surface, operation), CAP + 1, true);
        const stream = chunked(new TextEncoder().encode(text));
        await denied(surface, operation, `oversize-${header}`, request(operation, stream.body, header === undefined ? {} : { 'content-length': header }), 413);
        assert.equal(stream.body.locked, false); assert.equal(stream.counts().cancels, 1);
        assert.equal(stream.counts().pulls === 0, header === '4194305');
    });
    test(`${surface} ${operation}: pre-abort denies before pulls without effects`, async () => {
        reset(operation); const control = new AbortController(); control.abort();
        const stream = chunked(new TextEncoder().encode(JSON.stringify(validBody(surface, operation))));
        await denied(surface, operation, 'pre-abort', request(operation, stream.body, {}, control.signal));
        assert.equal(stream.counts().pulls, 0); assert.equal(stream.body.locked, false);
    });
    test(`${surface} ${operation}: abort during pending read cancels and releases without effects`, async () => {
        reset(operation); const control = new AbortController(); let reached!: () => void, cancels = 0, pulls = 0;
        const waiting = new Promise<void>(resolve => { reached = resolve; });
        const body = new ReadableStream<Uint8Array>({ pull(c) {
            if (++pulls === 1) c.enqueue(new TextEncoder().encode('{"version":3,'));
            else reached();
        }, cancel() { cancels++; } }, { highWaterMark: 0 });
        const result = denied(surface, operation, 'pending-abort', request(operation, body, {}, control.signal));
        await waiting; control.abort(); await result;
        assert.equal(pulls, 2); assert.equal(cancels, 1); assert.equal(body.locked, false);
    });
    test(`${surface} ${operation}: stream error and locked stream are 400 without effects`, async () => {
        reset(operation);
        const body = new ReadableStream<Uint8Array>({ pull(c) { c.error(new TypeError('synthetic stream failure')); } }, { highWaterMark: 0 });
        await denied(surface, operation, 'stream-failure', request(operation, body)); assert.equal(body.locked, false);
        const req = request(operation, '{}'); const reader = req.body!.getReader();
        try { await denied(surface, operation, 'locked-stream', req); } finally { reader.releaseLock(); }
    });
    test(`${surface} ${operation}: auth/actor gates precede body access`, async () => {
        reset(operation); const before = snapshot();
        if (surface === 'web') state.web = false; else state.v1 = false;
        const req = request(operation, '{}');
        Object.defineProperty(req, 'body', { get() { assert.fail('denied body accessed'); } });
        Object.defineProperty(req, 'headers', { get() { assert.fail('denied body headers accessed'); } });
        assert.equal((await invoke(surface, operation, req)).status, 401); assert.deepEqual(snapshot(), before);
        assert.deepEqual(state.events, surface === 'web' ? ['session'] : ['token']);
        state.web = true; state.v1 = true; state.events = [];
        const admitted = request(operation, '{}'); const originalHeaders = admitted.headers, originalBody = admitted.body;
        Object.defineProperty(admitted, 'headers', { get() { state.events.push('headers'); return originalHeaders; } });
        Object.defineProperty(admitted, 'body', { get() { state.events.push('body'); return originalBody; } });
        await invoke(surface, operation, admitted);
        assert.deepEqual(state.events.slice(0, surface === 'web' ? 2 : 3), surface === 'web' ? ['session', 'headers'] : ['token', 'actor', 'headers']);
    });
    test(`${surface} ${operation}: Request.json replacement UTF8 and last duplicate key preserved`, async () => {
        reset(operation);
        const before = snapshot();
        const raw = JSON.stringify(validBody(surface, operation)).replace(/}$/, ',"title":"first","title":"last","notes":"ENC:replacement-X","unknownCompatibilityField":true}');
        const bytes = new TextEncoder().encode(raw); bytes[raw.indexOf('replacement-X') + 'replacement-'.length] = 0xff;
        const response = await invoke(surface, operation, request(operation, bytes));
        assert.equal(response.status, operation === 'POST' ? 201 : 200);
        const after = snapshot(); assert.equal(after.checkups[0].title, 'last'); assert.equal(after.checkups[0].notes, 'ENC:replacement-�');
        assert.equal(after.audit_events.length, before.audit_events.length + 1);
    });
}
for (const surface of ['web', 'v1'] as const) test(`${surface} PUT preserves version, 404, field validation and CAS precedence`, async () => {
    reset('PUT'); const before = snapshot();
    assert.equal((await invoke(surface, 'PUT', request('PUT', '{"version":3,"title":42}'), true)).status, 404);
    assert.equal((await invoke(surface, 'PUT', request('PUT', '{"title":42}'), true)).status, 400);
    assert.equal((await invoke(surface, 'PUT', request('PUT', '{"version":3,"title":42}'))).status, 400);
    const conflict = await invoke(surface, 'PUT', request('PUT', '{"version":2,"title":"stale"}'));
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, 'VERSION_CONFLICT');
    assert.deepEqual(snapshot(), before);
});
test('helper returns an object with own __proto__ and unknown keys without whitelist/repair', async () => {
    const result = await readCheckupJsonObject(request('POST', '{"__proto__":{"synthetic":true},"future":2}'));
    assert.equal(result.ok, true);
    if (result.ok) { assert.equal(Object.hasOwn(result.body, '__proto__'), true); assert.equal(result.body.future, 2); }
});
