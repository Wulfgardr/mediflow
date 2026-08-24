/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createAttachmentOcrReplayCurrentness } from './attachment-ocr-replay-currentness';
import { createAttachmentWebDeleteCurrentness } from './attachment-web-delete-currentness';
import { createAttachmentWebPutCurrentness } from './attachment-web-put-currentness';

const REF_A = 'a'.repeat(64);

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ocr-web-delete-'));
    const sqlite = new Database(path.join(dir, 'test.db'));
    sqlite.exec(`CREATE TABLE attachments (
        id TEXT PRIMARY KEY NOT NULL, document_source_ref TEXT NOT NULL UNIQUE,
        document_revision INTEGER NOT NULL, document_freshness_epoch INTEGER NOT NULL,
        marker TEXT NOT NULL CHECK(length(marker) > 0), ocr_queue_state TEXT,
        ocr_queue_reason TEXT, ocr_replay_artifact_snapshot TEXT, ocr_queue_updated_at INTEGER
    )`);
    sqlite.prepare(`INSERT INTO attachments VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)`)
        .run('attachment-a', REF_A, 'same', 'processing', null, null, 0);
    const database = drizzle(sqlite);
    const host = { database, runImmediateTransaction: <T>(operation: () => T) => sqlite.transaction(operation).immediate() };
    return {
        currentness: createAttachmentWebDeleteCurrentness(host),
        webPut: createAttachmentWebPutCurrentness(host),
        replay: createAttachmentOcrReplayCurrentness(host),
        sqlite,
        close: () => { sqlite.close(); fs.rmSync(dir, { recursive: true }); },
    };
}

const snapshot = (overrides: Record<string, unknown> = {}) => ({
    id: 'attachment-a', documentSourceRef: REF_A, documentRevision: 1, documentFreshnessEpoch: 1,
    ...overrides,
});

test('deletes its host-owned binding and keeps the legacy response token absent from the adapter', () => {
    const value = fixture();
    try {
        assert.deepEqual(value.currentness.delete(snapshot()), { status: 'deleted' });
        assert.deepEqual(value.sqlite.prepare('SELECT * FROM attachments').all(), []);
        assert.deepEqual(Object.keys(value.currentness.delete(snapshot())), ['status']);
    } finally { value.close(); }
});

test('denies descriptor, proxy, accessor, extra-key, and ambient-then snapshots without reads', () => {
    const value = fixture();
    const previousThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let reads = 0;
    const accessor = Object.defineProperty({
        id: 'attachment-a', documentSourceRef: REF_A, documentFreshnessEpoch: 1,
    }, 'documentRevision', { enumerable: true, get: () => { reads += 1; return 1; } });
    const proxy = new Proxy(snapshot(), { get(target, key, receiver) { reads += 1; return Reflect.get(target, key, receiver); } });
    try {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => { reads += 1; return () => undefined; } });
        for (const valueToDelete of [accessor, proxy, { ...snapshot(), extra: true }, { id: 'attachment-a', documentSourceRef: REF_A, documentRevision: 1 }]) {
            assert.deepEqual(value.currentness.delete(valueToDelete), { status: 'failed' });
        }
        assert.equal(reads, 0);
        assert.equal((value.sqlite.prepare('SELECT count(*) AS count FROM attachments').get() as { count: number }).count, 1);
    } finally {
        if (previousThen) Object.defineProperty(Object.prototype, 'then', previousThen);
        else delete (Object.prototype as { then?: unknown }).then;
        value.close();
    }
});

test('keeps missing idempotent while fencing identity, stale, and cardinality denial at conflict', () => {
    const value = fixture();
    try {
        assert.deepEqual(value.currentness.delete(snapshot({ id: 'missing', documentSourceRef: 'b'.repeat(64) })), { status: 'deleted' });
        assert.deepEqual(value.currentness.delete(snapshot({ documentSourceRef: 'b'.repeat(64) })), { status: 'conflict' });
        assert.deepEqual(value.currentness.delete(snapshot({ documentRevision: 2 })), { status: 'conflict' });
        value.sqlite.prepare(`INSERT INTO attachments VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)`)
            .run('attachment-b', 'b'.repeat(64), 'other', 'processing', null, null, 0);
        assert.deepEqual(value.currentness.delete(snapshot({ documentSourceRef: 'b'.repeat(64) })), { status: 'conflict' });
        assert.equal((value.sqlite.prepare('SELECT count(*) AS count FROM attachments').get() as { count: number }).count, 2);
    } finally { value.close(); }
});

test('fences PUT/delete and replay/delete in both orders without retry', () => {
    const value = fixture();
    try {
        assert.deepEqual(value.webPut.mutate(snapshot(), () => {
            const changes = value.sqlite.prepare("UPDATE attachments SET marker = 'web-put'").run().changes;
            return { changes };
        }), { status: 'updated' });
        assert.deepEqual(value.currentness.delete(snapshot()), { status: 'conflict' });
        assert.deepEqual(value.currentness.delete(snapshot({ documentRevision: 2, documentFreshnessEpoch: 2 })), { status: 'deleted' });
        assert.deepEqual(value.webPut.mutate(snapshot({ documentRevision: 2, documentFreshnessEpoch: 2 }), () => ({ changes: 1 })), { status: 'not_found' });
    } finally { value.close(); }

    const replayFirst = fixture();
    try {
        assert.deepEqual(replayFirst.replay.commit({
            ...snapshot(), ocrQueueState: 'processing', ocrQueueReason: null, ocrReplayArtifactSnapshot: null,
        }, { outcome: 'applied', nextState: 'ocr_done', artifactSnapshot: 'synthetic-artifact', updatedAtMs: 1 }), { status: 'updated' });
        assert.deepEqual(replayFirst.currentness.delete(snapshot()), { status: 'conflict' });
        assert.deepEqual(replayFirst.currentness.delete(snapshot({ documentRevision: 2, documentFreshnessEpoch: 2 })), { status: 'deleted' });
        assert.deepEqual(replayFirst.replay.commit({
            ...snapshot({ documentRevision: 2, documentFreshnessEpoch: 2 }),
            ocrQueueState: 'ocr_done', ocrQueueReason: null, ocrReplayArtifactSnapshot: 'synthetic-artifact',
        }, { outcome: 'duplicate', nextState: 'ocr_done', artifactSnapshot: 'synthetic-artifact', updatedAtMs: 2 }), { status: 'not_found' });
    } finally { replayFirst.close(); }
});

test('maps a concurrent second delete to legacy idempotency and storage or reentry to minimized failure', () => {
    const value = fixture();
    let nested: unknown;
    try {
        assert.deepEqual(value.currentness.delete(snapshot()), { status: 'deleted' });
        assert.deepEqual(value.currentness.delete(snapshot()), { status: 'deleted' });
    } finally { value.close(); }

    const faults = fixture();
    try {
        faults.sqlite.function('fail_delete', () => { throw new Error('synthetic storage fault'); });
        faults.sqlite.exec('CREATE TRIGGER fail_attachment BEFORE DELETE ON attachments BEGIN SELECT fail_delete(); END');
        assert.deepEqual(faults.currentness.delete(snapshot()), { status: 'failed' });
        faults.sqlite.exec('DROP TRIGGER fail_attachment');
        faults.sqlite.function('reenter_delete', () => { nested = faults.currentness.delete(snapshot()); return 1; });
        faults.sqlite.exec('CREATE TRIGGER reenter_attachment AFTER DELETE ON attachments BEGIN SELECT reenter_delete(); END');
        assert.deepEqual(faults.currentness.delete(snapshot()), { status: 'conflict' });
        assert.deepEqual(nested, { status: 'conflict' });
        assert.equal((faults.sqlite.prepare('SELECT count(*) AS count FROM attachments').get() as { count: number }).count, 1);
    } finally { faults.close(); }
});

test('the DELETE route authenticates, owns the exact snapshot, rejects no request body, and emits only legacy success', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'app/api/attachments/[id]/route.ts'), 'utf8');
    const deleted = source.slice(source.indexOf('export async function DELETE'));
    assert.match(source, /createAttachmentWebDeleteCurrentness/);
    assert.match(source, /runDbServerImmediateTransaction/);
    assert.match(deleted, /requireSession\(\)/);
    assert.match(deleted, /attachmentWebDeleteCurrentness\.delete\(existing\)/);
    for (const field of ['id', 'documentSourceRef', 'documentRevision', 'documentFreshnessEpoch']) assert.match(deleted, new RegExp(field));
    assert.doesNotMatch(deleted, /request\.json|request\.text|request\.formData|request\.arrayBuffer/);
    assert.doesNotMatch(deleted, /dbServer\.delete\(attachments\)/);
    assert.doesNotMatch(deleted, /console\./);
    assert.match(deleted, /status:\s*409/);
    assert.match(deleted, /status:\s*500/);
    assert.match(deleted, /NextResponse\.json\(\{ success: true \}\)/);
    assert.doesNotMatch(deleted, /receipt/);
});
