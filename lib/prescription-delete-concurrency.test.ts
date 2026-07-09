import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE_NAME, type ServerSession } from './security/server-session.ts';
import type { dbServer as DbServer } from './db-server.ts';
import type {
    patients,
    prostheticPrescriptions,
    servicePrescriptionItems,
    servicePrescriptions,
} from './schema.ts';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

type LoadedModules = {
    dbServer: typeof DbServer;
    schema: {
        patients: typeof patients;
        prostheticPrescriptions: typeof prostheticPrescriptions;
        servicePrescriptionItems: typeof servicePrescriptionItems;
        servicePrescriptions: typeof servicePrescriptions;
    };
    deleteHostServicePrescription: typeof import('./service-prescription-write.ts').deleteHostServicePrescription;
    deleteHostServicePrescriptionItem: typeof import('./service-prescription-write.ts').deleteHostServicePrescriptionItem;
    deleteHostProstheticPrescription: typeof import('./prosthetic-prescription-write.ts').deleteHostProstheticPrescription;
    requireExpectedVersion: typeof import('./version-concurrency.ts').requireExpectedVersion;
};

let modulesPromise: Promise<LoadedModules> | null = null;

function bootstrapDatabaseFile(dataDir: string): void {
    fs.mkdirSync(dataDir, { recursive: true });
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        const migrationsDir = path.join(ROOT_DIR, 'drizzle');
        const migrationFiles = fs
            .readdirSync(migrationsDir)
            .filter((file) => file.endsWith('.sql'))
            .sort((left, right) => left.localeCompare(right));
        for (const fileName of migrationFiles) {
            const sql = fs
                .readFileSync(path.join(migrationsDir, fileName), 'utf8')
                .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
            if (sql.trim().length > 0) sqlite.exec(sql);
        }
    } finally {
        sqlite.close();
    }
}

async function loadModules(): Promise<LoadedModules> {
    if (!modulesPromise) {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-prescription-delete-'));
        bootstrapDatabaseFile(dataDir);
        process.env.MEDIFLOW_DATA_DIR = dataDir;
        modulesPromise = Promise.all([
            import('./db-server.ts'),
            import('./schema.ts'),
            import('./service-prescription-write.ts'),
            import('./prosthetic-prescription-write.ts'),
            import('./version-concurrency.ts'),
        ]).then(([dbServerModule, schema, serviceWrite, prostheticWrite, versionConcurrency]) => ({
            dbServer: dbServerModule.dbServer,
            schema,
            deleteHostServicePrescription: serviceWrite.deleteHostServicePrescription,
            deleteHostServicePrescriptionItem: serviceWrite.deleteHostServicePrescriptionItem,
            deleteHostProstheticPrescription: prostheticWrite.deleteHostProstheticPrescription,
            requireExpectedVersion: versionConcurrency.requireExpectedVersion,
        }));
    }
    return modulesPromise;
}

function fakeContext(id: string): Parameters<LoadedModules['deleteHostServicePrescription']>[0] {
    const session: ServerSession = {
        id: 'test-session',
        userId: 'test-user',
        username: 'prescription-delete-user',
        role: 'admin',
        authChannel: 'web',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
    };
    return {
        id,
        request: new Request('http://localhost/test', {
            headers: { cookie: `${SESSION_COOKIE_NAME}=test-session` },
        }),
        session,
    };
}

async function seedPatient(modules: LoadedModules, patientId: string): Promise<void> {
    modules.dbServer.insert(modules.schema.patients).values({
        id: patientId,
        firstName: 'Test',
        lastName: 'Patient',
        taxCode: patientId.toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(16, 'X').slice(0, 16),
        version: 1,
    }).run();
}

test('host service prescription DELETE requires the matching version before cascading items', async () => {
    const modules = await loadModules();
    const patientId = 'patient-service-delete';
    const prescriptionId = 'service-delete-parent';
    const itemId = 'service-delete-child';
    await seedPatient(modules, patientId);
    modules.dbServer.insert(modules.schema.servicePrescriptions).values({
        id: prescriptionId,
        patientId,
        prescribedAt: new Date('2026-07-08T08:00:00.000Z'),
        serviceName: 'Emocromo',
        status: 'prescribed',
        category: 'lab',
        source: 'manual',
        version: 3,
    }).run();
    modules.dbServer.insert(modules.schema.servicePrescriptionItems).values({
        id: itemId,
        patientId,
        prescriptionId,
        serviceName: 'Emocromo completo',
        status: 'prescribed',
        matchStatus: 'unmatched',
        version: 1,
    }).run();

    const stale = await modules.deleteHostServicePrescription(fakeContext(prescriptionId), 2);
    assert.equal(stale.status, 409);
    assert.equal(stale.value.code, 'VERSION_CONFLICT');
    assert.equal(stale.value.entity, 'service_prescription');
    assert.ok(modules.dbServer.select().from(modules.schema.servicePrescriptions).where(eq(modules.schema.servicePrescriptions.id, prescriptionId)).get());
    assert.ok(modules.dbServer.select().from(modules.schema.servicePrescriptionItems).where(eq(modules.schema.servicePrescriptionItems.id, itemId)).get());

    const ok = await modules.deleteHostServicePrescription(fakeContext(prescriptionId), 3);
    assert.equal(ok.status, 200);
    assert.equal(modules.dbServer.select().from(modules.schema.servicePrescriptionItems).where(eq(modules.schema.servicePrescriptionItems.id, itemId)).get(), undefined);
    assert.equal(modules.dbServer.select().from(modules.schema.servicePrescriptions).where(eq(modules.schema.servicePrescriptions.id, prescriptionId)).get(), undefined);
});

test('host service prescription item DELETE is version-guarded', async () => {
    const modules = await loadModules();
    const patientId = 'patient-item-delete';
    const prescriptionId = 'service-delete-item-parent';
    const itemId = 'service-delete-item';
    await seedPatient(modules, patientId);
    modules.dbServer.insert(modules.schema.servicePrescriptions).values({
        id: prescriptionId,
        patientId,
        prescribedAt: new Date('2026-07-08T08:00:00.000Z'),
        serviceName: 'Radiografia',
        status: 'prescribed',
        category: 'imaging',
        source: 'manual',
        version: 1,
    }).run();
    modules.dbServer.insert(modules.schema.servicePrescriptionItems).values({
        id: itemId,
        patientId,
        prescriptionId,
        serviceName: 'Rx torace',
        status: 'prescribed',
        matchStatus: 'unmatched',
        version: 4,
    }).run();

    const stale = await modules.deleteHostServicePrescriptionItem(fakeContext(itemId), 3);
    assert.equal(stale.status, 409);
    assert.equal(stale.value.entity, 'service_prescription_item');
    assert.ok(modules.dbServer.select().from(modules.schema.servicePrescriptionItems).where(eq(modules.schema.servicePrescriptionItems.id, itemId)).get());

    const ok = await modules.deleteHostServicePrescriptionItem(fakeContext(itemId), 4);
    assert.equal(ok.status, 200);
    assert.equal(modules.dbServer.select().from(modules.schema.servicePrescriptionItems).where(eq(modules.schema.servicePrescriptionItems.id, itemId)).get(), undefined);
});

test('host prosthetic prescription DELETE is version-guarded', async () => {
    const modules = await loadModules();
    const patientId = 'patient-prosthetic-delete';
    const prescriptionId = 'prosthetic-delete';
    await seedPatient(modules, patientId);
    modules.dbServer.insert(modules.schema.prostheticPrescriptions).values({
        id: prescriptionId,
        patientId,
        prescribedAt: new Date('2026-07-08T08:00:00.000Z'),
        description: 'Ausilio test',
        status: 'prescribed',
        category: 'standard',
        source: 'manual',
        version: 6,
    }).run();

    const stale = await modules.deleteHostProstheticPrescription(fakeContext(prescriptionId), 5);
    assert.equal(stale.status, 409);
    assert.equal(stale.value.entity, 'prosthetic_prescription');
    assert.ok(modules.dbServer.select().from(modules.schema.prostheticPrescriptions).where(eq(modules.schema.prostheticPrescriptions.id, prescriptionId)).get());

    const ok = await modules.deleteHostProstheticPrescription(fakeContext(prescriptionId), 6);
    assert.equal(ok.status, 200);
    assert.equal(modules.dbServer.select().from(modules.schema.prostheticPrescriptions).where(eq(modules.schema.prostheticPrescriptions.id, prescriptionId)).get(), undefined);
});

test('host prescription DELETE routes reject missing version with the standard 400 shape', async () => {
    const modules = await loadModules();
    assert.deepEqual(modules.requireExpectedVersion(undefined), {
        ok: false,
        status: 400,
        value: { error: 'Version is required' },
    });
});
