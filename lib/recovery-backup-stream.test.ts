import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptRecoveryBackup } from './recovery-backup';
import { encryptRecoveryBackupStream, readRecoveryBackup, RECOVERY_BLOCK_BYTES } from './recovery-backup-stream';

const encoder = new TextEncoder();

async function encrypt(plain: Uint8Array<ArrayBuffer>, key: CryptoKey) {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    await encryptRecoveryBackupStream(new Blob([plain]).stream(), plain.length, key, bytes => { parts.push(bytes); });
    return new Blob(parts);
}

test('recovery authenticates the header, every block, exact file length and final tag', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const plaintext = new Uint8Array(2 * RECOVERY_BLOCK_BYTES + 123);
    plaintext.set(encoder.encode('SQLite format 3\0'));
    const valid = await encrypt(plaintext, key);
    const another = await encrypt(plaintext, key);
    await readRecoveryBackup(valid, key);
    const header = 76, record = RECOVERY_BLOCK_BYTES + 16;
    const first = valid.slice(header, header + record), second = valid.slice(header + record, header + 2 * record);
    const tail = valid.slice(header + 2 * record);
    const prefix = valid.slice(0, header);
    const lastByte = new Uint8Array(await valid.slice(-1).arrayBuffer());
    const changed = new Uint8Array(await first.arrayBuffer());
    changed[17] ^= 1;
    const badHeader = new Uint8Array(await prefix.arrayBuffer());
    badHeader[75] ^= 1;
    for (const [label, backup] of Object.entries({
        altered: new Blob([prefix, changed, second, tail]),
        missing: new Blob([prefix, first, tail]),
        reordered: new Blob([prefix, second, first, tail]),
        duplicate: new Blob([prefix, first, first, tail]),
        spliced: new Blob([prefix, first, another.slice(header + record, header + 2 * record), tail]),
        truncated: valid.slice(0, -16),
        extended: new Blob([valid, lastByte]),
        header: new Blob([badHeader, first, second, tail]),
        finalTag: new Blob([valid.slice(0, -1), Uint8Array.of(lastByte[0] ^ 1)]),
    })) {
        await assert.rejects(readRecoveryBackup(backup, key), () => true, label);
    }
});

test('the file reader still verifies v1 backups with a non-extractable key', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const plaintext = new Uint8Array(100);
    plaintext.set(encoder.encode('SQLite format 3\0'));
    const v1 = await encryptRecoveryBackup(plaintext, key);
    await readRecoveryBackup(new Blob([new Uint8Array(v1)]), key, bytes => { assert.deepEqual(bytes, plaintext); });
});
