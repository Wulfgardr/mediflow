import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isFileEnvelope, openPatientDocumentFile, sealPatientDocumentFile } from './attachment-file-envelope';
import { verifyPatientDocumentFile } from '../patient-document-file-verification';
import { assertBackupReadableWithKey } from '../backup-restore-key-check';
import { isSealedAttachmentData, isSealedAttachmentValue } from '../attachment-payload';
import { parseAttachmentContentCurrentnessPut } from '../api-schemas/attachments';
import { db } from '../db';
import { LOCKED_CIPHERTEXT_KEY, LOCKED_DATA_PLACEHOLDER } from '../locked-field-guard';
const golden = JSON.parse(readFileSync('native/contracts/attachment-file-golden.v2.json', 'utf8'));
const master = () => crypto.subtle.importKey('raw', Buffer.from(golden.masterKey, 'base64'), 'AES-GCM', false, ['encrypt', 'decrypt']);

test('independent shared Node vector opens in Web and authenticates every component', async () => {
    const key = await master();
    assert.equal(await openPatientDocumentFile(golden.data, key), `data:application/pdf;base64,${golden.original}`);
    for (let part = 1; part <= 4; part++) {
        const values = golden.data.split(':'); const bytes = Buffer.from(values[part], 'base64'); bytes[0] ^= 1; values[part] = bytes.toString('base64');
        await assert.rejects(openPatientDocumentFile(values.join(':'), key));
    }
    assert(!isFileEnvelope(golden.data + ':extra'));
    assert(isSealedAttachmentData(golden.data));
    assert(!isSealedAttachmentValue(golden.data), 'metadata validation stays ENC only');
    assert(parseAttachmentContentCurrentnessPut({ expected: { sourceRef: 'a'.repeat(64), revision: 1, freshnessEpoch: 1 }, replacement: golden.data }));
    const a = await sealPatientDocumentFile(Buffer.from(golden.original, 'base64'), key);
    const b = await sealPatientDocumentFile(Buffer.from(golden.original, 'base64'), key);
    assert.notEqual(a.data, b.data); assert.notDeepEqual(a.fileKey, b.fileKey);
    assert.equal(await openPatientDocumentFile(a.data, key), await openPatientDocumentFile(b.data, key));
    a.fileKey.fill(0); b.fileKey.fill(0);
});
for (const fault of ['none', 'different', 'tag', 'key'] as const) test(`owned raw key and plaintext buffers are zeroed after ${fault}`, t => {
    const value = structuredClone(golden), original = Buffer.from(golden.original, 'base64');
    if (fault === 'different') original[0] ^= 1;
    if (fault === 'tag') value.data = value.data.slice(0, -4) + 'AAAA';
    if (fault === 'key') value.fileKey[0] ^= 1;
    const buffers: Buffer[] = [];
    const from = Buffer.from.bind(Buffer), equals = Buffer.prototype.equals;
    t.mock.method(Buffer, 'from', (...args: Parameters<typeof Buffer.from>) => {
        const result = from(...args); if (args[0] === value.fileKey) buffers.push(result); return result;
    });
    t.mock.method(Buffer.prototype, 'equals', function(this: Buffer, other: Uint8Array) {
        buffers.push(this); return equals.call(this, other);
    });
    if (fault === 'none') verifyPatientDocumentFile(value, original);
    else assert.throws(() => verifyPatientDocumentFile(value, original), { message: 'Native patient document denied' });
    assert(value.fileKey.every((byte: number) => byte === 0));
    assert(buffers.length >= 1); for (const buffer of buffers) assert(buffer.every(byte => byte === 0));
});
test('Web attachment reader, locked ciphertext and restore key check handle ENC2', async t => {
    const key = await master();
    t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'invented', data: golden.data }));
    try {
        db.setKey(null);
        assert.equal((await db.attachments.get('invented'))?.data, LOCKED_DATA_PLACEHOLDER);
        db.setKey(key);
        assert.equal((await db.attachments.get('invented'))?.data, `data:application/pdf;base64,${golden.original}`);
        db.setKey(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
        const locked = await db.attachments.get('invented');
        assert.equal(locked?.data, LOCKED_DATA_PLACEHOLDER);
        assert.equal((locked as unknown as Record<string, Record<string, string>>)[LOCKED_CIPHERTEXT_KEY].data, golden.data);
        const artifact = JSON.stringify({ payload: { attachments: [{ data: golden.data }] } });
        await assertBackupReadableWithKey(artifact, key, { attachments: ['data'] });
        await assert.rejects(assertBackupReadableWithKey(artifact, null, { attachments: ['data'] }));
        await assert.rejects(assertBackupReadableWithKey(artifact, await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']), { attachments: ['data'] }));
    } finally { db.setKey(null); }
});
