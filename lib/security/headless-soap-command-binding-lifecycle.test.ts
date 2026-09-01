/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { HeadlessSoapCommandBindingError } from './headless-soap-command-binding-lifecycle.ts';
import { commandBindingFixture as fixture, syntheticProof as proof,
    syntheticRecord as record } from './headless-soap-command-binding-test-fixture.ts';

test('binds one current H5b dependent and publishes only approvalRef plus idempotencyKey', async () => {
    const current = fixture(), authorizationProof = proof(1);
    const result = await current.owner.service.bind(authorizationProof);
    assert.deepEqual(Reflect.ownKeys(result), ['status', 'approvalRef', 'idempotencyKey']);
    assert.equal(Object.getPrototypeOf(result), null); assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(result, record({ status: 'approval_bound', approvalRef: `hsaa_${'44'.repeat(32)}`,
        idempotencyKey: `hsai_${'44'.repeat(32)}` }));
    assert.deepEqual(current.trace, ['register', 'confirm', 'current', 'entropy-1', 'entropy-2', 'entropy-3', 'confirm']);
    assert.equal(current.owner.service.wipe(result.approvalRef, proof(9)), false);
    assert.equal(current.owner.service.wipe(result.approvalRef, authorizationProof), true);
    assert.equal(current.owner.service.wipe(result.approvalRef, authorizationProof), false);
    assert.equal(current.wipes(), 1);
});

test('keeps malformed proofs inert and burns an attached proof on identifier collision', async () => {
    const current = fixture();
    await assert.rejects(current.owner.service.bind('not-a-proof'),
        (error) => error instanceof HeadlessSoapCommandBindingError && error.code === 'proof_unavailable');
    assert.deepEqual(current.trace, []);
    const firstProof = proof(1), first = await current.owner.service.bind(firstProof);
    const secondProof = proof(2);
    await assert.rejects(current.owner.service.bind(secondProof),
        (error) => error instanceof HeadlessSoapCommandBindingError && error.code === 'lifecycle_unavailable');
    assert.equal(current.wipes(), 1);
    assert.equal(current.owner.service.wipe(first.approvalRef, firstProof), true);
});

test('retires a published binding once when H5b drains it upstream', async () => {
    const current = fixture(), authorizationProof = proof(3);
    const result = await current.owner.service.bind(authorizationProof);
    current.drain(authorizationProof);
    assert.equal(current.owner.service.wipe(result.approvalRef, authorizationProof), false);
    assert.equal(current.wipes(), 0);
});

test('preserves exact H5b expiry and lifecycle denials while burning the attached proof', async () => {
    for (const code of ['proof_expired', 'lifecycle_unavailable'] as const) {
        const current = fixture(), authorizationProof = proof(code === 'proof_expired' ? 6 : 7);
        current.failCurrent(Object.assign(new Error('synthetic upstream denial'), { code }));
        await assert.rejects(current.owner.service.bind(authorizationProof),
            (error) => error instanceof HeadlessSoapCommandBindingError && error.code === code);
        assert.equal(current.wipes(), 1);
    }
});
