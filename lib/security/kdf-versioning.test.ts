import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

import {
    CURRENT_KDF_VERSION,
    KDF_ITERATIONS,
    deriveKeyFromPin,
    generateMasterKey,
    getKdfVersion,
    parseWrappedMasterKey,
    unwrapMasterKey,
    unwrapMasterKeyVersioned,
    wrapMasterKey,
    wrapMasterKeyVersioned,
} from './security';
import { createPinRotationBundle } from './pin-change';

if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', {
        value: webcrypto,
        configurable: true,
    });
}

async function rawKey(key: CryptoKey): Promise<string> {
    const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', key));
    return Buffer.from(raw).toString('hex');
}

test('KDF version table pins v1=100k and v2=600k, current is v2', () => {
    assert.equal(KDF_ITERATIONS[1], 100_000);
    assert.equal(KDF_ITERATIONS[2], 600_000);
    assert.equal(CURRENT_KDF_VERSION, 2);
});

test('parseWrappedMasterKey treats an unmarked blob as legacy v1', () => {
    assert.deepEqual(parseWrappedMasterKey('AAAA'), { version: 1, base64: 'AAAA' });
    assert.deepEqual(parseWrappedMasterKey('v2:AAAA'), { version: 2, base64: 'AAAA' });
    assert.equal(getKdfVersion('AAAA'), 1);
    assert.equal(getKdfVersion('v2:AAAA'), 2);
});

test('a legacy v1 blob (100k, unmarked) still unwraps to the same master key', async () => {
    const masterKey = await generateMasterKey();
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));

    // Legacy write: derive at v1 iterations, bare base64 blob (no version marker).
    const v1Kek = await deriveKeyFromPin('1357', salt, KDF_ITERATIONS[1]);
    const legacyBlob = await wrapMasterKey(masterKey, v1Kek);
    assert.equal(getKdfVersion(legacyBlob), 1, 'legacy blob reads as v1');

    const unwrapped = await unwrapMasterKeyVersioned(legacyBlob, '1357', salt);
    assert.equal(await rawKey(unwrapped), await rawKey(masterKey));
});

test('a new wrap is v2 and is byte-distinct from the v1 wrap of the same key/salt', async () => {
    const masterKey = await generateMasterKey();
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));

    const v2Blob = await wrapMasterKeyVersioned(masterKey, '1357', salt);
    assert.equal(getKdfVersion(v2Blob), 2, 'new wrap is v2');
    assert.match(v2Blob, /^v2:/);

    const unwrapped = await unwrapMasterKeyVersioned(v2Blob, '1357', salt);
    assert.equal(await rawKey(unwrapped), await rawKey(masterKey));

    // The v2 KEK (600k) differs from v1 (100k), so the wrapped payloads differ.
    const v1Kek = await deriveKeyFromPin('1357', salt, KDF_ITERATIONS[1]);
    const v1Blob = await wrapMasterKey(masterKey, v1Kek);
    assert.notEqual(parseWrappedMasterKey(v2Blob).base64, v1Blob);
});

test('login-path lazy upgrade: a v1 record re-wraps to v2 for the same master key', async () => {
    const masterKey = await generateMasterKey();
    const oldSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));

    // Stored state: legacy v1 blob.
    const v1Kek = await deriveKeyFromPin('1357', oldSalt, KDF_ITERATIONS[1]);
    const stored = await wrapMasterKey(masterKey, v1Kek);
    assert.equal(getKdfVersion(stored), 1);

    // Login unwraps (version-aware), then re-wraps at v2 with a fresh salt.
    const unwrapped = await unwrapMasterKeyVersioned(stored, '1357', oldSalt);
    assert.ok(getKdfVersion(stored) < CURRENT_KDF_VERSION, 'upgrade is needed');

    const newSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const upgraded = await wrapMasterKeyVersioned(unwrapped, '1357', newSalt);
    assert.equal(getKdfVersion(upgraded), 2, 'upgraded blob is v2');

    // The upgraded blob unwraps to the SAME master key (no data re-encryption).
    const afterUpgrade = await unwrapMasterKeyVersioned(upgraded, '1357', newSalt);
    assert.equal(await rawKey(afterUpgrade), await rawKey(masterKey));
});

test('change-pin bundle produces a v2 blob that unwraps to the same master key', async () => {
    const masterKey = await generateMasterKey();
    const rotation = await createPinRotationBundle(masterKey, '5678');

    assert.equal(getKdfVersion(rotation.encryptedMasterKey), 2, 'rotation bundle is v2');

    const salt = new Uint8Array(Buffer.from(rotation.salt, 'base64'));
    const unwrapped = await unwrapMasterKeyVersioned(rotation.encryptedMasterKey, '5678', salt);
    assert.equal(await rawKey(unwrapped), await rawKey(masterKey));
});

test('unwrapMasterKeyVersioned rejects an unsupported KDF version', async () => {
    await assert.rejects(
        () => unwrapMasterKeyVersioned('v9:AAAA', '1357', new Uint8Array(16)),
        /Unsupported KDF version/,
    );
});
