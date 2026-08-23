/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { buildAttachmentPath } from './attachment-path';
import { ambulatories, attachments, patients, patientsToAmbulatories } from './schema';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-network-attachment-read-'));
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
const {
    NETWORK_ATTACHMENT_METADATA_COLUMNS,
    listNetworkScopedAttachments,
    getNetworkScopedAttachment,
    toNetworkDocumentOcrQueueReason,
} = await import('./network-attachment-read.ts');

const SCOPE_AMBULATORY = 'amb-attachment-read-scope';
const PATIENT_ID = 'patient-attachment-read-1';
const OTHER_PATIENT_ID = 'patient-attachment-read-2';
const ATTACHMENT_ID = 'attachment-read-1';
const OTHER_PATIENT_ATTACHMENT_ID = 'attachment-read-2';

const SEALED_NAME = 'ENC:aXY=:bmFtZQ==';
const SEALED_PATH = 'ENC:aXY=:cGF0aA==';
const SEALED_DATA = 'ENC:aXY=:ZGF0YQ==';

test('host-only PDF inspection reasons do not cross the paired API enum', () => {
    assert.equal(toNetworkDocumentOcrQueueReason('paired_upload'), 'paired_upload');
    assert.equal(toNetworkDocumentOcrQueueReason('parser_failed'), null);
    assert.equal(toNetworkDocumentOcrQueueReason('resource_limit'), null);
});

function resetDatabase(): void {
    dbServer.delete(attachments).run();
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values([{ id: SCOPE_AMBULATORY, name: 'Ambulatorio Documenti', type: 'live' }]).run();
    dbServer.insert(patients).values([
        { id: PATIENT_ID, firstName: 'Ada', lastName: 'Sealed', taxCode: 'ADASEALED03', version: 1 },
        { id: OTHER_PATIENT_ID, firstName: 'Grace', lastName: 'Hopper', taxCode: 'GRCHPR01', version: 1 },
    ]).run();
    dbServer.insert(patientsToAmbulatories).values([
        { patientId: PATIENT_ID, ambulatoryId: SCOPE_AMBULATORY },
        { patientId: OTHER_PATIENT_ID, ambulatoryId: SCOPE_AMBULATORY },
    ]).run();
    dbServer.insert(attachments).values([
        {
            id: ATTACHMENT_ID,
            patientId: PATIENT_ID,
            name: SEALED_NAME,
            type: 'application/pdf',
            size: 4096,
            // Storage-time canonicalization mirrors the write path (D2): the
            // stored `path` is already the derived attachments/<id>-<token>
            // form, never the raw sealed value.
            path: buildAttachmentPath(SEALED_PATH, SEALED_NAME, ATTACHMENT_ID),
            data: SEALED_DATA,
            summarySnapshot: 'ENC:aXY=:c3VtbWFyeQ==',
            ocrQueueState: 'pending',
            ocrQueueReason: 'paired_upload',
            ocrQueueUpdatedAt: new Date('2026-07-10T09:00:00.000Z'),
            createdAt: new Date('2026-07-10T09:00:00.000Z'),
            documentSourceRef: 'a'.repeat(64),
            documentRevision: 1,
            documentFreshnessEpoch: 1,
        },
        {
            id: OTHER_PATIENT_ATTACHMENT_ID,
            patientId: OTHER_PATIENT_ID,
            name: SEALED_NAME,
            type: 'application/pdf',
            size: 1024,
            path: `attachments/${OTHER_PATIENT_ATTACHMENT_ID}-altro.pdf`,
            data: SEALED_DATA,
            createdAt: new Date('2026-07-10T08:00:00.000Z'),
            documentSourceRef: 'b'.repeat(64),
            documentRevision: 1,
            documentFreshnessEpoch: 1,
        },
    ]).run();
}

test('listNetworkScopedAttachments returns metadata without the data payload', async () => {
    resetDatabase();

    const list = await listNetworkScopedAttachments(PATIENT_ID, SCOPE_AMBULATORY);
    assert.equal(list.length, 1);
    const [summary] = list;
    assert.equal(summary.id, ATTACHMENT_ID);
    assert.equal(summary.patientId, PATIENT_ID);
    assert.equal(summary.name, SEALED_NAME);
    assert.equal(summary.type, 'application/pdf');
    assert.equal(summary.size, 4096);
    assert.equal(summary.path, buildAttachmentPath(SEALED_PATH, SEALED_NAME, ATTACHMENT_ID));
    assert.equal(summary.summarySnapshot, 'ENC:aXY=:c3VtbWFyeQ==');
    assert.equal(summary.ocrQueueState, 'pending');
    assert.equal(summary.ocrQueueReason, 'paired_upload');
    assert.ok(summary.ocrQueueUpdatedAt);
    assert.ok(summary.createdAt);
    assert.equal('data' in summary, false);
});

test('the network attachment list projection never selects the data blob', () => {
    const query = dbServer
        .select(NETWORK_ATTACHMENT_METADATA_COLUMNS)
        .from(attachments)
        .where(eq(attachments.patientId, PATIENT_ID))
        .toSQL();

    assert.doesNotMatch(query.sql, /"attachments"\."data"/);
    const detailQuery = dbServer.select().from(attachments).where(eq(attachments.id, ATTACHMENT_ID)).toSQL();
    assert.match(detailQuery.sql, /"data"/);
});

test('getNetworkScopedAttachment returns the full record including the sealed data payload', async () => {
    resetDatabase();

    const detail = await getNetworkScopedAttachment(PATIENT_ID, ATTACHMENT_ID, SCOPE_AMBULATORY);
    assert.ok(detail);
    assert.equal(detail?.id, ATTACHMENT_ID);
    assert.equal(detail?.patientId, PATIENT_ID);
    assert.equal(detail?.data, SEALED_DATA);
    assert.equal(detail?.name, SEALED_NAME);
});

test('getNetworkScopedAttachment returns null when the attachment does not belong to the path patient', async () => {
    resetDatabase();

    const crossPatient = await getNetworkScopedAttachment(PATIENT_ID, OTHER_PATIENT_ATTACHMENT_ID, SCOPE_AMBULATORY);
    assert.equal(crossPatient, null);

    const unknownId = await getNetworkScopedAttachment(PATIENT_ID, 'does-not-exist', SCOPE_AMBULATORY);
    assert.equal(unknownId, null);
});
