/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

import { buildAttachmentPath } from './attachment-path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-attachment-create-'));
const dbPath = path.join(dataDir, 'medical.db');
process.env.MEDIFLOW_DATA_DIR = dataDir;

const migrationDb = new Database(dbPath);
try {
    migrationDb.pragma('foreign_keys = OFF');
    for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
        migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
    }
} finally {
    migrationDb.close();
}

const { createWebAttachment } = await import('./attachment-web-create.ts');
const route = await import('../app/api/attachments/route.ts');
const detailRoute = await import('../app/api/attachments/[id]/route.ts');
const requireCurrent = createRequire(import.meta.url);
const serverAuth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown> };

const patientId = 'patient.synthetic.currentness';
const sessionUsername = ['synthetic', 'web'].join('.');
const session = {
    id: 'session.synthetic', userId: 'user.synthetic', username: sessionUsername, role: 'admin',
    authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER,
} as const;

function reset(): void {
    const db = new Database(dbPath);
    try {
        db.exec('DELETE FROM attachments; DELETE FROM patients;');
        db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
            .run(patientId, 'Ada', 'Synthetic', 'SYNTHETIC00000000');
    } finally {
        db.close();
    }
}

function rows(): Array<Record<string, unknown>> {
    const db = new Database(dbPath, { readonly: true });
    try {
        return db.prepare('SELECT id, patient_id, document_source_ref, document_revision, document_freshness_epoch FROM attachments ORDER BY id').all() as Array<Record<string, unknown>>;
    } finally {
        db.close();
    }
}

function request(payload: Record<string, unknown>): Request {
    return new Request('http://localhost/api/attachments', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        patientId,
        name: 'synthetic.pdf',
        type: 'application/pdf',
        size: 1,
        path: 'attachments/synthetic.pdf',
        ...overrides,
    };
}

async function invoke(requestValue: Request, sessionValue: unknown = session, extra?: unknown): Promise<Response> {
    return (createWebAttachment as (...args: unknown[]) => Promise<Response>)(requestValue, sessionValue, extra);
}

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('web creation persists a production lower-hex initial host tuple', async () => {
    reset();
    const response = await invoke(request(payload({ id: 'attachment.synthetic.currentness' })));

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'attachment.synthetic.currentness' });
    const [created] = rows();
    assert.equal(created?.id, 'attachment.synthetic.currentness');
    assert.equal(created?.patient_id, patientId);
    assert.match(created?.document_source_ref as string, /^[0-9a-f]{64}$/u);
    assert.equal(created?.document_revision, 1);
    assert.equal(created?.document_freshness_epoch, 1);
});

test('web creation denies absent auth, invalid input, currentness injection, and missing patients', async () => {
    const rejected = [
        { session: null, body: payload() },
        { session, body: payload({ size: -1 }) },
        { session, body: payload({ documentSourceRef: 'a'.repeat(64) }) },
        { session, body: payload({ documentRevision: 1 }) },
        { session, body: payload({ documentFreshnessEpoch: 1 }) },
        { session, body: payload({ patientId: 'patient.synthetic.missing' }) },
    ];
    for (const item of rejected) {
        reset();
        const response = await invoke(request(item.body), item.session);
        assert.ok([400, 401, 404].includes(response.status));
        assert.deepEqual(rows(), []);
    }
});

test('extra JavaScript mint callbacks are ignored for missing and soft-deleted patients', async () => {
    let extraCalls = 0;
    const extra = () => { extraCalls += 1; };
    reset();
    const missing = await invoke(request(payload({ patientId: 'patient.synthetic.missing' })), session, extra);
    assert.equal(missing.status, 404);
    assert.deepEqual(rows(), []);

    reset();
    const db = new Database(dbPath);
    try {
        db.prepare('UPDATE patients SET deleted_at = unixepoch() WHERE id = ?').run(patientId);
    } finally {
        db.close();
    }
    const deleted = await invoke(request(payload()), session, extra);
    assert.equal(deleted.status, 404);
    assert.deepEqual(rows(), []);
    assert.equal(extraCalls, 0);
});

test('web list response omits every currentness tuple field', async () => {
    reset();
    const created = await invoke(request(payload({ id: 'attachment.synthetic.list' })));
    assert.equal(created.status, 201);
    const originalRequireSession = serverAuth.requireSession;
    try {
        serverAuth.requireSession = async () => session;
        const response = await route.GET(new Request('http://localhost/api/attachments'));
        assert.equal(response.status, 200);
        const [attachment] = await response.json() as Array<Record<string, unknown>>;
        assert.ok(attachment);
        for (const key of ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch']) assert.equal(key in attachment, false);
    } finally {
        serverAuth.requireSession = originalRequireSession;
    }
});

test('web detail response preserves the legacy payload projection without currentness', async () => {
    const attachmentId = 'attachment.synthetic.detail';
    const attachmentPath = '/private/synthetic/detail.pdf';
    reset();
    const db = new Database(dbPath);
    try {
        db.prepare(`INSERT INTO attachments (
            id, patient_id, name, type, size, path, data, summary_snapshot,
            parse_evidence_artifact_snapshot, ocr_queue_state, ocr_queue_reason,
            ocr_queue_updated_at, ocr_replay_artifact_snapshot, created_at,
            document_source_ref, document_revision, document_freshness_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
                attachmentId, patientId, 'detail.pdf', 'application/pdf', 17, attachmentPath, 'synthetic-base64', 'summary',
                'evidence', 'pending', 'paired_upload', 1, 'replay', 2, 'd'.repeat(64), 1, 1,
            );
    } finally {
        db.close();
    }
    const originalRequireSession = serverAuth.requireSession;
    try {
        serverAuth.requireSession = async () => session;
        const response = await detailRoute.GET(new Request(`http://localhost/api/attachments/${attachmentId}`), {
            params: Promise.resolve({ id: attachmentId }),
        });
        assert.equal(response.status, 200);
        const detail = await response.json() as Record<string, unknown>;
        assert.deepEqual(Object.keys(detail).sort(), [
            'createdAt', 'data', 'id', 'name', 'ocrQueueReason', 'ocrQueueState', 'ocrQueueUpdatedAt',
            'ocrReplayArtifactSnapshot', 'parseEvidenceArtifactSnapshot', 'path', 'patientId', 'size',
            'summarySnapshot', 'type',
        ]);
        assert.equal(detail.data, 'synthetic-base64');
        assert.equal(detail.path, buildAttachmentPath(attachmentPath, 'detail.pdf', attachmentId));
        for (const key of ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch']) assert.equal(key in detail, false);
    } finally {
        serverAuth.requireSession = originalRequireSession;
    }
});

test('web creation rolls back a duplicate id and generates unique host refs concurrently', async () => {
    reset();
    const first = await invoke(request(payload({ id: 'attachment.synthetic.first' })));
    assert.equal(first.status, 201);
    const collision = await invoke(request(payload({ id: 'attachment.synthetic.first' })));
    assert.equal(collision.status, 500);
    assert.deepEqual(await collision.json(), { error: 'Create Failed' });
    assert.equal(rows().length, 1);

    reset();
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) =>
        invoke(request(payload({ id: `attachment.synthetic.concurrent.${index}` }))),
    ));
    assert.deepEqual(responses.map((response) => response.status), Array(8).fill(201));
    const created = rows();
    assert.equal(created.length, 8);
    assert.equal(new Set(created.map((row) => row.document_source_ref)).size, 8);
    assert.ok(created.every((row) => row.document_revision === 1 && row.document_freshness_epoch === 1));
});
