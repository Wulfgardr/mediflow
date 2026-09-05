/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    HEADLESS_SOAP_AUTHORIZATION_PROOF_DOMAIN_V1,
    createHeadlessSoapAuthorizationProofToken,
    digestHeadlessSoapAuthorizationProof,
} from './headless-soap-authorization-proof-token';

test('encodes one exact 32-byte entropy source into the canonical proof and domain-separated digest', () => {
    const entropy = Uint8Array.from({ length: 32 }, (_value, index) => index);
    const token = createHeadlessSoapAuthorizationProofToken(entropy);

    assert.ok(token);
    assert.equal(HEADLESS_SOAP_AUTHORIZATION_PROOF_DOMAIN_V1,
        'mediflow.headless.soap-authorization-proof.v1');
    assert.deepEqual(Reflect.ownKeys(token), ['authorizationProof', 'digest']);
    assert.equal(Object.getPrototypeOf(token), null);
    assert.equal(Object.isFrozen(token), true);
    assert.equal(token.authorizationProof,
        'hsap_000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    assert.equal(token.digest, 'dc46f7c692a1902908b890419434f788d8351f903a1cd9fdba60cec08bd0a3f3');
    assert.equal(digestHeadlessSoapAuthorizationProof(token.authorizationProof), token.digest);
});

test('rejects every non-canonical authorization proof before hashing', () => {
    const canonicalBody = '0'.repeat(64);
    const candidates: unknown[] = [
        null,
        undefined,
        1,
        '',
        canonicalBody,
        `hsap_${'0'.repeat(63)}`,
        `hsap_${'0'.repeat(65)}`,
        `hsap_${'A'.repeat(64)}`,
        `hsap_${'g'.repeat(64)}`,
        `hsap-${canonicalBody}`,
        `hsap_${canonicalBody}\n`,
    ];

    for (const candidate of candidates) {
        assert.equal(digestHeadlessSoapAuthorizationProof(candidate), null);
    }
});

test('keeps canonical proof validation stable if RegExp.prototype.test is poisoned', () => {
    const original = RegExp.prototype.test;
    try {
        RegExp.prototype.test = () => true;
        assert.equal(digestHeadlessSoapAuthorizationProof('not-canonical'), null);
    } finally {
        RegExp.prototype.test = original;
    }
});

test('accepts only an exact canonical 32-byte Uint8Array view without observing Proxies', () => {
    const larger = new ArrayBuffer(33);
    const withExtraKey = new Uint8Array(32);
    Object.defineProperty(withExtraKey, 'extra', { value: true });
    const inheritedPrototype = new Uint8Array(32);
    Object.setPrototypeOf(inheritedPrototype, Object.create(Uint8Array.prototype));
    const rejected: unknown[] = [
        new Uint8Array(31),
        new Uint8Array(33),
        Buffer.alloc(32),
        new Uint8Array(larger, 0, 32),
        new Uint8Array(larger, 1, 32),
        new Uint8ClampedArray(32),
        new DataView(new ArrayBuffer(32)),
        withExtraKey,
        inheritedPrototype,
    ];
    if (typeof SharedArrayBuffer === 'function') rejected.push(new Uint8Array(new SharedArrayBuffer(32)));
    try {
        rejected.push(new Uint8Array(new ArrayBuffer(32, { maxByteLength: 64 })));
    } catch {
        // The exact fixed-length cases above remain authoritative on runtimes without resizable buffers.
    }

    let traps = 0;
    rejected.push(new Proxy(new Uint8Array(32), {
        get() { traps += 1; throw new Error('proxy get trap must stay inert'); },
        getPrototypeOf() { traps += 1; throw new Error('proxy prototype trap must stay inert'); },
    }));

    for (const candidate of rejected) {
        assert.equal(createHeadlessSoapAuthorizationProofToken(candidate), null);
    }
    assert.equal(traps, 0);
});
