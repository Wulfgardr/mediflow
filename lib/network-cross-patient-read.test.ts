/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { ambulatories, checkups, entries, patients, patientsToAmbulatories } from './schema';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-network-cross-patient-read-'));
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
const { listNetworkScopedCheckupsForAmbulatory } = await import('./network-checkup-read.ts');
const { listNetworkScopedEntriesForAmbulatory } = await import('./network-entry-read.ts');
const { listNetworkScopedPatients } = await import('./network-patient-read.ts');

const IN_SCOPE_AMBULATORY = 'amb-in-scope';
const OTHER_AMBULATORY = 'amb-other';

function resetDatabase(): void {
    dbServer.delete(entries).run();
    dbServer.delete(checkups).run();
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
}

function seedScopedRows(): void {
    dbServer.insert(ambulatories).values([
        { id: IN_SCOPE_AMBULATORY, name: 'Ambulatorio Scope', type: 'live' },
        { id: OTHER_AMBULATORY, name: 'Ambulatorio Altro', type: 'live' },
    ]).run();
    dbServer.insert(patients).values([
        {
            id: 'patient-in-1',
            firstName: 'Ada',
            lastName: 'InScope',
            taxCode: 'ADAINSCOPE1',
            diagnoses: 'ENC:iv:diagnoses-1',
            version: 1,
        },
        {
            id: 'patient-in-2',
            firstName: 'Bea',
            lastName: 'InScope',
            taxCode: 'BEAINSCOPE2',
            diagnoses: 'ENC:iv:diagnoses-2',
            version: 1,
        },
        {
            id: 'patient-out',
            firstName: 'Cia',
            lastName: 'Outside',
            taxCode: 'CIAOUTSIDE3',
            diagnoses: 'ENC:iv:diagnoses-3',
            version: 1,
        },
    ]).run();
    dbServer.insert(patientsToAmbulatories).values([
        { patientId: 'patient-in-1', ambulatoryId: IN_SCOPE_AMBULATORY },
        { patientId: 'patient-in-2', ambulatoryId: IN_SCOPE_AMBULATORY },
        { patientId: 'patient-out', ambulatoryId: OTHER_AMBULATORY },
    ]).run();
}

test('cross-patient agenda is ambulatory-scoped, plaintext-filtered, and ascending', async () => {
    resetDatabase();
    seedScopedRows();
    dbServer.insert(checkups).values([
        {
            id: 'checkup-later',
            patientId: 'patient-in-1',
            date: new Date('2026-07-11T10:00:00.000Z'),
            title: 'Controllo',
            notes: 'ENC:iv:notes-later',
            status: 'pending',
            version: 1,
        },
        {
            id: 'checkup-earlier',
            patientId: 'patient-in-2',
            date: new Date('2026-07-10T10:00:00.000Z'),
            title: 'Visita',
            notes: 'ENC:iv:notes-earlier',
            status: 'completed',
            version: 1,
        },
        {
            id: 'checkup-outside-scope',
            patientId: 'patient-out',
            date: new Date('2026-07-09T10:00:00.000Z'),
            title: 'Escluso',
            notes: 'ENC:iv:notes-outside',
            status: 'pending',
            version: 1,
        },
    ]).run();

    const result = await listNetworkScopedCheckupsForAmbulatory(IN_SCOPE_AMBULATORY, {
        status: ['pending', 'completed'],
        limit: 500,
    });

    assert.deepEqual(result.map((item) => item.id), ['checkup-earlier', 'checkup-later']);
    assert.equal(result[0]?.notes, 'ENC:iv:notes-earlier');
    assert.equal(result.some((item) => item.patientId === 'patient-out'), false);
});

test('cross-patient diary preserves tombstones and never returns another ambulatory', async () => {
    resetDatabase();
    seedScopedRows();
    dbServer.insert(entries).values([
        {
            id: 'entry-newer-deleted',
            patientId: 'patient-in-1',
            type: 'note',
            title: 'ENC:iv:title-newer',
            date: new Date('2026-07-11T10:00:00.000Z'),
            content: 'ENC:iv:content-newer',
            metadata: 'ENC:iv:metadata-newer',
            attachments: 'ENC:iv:attachments-newer',
            deletedAt: new Date('2026-07-12T10:00:00.000Z'),
            deletionReason: 'ENC:iv:reason-newer',
            version: 2,
        },
        {
            id: 'entry-older',
            patientId: 'patient-in-2',
            type: 'note',
            title: 'ENC:iv:title-older',
            date: new Date('2026-07-10T10:00:00.000Z'),
            content: 'ENC:iv:content-older',
            version: 1,
        },
        {
            id: 'entry-outside-scope',
            patientId: 'patient-out',
            type: 'note',
            title: 'ENC:iv:title-outside',
            date: new Date('2026-07-12T10:00:00.000Z'),
            content: 'ENC:iv:content-outside',
            version: 1,
        },
    ]).run();

    const result = await listNetworkScopedEntriesForAmbulatory(IN_SCOPE_AMBULATORY, {
        type: 'note',
        limit: 100,
    });

    assert.deepEqual(result.map((item) => item.id), ['entry-newer-deleted', 'entry-older']);
    assert.ok(result[0]?.deletedAt);
    assert.equal(result[0]?.deletionReason, 'ENC:iv:reason-newer');
    assert.equal(result.some((item) => item.patientId === 'patient-out'), false);
});

test('patient diagnoses are opt-in ciphertext and do not change the default summary', async () => {
    resetDatabase();
    seedScopedRows();

    const defaultResult = await listNetworkScopedPatients(IN_SCOPE_AMBULATORY);
    const includedResult = await listNetworkScopedPatients(IN_SCOPE_AMBULATORY, { includeDiagnoses: true });

    assert.equal(Object.hasOwn(defaultResult[0] ?? {}, 'diagnoses'), false);
    assert.equal(includedResult[0]?.diagnoses?.startsWith('ENC:'), true);
    assert.equal(includedResult.some((item) => item.id === 'patient-out'), false);
});
