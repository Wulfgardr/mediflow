/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyHeadlessSoapEntryGestureSealBundle } from './headless-soap-entry-seal-binding.ts';
import {
    createHeadlessSoapEntryPresentationGoldenFieldSet,
    HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4,
} from './headless-soap-entry-presentation-lifecycle-fixture.test.ts';

type GoldenSeal = Readonly<{
    payloadDigest: Readonly<{ sha256: Readonly<{ bytes: readonly number[] }> }>;
    sealDigest: Readonly<{ sha256: Readonly<{ bytes: readonly number[] }> }>;
}>;

test('returns a detached deeply frozen canonical seal copy without widening the H5a API', () => {
    const source = HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.seal as GoldenSeal;
    const verified = verifyHeadlessSoapEntryGestureSealBundle(
        createHeadlessSoapEntryPresentationGoldenFieldSet(),
        source,
    );

    assert.ok(verified);
    assert.notEqual(verified, source);
    assert.notEqual(verified.payloadDigest, source.payloadDigest);
    assert.notEqual(verified.payloadDigest.sha256, source.payloadDigest.sha256);
    assert.notEqual(verified.payloadDigest.sha256.bytes, source.payloadDigest.sha256.bytes);
    assert.notEqual(verified.sealDigest, source.sealDigest);
    assert.notEqual(verified.sealDigest.sha256, source.sealDigest.sha256);
    assert.notEqual(verified.sealDigest.sha256.bytes, source.sealDigest.sha256.bytes);
    assert.equal(Object.getPrototypeOf(verified), null);
    assert.equal(Object.getPrototypeOf(verified.payloadDigest), null);
    assert.equal(Object.getPrototypeOf(verified.payloadDigest.sha256), null);
    assert.equal(Object.getPrototypeOf(verified.sealDigest), null);
    assert.equal(Object.getPrototypeOf(verified.sealDigest.sha256), null);
    assert.equal(Object.isFrozen(verified), true);
    assert.equal(Object.isFrozen(verified.payloadDigest), true);
    assert.equal(Object.isFrozen(verified.payloadDigest.sha256), true);
    assert.equal(Object.isFrozen(verified.payloadDigest.sha256.bytes), true);
    assert.equal(Object.isFrozen(verified.sealDigest), true);
    assert.equal(Object.isFrozen(verified.sealDigest.sha256), true);
    assert.equal(Object.isFrozen(verified.sealDigest.sha256.bytes), true);
    assert.equal(JSON.stringify(verified), JSON.stringify(source));
});
