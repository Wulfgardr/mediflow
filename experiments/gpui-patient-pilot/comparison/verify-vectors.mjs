#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveUnlock, seal, unseal, unwrapKey, wrapKey } from './crypto.mjs';

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
console.log(JSON.stringify({ result: 'pass', goldenVectors: fixture.vectors.length, implementation: 'Node crypto', checks: ['NFKC', 'PBKDF2/HKDF', 'key wrapping', 'ENC JSON', 'tamper rejection', 'wrong archive key'] }));
