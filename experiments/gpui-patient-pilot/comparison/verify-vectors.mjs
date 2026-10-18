#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import { deriveUnlock, openPinWrapping, seal, unseal, unwrapKey, wrapKey } from './crypto.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./crypto-v3-vectors.json', import.meta.url), 'utf8'));
assert.equal(fixture.synthetic, true);
for (const vector of fixture.vectors) {
    assert.equal(vector.passphrase.normalize('NFKC'), vector.normalizedPassphrase);
    const { kek, verifier } = deriveUnlock(vector.passphrase, vector.salt);
    assert.equal(kek.toString('hex'), vector.kekHex, `${vector.id}: KEK`);
    assert.equal(verifier, vector.verifier, `${vector.id}: verifier`);
    const key = Buffer.from(vector.masterKeyHex, 'hex');
    assert.equal(`v3:${wrapKey(key, kek, Buffer.from(vector.wrappingIvHex, 'hex'))}`, vector.wrappedMasterKey);
    assert.deepEqual(unwrapKey(vector.wrappedMasterKey.slice(3), kek), key);
    for (const field of vector.sealedFields) {
        assert.equal(seal(field.plaintext, key, Buffer.from(field.ivHex, 'hex')), field.envelope);
        assert.deepEqual(unseal(field.envelope, key), field.plaintext);
        const altered = Buffer.from(field.envelope.split(':')[2], 'base64');
        altered[0] ^= 1;
        assert.throws(() => unseal(`ENC:${field.envelope.split(':')[1]}:${altered.toString('base64')}`, key), 'Authenticated decryption must reject modified data');
        const wrongKey = Buffer.from(key);
        wrongKey[0] ^= 1;
        assert.throws(() => unseal(field.envelope, wrongKey), 'Another archive key must not open a field');
    }
}

const pin = '684209';
const pinSalt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const pinKey = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const pinIv = Buffer.from('bc0000000000000000000000', 'hex');
const pinBlob = (iterations) => wrapKey(pinKey, pbkdf2Sync(pin, pinSalt, iterations, 32, 'sha256'), pinIv);
const legacyPinBlob = pinBlob(100_000), currentPinBlob = pinBlob(600_000);
const saltBase64 = pinSalt.toString('base64');
assert.ok(legacyPinBlob.startsWith('v'), 'Fixed IV must exercise the legacy base64/version-marker boundary');
assert.deepEqual(openPinWrapping(legacyPinBlob, saltBase64, pin), pinKey, 'A base64 v is not a version marker');
assert.deepEqual(openPinWrapping(`v1:${legacyPinBlob}`, saltBase64, pin), pinKey);
assert.deepEqual(openPinWrapping(`v2:${currentPinBlob}`, saltBase64, pin), pinKey);
const invalidPinBlobs = [
    ...['0', '3', '9', '01', '999999999999999999999'].map((version) => `v${version}:${legacyPinBlob}`),
    'v1:', 'v2:@@', `v1::${legacyPinBlob}`, `v1:${legacyPinBlob} `,
    `vfoo:${legacyPinBlob}`, `v:${legacyPinBlob}`, `V1:${legacyPinBlob}`,
    `v2:${currentPinBlob}:`, legacyPinBlob.slice(0, -4),
];
for (const blob of invalidPinBlobs) assert.throws(() => openPinWrapping(blob, saltBase64, pin), 'Unknown or malformed PIN wrapping must fail');
assert.throws(() => openPinWrapping(legacyPinBlob, saltBase64, '684208'), 'Wrong PIN must fail');
assert.throws(() => openPinWrapping(`v1:${currentPinBlob}`, saltBase64, pin), 'Version mismatch must not fall back to another KDF');
const alteredPinBlob = Buffer.from(legacyPinBlob, 'base64');
alteredPinBlob[12] ^= 1;
assert.throws(() => openPinWrapping(alteredPinBlob.toString('base64'), saltBase64, pin), 'PIN wrapping tamper must fail');
console.log(JSON.stringify({ result: 'pass', goldenVectors: fixture.vectors.length, implementation: 'Node crypto', checks: ['NFKC', 'PBKDF2/HKDF', 'key wrapping', 'ENC JSON', 'tamper rejection', 'wrong archive key'], pinWrapping: { formats: ['legacy base64 beginning v', 'v1', 'v2'], malformedRejected: invalidPinBlobs.length, wrongPinRejected: true, mismatchedKdfRejected: true, tamperRejected: true } }));
