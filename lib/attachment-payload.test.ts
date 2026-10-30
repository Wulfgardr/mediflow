import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSealedAttachmentFileData, isSealedAttachmentValue, getAttachmentPayloadByteSize } from './attachment-payload';

test('attachment payload validator accepts encrypted client envelopes', () => {
    const payload = 'ENC:abc+/=:def+/=';

    assert.deepEqual(getAttachmentPayloadByteSize(payload), {
        ok: true,
        size: Buffer.byteLength(payload, 'utf8'),
    });
});

test('attachment payload validator accepts plain base64 and data URLs', () => {
    assert.deepEqual(getAttachmentPayloadByteSize('YWJjZA=='), { ok: true, size: 8 });

    const dataUrl = 'data:text/plain;base64,YWJjZA==';
    assert.deepEqual(getAttachmentPayloadByteSize(dataUrl), {
        ok: true,
        size: Buffer.byteLength(dataUrl, 'utf8'),
    });
});

test('ENC2 validates exact parts, byte lengths, base64 alphabet and canonical padding only for data', () => {
    const parts = ['ENC2', 'A'.repeat(16), 'A'.repeat(64), 'A'.repeat(16), Buffer.alloc(17).toString('base64')];
    const valid = parts.join(':');
    assert.equal(isSealedAttachmentFileData(valid), true);
    assert.equal(isSealedAttachmentValue(valid), false);
    for (let index = 1; index <= 4; index += 1) {
        for (const value of ['', 'A', parts[index]!.slice(1), `${parts[index]}:extra`, `${parts[index]}\n`, '!'.repeat(parts[index]!.length)]) {
            const changed = [...parts]; changed[index] = value;
            assert.equal(isSealedAttachmentFileData(changed.join(':')), false);
        }
    }
    for (const payload of [Buffer.alloc(16).toString('base64'), 'A'.repeat(21) + 'B==', 'A'.repeat(22) + 'B=', 'A'.repeat(20) + '=AAA']) {
        assert.equal(isSealedAttachmentFileData([...parts.slice(0, 4), payload].join(':')), false);
    }
    assert.equal(isSealedAttachmentFileData(`${valid}:extra`), false);
});
