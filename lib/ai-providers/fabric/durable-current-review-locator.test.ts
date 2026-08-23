/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-current-review-locator-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });

const { createDurableCurrentReviewLocator, DurableCurrentReviewLocatorError } = await import('./durable-current-review-locator.ts');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const database = () => new Database(path.join(dataDir, 'medical.db'));
const rejects = (run: () => unknown, code: string) => assert.throws(run, (error) => error instanceof DurableCurrentReviewLocatorError && error.code === code);

function seed(suffix: string, patientId = `patient.synthetic.current.${suffix}`) {
    const reviewId = `review_${suffix.repeat(32)}`;
    const patientRef = `ptr_${suffix.repeat(32)}`;
    const receiptRef = `receipt_${suffix.repeat(32)}`;
    const provenanceRef = `provenance_${suffix.repeat(32)}`;
    const sealedCiphertext = `ENC:YWJj:${Buffer.from(`synthetic-${suffix}`).toString('base64')}`;
    const db = database();
    try {
        db.prepare('INSERT OR IGNORE INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)').run(patientId, 'Synthetic', `Current ${suffix}`, `SYNTHETICCURRENT${suffix}`);
        db.prepare(`INSERT INTO durable_review_records (id, patient_ref, review_id, review_revision, receipt_ref, provenance_ref, receipt_binding, provenance_binding, presentation_version, sealed_ciphertext, sealed_digest)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(reviewId, patientRef, reviewId, receiptRef, provenanceRef,
            digest(`${patientRef}\0${reviewId}\0${receiptRef}`), digest(`${patientRef}\0${reviewId}\0${provenanceRef}`),
            'mediflow.ai.durable-review.presentation.v1', sealedCiphertext, digest(sealedCiphertext));
        db.prepare('INSERT INTO durable_review_patient_links (review_id, patient_id) VALUES (?, ?)').run(reviewId, patientId);
    } finally { db.close(); }
    return { patientId, patientRef, reviewId };
}

test('returns exactly one current durable identity and revision through the canonical patient link', () => {
    const fixture = seed('1');
    assert.deepEqual(createDurableCurrentReviewLocator().locate(fixture.patientId), { reviewId: fixture.reviewId, reviewRevision: 1 });
});

test('denies zero, multiple, and terminal matches without selecting a row', () => {
    const locator = createDurableCurrentReviewLocator();
    rejects(() => locator.locate('patient.synthetic.current.none'), 'current_missing');
    const first = seed('2'); seed('3', first.patientId);
    rejects(() => locator.locate(first.patientId), 'current_ambiguous');
    const terminal = seed('4'); const db = database();
    try { db.prepare("INSERT INTO durable_review_command_states (review_id, review_state, revision, action) VALUES (?, 'accepted', 2, 'accept')").run(terminal.reviewId); } finally { db.close(); }
    rejects(() => locator.locate(terminal.patientId), 'terminal');
});

test('returns the sole nonterminal review when valid terminal history shares the canonical patient', () => {
    const historical = seed('8'); const current = seed('9', historical.patientId); const db = database();
    try { db.prepare("INSERT INTO durable_review_command_states (review_id, review_state, revision, action) VALUES (?, 'rejected', 2, 'reject')").run(historical.reviewId); } finally { db.close(); }
    assert.deepEqual(createDurableCurrentReviewLocator().locate(historical.patientId), { reviewId: current.reviewId, reviewRevision: 1 });
});

test('rejects hostile values and never treats a rotating patientRef as a canonical patient id', () => {
    const fixture = seed('5'); const locator = createDurableCurrentReviewLocator(); let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'toString', { enumerable: true, get() { reads += 1; return () => fixture.patientId; } });
    for (const value of [fixture.patientRef, '', ' padded', `${fixture.patientId} `, 'x'.repeat(257), accessor, new String(fixture.patientId)]) rejects(() => locator.locate(value), 'input_invalid');
    assert.equal(reads, 0);
});

test('fails closed for corrupt, dangling, or schema-uncertain durable rows', () => {
    const corrupt = seed('6'); const dangling = seed('7'); const db = database();
    try {
        db.prepare("UPDATE durable_review_records SET sealed_digest = ? WHERE review_id = ?").run('0'.repeat(64), corrupt.reviewId);
        db.pragma('foreign_keys = OFF'); db.prepare('DELETE FROM durable_review_records WHERE review_id = ?').run(dangling.reviewId); db.pragma('foreign_keys = ON');
    } finally { db.close(); }
    const locator = createDurableCurrentReviewLocator();
    rejects(() => locator.locate(corrupt.patientId), 'corrupt');
    rejects(() => locator.locate(dangling.patientId), 'corrupt');
    const schema = database();
    try { schema.exec('DROP TABLE durable_review_patient_links; CREATE TABLE durable_review_patient_links (review_id TEXT)'); } finally { schema.close(); }
    rejects(() => locator.locate('patient.synthetic.current.none'), 'schema_incompatible');
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
