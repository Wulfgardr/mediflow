import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { ambulatories, patients, patientsToAmbulatories, servicePrescriptions, settings } from './schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from './network-pairing-model';
import { clearAllSessions, retireServerSessionForLogout } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';

const load = createRequire(import.meta.url);
mkdirSync(process.env.MEDIFLOW_DATA_DIR!, { recursive: true });
const directory = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'clinical-'));
process.env.MEDIFLOW_DATA_DIR = directory;
const cookies = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(directory, cookies);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const date = '2026-10-31T10:00:00.000Z';
const sealed = 'ENC:c3ludGhldGlj:bm90ZQ==';
const tables = ['attachments', 'checkups', 'therapies', 'observations', 'service_prescription_items', 'service_prescriptions', 'prosthetic_prescriptions'];
const snapshot = () => [...tables, 'audit_events'].map(table => dbServer.$client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
test.after(() => { clearAllSessions(); cleanup(); dbServer.$client.close(); rmSync(directory, { recursive: true }); });
function fixture(capability: string) {
    clearAllSessions(); cookies.cookies.clear();
    dbServer.$client.exec(tables.map(table => `DELETE FROM ${table};`).join('') + 'DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories; DELETE FROM users; DELETE FROM settings;');
    dbServer.insert(ambulatories).values({ id: 'synthetic-scope', name: 'Synthetic', isDefault: true }).run();
    const authority = syntheticNetworkPatientAuthority(dbServer, 'synthetic-scope');
    authority.pairedClient.grantedCapabilities.push(capability);
    clients(authority);
    cookies.cookies.set('ambulatory_id', 'synthetic-scope');
    dbServer.insert(patients).values({ id: 'synthetic-patient', firstName: 'Synthetic', lastName: 'Commit', taxCode: 'SYNTHETIC' }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: 'synthetic-patient', ambulatoryId: 'synthetic-scope' }).run();
    const { initializeTerritorialPacks } = load('./territorial-pack-store.ts');
    openDbServer().transaction(() => initializeTerritorialPacks(openDbServer(), 'existing')).immediate();
    return { ...authority, patientId: 'synthetic-patient', checkupId: 'synthetic-row', therapyId: 'synthetic-row', observationId: 'synthetic-row', prescriptionId: 'synthetic-row', itemId: 'synthetic-row' };
}
function clients(context: ReturnType<typeof syntheticNetworkPatientAuthority>, change: Record<string, unknown> = {}) {
    const value = JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients: [{ ...context.pairedClient, ...change }], intents: [] })), archiveGeneration: currentArchiveGeneration() });
    dbServer.update(settings).set({ value }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
}
const writers: Record<string, Record<string, (context: unknown, body: unknown) => Promise<{ status: number }>>> = {
    './network-attachment-write.ts': load('./network-attachment-write.ts'),
    './network-checkup-write.ts': load('./network-checkup-write.ts'),
    './network-therapy-write.ts': load('./network-therapy-write.ts'),
    './network-observation-write.ts': load('./network-observation-write.ts'),
    './service-prescription-write.ts': load('./service-prescription-write.ts'),
    './prosthetic-prescription-write.ts': load('./prosthetic-prescription-write.ts'),
};
const cases = [
    ['attachment', 'documents', './network-attachment-write.ts', 'createNetworkScopedAttachment', null, { name: sealed, path: sealed, data: sealed, type: 'text/plain', size: 4 }, {}],
    ['checkup', 'checkups', './network-checkup-write.ts', 'createNetworkScopedCheckup', 'updateNetworkScopedCheckup', { id: 'synthetic-row', date, title: 'Synthetic', status: 'pending', source: 'manual' }, { title: 'Changed' }],
    ['therapy', 'therapies', './network-therapy-write.ts', 'createNetworkScopedTherapy', 'updateNetworkScopedTherapy', { id: 'synthetic-row', drugName: sealed, dosage: sealed, status: 'active', startDate: date }, { dosage: sealed }],
    ['observation', 'observations', './network-observation-write.ts', 'createNetworkScopedObservation', 'updateNetworkScopedObservation', { id: 'synthetic-row', codeSystem: 'LOINC', code: '8480-6', display: 'Synthetic', unitSystem: 'UCUM', unitCode: 'mm[Hg]', value: 128, observedAt: date, source: 'manual' }, { value: 130 }],
    ['service', 'service-prescriptions', './service-prescription-write.ts', 'createNetworkScopedServicePrescription', 'updateNetworkScopedServicePrescription', { id: 'synthetic-row', prescribedAt: date, serviceName: 'Synthetic service', source: 'manual' }, { serviceName: 'Changed' }],
    ['service-item', 'service-prescriptions', './service-prescription-write.ts', 'createNetworkScopedServicePrescriptionItem', 'updateNetworkScopedServicePrescriptionItem', { id: 'synthetic-row', prescriptionId: 'synthetic-parent', ordinal: 1, serviceName: 'Synthetic item', category: 'other', status: 'prescribed', matchStatus: 'manual', confidence: 'high' }, { serviceName: 'Changed' }],
    ['prosthetic', 'prosthetic-prescriptions', './prosthetic-prescription-write.ts', 'createNetworkScopedProstheticPrescription', 'updateNetworkScopedProstheticPrescription', { id: 'synthetic-row', prescribedAt: date, description: 'Synthetic device', category: 'standard', status: 'submitted', source: 'manual' }, { description: 'Changed' }],
] as const;
for (const [domain, capability, file, create, update, payload, patch] of cases) {
    for (const operation of update ? ['create', 'update', 'replay'] : ['create']) {
        for (const revoke of ['pairing', 'token', 'capability', 'mode', 'session', 'scope', 'archive']) {
            test(`${domain} ${operation}: ${revoke} changed after admission denies with no write or success receipt`, async () => {
                const context = fixture(`network.replica.write-${capability}`);
                if (domain === 'service-item') dbServer.insert(servicePrescriptions).values({ id: 'synthetic-parent', patientId: context.patientId, prescribedAt: new Date(date), serviceName: 'Synthetic parent', status: 'prescribed', category: 'other', source: 'manual' }).run();
                const writer = writers[file];
                if (operation !== 'create') assert.equal((await writer[create](context, payload)).status, 201);
                if (revoke === 'pairing') clients(context, { clientId: 'different-client' });
                if (revoke === 'token') clients(context, { tokenHash: '0'.repeat(64) });
                if (revoke === 'capability') clients(context, { grantedCapabilities: [] });
                if (revoke === 'mode') dbServer.update(settings).set({ value: 'local-only' }).where(eq(settings.key, 'network.mode')).run();
                if (revoke === 'session') retireServerSessionForLogout(context.session.id);
                if (revoke === 'scope') dbServer.update(ambulatories).set({ isDefault: false }).run();
                if (revoke === 'scope') cookies.cookies.clear();
                if (revoke === 'archive') dbServer.$client.prepare('UPDATE archive_generation SET generation = ? WHERE id = 1').run(crypto.randomUUID());
                const before = snapshot();
                const pending = writer[operation === 'update' ? update! : create](context, operation === 'update' ? { ...patch, version: 1 } : payload);
                if (revoke === 'archive') { await assert.rejects(pending, { name: 'ArchiveReplacedError' }); assert.deepEqual(snapshot(), before); return; }
                const result = await pending;
                assert.equal(result.status, ['pairing', 'token', 'session'].includes(revoke) ? 401 : 403);
                assert.deepEqual(snapshot(), before);
            });
        }
    }
}
