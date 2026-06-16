/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAttachmentPayloadByteSize } from './attachment-payload';

/* @Codex */
test('attachment payload validator accepts encrypted client envelopes', () => {
    const payload = 'ENC:abc+/=:def+/=';

    assert.deepEqual(getAttachmentPayloadByteSize(payload), {
        ok: true,
        size: Buffer.byteLength(payload, 'utf8'),
    });
});

/* @Codex */
test('attachment payload validator accepts plain base64 and data URLs', () => {
    assert.deepEqual(getAttachmentPayloadByteSize('YWJjZA=='), { ok: true, size: 8 });

    const dataUrl = 'data:text/plain;base64,YWJjZA==';
    assert.deepEqual(getAttachmentPayloadByteSize(dataUrl), {
        ok: true,
        size: Buffer.byteLength(dataUrl, 'utf8'),
    });
});
