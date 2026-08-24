/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createServerSessionProjectionOwnerRegistry,
    isServerSessionProjectionOwner,
    ServerSessionProjectionOwnerError,
    spendLeaseCommitTurn,
    withLeaseCommitTurn,
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

test('recognizes only published module owners and isolates registry identity', () => {
    const firstRegistry = createServerSessionProjectionOwnerRegistry();
    const secondRegistry = createServerSessionProjectionOwnerRegistry();
    const value = session();
    const owner = firstRegistry.acquire(value);
    const lookalike = Object.freeze({ ...owner });

    assert.equal(isServerSessionProjectionOwner(owner), true);
    assert.equal(firstRegistry.isAuthenticOwner(owner), true);
    assert.equal(secondRegistry.isAuthenticOwner(owner), false);
    assert.equal(isServerSessionProjectionOwner(lookalike), false);
    assert.equal(firstRegistry.isAuthenticOwner(lookalike), false);
    assert.equal(isServerSessionProjectionOwner(Object.create(owner)), false);
    for (const malformed of [null, undefined, false, 1, 'owner', [], {}, Object.create(null)]) {
        assert.equal(isServerSessionProjectionOwner(malformed), false);
        assert.equal(firstRegistry.isAuthenticOwner(malformed), false);
    }
    let reads = 0;
    const accessor = Object.defineProperty({}, 'dispose', { get() { reads += 1; return owner.dispose; } });
    assert.equal(isServerSessionProjectionOwner(accessor), false);
    assert.equal(firstRegistry.isAuthenticOwner(accessor), false);
    assert.equal(reads, 0);
});

test('rejects owner proxies before traps or structural reflection', () => {
    const registry = createServerSessionProjectionOwnerRegistry();
    const owner = registry.acquire(session());
    let traps = 0;
    const proxy = new Proxy(owner, {
        get() { traps += 1; throw new Error('synthetic get trap'); },
        getOwnPropertyDescriptor() { traps += 1; throw new Error('synthetic descriptor trap'); },
        getPrototypeOf() { traps += 1; throw new Error('synthetic prototype trap'); },
        has() { traps += 1; throw new Error('synthetic has trap'); },
        ownKeys() { traps += 1; throw new Error('synthetic ownKeys trap'); },
    });
    const transparentProxy = new Proxy(owner, {});

    assert.equal(isServerSessionProjectionOwner(proxy), false);
    assert.equal(registry.isAuthenticOwner(proxy), false);
    assert.equal(isServerSessionProjectionOwner(transparentProxy), false);
    assert.equal(registry.isAuthenticOwner(transparentProxy), false);
    assert.equal(traps, 0);
});

test('uses captured identity intrinsics after ambient prototype mutation', () => {
    const originalAdd = WeakSet.prototype.add;
    const originalHas = WeakSet.prototype.has;
    const originalApply = Reflect.apply;
    try {
        WeakSet.prototype.add = () => { throw new Error('synthetic ambient add'); };
        WeakSet.prototype.has = () => { throw new Error('synthetic ambient has'); };
        Reflect.apply = () => { throw new Error('synthetic ambient apply'); };
        const registry = createServerSessionProjectionOwnerRegistry();
        const owner = registry.acquire(session());
        assert.equal(isServerSessionProjectionOwner(owner), true);
        assert.equal(registry.isAuthenticOwner(owner), true);
    } finally {
        WeakSet.prototype.add = originalAdd;
        WeakSet.prototype.has = originalHas;
        Reflect.apply = originalApply;
    }
});

test('publishes authenticity only after successful construction', () => {
    const value = session();
    const registry = createServerSessionProjectionOwnerRegistry({ entropy: () => {
        deleteSession(value.id);
        return new Uint8Array(16);
    } });

    assert.throws(() => registry.acquire(value), rejects('session_ineligible'));
    assert.equal(registry.lookup(value.id), null);
    assert.equal(isServerSessionProjectionOwner(Object.freeze({})), false);
});

test('keeps disposed identity recognizable while operations remain terminal', () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const value = session();
    const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    owner.dispose();

    assert.equal(isServerSessionProjectionOwner(owner), true);
    assert.equal(registry.isAuthenticOwner(owner), true);
    assert.equal(registry.lookup(value.id), null);
    assert.throws(() => owner.withLeaseCriticalSection(value, () => 'unused'), rejects('session_unavailable'));
});

test('requires an authentic live turn for synchronous commit and abort work', () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const value = session(); const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const events: string[] = [];

    withLeaseCommitTurn(owner, value,
        (selection) => Object.freeze({ selection }),
        (prepared, turn) => {
            assert.equal(prepared.selection.patientId, PAIR.patientId);
            assert.equal(Object.getPrototypeOf(turn), null);
            assert.equal(Object.isFrozen(turn), true);
            spendLeaseCommitTurn(owner, value, turn, 'commit');
            events.push('commit');
        },
        (turn) => {
            spendLeaseCommitTurn(owner, value, turn, 'abort');
            events.push('abort');
        });

    assert.deepEqual(events, ['commit']);
});

test('aborts once on a precommit thenable without leaking native rejections', async () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const unhandled: unknown[] = []; let resurrection: unknown;
    const observe = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', observe);
    try {
        assert.throws(() => withLeaseCommitTurn(owner, value,
            () => Promise.reject(new Error('synthetic prepare rejection')),
            () => assert.fail('commit must not run'),
            (turn) => {
                spendLeaseCommitTurn(owner, value, turn, 'abort');
                queueMicrotask(() => { try { spendLeaseCommitTurn(owner, value, turn, 'abort'); } catch (error) { resurrection = error; } });
                return Promise.reject(new Error('synthetic late abort'));
            }),
        rejects('input_invalid'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(resurrection instanceof ServerSessionProjectionOwnerError && resurrection.code, 'selection_unavailable');
        assert.deepEqual(unhandled, []);
    } finally { process.off('unhandledRejection', observe); }
});

test('closes spent turns before late work and keeps a spent commit terminal', async () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let late: unknown; let later: unknown; let aborts = 0; const unhandled: unknown[] = []; const observe = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', observe);
    try {
        withLeaseCommitTurn(owner, value, () => 'prepared', (_prepared, turn) => {
            spendLeaseCommitTurn(owner, value, turn, 'commit');
            assert.throws(() => spendLeaseCommitTurn(owner, value, turn, 'commit'), rejects('selection_unavailable'));
            queueMicrotask(() => { try { spendLeaseCommitTurn(owner, value, turn, 'commit'); } catch (error) { late = error; } });
            setImmediate(() => { try { spendLeaseCommitTurn(owner, value, turn, 'commit'); } catch (error) { later = error; } });
            return Promise.reject(new Error('synthetic late commit'));
        }, () => { aborts += 1; });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(aborts, 0);
        assert.equal(late instanceof ServerSessionProjectionOwnerError && late.code, 'selection_unavailable');
        assert.equal(later instanceof ServerSessionProjectionOwnerError && later.code, 'selection_unavailable');
        assert.deepEqual(unhandled, []);

        withLeaseCommitTurn(owner, value, () => 'prepared-again', (_prepared, turn) => {
            spendLeaseCommitTurn(owner, value, turn, 'commit');
            throw new Error('synthetic post-spend throw');
        }, () => { aborts += 1; });
        assert.equal(aborts, 0);
    } finally { process.off('unhandledRejection', observe); }
});

test('denies dynamic commit and abort completions before they can spend a turn', async () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const unhandled: unknown[] = []; const observe = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', observe);
    try {
        assert.throws(() => withLeaseCommitTurn(owner, value, () => 'prepared',
            () => Promise.reject(new Error('synthetic unspent commit')),
            (turn) => spendLeaseCommitTurn(owner, value, turn, 'abort')), rejects('selection_unavailable'));
        assert.throws(() => withLeaseCommitTurn(owner, value, () => 'prepared-again',
            () => { throw Promise.reject(new Error('synthetic thrown commit')); },
            (turn) => spendLeaseCommitTurn(owner, value, turn, 'abort')), rejects('input_invalid'));
        assert.throws(() => withLeaseCommitTurn(owner, value, () => { throw new Error('synthetic prepare failure'); },
            () => assert.fail('commit must not run'), () => Promise.reject(new Error('synthetic unspent abort'))),
        rejects('selection_unavailable'));
        let thenReads = 0; const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
        try {
            Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { thenReads += 1; return undefined; } });
            assert.throws(() => withLeaseCommitTurn(owner, value, () => Object.freeze({ staged: true }),
                () => assert.fail('commit must not run'), (turn) => spendLeaseCommitTurn(owner, value, turn, 'abort')), rejects('input_invalid'));
            assert.equal(thenReads, 0);
        } finally {
            if (originalThen) Object.defineProperty(Object.prototype, 'then', originalThen);
            else delete (Object.prototype as { then?: unknown }).then;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
    } finally { process.off('unhandledRejection', observe); }
});

test('denies unspent, forged, cross-session, and late clock commit attempts before publication', () => {
    let now = Date.now();
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair, clock: () => now });
    const value = session(); const other = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    let aborts = 0; let traps = 0;
    assert.throws(() => withLeaseCommitTurn(owner, value, () => 'prepared', (_prepared, turn) => {
        assert.throws(() => spendLeaseCommitTurn(owner, other, turn, 'commit'), rejects('selection_unavailable'));
        assert.throws(() => spendLeaseCommitTurn(owner, value, new Proxy(turn, { get() { traps += 1; return undefined; } }), 'commit'), rejects('input_invalid'));
    }, (turn) => { aborts += 1; spendLeaseCommitTurn(owner, value, turn, 'abort'); }), rejects('selection_unavailable'));
    assert.deepEqual({ aborts, traps }, { aborts: 1, traps: 0 });

    const second = registry.acquire(other); second.issueSelection({ expectedEpoch: 0, ...PAIR });
    assert.throws(() => withLeaseCommitTurn(second, other, () => { now = other.expiresAt + 1; return 'late'; },
        () => assert.fail('commit must not run'), (turn) => spendLeaseCommitTurn(second, other, turn, 'abort')), rejects('lease_expired'));
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
