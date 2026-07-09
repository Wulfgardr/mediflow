/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { ambulatories, patients, patientsToAmbulatories } from './schema';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-network-patient-write-'));
process.env.MEDIFLOW_DATA_DIR = DATA_DIR;

function bootstrapDatabase(): void {
    const sqlite = new Database(path.join(DATA_DIR, 'medical.db'));
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

bootstrapDatabase();

const { dbServer } = await import('./db-server.ts');
const { updateNetworkScopedPatient } = await import('./network-patient-write.ts');

const SCOPE_AMBULATORY = 'amb-write-scope';
const PATIENT_ID = 'patient-write-1';

function makeContext() {
    return {
        request: new Request('https://localhost/api/v1/network/patients/' + PATIENT_ID),
        patientId: PATIENT_ID,
        scopeAmbulatoryId: SCOPE_AMBULATORY,
        pairedClient: { clientId: 'client-test' } as never,
        session: { userId: 'user-test' } as never,
    };
}

function resetDatabase(): void {
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values([{ id: SCOPE_AMBULATORY, name: 'Ambulatorio Write', type: 'live' }]).run();
    dbServer.insert(patients).values([{
        id: PATIENT_ID,
        firstName: 'Ada',
        lastName: 'Sealed',
        taxCode: 'ADASEALED01',
        archiveReason: 'ENC:iv:previous-reason',
        version: 3,
    }]).run();
    dbServer.insert(patientsToAmbulatories).values([{ patientId: PATIENT_ID, ambulatoryId: SCOPE_AMBULATORY }]).run();
}

test('network update rejects plaintext archive reason and note', async () => {
    resetDatabase();
    for (const body of [
        { version: 3, archiveReason: 'motivo in chiaro' },
        { version: 3, archiveNote: 'nota in chiaro' },
    ]) {
        const result = await updateNetworkScopedPatient(makeContext(), body);
        assert.equal(result.status, 400);
        assert.deepEqual(result.value, { error: 'Network update requires sealed archive fields' });
    }
    const row = dbServer.select().from(patients).all()[0];
    assert.equal(row.archiveReason, 'ENC:iv:previous-reason');
    assert.equal(row.version, 3);
});

test('network update accepts sealed archive fields and null clearing', async () => {
    resetDatabase();
    const sealed = await updateNetworkScopedPatient(makeContext(), {
        version: 3,
        isArchived: true,
        archiveReason: 'ENC:iv:new-reason',
        archiveNote: 'ENC:iv:new-note',
    });
    assert.equal(sealed.status, 200);
    let row = dbServer.select().from(patients).all()[0];
    assert.equal(row.archiveReason, 'ENC:iv:new-reason');
    assert.equal(row.archiveNote, 'ENC:iv:new-note');
    assert.equal(row.version, 4);

    const cleared = await updateNetworkScopedPatient(makeContext(), {
        version: 4,
        isArchived: false,
        archiveReason: null,
        archiveNote: null,
    });
    assert.equal(cleared.status, 200);
    row = dbServer.select().from(patients).all()[0];
    assert.equal(row.archiveReason, null);
    assert.equal(row.archiveNote, null);
});
