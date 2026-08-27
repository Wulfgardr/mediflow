/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebAuthControlRecord } from './web-auth-control-record.ts';

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
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));
    let thrown: unknown;
    let begin: unknown; let completed: unknown; let disposed: unknown; let lock: unknown; let constructed: ReturnType<typeof createWebAuthControlRecord> | undefined;
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
    assert.deepEqual(constructed?.snapshot(), { fence: 'c0', generation: BigInt(0), pending: false, active: false });
    assert.deepEqual(auth.snapshot(), { fence: 'f2', generation: BigInt(2), pending: false, active: false });
    assert.deepEqual(locked.snapshot(), { fence: 'f1', generation: BigInt(1), pending: false, active: false });
    assert.equal(Object.isFrozen(completed), true);
    assert.equal(Object.isFrozen(lock), true);
    assert.equal(auth.begin('login', 'retry', 'retry-key', 'retry-fp', 3).ok, true, 'the completed disposal leaves a valid retry state');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
});
