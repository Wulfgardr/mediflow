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

test('the client tells a blocked restore from a failed one and verifies through the route that cannot write', async t => {
    const { BackupRestoreBlockedError, db, importRawDatabase, verifyRawDatabase } = await import('./db.ts');
    const urls: string[] = [];
    let answer = (): Response => Response.json({});
    t.mock.method(globalThis, 'fetch', async (url: unknown) => { urls.push(String(url)); return answer(); });
    const key = await generateMasterKey();
    const artifact = await artifactSealedWith(key);
    try {
        db.setKey(key);
        answer = () => Response.json({ success: false, code: 'restore_blocked', reason: 'audit', error: 'Ripristino bloccato: i dati attuali non sono stati modificati.' }, { status: 409 });
        await assert.rejects(importRawDatabase(artifact),
            (error: unknown) => error instanceof BackupRestoreBlockedError && error.reason === 'audit');
        answer = () => Response.json({ success: true, createdAt: '2026-10-10T08:00:00.000Z', collections: ['patients', 'entries'], counts: { patients: 2, entries: 3 } });
        assert.deepEqual(await verifyRawDatabase(artifact), { createdAt: '2026-10-10T08:00:00.000Z', collections: 2, records: 5 });
        assert.deepEqual(urls, ['/api/system/backup-restore', '/api/system/backup-restore/verify']);
        // A different key stops the verification before any request, as it stops the restore.
        db.setKey(await generateMasterKey());
        await assert.rejects(verifyRawDatabase(artifact), /chiave diversa/);
        assert.equal(urls.length, 2);
    } finally { db.setKey(null); }
});

test('the Web restore checks prior diary text with the same archive key before sending', async t => {
    const { db, verifyRawDatabase } = await import('./db.ts');
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls += 1; return Response.json({
        success: true, createdAt: '2026-10-10T08:00:00.000Z', collections: ['entryRevisions'], counts: { entryRevisions: 1 },
        expectedSnapshot: 'a'.repeat(64), sourceChecksum: 'b'.repeat(64),
    }); });
    const key = await generateMasterKey();
    const current = await seal(key);
    const foreign = await seal(await generateMasterKey());
    const backup = (content: string) => artifact({ entries: [{ content: current }], entryRevisions: [{ content }] });
    db.setKey(key);
    try {
        await assert.rejects(verifyRawDatabase(backup(foreign)), BackupRestoreKeyError);
        assert.equal(calls, 0);
        await verifyRawDatabase(backup(current));
        assert.equal(calls, 1);
    } finally { db.setKey(null); }
});

test('Web restore admits legacy history only with the same key and patient binding', async t => {
    const { prepareLegacyRevisionProtection } = await import('./diary-revision-envelope.ts');
    const { sealPreviousDiaryText } = await import('./diary-revision-legacy-write.ts');
    const { db, verifyRawDatabase } = await import('./db.ts');
    const key = await generateMasterKey();
    const binding = { patientId: 'synthetic-patient', entryId: 'synthetic-entry', version: 1 };
    const revision = sealPreviousDiaryText(binding, { title: 'Titolo sintetico', content: 'Nota legacy sintetica' },
        await prepareLegacyRevisionProtection(binding, key));
    const backup = (patientId = binding.patientId) => artifact({
        entries: [{ id: binding.entryId, patientId }],
        entryRevisions: [{ ...revision, version: binding.version, entryId: binding.entryId }],
    });
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => { requests += 1; return Response.json({
        success: true, createdAt: '2026-10-10T08:00:00.000Z', collections: ['entryRevisions'], counts: { entryRevisions: 1 },
        expectedSnapshot: 'a'.repeat(64), sourceChecksum: 'b'.repeat(64),
    }); });
    try {
        db.setKey(await generateMasterKey());
        await assert.rejects(verifyRawDatabase(backup()), BackupRestoreKeyError);
        db.setKey(key);
        await assert.rejects(verifyRawDatabase(backup('synthetic-other-patient')), BackupRestoreKeyError);
        assert.equal(requests, 0);
        await verifyRawDatabase(backup());
        assert.equal(requests, 1);
    } finally { db.setKey(null); }
});
