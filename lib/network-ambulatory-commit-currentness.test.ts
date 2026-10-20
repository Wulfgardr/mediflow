/* ADR0153: real paired admission and SQLite; only the HTTP cookie adapter is synthetic. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { and, eq } from 'drizzle-orm';
import { ambulatories, auditEvents, settings } from './schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from './network-pairing-model';
import { clearAllSessions, retireServerSessionForLogout } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-ambulatory-authority-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const collection = load('../app/api/v1/network/ambulatories/route.ts') as typeof import('../app/api/v1/network/ambulatories/route');
const detail = load('../app/api/v1/network/ambulatories/[id]/route.ts') as typeof import('../app/api/v1/network/ambulatories/[id]/route');
const clearRoute = load('../app/api/v1/network/ambulatories/clear/route.ts') as typeof import('../app/api/v1/network/ambulatories/clear/route');

const SCOPE = 'synthetic-ambulatory-scope';
const TARGET = 'synthetic-ambulatory-target';
const CREATED = 'synthetic-ambulatory-created';
const WRITE_CAPABILITY = 'network.ambulatories.write';
type Operation = 'create' | 'update' | 'delete' | 'clear';

test.after(() => {
    clearAllSessions(); cleanupCookies(); dbServer.$client.close();
    rmSync(dataDir, { recursive: true, force: true });
});

function fixture() {
    clearAllSessions(); cookieState.cookies.clear();
    dbServer.$client.exec('DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories; DELETE FROM users; DELETE FROM settings;');
    dbServer.insert(ambulatories).values({ id: SCOPE, name: 'Synthetic scope', isDefault: true, type: 'live' }).run();
    dbServer.insert(ambulatories).values({ id: TARGET, name: 'Synthetic target', type: 'test', version: 2 }).run();
    const authority = syntheticNetworkPatientAuthority(dbServer, SCOPE);
    authority.pairedClient.grantedCapabilities.push(WRITE_CAPABILITY);
    setClients([authority.pairedClient]);
    cookieState.cookies.set('mediflow_session', authority.session.id);
    cookieState.cookies.set('ambulatory_id', authority.scopeAmbulatoryId);
    return authority;
}

function setClients(clients: ReturnType<typeof fixture>['pairedClient'][]) {
    const value = JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients, intents: [] })), archiveGeneration: currentArchiveGeneration() });
    dbServer.update(settings).set({ value }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
}

function snapshot() {
    return ['ambulatories', 'patients', 'patients_to_ambulatories', 'audit_events']
        .map(table => dbServer.$client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

function url(operation: Operation): string {
    return operation === 'create' ? 'http://127.0.0.1/api/v1/network/ambulatories'
        : operation === 'clear' ? 'http://127.0.0.1/api/v1/network/ambulatories/clear'
        : `http://127.0.0.1/api/v1/network/ambulatories/${TARGET}`;
}

function body(operation: Operation): Record<string, unknown> {
    return operation === 'create' ? { id: CREATED, name: 'Synthetic created', type: 'live' }
        : operation === 'clear' ? { ambulatoryId: TARGET, version: 2 }
        : operation === 'update' ? { name: 'Synthetic renamed', version: 2 }
        : { version: 2 };
}

function invoke(operation: Operation, request: Request) {
    return operation === 'create' ? collection.POST(request)
        : operation === 'clear' ? clearRoute.POST(request)
        : operation === 'update' ? detail.PUT(request, { params: Promise.resolve({ id: TARGET }) })
        : detail.DELETE(request, { params: Promise.resolve({ id: TARGET }) });
}

async function waitFor(predicate: () => boolean) {
    for (let index = 0; index < 1000; index++) {
        if (predicate()) return;
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    throw new Error('Synthetic ambulatory body reader was not reached');
}

const revocations: Record<Operation, { status: 401 | 403; apply: (authority: ReturnType<typeof fixture>) => void }> = {
    create: { status: 403, apply: authority => setClients([{ ...authority.pairedClient,
        grantedCapabilities: ['network.replica.write-patient-profile'] }]) },
    update: { status: 401, apply: () => setClients([]) },
    delete: { status: 401, apply: authority => retireServerSessionForLogout(authority.session.id) },
    clear: { status: 403, apply: authority => setClients([{ ...authority.pairedClient,
        grantedCapabilities: ['network.replica.write-patient-profile'] }]) },
};

for (const operation of ['create', 'update', 'delete', 'clear'] as const) {
    test(`${operation}: revocation while the body is pending denies before the writer commits`, async () => {
        const authority = fixture();
        const before = snapshot();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
        const request = new Request(url(operation), {
            method: operation === 'update' ? 'PUT' : operation === 'delete' ? 'DELETE' : 'POST',
            headers: authority.request.headers, body: stream, duplex: 'half',
        } as RequestInit);
        let reading = false;
        const getReader = request.body!.getReader.bind(request.body);
        Object.defineProperty(request.body, 'getReader', { value: () => { reading = true; return getReader(); } });
        const pending = invoke(operation, request);
        await waitFor(() => reading);
        revocations[operation].apply(authority);
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body(operation)))); controller.close();
        const response = await pending;
        assert.equal(response.status, revocations[operation].status);
        assert.deepEqual(snapshot(), before);
    });
}

/* A restore replaces the archive after admission; the commit guard must deny with
   the shared 409 contract and leave every domain and audit row untouched. */
for (const operation of ['create', 'update', 'delete', 'clear'] as const) {
    test(`${operation}: archive replacement after admission denies at commit with 409`, async () => {
        const authority = fixture();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
        const request = new Request(url(operation), {
            method: operation === 'update' ? 'PUT' : operation === 'delete' ? 'DELETE' : 'POST',
            headers: authority.request.headers, body: stream, duplex: 'half',
        } as RequestInit);
        let reading = false;
        const getReader = request.body!.getReader.bind(request.body);
        Object.defineProperty(request.body, 'getReader', { value: () => { reading = true; return getReader(); } });
        const pending = invoke(operation, request);
        await waitFor(() => reading);
        const { rotateSqliteArchiveGeneration } = load('./archive-generation.ts') as typeof import('./archive-generation');
        dbServer.$client.transaction(() => rotateSqliteArchiveGeneration(dbServer.$client)).immediate();
        const before = snapshot();
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body(operation)))); controller.close();
        const response = await pending;
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, 'ARCHIVE_REPLACED');
        assert.deepEqual(snapshot(), before);
    });
}

test('an admitted rename commits with an incremented version and its audit event', async () => {
    const authority = fixture();
    const request = new Request(url('update'), {
        method: 'PUT',
        headers: { ...Object.fromEntries(authority.request.headers), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Synthetic renamed', version: 2 }),
    });
    const response = await detail.PUT(request, { params: Promise.resolve({ id: TARGET }) });
    assert.equal(response.status, 200);
    const renamed = dbServer.select().from(ambulatories).where(eq(ambulatories.id, TARGET)).get();
    assert.equal(renamed?.name, 'Synthetic renamed');
    assert.equal(renamed?.version, 3);
    const audit = dbServer.select().from(auditEvents)
        .where(and(eq(auditEvents.eventType, 'ambulatory.updated'), eq(auditEvents.subjectRef, TARGET))).get();
    assert.ok(audit);
});
