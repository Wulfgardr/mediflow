/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createAttachmentWebPutCurrentness } from './attachment-web-put-currentness';

const REF_A = 'a'.repeat(64);

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ocr-web-put-'));
    const sqlite = new Database(path.join(dir, 'test.db'));
    sqlite.exec(`CREATE TABLE attachments (
        id TEXT PRIMARY KEY NOT NULL, document_source_ref TEXT NOT NULL UNIQUE,
        document_revision INTEGER NOT NULL, document_freshness_epoch INTEGER NOT NULL,
        marker TEXT NOT NULL CHECK(length(marker) > 0)
    )`);
    sqlite.prepare('INSERT INTO attachments VALUES (?, ?, 1, 1, ?)').run('attachment-a', REF_A, 'same');
    const database = drizzle(sqlite);
    const currentness = createAttachmentWebPutCurrentness({
        database,
        runImmediateTransaction: (operation) => sqlite.transaction(operation).immediate(),
    });
    return { currentness, sqlite, close: () => { sqlite.close(); fs.rmSync(dir, { recursive: true }); } };
}

const snapshot = (overrides: Record<string, unknown> = {}) => ({
    id: 'attachment-a', documentSourceRef: REF_A, documentRevision: 1, documentFreshnessEpoch: 1, ...overrides,
});

test('commits an equal-value Web update, advances currentness, and exposes no host token', () => {
    const value = fixture();
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let thenReads = 0;
    try {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { thenReads += 1; return () => undefined; } });
        const outcome = value.currentness.mutate(snapshot(), () => {
            const result = value.sqlite.prepare("UPDATE attachments SET marker = 'same' WHERE id = 'attachment-a'").run();
            return { changes: result.changes };
        });
        assert.deepEqual(outcome, { status: 'updated' });
        assert.deepEqual(Object.keys(outcome), ['status']);
        assert.deepEqual(value.sqlite.prepare('SELECT marker, document_revision, document_freshness_epoch FROM attachments').get(), {
            marker: 'same', document_revision: 2, document_freshness_epoch: 2,
        });
        assert.equal(thenReads, 0);
    } finally {
        if (previous) Object.defineProperty(Object.prototype, 'then', previous);
        else delete (Object.prototype as { then?: unknown }).then;
        value.close();
    }
});

test('maps missing and every stale identity class to stable minimized outcomes', () => {
    const value = fixture();
    let calls = 0;
    const mutate = (input: unknown) => value.currentness.mutate(input, () => { calls += 1; return { changes: 1 }; });
    try {
        assert.deepEqual(mutate(snapshot({ id: 'missing', documentSourceRef: 'c'.repeat(64) })), { status: 'not_found' });
        assert.deepEqual(mutate(snapshot({ documentSourceRef: 'c'.repeat(64) })), { status: 'conflict' });
        assert.deepEqual(mutate(snapshot({ documentRevision: 2 })), { status: 'conflict' });
        value.sqlite.prepare('INSERT INTO attachments VALUES (?, ?, 1, 1, ?)').run('attachment-b', 'b'.repeat(64), 'other');
        assert.deepEqual(mutate(snapshot({ documentSourceRef: 'b'.repeat(64) })), { status: 'conflict' });
        value.sqlite.prepare('UPDATE attachments SET document_revision = ?, document_freshness_epoch = ? WHERE id = ?')
            .run(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'attachment-a');
        assert.deepEqual(mutate(snapshot({ documentRevision: Number.MAX_SAFE_INTEGER, documentFreshnessEpoch: Number.MAX_SAFE_INTEGER })), { status: 'conflict' });
        assert.equal(calls, 0);
    } finally { value.close(); }
});

test('denies hostile snapshots and mutation outcomes and rolls back business writes', () => {
    const value = fixture();
    let getterReads = 0;
    let proxyTraps = 0;
    const accessor = Object.defineProperty(snapshot(), 'documentRevision', {
        enumerable: true, get() { getterReads += 1; return 1; },
    });
    const proxy = new Proxy(snapshot(), { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } });
    const changed = () => { value.sqlite.prepare("UPDATE attachments SET marker = 'changed'").run(); };
    try {
        assert.deepEqual(value.currentness.mutate(accessor, () => ({ changes: 1 })), { status: 'failed' });
        assert.deepEqual(value.currentness.mutate(proxy, () => ({ changes: 1 })), { status: 'failed' });
        assert.deepEqual(value.currentness.mutate(snapshot(), () => { changed(); return Promise.resolve({ changes: 1 }); }), { status: 'failed' });
        assert.deepEqual(value.currentness.mutate(snapshot(), () => { changed(); return { changes: 0 }; }), { status: 'conflict' });
        assert.equal(getterReads, 0);
        assert.equal(proxyTraps, 0);
        assert.deepEqual(value.sqlite.prepare('SELECT marker, document_revision, document_freshness_epoch FROM attachments WHERE id = ?').get('attachment-a'), {
            marker: 'same', document_revision: 1, document_freshness_epoch: 1,
        });
    } finally { value.close(); }
});

test('Web PUT keeps currentness host-owned and returns only the legacy success shape', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'app/api/attachments/[id]/route.ts'), 'utf8');
    const put = source.slice(source.indexOf('export async function PUT'), source.indexOf('export async function DELETE'));
    const allowlist = source.slice(source.indexOf('const ATTACHMENT_WEB_PUT_KEYS'), source.indexOf(']);', source.indexOf('const ATTACHMENT_WEB_PUT_KEYS')));
    for (const field of ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch']) {
        assert.match(put, new RegExp(field));
    }
    assert.match(source, /createAttachmentWebPutCurrentness/);
    assert.match(source, /runDbServerImmediateTransaction/);
    assert.match(source, /ATTACHMENT_WEB_PUT_KEYS/);
    assert.match(put, /Reflect\.ownKeys\(body\)/);
    assert.doesNotMatch(allowlist, /documentSourceRef|documentRevision|documentFreshnessEpoch|authority|apply/);
    assert.match(put, /attachmentWebPutCurrentness\.mutate/);
    assert.match(put, /canTransitionDocumentOcrQueueState/);
    assert.match(put, /status:\s*409/);
    assert.match(put, /NextResponse\.json\(\{ success: true \}\)/);
    assert.doesNotMatch(put, /receipt/);
});
