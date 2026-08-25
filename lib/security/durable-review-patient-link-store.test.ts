/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-review-patient-link-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });

const { createDurableReviewPatientLinkStore, DurableReviewPatientLinkStoreError } = await import('./durable-review-patient-link-store.ts');

function rejects(run: () => unknown, code: string): void {
    assert.throws(run, (error) => error instanceof DurableReviewPatientLinkStoreError && error.code === code);
}

function seed(suffix: string) {
    const patientId = `patient.synthetic.link.${suffix}`;
    const reviewId = `review_${suffix.repeat(32)}`;
    const db = new Database(path.join(dataDir, 'medical.db'));
    try {
        db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
            .run(patientId, 'Synthetic', `Link ${suffix}`, `SYNTHETICLINK${suffix}`);
        db.prepare(`INSERT INTO durable_review_records (
            id, patient_ref, review_id, review_revision, receipt_ref, provenance_ref,
            receipt_binding, provenance_binding, presentation_version, sealed_ciphertext, sealed_digest
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
            .run(reviewId, `ptr_${suffix.repeat(32)}`, reviewId, `receipt_${suffix.repeat(32)}`,
                `provenance_${suffix.repeat(32)}`, 'a'.repeat(64), 'b'.repeat(64),
                'mediflow.ai.durable-review.presentation.v1', 'ENC:YWJj:ZGVtbw==', 'c'.repeat(64));
    } finally { db.close(); }
    return { reviewId, patientId };
}

test('creates an immutable canonical review-to-patient link and reads it by review id', () => {
    const pair = seed('1');
    const store = createDurableReviewPatientLinkStore();
    assert.deepEqual(store.create(pair), pair);
    assert.deepEqual(store.create(pair), pair);
    assert.deepEqual(store.readByReviewId(pair.reviewId), pair);
    rejects(() => store.create({ reviewId: pair.reviewId, patientId: 'patient.synthetic.link.conflict' }), 'link_conflict');
});

test('denies missing canonical records and leaves unlinked reviews unreadable', () => {
    const pair = seed('2');
    const store = createDurableReviewPatientLinkStore();
    rejects(() => store.create({ reviewId: `review_${'f'.repeat(32)}`, patientId: pair.patientId }), 'review_missing');
    rejects(() => store.create({ reviewId: pair.reviewId, patientId: 'patient.synthetic.link.missing' }), 'patient_missing');
    rejects(() => store.readByReviewId(pair.reviewId), 'link_missing');
});

test('rejects hostile input without evaluating accessors', () => {
    const pair = seed('3');
    const store = createDurableReviewPatientLinkStore();
    let reads = 0;
    const accessor = { reviewId: pair.reviewId, patientId: pair.patientId };
    Object.defineProperty(accessor, 'patientId', { enumerable: true, get() { reads += 1; return pair.patientId; } });
    for (const value of [
        { ...pair, extra: true },
        Object.assign(Object.create(pair), pair),
        accessor,
        { reviewId: pair.reviewId, patientId: '  padded' },
    ]) rejects(() => store.create(value), 'input_invalid');
    assert.equal(reads, 0);
});

test('denies a hostile link schema with an opaque typed error', () => {
    const pair = seed('4');
    const store = createDurableReviewPatientLinkStore();
    const db = new Database(path.join(dataDir, 'medical.db'));
    try { db.exec('DROP TABLE durable_review_patient_links; CREATE TABLE durable_review_patient_links (review_id TEXT)'); } finally { db.close(); }
    rejects(() => store.create(pair), 'schema_incompatible');
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
