/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createPatientInsightAtomicLease,
    PatientInsightAtomicLeaseError,
} from './patient-insight-atomic-lease';
import { createPatientInsightBroker, PatientInsightBrokerError, type PatientInsightBrokerHost } from './patient-insight-broker';
import { createPatientInsightHostBoundary } from './patient-insight-host-boundary';
import { createServerSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner';
import {
    clearAllSessions,
    createSession,
    retireServerSessionForApplicationLock,
    retireServerSessionForLogout,
} from '../../security/server-session';

const ref = (prefix: string) => `${prefix}_${'a'.repeat(32)}`;
const fixedEntropy = Uint8Array.from({ length: 16 }, (_, index) => index);
const expectedHandle = `pib_${'000102030405060708090a0b0c0d0e0f'}`;
const sources = () => ({
    focus: { summary: 'synthetic follow-up' },
    conditions: [{ label: 'synthetic condition' }],
    activeTherapies: [{ label: 'synthetic therapy' }],
    recentEvents: [{ summary: 'synthetic review' }],
});

afterEach(() => clearAllSessions());

function rejects(code: string) {
    return (error: unknown) => error instanceof PatientInsightAtomicLeaseError && error.code === code;
}

function fixture() {
    let clock = 1_000;
    let ownerEntropy = 0;
    let review = 1;
    let revoked = false;
    let currentnessReads = 0;
    let driftOnRead = 0;
    let reenter = false;
    let nestedError: unknown;
    const registry = createServerSessionProjectionOwnerRegistry({
        clock: () => clock,
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (ownerEntropy += 1) + index),
        resolve: (_session, pair) => Object.freeze({ ...pair }),
    });
    const session = createSession({ id: 'synthetic-user', username: ['synthetic', 'clinician'].join('-'), role: 'clinician' });
    const owner = registry.acquire(session);
    owner.issueSelection({ expectedEpoch: 0, patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' });
    const port = owner.mintPatientInsightLeaseCommitPort(session);
    const boundary = createPatientInsightHostBoundary({
        binding: { leaseRef: ref('lsr'), patientRef: ref('ptr'), selectionEpoch: 1 },
        receipt: { schemaVersion: 'mediflow.patient-insight.host-receipt.v1', reference: ref('receipt'), capability: 'patient_insight', authority: 'host_service', writesPerformed: 0, applyPolicy: 'none' },
        provenance: { schemaVersion: 'mediflow.patient-insight.host-provenance.v1', reference: ref('provenance'), capability: 'patient_insight', receiptRef: ref('receipt') },
    });
    let reenterLease = () => undefined as unknown;
    const host: PatientInsightBrokerHost = Object.freeze({
        readCurrentness: () => {
            currentnessReads += 1;
            if (driftOnRead === currentnessReads) review += 1;
            return Object.freeze({
                selectionEpoch: owner.snapshotSelectionEpoch(session),
                revision: review,
                freshnessToken: 'fresh_token_0123456789abcdef',
                isRevoked: () => revoked,
            });
        },
        readSources: () => {
            if (reenter) {
                try { reenterLease(); } catch (error) { nestedError = error; }
            }
            return sources();
        },
        boundary,
        clock: () => '2026-08-23T12:00:00.000Z',
        entropy: () => fixedEntropy,
    });
    const broker = createPatientInsightBroker(host);
    const lease = createPatientInsightAtomicLease(Object.freeze({ port, broker }));
    reenterLease = () => lease.commit();
    return {
        lease, broker, owner, port, session,
        expire: () => { clock = session.expiresAt; },
        revoke: () => { revoked = true; },
        reselect: () => owner.issueSelection({ expectedEpoch: 1, patientId: 'patient.synthetic.02', ambulatoryId: 'ambulatory.synthetic.01' }),
        driftDuringPublish: () => { driftOnRead = 3; },
        reenterDuringStage: () => { reenter = true; },
        nestedError: () => nestedError,
    };
}

test('publishes one opaque review-only handle and commits the real host port last', () => {
    const value = fixture();
    const handle = value.lease.commit();
    assert.equal(handle, expectedHandle);
    const committed = value.port.snapshot()!;
    assert.equal(committed.stagedRef, null);
    assert.equal(committed.generation, 1);
    assert.equal(committed.terminal, true);
    const result = value.broker.consume(Object.freeze({ handle }));
    assert.equal(result.status, 'available');
    assert.equal(result.writesPerformed, 0);
    assert.equal(result.applyPolicy, 'none');
    assert.equal(result.proposal.reviewOnly, true);
    assert.throws(() => value.lease.commit(), rejects('record_spent'));
});

test('denies logout, application lock, expiry, reselection, and broker revocation before publication', () => {
    for (const retire of [
        (value: ReturnType<typeof fixture>) => retireServerSessionForLogout(value.session.id),
        (value: ReturnType<typeof fixture>) => retireServerSessionForApplicationLock(value.session.id),
        (value: ReturnType<typeof fixture>) => value.expire(),
        (value: ReturnType<typeof fixture>) => value.reselect(),
    ]) {
        const value = fixture(); retire(value);
        assert.throws(() => value.lease.commit(), rejects('stale_selection'));
    }
    const revoked = fixture(); revoked.revoke();
    assert.throws(() => revoked.lease.commit(), (error) => error instanceof PatientInsightBrokerError && error.code === 'revoked');
});

test('aborts both real stages after review drift and releases broker entropy without residue', () => {
    const value = fixture(); value.driftDuringPublish();
    assert.throws(() => value.lease.commit(), (error) => error instanceof PatientInsightBrokerError && error.code === 'revision_stale');
    assert.equal(value.port.snapshot()!.terminal, true);
    const reservation = value.broker.stage();
    assert.equal(value.broker.publish(reservation), expectedHandle);
    const denied = fixture();
    const port = Object.freeze({ ...denied.port, commit: () => false });
    assert.throws(() => createPatientInsightAtomicLease(Object.freeze({ port, broker: denied.broker })).commit(), rejects('stale_selection'));
    assert.throws(() => denied.broker.consume(Object.freeze({ handle: expectedHandle })), PatientInsightBrokerError);
});

test('rejects sync commit methods returning Promise booleans without publication or residue', () => {
    for (const outcome of [false, true]) {
        const value = fixture();
        const port = Object.freeze({ ...value.port, commit: () => Promise.resolve(outcome) });
        const lease = createPatientInsightAtomicLease(Object.freeze({ port, broker: value.broker }));
        assert.throws(() => lease.commit(), rejects('stale_selection'));
        assert.throws(() => value.broker.consume(Object.freeze({ handle: expectedHandle })), PatientInsightBrokerError);
        const terminal = value.port.snapshot()!;
        assert.equal(terminal.stagedRef, null);
        assert.equal(terminal.generation, 0);
        assert.equal(terminal.terminal, true);
    }
});

test('makes swallowed lease reentry sticky and aborts the broker reservation', () => {
    const value = fixture(); value.reenterDuringStage();
    assert.throws(() => value.lease.commit(), rejects('operation_reentered'));
    assert.ok(value.nestedError() instanceof PatientInsightAtomicLeaseError);
    assert.equal((value.nestedError() as PatientInsightAtomicLeaseError).code, 'operation_reentered');
    const reservation = value.broker.stage();
    assert.equal(value.broker.publish(reservation), expectedHandle);
});

test('rejects Promise, thenable, async, and Proxy dependencies without trap reads', () => {
    const value = fixture();
    const methods = {
        stage: () => Promise.resolve(Object.freeze(Object.create(null))), publish: () => expectedHandle,
        abort: () => undefined, issue: () => expectedHandle, consume: () => { throw new Error('unused'); },
    };
    assert.throws(() => createPatientInsightAtomicLease(Object.freeze({ port: value.port, broker: Object.freeze(methods) })).commit(), rejects('input_invalid'));
    let thenReads = 0;
    const thenable = Object.freeze(Object.create(null, { then: { enumerable: true, get() { thenReads += 1; return () => undefined; } } }));
    assert.throws(() => createPatientInsightAtomicLease(Object.freeze({ port: value.owner.mintPatientInsightLeaseCommitPort(value.session), broker: Object.freeze({ ...methods, stage: () => thenable }) })).commit(), rejects('input_invalid'));
    assert.equal(thenReads, 0);
    assert.throws(() => createPatientInsightAtomicLease(Object.freeze({ port: value.port, broker: Object.freeze({ ...methods, stage: async () => Object.freeze(Object.create(null)) }) })), rejects('input_invalid'));
    let traps = 0;
    const proxy = new Proxy(value.broker, { ownKeys() { traps += 1; throw new Error('trap'); }, get() { traps += 1; throw new Error('trap'); } });
    assert.throws(() => createPatientInsightAtomicLease(Object.freeze({ port: value.port, broker: proxy })), rejects('input_invalid'));
    assert.equal(traps, 0);
});

test('keeps owner, session, route, provider, persistence, write, and apply authority outside production', () => {
    const source = readFileSync(new URL('./patient-insight-atomic-lease.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /ServerSessionProjectionOwner|ServerSession|withLeaseCriticalSection|server-session\.ts/u);
    assert.doesNotMatch(source, /route|provider|database|persist|write|apply/iu);
    assert.match(source, /PatientInsightLeaseCommitPort/u);
    assert.match(source, /\.stage\(|\.publish\(|\.abort\(/u);
});
