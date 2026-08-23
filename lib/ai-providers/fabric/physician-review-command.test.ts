/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-physician-review-command-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });

const { createDurableReviewRecordStore } = await import('./durable-review-record-store.ts');
const { createPhysicianReviewCommandService, PhysicianReviewCommandError } = await import('./physician-review-command.ts');

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function reviewRecord(suffix: string) {
    const reviewId = `review_${suffix.repeat(32)}`;
    const patientRef = `ptr_${suffix.repeat(32)}`;
    const receiptRef = `receipt_${suffix.repeat(32)}`;
    const provenanceRef = `provenance_${suffix.repeat(32)}`;
    const sealedCiphertext = `ENC:YWJj:${Buffer.from(`synthetic-review-${suffix}`).toString('base64')}`;
    return Object.freeze({
    patientRef, reviewId,
    reviewRevision: 1,
    receiptRef, provenanceRef,
    receiptBinding: digest(`${patientRef}\0${reviewId}\0${receiptRef}`),
    provenanceBinding: digest(`${patientRef}\0${reviewId}\0${provenanceRef}`),
    presentationVersion: 'mediflow.ai.durable-review.presentation.v1',
    sealedCiphertext, sealedDigest: digest(sealedCiphertext),
    });
}

const request = (action: 'accept' | 'reject' | 'supersede', key: string, proof: string, expectedRevision = 1, uncertaintyAcknowledged = false) =>
    ({ action, expectedRevision, idempotencyKey: key, gestureProof: proof, uncertaintyAcknowledged });
const context = (reviewId: string, uncertaintyAcknowledgmentRequired = false, actorRef = 'actor_11111111111111111111111111111111') =>
    ({ reviewId, actorRef, role: 'physician', uncertaintyAcknowledgmentRequired });
const expectCode = (code: string, execute: () => unknown) => assert.throws(execute, (error) => error instanceof PhysicianReviewCommandError && error.code === code);
function acceptedReview(suffix: string) {
    const record = reviewRecord(suffix); const proof = `gesture_${suffix.repeat(32)}`; const eventId = `event_${suffix.repeat(32)}`;
    createDurableReviewRecordStore().create({ record, expectedReviewRevision: 0, idempotencyKey: `idem_${suffix.repeat(16)}` });
    const input = request('accept', `idem_${suffix.repeat(15)}x`, proof);
    const service = createPhysicianReviewCommandService({
        resolveContext: () => context(record.reviewId), consumeGesture: (scope) => scope.proof === proof, eventId: () => eventId, now: () => 8,
    });
    service.execute(input);
    return { record, input, eventId, service };
}

test('accepts a host-resolved physician review and writes an opaque audit receipt atomically', () => {
    const record = reviewRecord('1'); const { reviewId } = record;
    createDurableReviewRecordStore().create({ record, expectedReviewRevision: 0, idempotencyKey: 'idem_aaaaaaaaaaaaaaaa' });
    let gestureUsed = false;
    const service = createPhysicianReviewCommandService({
        resolveContext: () => ({ reviewId, actorRef: 'actor_11111111111111111111111111111111', role: 'physician', uncertaintyAcknowledgmentRequired: true }),
        consumeGesture: (scope) => {
            if (scope.proof !== 'gesture_11111111111111111111111111111111' || scope.actorRef !== 'actor_11111111111111111111111111111111' || scope.action !== 'accept' || scope.reviewId !== reviewId || scope.expectedRevision !== 1 || gestureUsed) return false;
            gestureUsed = true;
            return true;
        },
        eventId: () => 'event_11111111111111111111111111111111',
        now: () => 1_700_000_000_000,
    });

    const input = request('accept', 'idem_bbbbbbbbbbbbbbbb', 'gesture_11111111111111111111111111111111', 1, true);
    const expected = {
        reviewId,
        state: 'accepted',
        revision: 2,
        eventId: 'event_11111111111111111111111111111111',
    };
    assert.deepEqual(service.execute(input), expected);
    assert.deepEqual(service.execute(input), expected, 'an equivalent idempotent replay must not consume the one-use gesture again');
    expectCode('idempotency_conflict', () => service.execute(request('accept', input.idempotencyKey, 'gesture_99999999999999999999999999999999', 1, true)));
    const actorB = createPhysicianReviewCommandService({
        resolveContext: () => context(reviewId, true, 'actor_22222222222222222222222222222222'), consumeGesture: () => { throw new Error('replay must not consume'); }, eventId: () => 'event_22222222222222222222222222222222', now: () => 2,
    });
    expectCode('idempotency_conflict', () => actorB.execute(input));
    expectCode('idempotency_conflict', () => service.execute(request('reject', input.idempotencyKey, input.gestureProof)));
    expectCode('idempotency_conflict', () => service.execute(request('accept', input.idempotencyKey, input.gestureProof, 2, true)));
    assert.deepEqual(Object.keys(service), ['execute'], 'the command surface has no apply operation');
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        const audit = sqlite.prepare('SELECT event_id, event_type, actor_ref, subject_ref, occurred_at, redacted_metadata FROM audit_events WHERE event_id = ?').get(expected.eventId) as Record<string, string | number>;
        assert.deepEqual(audit, {
            event_id: expected.eventId,
            event_type: 'ai.review.accepted',
            actor_ref: 'actor_11111111111111111111111111111111',
            subject_ref: reviewId,
            occurred_at: 1_700_000_000,
            redacted_metadata: `{"flags":["accept","accepted","digest_${digest(JSON.stringify(['accept', 1, true, digest(input.gestureProof), 'actor_11111111111111111111111111111111']))}"],"resourceVersion":2}`,
        });
        assert.doesNotMatch(JSON.stringify(audit), /sealedCiphertext|synthetic-review|plaintext|proposal/i);
    } finally { sqlite.close(); }
});

test('rejects a non-physician and caller-supplied actor or patient fields before any gesture is consumed', () => {
    let gestures = 0;
    const denied = createPhysicianReviewCommandService({
        resolveContext: () => ({ ...context('review_22222222222222222222222222222222'), role: 'application' }),
        consumeGesture: () => { gestures += 1; return true; }, eventId: () => 'event_22222222222222222222222222222222', now: () => 1,
    });
    expectCode('actor_forbidden', () => denied.execute(request('reject', 'idem_cccccccccccccccc', 'gesture_22222222222222222222222222222222')));
    const injected = createPhysicianReviewCommandService({
        resolveContext: () => context('review_22222222222222222222222222222222'),
        consumeGesture: () => { gestures += 1; return true; }, eventId: () => 'event_22222222222222222222222222222222', now: () => 1,
    });
    expectCode('invalid_command', () => injected.execute({ ...request('reject', 'idem_cccccccccccccccc', 'gesture_22222222222222222222222222222222'), actorRef: 'actor_injected', patientRef: 'ptr_injected' }));
    const unavailable = createPhysicianReviewCommandService({
        resolveContext: () => { throw new Error('synthetic host failure'); },
        consumeGesture: () => { gestures += 1; return true; }, eventId: () => 'event_22222222222222222222222222222222', now: () => 1,
    });
    expectCode('context_unavailable', () => unavailable.execute(request('reject', 'idem_cccccccccccccccc', 'gesture_22222222222222222222222222222222')));
    assert.equal(gestures, 0);
});

test('denies a wrong gesture, a stale revision, a missing required acknowledgment, and a second terminal mutation', () => {
    const record = reviewRecord('3'); createDurableReviewRecordStore().create({ record, expectedReviewRevision: 0, idempotencyKey: 'idem_dddddddddddddddd' });
    const acceptedProofs = new Set(['gesture_33333333333333333333333333333333', 'gesture_44444444444444444444444444444444', 'gesture_66666666666666666666666666666666']);
    const service = createPhysicianReviewCommandService({
        resolveContext: () => context(record.reviewId, true), consumeGesture: (scope) => acceptedProofs.delete(scope.proof), eventId: () => 'event_33333333333333333333333333333333', now: () => 3,
    });
    expectCode('uncertainty_acknowledgment_required', () => service.execute(request('accept', 'idem_eeeeeeeeeeeeeeee', 'gesture_33333333333333333333333333333333')));
    expectCode('gesture_invalid', () => service.execute(request('reject', 'idem_eeeeeeeeeeeeeeee', 'gesture_badbadbadbadbadbadbadbadbadbadba')));
    expectCode('revision_conflict', () => service.execute(request('reject', 'idem_eeeeeeeeeeeeeeee', 'gesture_33333333333333333333333333333333', 2)));
    assert.equal(acceptedProofs.has('gesture_33333333333333333333333333333333'), true, 'a non-concurrent stale preflight must not consume its gesture');
    assert.equal(service.execute(request('accept', 'idem_eeeeeeeeeeeeeeee', 'gesture_44444444444444444444444444444444', 1, true)).state, 'accepted');
    expectCode('terminal', () => service.execute(request('reject', 'idem_ffffffffffffffff', 'gesture_66666666666666666666666666666666')));
    assert.equal(acceptedProofs.has('gesture_66666666666666666666666666666666'), true, 'a terminal preflight must not consume its gesture');
});

test('denies supersede because the physician-only command exposes accept and reject only', () => {
    const service = createPhysicianReviewCommandService({
        resolveContext: () => context('review_77777777777777777777777777777777'), consumeGesture: () => true, eventId: () => 'event_77777777777777777777777777777777', now: () => 7,
    });
    expectCode('invalid_command', () => service.execute(request('supersede', 'idem_jjjjjjjjjjjjjjjj', 'gesture_77777777777777777777777777777777')));
});

test('fails closed when replay state, operation snapshot/id, or linked audit receipts are tampered', () => {
    const state = acceptedReview('8'); const snapshot = acceptedReview('9'); const operation = acceptedReview('a'); const absentAudit = acceptedReview('b'); const incoherentAudit = acceptedReview('c');
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        sqlite.prepare("UPDATE durable_review_command_states SET review_state = 'rejected' WHERE review_id = ?").run(state.record.reviewId);
        sqlite.prepare('UPDATE durable_review_command_operations SET result_snapshot = ? WHERE review_id = ?').run(JSON.stringify({ reviewId: snapshot.record.reviewId, state: 'accepted', revision: 3, eventId: snapshot.eventId }), snapshot.record.reviewId);
        sqlite.prepare("UPDATE durable_review_command_operations SET id = 'tampered' WHERE review_id = ?").run(operation.record.reviewId);
        sqlite.exec('DROP TRIGGER audit_events_no_delete; DROP TRIGGER audit_events_no_update;');
        sqlite.prepare('DELETE FROM audit_events WHERE event_id = ?').run(absentAudit.eventId);
        sqlite.prepare('UPDATE audit_events SET actor_ref = ? WHERE event_id = ?').run('actor_22222222222222222222222222222222', incoherentAudit.eventId);
    } finally { sqlite.close(); }
    for (const item of [state, snapshot, operation, absentAudit, incoherentAudit]) expectCode('corrupt', () => item.service.execute(item.input));
});

test('a race between preflight and BEGIN IMMEDIATE consumes the losing proof and leaves the terminal winner authoritative', () => {
    const record = reviewRecord('d'); createDurableReviewRecordStore().create({ record, expectedReviewRevision: 0, idempotencyKey: 'idem_dddddddddddddddd' });
    const winnerProof = 'gesture_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; const loserProof = 'gesture_ffffffffffffffffffffffffffffffff';
    const winner = createPhysicianReviewCommandService({
        resolveContext: () => context(record.reviewId), consumeGesture: (scope) => scope.proof === winnerProof, eventId: () => 'event_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', now: () => 14,
    });
    let winnerRan = false;
    const loser = createPhysicianReviewCommandService({
        resolveContext: () => context(record.reviewId),
        consumeGesture: (scope) => { if (scope.proof !== loserProof || winnerRan) return false; winnerRan = true; assert.equal(winner.execute(request('accept', 'idem_eeeeeeeeeeeeeeee', winnerProof)).state, 'accepted'); return true; },
        eventId: () => 'event_ffffffffffffffffffffffffffffffff', now: () => 15,
    });
    expectCode('terminal', () => loser.execute(request('reject', 'idem_ffffffffffffffff', loserProof)));
    assert.equal(winnerRan, true);
});

test('rolls back review state and idempotency receipt when append-only audit insertion fails', () => {
    const record = reviewRecord('5'); createDurableReviewRecordStore().create({ record, expectedReviewRevision: 0, idempotencyKey: 'idem_gggggggggggggggg' });
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try { sqlite.exec("CREATE TRIGGER fail_review_audit BEFORE INSERT ON audit_events WHEN NEW.event_type = 'ai.review.rejected' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;"); } finally { sqlite.close(); }
    const proofs = new Set(['gesture_55555555555555555555555555555555', 'gesture_66666666666666666666666666666666']);
    const service = createPhysicianReviewCommandService({
        resolveContext: () => context(record.reviewId), consumeGesture: (scope) => proofs.delete(scope.proof), eventId: () => 'event_55555555555555555555555555555555', now: () => 5,
    });
    expectCode('storage_unavailable', () => service.execute(request('reject', 'idem_hhhhhhhhhhhhhhhh', 'gesture_55555555555555555555555555555555')));
    const check = new Database(path.join(dataDir, 'medical.db'));
    try {
        assert.equal((check.prepare('SELECT COUNT(*) AS count FROM durable_review_command_states WHERE review_id = ?').get(record.reviewId) as { count: number }).count, 0);
        assert.equal((check.prepare('SELECT COUNT(*) AS count FROM durable_review_command_operations WHERE review_id = ?').get(record.reviewId) as { count: number }).count, 0);
        assert.equal((check.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'ai.review.rejected'").get() as { count: number }).count, 0);
    } finally { check.close(); }
    expectCode('gesture_invalid', () => service.execute(request('reject', 'idem_hhhhhhhhhhhhhhhh', 'gesture_55555555555555555555555555555555')));
    const recover = new Database(path.join(dataDir, 'medical.db'));
    try { recover.exec('DROP TRIGGER fail_review_audit;'); } finally { recover.close(); }
    assert.equal(service.execute(request('reject', 'idem_iiiiiiiiiiiiiiii', 'gesture_66666666666666666666666666666666')).state, 'rejected');
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
