/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHeadlessSoapCommandEnvelope } from './headless-soap-command-envelope.ts';

const APPROVAL_REF = `hsaa_${'11'.repeat(32)}`;
const IDEMPOTENCY_KEY = `hsai_${'22'.repeat(32)}`;
const AUTHORIZATION_PROOF =
    'hsap_000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const AUTHORIZATION_PROOF_DIGEST =
    'dc46f7c692a1902908b890419434f788d8351f903a1cd9fdba60cec08bd0a3f3';

function exactEnvelope(): Readonly<Record<string, unknown>> {
    return Object.freeze(Object.assign(Object.create(null), {
        approvalRef: APPROVAL_REF,
        idempotencyKey: IDEMPOTENCY_KEY,
        authorizationProof: AUTHORIZATION_PROOF,
    })) as Readonly<Record<string, unknown>>;
}

test('copies one exact H6 envelope and returns its shared proof digest', () => {
    const source = exactEnvelope();
    const parsed = parseHeadlessSoapCommandEnvelope(source);

    assert.ok(parsed);
    assert.deepEqual(Reflect.ownKeys(parsed), ['envelope', 'authorizationProofDigest']);
    assert.equal(Object.getPrototypeOf(parsed), null);
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(parsed.authorizationProofDigest, AUTHORIZATION_PROOF_DIGEST);

    assert.notEqual(parsed.envelope, source);
    assert.deepEqual(Reflect.ownKeys(parsed.envelope), [
        'approvalRef', 'idempotencyKey', 'authorizationProof',
    ]);
    assert.equal(Object.getPrototypeOf(parsed.envelope), null);
    assert.equal(Object.isFrozen(parsed.envelope), true);
    assert.deepEqual(parsed.envelope, source);
    for (const key of Reflect.ownKeys(parsed.envelope)) {
        const descriptor = Object.getOwnPropertyDescriptor(parsed.envelope, key);
        assert.ok(descriptor && descriptor.enumerable && 'value' in descriptor);
        assert.equal(descriptor.writable, false);
        assert.equal(descriptor.configurable, false);
    }
});

test('rejects a transparent Proxy before observing any trap', () => {
    let traps = 0;
    const target = exactEnvelope();
    const candidate = new Proxy(target, {
        getOwnPropertyDescriptor(value, key) {
            traps += 1;
            return Reflect.getOwnPropertyDescriptor(value, key);
        },
        getPrototypeOf(value) {
            traps += 1;
            return Reflect.getPrototypeOf(value);
        },
        isExtensible(value) {
            traps += 1;
            return Reflect.isExtensible(value);
        },
        ownKeys(value) {
            traps += 1;
            return Reflect.ownKeys(value);
        },
    });

    assert.equal(parseHeadlessSoapCommandEnvelope(candidate), null);
    assert.equal(traps, 0);
});

test('rejects every non-exact H6 record without invoking accessors', () => {
    const wrongOrder = Object.freeze(Object.assign(Object.create(null), {
        idempotencyKey: IDEMPOTENCY_KEY,
        approvalRef: APPROVAL_REF,
        authorizationProof: AUTHORIZATION_PROOF,
    }));
    const withExtra = Object.freeze(Object.assign(Object.create(null), {
        approvalRef: APPROVAL_REF,
        idempotencyKey: IDEMPOTENCY_KEY,
        authorizationProof: AUTHORIZATION_PROOF,
        extra: true,
    }));
    const withSymbol = Object.assign(Object.create(null), {
        approvalRef: APPROVAL_REF,
        idempotencyKey: IDEMPOTENCY_KEY,
        authorizationProof: AUTHORIZATION_PROOF,
    });
    Object.defineProperty(withSymbol, Symbol('extra'), { value: true });
    Object.freeze(withSymbol);
    const nonEnumerable = Object.create(null);
    Object.defineProperties(nonEnumerable, {
        approvalRef: { value: APPROVAL_REF, enumerable: false },
        idempotencyKey: { value: IDEMPOTENCY_KEY, enumerable: true },
        authorizationProof: { value: AUTHORIZATION_PROOF, enumerable: true },
    });
    Object.freeze(nonEnumerable);
    let getterCalls = 0;
    const accessor = Object.create(null);
    Object.defineProperties(accessor, {
        approvalRef: { enumerable: true, get() { getterCalls += 1; return APPROVAL_REF; } },
        idempotencyKey: { value: IDEMPOTENCY_KEY, enumerable: true },
        authorizationProof: { value: AUTHORIZATION_PROOF, enumerable: true },
    });
    Object.freeze(accessor);
    const invalidValues = [
        Object.freeze(Object.assign(Object.create(null), {
            approvalRef: `hsaa_${'A'.repeat(64)}`,
            idempotencyKey: IDEMPOTENCY_KEY,
            authorizationProof: AUTHORIZATION_PROOF,
        })),
        Object.freeze(Object.assign(Object.create(null), {
            approvalRef: APPROVAL_REF,
            idempotencyKey: `hsai_${'2'.repeat(63)}`,
            authorizationProof: AUTHORIZATION_PROOF,
        })),
        Object.freeze(Object.assign(Object.create(null), {
            approvalRef: APPROVAL_REF,
            idempotencyKey: IDEMPOTENCY_KEY,
            authorizationProof: `hsap_${'g'.repeat(64)}`,
        })),
    ];
    const rejected: unknown[] = [
        null,
        {},
        Object.freeze({ ...exactEnvelope() }),
        Object.assign(Object.create(null), exactEnvelope()),
        wrongOrder,
        withExtra,
        withSymbol,
        nonEnumerable,
        accessor,
        ...invalidValues,
    ];

    for (const candidate of rejected) {
        assert.equal(parseHeadlessSoapCommandEnvelope(candidate), null);
    }
    assert.equal(getterCalls, 0);
});

test('keeps all three token checks fail-closed if ambient RegExp.test is poisoned', () => {
    const original = RegExp.prototype.test;
    try {
        RegExp.prototype.test = () => true;
        const invalid = Object.freeze(Object.assign(Object.create(null), {
            approvalRef: 'not-an-approval',
            idempotencyKey: 'not-an-idempotency-key',
            authorizationProof: 'not-a-proof',
        }));
        assert.equal(parseHeadlessSoapCommandEnvelope(invalid), null);
        assert.ok(parseHeadlessSoapCommandEnvelope(exactEnvelope()));
    } finally {
        RegExp.prototype.test = original;
    }
});
