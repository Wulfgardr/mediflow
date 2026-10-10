import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBackupReadableWithKey, BackupRestoreKeyError } from './backup-restore-key-check.ts';
import { encryptData, generateMasterKey } from './security/security.ts';

async function artifactSealedWith(key: CryptoKey): Promise<string> {
    const sealed = await encryptData('synthetic clinical note', key);
    return JSON.stringify({ payload: { patients: [{ id: 'synthetic' }], entries: [{ id: 'e1', content: `ENC:${sealed.iv}:${sealed.data}` }] } });
}

test('a backup is admitted only with the key that sealed it', async () => {
    const key = await generateMasterKey();
    const artifact = await artifactSealedWith(key);
    await assertBackupReadableWithKey(artifact, key);
    await assert.rejects(assertBackupReadableWithKey(artifact, await generateMasterKey()), BackupRestoreKeyError);
    await assert.rejects(assertBackupReadableWithKey(artifact, null), BackupRestoreKeyError);
    await assert.rejects(assertBackupReadableWithKey(JSON.stringify({ payload: { entries: [{ content: 'ENC:truncated' }] } }), key), BackupRestoreKeyError);
    // Nothing to read, or nothing parseable: the server preflight decides.
    await assertBackupReadableWithKey(JSON.stringify({ payload: { patients: [{ id: 'plain' }] } }), null);
    await assertBackupReadableWithKey('not json', null);
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
