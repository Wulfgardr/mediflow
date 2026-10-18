import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from './db.ts';
import { encryptData } from './security/security.ts';

test('scoped notes reuse the current browser ENC key and cancel when that key is replaced', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const cipher = await encryptData('Synthetic confidential notes', key);
    const notes = `ENC:${cipher.iv}:${cipher.data}`;
    db.setKey(key);
    try {
        assert.equal(await db.decryptPatientProfileNotes(notes), 'Synthetic confidential notes');
        assert.equal(await db.decryptPatientProfileNotes(null), null);
        const pending = db.decryptPatientProfileNotes(notes); db.setKey(null);
        await assert.rejects(pending);
        await assert.rejects(db.decryptPatientProfileNotes(notes));
    } finally { db.setKey(null); }
});
