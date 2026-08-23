/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createServerSessionProjectionOwnerRegistry,
    ServerSessionProjectionOwnerError,
} from './server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession, getSession, type ServerSession } from './server-session.ts';
import { ProjectionBrokerError } from '../typed-projection-broker.ts';

const USER = {
    id: ['synthetic', 'user'].join('-'),
    username: ['synthetic', 'clinician'].join('-'),
    role: 'clinician',
};
const PAIR = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };

afterEach(() => clearAllSessions());

function session(channel: ServerSession['authChannel'] = 'web') {
    return createSession(USER, channel);
}

function rejects(code: string) {
    return (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === code;
}

test('acquire creates one owner and reuses its identity for the canonical session', () => {
    let constructions = 0;
    const registry = createServerSessionProjectionOwnerRegistry({ entropy: () => {
        constructions += 1; return new Uint8Array(16);
    } });
    const value = session();
    const first = registry.acquire(value);
    const second = registry.acquire(value);

    assert.equal(first, second);
    assert.equal(registry.lookup(value.id), first);
    assert.equal(constructions, 1);
});

test('acquire rejects synchronous source reentrancy with one fixed error', () => {
    let reenter = true; const value = session();
    const registry = createServerSessionProjectionOwnerRegistry({ entropy: () => {
        if (reenter) { reenter = false; assert.throws(() => registry.acquire(value), rejects('owner_acquiring')); }
        return new Uint8Array(16);
    } });

    assert.equal(registry.acquire(value), registry.lookup(value.id));
});

test('registry isolates sessions, rejects duplicate owners, and fresh lookup stays unavailable', () => {
    const registry = createServerSessionProjectionOwnerRegistry();
    const first = session();
    const second = session();
    const firstOwner = registry.acquire(first);
    const secondOwner = registry.acquire(second);

    assert.equal(registry.lookup(first.id), firstOwner);
    assert.equal(registry.lookup(second.id), secondOwner);
    assert.notEqual(firstOwner, secondOwner);
    assert.throws(() => registry.create(first), rejects('owner_exists'));
    deleteSession(first.id);
    secondOwner.dispose();
    assert.equal(createServerSessionProjectionOwnerRegistry().lookup(first.id), null);
});

test('strict create and acquire share one winner without a lookup-create sequence', () => {
    const createFirst = createServerSessionProjectionOwnerRegistry(); const firstSession = session();
    const created = createFirst.create(firstSession);
    assert.equal(createFirst.acquire(firstSession), created);

    const acquireFirst = createServerSessionProjectionOwnerRegistry(); const secondSession = session();
    acquireFirst.acquire(secondSession);
    assert.throws(() => acquireFirst.create(secondSession), rejects('owner_exists'));
});

test('delete, expiry, reset, and explicit disposal are terminal and idempotent', () => {
    const scenarios = [
        (value: ServerSession) => deleteSession(value.id),
        (value: ServerSession) => { value.expiresAt = 0; assert.equal(getSession(value.id), null); },
        () => clearAllSessions(),
        (_value: ServerSession, owner: { dispose(): void }) => owner.dispose(),
    ];

    for (const terminate of scenarios) {
        let sequence = 0; const events: string[] = [];
        const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair,
            entropy: () => Uint8Array.from({ length: 16 }, (_, index) => sequence += index + 1),
            brokerFactory: () => ({ ingest: Object.freeze({ ingest() { return 'unused'; } }),
                service: Object.freeze({ consume() { return {}; } }), control: Object.freeze({ lock() {},
                    changeSelection() {}, revoke() { events.push('revoked'); } }) }) as never });
        const value = session();
        const owner = registry.create(value);
        const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        const ingest = owner.acquireProjectionIngest(value, { sessionRef: lease.sessionRef,
            selectionEpoch: lease.selectionEpoch, patientRef: lease.patientRef,
            ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef });

        terminate(value, owner);
        owner.dispose();
        owner.dispose();

        assert.equal(registry.lookup(value.id), null);
        assert.deepEqual(events, ['revoked']);
        assert.throws(() => ingest.ingest({} as never),
            (error) => error instanceof ProjectionBrokerError && error.code === 'broker_revoked');
    }
});

test('native, system, and local-api identities cannot create an owner', () => {
    const registry = createServerSessionProjectionOwnerRegistry();
    const web = session();

    for (const value of [session('native'), session('system'), { ...web, id: 'local-api' }]) {
        assert.throws(() => registry.create(value), rejects('session_ineligible'));
        assert.throws(() => registry.acquire(value), rejects('session_ineligible'));
    }
    const owner = registry.acquire(web);
    assert.throws(() => registry.acquire({ ...web }), rejects('session_ineligible'));
    web.expiresAt = 0; assert.equal(getSession(web.id), null);
    assert.throws(() => registry.acquire(web), rejects('session_ineligible'));
    assert.equal(registry.lookup(web.id), null);
    assert.ok(owner);
});

test('reacquire preserves an existing selection without resolver or broker side effects', () => {
    let resolves = 0; let brokers = 0;
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => { resolves += 1; return pair; },
        brokerFactory: () => { brokers += 1; throw new Error('synthetic broker must remain unused'); } });
    const value = session(); const owner = registry.acquire(value);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });

    assert.equal(registry.acquire(value), owner);
    assert.equal(owner.dereferenceSelection(value, { sessionRef: lease.sessionRef, selectionEpoch: lease.selectionEpoch,
        patientRef: lease.patientRef, ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef }).patientId, PAIR.patientId);
    assert.deepEqual({ resolves, brokers, epoch: lease.selectionEpoch }, { resolves: 1, brokers: 0, epoch: 1 });
});

test('snapshots the owner-held epoch without acquisition, references, expiry changes, or conflict disclosure', () => {
    let resolves = 0; let brokers = 0;
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => { resolves += 1; return pair; },
        brokerFactory: () => { brokers += 1; throw new Error('synthetic broker must remain unused'); } });
    const value = session(); value.expiresAt = Date.now() + 1_000; const freshExpiry = value.expiresAt;

    assert.equal(registry.snapshotSelectionEpoch(value), 0);
    assert.equal(registry.lookup(value.id), null);
    assert.equal(value.expiresAt, freshExpiry);
    const owner = registry.acquire(value);
    assert.equal(registry.snapshotSelectionEpoch(value), 0);
    const winner = owner.issueSelection({ expectedEpoch: 0, ...PAIR }); const issuedExpiry = value.expiresAt;
    assert.equal(registry.snapshotSelectionEpoch(value), winner.selectionEpoch);
    assert.equal(value.expiresAt, issuedExpiry);
    assert.throws(() => owner.issueSelection({ expectedEpoch: 0, ...PAIR }), rejects('epoch_conflict'));
    assert.equal(registry.snapshotSelectionEpoch(value), winner.selectionEpoch);
    assert.deepEqual({ resolves, brokers }, { resolves: 2, brokers: 0 });
    assert.throws(() => registry.snapshotSelectionEpoch({ ...value }), rejects('session_ineligible'));
});

test('runs synchronous work against the canonical live selection and denies a reentrant selection switch', () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const value = session(); const owner = registry.acquire(value);
    const first = owner.issueSelection({ expectedEpoch: 0, ...PAIR });

    assert.equal(owner.snapshotReviewContextEpoch(value), 1);
    assert.deepEqual(owner.withLeaseCriticalSection(value, (selection) => selection), PAIR);
    assert.throws(() => owner.withLeaseCriticalSection(value, () => {
        owner.issueSelection({ expectedEpoch: first.selectionEpoch, patientId: 'patient.synthetic.02', ambulatoryId: PAIR.ambulatoryId });
    }), rejects('selection_busy'));
    assert.equal(owner.snapshotReviewContextEpoch(value), 1);
});

test('fails a lease critical section closed after expiry, session revocation, or disposal', () => {
    let now = Date.now();
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair, clock: () => now });
    const value = session();
    const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });

    now = value.expiresAt + 1;
    assert.throws(() => owner.withLeaseCriticalSection(value, () => 'unused'), rejects('lease_expired'));
    assert.equal(owner.snapshotReviewContextEpoch(value), 2);
    owner.dispose();
    assert.throws(() => owner.withLeaseCriticalSection(value, () => 'unused'), rejects('session_unavailable'));

    now = Date.now();
    const revoked = session(); const second = registry.acquire(revoked);
    second.issueSelection({ expectedEpoch: 0, ...PAIR });
    assert.throws(() => second.withLeaseCriticalSection(revoked, () => { deleteSession(revoked.id); }), rejects('session_unavailable'));
});

test('lease critical sections reject reentry and asynchronous results without leaving the owner busy', () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const value = session(); const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });

    assert.equal(owner.withLeaseCriticalSection(value, () => {
        assert.throws(() => owner.withLeaseCriticalSection(value, () => 'nested'), rejects('selection_busy'));
        return 'outer';
    }), 'outer');
    assert.throws(() => owner.withLeaseCriticalSection(value, () => Promise.resolve('later')), rejects('input_invalid'));
    assert.throws(() => owner.withLeaseCriticalSection(value, () => ({ get then() { throw new Error('synthetic hook'); } })),
        rejects('input_invalid'));
    assert.equal(owner.withLeaseCriticalSection(value, () => 'available'), 'available');
});

test('lease critical sections reject direct selection reentry before canonical state or sources change', () => {
    let resolves = 0; let entropy = 0;
    const registry = createServerSessionProjectionOwnerRegistry({
        resolve: (_session, pair) => { resolves += 1; return pair; },
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index),
    });
    const value = session(); const owner = registry.acquire(value);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const before = Object.freeze({ selectionEpoch: owner.snapshotSelectionEpoch(value), reviewContextEpoch: owner.snapshotReviewContextEpoch(value),
        patientRef: lease.patientRef, ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef, resolves, entropy });

    assert.equal(owner.withLeaseCriticalSection(value, () => {
        assert.throws(() => owner.issueSelection({ expectedEpoch: lease.selectionEpoch, patientId: 'patient.synthetic.02', ambulatoryId: PAIR.ambulatoryId }),
            rejects('selection_busy'));
        return 'held';
    }), 'held');
    assert.deepEqual({ selectionEpoch: owner.snapshotSelectionEpoch(value), reviewContextEpoch: owner.snapshotReviewContextEpoch(value),
        patientRef: lease.patientRef, ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef, resolves, entropy }, before);
});

test('lease critical sections retain canonical state through hostile then getter inspection', () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const value = session(); const owner = registry.acquire(value);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const before = Object.freeze({ selectionEpoch: owner.snapshotSelectionEpoch(value), reviewContextEpoch: owner.snapshotReviewContextEpoch(value),
        patientRef: lease.patientRef, ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef });
    let inspections = 0;
    const hostile = Object.defineProperty({}, 'then', { get() {
        inspections += 1;
        assert.throws(() => owner.issueSelection({ expectedEpoch: lease.selectionEpoch, patientId: 'patient.synthetic.02', ambulatoryId: PAIR.ambulatoryId }),
            rejects('selection_busy'));
        return undefined;
    } });

    assert.equal(owner.withLeaseCriticalSection(value, () => hostile), hostile);
    assert.equal(inspections, 1);
    assert.deepEqual({ selectionEpoch: owner.snapshotSelectionEpoch(value), reviewContextEpoch: owner.snapshotReviewContextEpoch(value),
        patientRef: lease.patientRef, ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef }, before);
});

test('lease critical sections propagate callback failure and recheck expiry after synchronous work', () => {
    let now = Date.now();
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair, clock: () => now });
    const value = session();
    const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const expected = new Error('synthetic callback failure');

    assert.throws(() => owner.withLeaseCriticalSection(value, () => { throw expected; }), (error) => error === expected);
    assert.throws(() => owner.withLeaseCriticalSection(value, () => { now = value.expiresAt + 1; return 'late'; }), rejects('lease_expired'));
    assert.equal(owner.snapshotReviewContextEpoch(value), 2);
});

test('authenticated owner context acquires once and legacy owner helper only derives it', () => {
    const ownerSource = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    const authSource = readFileSync(new URL('./server-auth.ts', import.meta.url), 'utf8');
    const productionSource = `${ownerSource}\n${authSource}`;

    assert.match(
        authSource,
        /acquireAuthenticatedWebSessionProjectionOwnerContext[\s\S]*const session = await requireSession\(\);[\s\S]*serverSessionProjectionOwnerRegistry\.acquire\(session\)[\s\S]*Object\.freeze\(\{ session, owner \}\)/u,
    );
    assert.match(authSource, /acquireAuthenticatedWebSessionProjectionOwner\(\)[\s\S]*acquireAuthenticatedWebSessionProjectionOwnerContext\(\)[\s\S]*\?\.owner/u);
    assert.doesNotMatch(authSource, /createAuthenticatedWebSessionProjectionOwner|serverSessionProjectionOwnerRegistry\.lookup\(/u);
    assert.doesNotMatch(
        productionSource,
        /from ['"][^'"]*(?:provider|apply|patient-smart-import)[^'"]*['"]/u,
    );
});
