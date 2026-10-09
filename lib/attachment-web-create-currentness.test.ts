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
const { dbServer } = await import('./db-server.ts');
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

test('web creation reserves the WAL writer before validating the active patient', async () => {
    reset();
    const transaction = dbServer.transaction.bind(dbServer);
    const contender = new Database(dbPath);
    contender.pragma('busy_timeout = 1');
    let contenderResult = 'not_attempted';
    const interceptGet = (target: object): object => new Proxy(target, {
        get(object, property, receiver) {
            const value = Reflect.get(object, property, receiver) as unknown;
            if (typeof value !== 'function') return value;
            if (property === 'get') return (...args: unknown[]) => {
                const selected = Reflect.apply(value, object, args) as unknown;
                try {
                    contender.prepare('UPDATE patients SET first_name = ? WHERE id = ?')
                        .run('Concurrent Synthetic', patientId);
                    contenderResult = 'committed';
                } catch (error) {
                    contenderResult = error && typeof error === 'object' && 'code' in error
                        ? String(error.code) : 'unknown_error';
                }
                return selected;
            };
            return (...args: unknown[]) => {
                const result = Reflect.apply(value, object, args) as unknown;
                return result && typeof result === 'object' ? interceptGet(result) : result;
            };
        },
    });
    try {
        dbServer.transaction = ((callback: Parameters<typeof dbServer.transaction>[0], config?: Parameters<typeof dbServer.transaction>[1]) =>
            transaction((tx) => callback(new Proxy(tx, {
                get(target, property, receiver) {
                    const value = Reflect.get(target, property, receiver) as unknown;
                    if (property !== 'select' || typeof value !== 'function') return value;
                    return (...args: unknown[]) => interceptGet(Reflect.apply(value, target, args) as object);
                },
            })), config)) as typeof dbServer.transaction;
        const response = await invoke(request(payload({ id: 'attachment.synthetic.writer-lock' })));
        assert.equal(response.status, 201);
        assert.equal(contenderResult, 'SQLITE_BUSY');
        assert.equal(rows().some((row) => row.id === 'attachment.synthetic.writer-lock'), true);
    } finally {
        dbServer.transaction = transaction;
        contender.close();
    }
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

test('web list and metadata reads expose nested currentness with the observed record', async () => {
    reset();
    const created = await invoke(request(payload({ id: 'attachment.synthetic.list' })));
    assert.equal(created.status, 201);
    const originalRequireSession = serverAuth.requireSession;
    try {
        serverAuth.requireSession = async () => session;
        for (const suffix of ['', '?metadata=true']) {
            const response = await route.GET(new Request(`http://localhost/api/attachments${suffix}`));
            assert.equal(response.status, 200);
            const [attachment] = await response.json() as Array<Record<string, unknown>>;
            const row = rows()[0]!;
            assert.deepEqual(attachment.currentness, { sourceRef: row.document_source_ref, revision: 1, freshnessEpoch: 1 });
            assert.equal(attachment.patientId, patientId);
            for (const key of ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch']) assert.equal(key in attachment, false);
            if (suffix) assert.equal('data' in attachment, false);
        }
    } finally {
        serverAuth.requireSession = originalRequireSession;
    }
});

test('web detail exposes nested currentness alongside the payload', async () => {
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
            'createdAt', 'currentness', 'data', 'id', 'name', 'ocrQueueReason', 'ocrQueueState', 'ocrQueueUpdatedAt',
            'ocrReplayArtifactSnapshot', 'parseEvidenceArtifactSnapshot', 'path', 'patientId', 'size',
            'summarySnapshot', 'type',
        ]);
        assert.deepEqual(detail.currentness, { sourceRef: 'd'.repeat(64), revision: 1, freshnessEpoch: 1 });
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
    assert.equal(collision.status, 409);
    assert.deepEqual(await collision.json(), { error: 'Attachment already exists' });
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

function snapshot(): { attachments: unknown[]; audit: Array<Record<string, unknown>> } {
    const sql = new Database(dbPath, { readonly: true });
    try {
        return {
            attachments: sql.prepare('SELECT * FROM attachments ORDER BY id').all(),
            audit: sql.prepare('SELECT * FROM audit_events ORDER BY rowid').all() as Array<Record<string, unknown>>,
        };
    } finally { sql.close(); }
}

async function remove(id: string, admitted: unknown = session): Promise<Response> {
    const original = serverAuth.requireSession;
    try {
        serverAuth.requireSession = async () => admitted;
        const row = rows().find(row => row.id === id);
        return await detailRoute.DELETE(new Request(`http://localhost/api/attachments/${id}`, {
            method: 'DELETE', headers: { 'x-mediflow-source-surface': 'job' },
            body: JSON.stringify({ patientId, expected: { sourceRef: row?.document_source_ref ?? 'a'.repeat(64),
                revision: row?.document_revision ?? 1, freshnessEpoch: row?.document_freshness_epoch ?? 1 } }),
        }), { params: Promise.resolve({ id }) });
    } finally { serverAuth.requireSession = original; }
}

test('create and delete commit exactly one session-derived event without clinical metadata', async () => {
    reset();
    const before = snapshot();
    const id = 'attachment.synthetic.audit';
    const response = await invoke(new Request('http://localhost/api/attachments', {
        method: 'POST', headers: { 'x-mediflow-source-surface': 'job' },
        body: JSON.stringify(payload({ id, data: 'ENC:c3ludGhldGlj:YmxvYg==' })),
    }));
    assert.equal(response.status, 201);
    const created = snapshot();
    assert.equal(created.audit.length, before.audit.length + 1);
    assert.equal((await remove(id)).status, 200);
    const deleted = snapshot();
    assert.equal(deleted.audit.length, created.audit.length + 1);
    assert.deepEqual(deleted.attachments, []);
    const events = deleted.audit.slice(before.audit.length);
    assert.deepEqual(events.map(event => event.event_type), ['attachment.created', 'attachment.deleted']);
    for (const event of events) {
        assert.equal(event.actor_ref, session.userId);
        assert.equal(event.actor_type, 'user');
        assert.equal(event.subject_type, 'attachment');
        assert.equal(event.subject_ref, id);
        assert.equal(event.source_surface, 'web');
        assert.equal(event.outcome, 'success');
        assert.deepEqual(JSON.parse(event.redacted_metadata as string), { flags: ['auth:session'] });
    }
});

test('audit FAIL and IGNORE roll back create and delete including the whole currentness tuple', async () => {
    for (const operation of ['create', 'delete']) {
        for (const fault of ["FAIL, 'synthetic audit fault'", 'IGNORE']) {
            reset();
            const id = `attachment.synthetic.rollback.${operation}`;
            if (operation === 'delete') assert.equal((await invoke(request(payload({ id })))).status, 201);
            const before = snapshot();
            const sql = new Database(dbPath);
            try {
                sql.exec(`CREATE TRIGGER synthetic_attachment_audit_fault BEFORE INSERT ON audit_events
                    BEGIN SELECT RAISE(${fault}); END`);
                const response = operation === 'create' ? await invoke(request(payload({ id }))) : await remove(id);
                assert.deepEqual(snapshot(), before, `${operation} ${fault}: data/currentness/events must roll back`);
                assert.equal(response.status, 500, `${operation} ${fault}`);
            } finally {
                sql.exec('DROP TRIGGER IF EXISTS synthetic_attachment_audit_fault');
                sql.close();
            }
        }
    }
});

test('create rejects malformed, non-object, wrong-type and oversized JSON before side effects', async () => {
    reset();
    const previous = process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
    process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = '1024';
    try {
        for (const body of ['{', '', 'null', '[]', '17', JSON.stringify(payload({ size: '1' })),
            JSON.stringify(payload({ patientId: 17 })), JSON.stringify(payload({ name: ' ' })),
            JSON.stringify(payload({ ocrQueueState: 'unknown' })), JSON.stringify(payload({ actorRef: 'injected' }))]) {
            const before = snapshot();
            const response = await invoke(new Request('http://localhost/api/attachments', { method: 'POST', body }));
            assert.equal(response.status, 400, body);
            assert.deepEqual(snapshot(), before);
        }
        const valid = JSON.stringify(payload({ id: 'attachment.synthetic.bound' }));
        const atLimit = valid + ' '.repeat(1024 - Buffer.byteLength(valid));
        assert.equal((await invoke(new Request('http://localhost/api/attachments', { method: 'POST', body: atLimit }))).status, 201);
        for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '1025' }] as HeadersInit[]) {
            const before = snapshot();
            const response = await invoke(new Request('http://localhost/api/attachments', {
                method: 'POST', headers, body: atLimit + ' ',
            }));
            assert.equal(response.status, 413);
            assert.deepEqual(snapshot(), before);
        }
    } finally {
        if (previous === undefined) delete process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
        else process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = previous;
    }
});

test('auth, missing/deleted parent, duplicate ID and missing delete preserve data and events', async () => {
    reset();
    const id = 'attachment.synthetic.scope';
    assert.equal((await invoke(request(payload({ id })))).status, 201);
    const before = snapshot();
    assert.equal((await invoke(request(payload({ id })))).status, 409);
    assert.equal((await invoke(request(payload()), null)).status, 401);
    assert.equal((await remove(id, null)).status, 401);
    assert.equal((await remove('attachment.synthetic.missing')).status, 404);
    assert.equal((await invoke(request(payload({ patientId: 'patient.synthetic.missing' })))).status, 404);
    assert.deepEqual(snapshot(), before);
    const sql = new Database(dbPath);
    try { sql.prepare('UPDATE patients SET deleted_at = unixepoch() WHERE id = ?').run(patientId); }
    finally { sql.close(); }
    assert.equal((await invoke(request(payload()))).status, 404);
    assert.deepEqual(snapshot(), before);
});


test('ignored attachment insert fails without an orphan creation audit', async () => {
    reset();
    const before = snapshot();
    const sql = new Database(dbPath);
    try {
        sql.exec(`CREATE TRIGGER synthetic_attachment_insert_ignore BEFORE INSERT ON attachments
            BEGIN SELECT RAISE(IGNORE); END`);
        const response = await invoke(request(payload({ id: 'attachment.synthetic.ignored' })));
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: 'Create Failed' });
        assert.deepEqual(snapshot(), before);
    } finally {
        sql.exec('DROP TRIGGER IF EXISTS synthetic_attachment_insert_ignore');
        sql.close();
    }
});
