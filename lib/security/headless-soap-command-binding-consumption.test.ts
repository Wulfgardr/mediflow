/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { digestHeadlessSoapAuthorizationProof } from './headless-soap-authorization-proof-token.ts';
import { commandBindingFixture, syntheticBinding, syntheticProof,
    syntheticRecord } from './headless-soap-command-binding-test-fixture.ts';

test('hands one exact bound command to H7 and spends approval plus proof before return', async () => {
    const current = commandBindingFixture(), authorizationProof = syntheticProof(1);
    const bound = await current.owner.service.bind(authorizationProof);
    const envelope = syntheticRecord({ approvalRef: bound.approvalRef,
        idempotencyKey: bound.idempotencyKey, authorizationProof });
    let command: unknown = null;
    const accepted = await current.owner.approvalController.withSingleUseApproval(envelope, (candidate) => {
        command = candidate;
    });
    assert.equal(accepted, true);
    assert.ok(command && typeof command === 'object');
    assert.deepEqual(Reflect.ownKeys(command), ['schema', 'commandId', 'approvalRef', 'idempotencyKey',
        'authorizationProofDigest', 'lineage', 'sealBundle']);
    assert.equal(Object.getPrototypeOf(command), null); assert.equal(Object.isFrozen(command), true);
    const value = command as Record<string, unknown>;
    assert.equal(value.schema, 'mediflow.headless.soap-bound-command.v1');
    assert.equal(value.commandId, `hsac_${'44'.repeat(32)}`);
    assert.equal(value.approvalRef, bound.approvalRef); assert.equal(value.idempotencyKey, bound.idempotencyKey);
    assert.equal(value.authorizationProofDigest, digestHeadlessSoapAuthorizationProof(authorizationProof));
    assert.equal(current.owner.service.wipe(bound.approvalRef, authorizationProof), false);
    assert.equal(await current.owner.approvalController.withSingleUseApproval(envelope, () => undefined), false);
});

test('keeps malformed, foreign, and mismatched envelopes inert before exact attachment', async () => {
    const current = commandBindingFixture(), authorizationProof = syntheticProof(2);
    const bound = await current.owner.service.bind(authorizationProof);
    const exact = syntheticRecord({ approvalRef: bound.approvalRef,
        idempotencyKey: bound.idempotencyKey, authorizationProof });
    const candidates = [
        { ...exact },
        syntheticRecord({ ...exact, idempotencyKey: `hsai_${'9'.repeat(64)}` }),
        syntheticRecord({ ...exact, approvalRef: `hsaa_${'8'.repeat(64)}` }),
        syntheticRecord({ ...exact, authorizationProof: syntheticProof(9) }),
        syntheticRecord({ ...exact, extra: true }),
    ];
    let calls = 0;
    for (const candidate of candidates) {
        assert.equal(await current.owner.approvalController.withSingleUseApproval(candidate, () => { calls += 1; }), false);
    }
    assert.equal(calls, 0);
    assert.equal(await current.owner.approvalController.withSingleUseApproval(exact, () => { calls += 1; }), true);
    assert.equal(calls, 1);
});

test('keeps a top-level contender inert without poisoning the acquired approval', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const current = commandBindingFixture(0x5f, gate), authorizationProof = syntheticProof(15);
    const bound = await current.owner.service.bind(authorizationProof);
    const envelope = syntheticRecord({ approvalRef: bound.approvalRef,
        idempotencyKey: bound.idempotencyKey, authorizationProof });
    let winnerCalls = 0, contenderCalls = 0;
    const winner = current.owner.approvalController.withSingleUseApproval(envelope, () => { winnerCalls += 1; });
    assert.equal(await current.owner.approvalController.withSingleUseApproval(
        envelope, () => { contenderCalls += 1; }), false);
    releaseGate();
    assert.equal(await winner, true);
    assert.deepEqual({ winnerCalls, contenderCalls }, { winnerCalls: 1, contenderCalls: 0 });
    assert.equal(await current.owner.approvalController.withSingleUseApproval(envelope, () => undefined), false);
});

test('burns approval and proof on nested controller reentry during the H7 callback', async () => {
    const current = commandBindingFixture(0x5e), authorizationProof = syntheticProof(14);
    const bound = await current.owner.service.bind(authorizationProof);
    const envelope = syntheticRecord({ approvalRef: bound.approvalRef,
        idempotencyKey: bound.idempotencyKey, authorizationProof });
    let outerCalls = 0, nestedCalls = 0, nested: Promise<boolean> | null = null;
    assert.equal(await current.owner.approvalController.withSingleUseApproval(envelope, () => {
        outerCalls += 1;
        nested = current.owner.approvalController.withSingleUseApproval(envelope, () => { nestedCalls += 1; });
    }), false);
    assert.ok(nested);
    assert.equal(await nested, false);
    assert.deepEqual({ outerCalls, nestedCalls }, { outerCalls: 1, nestedCalls: 0 });
    assert.equal(current.owner.service.wipe(bound.approvalRef, authorizationProof), false);
});

test('burns an exact approval without invoking H7 when any lineage field drifts', async () => {
    const current = commandBindingFixture(), authorizationProof = syntheticProof(3);
    const bound = await current.owner.service.bind(authorizationProof);
    current.setCurrent(syntheticBinding(2));
    const envelope = syntheticRecord({ approvalRef: bound.approvalRef,
        idempotencyKey: bound.idempotencyKey, authorizationProof });
    let calls = 0;
    assert.equal(await current.owner.approvalController.withSingleUseApproval(envelope, () => { calls += 1; }), false);
    assert.equal(calls, 0);
    assert.equal(current.owner.service.wipe(bound.approvalRef, authorizationProof), false);
});

test('burns exact approvals on async, Promise, throw, and reentrant H7 callbacks', async () => {
    const callbacks = [
        async () => undefined,
        () => Promise.resolve(),
        () => { throw new Error('synthetic transaction failure'); },
        null,
    ];
    for (let index = 0; index < callbacks.length; index += 1) {
        const current = commandBindingFixture(0x50 + index), authorizationProof = syntheticProof(10 + index);
        const bound = await current.owner.service.bind(authorizationProof);
        const envelope = syntheticRecord({ approvalRef: bound.approvalRef,
            idempotencyKey: bound.idempotencyKey, authorizationProof });
        const callback = callbacks[index] ?? (() => { current.owner.service.wipe(bound.approvalRef, authorizationProof); });
        assert.equal(await current.owner.approvalController.withSingleUseApproval(envelope, callback), false);
        assert.equal(current.owner.service.wipe(bound.approvalRef, authorizationProof), false);
    }
});
