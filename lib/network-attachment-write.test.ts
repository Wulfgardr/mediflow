/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';

import { ambulatories, attachments, auditEvents, patients, patientsToAmbulatories } from './schema';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-network-attachment-write-'));
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
const { createNetworkScopedAttachment } = await import('./network-attachment-write.ts');

const SCOPE_AMBULATORY = 'amb-attachment-write-scope';
const OTHER_AMBULATORY = 'amb-attachment-write-other';
const PATIENT_ID = 'patient-attachment-write-1';

// Real client-of-origin projection (D3, ADR 0076): the paired client sends
// only patientId (from the path)/name/path/data/type/size, a proper subset
// of the web payload built by components/document-upload.tsx +
// ApiTable ENCRYPTED_FIELDS (lib/db.ts). name/path/data are sealed by the
// client crypto layer before the request leaves the device.
const SEALED_NAME = 'ENC:aXY=:bmFtZQ==';
const SEALED_PATH = 'ENC:aXY=:cGF0aA==';
const SEALED_DATA = 'ENC:aXY=:ZGF0YQ==';

function validCreateBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: SEALED_NAME,
        path: SEALED_PATH,
        data: SEALED_DATA,
        type: 'application/pdf',
        size: 2048,
        ...overrides,
    };
}

function makeContext() {
    return {
        request: new Request('https://localhost/api/v1/network/patients/' + PATIENT_ID + '/attachments'),
        patientId: PATIENT_ID,
        scopeAmbulatoryId: SCOPE_AMBULATORY,
        pairedClient: { clientId: 'client-attachment-write-test' } as never,
        session: { userId: 'user-attachment-write-test' } as never,
    };
}

function resetDatabase(): void {
    dbServer.delete(attachments).run();
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values([
        { id: SCOPE_AMBULATORY, name: 'Ambulatorio Documenti', type: 'live' },
        { id: OTHER_AMBULATORY, name: 'Altro Ambulatorio', type: 'live' },
    ]).run();
    dbServer.insert(patients).values([{
        id: PATIENT_ID,
        firstName: 'Ada',
        lastName: 'Sealed',
        taxCode: 'ADASEALED02',
        version: 1,
    }]).run();
    dbServer.insert(patientsToAmbulatories).values([{ patientId: PATIENT_ID, ambulatoryId: SCOPE_AMBULATORY }]).run();
}

test('network attachment create accepts the real paired projection and applies server defaults', async () => {
    resetDatabase();

    const result = await createNetworkScopedAttachment(makeContext(), validCreateBody());
    assert.equal(result.status, 201);
    if (result.status !== 201) return;
    assert.match(result.value.id, /^[0-9a-f-]{36}$/);

    const row = dbServer.select().from(attachments).where(eq(attachments.id, result.value.id)).get();
    assert.ok(row);
    assert.equal(row?.patientId, PATIENT_ID);
    assert.equal(row?.name, SEALED_NAME);
    assert.equal(row?.data, SEALED_DATA);
    assert.equal(row?.type, 'application/pdf');
    assert.equal(row?.size, 2048);
    assert.match(row?.path ?? '', new RegExp(`^attachments/${result.value.id}-`));
    assert.equal(row?.summarySnapshot, null);
    assert.equal(row?.parseEvidenceArtifactSnapshot, null);
    assert.equal(row?.ocrQueueState, 'pending');
    assert.equal(row?.ocrQueueReason, 'paired_upload');
    assert.ok(row?.ocrQueueUpdatedAt);
    assert.ok(row?.createdAt);

    const audit = dbServer.select().from(auditEvents)
        .where(and(eq(auditEvents.eventType, 'attachment.created'), eq(auditEvents.subjectRef, result.value.id)))
        .get();
    assert.ok(audit);
    const metadata = JSON.parse(audit?.redactedMetadata ?? '{}') as { flags?: string[] };
    assert.deepEqual(metadata.flags, [
        'auth:paired-client',
        'paired-client:client-attachment-write-test',
        'scope:ambulatory',
    ]);
});

test('network attachment create rejects every field forbidden by presence', async () => {
    resetDatabase();

    const forbiddenFieldValues: Record<string, unknown> = {
        patientId: PATIENT_ID,
        id: 'client-supplied-id',
        summarySnapshot: 'ENC:aXY=:c3VtbWFyeQ==',
        parseEvidenceArtifactSnapshot: 'ENC:aXY=:ZXZpZGVuY2U=',
        ocrQueueState: 'pending',
        ocrQueueReason: 'text_layer_absent',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    for (const [field, value] of Object.entries(forbiddenFieldValues)) {
        const result = await createNetworkScopedAttachment(makeContext(), validCreateBody({ [field]: value }));
        assert.equal(result.status, 400, `expected 400 for forbidden field ${field}`);
        assert.deepEqual(result.value, {
            error: `Network document write boundary rejects client-controlled ${field}`,
        });
    }

    const count = dbServer.select().from(attachments).all().length;
    assert.equal(count, 0);
});

test('network attachment create requires name, path, and data sealed with ENC:', async () => {
    resetDatabase();

    for (const field of ['name', 'path', 'data'] as const) {
        const plaintext = await createNetworkScopedAttachment(makeContext(), validCreateBody({ [field]: 'plain value' }));
        assert.equal(plaintext.status, 400);
        assert.deepEqual(plaintext.value, {
            error: `Network document write boundary requires sealed ${field}`,
        });

        const missingBody = validCreateBody();
        delete missingBody[field];
        const missing = await createNetworkScopedAttachment(makeContext(), missingBody);
        assert.equal(missing.status, 400);
        assert.deepEqual(missing.value, {
            error: `Network document write boundary requires sealed ${field}`,
        });
    }
});

test('network attachment create requires a non-empty type and a non-negative size', async () => {
    resetDatabase();

    const missingType = await createNetworkScopedAttachment(makeContext(), validCreateBody({ type: '' }));
    assert.equal(missingType.status, 400);
    assert.deepEqual(missingType.value, {
        error: 'Network document write boundary requires a non-empty type',
    });

    const negativeSize = await createNetworkScopedAttachment(makeContext(), validCreateBody({ size: -1 }));
    assert.equal(negativeSize.status, 400);
    assert.deepEqual(negativeSize.value, {
        error: 'Network document write boundary requires a non-negative size',
    });
});

test('network attachment create enforces the shared wire size limit', async () => {
    resetDatabase();
    process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = '32';
    try {
        const oversizedData = `ENC:${'a'.repeat(40)}=:${'b'.repeat(40)}=`;
        const result = await createNetworkScopedAttachment(makeContext(), validCreateBody({ data: oversizedData }));
        assert.equal(result.status, 413);
        assert.deepEqual(result.value, { error: 'Attachment payload too large' });
    } finally {
        delete process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
    }

    const count = dbServer.select().from(attachments).all().length;
    assert.equal(count, 0);
});

test('network attachment create returns 404 when the patient is outside scope or soft-deleted', async () => {
    resetDatabase();

    const outOfScopeContext = { ...makeContext(), scopeAmbulatoryId: OTHER_AMBULATORY };
    const outOfScope = await createNetworkScopedAttachment(outOfScopeContext, validCreateBody());
    assert.equal(outOfScope.status, 404);
    assert.deepEqual(outOfScope.value, { error: 'Not found' });

    dbServer.update(patients).set({ deletedAt: new Date() }).where(eq(patients.id, PATIENT_ID)).run();
    const softDeleted = await createNetworkScopedAttachment(makeContext(), validCreateBody());
    assert.equal(softDeleted.status, 404);
    assert.deepEqual(softDeleted.value, { error: 'Not found' });

    const count = dbServer.select().from(attachments).all().length;
    assert.equal(count, 0);
});
