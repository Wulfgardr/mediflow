import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBackupReadableWithKey, BackupRestoreKeyError } from './backup-restore-key-check.ts';
import { encryptData, generateMasterKey } from './security/security.ts';

const FIELDS = { entries: ['content'], patients: ['notes'], siss_handoff_events: ['reason'] };
const seal = async (key: CryptoKey) => { const sealed = await encryptData('synthetic clinical note', key); return `ENC:${sealed.iv}:${sealed.data}`; };
const artifact = (payload: Record<string, unknown>) => JSON.stringify({ payload });
async function artifactSealedWith(key: CryptoKey): Promise<string> {
    return artifact({ patients: [{ id: 'synthetic' }], entries: [{ id: 'e1', content: await seal(key) }] });
}

test('a backup is admitted only when the key reads every sealed contract field', async () => {
    const key = await generateMasterKey(), other = await generateMasterKey();
    await assertBackupReadableWithKey(await artifactSealedWith(key), key, FIELDS);
    await assert.rejects(assertBackupReadableWithKey(await artifactSealedWith(key), other, FIELDS), BackupRestoreKeyError);
    await assert.rejects(assertBackupReadableWithKey(await artifactSealedWith(key), null, FIELDS), BackupRestoreKeyError);
    await assert.rejects(assertBackupReadableWithKey(artifact({ entries: [{ content: 'ENC:truncated' }] }), key, FIELDS), BackupRestoreKeyError);
    // One field sealed with another key is enough, also in the irregularly named collection.
    await assert.rejects(assertBackupReadableWithKey(artifact({ entries: [{ content: await seal(key) }], patients: [{ notes: await seal(other) }] }), key, FIELDS), BackupRestoreKeyError);
    await assert.rejects(assertBackupReadableWithKey(artifact({ sissHandoffs: [{ reason: await seal(other) }] }), key, FIELDS), BackupRestoreKeyError);
    // Text that merely starts with "ENC:" outside the contract is plain data.
    await assertBackupReadableWithKey(artifact({ ambulatories: [{ description: 'ENC:literal label' }], entries: [{ content: await seal(key) }] }), key, FIELDS);
    // Nothing sealed, or nothing parseable: the server preflight decides.
    await assertBackupReadableWithKey(artifact({ patients: [{ id: 'plain' }] }), null, FIELDS);
    await assertBackupReadableWithKey('not json', null, FIELDS);
});

test('the client restore sends nothing when the unlocked key cannot read the backup', async t => {
    const { db, importRawDatabase } = await import('./db.ts');
    const requests: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (...args: unknown[]) => { requests.push(args); return Response.json({ success: true }); });
    const key = await generateMasterKey();
    const artifact = await artifactSealedWith(key);
    try {
        db.setKey(await generateMasterKey());
        await assert.rejects(importRawDatabase(artifact), /chiave diversa/);
        assert.equal(requests.length, 0);
        db.setKey(key);
        await importRawDatabase(artifact);
        assert.equal(requests.length, 1);
    } finally { db.setKey(null); }
});
