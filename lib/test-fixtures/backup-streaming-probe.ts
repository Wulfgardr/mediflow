import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openVersionedSqliteDatabase } from '../sqlite-schema-open.ts';
import { openRecoveryWrapping } from '../security/unlock-credential';
import { parseRecoveryKit, type RecoveryKit } from '../recovery-backup';

const [operation, artifactPath, kitPath, actorId] = process.argv.slice(2);
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir);
const kit = parseRecoveryKit(fs.readFileSync(kitPath, 'utf8'));

async function main(options: RecoveryKit) {
    const recoveryKey = fs.readFileSync(0, 'utf8');
    const { masterKey } = await openRecoveryWrapping(options.wrappedMasterKey, options.salt, recoveryKey);
    if (operation === 'recovery') {
        const { createRecoverySnapshotStream } = await import('../recovery-backup-server');
        const { encryptRecoveryBackupStream, readRecoveryBackup } = await import('../recovery-backup-stream');
        const archive = openVersionedSqliteDatabase(path.join(dataDir!, 'medical.db'));
        try {
            const { body, size } = createRecoverySnapshotStream(archive, actorId);
            const sink = fs.openSync(artifactPath, 'wx', 0o600);
            try { await encryptRecoveryBackupStream(body, size, masterKey, chunk => fs.writeFileSync(sink, chunk)); }
            finally { fs.closeSync(sink); }
            await readRecoveryBackup(await fs.openAsBlob(artifactPath), masterKey);
            console.log(JSON.stringify({ ok: true, size }));
        } finally { archive.close(); }
        return;
    }
    assert.equal(operation, 'scheduled-restore');
    const { db, importRawDatabase, verifyRawDatabase } = await import('../db');
    const { withBackupRestoreRequest } = await import('../backup-restore-preflight');
    const { readRestorePreview } = await import('../backup-restore-receipt');
    const { restoreBackupArtifact } = await import('../backup-restore-executor');
    const { backupArtifactInputChecksum } = await import('../backup-artifact');
    db.setKey(masterKey);
    const artifactFile = await fs.openAsBlob(artifactPath);
    globalThis.fetch = async (url, init) => {
        assert.equal(init?.body, artifactFile);
        const request = new Request(new URL(String(url), 'http://127.0.0.1'), init);
        return withBackupRestoreRequest(request, ({ artifact, result }) => {
            assert.ok(result.ok && artifact, result.error);
            const checksum = backupArtifactInputChecksum(artifact);
            if (request.url.endsWith('/verify')) return Response.json({
                ...readRestorePreview(artifact), sourceChecksum: checksum, counts: artifact.manifest.recordCounts,
            });
            const expectedSnapshot = request.headers.get('x-mediflow-restore-snapshot');
            const expectedSourceChecksum = request.headers.get('x-mediflow-restore-source-checksum');
            assert.ok(expectedSnapshot);
            assert.equal(expectedSourceChecksum, checksum);
            assert.equal(request.headers.get('x-mediflow-restore-confirmation'), 'RIPRISTINA');
            return Response.json(restoreBackupArtifact(artifact, () => true,
                { id: '12345678-1234-4123-8123-123456789012', expectedSnapshot, expectedSourceChecksum }));
        });
    };
    const verification = await verifyRawDatabase(artifactFile);
    assert.ok(verification.records > 0);
    await importRawDatabase({ id: '12345678-1234-4123-8123-123456789012', source: artifactFile, verification },
        { verifier: 'synthetic-probe' });
    assert.ok(!fs.readdirSync(dataDir!).some(name => name.startsWith('.portable-restore-')));
    console.log(JSON.stringify({ ok: true, records: verification.records }));
}

await main(kit);
