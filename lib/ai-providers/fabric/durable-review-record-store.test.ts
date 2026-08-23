/* @Codex */
import assert from 'node:assert/strict';
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

const fixture = Object.freeze({
    patientRef: 'ptr_11111111111111111111111111111111', reviewId: 'review_0123456789abcdef0123456789abcdef', reviewRevision: 1,
    receiptRef: 'receipt_abcdef0123456789abcdef0123456789',
    provenanceRef: 'provenance_fedcba9876543210fedcba9876543210',
    receiptBinding: 'dd7a4659cab6ff34013ec8a459a85f4995e2923202aab5eae6e11cc27163bc0e',
    provenanceBinding: '3eac05b4cbb86a3f949baa306e3dd09efbd3393cf5baf88e71ecf4cce590ed69',
    presentationVersion: 'mediflow.ai.durable-review.presentation.v1',
    sealedCiphertext: 'ENC:YWJj:ZGVm',
    sealedDigest: '7507791e4115bea076a6d45c6075f382e83c30b46d2eb5722e4b489012049660',
});

function rejects(value: unknown): void {
    assert.throws(() => createDurableReviewRecordStore().create(value), (error) =>
        error instanceof DurableReviewRecordStoreError && error.code === 'invalid_record');
}
function worker(action: 'create' | 'read'): unknown {
    return JSON.parse(execFileSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/durable-review-record-store-worker.mjs', action], {
        encoding: 'utf8', env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_DURABLE_REVIEW_RECORD: JSON.stringify(fixture) },
    }));
}

test('persists an exact sealed review through terminated writer and reader processes', () => {
    const created = worker('create');
    assert.deepEqual(created, { ...fixture, recordId: fixture.reviewId });
    assert.deepEqual(worker('read'), created);
    assert.deepEqual(Object.keys(createDurableReviewRecordStore()).sort(), ['create', 'read']);
});

test('rejects plaintext, extras, accessors, and incoherent sealed review bindings', () => {
    rejects({ ...fixture, plaintext: 'synthetic clinical text' });
    rejects({ ...fixture, keyMaterial: 'synthetic-not-a-key' });
    rejects({ ...fixture, patientRef: 'patient-not-opaque' });
    rejects({ ...fixture, patientRef: `ptr_${'2'.repeat(32)}` });
    rejects({ ...fixture, sealedDigest: fixture.sealedDigest.replace(/^./, '0') });
    rejects({ ...fixture, receiptBinding: fixture.receiptBinding.replace(/^./, '0') });
    rejects({ ...fixture, provenanceBinding: fixture.provenanceBinding.replace(/^./, '0') });
    rejects({ ...fixture, presentationVersion: 'mediflow.ai.durable-review.presentation.v2' });
    rejects({ ...fixture, reviewRevision: 2 });
    rejects(Object.defineProperty({ ...fixture }, 'sealedCiphertext', { get: () => fixture.sealedCiphertext }));
    rejects(new Proxy({}, { getPrototypeOf() { throw new Error('hostile reflection trap'); } }));
});

test('maps only uniqueness conflicts to duplicate and storage faults fail closed', () => {
    assert.throws(() => createDurableReviewRecordStore().create(fixture), (error) =>
        error instanceof DurableReviewRecordStoreError && error.code === 'duplicate');
    const db = new Database(path.join(dataDir, 'medical.db'));
    try { db.exec('DROP TABLE durable_review_records'); } finally { db.close(); }
    for (const run of [() => createDurableReviewRecordStore().read(fixture.reviewId), () => createDurableReviewRecordStore().create(fixture)]) {
        assert.throws(run, (error) => error instanceof DurableReviewRecordStoreError && error.code === 'storage_unavailable');
    }
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
