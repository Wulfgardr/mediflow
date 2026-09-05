/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createHeadlessSoapCommandBindingIdentifiers } from './headless-soap-command-binding-identifiers.ts';

test('draws three exact 32-byte identifiers in command, approval, idempotency order', () => {
    const draws = [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22), new Uint8Array(32).fill(0x33)];
    let index = 0;
    const result = createHeadlessSoapCommandBindingIdentifiers(() => draws[index++]);
    assert.ok(result);
    assert.equal(index, 3);
    assert.deepEqual(Reflect.ownKeys(result), ['commandId', 'approvalRef', 'idempotencyKey']);
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.commandId, `hsac_${'11'.repeat(32)}`);
    assert.equal(result.approvalRef, `hsaa_${'22'.repeat(32)}`);
    assert.equal(result.idempotencyKey, `hsai_${'33'.repeat(32)}`);
});

test('performs one draw per identifier and stops at the first unavailable draw', () => {
    for (const unavailableAt of [0, 1, 2]) {
        let calls = 0;
        const result = createHeadlessSoapCommandBindingIdentifiers(() => {
            const current = calls++;
            if (current === unavailableAt) throw new Error('synthetic entropy failure');
            return new Uint8Array(32).fill(current + 1);
        });
        assert.equal(result, null);
        assert.equal(calls, unavailableAt + 1);
    }
});

test('rejects every non-canonical entropy view without observing Proxies', () => {
    const larger = new ArrayBuffer(33);
    const withExtraKey = new Uint8Array(32);
    Object.defineProperty(withExtraKey, 'extra', { value: true });
    const inheritedPrototype = new Uint8Array(32);
    Object.setPrototypeOf(inheritedPrototype, Object.create(Uint8Array.prototype));
    const rejected: unknown[] = [
        new Uint8Array(31), new Uint8Array(33), Buffer.alloc(32), new Uint8Array(larger, 0, 32),
        new Uint8Array(larger, 1, 32), new Uint8ClampedArray(32), new DataView(new ArrayBuffer(32)),
        withExtraKey, inheritedPrototype,
    ];
    if (typeof SharedArrayBuffer === 'function') rejected.push(new Uint8Array(new SharedArrayBuffer(32)));
    try { rejected.push(new Uint8Array(new ArrayBuffer(32, { maxByteLength: 64 }))); } catch { /* fixed cases remain */ }
    let traps = 0;
    rejected.push(new Proxy(new Uint8Array(32), {
        get() { traps += 1; throw new Error('proxy get trap must stay inert'); },
        getPrototypeOf() { traps += 1; throw new Error('proxy prototype trap must stay inert'); },
    }));
    for (const value of rejected) {
        let calls = 0;
        assert.equal(createHeadlessSoapCommandBindingIdentifiers(() => { calls += 1; return value; }), null);
        assert.equal(calls, 1);
    }
    assert.equal(traps, 0);
});

test('does not retry or adopt a later valid draw after malformed entropy', () => {
    let calls = 0;
    const result = createHeadlessSoapCommandBindingIdentifiers(() => {
        calls += 1;
        return calls === 2 ? new Uint8Array(31) : new Uint8Array(32).fill(calls);
    });
    assert.equal(result, null);
    assert.equal(calls, 2);
});
