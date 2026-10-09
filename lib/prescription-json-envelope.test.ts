import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

// Real adapters, core and SQLite; replace only authenticated admission.
const load = createRequire(import.meta.url);
const dir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'prescription-envelope-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const state = { admitted: true };
(globalThis as unknown as Record<symbol, typeof state>)[Symbol.for(dir)] = state;
const session = { id: 'synthetic-session', userId: 'synthetic-user', role: 'admin', authChannel: 'web' };
function seam(name: string, source: string) {
    const file = join(dir, name);
    writeFileSync(file, `const state=globalThis[Symbol.for(${JSON.stringify(dir)})];const session=${JSON.stringify(session)};\n${source}`);
    return pathToFileURL(file).href;
}
const auth = seam('auth.cjs', `exports.requireSession=async()=>state.admitted?session:null;
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});`);
const paired = seam('paired.cjs', `exports.requireNetworkWriteContext=async(request)=>state.admitted?
{ok:true,context:{request,session:{...session,authChannel:'native'},pairedClient:{clientId:'synthetic-client'},scopeAmbulatoryId:'synthetic-amb'}}:
{ok:false,response:Response.json({error:'Unauthorized'},{status:401})};`);
const replacements: Record<string, string> = { '@/lib/security/server-auth': auth, '@/lib/network-write-context': paired };
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
        next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    return replacements[specifier] ? { url: replacements[specifier], shortCircuit: true } : next(specifier, context);
} });
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { ambulatories, patients, patientsToAmbulatories, prostheticPrescriptions } = load('./schema.ts') as typeof import('./schema.ts');
const web = load('../app/api/prosthetic-prescriptions/[id]/route.ts') as typeof import('../app/api/prosthetic-prescriptions/[id]/route.ts');
const network = load('../app/api/v1/network/service-prescriptions/route.ts') as typeof import('../app/api/v1/network/service-prescriptions/route.ts');
const sql = new Database(join(dir, 'medical.db'));
dbServer.insert(ambulatories).values({ id: 'synthetic-amb', name: 'Synthetic', type: 'live' }).run();
dbServer.insert(patients).values({ id: 'synthetic-patient', firstName: 'Synthetic', lastName: 'Patient', taxCode: 'SYNTHETIC' }).run();
dbServer.insert(patientsToAmbulatories).values({ patientId: 'synthetic-patient', ambulatoryId: 'synthetic-amb' }).run();
dbServer.insert(prostheticPrescriptions).values({ id: 'synthetic-prosthetic', patientId: 'synthetic-patient', prescribedAt: new Date('2026-01-01'), description: 'ENC:synthetic:before', version: 1 }).run();
const context = { params: Promise.resolve({ id: 'synthetic-prosthetic' }) };
const cap = 4 * 1024 * 1024;
function request(body?: string | ReadableStream<Uint8Array>, method = 'POST', headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/prescriptions', { method, body, headers,
        ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit);
}
function snapshot() {
    const fresh = new Database(join(dir, 'medical.db'), { readonly: true });
    try { return ['patients', 'patients_to_ambulatories', 'prosthetic_prescriptions', 'service_prescriptions', 'service_prescription_items', 'audit_events']
        .map(table => fresh.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()); }
    finally { fresh.close(); }
}
test.after(() => {
    sql.close(); dbServer.$client.close(); hooks.deregister();
    delete (globalThis as unknown as Record<symbol, typeof state>)[Symbol.for(dir)];
    rmSync(dir, { recursive: true, force: true });
});
test('Web malformed JSON is 400 without effects', async () => {
    const before = snapshot();
    assert.equal((await web.PUT(request('{', 'PUT'), context)).status, 400);
    assert.deepEqual(snapshot(), before);
});
test('paired null is 400 without effects and both admission gates precede body consumption', async () => {
    const before = snapshot();
    assert.equal((await network.POST(request('null'))).status, 400);
    state.admitted = false;
    try {
        for (const invoke of [(req: Request) => web.PUT(req, context), (req: Request) => network.POST(req)]) {
            const req = request('null', 'PUT', { 'content-length': String(cap + 1) });
            assert.equal((await invoke(req)).status, 401);
            assert.equal(req.bodyUsed, false);
        }
    } finally { state.admitted = true; }
    assert.deepEqual(snapshot(), before);
});
test('DELETE absent and whitespace retain version error; null remains invalid', async () => {
    const before = snapshot();
    for (const body of [undefined, '', '  ', 'null']) {
        const result = await web.DELETE(request(body, 'DELETE'), context);
        assert.equal(result.status, 400);
        assert.deepEqual(await result.json(), { error: body === 'null' ? 'Invalid JSON body' : 'Version is required' });
    }
    assert.deepEqual(snapshot(), before);
});
test('shared parser rejects malformed/nonobject, byte overflow and unreadable input once', async () => {
    const { readPrescriptionJsonObject: read } = await import('./prescription-json-body');
    for (const body of [undefined, '', ' ', '{', 'null', '[]', 'true', '42', '"text"']) {
        const result = await read(request(body));
        assert.equal(result.ok, false, String(body));
        if (!result.ok) { assert.equal(result.response.status, 400); assert.deepEqual(await result.response.json(), { error: 'Invalid JSON body' }); }
    }
    const valid = JSON.stringify({ notes: 'è' });
    assert.equal((await read(request(valid + ' '.repeat(cap - Buffer.byteLength(valid))))).ok, true);
    const overflow = new TextEncoder().encode(valid + ' '.repeat(cap - Buffer.byteLength(valid) + 1));
    let offset = 0;
    const chunked = new ReadableStream<Uint8Array>({ pull(controller) {
        if (offset >= overflow.length) return controller.close();
        controller.enqueue(overflow.slice(offset, offset += 16381));
    } });
    for (const req of [request('{}', 'POST', { 'content-length': String(cap + 1) }), request(chunked)]) {
        const result = await read(req);
        assert.equal(result.ok, false);
        if (!result.ok) { assert.equal(result.response.status, 413); assert.deepEqual(await result.response.json(), { error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' }); }
    }
    const used = request('{}'); await used.text();
    const result = await read(used);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 400);
});
test('valid paired create, Web update and Web delete preserve rows, versions and audit', async () => {
    const created = await network.POST(request(JSON.stringify({ id: 'synthetic-service', patientId: 'synthetic-patient', prescribedAt: '2026-01-01', serviceName: 'ENC:synthetic:service' })));
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { id: 'synthetic-service', version: 1 });
    assert.equal((await web.PUT(request(JSON.stringify({ version: 1, notes: null }), 'PUT'), context)).status, 200);
    assert.deepEqual(sql.prepare('SELECT version, notes FROM prosthetic_prescriptions WHERE id=?').get('synthetic-prosthetic'), { version: 2, notes: null });
    assert.equal((await web.DELETE(request(JSON.stringify({ version: 2 }), 'DELETE'), context)).status, 200);
    assert.equal(sql.prepare('SELECT id FROM prosthetic_prescriptions WHERE id=?').get('synthetic-prosthetic'), undefined);
    assert.deepEqual(sql.prepare('SELECT count(*) AS n FROM audit_events').get(), { n: 3 });
});
