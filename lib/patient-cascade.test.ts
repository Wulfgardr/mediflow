// WUL-306 (ADR 0066): behavioral coverage for the canonical patient cascade.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    PATIENT_CHILD_TABLES,
    countOrphanedClinicalRows,
    countPatientCascadeRows,
    purgeOrphanedClinicalRows,
    purgePatientCascade,
    totalPatientCascadeRows,
    type PatientCascadeCounts,
} from './patient-cascade';

const ROOT_DIR = path.resolve(__dirname, '..');

function bootstrapDatabase(): { sqlite: Database.Database; db: BetterSQLite3Database } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-cascade-'));
    const sqlite = new Database(path.join(dir, 'medical.db'));
    const migrationsDir = path.join(ROOT_DIR, 'drizzle');
    const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort((left, right) => left.localeCompare(right));
    for (const fileName of migrationFiles) {
        const sql = fs
            .readFileSync(path.join(migrationsDir, fileName), 'utf8')
            .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
        if (sql.trim().length === 0) continue;
        sqlite.exec(sql);
    }
    // @Codex: db-server owns this runtime table; the cascade fixture must
    // materialize its parent before exercising the migrated patient-link table.
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS durable_review_records (
            id TEXT PRIMARY KEY NOT NULL,
            patient_ref TEXT NOT NULL,
            review_id TEXT NOT NULL UNIQUE,
            review_revision INTEGER NOT NULL,
            receipt_ref TEXT NOT NULL,
            provenance_ref TEXT NOT NULL,
            receipt_binding TEXT NOT NULL,
            provenance_binding TEXT NOT NULL,
            presentation_version TEXT NOT NULL,
            sealed_ciphertext TEXT NOT NULL,
            sealed_digest TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch())
        )
    `);
    sqlite.pragma('foreign_keys = ON');
    return { sqlite, db: drizzle(sqlite) };
}

// Obviously fake fixture rows (Mario Rossi style), raw SQL to stay schema-minimal.
function insertPatientWithChildren(sqlite: Database.Database, patientId: string): void {
    const suffix = patientId;
    sqlite.prepare(
        "INSERT OR IGNORE INTO ambulatories (id, name) VALUES ('amb-test', 'Ambulatorio Test')"
    ).run();
    sqlite.prepare(
        "INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, 'Mario', 'Rossi', 'RSSMRA80A01H501X')"
    ).run(patientId);
    /* @Codex */
    const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
    const patientRef = `ptr_${digest(`synthetic:patient:${suffix}`).slice(0, 32)}`;
    const reviewId = `review_${digest(`synthetic:review:${suffix}`).slice(0, 32)}`;
    const receiptRef = `receipt_${digest(`synthetic:receipt:${suffix}`).slice(0, 32)}`;
    const provenanceRef = `provenance_${digest(`synthetic:provenance:${suffix}`).slice(0, 32)}`;
    const sealedCiphertext = 'ENC:c3ludGhldGlj:Y2lwaGVy';
    sqlite.prepare(`
        INSERT INTO durable_review_records (
            id, patient_ref, review_id, review_revision, receipt_ref,
            provenance_ref, receipt_binding, provenance_binding,
            presentation_version, sealed_ciphertext, sealed_digest
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        reviewId,
        patientRef,
        reviewId,
        receiptRef,
        provenanceRef,
        digest(`${patientRef}\0${reviewId}\0${receiptRef}`),
        digest(`${patientRef}\0${reviewId}\0${provenanceRef}`),
        'mediflow.ai.durable-review.presentation.v1',
        sealedCiphertext,
        digest(sealedCiphertext),
    );
    sqlite.prepare(
        'INSERT INTO durable_review_patient_links (review_id, patient_id) VALUES (?, ?)'
    ).run(reviewId, patientId);
    sqlite.prepare(
        "INSERT INTO service_prescriptions (id, patient_id, prescribed_at, service_name) VALUES (?, ?, 1, 'Visita di controllo')"
    ).run(`sp-${suffix}`, patientId);
    sqlite.prepare(
        "INSERT INTO service_prescription_items (id, patient_id, prescription_id, service_name) VALUES (?, ?, ?, 'Visita di controllo')"
    ).run(`spi-${suffix}`, patientId, `sp-${suffix}`);
    sqlite.prepare(
        "INSERT INTO prosthetic_prescriptions (id, patient_id, prescribed_at, description) VALUES (?, ?, 1, 'Plantare standard')"
    ).run(`pp-${suffix}`, patientId);
    sqlite.prepare(
        "INSERT INTO siss_handoff_events (id, patient_id, action, module_label, started_at) VALUES (?, ?, 'open', 'Test', 1)"
    ).run(`sh-${suffix}`, patientId);
    /* @Codex */
    sqlite.prepare(
        "INSERT INTO document_diagnosis_proposals (id, patient_id, source_document_key, candidate_key, payload, status, confidence) VALUES (?, ?, ?, ?, 'ENC:fixture:cipher', 'pending', 'high')"
    ).run(`dp-${suffix}`, patientId, `source-${suffix}`, `candidate-${suffix}`);
    sqlite.prepare(
        "INSERT INTO observations (id, patient_id, code_system, code, display, unit_system, unit_code, value, observed_at, service_prescription_item_id) VALUES (?, ?, 'loinc', '8867-4', 'Heart rate', 'ucum', '/min', '70', 1, ?)"
    ).run(`ob-${suffix}`, patientId, `spi-${suffix}`);
    sqlite.prepare(
        "INSERT INTO checkups (id, patient_id, date, title) VALUES (?, ?, 1, 'Controllo')"
    ).run(`ck-${suffix}`, patientId);
    sqlite.prepare(
        "INSERT INTO therapies (id, patient_id, drug_name, dosage, status, start_date) VALUES (?, ?, 'Tachipirina', '500 mg', 'active', 1)"
    ).run(`th-${suffix}`, patientId);
    sqlite.prepare(
        "INSERT INTO entries (id, patient_id, type, date, content) VALUES (?, ?, 'note', 1, 'Nota di test')"
    ).run(`en-${suffix}`, patientId);
    sqlite.prepare(
        "INSERT INTO attachments (id, patient_id, name, type, size, path) VALUES (?, ?, 'referto.pdf', 'application/pdf', 1, '/tmp/referto.pdf')"
    ).run(`at-${suffix}`, patientId);
    sqlite.prepare(
        "INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, 'amb-test')"
    ).run(patientId);
}

function expectAllOnes(counts: PatientCascadeCounts, label: string): void {
    for (const child of PATIENT_CHILD_TABLES) {
        assert.equal(counts[child.name], 1, `${label}: expected one ${child.name} row`);
    }
}

test('purgePatientCascade deletes every child table and returns per-table counts', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertPatientWithChildren(sqlite, 'patient-keep');
        insertPatientWithChildren(sqlite, 'patient-purge');

        expectAllOnes(countPatientCascadeRows(db, 'patient-purge'), 'dry-run');

        const counts = db.transaction((tx) => purgePatientCascade(tx, 'patient-purge'));
        expectAllOnes(counts, 'purge');
        assert.equal(totalPatientCascadeRows(counts), PATIENT_CHILD_TABLES.length);

        expectAllOnes(countPatientCascadeRows(db, 'patient-keep'), 'control patient must be untouched');
        const leftover = countPatientCascadeRows(db, 'patient-purge');
        assert.equal(totalPatientCascadeRows(leftover), 0, 'purged patient must have zero child rows');
        assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
    } finally {
        sqlite.close();
    }
});

test('a mid-transaction failure rolls back the whole cascade', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertPatientWithChildren(sqlite, 'patient-rollback');

        assert.throws(() => {
            db.transaction((tx) => {
                purgePatientCascade(tx, 'patient-rollback');
                throw new Error('boom');
            });
        }, /boom/);

        expectAllOnes(countPatientCascadeRows(db, 'patient-rollback'), 'rollback must restore all child rows');
    } finally {
        sqlite.close();
    }
});

test('orphan helpers only touch children whose patient_id does not resolve', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertPatientWithChildren(sqlite, 'patient-live');
        insertPatientWithChildren(sqlite, 'patient-legacy');
        // Simulate the pre-ADR-0066 hard delete that produced the orphans
        // (bypassing FK enforcement, like the legacy DBs where the damage happened).
        sqlite.pragma('foreign_keys = OFF');
        sqlite.prepare('DELETE FROM patients WHERE id = ?').run('patient-legacy');
        sqlite.pragma('foreign_keys = ON');

        expectAllOnes(countOrphanedClinicalRows(db), 'orphan dry-run');

        const counts = db.transaction((tx) => purgeOrphanedClinicalRows(tx));
        expectAllOnes(counts, 'orphan purge');

        expectAllOnes(countPatientCascadeRows(db, 'patient-live'), 'live patient children must survive');
        assert.equal(totalPatientCascadeRows(countOrphanedClinicalRows(db)), 0, 'no orphans must remain');
    } finally {
        sqlite.close();
    }
});
