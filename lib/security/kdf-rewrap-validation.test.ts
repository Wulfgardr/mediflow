import assert from 'node:assert/strict';
import test from 'node:test';

import { validateKdfRewrapPayload } from './kdf-rewrap-validation';

const validPayload = {
    encryptedMasterKey: `v2:${Buffer.alloc(60, 1).toString('base64')}`,
    salt: Buffer.alloc(16, 2).toString('base64'),
};

test('accepts a current-version wrapped key and a 16-byte salt', () => {
    assert.deepEqual(validateKdfRewrapPayload(validPayload), validPayload);
});

test('rejects malformed, legacy, oversized, and wrong-length wrapped keys', () => {
    for (const encryptedMasterKey of [
        'AAAA',
        `v1:${Buffer.alloc(60, 1).toString('base64')}`,
        'v2:not base64',
        `v2:${Buffer.alloc(59, 1).toString('base64')}`,
        `v2:${'A'.repeat(600)}`,
    ]) {
        assert.equal(validateKdfRewrapPayload({ ...validPayload, encryptedMasterKey }), null);
    }
});

test('rejects malformed, oversized, and wrong-length salts', () => {
    for (const salt of [
        'not base64',
        Buffer.alloc(15, 2).toString('base64'),
        Buffer.alloc(17, 2).toString('base64'),
        'A'.repeat(200),
    ]) {
        assert.equal(validateKdfRewrapPayload({ ...validPayload, salt }), null);
    }
});

test('rejects missing and non-string fields', () => {
    assert.equal(validateKdfRewrapPayload(null), null);
    assert.equal(validateKdfRewrapPayload({ salt: validPayload.salt }), null);
    assert.equal(validateKdfRewrapPayload({ ...validPayload, salt: 42 }), null);
});
