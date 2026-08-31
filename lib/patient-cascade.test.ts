// WUL-306 (ADR 0066): behavioral coverage for the canonical patient cascade.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, afterEach } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { ServerSession } from './security/server-session.ts';
import {
    PATIENT_CHILD_TABLES,
    countOrphanedClinicalRows,
    countPatientCascadeRows,
    purgeOrphanedClinicalRows,
    purgePatientCascade,
    totalPatientCascadeRows,
    type PatientCascadeCounts,
} from './patient-cascade';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const AUTHORITY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-cascade-authority-'));
const AUTHORITY_DB_PATH = path.join(AUTHORITY_DATA_DIR, 'medical.db');

{
    const sqlite = new Database(AUTHORITY_DB_PATH);
    sqlite.exec(`CREATE TABLE durable_review_records (
        id TEXT PRIMARY KEY NOT NULL, patient_ref TEXT NOT NULL, review_id TEXT NOT NULL UNIQUE, review_revision INTEGER NOT NULL,
        receipt_ref TEXT NOT NULL, provenance_ref TEXT NOT NULL, receipt_binding TEXT NOT NULL, provenance_binding TEXT NOT NULL,
        presentation_version TEXT NOT NULL, sealed_ciphertext TEXT NOT NULL, sealed_digest TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
    )`);
    for (const fileName of fs.readdirSync(path.join(ROOT_DIR, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
        const sql = fs.readFileSync(path.join(ROOT_DIR, 'drizzle', fileName), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, '');
        if (sql.trim().length > 0) sqlite.exec(sql);
    }
    sqlite.close();
}
process.env.MEDIFLOW_DATA_DIR = AUTHORITY_DATA_DIR;

const authoritySessions: ServerSession[] = [];
let authoritySessionSequence = 0;

afterEach(async () => {
    const { clearAllSessions } = await import('./security/server-session.ts');
    const { retireSyntheticWebSession } = await import('./security/web-auth-lifecycle-owner-test-fixture.ts');
    while (authoritySessions.length > 0) retireSyntheticWebSession(authoritySessions.pop()!);
    clearAllSessions();
});
after(() => fs.rmSync(AUTHORITY_DATA_DIR, { recursive: true, force: true }));

function bootstrapDatabase(): { sqlite: Database.Database; db: BetterSQLite3Database } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-cascade-'));
    const sqlite = new Database(path.join(dir, 'medical.db'));
    const migrationsDir = path.join(ROOT_DIR, 'drizzle');
    /* @Codex */
    sqlite.exec(`CREATE TABLE durable_review_records (
        id TEXT PRIMARY KEY NOT NULL, patient_ref TEXT NOT NULL, review_id TEXT NOT NULL UNIQUE, review_revision INTEGER NOT NULL,
        receipt_ref TEXT NOT NULL, provenance_ref TEXT NOT NULL, receipt_binding TEXT NOT NULL, provenance_binding TEXT NOT NULL,
        presentation_version TEXT NOT NULL, sealed_ciphertext TEXT NOT NULL, sealed_digest TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
    )`);
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
    /* @Codex */
    sqlite.exec(`
        ALTER TABLE attachments ADD COLUMN document_source_ref TEXT NOT NULL DEFAULT '${'0'.repeat(64)}'
            CHECK (length(document_source_ref) = 64 AND document_source_ref NOT GLOB '*[^0-9a-f]*');
        ALTER TABLE attachments ADD COLUMN document_revision INTEGER NOT NULL DEFAULT 1
            CHECK (typeof(document_revision) = 'integer' AND document_revision BETWEEN 1 AND 9007199254740991);
        ALTER TABLE attachments ADD COLUMN document_freshness_epoch INTEGER NOT NULL DEFAULT 1
            CHECK (typeof(document_freshness_epoch) = 'integer' AND document_freshness_epoch BETWEEN 1 AND 9007199254740991);
        CREATE UNIQUE INDEX attachments_document_source_ref_unique ON attachments(document_source_ref);
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
    const currentnessRef = digest(patientId);
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
        "INSERT INTO attachments (id, patient_id, name, type, size, path, document_source_ref, document_revision, document_freshness_epoch) VALUES (?, ?, 'referto.pdf', 'application/pdf', 1, '/tmp/referto.pdf', ?, 1, 1)"
    ).run(`at-${suffix}`, patientId, currentnessRef);
    sqlite.prepare(
        "INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, 'amb-test')"
    ).run(patientId);
}

function expectAllOnes(counts: PatientCascadeCounts, label: string): void {
    for (const child of PATIENT_CHILD_TABLES) {
        assert.equal(counts[child.name], 1, `${label}: expected one ${child.name} row`);
    }
}

/* @Codex */
function insertAuthorityPatientWithAttachment(sqlite: Database.Database, patientId: string, sourceRef: string): void {
    sqlite.prepare("INSERT OR IGNORE INTO ambulatories (id, name) VALUES ('amb-test', 'Ambulatorio Test')").run();
    sqlite.prepare("INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, 'Ada', 'Synthetic', ?)")
        .run(patientId, `SYNTHETIC-${patientId}`);
    sqlite.prepare("INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, 'amb-test')").run(patientId);
    sqlite.prepare(`INSERT INTO attachments
        (id, patient_id, name, type, size, path, data, document_source_ref, document_revision, document_freshness_epoch)
        VALUES (?, ?, 'synthetic.rtf', 'application/rtf', 4, 'synthetic.rtf', ?, ?, 1, 1)`)
        .run(`at-${patientId}`, patientId, 'data:text/rtf;base64,VGVzdA==', sourceRef);
}

async function createSelectedAuthority(patientId: string) {
    const { createAttachmentExtractionSourceAuthority } = await import('./domain/documents/attachment-extraction-source-authority.ts');
    const { serverSessionProjectionOwnerRegistry } = await import('./security/server-session-projection-owner-production.ts');
    const { issueSyntheticWebSession } = await import('./security/web-auth-lifecycle-owner-test-fixture.ts');
    const session = issueSyntheticWebSession(
        { id: `user-${patientId}`, username: ['clinician', 'synthetic', patientId].join('.'), role: 'clinician' },
        `patient-cascade-${authoritySessionSequence += 1}`,
    );
    authoritySessions.push(session);
    const owner = serverSessionProjectionOwnerRegistry.acquire(session);
    owner.issueSelection({ expectedEpoch: 0, patientId, ambulatoryId: 'amb-test' });
    return createAttachmentExtractionSourceAuthority(session);
}

async function authorityFixture(patientId: string) {
    await import('./domain/documents/attachment-extraction-source-authority.ts');
    const sqlite = new Database(AUTHORITY_DB_PATH);
    sqlite.pragma('foreign_keys = ON');
    insertAuthorityPatientWithAttachment(sqlite, patientId, createHash('sha256').update(patientId).digest('hex'));
    return { authority: await createSelectedAuthority(patientId), db: drizzle(sqlite), sqlite };
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

test('patient purge revokes old locators and operations before deleting attachments', async () => {
    const patientId = 'patient-authority-purge';
    const { authority, db, sqlite } = await authorityFixture(patientId);
    try {
        const staleLocator = authority.issue({ attachmentId: `at-${patientId}` });
        const operationLocator = authority.issue({ attachmentId: `at-${patientId}` });
        assert.ok(staleLocator);
        assert.ok(operationLocator);
        const begun = authority.consume(operationLocator);
        assert.equal(begun.status, 'begun');
        if (begun.status !== 'begun') return;

        db.transaction((tx) => purgePatientCascade(tx, patientId));

        assert.equal(authority.consume(staleLocator).status, 'denied');
        assert.equal(authority.finalize(begun.operation).status, 'denied');
        assert.equal(authority.abort(begun.operation).status, 'denied');

        sqlite.prepare(`INSERT INTO attachments
            (id, patient_id, name, type, size, path, data, document_source_ref, document_revision, document_freshness_epoch)
            VALUES (?, ?, 'replacement.rtf', 'application/rtf', 4, 'replacement.rtf', ?, ?, 1, 1)`)
            .run(`at-${patientId}`, patientId, 'data:text/rtf;base64,VGVzdA==', 'b'.repeat(64));
        const freshLocator = authority.issue({ attachmentId: `at-${patientId}` });
        assert.ok(freshLocator);
        const fresh = authority.consume(freshLocator);
        assert.equal(fresh.status, 'begun');
        if (fresh.status === 'begun') assert.equal(authority.finalize(fresh.operation).status, 'spent');
    } finally {
        sqlite.close();
    }
});

test('patient purge stays fail-closed when deletion fails or its transaction rolls back', async () => {
    const immediateId = 'patient-authority-immediate-failure';
    const immediate = await authorityFixture(immediateId);
    try {
        const locator = immediate.authority.issue({ attachmentId: `at-${immediateId}` });
        assert.ok(locator);
        const failingRunner = {
            select: immediate.db.select.bind(immediate.db),
            delete() { throw new Error('synthetic delete failure'); },
        } as unknown as Parameters<typeof purgePatientCascade>[0];
        assert.throws(() => purgePatientCascade(failingRunner, immediateId), /synthetic delete failure/u);
        assert.equal(immediate.authority.consume(locator).status, 'denied');
    } finally {
        immediate.sqlite.close();
    }

    const rollbackId = 'patient-authority-rollback';
    const rollback = await authorityFixture(rollbackId);
    try {
        const locator = rollback.authority.issue({ attachmentId: `at-${rollbackId}` });
        assert.ok(locator);
        assert.throws(() => rollback.db.transaction((tx) => {
            purgePatientCascade(tx, rollbackId);
            throw new Error('synthetic rollback');
        }), /synthetic rollback/u);
        assert.equal(rollback.authority.consume(locator).status, 'denied');
        assert.equal(countPatientCascadeRows(rollback.db, rollbackId).attachments, 1, 'rollback restores attachment without restoring authority');
    } finally {
        rollback.sqlite.close();
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

test('orphan purge revokes pending capabilities without granting cross-patient authority', async () => {
    const orphanId = 'patient-authority-orphan';
    const liveId = 'patient-authority-live';
    const orphan = await authorityFixture(orphanId);
    try {
        insertAuthorityPatientWithAttachment(orphan.sqlite, liveId, 'c'.repeat(64));
        const liveAuthority = await createSelectedAuthority(liveId);

        const orphanLocator = orphan.authority.issue({ attachmentId: `at-${orphanId}` });
        const operationLocator = orphan.authority.issue({ attachmentId: `at-${orphanId}` });
        const liveLocator = liveAuthority.issue({ attachmentId: `at-${liveId}` });
        assert.ok(orphanLocator);
        assert.ok(operationLocator);
        assert.ok(liveLocator);
        const begun = orphan.authority.consume(operationLocator);
        assert.equal(begun.status, 'begun');
        if (begun.status !== 'begun') return;

        orphan.sqlite.pragma('foreign_keys = OFF');
        orphan.sqlite.prepare('DELETE FROM patients WHERE id = ?').run(orphanId);
        orphan.sqlite.pragma('foreign_keys = ON');
        orphan.db.transaction((tx) => purgeOrphanedClinicalRows(tx));

        assert.equal(orphan.authority.consume(orphanLocator).status, 'denied');
        assert.equal(orphan.authority.finalize(begun.operation).status, 'denied');
        assert.equal(liveAuthority.consume(liveLocator).status, 'denied');
        const freshLiveLocator = liveAuthority.issue({ attachmentId: `at-${liveId}` });
        assert.ok(freshLiveLocator);
        const freshLive = liveAuthority.consume(freshLiveLocator);
        assert.equal(freshLive.status, 'begun');
        if (freshLive.status === 'begun') assert.equal(liveAuthority.abort(freshLive.operation).status, 'aborted');
    } finally {
        orphan.sqlite.close();
    }
});
