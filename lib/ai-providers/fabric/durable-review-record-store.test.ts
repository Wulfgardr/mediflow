/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-durable-review-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
const { createDurableReviewRecordStore, DurableReviewRecordStoreError } = await import('./durable-review-record-store.ts');

const fixture = Object.freeze({
    reviewId: 'review_0123456789abcdef0123456789abcdef', reviewRevision: 1,
    receiptRef: 'receipt_abcdef0123456789abcdef0123456789',
    provenanceRef: 'provenance_fedcba9876543210fedcba9876543210',
    receiptBinding: 'a7db538262feb702763ed11f01344da8372aa6cfc2e87708f52332cb61095f3d',
    provenanceBinding: '661b499ed02adcfec19771c013204a839e3895c5c2874017cd49b867e6b859a2',
    presentationVersion: 'mediflow.ai.durable-review.presentation.v1',
    sealedCiphertext: 'ENC:YWJj:ZGVm',
    sealedDigest: '7507791e4115bea076a6d45c6075f382e83c30b46d2eb5722e4b489012049660',
});

function rejects(value: unknown): void {
    assert.throws(() => createDurableReviewRecordStore().create(value), (error) =>
        error instanceof DurableReviewRecordStoreError && error.code === 'invalid_record');
}

test('persists an exact sealed review through a fresh public store', () => {
    const first = createDurableReviewRecordStore();
    assert.deepEqual(Object.keys(first).sort(), ['create', 'read']);
    const created = first.create(fixture);
    assert.deepEqual(created, { ...fixture, recordId: fixture.reviewId });
    assert.deepEqual(createDurableReviewRecordStore().read(fixture.reviewId), created);
});

test('rejects plaintext, extras, accessors, and incoherent sealed review bindings', () => {
    rejects({ ...fixture, plaintext: 'synthetic clinical text' });
    rejects({ ...fixture, keyMaterial: 'synthetic-not-a-key' });
    rejects({ ...fixture, sealedDigest: fixture.sealedDigest.replace(/^./, '0') });
    rejects({ ...fixture, receiptBinding: fixture.receiptBinding.replace(/^./, '0') });
    rejects({ ...fixture, provenanceBinding: fixture.provenanceBinding.replace(/^./, '0') });
    rejects({ ...fixture, presentationVersion: 'mediflow.ai.durable-review.presentation.v2' });
    rejects({ ...fixture, reviewRevision: 2 });
    rejects(Object.defineProperty({ ...fixture }, 'sealedCiphertext', { get: () => fixture.sealedCiphertext }));
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
