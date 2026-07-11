/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import {
    commitPatientSmartImport,
    type PatientSmartImportTherapyValues,
} from './patient-smart-import-apply';
import { patients, therapies } from './schema';

function makeDatabase() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE patients (
            id TEXT PRIMARY KEY NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            tax_code TEXT NOT NULL,
            diagnoses TEXT,
            is_archived INTEGER DEFAULT 0,
            deleted_at INTEGER,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER
        );
        CREATE TABLE therapies (
            id TEXT PRIMARY KEY NOT NULL,
            patient_id TEXT NOT NULL,
            drug_name TEXT NOT NULL,
            aic TEXT,
            atc TEXT,
            active_principle TEXT,
            dosage TEXT NOT NULL,
            motivation TEXT,
            diagnosis_code TEXT,
            diagnosis_name TEXT,
            status TEXT NOT NULL,
            start_date INTEGER NOT NULL,
            end_date INTEGER,
            version INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER,
            updated_at INTEGER,
            deleted_at INTEGER,
            deletion_reason TEXT
        );
    `);
    const database = drizzle(sqlite);
    sqlite.prepare(`
        INSERT INTO patients (id, first_name, last_name, tax_code, diagnoses, version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        'patient-synthetic',
        'Paziente',
        'Sintetico',
        'SYNTHETIC0000000',
        'ENC:b2xk:dmFsdWU=',
        3,
        1783800000,
    );
    return { sqlite, database };
}

function therapy(id: string): PatientSmartImportTherapyValues {
    const now = new Date('2026-07-11T20:01:00.000Z');
    return {
        id,
        patientId: 'patient-synthetic',
        drugName: 'Farmaco sintetico',
        aic: null,
        atc: null,
        activePrinciple: null,
        dosage: '1 compressa',
        motivation: 'ENC:bW90:aXZhemlvbmU=',
        diagnosisCode: null,
        diagnosisName: null,
        status: 'active',
        startDate: now,
        endDate: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletionReason: null,
    };
}

test('Smart Import rolls back diagnoses and created therapies when a later insert fails', () => {
    const { sqlite, database } = makeDatabase();
    try {
        assert.throws(() => commitPatientSmartImport(database, {
            patientId: 'patient-synthetic',
            expectedVersion: 3,
            diagnoses: 'ENC:bmV3:dmFsdWU=',
            therapies: [therapy('therapy-duplicate'), therapy('therapy-duplicate')],
        }));

        const patient = database.select({
            diagnoses: patients.diagnoses,
            version: patients.version,
        }).from(patients).where(eq(patients.id, 'patient-synthetic')).get();
        const therapyRows = database.select().from(therapies).all();

        assert.deepEqual(patient, { diagnoses: 'ENC:b2xk:dmFsdWU=', version: 3 });
        assert.equal(therapyRows.length, 0);
    } finally {
        sqlite.close();
    }
});

test('Smart Import commits the patient update and therapy inserts together', () => {
    const { sqlite, database } = makeDatabase();
    try {
        const result = commitPatientSmartImport(database, {
            patientId: 'patient-synthetic',
            expectedVersion: 3,
            diagnoses: 'ENC:bmV3:dmFsdWU=',
            therapies: [therapy('therapy-created')],
        });

        assert.equal(result.status, 200);
        const patient = database.select({
            diagnoses: patients.diagnoses,
            version: patients.version,
        }).from(patients).where(eq(patients.id, 'patient-synthetic')).get();
        assert.deepEqual(patient, { diagnoses: 'ENC:bmV3:dmFsdWU=', version: 4 });
        assert.equal(database.select().from(therapies).all().length, 1);
    } finally {
        sqlite.close();
    }
});
