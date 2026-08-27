/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebAuthControlRecord } from './web-auth-control-record.ts';

const MAX = BigInt('18446744073709551615');
function control(fence = 'f0', generation = BigInt(0)) {
    let next = 0;
    const issued = () => `f${++next}`;
    return { record: createWebAuthControlRecord(fence, issued, generation), issued: () => next };
}

test('holds one pending, commits an exact auth CAS, and permits only one active Web binding', () => {
    const { record } = control();
    assert.equal(record.begin('login', 'op-1', 'key-1', 'fp-1', 0).ok, true);
    assert.equal(record.begin('setup', 'op-2', 'key-2', 'fp-2', 1).ok, false);
    const pending = record.snapshot();
    const auth = record.finalizeAuth('f0', 'op-1', pending.generation, 'fp-1', 'web-1', 2);
    assert.deepEqual(auth, { ok: true, fence: 'f1', generation: BigInt(1) });
    assert.equal(record.begin('login', 'op-2', 'key-2', 'fp-2', 3).ok, false);
    assert.equal(record.finalizeAuth('f0', 'op-1', BigInt(0), 'fp-1', 'web-2', 3).ok, false);
    assert.deepEqual(record.disposeBoundSession('f1', 'web-1', 4), { ok: true, fence: 'f2', generation: BigInt(2) });
});

test('lock preempts pending without a late auth factory call, and replay detaches only once', () => {
    const { record, issued } = control();
    record.begin('setup', 'op', 'key', 'fp', 0);
    assert.deepEqual(record.advanceLock('f0', 'lock', 'lock-fp', 1), { ok: true, fence: 'f1', generation: BigInt(1), detachedSessionId: null });
    assert.equal(issued(), 1);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 2).ok, false);
    assert.equal(issued(), 1);
    assert.deepEqual(record.advanceLock('f0', 'lock', 'lock-fp', 3), { ok: true, fence: 'f1', generation: BigInt(1), detachedSessionId: null });
    assert.deepEqual(record.finalizeLock('f0', 'lock', 'lock-fp', 4), { ok: true, fence: 'f1', generation: BigInt(1), receipt: 'confirmed' });
    assert.deepEqual(record.finalizeLock('f0', 'lock', 'lock-fp', 5), { ok: true, fence: 'f1', generation: BigInt(1), receipt: 'confirmed' });
});

test('auth first makes a stale lock unconfirmed until its successor fence', () => {
    const { record } = control();
    record.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 1).ok, true);
    assert.equal(record.advanceLock('f0', 'lock', 'fp-lock', 2).ok, false);
    assert.equal(record.finalizeLock('f0', 'lock', 'fp-lock', 2).ok, false);
    assert.equal(record.advanceLock('f1', 'lock', 'fp-lock', 3).ok, true);
});

test('expires pending monotonically and retains idempotency tombstones at capacity', () => {
    const { record } = control();
    record.begin('login', 'op', 'key', 'fp', 0);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 120_000).ok, false);
    assert.equal(record.finalizeAuth('f0', 'op', BigInt(0), 'fp', 'web', 0).ok, false, 'clock rollback cannot revive a pending operation');
    let fence = 'f0';
    for (let index = 0; index < 63; index += 1) {
        const result = record.advanceLock(fence, `key-${index}`, `fp-${index}`, 120_001 + index);
        assert.equal(result.ok, true);
        if (result.ok) fence = result.fence;
    }
    assert.equal(record.advanceLock(fence, 'key-63', 'fp-63', 500_001).ok, false);
    assert.equal(record.advanceLock('f0', 'key-0', 'changed', 500_001).ok, false);
    assert.equal(record.advanceLock('f0', 'key-0', 'fp-0', 500_001).ok, false);
});

test('denies hostile non-data inputs without observing them, ABA fences, collisions, wraps, and thenables', () => {
    let observed = false;
    const accessor = Object.create({ inherited: true });
    Object.defineProperty(accessor, 'value', { get: () => { observed = true; throw new Error('read'); } });
    const hidden = {}; Object.defineProperty(hidden, 'value', { value: 'x' });
    const hostile = [accessor, hidden, { extra: 'x' }, { [Symbol('x')]: true }, new Proxy({}, { get: () => { observed = true; throw new Error('read'); } }), { then: () => { observed = true; } }, Symbol('x')];
    const { record } = control();
    for (const value of hostile) assert.equal(record.begin(value, 'op', 'key', 'fp', 0).ok, false);
    assert.equal(observed, false);
    assert.equal(record.advanceLock('f0', 'key', 'fp', Promise.resolve(0)).ok, false);
    assert.equal(record.advanceLock('f0', 'key', 'fp', 0).ok, true);
    const collision = createWebAuthControlRecord('c0', () => 'c0');
    assert.equal(collision.advanceLock('c0', 'key', 'fp', 0).ok, false, 'factory collision is fail closed');
    const wrapped = createWebAuthControlRecord('max', () => 'next', MAX);
    assert.equal(wrapped.advanceLock('max', 'key', 'fp', 0).ok, false);
});

test('factory re-entry or promise output cannot commit the outer mutation', () => {
    let entered = false; let issued = 0;
    const box: { record?: ReturnType<typeof createWebAuthControlRecord> } = {};
    const record = createWebAuthControlRecord('f0', () => { if (!entered) { entered = true; box.record?.advanceLock('f0', 'inner', 'fp-inner', 0); } return `f${++issued}`; });
    box.record = record;
    assert.equal(record.advanceLock('f0', 'outer', 'fp-outer', 0).ok, false);
    assert.equal(record.snapshot().fence, 'f1');
    const promised = createWebAuthControlRecord('p0', () => Promise.resolve('p1'));
    assert.equal(promised.advanceLock('p0', 'key', 'fp', 0).ok, false);
    assert.equal(promised.snapshot().fence, 'p0');
});
