import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root = mkdtempSync(join(tmpdir(), 'mediflow-command-http-')); process.env.MEDIFLOW_DATA_DIR = root;
const load = createRequire(import.meta.url);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { users, patients, therapies } = load('./schema.ts') as typeof import('./schema.ts');
const { issueSyntheticWebSession, retireSyntheticWebSession } = load('./security/web-auth-lifecycle-owner-test-fixture.ts') as typeof import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const { readSqliteArchiveGeneration } = load('./archive-generation.ts') as typeof import('./archive-generation.ts');
openDbServer(); const sql = openDbServer(), generation = readSqliteArchiveGeneration(sql);
for (const actor of ['synthetic-command-http-a', 'synthetic-command-http-b']) dbServer.insert(users).values({ id: actor, username: actor, role: 'admin', passwordHash: 'synthetic', salt: 'synthetic', encryptedMasterKey: 'synthetic' }).run();
const actorA = 'synthetic-command-http-a', actorB = 'synthetic-command-http-b';
const original = issueSyntheticWebSession({ id: actorA, username: actorA, role: 'admin' }, 'http-a');
const other = issueSyntheticWebSession({ id: actorB, username: actorB, role: 'admin' }, 'http-b');
const state = { session: original as typeof original | null };
const symbol = `synthetic-status-http-${randomUUID()}`;
(globalThis as unknown as Record<symbol, typeof state>)[Symbol.for(symbol)] = state;
const auth = join(root, 'status-auth.cjs'); writeFileSync(auth, `exports.requireSession=async()=>globalThis[Symbol.for(${JSON.stringify(symbol)})].session;`);
const { registerHooks } = load('node:module') as { registerHooks: (hooks: { resolve: (specifier: string, context: unknown, next: (specifier: string, context: unknown) => {url:string}) => {url:string; shortCircuit?:boolean} }) => {deregister():void} };
const hooks = registerHooks({ resolve(specifier, context, next) { return specifier === './security/server-auth' ? { url: pathToFileURL(auth).href, shortCircuit: true } : next(specifier, context); } });
const { therapyStatusCommandHttp } = load('./therapy-status-command-http.ts') as typeof import('./therapy-status-command-http.ts');
function fixture() {
    const patientId = randomUUID(), therapyId = randomUUID();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: randomUUID() }).run();
    dbServer.insert(therapies).values({ id: therapyId, patientId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', version: 1, startDate: new Date() }).run();
    return { commandId: randomUUID(), protocol: 'therapy.status.change.v1' as const, archiveGeneration: generation, patientId, therapyId, expectedVersion: 1 };
}
function request(command: Record<string, unknown>, op: 'execute' | 'receipt' | 'close', body?: string, headers?: Record<string,string>) {
    const query = op === 'receipt' ? '?' + new URLSearchParams(Object.entries(command).map(([key,value]) => [key, String(value)])) : '';
    return new Request('http://127.0.0.1/api/therapy-status-commands/' + command.commandId + '/' + op + query,
        { method: op === 'receipt' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-mediflow-archive-generation': generation, ...headers }, ...(op === 'receipt' ? {} : { body: body ?? JSON.stringify(command) }) });
}
test('HTTP fresh owner execute/receipt/close, no-store and target-free close', async () => {
    const command = fixture();
    const applied = await therapyStatusCommandHttp(request({ ...command, target: 'completed' }, 'execute'), command.commandId, 'execute');
    assert.equal(applied.status, 200); assert.equal(applied.headers.get('Cache-Control'), 'no-store');
    assert.equal((await applied.json()).receipt.outcome, 'applied');
    const read = await therapyStatusCommandHttp(request(command, 'receipt'), command.commandId, 'receipt'); assert.equal((await read.json()).receipt.resultVersion, 2);
    const closed = await therapyStatusCommandHttp(request(command, 'close'), command.commandId, 'close'); assert.equal((await closed.json()).receipt.outcome, 'applied');
});
test('HTTP owner collision reveals no receipt; auth/generation/body limits precede mutation', async () => {
    const command = fixture();
    await therapyStatusCommandHttp(request(command, 'close'), command.commandId, 'close');
    state.session = other;
    const denied = await therapyStatusCommandHttp(request(command, 'receipt'), command.commandId, 'receipt'); assert.equal(denied.status, 403); assert.deepEqual(await denied.json(), { code: 'denied' });
    state.session = null;
    assert.equal((await therapyStatusCommandHttp(request(command, 'close', '{'), command.commandId, 'close')).status, 401);
    state.session = original;
    assert.equal((await therapyStatusCommandHttp(request(command, 'close', 'x'.repeat(4097)), command.commandId, 'close')).status, 413);
    assert.equal((await therapyStatusCommandHttp(request(command, 'close', undefined, { 'x-mediflow-archive-generation': randomUUID() }), command.commandId, 'close')).status, 409);
    assert.equal((await therapyStatusCommandHttp(request({ ...command, target: 'completed' }, 'close'), command.commandId, 'close')).status, 400);
});
test('lock while HTTP body pending denies late execute with actual owner retirement', async () => {
    const command = fixture(); let push!: (value: Uint8Array) => void, end!: () => void;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { push = value => controller.enqueue(value); end = () => controller.close(); } });
    const input = new Request('http://127.0.0.1/api/status', { method: 'POST', headers: { 'x-mediflow-archive-generation': generation }, body: stream, duplex: 'half' } as RequestInit);
    const result = therapyStatusCommandHttp(input, command.commandId, 'execute');
    await new Promise(resolve => setTimeout(resolve, 5)); retireSyntheticWebSession(original);
    push(new TextEncoder().encode(JSON.stringify({ ...command, target: 'completed' }))); end();
    assert.equal((await result).status, 403);
    assert.equal(sql.prepare('SELECT 1 FROM therapy_status_commands WHERE command_id=?').get(command.commandId), undefined);
    assert.equal((sql.prepare('SELECT version FROM therapies WHERE id=?').get(command.therapyId) as {version:number}).version, 1);
});
test.after(() => { hooks.deregister(); delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for(symbol)]; dbServer.$client.close(); });
