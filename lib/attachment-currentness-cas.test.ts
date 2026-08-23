/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createAttachmentCurrentnessCas } from './attachment-currentness-cas';

const REF_A = 'a'.repeat(64);

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ocr-cas-'));
    const sqlite = new Database(path.join(dir, 'test.db'));
    sqlite.exec(`CREATE TABLE attachments (
        id TEXT PRIMARY KEY NOT NULL, document_source_ref TEXT NOT NULL UNIQUE,
        document_revision INTEGER NOT NULL, document_freshness_epoch INTEGER NOT NULL,
        marker TEXT NOT NULL CHECK(length(marker) > 0)
    )`);
    sqlite.prepare('INSERT INTO attachments VALUES (?, ?, 1, 1, ?)').run('attachment-a', REF_A, 'same');
    const database = drizzle(sqlite);
    const cas = createAttachmentCurrentnessCas({
        database,
        runImmediateTransaction: (operation) => sqlite.transaction(operation).immediate(),
    });
    return { cas, database, sqlite, close: () => { sqlite.close(); fs.rmSync(dir, { recursive: true }); } };
}

test('commits one synchronous mutation and advances both counters exactly once', () => {
    const value = fixture();
    try {
        const outcome = value.cas.mutate({
            id: 'attachment-a', documentSourceRef: REF_A,
            expectedRevision: 1, expectedFreshnessEpoch: 1,
        }, () => {
            assert.equal(value.sqlite.inTransaction, true);
            const result = value.sqlite.prepare('UPDATE attachments SET marker = ? WHERE id = ?')
                .run('same', 'attachment-a');
            return { changes: result.changes };
        });

        assert.deepEqual(outcome, {
            status: 'committed',
            receipt: { documentSourceRef: REF_A, documentRevision: 2, documentFreshnessEpoch: 2 },
        });
        assert.deepEqual(value.sqlite.prepare('SELECT marker, document_revision, document_freshness_epoch FROM attachments').get(), {
            marker: 'same', document_revision: 2, document_freshness_epoch: 2,
        });
        assert.equal(Object.isFrozen(outcome), true);
        assert.equal(Object.isFrozen(outcome.status === 'committed' ? outcome.receipt : null), true);
    } finally { value.close(); }
});

test('commits without reading an ambient Object.prototype.then getter', () => {
    const value = fixture();
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let thenReads = 0;
    let outcome: unknown;
    let row: unknown;
    try {
        Object.defineProperty(Object.prototype, 'then', {
            configurable: true,
            get() { thenReads += 1; return () => undefined; },
        });
        outcome = value.cas.mutate({ id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 1, expectedFreshnessEpoch: 1 }, () => {
            const result = value.sqlite.prepare("UPDATE attachments SET marker = 'ambient-safe'").run();
            return { changes: result.changes };
        });
        row = value.sqlite.prepare('SELECT marker, document_revision, document_freshness_epoch FROM attachments').get();
    } finally {
        if (previous) Object.defineProperty(Object.prototype, 'then', previous);
        else delete (Object.prototype as { then?: unknown }).then;
    }
    try {
        assert.equal(thenReads, 0);
        assert.equal((outcome as { status?: unknown }).status, 'committed');
        assert.deepEqual((outcome as { receipt?: unknown }).receipt, { documentSourceRef: REF_A, documentRevision: 2, documentFreshnessEpoch: 2 });
        assert.deepEqual(row, { marker: 'ambient-safe', document_revision: 2, document_freshness_epoch: 2 });
    } finally { value.close(); }
});

test('denies missing, mismatched, stale, and split identity before mutation', () => {
    const value = fixture();
    let calls = 0;
    const mutate = (input: { id: string; documentSourceRef: string; expectedRevision: number; expectedFreshnessEpoch: number }) =>
        value.cas.mutate(input, () => { calls += 1; return { changes: 1 }; });
    try {
        assert.deepEqual(mutate({ id: 'missing', documentSourceRef: 'c'.repeat(64), expectedRevision: 1, expectedFreshnessEpoch: 1 }), { status: 'denied', code: 'missing' });
        assert.deepEqual(mutate({ id: 'attachment-a', documentSourceRef: 'c'.repeat(64), expectedRevision: 1, expectedFreshnessEpoch: 1 }), { status: 'denied', code: 'identity_mismatch' });
        assert.deepEqual(mutate({ id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 2, expectedFreshnessEpoch: 1 }), { status: 'denied', code: 'stale' });
        value.sqlite.prepare('INSERT INTO attachments VALUES (?, ?, 1, 1, ?)').run('attachment-b', 'b'.repeat(64), 'other');
        assert.deepEqual(mutate({ id: 'attachment-a', documentSourceRef: 'b'.repeat(64), expectedRevision: 1, expectedFreshnessEpoch: 1 }), { status: 'denied', code: 'cardinality_violation' });
        assert.equal(calls, 0);
    } finally { value.close(); }
});

test('rejects hostile request and callback shapes before reflection or writes', () => {
    const value = fixture();
    const call = value.cas.mutate as (request: unknown, mutation: unknown) => unknown;
    let getterReads = 0;
    let proxyReads = 0;
    let callbackCalls = 0;
    const accessor = Object.defineProperty({
        id: 'attachment-a', documentSourceRef: REF_A,
        expectedFreshnessEpoch: 1,
    }, 'expectedRevision', { enumerable: true, get: () => { getterReads += 1; return 1; } });
    const proxied = new Proxy({
        id: 'attachment-a', documentSourceRef: REF_A,
        expectedRevision: 1, expectedFreshnessEpoch: 1,
    }, { get(target, key, receiver) { proxyReads += 1; return Reflect.get(target, key, receiver); } });
    const callbackProxy = new Proxy(() => ({ changes: 1 }), {
        apply() { callbackCalls += 1; return { changes: 1 }; },
    });
    try {
        for (const request of [null, accessor, proxied, {
            id: 'attachment-a', documentSourceRef: REF_A,
            expectedRevision: 1, expectedFreshnessEpoch: 1, apply: true,
        }, { id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 0, expectedFreshnessEpoch: 1 },
        { id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 1.5, expectedFreshnessEpoch: 1 }]) {
            assert.deepEqual(call(request, () => ({ changes: 1 })), { status: 'denied', code: 'invalid_request' });
        }
        assert.deepEqual(call({
            id: 'attachment-a', documentSourceRef: REF_A,
            expectedRevision: 1, expectedFreshnessEpoch: 1,
        }, callbackProxy), { status: 'denied', code: 'invalid_request' });
        assert.deepEqual(call({ id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 1, expectedFreshnessEpoch: 1 }, async () => ({ changes: 1 })), { status: 'denied', code: 'invalid_request' });
        assert.equal(getterReads, 0);
        assert.equal(proxyReads, 0);
        assert.equal(callbackCalls, 0);
        assert.deepEqual(value.sqlite.prepare('SELECT document_revision, document_freshness_epoch FROM attachments').get(), {
            document_revision: 1, document_freshness_epoch: 1,
        });
    } finally { value.close(); }
});

test('a second writer with the same expected counters is denied as stale', () => {
    const value = fixture();
    const request = { id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 1, expectedFreshnessEpoch: 1 };
    try {
        assert.equal(value.cas.mutate(request, () => {
            const result = value.sqlite.prepare("UPDATE attachments SET marker = 'first'").run();
            return { changes: result.changes };
        }).status, 'committed');
        assert.deepEqual(value.cas.mutate(request, () => { throw new Error('must not run'); }), { status: 'denied', code: 'stale' });
    } finally { value.close(); }
});

test('denies unsafe counter advancement before mutation', () => {
    const value = fixture();
    let calls = 0;
    try {
        value.sqlite.prepare('UPDATE attachments SET document_revision = ?, document_freshness_epoch = ?')
            .run(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        const outcome = value.cas.mutate({
            id: 'attachment-a', documentSourceRef: REF_A,
            expectedRevision: Number.MAX_SAFE_INTEGER,
            expectedFreshnessEpoch: Number.MAX_SAFE_INTEGER,
        }, () => { calls += 1; return { changes: 1 }; });
        assert.deepEqual(outcome, { status: 'denied', code: 'counter_unavailable' });
        assert.equal(calls, 0);
    } finally { value.close(); }
});

test('rolls back failed, non-cardinal, async, or currentness-changing mutations', () => {
    const value = fixture();
    let getterReads = 0;
    const changed = () => { value.sqlite.prepare("UPDATE attachments SET marker = 'changed'").run(); };
    const cases: Array<[string, () => unknown]> = [
        ['cardinality_violation', () => { changed(); return { changes: 0 }; }],
        ['cardinality_violation', () => { changed(); return { changes: 2 }; }],
        ['mutation_failed', () => { changed(); throw new Error('secret'); }],
        ['mutation_failed', () => { changed(); return Promise.resolve({ changes: 1 }); }],
        ['mutation_failed', () => { changed(); return Object.defineProperty({}, 'changes', { enumerable: true, get: () => { getterReads += 1; return 1; } }); }],
        ['stale', () => { changed(); value.sqlite.prepare('UPDATE attachments SET document_revision = 2').run(); return { changes: 1 }; }],
        ['mutation_failed', () => { value.sqlite.prepare('UPDATE attachments SET marker = NULL').run(); return { changes: 1 }; }],
    ];
    try {
        for (const [code, mutation] of cases) {
            const outcome = value.cas.mutate({ id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 1, expectedFreshnessEpoch: 1 }, mutation);
            assert.deepEqual(outcome, { status: 'denied', code });
            assert.deepEqual(value.sqlite.prepare('SELECT marker, document_revision, document_freshness_epoch FROM attachments').get(), {
                marker: 'same', document_revision: 1, document_freshness_epoch: 1,
            });
        }
        assert.equal(getterReads, 0);
    } finally { value.close(); }
});

test('reentry poisons the outer operation and rolls back all writes', () => {
    const value = fixture();
    let nested: unknown;
    const request = { id: 'attachment-a', documentSourceRef: REF_A, expectedRevision: 1, expectedFreshnessEpoch: 1 };
    try {
        const outer = value.cas.mutate(request, () => {
            value.sqlite.prepare("UPDATE attachments SET marker = 'changed'").run();
            nested = value.cas.mutate(request, () => ({ changes: 1 }));
            return { changes: 1 };
        });
        assert.deepEqual(nested, { status: 'denied', code: 'operation_reentered' });
        assert.deepEqual(outer, { status: 'denied', code: 'operation_reentered' });
        assert.deepEqual(value.sqlite.prepare('SELECT marker, document_revision, document_freshness_epoch FROM attachments').get(), {
            marker: 'same', document_revision: 1, document_freshness_epoch: 1,
        });
    } finally { value.close(); }
});
