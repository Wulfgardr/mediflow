/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createDocumentSourceRef,
    createDocumentSourceRefFromEntropyForTest,
    INITIAL_DOCUMENT_CURRENTNESS,
    isDocumentSourceRef,
} from './attachment-currentness';

/* @Codex */
test('document source refs are generated host-side as opaque lowercase 256-bit values', () => {
    const first = createDocumentSourceRef();
    const second = createDocumentSourceRef();

    assert.match(first, /^[0-9a-f]{64}$/u);
    assert.match(second, /^[0-9a-f]{64}$/u);
    assert.notEqual(first, second);
    assert.equal(isDocumentSourceRef(first), true);
    assert.equal(INITIAL_DOCUMENT_CURRENTNESS, 1);
});

/* @Codex */
test('document source ref validation fails closed for malformed values', () => {
    for (const value of [undefined, null, '', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), 1]) {
        assert.equal(isDocumentSourceRef(value), false);
    }
});

/* @Codex */
test('document source ref generation rejects malformed or proxied entropy without exposing it', () => {
    let lengthAccessorReads = 0;
    let proxyGetReads = 0;
    let toStringAccessorReads = 0;
    const entropyWithLengthAccessor = Buffer.alloc(32);
    Object.defineProperty(entropyWithLengthAccessor, 'length', {
        get() {
            lengthAccessorReads += 1;
            return 32;
        },
    });
    const entropyWithAccessor = Buffer.alloc(32);
    Object.defineProperty(entropyWithAccessor, 'toString', {
        get() {
            toStringAccessorReads += 1;
            return () => 'must not call accessor';
        },
    });
    const proxiedEntropy = new Proxy(Buffer.alloc(32), {
        get(target, property, receiver) {
            proxyGetReads += 1;
            return Reflect.get(target, property, receiver);
        },
    });

    for (const entropy of [
        Buffer.alloc(31),
        proxiedEntropy,
        entropyWithLengthAccessor,
        entropyWithAccessor,
    ]) {
        assert.throws(
            () => createDocumentSourceRefFromEntropyForTest(entropy),
            { message: 'Generated document source reference is invalid.' },
        );
    }

    assert.equal(lengthAccessorReads, 0);
    assert.equal(proxyGetReads, 0);
    assert.equal(toStringAccessorReads, 0);
});
