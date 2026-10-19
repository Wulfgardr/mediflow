import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from './db.ts';
import { encryptData } from './security/security.ts';
import { LOCKED_DATA_PLACEHOLDER, LEGACY_LOCKED_DATA_PLACEHOLDER } from './locked-field-guard.ts';

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

test('review decrypts exact ENC bytes and separates explicit null, empty text and invalid content', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    db.setKey(key);
    try {
        assert.equal(await db.decryptPatientProfileReviewNotes(null), null);
        for (const value of ['', 'Testo sintetico\ncompleto', { unexpected: true }, null]) {
            const cipher = await encryptData(value, key), notes = `ENC:${cipher.iv}:${cipher.data}`;
            if (typeof value === 'string') assert.equal(await db.decryptPatientProfileReviewNotes(notes), value);
            else await assert.rejects(db.decryptPatientProfileReviewNotes(notes));
        }
        for (const notes of ['plaintext', 'ENC:broken', 'ENC:AAAA:AAAA']) await assert.rejects(db.decryptPatientProfileReviewNotes(notes));
        const cipher = await encryptData('Synthetic pending note', key);
        const pending = db.decryptPatientProfileReviewNotes(`ENC:${cipher.iv}:${cipher.data}`);
        db.setKey(null); await assert.rejects(pending);
    } finally { db.setKey(null); }
});

test('review recipient uses the same key and refuses unreadable names or locked placeholders', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const cipher = await encryptData('Ada', key);
    const recipient = { firstName: `ENC:${cipher.iv}:${cipher.data}`, lastName: 'Sintetica' };
    db.setKey(key);
    try {
        assert.equal(await db.decryptPatientProfileReviewRecipient(recipient), 'Sintetica Ada');
        for (const firstName of ['', 'ENC:broken', LOCKED_DATA_PLACEHOLDER, LEGACY_LOCKED_DATA_PLACEHOLDER, 'a'.repeat(2049)]) {
            await assert.rejects(db.decryptPatientProfileReviewRecipient({ ...recipient, firstName }));
        }
        const pending = db.decryptPatientProfileReviewRecipient(recipient);
        db.setKey(null); await assert.rejects(pending);
    } finally { db.setKey(null); }
});
