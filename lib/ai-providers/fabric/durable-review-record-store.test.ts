/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-durable-review-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const { createDurableReviewRecordStore, DurableReviewRecordStoreError } = await import('./durable-review-record-store.ts');

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fixture = (suffix = '0', reviewRevision = 1) => {
    const patientRef = `ptr_${suffix.repeat(32)}`; const reviewId = `review_${suffix.repeat(32)}`;
    const receiptRef = `receipt_${suffix.repeat(32)}`; const provenanceRef = `provenance_${suffix.repeat(32)}`;
    const sealedCiphertext = `ENC:YWJj:${Buffer.from(`sealed-${suffix}-${reviewRevision}`).toString('base64')}`;
    return Object.freeze({ patientRef, reviewId, reviewRevision, receiptRef, provenanceRef,
        receiptBinding: digest(`${patientRef}\0${reviewId}\0${receiptRef}`), provenanceBinding: digest(`${patientRef}\0${reviewId}\0${provenanceRef}`),
        presentationVersion: 'mediflow.ai.durable-review.presentation.v1', sealedCiphertext, sealedDigest: digest(sealedCiphertext) });
};
const command = (record: ReturnType<typeof fixture>, key = 'idem_aaaaaaaaaaaaaaaa') => ({ record, expectedReviewRevision: record.reviewRevision - 1, idempotencyKey: key });

function rejects(value: unknown): void {
    assert.throws(() => createDurableReviewRecordStore().create(value), (error) =>
        error instanceof DurableReviewRecordStoreError && error.code === 'invalid_record');
}
function worker(action: 'create' | 'read', value: unknown): unknown {
    return JSON.parse(execFileSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/durable-review-record-store-worker.mjs', action], {
        encoding: 'utf8', env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_DURABLE_REVIEW_RECORD: JSON.stringify(value) },
    }));
}

test('replays an equivalent idempotent create through terminated writer processes', () => {
    const record = fixture('1'); const input = command(record);
    const created = worker('create', input);
    assert.deepEqual(created, { ...record, recordId: record.reviewId });
    assert.deepEqual(worker('create', input), created);
    assert.deepEqual(worker('read', record.reviewId), created);
    assert.deepEqual(Object.keys(createDurableReviewRecordStore()).sort(), ['create', 'read', 'replace']);
});

test('denies a non-equivalent replay and requires typed expected revisions', () => {
    const record = fixture('2'); const first = command(record, 'idem_bbbbbbbbbbbbbbbb'); const store = createDurableReviewRecordStore();
    store.create(first);
    const sealedCiphertext = 'ENC:YWJj:ZGlmZmVyZW50';
    assert.throws(() => store.create({ ...first, record: { ...record, sealedCiphertext, sealedDigest: digest(sealedCiphertext) }, idempotencyKey: first.idempotencyKey }), (error) => error instanceof DurableReviewRecordStoreError && error.code === 'idempotency_conflict');
    rejects({ ...first, record: { ...record, plaintext: 'synthetic clinical text' } });
    rejects({ ...first, expectedReviewRevision: 1 });
    rejects({ ...first, idempotencyKey: 'short' });
});

test('updates with CAS, preserves historical replay, and leaves stale records unchanged', () => {
    const first = fixture('3'); const second = fixture('3', 2); const store = createDurableReviewRecordStore();
    const initial = store.create(command(first, 'idem_cccccccccccccccc'));
    const updated = store.replace(command(second, 'idem_dddddddddddddddd'));
    assert.deepEqual(updated, { ...second, recordId: second.reviewId });
    assert.deepEqual(store.create(command(first, 'idem_cccccccccccccccc')), initial);
    assert.throws(() => store.replace(command(fixture('3', 2), 'idem_eeeeeeeeeeeeeeee')), (error) => error instanceof DurableReviewRecordStoreError && error.code === 'revision_conflict');
    assert.deepEqual(store.read(first.reviewId), updated);
});

test('fails closed on an altered replay snapshot after a terminated writer', () => {
    const record = fixture('5'); const input = command(record, 'idem_1111111111111111');
    assert.deepEqual(worker('create', input), { ...record, recordId: record.reviewId });
    const sealedCiphertext = 'ENC:YWJj:dGFtcGVyZWQ=';
    const tampered = { ...record, sealedCiphertext, sealedDigest: digest(sealedCiphertext) };
    const db = new Database(path.join(dataDir, 'medical.db'));
    try {
        assert.equal(db.prepare('UPDATE durable_review_operations SET record_snapshot = ? WHERE review_id = ? AND idempotency_key = ?')
            .run(JSON.stringify(tampered), record.reviewId, input.idempotencyKey).changes, 1);
    } finally { db.close(); }
    assert.throws(() => createDurableReviewRecordStore().create(input), (error) => error instanceof DurableReviewRecordStoreError && error.code === 'corrupt');
});

test('fails closed on unavailable durable storage and exposes no destructive authority', () => {
    const record = fixture('4'); const store = createDurableReviewRecordStore();
    store.create(command(record, 'idem_ffffffffffffffff'));
    const db = new Database(path.join(dataDir, 'medical.db'));
    try { db.exec('DROP TABLE durable_review_records'); } finally { db.close(); }
    for (const run of [() => store.read(record.reviewId), () => store.create(command(record, 'idem_ffffffffffffffff'))]) {
        assert.throws(run, (error) => error instanceof DurableReviewRecordStoreError && error.code === 'storage_unavailable');
    }
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
