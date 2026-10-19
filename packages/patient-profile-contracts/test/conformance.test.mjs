import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProfileResultBudget, isProfileResult, parseProfileQuery } from '../src/query.ts';
import { isProfileReviewView, parseProfileReviewInput } from '../src/review.ts';
import { isProfileNotesCommitReceipt, isProfileNotesCommitView,
    parseProfileNotesCommitInput, parseProfileNotesCommitJournal } from '../src/notes-commit.ts';

// Synthetic wire values exercise the contracts; valid shapes never confer host authority.
const enc = 'ENC:AAECAwQFBgcICQoL:YWJjZA==';
const reference = `ppr_${'1'.repeat(64)}`;
const digest = '2'.repeat(64);
const review = { kind: 'prepared', policy: 'patient-profile.notes.review-only.v1',
    reference, digest, notes: enc, expectedRevision: 4, selectionEpoch: 2, expiresAt: 40_000 };
const receipt = { kind: 'committed', policy: 'patient-profile.notes.commit.v1', reference, digest,
    previousRevision: 4, revision: 5, committedAt: 20_000, receiptRef: `ppnr_${'3'.repeat(64)}` };

test('profile query contracts preserve projection and reject caller authority or old versions', () => {
    const open = { kind: 'open', contractVersion: 1, projection: 'notes', expectedSelectionEpoch: 2 };
    assert.deepEqual(parseProfileQuery(open), open);
    const read = { kind: 'read', contractVersion: 1, projection: 'profile',
        handle: `pph_${'4'.repeat(64)}`, expectedRevision: 4 };
    assert.deepEqual(parseProfileQuery(read), read);
    for (const invalid of [
        { ...open, contractVersion: 0 }, { ...open, role: 'admin' },
        { ...open, projection: 'all-records' }, { ...read, expectedRevision: 0 },
        { ...read, handle: reference }, { ...read, patientId: 'synthetic-other-patient' },
    ]) assert.equal(parseProfileQuery(invalid), null);
});

test('profile result budget counts UTF-8 bytes and preserves notes without reserialization', () => {
    const result = { schemaVersion: 'mediflow.patient.profile-view.v1', operationId: 'patient-profile.read.v1',
        contractVersion: 1, handle: `pph_${'4'.repeat(64)}`, projection: 'notes',
        currentness: { revision: 4, selectionEpoch: 2, observedAt: 10_000, expiresAt: 40_000 },
        profile: { notes: enc } };
    assert.equal(isProfileResult(result), true);
    assertProfileResultBudget(result);
    assert.equal(result.profile.notes, enc);
    assert.equal(isProfileResult({ ...result, authority: true }), false);
    assert.equal(isProfileResult({ ...result, currentness: { ...result.currentness, expiresAt: 10_000 } }), false);
    assertProfileResultBudget({ ...result, profile: { notes: 'a'.repeat(20_000) } });
    assert.throws(() => assertProfileResultBudget({ ...result, profile: { notes: '🩺'.repeat(10_000) } }),
        { code: 'output_too_large' });
});

test('review and notes commit preserve ENC and keep their policies distinct', () => {
    for (const notes of [enc, null]) {
        const input = { kind: 'prepare', expectedSelectionEpoch: 2, expectedRevision: 4, notes };
        assert.deepEqual(parseProfileReviewInput(input), input);
        assert.deepEqual(parseProfileNotesCommitInput(input), input);
        assert.equal(parseProfileNotesCommitInput({ ...input, confirmed: true }), null);
        assert.equal(parseProfileNotesCommitInput({ ...input, proof: 'synthetic-caller-proof' }), null);
    }
    assert.equal(parseProfileReviewInput({ kind: 'prepare', expectedSelectionEpoch: 2, expectedRevision: 4, notes: '' }), null);
    assert.equal(isProfileReviewView(review), true);
    const commit = { ...review, policy: 'patient-profile.notes.commit.v1', action: 'replace-notes',
        recipient: { id: 'synthetic-patient', firstName: 'ENC:synthetic-first', lastName: 'ENC:synthetic-last' } };
    assert.equal(isProfileNotesCommitView(commit), true);
    assert.equal(isProfileNotesCommitView({ ...commit, policy: review.policy }), false);
    assert.equal(isProfileNotesCommitView({ ...commit, action: 'remove-notes' }), false);
    assert.equal(isProfileReviewView(commit), false);
    const confirmation = { kind: 'confirm', reference, digest, candidatePin: '2468' };
    assert.deepEqual(parseProfileNotesCommitInput(confirmation), confirmation);
    assert.equal(parseProfileNotesCommitInput({ ...confirmation, actor: 'synthetic-other' }), null);
});

test('receipts retain one revision step and journals exclude additional clinical or authority fields', () => {
    const request = { kind: 'receipt', reference, digest };
    assert.deepEqual(parseProfileNotesCommitInput(request), request);
    assert.equal(parseProfileNotesCommitInput({ ...request, archiveGeneration: 'old-generation' }), null);
    assert.equal(isProfileNotesCommitReceipt(receipt), true);
    assert.equal(isProfileNotesCommitReceipt({ ...receipt, revision: 6 }), false);
    assert.equal(isProfileNotesCommitReceipt({ ...receipt, policy: review.policy }), false);
    assert.equal(isProfileNotesCommitReceipt({ ...receipt, proof: 'not-authority' }), false);
    const journal = { schemaVersion: 1, commandDigest: digest, scopeDigest: '5'.repeat(64), receipt };
    assert.deepEqual(parseProfileNotesCommitJournal(journal), journal);
    for (const invalid of [{ ...journal, schemaVersion: 0 }, { ...journal, notes: enc },
        { ...journal, receipt: { ...receipt, recipient: 'synthetic-patient' } }]) {
        assert.equal(parseProfileNotesCommitJournal(invalid), null);
    }
});
