import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

import { createPinRotationBundle, validatePinChangeInput } from './pin-change';
import {
    deriveKeyFromPin,
    generateMasterKey,
    getKdfVersion,
    unwrapMasterKey,
    unwrapMasterKeyVersioned,
    wrapMasterKey,
} from './security';

if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', {
        value: webcrypto,
        configurable: true,
    });
}

test('validatePinChangeInput rejects missing current pin, weak new pin and reuse', () => {
    assert.equal(validatePinChangeInput('', '5678'), 'Inserisci il PIN attuale.');
    assert.match(validatePinChangeInput('1234', '12') ?? '', /tra 4 e 8 caratteri/);
    assert.equal(validatePinChangeInput('1234', '1234'), 'Il nuovo PIN deve essere diverso dal PIN attuale.');
    assert.equal(validatePinChangeInput('1234', '5678'), null);
});

test('createPinRotationBundle re-wraps the same master key with the new PIN', async () => {
    const masterKey = await generateMasterKey();
    const originalSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const originalKek = await deriveKeyFromPin('1234', originalSalt);
    const originalEncryptedMasterKey = await wrapMasterKey(masterKey, originalKek);
    const originalUnwrapped = await unwrapMasterKey(originalEncryptedMasterKey, originalKek);

    const rotation = await createPinRotationBundle(masterKey, '5678');
    // The rotation bundle is now written at the current KDF version (v2).
    assert.equal(getKdfVersion(rotation.encryptedMasterKey), 2);
    const rotatedSalt = new Uint8Array(Buffer.from(rotation.salt, 'base64'));
    const rotatedMasterKey = await unwrapMasterKeyVersioned(rotation.encryptedMasterKey, '5678', rotatedSalt);

    await assert.rejects(async () => {
        await unwrapMasterKeyVersioned(rotation.encryptedMasterKey, '1234', rotatedSalt);
    });

    const originalRaw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', originalUnwrapped));
    const rotatedRaw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', rotatedMasterKey));

    assert.deepEqual(Array.from(rotatedRaw), Array.from(originalRaw));
});
