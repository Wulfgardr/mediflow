import assert from 'node:assert/strict';
import { createDecipheriv, createHash, hkdfSync, pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { deriveKeyFromPin, generateMasterKey, KDF_ITERATIONS, unwrapMasterKeyVersioned, wrapMasterKeyVersioned } from './security';
import { validateKdfRewrapPayload } from './kdf-rewrap-validation';
import {
    PASSPHRASE_POLICY,
    UNLOCK_KDF_ITERATIONS,
    UNLOCK_KDF_VERSION,
    checkPassphrase,
    createRecoveryWrapping,
    createUnlockWrapping,
    deriveUnlockMaterial,
    hashAccessVerifier,
    openRecoveryWrapping,
    openUnlockWrapping,
} from './unlock-credential';

// A derivation below the production cost, for what does not depend on the cost.
const FAST = 1_000;
const PASSPHRASE = 'cavallo batteria graffetta corretta';
const newSalt = () => globalThis.crypto.getRandomValues(new Uint8Array(16));

test('the Apple v3 golden vector remains identical to the canonical WebCrypto derivation and wrapping', async () => {
    const vector = JSON.parse(readFileSync(new URL('../../native/contracts/crypto-golden-vectors.v3.json', import.meta.url), 'utf8'));
    const material = await deriveUnlockMaterial(vector.passphrase, new Uint8Array(Buffer.from(vector.salt, 'base64')));
    assert.equal(material.verifier, vector.verifier);
    const key = await openUnlockWrapping(vector.wrappedMasterKey, material.kek);
    assert.equal(await rawKey(key), vector.rawMasterKeyHex);
});
const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'));

async function rawKey(key: CryptoKey): Promise<string> {
    return Buffer.from(await globalThis.crypto.subtle.exportKey('raw', key)).toString('hex');
}

// One wrapping at the production cost, shared by the tests that open it.
const wrapping = (async () => {
    const masterKey = await generateMasterKey();
    return { masterKey, ...await createUnlockWrapping(masterKey, PASSPHRASE) };
})();

/** AES-256-GCM as another implementation reads the payload: 12 bytes of IV, ciphertext, 16 bytes of tag. */
function openWithNode(encryptedMasterKey: string, key: Buffer): string {
    const payload = Buffer.from(encryptedMasterKey.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(payload.length - 16));
    return Buffer.concat([decipher.update(payload.subarray(12, payload.length - 16)), decipher.final()]).toString('hex');
}

test('the passphrase policy is one length rule, counted in characters after NFKC', () => {
    assert.deepEqual(PASSPHRASE_POLICY, { version: 1, minLength: 15, maxLength: 128 });
    assert.deepEqual(checkPassphrase('a'.repeat(14)), { ok: false, reason: 'too_short' });
    assert.deepEqual(checkPassphrase('a'.repeat(15)), { ok: true, passphrase: 'a'.repeat(15) });
    assert.deepEqual(checkPassphrase('a'.repeat(128)), { ok: true, passphrase: 'a'.repeat(128) });
    assert.deepEqual(checkPassphrase('a'.repeat(129)), { ok: false, reason: 'too_long' });
    // Eight characters outside the basic plane are sixteen UTF-16 units, and still eight characters.
    assert.deepEqual(checkPassphrase('🩺'.repeat(8)), { ok: false, reason: 'too_short' });
    assert.equal(checkPassphrase('🩺'.repeat(15)).ok, true);
    // One ligature is three characters once normalized: five of them are a passphrase of fifteen.
    assert.deepEqual(checkPassphrase('ﬃ'.repeat(5)), { ok: true, passphrase: 'ffi'.repeat(5) });
    // No composition rule, and nothing is trimmed away.
    assert.deepEqual(checkPassphrase(` ${'1'.repeat(15)} `), { ok: true, passphrase: ` ${'1'.repeat(15)} ` });
    assert.deepEqual(checkPassphrase(`perchè ${'a'.repeat(10)}`), { ok: true, passphrase: `perchè ${'a'.repeat(10)}` });
});

test('no wrapping is made from a passphrase outside the policy', async () => {
    const masterKey = await generateMasterKey();
    await assert.rejects(() => createUnlockWrapping(masterKey, 'a'.repeat(14)), /^Error: Passphrase outside the policy: too_short$/u);
    await assert.rejects(() => createUnlockWrapping(masterKey, '12345678'), /too_short/u);
    await assert.rejects(() => createUnlockWrapping(masterKey, 'a'.repeat(129)), /too_long/u);
});

test('the same passphrase and salt always give the same verifier; any change gives another', async () => {
    const salt = newSalt();
    const { verifier } = await deriveUnlockMaterial(PASSPHRASE, salt, FAST);
    assert.equal(Buffer.from(verifier, 'base64').length, 32);
    assert.equal((await deriveUnlockMaterial(PASSPHRASE, salt, FAST)).verifier, verifier);
    assert.notEqual((await deriveUnlockMaterial(PASSPHRASE, newSalt(), FAST)).verifier, verifier);
    assert.notEqual((await deriveUnlockMaterial(`${PASSPHRASE} `, salt, FAST)).verifier, verifier);
    assert.notEqual((await deriveUnlockMaterial(PASSPHRASE, salt, FAST + 1)).verifier, verifier);
    await assert.rejects(() => deriveUnlockMaterial(PASSPHRASE, new Uint8Array(8), FAST), /Salt is too short/u);
});

test('equivalent Unicode spellings are one passphrase', async () => {
    const salt = newSalt();
    const composed = await deriveUnlockMaterial('perché no, è così lontano', salt, FAST);
    const decomposed = await deriveUnlockMaterial('perché no, è così lontano', salt, FAST);
    assert.equal(decomposed.verifier, composed.verifier);
});

test('a long passphrase counts to its last character: nothing truncates at 72 bytes', async () => {
    const salt = newSalt();
    const shared = 'x'.repeat(100);
    const { verifier } = await deriveUnlockMaterial(`${shared}A`, salt, FAST);
    assert.notEqual((await deriveUnlockMaterial(`${shared}B`, salt, FAST)).verifier, verifier);
    assert.notEqual((await deriveUnlockMaterial(shared, salt, FAST)).verifier, verifier);
});

test('a passphrase wrapping opens with the passphrase and with nothing else', async () => {
    const { masterKey, encryptedMasterKey, salt, verifier } = await wrapping;
    assert.match(encryptedMasterKey, /^v3:/u);
    assert.equal(bytes(salt).length, 16);
    assert.notEqual((await createUnlockWrapping(masterKey, PASSPHRASE)).salt, salt, 'every wrapping takes a fresh salt');

    const unlocked = await deriveUnlockMaterial(PASSPHRASE, bytes(salt));
    assert.equal(unlocked.verifier, verifier, 'unlocking yields the verifier made at setup');
    assert.equal(await rawKey(await openUnlockWrapping(encryptedMasterKey, unlocked.kek)), await rawKey(masterKey));

    const wrongPassphrase = await deriveUnlockMaterial(`${PASSPHRASE}!`, bytes(salt));
    assert.notEqual(wrongPassphrase.verifier, verifier);
    await assert.rejects(() => openUnlockWrapping(encryptedMasterKey, wrongPassphrase.kek));
    const wrongSalt = await deriveUnlockMaterial(PASSPHRASE, newSalt());
    await assert.rejects(() => openUnlockWrapping(encryptedMasterKey, wrongSalt.kek));
    // The production cost is part of the key: a cheaper derivation of the right passphrase opens nothing.
    const cheaper = await deriveUnlockMaterial(PASSPHRASE, bytes(salt), FAST);
    await assert.rejects(() => openUnlockWrapping(encryptedMasterKey, cheaper.kek));

    const altered = Buffer.from(encryptedMasterKey.slice(3), 'base64');
    altered[altered.length - 1] ^= 1;
    await assert.rejects(() => openUnlockWrapping(`v3:${altered.toString('base64')}`, unlocked.kek));
});

test('what the server receives and stores cannot open the wrapping', async () => {
    const { encryptedMasterKey, verifier } = await wrapping;
    const stored = await hashAccessVerifier(verifier);
    assert.equal(stored, createHash('sha256').update(Buffer.from(verifier, 'base64')).digest('hex'));
    for (const candidate of [Buffer.from(verifier, 'base64'), Buffer.from(stored, 'hex')]) {
        assert.throws(() => openWithNode(encryptedMasterKey, candidate), 'neither the verifier nor its hash is the wrapping key');
    }
});

test('an independent implementation of the documented construction opens the wrapping', async () => {
    const { masterKey, encryptedMasterKey, salt, verifier } = await wrapping;
    assert.equal(UNLOCK_KDF_ITERATIONS, 2_000_000);
    const root = pbkdf2Sync(Buffer.from(PASSPHRASE.normalize('NFKC'), 'utf8'), bytes(salt), 2_000_000, 32, 'sha256');
    const derive = (info: string) => Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), info, 32));
    assert.equal(derive('mediflow.unlock.verifier.v3').toString('base64'), verifier);
    assert.equal(openWithNode(encryptedMasterKey, derive('mediflow.unlock.kek.v3')), await rawKey(masterKey));
});

test('the PIN path and the passphrase path refuse each other\'s wrappings', async () => {
    const { masterKey, encryptedMasterKey, salt } = await wrapping;
    await assert.rejects(() => unwrapMasterKeyVersioned(encryptedMasterKey, PASSPHRASE, bytes(salt)), /Unsupported KDF version: 3/u);
    assert.equal(KDF_ITERATIONS[UNLOCK_KDF_VERSION], undefined, 'version 3 is never derived as a PIN');
    assert.equal(validateKdfRewrapPayload({ encryptedMasterKey, salt }), null, 'the PIN re-wrap route does not store a passphrase wrapping');

    const pinSalt = newSalt();
    const pinWrapping = await wrapMasterKeyVersioned(masterKey, '13572468', pinSalt);
    const { kek } = await deriveUnlockMaterial('13572468', pinSalt, FAST);
    await assert.rejects(() => openUnlockWrapping(pinWrapping, kek), /^Error: Not a passphrase wrapping: version 2$/u);
    await assert.rejects(() => openUnlockWrapping(pinWrapping.slice(3), kek), /Not a passphrase wrapping: version 1/u);
    // A relabelled blob opens nothing either: the same secret under the PIN derivation is another key.
    const pinKek = await deriveKeyFromPin(PASSPHRASE, bytes(salt), UNLOCK_KDF_ITERATIONS);
    await assert.rejects(() => openUnlockWrapping(encryptedMasterKey, pinKek));
});

test('a recovery key is 160 random bits in eight readable groups', async () => {
    const masterKey = await generateMasterKey();
    const keys = (await Promise.all(Array.from({ length: 64 }, () => createRecoveryWrapping(masterKey)))).map((made) => made.recoveryKey);
    for (const key of keys) assert.match(key, /^(?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/u);
    assert.equal(new Set(keys).size, keys.length);
    // Every position takes more than one value: no character is fixed.
    for (let position = 0; position < 39; position += 1) {
        if (keys[0][position] !== '-') assert.ok(new Set(keys.map((key) => key[position])).size > 1, `position ${position}`);
    }
});

test('the recovery wrapping opens with the recovery key as a person types it back, and with nothing else', async () => {
    const masterKey = await generateMasterKey();
    const { recoveryKey, wrappedMasterKey, salt, verifier } = await createRecoveryWrapping(masterKey);
    assert.match(wrappedMasterKey, /^r1:/u);
    assert.equal(bytes(salt).length, 16);

    const opened = await openRecoveryWrapping(wrappedMasterKey, salt, recoveryKey);
    assert.equal(await rawKey(opened.masterKey), await rawKey(masterKey));
    assert.equal(opened.verifier, verifier, 'recovery yields the verifier made with the kit');
    const typed = `  ${recoveryKey.toLowerCase().replaceAll('-', ' ').replaceAll('0', 'o').replaceAll('1', 'l')} `;
    const reopened = await openRecoveryWrapping(wrappedMasterKey, salt, typed);
    assert.equal(await rawKey(reopened.masterKey), await rawKey(masterKey));
    assert.equal(reopened.verifier, verifier);

    const other = await createRecoveryWrapping(masterKey);
    await assert.rejects(() => openRecoveryWrapping(wrappedMasterKey, salt, other.recoveryKey));
    await assert.rejects(() => openRecoveryWrapping(wrappedMasterKey, other.salt, recoveryKey));
    await assert.rejects(() => openRecoveryWrapping(wrappedMasterKey, salt, recoveryKey.slice(0, -1)), /^Error: Recovery key is not valid$/u);
    await assert.rejects(() => openRecoveryWrapping(wrappedMasterKey, salt, `${recoveryKey.slice(0, -1)}U`), /^Error: Recovery key is not valid$/u);
    await assert.rejects(() => openRecoveryWrapping(wrappedMasterKey, 'AAAA', recoveryKey), /Salt is too short/u);

    // An independent reading of the construction: the decoded key, HKDF with the kit salt, AES-256-GCM.
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const bits = [...recoveryKey.replaceAll('-', '')].map((character) => alphabet.indexOf(character).toString(2).padStart(5, '0')).join('');
    const secret = Buffer.from(bits.match(/.{8}/gu)!.map((chunk) => Number.parseInt(chunk, 2)));
    assert.equal(secret.length, 20);
    const derive = (info: string) => Buffer.from(hkdfSync('sha256', secret, bytes(salt), info, 32));
    assert.equal(openWithNode(wrappedMasterKey, derive('mediflow.recovery.kek.v1')), await rawKey(masterKey));
    assert.equal(derive('mediflow.recovery.verifier.v1').toString('base64'), verifier);
    // What the server stores for recovery opens nothing.
    for (const candidate of [Buffer.from(verifier, 'base64'), Buffer.from(await hashAccessVerifier(verifier), 'hex')]) {
        assert.throws(() => openWithNode(wrappedMasterKey, candidate));
    }
});

test('the two wrappings of one master key are independent', async () => {
    const { masterKey, encryptedMasterKey, salt } = await wrapping;
    const recovery = await createRecoveryWrapping(masterKey);
    const { kek } = await deriveUnlockMaterial(PASSPHRASE, bytes(salt));

    await assert.rejects(() => openUnlockWrapping(recovery.wrappedMasterKey, kek), /Not a passphrase wrapping/u);
    await assert.rejects(() => openRecoveryWrapping(encryptedMasterKey, salt, recovery.recoveryKey), /^Error: Not a recovery wrapping$/u);
    // Relabelled, each still needs its own secret.
    await assert.rejects(() => openUnlockWrapping(`v3:${recovery.wrappedMasterKey.slice(3)}`, kek));
    await assert.rejects(() => openRecoveryWrapping(`r1:${encryptedMasterKey.slice(3)}`, salt, recovery.recoveryKey));
});

test('an error never repeats the secret that caused it', async () => {
    const { encryptedMasterKey, salt } = await wrapping;
    const masterKey = await generateMasterKey();
    const shortPassphrase = 'troppo corta';
    const typedRecoveryKey = 'QUESTA-NON-E-UNA-CHIAVE';
    const { kek } = await deriveUnlockMaterial(shortPassphrase, bytes(salt), FAST);
    const failures = await Promise.allSettled([
        createUnlockWrapping(masterKey, shortPassphrase),
        openUnlockWrapping(encryptedMasterKey, kek),
        openUnlockWrapping('v2:AAAA', kek),
        openRecoveryWrapping('r1:AAAA', salt, typedRecoveryKey),
    ]);
    for (const failure of failures) {
        assert.equal(failure.status, 'rejected');
        const text = `${String(failure.reason)} ${String(failure.reason?.stack)}`;
        assert.ok(!text.includes(shortPassphrase) && !text.includes(typedRecoveryKey), 'the secret stays out of the error');
    }
});
