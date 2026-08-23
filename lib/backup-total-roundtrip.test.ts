/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { BACKUP_COLLECTIONS, parseBackupArtifact } from './backup-artifact';
import { decryptData, encryptData, generateMasterKey } from './security/security';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOADER = path.join(ROOT, 'scripts/register-strip-types-loader.mjs');
const MEMBERSHIP_TABLE = 'patients_to_ambulatories';
const NON_BACKUP_TABLES = new Set(['audit_events', 'settings', 'users']);
const BACKUP_TABLES = {
    ambulatories: 'ambulatories',
    attachments: 'attachments',
    conversations: 'conversations',
    documentDiagnosisProposals: 'document_diagnosis_proposals',
    durableReviewRecords: 'durable_review_records',
    durableReviewOperations: 'durable_review_operations',
    drugs: 'drugs',
    entries: 'entries',
    exemptions: 'exemptions',
    messages: 'messages',
    observations: 'observations',
    patients: 'patients',
    prostheticPrescriptions: 'prosthetic_prescriptions',
    serviceCatalogEntries: 'service_catalog_entries',
    servicePrescriptionItems: 'service_prescription_items',
    servicePrescriptions: 'service_prescriptions',
    sissHandoffs: 'siss_handoff_events',
    checkups: 'checkups',
    therapies: 'therapies',
} as const;

function runNode(args: string[], env: Record<string, string> = {}): string {
    return execFileSync(process.execPath, args, {
        cwd: ROOT,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function prepareDatabase(dataDir: string): void {
    runNode(['scripts/prepare-e2e-db.mjs'], { MEDIFLOW_DATA_DIR: dataDir });
    bootstrapSchemaGuards(dataDir);
}

function bootstrapSchemaGuards(dataDir: string): void {
    const dbServerUrl = pathToFileURL(path.join(ROOT, 'lib/db-server.ts')).href;
    runNode(
        ['--experimental-strip-types', '--import', LOADER, '--input-type=module', '--eval', `await import(${JSON.stringify(dbServerUrl)});`],
        { MEDIFLOW_DATA_DIR: dataDir },
    );
}

function schemaTables(db: Database.Database): string[] {
    return (db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>).map((row) => row.name);
}

function quoteIdentifier(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
}

function clearBackupTables(db: Database.Database, tables: string[]): void {
    db.pragma('foreign_keys = OFF');
    try {
        db.transaction(() => {
            for (const table of tables) {
                db.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
            }
        })();
    } finally {
        db.pragma('foreign_keys = ON');
    }
}

function insertRow(db: Database.Database, table: string, row: Record<string, unknown>): void {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    db.prepare(
        `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`,
    ).run(...Object.values(row));
}

async function populateSyntheticClinicalFixture(db: Database.Database) {
    const masterKey = await generateMasterKey();
    const seal = async (label: string): Promise<string> => {
        const encrypted = await encryptData(`synthetic:${label}`, masterKey);
        assert.equal(await decryptData(encrypted.data, encrypted.iv, masterKey), `synthetic:${label}`);
        return `ENC:${encrypted.iv}:${encrypted.data}`;
    };
    const sealed = async (table: string, columns: string[]): Promise<Record<string, string>> => Object.fromEntries(
        await Promise.all(columns.map(async (column) => [column, await seal(`${table}.${column}`)])),
    );
    const now = 1_783_000_000;

    insertRow(db, 'ambulatories', { id: 'w7-amb-primary', name: 'Ambulatorio sintetico W7', address: 'fixture locale', type: 'synthetic', is_default: 1, version: 3, created_at: now });
    insertRow(db, 'ambulatories', { id: 'w7-amb-secondary', name: 'Ambulatorio sintetico secondario', type: 'synthetic', is_default: 0, version: 2, created_at: now + 1 });
    insertRow(db, 'patients', {
        id: 'w7-patient', first_name: 'Synthetic', last_name: 'Roundtrip', tax_code: 'SYNTHETIC-W7', birth_date: -631_152_000,
        ...(await sealed('patients', ['address', 'phone', 'caregiver', 'exemptions', 'diagnoses', 'status_reason', 'notes', 'ai_summary', 'document_insights', 'archive_reason', 'archive_note', 'deletion_reason'])),
        monitoring_profile: 'synthetic-monitoring', is_adi: 1, is_archived: 1, deleted_at: now - 10, version: 7,
        ambulatory_id: 'w7-amb-primary', created_at: now, updated_at: now + 2,
    });
    insertRow(db, MEMBERSHIP_TABLE, { patient_id: 'w7-patient', ambulatory_id: 'w7-amb-primary', assigned_at: now + 24 });
    insertRow(db, MEMBERSHIP_TABLE, { patient_id: 'w7-patient', ambulatory_id: 'w7-amb-secondary', assigned_at: now + 25 });
    insertRow(db, 'entries', {
        id: 'w7-entry', patient_id: 'w7-patient', type: 'note', date: now + 3,
        ...(await sealed('entries', ['title', 'content', 'metadata', 'attachments', 'deletion_reason'])),
        setting: 'ambulatorio', deleted_at: now + 4, version: 4, created_at: now + 3, updated_at: now + 4,
    });
    insertRow(db, 'therapies', {
        id: 'w7-therapy', patient_id: 'w7-patient', drug_name: 'Farmaco sintetico', dosage: '1 unita', status: 'stopped',
        start_date: now + 5, end_date: now + 6, motivation: await seal('therapies.motivation'), deletion_reason: await seal('therapies.deletion_reason'),
        active_principle: 'Principio sintetico', diagnosis_code: 'SYN', diagnosis_name: 'Condizione sintetica', aic: 'W7AIC', atc: 'W7ATC',
        version: 5, created_at: now + 5, updated_at: now + 6, deleted_at: now + 6,
    });
    insertRow(db, 'prosthetic_prescriptions', {
        id: 'w7-prosthetic', patient_id: 'w7-patient', prescribed_at: now + 7, status: 'completed', category: 'standard', iso_code: 'SYN-ISO',
        ...(await sealed('prosthetic_prescriptions', ['description', 'measures', 'clinical_reason', 'regional_prescription_id', 'supplier', 'collaudo_outcome', 'document_refs', 'notes'])),
        collaudo_at: now + 8, source: 'manual', version: 2, created_at: now + 7, updated_at: now + 8,
    });
    insertRow(db, 'service_catalog_entries', {
        id: 'w7-catalog', code_system: 'urn:synthetic', service_code: 'W7-SERVICE', display_name: 'Prestazione sintetica', category: 'laboratory',
        branch_code: 'SYN', synonyms: '["fixture"]', source: 'manual', version: 'w7', active: 1, imported_at: now + 9, updated_at: now + 9,
    });
    insertRow(db, 'service_prescriptions', {
        id: 'w7-service', patient_id: 'w7-patient', prescribed_at: now + 10, status: 'performed', category: 'laboratory', priority: 'routine',
        code_system: 'urn:synthetic', service_code: 'W7-SERVICE',
        ...(await sealed('service_prescriptions', ['service_name', 'clinical_question', 'provider', 'outcome_note', 'request_reference', 'document_refs', 'notes'])),
        scheduled_at: now + 11, performed_at: now + 12, report_received_at: now + 13, source: 'manual', version: 6, created_at: now + 10, updated_at: now + 13,
    });
    insertRow(db, 'service_prescription_items', {
        id: 'w7-service-item', patient_id: 'w7-patient', prescription_id: 'w7-service', ordinal: 0, status: 'performed', category: 'laboratory',
        code_system: 'urn:synthetic', service_code: 'W7-SERVICE', catalog_entry_id: 'w7-catalog', match_status: 'manual', confidence: '1',
        ...(await sealed('service_prescription_items', ['service_name', 'catalog_display_name', 'evidence', 'notes', 'outcome_note'])),
        scheduled_at: now + 11, performed_at: now + 12, report_received_at: now + 13, version: 3, created_at: now + 10, updated_at: now + 13,
    });
    insertRow(db, 'observations', {
        id: 'w7-observation', patient_id: 'w7-patient', code_system: 'http://loinc.org', code: 'W7', display: 'Osservazione sintetica',
        unit_system: 'http://unitsofmeasure.org', unit_code: '1', value: '42', notes: await seal('observations.notes'), observed_at: now + 14,
        source: 'manual', ref_low: '1', ref_high: '100', ref_text: 'fixture', service_prescription_item_id: 'w7-service-item',
        deletion_reason: await seal('observations.deletion_reason'), version: 4, created_at: now + 14, updated_at: now + 15, deleted_at: now + 15,
    });
    insertRow(db, 'checkups', {
        id: 'w7-checkup', patient_id: 'w7-patient', date: now + 16, title: 'Controllo sintetico', notes: await seal('checkups.notes'),
        status: 'done', source: 'manual', deletion_reason: await seal('checkups.deletion_reason'), version: 2, created_at: now + 16, updated_at: now + 17, deleted_at: now + 17,
    });
    insertRow(db, 'siss_handoff_events', {
        id: 'w7-siss', patient_id: 'w7-patient', action: 'open', module_label: 'Modulo sintetico',
        ...(await sealed('siss_handoff_events', ['reason', 'next_action', 'notes', 'correlation_id'])),
        started_at: now + 18, completed_at: now + 19, outcome: 'completed', created_at: now + 18, updated_at: now + 19,
    });
    /* @Codex */
    const proposal = {
        id: 'w7-proposal', patient_id: 'w7-patient', source_document_key: 'source-hmac-w7', candidate_key: 'candidate-hmac-w7',
        payload: await seal('document_diagnosis_proposals.payload'), status: 'accepted', confidence: 'high', decided_at: now + 20,
        decision_actor_type: 'user', decision_actor_ref: 'actor-synthetic', decision_payload: await seal('document_diagnosis_proposals.decision_payload'),
        version: 9, created_at: now + 20, updated_at: now + 21,
    };
    insertRow(db, 'document_diagnosis_proposals', proposal);
    assert.throws(() => insertRow(db, 'document_diagnosis_proposals', { ...proposal, id: 'w7-proposal-duplicate' }), /UNIQUE/);
    insertRow(db, 'document_diagnosis_proposals', {
        ...proposal,
        id: 'w7-proposal-other-source', source_document_key: 'source-hmac-w7-other', status: 'pending', decided_at: null,
        decision_actor_type: null, decision_actor_ref: null, decision_payload: null,
    });
    const durableReviewRecord = {
        patientRef: `ptr_${'a'.repeat(32)}`,
        reviewId: `review_${'b'.repeat(32)}`,
        reviewRevision: 1,
        receiptRef: `receipt_${'c'.repeat(32)}`,
        provenanceRef: `provenance_${'d'.repeat(32)}`,
        receiptBinding: '',
        provenanceBinding: '',
        presentationVersion: 'mediflow.ai.durable-review.presentation.v1',
        sealedCiphertext: 'ENC:YWJj:c3ludGhldGljLWR1cmFibGUtcmV2aWV3',
        sealedDigest: '',
    };
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    durableReviewRecord.receiptBinding = digest(`${durableReviewRecord.patientRef}\0${durableReviewRecord.reviewId}\0${durableReviewRecord.receiptRef}`);
    durableReviewRecord.provenanceBinding = digest(`${durableReviewRecord.patientRef}\0${durableReviewRecord.reviewId}\0${durableReviewRecord.provenanceRef}`);
    durableReviewRecord.sealedDigest = digest(durableReviewRecord.sealedCiphertext);
    const durableReviewCommand = {
        record: durableReviewRecord,
        expectedReviewRevision: 0,
        idempotencyKey: 'idem_aaaaaaaaaaaaaaaa',
    };
    insertRow(db, 'durable_review_records', {
        id: durableReviewRecord.reviewId,
        patient_ref: durableReviewRecord.patientRef,
        review_id: durableReviewRecord.reviewId,
        review_revision: durableReviewRecord.reviewRevision,
        receipt_ref: durableReviewRecord.receiptRef,
        provenance_ref: durableReviewRecord.provenanceRef,
        receipt_binding: durableReviewRecord.receiptBinding,
        provenance_binding: durableReviewRecord.provenanceBinding,
        presentation_version: durableReviewRecord.presentationVersion,
        sealed_ciphertext: durableReviewRecord.sealedCiphertext,
        sealed_digest: durableReviewRecord.sealedDigest,
        created_at: now + 22,
    });
    insertRow(db, 'durable_review_operations', {
        id: digest(`${durableReviewRecord.reviewId}\0${durableReviewCommand.idempotencyKey}`),
        review_id: durableReviewRecord.reviewId,
        idempotency_key: durableReviewCommand.idempotencyKey,
        operation: 'create',
        expected_review_revision: durableReviewCommand.expectedReviewRevision,
        operation_digest: digest(JSON.stringify(['create', durableReviewCommand.expectedReviewRevision, durableReviewRecord])),
        record_snapshot: JSON.stringify(durableReviewRecord),
        created_at: now + 22,
    });
    insertRow(db, 'attachments', {
        id: 'w7-attachment', patient_id: 'w7-patient', type: 'application/pdf', size: 128,
        ...(await sealed('attachments', ['name', 'path', 'data', 'summary_snapshot', 'parse_evidence_artifact_snapshot', 'ocr_replay_artifact_snapshot'])),
        ocr_queue_state: 'ocr_done', ocr_queue_reason: 'synthetic', ocr_queue_updated_at: now + 22, created_at: now + 22,
    });
    insertRow(db, 'conversations', { id: 'w7-conversation', title: await seal('conversations.title'), updated_at: now + 23, is_archived: 1, is_deleted: 1, created_at: now + 23 });
    insertRow(db, 'messages', {
        id: 'w7-message', conversation_id: 'w7-conversation', role: 'user', content: await seal('messages.content'), metadata: await seal('messages.metadata'),
        attachment_type: 'application/octet-stream', attachment_base64: await seal('messages.attachment_base64'), created_at: now + 24,
    });
    insertRow(db, 'drugs', { aic: 'W7AIC', name: 'Farmaco sintetico', active_principle: 'Principio sintetico', company: 'Azienda sintetica', packaging: 'Fixture', packaging_search: 'fixture', class: 'A', price: 123, atc: 'W7ATC' });
    insertRow(db, 'exemptions', { code: 'W7EX', description: 'Esenzione sintetica', type: 'synthetic', source: 'fixture', start_date: now, end_date: now + 30, is_pharma: 1, is_specialist: 1, is_national: 0, updated_at: now + 25 });
    return durableReviewCommand;
}

function primaryKeyColumns(db: Database.Database, table: string): string[] {
    return (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string; pk: number }>)
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name);
}

function readOrderedRows(db: Database.Database, table: string): Array<Record<string, unknown>> {
    const primaryKey = primaryKeyColumns(db, table);
    assert.ok(primaryKey.length > 0, `${table} must expose a primary key for record-by-record comparison`);
    return db.prepare(
        `SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${primaryKey.map(quoteIdentifier).join(', ')}`,
    ).all() as Array<Record<string, unknown>>;
}

function restoreArtifact(targetDataDir: string, artifactPath: string): void {
    const artifactUrl = pathToFileURL(path.join(ROOT, 'lib/backup-artifact.ts')).href;
    const executorUrl = pathToFileURL(path.join(ROOT, 'lib/backup-restore-executor.ts')).href;
    const source = `
        import fs from 'node:fs';
        import { parseBackupArtifact } from ${JSON.stringify(artifactUrl)};
        import { restoreBackupArtifact } from ${JSON.stringify(executorUrl)};
        const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(process.env.W7_ARTIFACT_PATH, 'utf8')));
        restoreBackupArtifact(artifact);
    `;
    runNode(
        ['--experimental-strip-types', '--import', LOADER, '--input-type=module', '--eval', source],
        { MEDIFLOW_DATA_DIR: targetDataDir, W7_ARTIFACT_PATH: artifactPath },
    );
}

test('scheduled backup restores every clinical table and preserves ciphertext bytes', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-backup-roundtrip-'));
    const sourceDataDir = path.join(workDir, 'source');
    const targetDataDir = path.join(workDir, 'target');
    const backupDir = path.join(workDir, 'backups');

    try {
        prepareDatabase(sourceDataDir);
        prepareDatabase(targetDataDir);
        fs.mkdirSync(backupDir, { recursive: true });

        const sourceDb = new Database(path.join(sourceDataDir, 'medical.db'));
        const targetDb = new Database(path.join(targetDataDir, 'medical.db'));
        try {
            const actualSchemaTables = schemaTables(sourceDb);
            const expectedSchemaTables = [
                ...NON_BACKUP_TABLES,
                ...Object.values(BACKUP_TABLES),
                MEMBERSHIP_TABLE,
            ].sort();
            assert.deepEqual(actualSchemaTables, expectedSchemaTables, 'new schema tables must be backed up or explicitly classified');
            assert.deepEqual([...Object.keys(BACKUP_TABLES)].sort(), [...BACKUP_COLLECTIONS].sort());

            const clinicalTables = actualSchemaTables.filter((table) => !NON_BACKUP_TABLES.has(table));
            clearBackupTables(sourceDb, clinicalTables);
            clearBackupTables(targetDb, clinicalTables);
            const durableReviewCommand = await populateSyntheticClinicalFixture(sourceDb);

            for (const table of clinicalTables) {
                assert.equal(readOrderedRows(targetDb, table).length, 0, `target ${table} must be virgin before restore`);
                assert.ok(readOrderedRows(sourceDb, table).length > 0, `source ${table} must contain a synthetic fixture`);
            }

            const runner = JSON.parse(runNode(['scripts/run-scheduled-backup.mjs'], {
                MEDIFLOW_DATA_DIR: sourceDataDir,
                MEDIFLOW_BACKUP_DEST_DIR: backupDir,
                MEDIFLOW_BACKUP_FORCE: '1',
            })) as { ok: boolean; artifactPath?: string; message?: string };
            assert.equal(runner.ok, true, runner.message);
            assert.ok(runner.artifactPath);

            const schedulerRow = sourceDb.prepare("SELECT value FROM settings WHERE key = 'backupScheduler'").get() as { value: string };
            const schedulerState = JSON.parse(schedulerRow.value);
            assert.equal(schedulerState.run.lastRunStatus, 'success');
            assert.equal(schedulerState.run.lastArtifactPath, runner.artifactPath);
            assert.equal(typeof schedulerState.run.lastRunAt, 'string');
            assert.equal(schedulerState.run.lastRetentionMode, 'auto');

            const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(runner.artifactPath, 'utf8')));
            for (const [collection, table] of Object.entries(BACKUP_TABLES)) {
                assert.equal(artifact.manifest.recordCounts[collection as keyof typeof BACKUP_TABLES], readOrderedRows(sourceDb, table).length);
            }

            restoreArtifact(targetDataDir, runner.artifactPath);

            const replayed = JSON.parse(runNode(
                ['scripts/run-strip-types.mjs', 'scripts/durable-review-record-store-worker.mjs', 'create'],
                { MEDIFLOW_DATA_DIR: targetDataDir, MEDIFLOW_DURABLE_REVIEW_RECORD: JSON.stringify(durableReviewCommand) },
            ));
            assert.deepEqual(replayed, { recordId: durableReviewCommand.record.reviewId, ...durableReviewCommand.record });

            let encryptedFieldCount = 0;
            for (const table of clinicalTables) {
                const sourceRows = readOrderedRows(sourceDb, table);
                const targetRows = readOrderedRows(targetDb, table);
                assert.equal(targetRows.length, sourceRows.length, `${table} count must survive restore`);
                assert.deepEqual(targetRows, sourceRows, `${table} rows must survive restore byte-for-byte`);

                for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex += 1) {
                    for (const [column, value] of Object.entries(sourceRows[rowIndex])) {
                        if (typeof value !== 'string' || !value.startsWith('ENC:')) continue;
                        encryptedFieldCount += 1;
                        assert.equal(
                            Buffer.from(String(targetRows[rowIndex][column])).compare(Buffer.from(value)),
                            0,
                            `${table}.${column} ciphertext must be byte-identical`,
                        );
                    }
                }
            }
            assert.ok(encryptedFieldCount >= 50, 'fixture must exercise the complete encrypted clinical surface');
        } finally {
            sourceDb.close();
            targetDb.close();
        }
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
});
