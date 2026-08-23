/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
    createPatientInsightAtomicLease,
    PatientInsightAtomicLeaseError,
} from './patient-insight-atomic-lease.ts';
import { createServerSessionProjectionOwnerRegistry, ServerSessionProjectionOwnerError } from '../../security/server-session-projection-owner.ts';
import { clearAllSessions, createSession } from '../../security/server-session.ts';

type State = { selectionEpoch: number; reviewContextEpoch: number; active: boolean; nested: boolean };

afterEach(() => clearAllSessions());

function fixture(overrides: Partial<{ entropy(): Uint8Array; clock(): number }> = {}) {
    const state: State = { selectionEpoch: 1, reviewContextEpoch: 1, active: false, nested: false };
    const owner = Object.freeze({
        snapshotSelectionEpoch() { return state.selectionEpoch; },
        snapshotReviewContextEpoch() { return state.reviewContextEpoch; },
        withLeaseCriticalSection(_session: unknown, callback: () => unknown) {
            if (state.active) throw new Error('selection_busy');
            state.active = true;
            try { return callback(); } finally { state.active = false; }
        },
    });
    return { state, lease: createPatientInsightAtomicLease({ owner: owner as never, session: Object.freeze({}) as never, entropy: () => new Uint8Array(16), clock: () => 1, ...overrides }) };
}

function rejects(code: string) {
    return (error: unknown) => error instanceof PatientInsightAtomicLeaseError && error.code === code;
}

test('publishes one primitive staging result only after the P4 final currentness snapshot', () => {
    const { lease } = fixture();
    const current = lease.replaceCurrentness(1, 1, 'fresh-1', false);
    assert.equal(lease.consume(current, () => 'staged'), 'staged');
    assert.throws(() => lease.consume(current, () => 'replay'), rejects('record_spent'));
});

test('rejects stale, revoked, regressed, duplicate, and ABA currentness without publication', () => {
    const { lease } = fixture();
    const first = lease.replaceCurrentness(1, 1, 'fresh-1', false);
    const second = lease.replaceCurrentness(2, 2, 'fresh-2', false);
    assert.throws(() => lease.consume(first, () => 'never'), rejects('stale_currentness'));
    assert.throws(() => lease.replaceCurrentness(2, 1, 'fresh-1', false), rejects('epoch_regressed'));
    assert.throws(() => lease.replaceCurrentness(3, 1, 'fresh-1', false), rejects('epoch_aba'));
    const revoked = lease.replaceCurrentness(3, 3, 'fresh-3', true);
    assert.throws(() => lease.consume(revoked, () => 'never'), rejects('revoked'));
    assert.throws(() => lease.replaceCurrentness(4, 4, 'fresh-4', false), rejects('revoked'));
    assert.throws(() => lease.consume(second, () => 'never'), rejects('stale_currentness'));
    assert.throws(() => lease.consume(second, () => 'never'), rejects('record_spent'));
});

test('rejects transient P4 epoch changes during entropy or the staging callback', () => {
    const { state, lease } = fixture();
    const first = lease.replaceCurrentness(1, 1, 'fresh-1', false);
    assert.throws(() => lease.consume(first, () => { state.selectionEpoch += 1; return 'never'; }), rejects('stale_selection'));

    const entropyFixture = fixture();
    const changed = createPatientInsightAtomicLease({
        owner: Object.freeze({
            snapshotSelectionEpoch() { return entropyFixture.state.selectionEpoch; },
            snapshotReviewContextEpoch() { return entropyFixture.state.reviewContextEpoch; },
            withLeaseCriticalSection(_session: unknown, callback: () => unknown) { return callback(); },
        }) as never,
        session: Object.freeze({}) as never, entropy: () => { entropyFixture.state.selectionEpoch += 1; return new Uint8Array(16); }, clock: () => 1,
    });
    const changedCurrent = changed.replaceCurrentness(1, 1, 'fresh-1', false);
    assert.throws(() => changed.consume(changedCurrent, () => 'never'), rejects('stale_selection'));

    const clockFixture = fixture();
    const clockChanged = createPatientInsightAtomicLease({
        owner: Object.freeze({ snapshotSelectionEpoch() { return clockFixture.state.selectionEpoch; },
            snapshotReviewContextEpoch() { return clockFixture.state.reviewContextEpoch; },
            withLeaseCriticalSection(_session: unknown, callback: () => unknown) { return callback(); } }) as never,
        session: Object.freeze({}) as never, entropy: () => new Uint8Array(16),
        clock: () => { clockFixture.state.reviewContextEpoch += 1; return 1; },
    });
    const clockCurrent = clockChanged.replaceCurrentness(1, 1, 'fresh-1', false);
    assert.throws(() => clockChanged.consume(clockCurrent, () => 'never'), rejects('stale_selection'));
});

test('uses the real P4 primitive, preserving its reentry and restart denials', () => {
    const session = createSession({ id: ['synthetic', 'user'].join('-'), username: ['synthetic', 'clinician'].join('-'), role: 'clinician' });
    const owner = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair }).acquire(session);
    owner.issueSelection({ expectedEpoch: 0, patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' });
    const lease = createPatientInsightAtomicLease({ owner, session, entropy: () => new Uint8Array(16), clock: () => 1 });
    const first = lease.replaceCurrentness(1, 1, 'fresh-1', false);
    const otherSession = createSession({ id: ['synthetic', 'other'].join('-'), username: ['synthetic', 'other'].join('-'), role: 'clinician' });
    const otherOwner = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair }).acquire(otherSession);
    otherOwner.issueSelection({ expectedEpoch: 0, patientId: 'patient.synthetic.other', ambulatoryId: 'ambulatory.synthetic.other' });
    const other = createPatientInsightAtomicLease({ owner: otherOwner, session: otherSession });
    assert.throws(() => other.consume(first, () => 'never'), rejects('input_invalid'));
    assert.throws(() => lease.consume(first, () => owner.withLeaseCriticalSection(session, () => 'nested')),
        (error) => error instanceof ServerSessionProjectionOwnerError && error.code === 'selection_busy');
    const second = lease.replaceCurrentness(2, 2, 'fresh-2', false);
    owner.dispose();
    assert.throws(() => lease.consume(second, () => 'never'),
        (error) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
});

test('fails closed for nested P4 use, dispose, promises, thenables, and hostile staging objects', () => {
    const { lease } = fixture();
    const current = lease.replaceCurrentness(1, 1, 'fresh-1', false);
    assert.throws(() => lease.consume(current, () => Promise.resolve('later')), rejects('input_invalid'));

    const again = lease.replaceCurrentness(2, 2, 'fresh-2', false);
    let reads = 0;
    const accessor = Object.create(null, { then: { get() { reads += 1; return () => undefined; } } });
    assert.throws(() => lease.consume(again, () => accessor), rejects('input_invalid'));
    assert.equal(reads, 0);

    const final = lease.replaceCurrentness(3, 3, 'fresh-3', false);
    lease.dispose();
    assert.throws(() => lease.consume(final, () => 'never'), rejects('disposed'));
});

test('rejects hostile handles without touching Proxy or accessor traps and has no provider residue', () => {
    const { lease } = fixture();
    lease.replaceCurrentness(1, 1, 'fresh-1', false);
    let traps = 0;
    const hostile = new Proxy({}, { getOwnPropertyDescriptor() { traps += 1; return undefined; }, get() { traps += 1; return undefined; } });
    assert.throws(() => lease.consume(hostile, () => 'never'), rejects('input_invalid'));
    assert.equal(traps, 0);
    assert.deepEqual(Object.keys(lease), ['replaceCurrentness', 'consume', 'dispose']);
});

test('does not read an ambient Object.prototype.then getter while creating or consuming an opaque record', () => {
    const session = createSession({ id: ['synthetic', 'ambient'].join('-'), username: ['synthetic', 'ambient'].join('-'), role: 'clinician' });
    const owner = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair }).acquire(session);
    owner.issueSelection({ expectedEpoch: 0, patientId: 'patient.synthetic.ambient', ambulatoryId: 'ambulatory.synthetic.ambient' });
    const lease = createPatientInsightAtomicLease({ owner, session, entropy: () => new Uint8Array(16), clock: () => 1 });
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let reads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    try {
        const current = lease.replaceCurrentness(1, 1, 'fresh-1', false);
        assert.equal(lease.consume(current, () => 'staged'), 'staged');
    } finally {
        if (prior) Object.defineProperty(Object.prototype, 'then', prior);
        else delete (Object.prototype as { then?: unknown }).then;
    }
    assert.equal(reads, 0);
});
