/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createAttachmentCurrentnessCas } from './attachment-currentness-cas';
import { createAttachmentOcrReplayCurrentness } from './attachment-ocr-replay-currentness';
import { createAttachmentWebPutCurrentness } from './attachment-web-put-currentness';

const REF_A = 'a'.repeat(64);

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ocr-delete-cas-'));
    const sqlite = new Database(path.join(dir, 'test.db'));
    sqlite.exec(`CREATE TABLE attachments (
        id TEXT PRIMARY KEY NOT NULL, document_source_ref TEXT NOT NULL UNIQUE,
        document_revision INTEGER NOT NULL, document_freshness_epoch INTEGER NOT NULL,
        marker TEXT NOT NULL CHECK(length(marker) > 0),
        ocr_queue_state TEXT, ocr_queue_reason TEXT, ocr_replay_artifact_snapshot TEXT,
        ocr_queue_updated_at INTEGER
    )`);
    sqlite.prepare(`INSERT INTO attachments VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)`)
        .run('attachment-a', REF_A, 'same', 'processing', null, null, 0);
    const database = drizzle(sqlite);
    const host = { database, runImmediateTransaction: <T>(operation: () => T) => sqlite.transaction(operation).immediate() };
    return {
        cas: createAttachmentCurrentnessCas(host),
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
const request = (overrides: Record<string, unknown> = {}) => ({
    id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 1, expectedFreshnessEpoch: 1,
    ...overrides,
});

test('deletes only its accepted pre-delete binding without fabricating a next revision', () => {
    const value = fixture();
    try {
        const outcome = value.cas.delete(request());
        assert.deepEqual(outcome, { status: 'committed' });
        assert.deepEqual(value.sqlite.prepare('SELECT * FROM attachments').all(), []);
        assert.deepEqual(Object.keys(outcome), ['status']);
        assert.equal(Object.isFrozen(outcome), true);
    } finally { value.close(); }
});

test('denies hostile snapshots without reading accessors, proxies, or ambient then', () => {
    const value = fixture();
    let reads = 0;
    const previousThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    const accessor = Object.defineProperty({
        id: 'attachment-a', documentSourceRef: REF_A, expectedFreshnessEpoch: 1,
    }, 'expectedRevision', { enumerable: true, get: () => { reads += 1; return 1; } });
    const proxy = new Proxy(request(), { get(target, key, receiver) { reads += 1; return Reflect.get(target, key, receiver); } });
    try {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => { reads += 1; return () => undefined; } });
        for (const requestValue of [accessor, proxy, { ...request(), extra: true }, { id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 1 },
            request({ expectedRevision: 0 }), request({ expectedFreshnessEpoch: 1.5 })]) {
            assert.deepEqual(value.cas.delete(requestValue), { status: 'denied', code: 'invalid_request' });
        }
        assert.equal(reads, 0);
        assert.equal((value.sqlite.prepare('SELECT count(*) AS count FROM attachments').get() as { count: number }).count, 1);
    } finally {
        if (previousThen) Object.defineProperty(Object.prototype, 'then', previousThen);
        else delete (Object.prototype as { then?: unknown }).then;
        value.close();
    }
});

test('denies missing, mismatched, stale, and split identity without deleting', () => {
    const value = fixture();
    try {
        assert.deepEqual(value.cas.delete(request({ id: 'missing', documentSourceRef: 'b'.repeat(64) })), { status: 'denied', code: 'missing' });
        assert.deepEqual(value.cas.delete(request({ documentSourceRef: 'b'.repeat(64) })), { status: 'denied', code: 'identity_mismatch' });
        assert.deepEqual(value.cas.delete(request({ expectedRevision: 2 })), { status: 'denied', code: 'stale' });
        value.sqlite.prepare(`INSERT INTO attachments VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)`)
            .run('attachment-b', 'b'.repeat(64), 'other', 'processing', null, null, 0);
        assert.deepEqual(value.cas.delete(request({ documentSourceRef: 'b'.repeat(64) })), { status: 'denied', code: 'cardinality_violation' });
        assert.equal((value.sqlite.prepare('SELECT count(*) AS count FROM attachments').get() as { count: number }).count, 2);
    } finally { value.close(); }
});

test('fences Web PUT and OCR replay races against a stale deletion snapshot', () => {
    const value = fixture();
    try {
        assert.deepEqual(value.webPut.mutate(snapshot(), () => {
            const changes = value.sqlite.prepare("UPDATE attachments SET marker = 'web-put'").run().changes;
            return { changes };
        }), { status: 'updated' });
        assert.deepEqual(value.cas.delete(request()), { status: 'denied', code: 'stale' });
        assert.deepEqual(value.replay.commit({
            ...snapshot({ documentRevision: 2, documentFreshnessEpoch: 2 }),
            ocrQueueState: 'processing', ocrQueueReason: null, ocrReplayArtifactSnapshot: null,
        }, { outcome: 'applied', nextState: 'ocr_done', artifactSnapshot: 'synthetic-artifact', updatedAtMs: 1 }), { status: 'updated' });
        assert.deepEqual(value.cas.delete(request({ expectedRevision: 2, expectedFreshnessEpoch: 2 })), { status: 'denied', code: 'stale' });
        assert.deepEqual(value.cas.delete(request({ expectedRevision: 3, expectedFreshnessEpoch: 3 })), { status: 'committed' });
        assert.deepEqual(value.webPut.mutate(snapshot({ documentRevision: 3, documentFreshnessEpoch: 3 }), () => ({ changes: 1 })), { status: 'not_found' });
        assert.deepEqual(value.replay.commit({
            ...snapshot({ documentRevision: 3, documentFreshnessEpoch: 3 }),
            ocrQueueState: 'ocr_done', ocrQueueReason: null, ocrReplayArtifactSnapshot: 'synthetic-artifact',
        }, { outcome: 'duplicate', nextState: 'ocr_done', artifactSnapshot: 'synthetic-artifact', updatedAtMs: 2 }), { status: 'not_found' });
    } finally { value.close(); }
});

test('rolls back resurrection and reentry so delete/delete remains fail-closed', () => {
    const value = fixture();
    let nested: unknown;
    try {
        value.sqlite.exec(`CREATE TRIGGER resurrect_attachment AFTER DELETE ON attachments BEGIN
            INSERT INTO attachments VALUES ('attachment-a', '${REF_A}', 1, 1, 'resurrected', 'processing', NULL, NULL, 0);
        END`);
        assert.deepEqual(value.cas.delete(request()), { status: 'denied', code: 'cardinality_violation' });
        assert.deepEqual(value.sqlite.prepare('SELECT marker FROM attachments').get(), { marker: 'same' });
        value.sqlite.exec('DROP TRIGGER resurrect_attachment');
        value.sqlite.function('fail_delete', () => { throw new Error('synthetic storage fault'); });
        value.sqlite.exec('CREATE TRIGGER fail_attachment BEFORE DELETE ON attachments BEGIN SELECT fail_delete(); END');
        assert.deepEqual(value.cas.delete(request()), { status: 'denied', code: 'storage_unavailable' });
        assert.deepEqual(value.sqlite.prepare('SELECT marker FROM attachments').get(), { marker: 'same' });
        value.sqlite.exec('DROP TRIGGER fail_attachment');
        value.sqlite.function('reenter_delete', () => { nested = value.cas.delete(request()); return 1; });
        value.sqlite.exec('CREATE TRIGGER reenter_attachment AFTER DELETE ON attachments BEGIN SELECT reenter_delete(); END');
        assert.deepEqual(value.cas.delete(request()), { status: 'denied', code: 'operation_reentered' });
        assert.deepEqual(nested, { status: 'denied', code: 'operation_reentered' });
        assert.equal((value.sqlite.prepare('SELECT count(*) AS count FROM attachments').get() as { count: number }).count, 1);
        value.sqlite.exec('DROP TRIGGER reenter_attachment');
        assert.deepEqual(value.cas.delete(request()), { status: 'committed' });
        assert.deepEqual(value.cas.delete(request()), { status: 'denied', code: 'missing' });
    } finally { value.close(); }
});
