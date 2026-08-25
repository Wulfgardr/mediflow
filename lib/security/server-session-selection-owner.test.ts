/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createServerSessionProjectionOwnerRegistry,
    ServerSessionProjectionOwnerError,
} from './server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession, getSession } from './server-session.ts';
import { createTypedProjectionBroker, ProjectionBrokerError, type TypedProjectionBrokerConfig } from '../typed-projection-broker.ts';

const USER = { id: ['synthetic', 'selection-user'].join('-'), username: ['synthetic', 'selection-admin'].join('-'), role: 'admin' };
const PAIR = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };

afterEach(() => clearAllSessions());

function rejects(code: string) {
    return (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === code;
}

function setup(onResolve: () => void = () => undefined, overrides: Parameters<typeof createServerSessionProjectionOwnerRegistry>[0] = {}) {
    let now = 1_000;
    let sequence = 0;
    const memberships = new Set([`${PAIR.patientId}|${PAIR.ambulatoryId}`, 'patient.synthetic.01|ambulatory.synthetic.02']);
    const registry = createServerSessionProjectionOwnerRegistry({
        clock: () => now,
        entropy: () => { sequence += 1; return Uint8Array.from({ length: 16 }, (_, index) => sequence + index); },
        resolve: (_session, pair) => {
            onResolve();
            if (!memberships.has(`${pair.patientId}|${pair.ambulatoryId}`)) throw new Error('synthetic mismatch');
            return Object.freeze({ ...pair });
        },
        ...overrides,
    });
    const session = createSession(USER);
    const owner = registry.create(session);
    return { registry, session, owner, setNow: (value: number) => { now = value; } };
}

function issue(owner: ReturnType<typeof setup>['owner'], expectedEpoch = 0) {
    return owner.issueSelection({ expectedEpoch, ...PAIR });
}

function tuple(lease: ReturnType<typeof issue>) {
    return { sessionRef: lease.sessionRef, selectionEpoch: lease.selectionEpoch, patientRef: lease.patientRef,
        ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef };
}

function projection(lease: ReturnType<typeof issue>) {
    return { schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import', patientRef: lease.patientRef,
        selectionEpoch: lease.selectionEpoch, patientRevision: 1, sourceRevision: 1, capturedAt: new Date(Date.now()).toISOString(),
        currentDiagnoses: [], currentActiveTherapies: [], therapyCandidateHints: [], sources: [{ id: 'source.synthetic.0001',
            kind: 'clinical-entry', label: 'Fonte sintetica', date: null, content: 'Contenuto sintetico.' }] } as const;
}

test('web channel overrides role strings and issues epoch 0 to 1 with opaque host refs', () => {
    const { registry, session, owner } = setup();
    session.expiresAt -= 1_000;
    const initialExpiry = session.expiresAt;
    const lease = issue(owner);

    assert.equal(lease.selectionEpoch, 1);
    assert.equal(lease.expiresAt, session.expiresAt);
    assert.ok(lease.expiresAt > initialExpiry);
    for (const ref of [lease.sessionRef, lease.patientRef, lease.ambulatoryRef, lease.leaseRef]) {
        assert.match(ref, /^[a-z]{3}_[0-9a-f]{32}$/u);
        assert.equal(ref.includes(PAIR.patientId), false);
        assert.equal(ref.includes(PAIR.ambulatoryId), false);
    }
    const native = createSession({ ...USER, role: 'doctor' }, 'native');
    assert.throws(() => registry.create(native), rejects('session_ineligible'));

});

test('exact M2M mismatch and stale expected epoch preserve the published selection', (context) => {
    context.mock.method(Date, 'now', () => 10_000);
    const { session, owner } = setup();
    const first = issue(owner);

    assert.throws(() => owner.issueSelection({
        expectedEpoch: 1,
        patientId: 'patient.synthetic.02',
        ambulatoryId: PAIR.ambulatoryId,
    }), rejects('selection_unavailable'));
    assert.throws(() => issue(owner, 0), rejects('epoch_conflict'));
    assert.deepEqual(owner.dereferenceSelection(session, tuple(first)), PAIR);
});

test('projection broker is lookup-only until one lazy ingest acquisition', (context) => {
    context.mock.method(Date, 'now', () => 10_000);
    const configs: TypedProjectionBrokerConfig[] = [];
    let reenter = () => undefined;
    const { session, owner } = setup(undefined, { brokerFactory: (config) => {
        configs.push(config); reenter(); return createTypedProjectionBroker(config);
    } });
    const lease = issue(owner);
    reenter = () => { assert.throws(() => owner.acquireProjectionIngest(session, tuple(lease)), rejects('broker_unavailable')); };

    assert.deepEqual(Object.keys(owner), ['snapshotSelectionEpoch', 'snapshotReviewContextEpoch', 'acquireProjectionIngest', 'resolveProjectionService', 'issueSelection', 'dereferenceSelection', 'withLeaseCriticalSection', 'dispose']);
    assert.throws(() => owner.resolveProjectionService(session), rejects('broker_unavailable'));
    const foreign = createSession(USER);
    assert.throws(() => owner.acquireProjectionIngest(foreign, { ...tuple(lease), patientRef: 'forged.reference.0001' }),
        rejects('session_unavailable'));
    assert.throws(() => owner.acquireProjectionIngest(session, { ...tuple(lease), patientRef: 'forged.reference.0001' }),
        rejects('stale_selection'));
    assert.throws(() => owner.acquireProjectionIngest(session, { ...tuple(lease), extra: true } as never), rejects('input_invalid'));
    assert.throws(() => owner.acquireProjectionIngest(session, { sessionRef: lease.sessionRef } as never), rejects('input_invalid'));
    assert.equal(configs.length, 0);
    const ingest = owner.acquireProjectionIngest(session, tuple(lease));
    assert.equal(Object.isFrozen(ingest), true);
    assert.equal(owner.acquireProjectionIngest(session, tuple(lease)), ingest);
    assert.equal(Object.isFrozen(owner.resolveProjectionService(session)), true);
    assert.deepEqual(configs, [{ ...tuple(lease), expiresAt: new Date(lease.expiresAt).toISOString() }]);
});

test('session brokers isolate handles without consuming the owning record', (context) => {
    context.mock.method(Date, 'now', () => 10_000);
    const { registry, session: firstSession, owner: firstOwner } = setup(undefined, { brokerFactory: (config) =>
        createTypedProjectionBroker(config, { clock: () => new Date(Date.now()).toISOString(), entropy: () => new Uint8Array(16) }) });
    const secondSession = createSession(USER); const secondOwner = registry.create(secondSession);
    const first = issue(firstOwner); const second = issue(secondOwner);
    const firstHandle = firstOwner.acquireProjectionIngest(firstSession, tuple(first)).ingest({
        projection: projection(first), requestId: 'request.synthetic.0001' });
    secondOwner.acquireProjectionIngest(secondSession, tuple(second));
    assert.throws(() => secondOwner.resolveProjectionService(secondSession).consume({ handle: firstHandle,
        capability: 'smart_import', requestId: 'request.synthetic.0002' }),
    (error) => error instanceof ProjectionBrokerError && error.code === 'handle_missing');
    assert.equal(firstOwner.resolveProjectionService(firstSession).consume({ handle: firstHandle,
        capability: 'smart_import', requestId: 'request.synthetic.0003' }).patientRef, first.patientRef);
});

test('factory failures and post-factory reselection never publish a candidate', (context) => {
    context.mock.method(Date, 'now', () => 10_000);
    let attempts = 0; let revocations = 0; let next: ReturnType<typeof issue>;
    const state = setup(undefined, { brokerFactory: (config) => {
        attempts += 1; if (attempts === 1) throw new Error('synthetic factory failure');
        if (attempts === 2) return { control: { revoke() { revocations += 1; } } } as never;
        const broker = createTypedProjectionBroker(config);
        if (attempts === 3) { next = issue(owner, 1); return { ...broker, control: { ...broker.control,
            revoke() { revocations += 1; broker.control.revoke(); } } }; }
        return broker;
    } });
    const owner = state.owner; const first = issue(owner);
    assert.throws(() => owner.acquireProjectionIngest(state.session, tuple(first)), rejects('broker_factory_failed'));
    assert.throws(() => owner.acquireProjectionIngest(state.session, tuple(first)), rejects('broker_factory_failed'));
    assert.throws(() => owner.acquireProjectionIngest(state.session, tuple(first)), rejects('stale_selection'));
    assert.deepEqual({ attempts, revocations }, { attempts: 3, revocations: 2 });
    assert.throws(() => owner.resolveProjectionService(state.session), rejects('broker_unavailable'));
    assert.ok(owner.acquireProjectionIngest(state.session, tuple(next!)));
});

test('same-pair reselection rotates refs, revokes once, and leaves the next lease lazy', (context) => {
    context.mock.method(Date, 'now', () => 10_000);
    const events: string[] = [];
    const { session, owner } = setup(undefined, { brokerFactory: (config) => {
        const broker = createTypedProjectionBroker(config);
        return { ...broker, control: { ...broker.control, revoke() { events.push('revoked'); broker.control.revoke(); } } };
    } });
    const first = issue(owner);
    const oldIngest = owner.acquireProjectionIngest(session, tuple(first));
    const oldService = owner.resolveProjectionService(session);

    const second = issue(owner, 1);
    assert.equal(second.sessionRef, first.sessionRef);
    assert.equal(second.selectionEpoch, 2);
    assert.notEqual(second.patientRef, first.patientRef);
    assert.notEqual(second.ambulatoryRef, first.ambulatoryRef);
    assert.notEqual(second.leaseRef, first.leaseRef);
    assert.deepEqual(events, ['revoked']);
    assert.throws(() => oldIngest.ingest({} as never), (error) => error instanceof ProjectionBrokerError && error.code === 'broker_revoked');
    assert.throws(() => oldService.consume({} as never), (error) => error instanceof ProjectionBrokerError && error.code === 'broker_revoked');
    assert.throws(() => owner.resolveProjectionService(session), rejects('broker_unavailable'));
    assert.deepEqual(owner.dereferenceSelection(session, tuple(second)), PAIR);
    owner.dispose();
    assert.deepEqual(events, ['revoked']);
});

test('acquire precedence is session, tuple, then the exact lease boundary', (context) => {
    context.mock.method(Date, 'now', () => 10_000);
    let calls = 0;
    const { session, owner, setNow } = setup(undefined, { brokerFactory: (config) => { calls += 1; return createTypedProjectionBroker(config); } });
    const lease = issue(owner); const stale = { ...tuple(lease), leaseRef: 'forged.reference.0001' };
    setNow(lease.expiresAt);
    assert.throws(() => owner.acquireProjectionIngest(createSession(USER), stale), rejects('session_unavailable'));
    assert.throws(() => owner.acquireProjectionIngest(session, stale), rejects('stale_selection'));
    assert.throws(() => owner.acquireProjectionIngest(session, tuple(lease)), rejects('lease_expired'));
    assert.equal(calls, 0);
});

test('session sliding does not renew the immutable half-open lease', () => {
    const { session, owner, setNow } = setup();
    const lease = issue(owner);
    const leaseExpiry = lease.expiresAt;
    const firstExpiry = leaseExpiry - 1_000;

    session.expiresAt = firstExpiry;
    assert.equal(getSession(session.id), session);
    assert.ok(session.expiresAt > firstExpiry);
    setNow(leaseExpiry - 1);
    assert.deepEqual(owner.dereferenceSelection(session, tuple(lease)), PAIR);
    assert.deepEqual(owner.dereferenceSelection(session, tuple(lease)), PAIR);
    setNow(leaseExpiry);
    assert.throws(() => owner.dereferenceSelection(session, tuple(lease)), rejects('lease_expired'));
    assert.throws(() => owner.dereferenceSelection(session, tuple(lease)), rejects('stale_selection'));
    session.expiresAt = leaseExpiry + 1_000;
    setNow(leaseExpiry - 1);
    const replacement = issue(owner, 1);
    assert.equal(replacement.selectionEpoch, 2);
    assert.equal(replacement.sessionRef, lease.sessionRef);
});

test('current tuple is reusable while mismatches, replacement, disposal, and restart fail closed', (context) => {
    context.mock.method(Date, 'now', () => 10_000);
    const { registry, session, owner } = setup();
    const lease = issue(owner);
    const otherSession = createSession(USER);
    assert.throws(() => owner.dereferenceSelection(otherSession, tuple(lease)), rejects('session_unavailable'));

    const validTuple = tuple(lease);
    for (const key of ['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef'] as const) {
        const wrong = { ...validTuple, [key]: key === 'selectionEpoch' ? 99 : `${key}_wrong` };
        assert.throws(() => owner.dereferenceSelection(session, wrong), rejects('stale_selection'));
    }
    assert.deepEqual(owner.dereferenceSelection(session, validTuple), PAIR);
    assert.deepEqual(owner.dereferenceSelection(session, validTuple), PAIR);

    const fresh = createServerSessionProjectionOwnerRegistry();
    assert.equal(fresh.lookup(session.id), null);
    const next = issue(owner, 1);
    assert.throws(() => owner.dereferenceSelection(session, validTuple), rejects('stale_selection'));
    deleteSession(session.id);
    assert.throws(() => owner.dereferenceSelection(session, tuple(next)), rejects('session_unavailable'));
    assert.equal(registry.lookup(session.id), null);
});

test('selection scope has no broker creation, preview, provider, apply, or freshness-consume wiring', () => {
    const source = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    const production = readFileSync(new URL('./server-session-projection-owner-production.ts', import.meta.url), 'utf8');
    const selection = source.slice(source.indexOf('issueSelection(input)'), source.indexOf('dereferenceSelection'));

    assert.doesNotMatch(selection, /createTypedProjectionBroker|bindProjectionBrokerToServerSession|\.install\s*\(/u);
    assert.doesNotMatch(production, /createTypedProjectionBroker|preview|provider|patient-smart-import|apply|handle|fresh/u);
});
