/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
    commitAuthControlTicket,
    createWebAuthControlRecord,
    retireAuthControlTicket,
} from './web-auth-control-record.ts';

const MAX = BigInt('18446744073709551615');
function control(fence = 'f0', generation = BigInt(0)) {
    let next = 0;
    const issued = () => `f${++next}`;
    return { record: createWebAuthControlRecord(fence, generation), issued };
}

test('holds one pending, commits an exact auth CAS, and permits only one active Web binding', () => {
    const { record } = control();
    assert.equal(record.begin('login', 'op-1', 'key-1', 'fp-1', 0).ok, true);
    assert.equal(record.begin('setup', 'op-2', 'key-2', 'fp-2', 1).ok, false);
    const pending = record.snapshot();
    const auth = record.finalizeAuth('f0', 'op-1', pending.generation, 'fp-1', 'web-1', 'f1', 2);
    assert.deepEqual(auth, { ok: true, fence: 'f1', generation: BigInt(1) });
    assert.equal(record.begin('login', 'op-2', 'key-2', 'fp-2', 3).ok, false);
    assert.equal(record.finalizeAuth('f0', 'op-1', BigInt(0), 'fp-1', 'web-2', 'f2', 3).ok, false);
    assert.deepEqual(record.disposeBoundSession('f1', 'web-1', 'f2', 4), { ok: true, fence: 'f2', generation: BigInt(2) });
});

test('lock preempts pending, binds its successor fence, and detaches only once on exact replay', () => {
    const { record, issued } = control();
    record.begin('setup', 'op', 'key', 'fp', 0);
    assert.deepEqual(record.advanceLock('f0', 'lock', 'lock-fp', issued(), 1), { ok: true, fence: 'f1', generation: BigInt(1), detachedSessionId: null });
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f2', 2).ok, false);
    assert.deepEqual(record.advanceLock('f0', 'lock', 'lock-fp', 'f1', 3), { ok: true, fence: 'f1', generation: BigInt(1), detachedSessionId: null });
    assert.equal(record.advanceLock('f0', 'lock', 'lock-fp', 'f2', 3).ok, false, 'replay needs the exact successor fence');
    assert.deepEqual(record.finalizeLock('f0', 'lock', 'lock-fp', 4), { ok: true, fence: 'f1', generation: BigInt(1), receipt: 'confirmed' });
    assert.deepEqual(record.finalizeLock('f0', 'lock', 'lock-fp', 5), { ok: true, fence: 'f1', generation: BigInt(1), receipt: 'confirmed' });
});

test('auth first makes a stale lock unconfirmed until its successor fence', () => {
    const { record } = control();
    record.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f1', 1).ok, true);
    assert.equal(record.advanceLock('f0', 'lock', 'fp-lock', 'f2', 2).ok, false);
    assert.equal(record.finalizeLock('f0', 'lock', 'fp-lock', 2).ok, false);
    assert.equal(record.advanceLock('f1', 'lock', 'fp-lock', 'f2', 3).ok, true);
});

test('expires pending monotonically and retains idempotency tombstones at capacity', () => {
    const { record } = control();
    record.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f1', 120_000).ok, false);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f1', 0).ok, false, 'clock rollback cannot revive a pending operation');
    assert.deepEqual(record.begin('login', 'op', 'key', 'fp', 120_000), { ok: true, fence: 'f0', generation: BigInt(0) }, 'the exact pending-TTL replay remains available before replay TTL');
    let fence = 'f0';
    for (let index = 0; index < 63; index += 1) {
        const result = record.advanceLock(fence, `key-${index}`, `fp-${index}`, `f${index + 1}`, 120_001 + index);
        assert.equal(result.ok, true);
        if (result.ok) fence = result.fence;
    }
    assert.equal(record.advanceLock(fence, 'key-63', 'fp-63', 'f64', 500_001).ok, false);
    assert.equal(record.advanceLock('f0', 'key-0', 'changed', 'f1', 500_001).ok, false);
    assert.equal(record.advanceLock('f0', 'key-0', 'fp-0', 'f1', 500_001).ok, false);
});

test('rejects hostile successor objects without observing them or changing state', async (t) => {
    let observed = false;
    const accessor = {}; Object.defineProperty(accessor, 'then', { get: () => { observed = true; throw new Error('read'); } });
    const hidden = {}; Object.defineProperty(hidden, 'value', { value: 'x', enumerable: false });
    const proxy = new Proxy({}, { get: () => { observed = true; throw new Error('get trap'); }, ownKeys: () => { observed = true; throw new Error('ownKeys trap'); } });
    const rejected = Promise.reject(new Error('rejected successor')); rejected.catch(() => undefined);
    const hostile = [Promise.resolve('f1'), rejected, { then: () => { observed = true; } }, accessor, hidden, proxy, {}, Symbol('x')];
    const lock = control().record;
    const auth = control().record;
    assert.equal(auth.begin('login', 'op', 'key', 'fp', 0).ok, true);
    const bound = control().record;
    assert.equal(bound.begin('login', 'op', 'key', 'fp', 0).ok, true);
    assert.equal(bound.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 'f1', 1).ok, true);
    const mutations = [
        { record: lock, apply: (value: unknown) => lock.advanceLock('f0', 'key', 'fp', value, 1) },
        { record: auth, apply: (value: unknown) => auth.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', value, 1) },
        { record: bound, apply: (value: unknown) => bound.disposeBoundSession('f1', 'web', value, 2) },
    ];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));
    for (const value of hostile) {
        for (const mutation of mutations) {
            const before = mutation.record.snapshot();
            assert.equal(mutation.apply(value).ok, false);
            assert.deepEqual(mutation.record.snapshot(), before);
        }
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, false);
    assert.deepEqual(unhandled, []);
});

test('denies ABA fences, collisions, and wraps without advancing generation', () => {
    const { record } = control();
    assert.equal(record.advanceLock('f0', 'key', 'fp', 'f0', 0).ok, false, 'successor collision is fail closed');
    assert.equal(record.advanceLock('f0', 'key', 'fp', 'f1', 0).ok, true);
    assert.equal(record.advanceLock('f0', 'key-2', 'fp', 'f0', 1).ok, false, 'used fence cannot be reused');
    const wrapped = createWebAuthControlRecord('max', MAX);
    assert.equal(wrapped.advanceLock('max', 'key', 'fp', 'next', 0).ok, false);
});

test('constructor accepts only inert primitive initial state', () => {
    let called = false;
    assert.throws(() => createWebAuthControlRecord('f0', () => { called = true; return BigInt(0); }));
    assert.equal(called, false);
});

test('keeps P2a transitions atomic after post-import intrinsic poison', async (t) => {
    const zero = BigInt(0);
    const SetIntrinsic = Set;
    const MapIntrinsic = Map;
    const originals = {
        add: SetIntrinsic.prototype.add, has: SetIntrinsic.prototype.has, get: MapIntrinsic.prototype.get, mapSet: MapIntrinsic.prototype.set,
        size: Object.getOwnPropertyDescriptor(MapIntrinsic.prototype, 'size')!, freeze: Object.freeze,
        safeInteger: Number.isSafeInteger, max: Math.max, setGlobal: Object.getOwnPropertyDescriptor(globalThis, 'Set')!,
        map: Object.getOwnPropertyDescriptor(globalThis, 'Map')!, bigint: Object.getOwnPropertyDescriptor(globalThis, 'BigInt')!,
    };
    const fail = () => { throw new Error('post-import poison'); };
    const auth = control().record;
    const locked = control().record;
    const ticketRecord = control().record; ticketRecord.begin('login', 'ticket-op', 'ticket-key', 'ticket-fp', 0);
    const ticket = ticketRecord.prepareAuthControlTicket('f0', 'ticket-op', BigInt(0), 'ticket-fp', 'ticket-web', 1); assert.ok(ticket);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));
    let thrown: unknown;
    let begin: unknown; let completed: unknown; let disposed: unknown; let lock: unknown; let ticketCommit: unknown; let ticketRetire: unknown; let constructed: ReturnType<typeof createWebAuthControlRecord> | undefined;
    try {
        SetIntrinsic.prototype.add = fail as typeof SetIntrinsic.prototype.add;
        SetIntrinsic.prototype.has = fail as typeof SetIntrinsic.prototype.has;
        MapIntrinsic.prototype.get = fail as typeof MapIntrinsic.prototype.get;
        MapIntrinsic.prototype.set = fail as typeof MapIntrinsic.prototype.set;
        Object.defineProperty(MapIntrinsic.prototype, 'size', { configurable: true, get: fail });
        Object.freeze = fail as typeof Object.freeze;
        Number.isSafeInteger = fail;
        Math.max = fail;
        Object.defineProperty(globalThis, 'Set', { configurable: true, value: fail });
        Object.defineProperty(globalThis, 'Map', { configurable: true, value: fail });
        Object.defineProperty(globalThis, 'BigInt', { configurable: true, value: fail });
        try {
            constructed = createWebAuthControlRecord('c0');
            begin = auth.begin('login', 'op', 'key', 'fp', 0);
            completed = auth.finalizeAuth('f0', 'op', zero, 'fp', 'web', 'f1', 1);
            disposed = auth.disposeBoundSession('f1', 'web', 'f2', 2);
            lock = locked.advanceLock('f0', 'lock', 'lock-fp', 'f1', 0);
            ticketCommit = commitAuthControlTicket(ticket); ticketRetire = retireAuthControlTicket(ticket, 'lock');
        } catch (error) { thrown = error; }
    } finally {
        SetIntrinsic.prototype.add = originals.add;
        SetIntrinsic.prototype.has = originals.has;
        MapIntrinsic.prototype.get = originals.get;
        MapIntrinsic.prototype.set = originals.mapSet;
        Object.defineProperty(MapIntrinsic.prototype, 'size', originals.size);
        Object.freeze = originals.freeze;
        Number.isSafeInteger = originals.safeInteger;
        Math.max = originals.max;
        Object.defineProperty(globalThis, 'Set', originals.setGlobal);
        Object.defineProperty(globalThis, 'Map', originals.map);
        Object.defineProperty(globalThis, 'BigInt', originals.bigint);
    }
    assert.equal(thrown, undefined);
    assert.deepEqual(begin, { ok: true, fence: 'f0', generation: BigInt(0) });
    assert.deepEqual(completed, { ok: true, fence: 'f1', generation: BigInt(1) });
    assert.deepEqual(disposed, { ok: true, fence: 'f2', generation: BigInt(2) });
    assert.deepEqual(lock, { ok: true, fence: 'f1', generation: BigInt(1), detachedSessionId: null });
    assert.equal(ticketCommit, true); assert.equal(ticketRetire, 1);
    assert.deepEqual(constructed?.snapshot(), { fence: 'c0', generation: BigInt(0), pending: false, active: false });
    assert.deepEqual(auth.snapshot(), { fence: 'f2', generation: BigInt(2), pending: false, active: false });
    assert.deepEqual(locked.snapshot(), { fence: 'f1', generation: BigInt(1), pending: false, active: false });
    assert.equal(Object.isFrozen(completed), true);
    assert.equal(Object.isFrozen(lock), true);
    assert.equal(auth.begin('login', 'retry', 'retry-key', 'retry-fp', 3).ok, true, 'the completed disposal leaves a valid retry state');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
});

test('commits one opaque ticket for the exact pending control and session binding', () => {
    const first = control().record;
    const other = control('other').record;
    assert.equal(first.begin('login', 'op', 'key', 'fp', 0).ok, true);
    assert.equal(other.begin('login', 'op', 'key', 'fp', 0).ok, true);

    const ticket = first.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web-1', 1);
    assert.ok(ticket);
    assert.equal(Object.getPrototypeOf(ticket), null);
    assert.equal(Object.isFrozen(ticket), true);
    assert.deepEqual(Reflect.ownKeys(ticket), []);
    assert.equal(commitAuthControlTicket(ticket), true);
    assert.deepEqual(first.snapshot(), { fence: first.snapshot().fence, generation: BigInt(1), pending: false, active: true });
    assert.equal(commitAuthControlTicket(ticket), false, 'activation ticket is single-use');
    assert.equal(other.snapshot().active, false, 'the ticket cannot mutate another control record');
});

test('retires the exact active ticket once and exposes only same-reason replay', () => {
    const { record } = control();
    record.begin('setup', 'op', 'key', 'fp', 0);
    const ticket = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web-1', 1);
    assert.ok(ticket);
    assert.equal(retireAuthControlTicket(ticket, 'lock'), 0, 'a prepared ticket cannot retire authority');
    assert.equal(commitAuthControlTicket(ticket), true);
    const activeFence = record.snapshot().fence;
    assert.equal(retireAuthControlTicket(ticket, 'unknown'), 0);
    assert.deepEqual(record.snapshot(), { fence: activeFence, generation: BigInt(1), pending: false, active: true });
    assert.equal(retireAuthControlTicket(ticket, 'lock'), 1);
    assert.deepEqual(record.snapshot(), { fence: record.snapshot().fence, generation: BigInt(2), pending: false, active: false });
    assert.equal(retireAuthControlTicket(ticket, 'lock'), 2);
    assert.equal(retireAuthControlTicket(ticket, 'dispose'), 0);
    assert.equal(commitAuthControlTicket(ticket), false);
});

test('denies stale, expired, wrapped, restarted, and hostile tickets without observation', async (t) => {
    const stale = control().record;
    stale.begin('login', 'op', 'key', 'fp', 0);
    const staleTicket = stale.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1);
    assert.ok(staleTicket);
    assert.equal(stale.advanceLock('f0', 'lock', 'lock-fp', 'legacy-f1', 2).ok, true);
    assert.equal(commitAuthControlTicket(staleTicket), false);
    assert.equal(stale.snapshot().active, false);

    const expired = control().record; expired.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(expired.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 120_000), null);
    const nearWrap = control('near-max', MAX - BigInt(1)).record;
    nearWrap.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(nearWrap.prepareAuthControlTicket('near-max', 'op', MAX - BigInt(1), 'fp', 'web', 1), null);

    let observed = 0;
    const proxy = new Proxy({}, { get: () => { observed += 1; throw new Error('get'); }, ownKeys: () => { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get: () => { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('hostile')); rejected.catch(() => undefined);
    const hostile = [null, undefined, {}, Object.create(null), proxy, accessor, Promise.resolve(), rejected, { then() { observed += 1; } }];
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    for (let index = 0; index < hostile.length; index += 1) {
        assert.equal(commitAuthControlTicket(hostile[index]), false);
        assert.equal(retireAuthControlTicket(hostile[index], 'lock'), 0);
    }
    const live = control().record; live.begin('login', 'op', 'key', 'fp', 0);
    const ticket = live.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); assert.ok(ticket);
    const clone = Object.assign(Object.create(null), ticket);
    assert.equal(commitAuthControlTicket(clone), false);
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./web-auth-control-record.ts'); const cached = nodeRequire.cache[modulePath];
    let restarted: typeof import('./web-auth-control-record.ts') | undefined;
    try { delete nodeRequire.cache[modulePath]; restarted = nodeRequire(modulePath) as typeof import('./web-auth-control-record.ts'); assert.equal(restarted.commitAuthControlTicket(ticket), false); }
    finally { if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
    assert.equal(commitAuthControlTicket(ticket), true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0); assert.deepEqual(unhandled, []);
});

test('keeps the ticket module private to its canonical future server-session importer', () => {
    const paths = execFileSync('rg', ['-l', 'web-auth-control-record|prepareAuthControlTicket|commitAuthControlTicket|retireAuthControlTicket', '-g', '*.ts', '.'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((path) => path.replace(/^\.\//u, ''));
    assert.equal(paths.includes('lib/security/web-auth-control-record.test.ts'), true);
    assert.equal(paths.includes('lib/security/web-auth-control-record.ts'), true);
    assert.equal(paths.every((path) => path === 'lib/security/server-session.ts' || path.endsWith('web-auth-control-record.ts') || path.endsWith('web-auth-control-record.test.ts')), true);
});

test('entropy collision and same-record reentry deny before ticket publication and permit a clean retry', async () => {
    const original = crypto.randomBytes; let calls = 0; let entered = false; let nested: unknown;
    let record: ReturnType<typeof createWebAuthControlRecord> | null = null;
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./web-auth-control-record.ts'); const cached = nodeRequire.cache[modulePath];
    try {
        crypto.randomBytes = (() => {
            calls += 1;
            if (!entered && record) { entered = true; nested = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1); }
            return Buffer.alloc(32, calls <= 2 ? 7 : calls);
        }) as typeof crypto.randomBytes;
        delete nodeRequire.cache[modulePath]; const isolated = nodeRequire(modulePath) as typeof import('./web-auth-control-record.ts');
        record = isolated.createWebAuthControlRecord('f0'); record.begin('login', 'op', 'key', 'fp', 0);
        assert.equal(record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 1), null);
        assert.equal(nested, null);
        const retry = record.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', 'web', 2);
        assert.ok(retry); assert.equal(isolated.commitAuthControlTicket(retry), true); assert.equal(isolated.retireAuthControlTicket(retry, 'lock'), 1);
    } finally { crypto.randomBytes = original; if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
});
