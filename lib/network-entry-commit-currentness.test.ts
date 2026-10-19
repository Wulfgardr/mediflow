/* ADR0153: real paired admission and SQLite; only the HTTP cookie adapter is synthetic. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { ambulatories, patients, patientsToAmbulatories, settings } from './schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from './network-pairing-model';
import { clearAllSessions, retireServerSessionForLogout } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-diary-authority-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const collection = load('../app/api/v1/network/patients/[id]/entries/route.ts') as typeof import('../app/api/v1/network/patients/[id]/entries/route');
const detail = load('../app/api/v1/network/patients/[id]/entries/[entryId]/route.ts') as typeof import('../app/api/v1/network/patients/[id]/entries/[entryId]/route');
const { prepareNetworkPatientCommitGuard } = load('./network-patient-commit-authority.ts') as typeof import('./network-patient-commit-authority');
const PATIENT = 'synthetic-diary-patient';
const ENTRY = 'synthetic-diary-entry';

test.after(() => {
    clearAllSessions(); cleanupCookies(); dbServer.$client.close();
    rmSync(dataDir, { recursive: true, force: true });
});

function fixture() {
    clearAllSessions(); cookieState.cookies.clear();
    dbServer.$client.exec('DELETE FROM entries; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories; DELETE FROM users; DELETE FROM settings;');
    dbServer.insert(ambulatories).values({ id: 'synthetic-diary-scope', name: 'Synthetic diary scope', isDefault: true }).run();
    const authority = syntheticNetworkPatientAuthority(dbServer, 'synthetic-diary-scope');
    authority.pairedClient.grantedCapabilities.push('network.replica.write-clinical-diary');
    setClients([authority.pairedClient]);
    cookieState.cookies.set('mediflow_session', authority.session.id);
    cookieState.cookies.set('ambulatory_id', authority.scopeAmbulatoryId);
    dbServer.insert(patients).values({ id: PATIENT, firstName: 'Synthetic', lastName: 'Diary', taxCode: 'SYNTHETIC', version: 3 }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: PATIENT, ambulatoryId: authority.scopeAmbulatoryId }).run();
    return authority;
}

function setClients(clients: ReturnType<typeof fixture>['pairedClient'][]) {
    const value = JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients, intents: [] })), archiveGeneration: currentArchiveGeneration() });
    dbServer.update(settings).set({ value }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
}

function snapshot() {
    return ['entries', 'patients', 'patients_to_ambulatories', 'audit_events']
        .map(table => dbServer.$client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

const createBody = { id: ENTRY, type: 'note', title: 'ENC:c3ludGhldGlj:dGl0bGU=',
    content: 'ENC:c3ludGhldGlj:Y29udGVudA==', date: '2026-10-19T10:00:00.000Z', setting: 'ambulatory' };

function invoke(operation: 'create' | 'update' | 'replay', request: Request) {
    return operation === 'update'
        ? detail.PUT(request, { params: Promise.resolve({ id: PATIENT, entryId: ENTRY }) })
        : collection.POST(request, { params: Promise.resolve({ id: PATIENT }) });
}

async function waitFor(predicate: () => boolean) {
    for (let index = 0; index < 1000; index++) {
        if (predicate()) return;
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    throw new Error('Synthetic diary body reader was not reached');
}

for (const operation of ['create', 'update', 'replay'] as const) {
    test(`${operation}: revocation while the body is pending denies before the writer or idempotent reply`, async () => {
        const authority = fixture();
        const url = `http://127.0.0.1/api/v1/network/patients/${PATIENT}/entries`;
        if (operation !== 'create') {
            const first = await invoke('create', new Request(url, { method: 'POST', headers: authority.request.headers, body: JSON.stringify(createBody) }));
            assert.equal(first.status, 201);
        }
        const before = snapshot();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
        const request = new Request(url, { method: operation === 'update' ? 'PUT' : 'POST',
            headers: authority.request.headers, body: stream, duplex: 'half' } as RequestInit);
        let reading = false;
        const getReader = request.body!.getReader.bind(request.body);
        Object.defineProperty(request.body, 'getReader', { value: () => { reading = true; return getReader(); } });
        const pending = invoke(operation, request);
        await waitFor(() => reading);
        if (operation === 'create') retireServerSessionForLogout(authority.session.id);
        else if (operation === 'update') setClients([]);
        else setClients([{ ...authority.pairedClient, grantedCapabilities: [] }]);
        const body = operation === 'update' ? { version: 1, content: 'ENC:c3ludGhldGlj:bmV3Y29udGVudA==' } : createBody;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close();
        const response = await pending;
        assert.equal(response.status, operation === 'replay' ? 403 : 401);
        assert.deepEqual(snapshot(), before);
    });
}

test('a host-owned capability set is nonempty, closed to mutation and requires every member', async () => {
    const authority = fixture();
    const write = 'network.replica.write-clinical-diary';
    const catalog = 'network.catalogs.readonly';
    for (const invalid of [[], [''], [' '], [write, write]]) {
        await assert.rejects(prepareNetworkPatientCommitGuard(authority, invalid), TypeError);
    }
    const required = [write, catalog];
    const guard = await prepareNetworkPatientCommitGuard(authority, required);
    required.pop();
    assert.equal(dbServer.transaction(tx => guard(tx))?.status, 403);
    authority.pairedClient.grantedCapabilities.push(catalog); setClients([authority.pairedClient]);
    assert.equal(dbServer.transaction(tx => guard(tx)), null);
});
