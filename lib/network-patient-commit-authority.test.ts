/* @Codex: real HTTP handlers, auth owner, services and synthetic SQLite only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { ambulatories, patients, patientsToAmbulatories, settings, users } from './schema';
import { NETWORK_MODE_KEY } from './network-contract';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from './network-pairing-model';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import * as owner from './security/web-auth-lifecycle-owner-adapter';
import { retireServerSessionForLogout, clearAllSessions } from './security/server-session';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-patient-authority-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState = { cookies: new Map<string, string>(), onCookies: undefined as (() => void) | undefined };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer } = load('./db-server.ts') as typeof import('./db-server');
const collection = load('../app/api/v1/network/patients/route.ts') as typeof import('../app/api/v1/network/patients/route');
const detail = load('../app/api/v1/network/patients/[id]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/route');
const restore = load('../app/api/v1/network/patients/[id]/restore/route.ts') as typeof import('../app/api/v1/network/patients/[id]/restore/route');
const lifecycle = load('./network-patient-lifecycle.ts') as typeof import('./network-patient-lifecycle');
const profile = load('./network-patient-write.ts') as typeof import('./network-patient-write');
type Operation = 'create' | 'update' | 'delete' | 'restore';

test.after(() => { clearAllSessions(); cleanupCookies(); dbServer.$client.close(); rmSync(dataDir, { recursive: true, force: true }); });

function fixture(operation: Operation, channel: 'native' | 'web' = 'native') {
    clearAllSessions(); cookieState.onCookies = undefined; cookieState.cookies.clear();
    // Audit is append-only, including in this synthetic archive.
    dbServer.$client.exec('DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories; DELETE FROM users; DELETE FROM settings;');
    dbServer.insert(ambulatories).values({ id: 'synthetic-a', name: 'Synthetic ambulatory', isDefault: true }).run();
    const native = syntheticNetworkPatientAuthority(dbServer, 'synthetic-a');
    let session = native.session;
    if (channel === 'web') {
        const control = owner.bootstrapControl(); assert.ok(control);
        const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: randomUUID() }); assert.ok(attempt);
        const issued = owner.issue(attempt, { id: session.userId, username: session.username, role: session.role }); assert.ok(issued);
        const resolved = owner.resolve(issued.sessionId, control.controlId); assert.equal(resolved.status, 'active');
        if (resolved.status !== 'active') throw new Error('synthetic Web session missing');
        session = resolved.projection;
        cookieState.cookies.set('mediflow_auth_control', control.controlId);
    }
    cookieState.cookies.set('mediflow_session', session.id);
    const id = 'synthetic-patient';
    if (operation !== 'create') {
        dbServer.insert(patients).values({ id, firstName: 'Synthetic', lastName: 'Fixture', taxCode: 'SYNTHETIC', version: 3,
            ambulatoryId: 'synthetic-a', aiSummary: 'Synthetic derived summary', aiSummaryGeneratedAt: new Date('2026-01-01'),
            aiSummaryContextHash: 'synthetic-original-hash', ...(operation === 'restore' ? { deletedAt: new Date('2026-01-02') } : {}),
        }).run();
        dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: 'synthetic-a' }).run();
    }
    const context = { ...native, session, patientId: id };
    const body = operation === 'create' ? { id, firstName: 'Synthetic', lastName: 'Created', taxCode: 'SYNTHETIC-NEW' }
        : operation === 'update' ? { version: 3, firstName: 'Changed', phone: 'ENC:aQ==:ZGF0YQ==' } : { version: 3 };
    return { context, body };
}

function clinicalSnapshot() {
    return ['patients', 'patients_to_ambulatories', 'audit_events'].map(table => dbServer.$client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}
function setSetting(key: string, value: string) { dbServer.update(settings).set({ value }).where(eq(settings.key, key)).run(); }
function revoke(kind: string, context: ReturnType<typeof fixture>['context']) {
    if (kind === 'pairing') setSetting(NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState({ intents: [], clients: [] }));
    if (kind === 'mode') setSetting(NETWORK_MODE_KEY, 'local-only');
    if (kind === 'capability') setSetting(NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState({ intents: [], clients: [{ ...context.pairedClient, grantedCapabilities: [] }] }));
    if (kind === 'token') setSetting(NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState({ intents: [], clients: [{ ...context.pairedClient, tokenHash: 'b'.repeat(64) }] }));
    if (kind === 'session') {
        if (context.session.authChannel === 'web') owner.retire(context.session, 'dispose');
        else retireServerSessionForLogout(context.session.id);
    }
    if (kind === 'user') dbServer.update(users).set({ role: 'user' }).where(eq(users.id, context.session.userId)).run();
    if (kind === 'scope') {
        dbServer.update(ambulatories).set({ isDefault: false }).run();
        dbServer.insert(ambulatories).values({ id: 'synthetic-b', name: 'Synthetic changed scope', isDefault: true }).run();
    }
}

function route(operation: Operation, request: Request) {
    const params = { params: Promise.resolve({ id: 'synthetic-patient' }) };
    return operation === 'create' ? collection.POST(request) : operation === 'update' ? detail.PUT(request, params)
        : operation === 'delete' ? detail.DELETE(request, params) : restore.POST(request, params);
}
async function waitFor(predicate: () => boolean) {
    for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise<void>(resolve => setImmediate(resolve)); }
    throw new Error('body reader was not reached');
}

for (const channel of ['native', 'web'] as const) for (const operation of ['create', 'update', 'delete', 'restore'] as const) {
    test(`${channel} ${operation}: valid write commits clinical data and one required audit`, async () => {
        const { context, body } = fixture(operation, channel);
        const auditCount = () => (dbServer.$client.prepare('SELECT count(*) n FROM audit_events').get() as { n: number }).n;
        const beforeAudit = auditCount();
        const response = await route(operation, new Request(context.request.url, { method: operation === 'update' ? 'PUT' : operation === 'delete' ? 'DELETE' : 'POST',
            headers: context.request.headers, body: JSON.stringify(body) }));
        assert.equal(response.status, operation === 'create' ? 201 : 200);
        assert.equal(auditCount(), beforeAudit + 1);
    });
    for (const kind of ['pairing', 'mode', 'capability', 'token', 'session', 'user', 'scope']) {
        test(`${channel} ${operation}: pending body after ${kind} revocation has no clinical/audit effect`, async () => {
            const { context, body } = fixture(operation, channel);
            const before = clinicalSnapshot();
            let controller!: ReadableStreamDefaultController<Uint8Array>;
            const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
            const request = new Request(context.request.url, { method: operation === 'update' ? 'PUT' : operation === 'delete' ? 'DELETE' : 'POST',
                headers: context.request.headers, body: stream, duplex: 'half' } as RequestInit);
            let reading = false;
            const getReader = request.body!.getReader.bind(request.body);
            Object.defineProperty(request.body, 'getReader', { value: () => { reading = true; return getReader(); } });
            const pending = route(operation, request);
            await waitFor(() => reading);
            revoke(kind, context);
            controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close();
            const response = await pending;
            assert.equal(response.status, ['mode', 'capability', 'scope'].includes(kind) ? 403 : 401);
            if (kind === 'mode') assert.equal((await response.json()).code, 'NETWORK_MODE_DISABLED');
            assert.deepEqual(clinicalSnapshot(), before);
        });
    }
}

for (const operation of ['create', 'update', 'delete', 'restore'] as const) {
    test(`${operation}: revocation in final asynchronous preparation is denied inside transaction`, async () => {
        const { context, body } = fixture(operation); const before = clinicalSnapshot();
        cookieState.onCookies = () => revoke('pairing', context);
        const result = operation === 'create' ? await lifecycle.createNetworkScopedPatient(context, body)
            : operation === 'update' ? await profile.updateNetworkScopedPatient(context, body)
            : operation === 'delete' ? await lifecycle.deleteNetworkScopedPatient(context, body) : await lifecycle.restoreNetworkScopedPatient(context, body);
        assert.equal(result.status, 401); assert.deepEqual(clinicalSnapshot(), before);
    });
}

for (const field of ['aiSummary', 'aiSummaryGeneratedAt', 'aiSummaryContextHash', 'documentInsights']) for (const value of ['forged', null]) {
    test(`${field}=${String(value)}: profile and create deny derived fields without clinical/audit effects`, async () => {
        for (const operation of ['update', 'create'] as const) {
            const { context, body } = fixture(operation); const before = clinicalSnapshot();
            const result = operation === 'update' ? await profile.updateNetworkScopedPatient(context, { ...body, [field]: value })
                : await lifecycle.createNetworkScopedPatient(context, { ...body, [field]: value });
            assert.equal(result.status, 403); assert.deepEqual(clinicalSnapshot(), before);
        }
    });
}

test('profile allowlist preserves ordinary sealed/null fields and ignores extension metadata', async () => {
    const { context } = fixture('update');
    const result = await profile.updateNetworkScopedPatient(context, { version: 3, phone: null, firstName: 'Changed', actorRef: 'forged', futureDerivedField: 'forged' });
    assert.equal(result.status, 200);
    const row = dbServer.select().from(patients).get()!;
    assert.equal(row.firstName, 'Changed'); assert.equal(row.phone, null); assert.equal(row.aiSummaryContextHash, 'synthetic-original-hash');
    assert.equal(row.aiSummaryGeneratedAt?.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('a second SQLite writer revokes mode while the patient waits for its IMMEDIATE transaction', async () => {
    const { context } = fixture('update'); const before = clinicalSnapshot();
    // The worker uses the same runtime/addon and only this invented archive.
    const worker = spawn(process.execPath, ['-e', `
        const D=require(${JSON.stringify(load.resolve('better-sqlite3'))});
        const db=new D(process.argv[1]);db.exec('BEGIN IMMEDIATE');
        db.prepare('UPDATE settings SET value=? WHERE key=?').run('local-only','network.mode');
        process.stdout.write('locked\\n');setTimeout(()=>{db.exec('COMMIT');db.close()},150);
    `, join(dataDir, 'medical.db')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let workerError = ''; worker.stderr.on('data', chunk => { workerError += chunk.toString(); });
    const exited = new Promise<number | null>((resolve, reject) => { worker.once('error', reject); worker.once('exit', resolve); });
    await new Promise<void>((resolve, reject) => {
        worker.stdout.once('data', () => resolve()); worker.once('error', reject);
        worker.once('exit', code => { if (code !== 0) reject(new Error(workerError)); });
    });
    const result = await profile.updateNetworkScopedPatient(context, { version: 3, firstName: 'WouldRaceRevocation' });
    assert.equal(result.status, 403); assert.equal(result.value.code, 'NETWORK_MODE_DISABLED');
    assert.equal(await exited, 0, workerError); assert.deepEqual(clinicalSnapshot(), before);
});
