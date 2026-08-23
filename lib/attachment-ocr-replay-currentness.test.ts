/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createAttachmentOcrReplayCurrentness } from './attachment-ocr-replay-currentness';
import { createAttachmentWebPutCurrentness } from './attachment-web-put-currentness';

const REF_A = 'a'.repeat(64);
const APPLIED_ARTIFACT = '{"schemaVersion":"mediflow.document_ocr_replay.v1","idempotencyKey":"synthetic-applied"}';

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ocr-replay-currentness-'));
    const sqlite = new Database(path.join(dir, 'test.db'));
    sqlite.exec(`CREATE TABLE attachments (
        id TEXT PRIMARY KEY NOT NULL, document_source_ref TEXT NOT NULL UNIQUE,
        document_revision INTEGER NOT NULL, document_freshness_epoch INTEGER NOT NULL,
        ocr_queue_state TEXT, ocr_queue_reason TEXT, ocr_queue_updated_at INTEGER,
        ocr_replay_artifact_snapshot TEXT
    )`);
    sqlite.prepare('INSERT INTO attachments VALUES (?, ?, 1, 1, ?, ?, ?, ?)')
        .run('attachment-a', REF_A, 'pending', 'image_or_scan', 1_700_000_000_000, null);
    const database = drizzle(sqlite);
    const host = { database, runImmediateTransaction: <T>(operation: () => T) => sqlite.transaction(operation).immediate() };
    return {
        currentness: createAttachmentOcrReplayCurrentness(host),
        webPut: createAttachmentWebPutCurrentness(host), sqlite,
        close: () => { sqlite.close(); fs.rmSync(dir, { recursive: true }); },
    };
}

const snapshot = (overrides: Record<string, unknown> = {}) => ({
    id: 'attachment-a', documentSourceRef: REF_A, documentRevision: 1, documentFreshnessEpoch: 1,
    ocrQueueState: 'pending', ocrQueueReason: 'image_or_scan', ocrReplayArtifactSnapshot: null,
    ...overrides,
});

test('atomically applies a replay artifact and advances paired currentness', () => {
    const value = fixture();
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let thenReads = 0;
    try {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { thenReads += 1; return () => undefined; } });
        const outcome = value.currentness.commit(snapshot(), {
            outcome: 'applied', nextState: 'ocr_done', artifactSnapshot: APPLIED_ARTIFACT,
            updatedAtMs: 1_800_000_000_000,
        });
        assert.deepEqual(outcome, { status: 'updated' });
        assert.deepEqual(value.sqlite.prepare(`SELECT ocr_queue_state, ocr_queue_updated_at,
            ocr_replay_artifact_snapshot, document_revision, document_freshness_epoch FROM attachments`).get(), {
            ocr_queue_state: 'ocr_done', ocr_queue_updated_at: 1_800_000_000,
            ocr_replay_artifact_snapshot: APPLIED_ARTIFACT, document_revision: 2, document_freshness_epoch: 2,
        });
        assert.equal(thenReads, 0);
    } finally {
        if (previous) Object.defineProperty(Object.prototype, 'then', previous);
        else delete (Object.prototype as { then?: unknown }).then;
        value.close();
    }
});

test('settles a duplicate without rewriting its artifact bytes and still advances equal-state currentness', () => {
    const value = fixture();
    try {
        value.sqlite.prepare(`UPDATE attachments SET ocr_queue_state = 'processing',
            ocr_replay_artifact_snapshot = ? WHERE id = 'attachment-a'`).run(APPLIED_ARTIFACT);
        assert.deepEqual(value.currentness.commit(snapshot({
            ocrQueueState: 'processing', ocrReplayArtifactSnapshot: APPLIED_ARTIFACT,
        }), {
            outcome: 'duplicate', nextState: 'ocr_done', artifactSnapshot: APPLIED_ARTIFACT,
            updatedAtMs: 1_800_000_001_000,
        }), { status: 'updated' });
        assert.deepEqual(value.currentness.commit(snapshot({
            documentRevision: 2, documentFreshnessEpoch: 2,
            ocrQueueState: 'ocr_done', ocrReplayArtifactSnapshot: APPLIED_ARTIFACT,
        }), {
            outcome: 'duplicate', nextState: 'ocr_done', artifactSnapshot: APPLIED_ARTIFACT,
            updatedAtMs: 1_800_000_002_000,
        }), { status: 'updated' });
        assert.deepEqual(value.sqlite.prepare(`SELECT ocr_queue_state, ocr_queue_updated_at,
            ocr_replay_artifact_snapshot, document_revision, document_freshness_epoch FROM attachments`).get(), {
            ocr_queue_state: 'ocr_done', ocr_queue_updated_at: 1_800_000_002,
            ocr_replay_artifact_snapshot: APPLIED_ARTIFACT, document_revision: 3, document_freshness_epoch: 3,
        });
    } finally { value.close(); }
});

test('one stale Web PUT versus replay snapshot commits and the replay never retries', () => {
    const value = fixture();
    try {
        assert.deepEqual(value.webPut.mutate({
            id: 'attachment-a', documentSourceRef: REF_A, documentRevision: 1, documentFreshnessEpoch: 1,
        }, () => {
            const result = value.sqlite.prepare("UPDATE attachments SET ocr_queue_reason = 'text_too_short' WHERE id = 'attachment-a'").run();
            return { changes: result.changes };
        }), { status: 'updated' });
        assert.deepEqual(value.currentness.commit(snapshot(), {
            outcome: 'applied', nextState: 'ocr_done', artifactSnapshot: APPLIED_ARTIFACT,
            updatedAtMs: 1_800_000_000_000,
        }), { status: 'conflict' });
        assert.deepEqual(value.sqlite.prepare(`SELECT ocr_queue_reason, ocr_replay_artifact_snapshot,
            document_revision, document_freshness_epoch FROM attachments`).get(), {
            ocr_queue_reason: 'text_too_short', ocr_replay_artifact_snapshot: null,
            document_revision: 2, document_freshness_epoch: 2,
        });
    } finally { value.close(); }
});

test('denies hostile records, document hashes as currentness, and invalid duplicate queue transitions', () => {
    const value = fixture();
    const transition = { outcome: 'applied', nextState: 'ocr_done', artifactSnapshot: APPLIED_ARTIFACT, updatedAtMs: 1_800_000_000_000 };
    let getterReads = 0;
    let proxyTraps = 0;
    let thenableReads = 0;
    const accessor = Object.defineProperty(snapshot(), 'documentRevision', {
        enumerable: true, get() { getterReads += 1; return 1; },
    });
    const proxy = new Proxy(transition, { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } });
    const thenable = Object.defineProperty({ ...transition }, 'then', { enumerable: true, get() { thenableReads += 1; return () => undefined; } });
    try {
        assert.deepEqual(value.currentness.commit(accessor, transition), { status: 'failed' });
        assert.deepEqual(value.currentness.commit(snapshot(), proxy), { status: 'failed' });
        assert.deepEqual(value.currentness.commit(snapshot(), thenable), { status: 'failed' });
        assert.deepEqual(value.currentness.commit({ ...snapshot(), documentSha256: REF_A }, transition), { status: 'failed' });
        assert.deepEqual(value.currentness.commit(snapshot({ documentSourceRef: 'd'.repeat(64) }), transition), { status: 'conflict' });
        value.sqlite.prepare('UPDATE attachments SET ocr_replay_artifact_snapshot = ?').run(APPLIED_ARTIFACT);
        assert.deepEqual(value.currentness.commit(snapshot({ ocrReplayArtifactSnapshot: APPLIED_ARTIFACT }), {
            ...transition, outcome: 'duplicate',
        }), { status: 'conflict' });
        assert.equal(getterReads, 0);
        assert.equal(proxyTraps, 0);
        assert.equal(thenableReads, 0);
    } finally { value.close(); }
});

test('rolls back a replay when the same database host reenters', () => {
    const value = fixture();
    const transition = { outcome: 'applied' as const, nextState: 'ocr_done' as const, artifactSnapshot: APPLIED_ARTIFACT, updatedAtMs: 1_800_000_000_000 };
    let nested: unknown;
    try {
        value.sqlite.function('reenter_replay', () => { nested = value.currentness.commit(snapshot(), transition); return 1; });
        value.sqlite.exec('CREATE TRIGGER replay_reentry BEFORE UPDATE OF ocr_queue_state ON attachments BEGIN SELECT reenter_replay(); END');
        assert.deepEqual(value.currentness.commit(snapshot(), transition), { status: 'conflict' });
        assert.deepEqual(nested, { status: 'conflict' });
        assert.deepEqual(value.sqlite.prepare(`SELECT ocr_queue_state, ocr_replay_artifact_snapshot,
            document_revision, document_freshness_epoch FROM attachments`).get(), {
            ocr_queue_state: 'pending', ocr_replay_artifact_snapshot: null,
            document_revision: 1, document_freshness_epoch: 1,
        });
    } finally { value.close(); }
});

test('OCR replay route uses host currentness without exposing it or raw OCR text', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'app/api/attachments/[id]/ocr-replay/route.ts'), 'utf8');
    assert.match(source, /createAttachmentOcrReplayCurrentness/);
    assert.match(source, /runDbServerImmediateTransaction/);
    assert.match(source, /attachmentOcrReplayCurrentness\.commit/);
    for (const field of ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch']) assert.match(source, new RegExp(field));
    assert.match(source, /Reflect\.ownKeys\(body\)/);
    const requestAllowlist = source.slice(source.indexOf('const ATTACHMENT_OCR_REPLAY_KEYS'), source.indexOf(']);', source.indexOf('const ATTACHMENT_OCR_REPLAY_KEYS')));
    assert.doesNotMatch(requestAllowlist, /documentSourceRef|documentRevision|documentFreshnessEpoch|authority|apply/);
    assert.doesNotMatch(source, /dbServer\.update\(attachments\)/);
    const responsesAndLogs = [...source.matchAll(/(?:NextResponse\.json|console\.(?:info|error))\(([\s\S]*?)\);/gu)]
        .map((match) => match[1]).join('\n');
    assert.doesNotMatch(responsesAndLogs, /documentSourceRef|documentRevision|documentFreshnessEpoch|ocrText/);
    assert.match(source, /status:\s*404/);
    assert.match(source, /status:\s*409/);
    assert.match(source, /status:\s*500/);
});
