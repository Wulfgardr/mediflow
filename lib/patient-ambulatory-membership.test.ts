import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { patients, patientsToAmbulatories } from './schema';
import {
    normalizePrimaryAmbulatoryIdInput,
    resolvePrimaryAmbulatoryId,
    upsertPrimaryAmbulatoryMembership,
} from './patient-ambulatory-membership';
import { normalizePatientUpdateInput } from './patient-write-normalization';

const PATIENT_ID = 'pat-1';

function createDb() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE patients (
            id TEXT PRIMARY KEY NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            tax_code TEXT NOT NULL,
            birth_date INTEGER,
            address TEXT,
            phone TEXT,
            caregiver TEXT,
            exemptions TEXT,
            diagnoses TEXT,
            monitoring_profile TEXT,
            status_reason TEXT,
            notes TEXT,
            ai_summary TEXT,
            -- @Codex: keep the focused fixture aligned with every patients column Drizzle inserts.
            ai_summary_generated_at INTEGER,
            ai_summary_context_hash TEXT,
            document_insights TEXT,
            is_adi INTEGER DEFAULT 0,
            is_archived INTEGER DEFAULT 0,
            archive_reason TEXT,
            archive_note TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            deleted_at INTEGER,
            deletion_reason TEXT,
            ambulatory_id TEXT,
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch())
        );
        CREATE TABLE patients_to_ambulatories (
            patient_id TEXT NOT NULL,
            ambulatory_id TEXT NOT NULL,
            assigned_at INTEGER,
            PRIMARY KEY (patient_id, ambulatory_id)
        );
    `);
    return drizzle(sqlite);
}

function seedPatient(db: ReturnType<typeof createDb>, ambulatoryIds: string[]) {
    db.insert(patients).values({
        id: PATIENT_ID,
        firstName: 'Mario',
        lastName: 'Rossi',
        taxCode: 'RSSMRA80A01H501U',
        version: 1,
        ambulatoryId: ambulatoryIds[0] ?? null,
    }).run();

    for (const ambulatoryId of ambulatoryIds) {
        db.insert(patientsToAmbulatories).values({
            patientId: PATIENT_ID,
            ambulatoryId,
            assignedAt: new Date(0),
        }).run();
    }
}

function listMemberships(db: ReturnType<typeof createDb>): string[] {
    return db
        .select({ ambulatoryId: patientsToAmbulatories.ambulatoryId })
        .from(patientsToAmbulatories)
        .where(eq(patientsToAmbulatories.patientId, PATIENT_ID))
        .all()
        .map((row) => row.ambulatoryId)
        .sort();
}

function getPrimaryColumn(db: ReturnType<typeof createDb>): string | null {
    const row = db
        .select({ ambulatoryId: patients.ambulatoryId })
        .from(patients)
        .where(eq(patients.id, PATIENT_ID))
        .get();
    return row?.ambulatoryId ?? null;
}

test('resolvePrimaryAmbulatoryId accepts non-empty strings only', () => {
    assert.equal(resolvePrimaryAmbulatoryId('amb-1'), 'amb-1');
    assert.equal(resolvePrimaryAmbulatoryId(''), null);
    assert.equal(resolvePrimaryAmbulatoryId('   '), null);
    assert.equal(resolvePrimaryAmbulatoryId(null), null);
    assert.equal(resolvePrimaryAmbulatoryId(undefined), null);
    assert.equal(resolvePrimaryAmbulatoryId(42), null);
});

test('normalizePrimaryAmbulatoryIdInput sets, clears, or ignores the primary column', () => {
    assert.equal(normalizePrimaryAmbulatoryIdInput('amb-2'), 'amb-2');
    assert.equal(normalizePrimaryAmbulatoryIdInput(null), null);
    assert.equal(normalizePrimaryAmbulatoryIdInput(''), undefined);
    assert.equal(normalizePrimaryAmbulatoryIdInput('  '), undefined);
    assert.equal(normalizePrimaryAmbulatoryIdInput(42), undefined);
    assert.equal(normalizePrimaryAmbulatoryIdInput(undefined), undefined);
});

test('profile PUT with ambulatoryId preserves multi-membership and updates the primary column', () => {
    const db = createDb();
    seedPatient(db, ['amb-1', 'amb-2']);

    // Simulate the v1 PUT route flow: normalize, update the patient row, upsert membership.
    const normalized = normalizePatientUpdateInput({ version: 1, ambulatoryId: 'amb-3' }, { expectedVersion: 1 });
    assert.equal(normalized.ok, true);
    if (!normalized.ok) return;

    db.update(patients).set(normalized.values).where(eq(patients.id, PATIENT_ID)).run();
    const applied = upsertPrimaryAmbulatoryMembership(db, PATIENT_ID, normalized.values.ambulatoryId);

    assert.equal(applied, 'amb-3');
    assert.equal(getPrimaryColumn(db), 'amb-3');
    assert.deepEqual(listMemberships(db), ['amb-1', 'amb-2', 'amb-3']);
});

test('upsert is idempotent for an already associated ambulatory', () => {
    const db = createDb();
    seedPatient(db, ['amb-1', 'amb-2']);

    assert.equal(upsertPrimaryAmbulatoryMembership(db, PATIENT_ID, 'amb-2'), 'amb-2');
    assert.equal(upsertPrimaryAmbulatoryMembership(db, PATIENT_ID, 'amb-2'), 'amb-2');

    assert.deepEqual(listMemberships(db), ['amb-1', 'amb-2']);
});

test('invalid ambulatoryId neither wipes memberships nor touches the primary column', () => {
    const db = createDb();
    seedPatient(db, ['amb-1', 'amb-2']);

    // A blank-only payload normalizes to a no-op and is rejected upstream (400).
    const blankOnly = normalizePatientUpdateInput({ version: 1, ambulatoryId: '' }, { expectedVersion: 1 });
    assert.deepEqual(blankOnly, { ok: false, error: 'No valid fields to update' });

    assert.equal(upsertPrimaryAmbulatoryMembership(db, PATIENT_ID, ''), null);
    assert.equal(upsertPrimaryAmbulatoryMembership(db, PATIENT_ID, 42), null);

    assert.equal(getPrimaryColumn(db), 'amb-1');
    assert.deepEqual(listMemberships(db), ['amb-1', 'amb-2']);
});

test('explicit null clears the primary column but keeps memberships intact', () => {
    const db = createDb();
    seedPatient(db, ['amb-1', 'amb-2']);

    const normalized = normalizePatientUpdateInput({ version: 1, ambulatoryId: null }, { expectedVersion: 1 });
    assert.equal(normalized.ok, true);
    if (!normalized.ok) return;
    assert.equal(normalized.values.ambulatoryId, null);

    db.update(patients).set(normalized.values).where(eq(patients.id, PATIENT_ID)).run();
    assert.equal(upsertPrimaryAmbulatoryMembership(db, PATIENT_ID, normalized.values.ambulatoryId), null);

    assert.equal(getPrimaryColumn(db), null);
    assert.deepEqual(listMemberships(db), ['amb-1', 'amb-2']);
});

test('network-scoped upsert inside a transaction leaves other memberships untouched', () => {
    const db = createDb();
    seedPatient(db, ['amb-1', 'amb-2']);

    // Mirrors updateNetworkScopedPatient: the client is scoped to one ambulatory
    // and must not rewrite the patient's other associations.
    db.transaction((tx) => {
        assert.equal(upsertPrimaryAmbulatoryMembership(tx, PATIENT_ID, 'amb-1'), 'amb-1');
    });

    assert.deepEqual(listMemberships(db), ['amb-1', 'amb-2']);
});

test('legacy patient PUT route uses set-primary semantics instead of delete-all membership replacement', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/api/patients/[id]/route.ts'), 'utf8');
    assert.match(
        source,
        /upsertPrimaryAmbulatoryMembership\(dbServer,\s*id,\s*normalized\.values\.ambulatoryId\)/,
        'legacy route should share the same set-primary helper as the v1 route'
    );
    assert.doesNotMatch(
        source,
        /delete\(patientsToAmbulatories\)\.where\(eq\(patientsToAmbulatories\.patientId,\s*id\)\)/,
        'legacy route must not delete all ambulatory memberships on profile PUT'
    );
});
