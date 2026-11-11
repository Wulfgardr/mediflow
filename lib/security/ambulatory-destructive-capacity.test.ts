import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { ambulatories, users, settings } from '../schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from '../network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from '../network-pairing-model';
import { currentArchiveGeneration } from './archive-session-generation';
import { clearAllSessions } from './server-session';

// Rischio #9b (censimento macchine a stati, 11/11): i flow preparati e poi
// abbandonati restano nella mappa in memoria anche dopo la scadenza di 300 s
// e occupano il tetto di 128. Un flow scaduto non deve negare la capacità a
// un comando nuovo.
const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'ambulatory-capacity-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('../db-server.ts') as typeof import('../db-server'); openDbServer();
const { createAmbulatoryDestructiveService, AMBULATORY_COMMAND_PREPARATION_MS } = load('./ambulatory-destructive-service.ts') as typeof import('./ambulatory-destructive-service');
const sql = dbServer.$client;
const origin = 'http://127.0.0.1:31998';
test.after(() => { clearAllSessions(); cleanup(); sql.close(); });

test('flow scaduti e abbandonati non esauriscono il tetto di 128 comandi ambulatoriali', () => {
    clearAllSessions(); cookieState.cookies.clear();
    sql.exec('DELETE FROM entries; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories;');
    dbServer.update(users).set({ role: 'admin' }).run();
    dbServer.insert(ambulatories).values([{ id: 'scope', name: 'Sede inventata', type: 'live', isDefault: true, version: 1, createdAt: new Date(1000) },
        { id: 'target', name: 'Test inventato', type: 'test', isDefault: false, version: 1, createdAt: new Date(2000) }]).run();
    const native = syntheticNetworkPatientAuthority(dbServer, 'scope');
    native.pairedClient.grantedCapabilities.push('network.ambulatories.write');
    dbServer.update(settings).set({ value: JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients: [native.pairedClient], intents: [] })), archiveGeneration: currentArchiveGeneration() }) })
        .where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();

    let clock = Date.now();
    const service = createAmbulatoryDestructiveService({ now: () => clock });
    const begin = () => service.begin(new Request(`${origin}/api/auth/ambulatory-commands`, { method: 'POST', headers: {
        ...Object.fromEntries(native.request.headers), origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
        'x-mediflow-archive-generation': currentArchiveGeneration(), 'x-mediflow-expected-ambulatory-id': 'scope' } }),
    native.session, native.pairedClient,
    { purpose: 'execute', command: { operation: 'ambulatory.clear-test.v1', originalScopeId: 'scope', ambulatoryId: 'target', expectedVersion: 1 } }, 'scope');

    for (let i = 0; i < 128; i++) {
        const opened = begin();
        assert.equal(opened.status, 200, `flow ${i}: ${JSON.stringify(opened.value)}`);
    }
    const full = begin();
    assert.deepEqual({ status: full.status, value: full.value }, { status: 503, value: { code: 'AMBULATORY_COMMAND_CAPACITY' } }, 'con 128 flow ancora validi il tetto resta');
    clock += AMBULATORY_COMMAND_PREPARATION_MS + 1;
    const after = begin();
    assert.equal(after.status, 200, `dopo la scadenza dei 128 flow abbandonati: ${JSON.stringify(after.value)}`);
});
