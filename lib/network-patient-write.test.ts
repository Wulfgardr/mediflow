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
        archiveReason: 'ENC:iv:previousreason',
        version: 3,
    }]).run();
    dbServer.insert(patientsToAmbulatories).values([{ patientId: PATIENT_ID, ambulatoryId: SCOPE_AMBULATORY }]).run();
}

test('network update rejects plaintext sensitive fields', async () => {
    resetDatabase();
    for (const field of [
        'address',
        'phone',
        'caregiver',
        'exemptions',
        'diagnoses',
        'notes',
        'statusReason',
        'archiveReason',
        'archiveNote',
    ]) {
        const body = { version: 3, [field]: 'valore in chiaro' };
        const result = await updateNetworkScopedPatient(makeContext(), body);
        assert.equal(result.status, 400);
        assert.deepEqual(result.value, { error: 'Network update requires sealed sensitive fields' });
    }
    const row = dbServer.select().from(patients).all()[0];
    assert.equal(row.archiveReason, 'ENC:iv:previousreason');
    assert.equal(row.version, 3);
});

test('network update rejects plaintext smuggled behind an ENC: prefix', async () => {
    resetDatabase();
    // The sealed guard must reject values that only look sealed by prefix:
    // raw JSON, free text with spaces, or a missing envelope segment would
    // otherwise land plaintext in a ciphertext-only column.
    const spoofed = [
        'ENC:["patient-id"]',
        'ENC: +39 333 1234567',
        'ENC:onlyonesegment',
        'ENC::',
        'ENC:iv:has-a-hyphen',
    ];
    for (const value of spoofed) {
        const result = await updateNetworkScopedPatient(makeContext(), { version: 3, diagnoses: value });
        assert.equal(result.status, 400, `expected 400 for spoofed value ${value}`);
        assert.deepEqual(result.value, { error: 'Network update requires sealed sensitive fields' });
    }
    const row = dbServer.select().from(patients).all()[0];
    assert.equal(row.version, 3);
});

test('network update accepts sealed sensitive fields and null clearing', async () => {
    resetDatabase();
    const sealed = await updateNetworkScopedPatient(makeContext(), {
        version: 3,
        isArchived: true,
        phone: 'ENC:iv:newphone',
        diagnoses: 'ENC:iv:newdiagnoses',
        archiveReason: 'ENC:iv:newreason',
        archiveNote: 'ENC:iv:newnote',
    });
    assert.equal(sealed.status, 200);
    let row = dbServer.select().from(patients).all()[0];
    assert.equal(row.archiveReason, 'ENC:iv:newreason');
    assert.equal(row.archiveNote, 'ENC:iv:newnote');
    assert.equal(row.phone, 'ENC:iv:newphone');
    assert.equal(row.diagnoses, 'ENC:iv:newdiagnoses');
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
