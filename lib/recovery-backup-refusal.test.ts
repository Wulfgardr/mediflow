import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openVersionedSqliteDatabase } from './sqlite-schema-open';
import { createRecoverySnapshot, createRecoverySnapshotStream, recoveryBackupCapacity } from './recovery-backup-server';
import { decryptRecoveryBackup, encryptRecoveryBackup } from './recovery-backup';
import { generateMasterKey } from './security/security';
import { createRecoveryWrapping, createUnlockWrapping, hashAccessVerifier } from './security/unlock-credential';
import {
    RECOVERY_BACKUP_REFUSALS, RecoverySnapshotRefusedError, recoveryBackupRefusalMessage, recoveryBackupRefusalResponse, type RecoveryBackupRefusal,
} from './recovery-backup-refusal';

const actor = '11111111-1111-4111-8111-111111111111';
const passphrase = 'passphrase sintetica del backup';

async function archive(account: 'passphrase' | 'legacy-pin') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-recovery-refusal-'));
    const db = openVersionedSqliteDatabase(path.join(root, 'medical.db'));
    const key = await generateMasterKey();
    if (account === 'passphrase') {
        const wrapping = await createUnlockWrapping(key, passphrase);
        const recovery = await createRecoveryWrapping(key);
        db.prepare(`INSERT INTO users(id, username, role, password_hash, encrypted_master_key, salt, unlock_verifier_hash,
            recovery_wrapped_master_key, recovery_salt, recovery_verifier_hash) VALUES (?, 'synthetic-admin', 'admin', 'synthetic-confirmation-hash', ?, ?, ?, ?, ?, ?)`)
            .run(actor, wrapping.encryptedMasterKey, wrapping.salt, await hashAccessVerifier(wrapping.verifier),
                recovery.wrappedMasterKey, recovery.salt, await hashAccessVerifier(recovery.verifier));
    } else {
        db.prepare(`INSERT INTO users(id, username, role, password_hash, encrypted_master_key, salt)
            VALUES (?, 'synthetic-admin', 'admin', 'synthetic-pin-hash', 'v2:synthetic-pin-wrapping', 'synthetic-salt')`).run(actor);
    }
    return { db, key, cleanup: () => { if (db.open) db.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

function refusal(run: () => unknown): RecoveryBackupRefusal {
    try { run(); } catch (error) {
        assert.ok(error instanceof RecoverySnapshotRefusedError, `unexpected ${String(error)}`);
        return error.reason;
    }
    assert.fail('the snapshot was not refused');
}

test('an unlocked passphrase administrator needs no kit file: the snapshot is encrypted and passes the existing verification', async () => {
    const a = await archive('passphrase');
    try {
        const artifact = await encryptRecoveryBackup(createRecoverySnapshot(a.db, actor), a.key);
        const verified = await decryptRecoveryBackup(artifact, a.key);
        assert.equal(Buffer.from(verified.subarray(0, 15)).toString(), 'SQLite format 3');
    } finally { a.cleanup(); }
});

test('an account without a recovery wrapping is refused with its own reason, never as a generic failure', async () => {
    const a = await archive('legacy-pin');
    try {
        assert.equal(refusal(() => createRecoverySnapshot(a.db, actor)), 'recovery_wrapping_missing');
    } finally { a.cleanup(); }
});

test('an archive whose references do not resolve is refused as inconsistent', async () => {
    const a = await archive('passphrase');
    try {
        a.db.pragma('foreign_keys = OFF');
        a.db.prepare("INSERT INTO entries(id, patient_id, type, date, content) VALUES ('synthetic-orphan', 'synthetic-missing-patient', 'note', 1783000000, 'x')").run();
        a.db.pragma('foreign_keys = ON');
        assert.equal(refusal(() => createRecoverySnapshot(a.db, actor)), 'archive_inconsistent');
    } finally { a.cleanup(); }
});

test('every refusal is an explained response with its code, and only an internal error is a 500', async () => {
    for (const [reason, { status, message }] of Object.entries(RECOVERY_BACKUP_REFUSALS) as [RecoveryBackupRefusal, { status: number; message: string }][]) {
        const response = recoveryBackupRefusalResponse(reason);
        assert.equal(response.status, status);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await response.json(), { error: message, code: reason });
        assert.equal(recoveryBackupRefusalMessage(status, reason), message);
        assert.doesNotMatch(message, /—/u);
        if (reason !== 'backup_failed') assert.notEqual(status, 500, reason);
    }
    assert.match(recoveryBackupRefusalMessage(409, 'recovery_wrapping_missing'), /chiave di recupero/u);
    assert.doesNotMatch(recoveryBackupRefusalMessage(413, 'archive_too_large'), /kit|Rinnova/u);
    assert.doesNotMatch(recoveryBackupRefusalMessage(409, 'archive_inconsistent'), /kit|Rinnova/u);
    assert.equal(recoveryBackupRefusalMessage(401, null), RECOVERY_BACKUP_REFUSALS.session_expired.message);
    assert.equal(recoveryBackupRefusalMessage(403, 'forged'), RECOVERY_BACKUP_REFUSALS.administrator_required.message);
    assert.equal(recoveryBackupRefusalMessage(409, 'archive_too_large'), RECOVERY_BACKUP_REFUSALS.backup_failed.message);
});

test('the capacity check sees a nearly full archive disk before a copy is made', async t => {
    const a = await archive('passphrase');
    try {
        const disk = fs.statfsSync(path.dirname(a.db.name));
        t.mock.method(fs, 'statfsSync', () => ({ ...disk, bavail: 1 }));
        assert.equal(recoveryBackupCapacity(a.db), 'local_space');
        assert.deepEqual(fs.readdirSync(path.dirname(a.db.name)).filter(name => name.startsWith('.recovery-backup-')), []);
    } finally { a.cleanup(); }
});

test('cancel and expiry release the snapshot descriptor', async t => {
    const a = await archive('passphrase');
    const open = fs.openSync;
    let descriptor = -1;
    t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
        const fd = open(...args);
        if (String(args[0]).endsWith('snapshot.db') && args[1] === 'r') descriptor = fd;
        return fd;
    });
    try {
        const canceled = createRecoverySnapshotStream(a.db, actor);
        assert.ok(descriptor >= 0);
        await canceled.body.cancel();
        assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });

        const session = new AbortController();
        const expired = createRecoverySnapshotStream(a.db, actor, { signal: session.signal });
        session.abort();
        await assert.rejects(expired.body.getReader().read(), { name: 'AbortError' });
        assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
        assert.deepEqual(fs.readdirSync(path.dirname(a.db.name)).filter(name => name.startsWith('.recovery-backup-')), []);
    } finally { a.cleanup(); }
});
