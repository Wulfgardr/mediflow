import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import type { ServerSession } from './security/server-session.ts';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

type LoadedModules = {
    dbServer: typeof import('./db-server.ts').dbServer;
    schema: typeof import('./schema.ts');
    createAmbulatory: typeof import('./ambulatory-write.ts').createAmbulatory;
    updateAmbulatory: typeof import('./ambulatory-write.ts').updateAmbulatory;
    deleteAmbulatory: typeof import('./ambulatory-write.ts').deleteAmbulatory;
    clearAmbulatory: typeof import('./ambulatory-write.ts').clearAmbulatory;
    createNetworkAmbulatory: typeof import('./network-ambulatory-write.ts').createNetworkAmbulatory;
};

let modulesPromise: Promise<LoadedModules> | null = null;

function bootstrapDatabaseFile(dataDir: string): void {
    fs.mkdirSync(dataDir, { recursive: true });
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        for (const fileName of fs.readdirSync(path.join(ROOT_DIR, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
            sqlite.exec(fs.readFileSync(path.join(ROOT_DIR, 'drizzle', fileName), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
        }
    } finally {
        sqlite.close();
    }
}

async function loadModules(): Promise<LoadedModules> {
    if (!modulesPromise) {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ambulatory-write-'));
        bootstrapDatabaseFile(dataDir);
        process.env.MEDIFLOW_DATA_DIR = dataDir;
        modulesPromise = Promise.all([
            import('./db-server.ts'), import('./schema.ts'), import('./ambulatory-write.ts'), import('./network-ambulatory-write.ts'),
        ]).then(([dbServerModule, schema, ambulatoryWrite, networkWrite]) => ({
            dbServer: dbServerModule.dbServer, schema, ...ambulatoryWrite, ...networkWrite,
        }));
    }
    return modulesPromise;
}

function adminSession(role: 'admin' | 'operator' = 'admin'): ServerSession {
    const testUsername = 'ambulatory-test';
    return {
        id: 'ambulatory-test-session', userId: 'ambulatory-test-user', username: testUsername, role,
        authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
    };
}

function request(): Request {
    return new Request('http://localhost/api/v1/network/ambulatories', { headers: { 'x-request-id': 'ambulatory-test-request' } });
}

async function resetDatabase(modules: LoadedModules): Promise<void> {
    modules.dbServer.delete(modules.schema.patientsToAmbulatories).run();
    modules.dbServer.delete(modules.schema.patients).run();
    // audit_events is append-only by design; assertions filter their own subject.
    modules.dbServer.delete(modules.schema.ambulatories).run();
}

async function seed(modules: LoadedModules, id: string, isDefault: boolean, version = 1, type: 'live' | 'test' = 'live'): Promise<void> {
    modules.dbServer.insert(modules.schema.ambulatories).values({ id, name: id, isDefault, version, type, createdAt: new Date() }).run();
}

test('ambulatory writes return a version conflict and prohibit direct default removal', async () => {
    const modules = await loadModules();
    await resetDatabase(modules);
    await seed(modules, 'amb-default', true, 3);

    const stale = modules.updateAmbulatory('amb-default', { name: 'Changed', version: 2 });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.value, {
        error: 'Conflict', code: 'VERSION_CONFLICT', entity: 'ambulatory', recordId: 'amb-default',
        expectedVersion: 2, currentVersion: 3, currentUpdatedAt: null, currentState: 'present',
        currentSnapshot: { id: 'amb-default', version: 3, isDefault: true, type: 'live' },
    });

    const directUnset = modules.updateAmbulatory('amb-default', { isDefault: false, version: 3 });
    assert.equal(directUnset.status, 409);
    assert.equal(directUnset.value.error, 'Cannot unset default directly. Set another ambulatory as default first.');
});

test('default promotion and fallback deletion bump every surviving ambulatory version', async () => {
    const modules = await loadModules();
    await resetDatabase(modules);
    await seed(modules, 'amb-a', true, 2);
    await seed(modules, 'amb-b', false, 5);

    const promote = modules.updateAmbulatory('amb-b', { isDefault: true, version: 5 });
    assert.equal(promote.status, 200);
    assert.deepEqual(promote.value.affectedAmbulatories, [{ id: 'amb-a', version: 3 }, { id: 'amb-b', version: 6 }]);
    const demoted = modules.dbServer.select().from(modules.schema.ambulatories).where(eq(modules.schema.ambulatories.id, 'amb-a')).get();
    assert.equal(demoted?.version, 3);
    assert.equal(demoted?.isDefault, false);

    const deleted = modules.deleteAmbulatory('amb-b', 6);
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.value.affectedAmbulatories, [{ id: 'amb-a', version: 4 }]);
    const fallback = modules.dbServer.select().from(modules.schema.ambulatories).where(eq(modules.schema.ambulatories.id, 'amb-a')).get();
    assert.equal(fallback?.version, 4);
    assert.equal(fallback?.isDefault, true);
});

test('ambulatory deletion preserves the asymmetric last, primary-patient, and membership guards', async () => {
    const modules = await loadModules();
    await resetDatabase(modules);
    await seed(modules, 'amb-last', true);
    assert.equal(modules.deleteAmbulatory('amb-last', 1).value.error, 'Cannot delete the last ambulatory');
    await seed(modules, 'amb-other', false);
    modules.dbServer.insert(modules.schema.patients).values({ id: 'patient-primary', firstName: 'Test', lastName: 'Primary', taxCode: 'PRIMARYXXXXXXXXX', ambulatoryId: 'amb-last', version: 1 }).run();
    assert.equal(modules.deleteAmbulatory('amb-last', 1).value.error, 'Ambulatory still has linked patients. Move/unassign patients before deletion.');
    modules.dbServer.update(modules.schema.patients).set({ ambulatoryId: null }).where(eq(modules.schema.patients.id, 'patient-primary')).run();
    modules.dbServer.insert(modules.schema.patientsToAmbulatories).values({ patientId: 'patient-primary', ambulatoryId: 'amb-last', assignedAt: new Date() }).run();
    assert.equal(modules.deleteAmbulatory('amb-last', 1).value.error, 'Ambulatory still has linked patients. Move/unassign patients before deletion.');
});

test('test-container clear is admin-only, test-only, version-guarded, and bumps its version after tombstoning', async () => {
    const modules = await loadModules();
    await resetDatabase(modules);
    await seed(modules, 'amb-live', true, 1, 'live');
    assert.equal((await modules.clearAmbulatory({ request: request(), session: adminSession('operator') }, 'amb-live', 1)).status, 403);
    assert.equal((await modules.clearAmbulatory({ request: request(), session: adminSession() }, 'amb-live', 1)).status, 403);
    await seed(modules, 'amb-test', false, 2, 'test');
    modules.dbServer.insert(modules.schema.patients).values({ id: 'patient-test', firstName: 'Test', lastName: 'Container', taxCode: 'TESTCONTAINERXXX', version: 4 }).run();
    modules.dbServer.insert(modules.schema.patientsToAmbulatories).values({ patientId: 'patient-test', ambulatoryId: 'amb-test', assignedAt: new Date() }).run();
    assert.equal((await modules.clearAmbulatory({ request: request(), session: adminSession() }, 'amb-test', 1)).status, 409);
    const cleared = await modules.clearAmbulatory({ request: request(), session: adminSession() }, 'amb-test', 2);
    assert.equal(cleared.status, 200);
    assert.equal(cleared.value.version, 3);
    const target = modules.dbServer.select().from(modules.schema.ambulatories).where(eq(modules.schema.ambulatories.id, 'amb-test')).get();
    const patient = modules.dbServer.select().from(modules.schema.patients).where(eq(modules.schema.patients.id, 'patient-test')).get();
    assert.equal(target?.version, 3);
    assert.equal(patient?.version, 5);
    assert.ok(patient?.deletedAt);
});

test('network ambulatory writes emit paired-client scope audit flags', async () => {
    const modules = await loadModules();
    await resetDatabase(modules);
    const context = {
        request: request(), scopeAmbulatoryId: 'scope-amb', session: adminSession(),
        pairedClient: { clientId: 'paired-amb-client' },
    } as Parameters<LoadedModules['createNetworkAmbulatory']>[0];
    const created = await modules.createNetworkAmbulatory(context, { id: 'amb-network', name: 'Network ambulatory' });
    assert.equal(created.status, 201);
    const audit = modules.dbServer.select().from(modules.schema.auditEvents)
        .where(and(eq(modules.schema.auditEvents.eventType, 'ambulatory.created'), eq(modules.schema.auditEvents.subjectRef, 'amb-network'))).get();
    assert.ok(audit);
    const metadata = JSON.parse(audit?.redactedMetadata ?? '{}') as { flags?: string[] };
    assert.deepEqual(metadata.flags, ['auth:paired-client', 'paired-client:paired-amb-client', 'scope:ambulatory']);
});
