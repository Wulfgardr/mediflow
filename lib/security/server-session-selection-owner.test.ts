/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createServerSessionProjectionOwnerRegistry,
    ServerSessionProjectionOwnerError,
} from './server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession, getSession } from './server-session.ts';

const USER = { id: ['synthetic', 'selection-user'].join('-'), username: ['synthetic', 'selection-admin'].join('-'), role: 'admin' };
const PAIR = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };

afterEach(() => clearAllSessions());

function rejects(code: string) {
    return (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === code;
}

function setup(onResolve: () => void = () => undefined) {
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

test('web channel overrides role strings and issues epoch 0 to 1 with opaque host refs', (context) => {
    let sessionNow = 10_000;
    context.mock.method(Date, 'now', () => sessionNow);
    const { registry, session, owner } = setup(() => { sessionNow += 1_000; });
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

test('same-pair reselection rotates refs and revokes an existing synthetic binding once', (context) => {
    context.mock.method(Date, 'now', () => 10_000);
    const { session, owner } = setup();
    const first = issue(owner);
    const events: string[] = [];
    owner.install({
        leaseRef: first.leaseRef,
        selectionEpoch: first.selectionEpoch,
        control: { lock() {}, changeSelection() {}, revoke() { events.push('revoked'); } },
    });

    const second = issue(owner, 1);
    assert.equal(second.sessionRef, first.sessionRef);
    assert.equal(second.selectionEpoch, 2);
    assert.notEqual(second.patientRef, first.patientRef);
    assert.notEqual(second.ambulatoryRef, first.ambulatoryRef);
    assert.notEqual(second.leaseRef, first.leaseRef);
    assert.deepEqual(events, ['revoked']);
    assert.deepEqual(owner.dereferenceSelection(session, tuple(second)), PAIR);
    owner.dispose();
    assert.deepEqual(events, ['revoked']);
});

test('session sliding does not renew the immutable half-open lease', (context) => {
    let sessionNow = 10_000;
    context.mock.method(Date, 'now', () => sessionNow);
    const { session, owner, setNow } = setup();
    const lease = issue(owner);
    const firstExpiry = lease.expiresAt;

    sessionNow += 1_000;
    assert.equal(getSession(session.id), session);
    assert.ok(session.expiresAt > firstExpiry);
    setNow(firstExpiry - 1);
    assert.deepEqual(owner.dereferenceSelection(session, tuple(lease)), PAIR);
    assert.deepEqual(owner.dereferenceSelection(session, tuple(lease)), PAIR);
    setNow(firstExpiry);
    assert.throws(() => owner.dereferenceSelection(session, tuple(lease)), rejects('lease_expired'));
    assert.throws(() => owner.dereferenceSelection(session, tuple(lease)), rejects('stale_selection'));
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
