import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { openVersionedSqliteDatabase } from './sqlite-schema-open';
import { createUnlockWrapping, createRecoveryWrapping, hashAccessVerifier } from './security/unlock-credential';
import { prepareSyntheticBackupDestination } from './scheduled-backup.test-support.ts';
import { recordWebAgentLifecycle } from './test-fixtures/web-agent-lifecycle';

const MiB = 1024 * 1024;
const scale = Number(process.env.MEDIFLOW_BACKUP_TEST_MIB ?? '8');
const actor = '11111111-1111-4111-8111-111111111111';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const repo = path.resolve(import.meta.dirname, '..');
const loader = pathToFileURL(path.join(repo, 'scripts/register-strip-types-loader.mjs')).href;
const memoryProbe = 'data:text/javascript,' + encodeURIComponent(
    "process.on('exit', () => console.error('backup-rss-kib=' + process.resourceUsage().maxRSS));",
);
const archiveEnv = (dataDir: string) => ({ ...process.env, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
    NODE_OPTIONS: '--max-old-space-size=128' });

function assertMemory(diagnostics: (message: string) => void, label: string, output: string) {
    const rss = Number(/backup-rss-kib=(\d+)/u.exec(output)?.[1]);
    diagnostics(`${label} peak RSS ${Math.ceil(rss / 1024)} MiB`);
    assert.ok(rss > 0 && rss < 512 * 1024, `${label}: RSS ${rss} KiB`);
}

function assertRestored(dataDir: string, expected: Map<string, string>, audit: AuditRow[]) {
    const restored = openVersionedSqliteDatabase(path.join(dataDir, 'medical.db'));
    try {
        assert.deepEqual(attachmentDigests(restored), expected);
        const originalIds = new Set(audit.map(row => row.event_id));
        assert.deepEqual(readAudit(restored).filter(row => originalIds.has(row.event_id)), audit);
        assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
    } finally { restored.close(); }
}

type Archive = ReturnType<typeof openVersionedSqliteDatabase>;
type AuditRow = { event_id: string; proposer_ref: string | null };
function readAudit(db: Archive): AuditRow[] {
    return db.prepare('SELECT * FROM audit_events ORDER BY event_id').all() as AuditRow[];
}

function attachmentDigests(db: Archive): Map<string, string> {
    const result = new Map<string, string>();
    for (const row of db.prepare('SELECT * FROM attachments ORDER BY id').iterate() as Iterable<{ id: string }>) {
        result.set(row.id, digest(JSON.stringify(row)));
    }
    return result;
}

async function fixture(root: string) {
    assert.ok(Number.isSafeInteger(scale) && scale > 0 && scale <= 2048);
    const dataDir = path.join(root, 'source');
    fs.mkdirSync(dataDir);
    const db = openVersionedSqliteDatabase(path.join(dataDir, 'medical.db'));
    const rawKey = randomBytes(32);
    const masterKey = await crypto.subtle.importKey('raw', new Uint8Array(rawKey), 'AES-GCM', true, ['encrypt', 'decrypt']);
    const wrapping = await createUnlockWrapping(masterKey, 'Passphrase sintetica per la prova backup');
    const recovery = await createRecoveryWrapping(masterKey);
    const syntheticAccount = 'synthetic-admin-' + randomBytes(8).toString('hex');
    const kit = { schemaVersion: 'mediflow.recovery-kit.v1' as const, username: syntheticAccount,
        wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt };
    try {
        db.prepare(`INSERT INTO users(id, username, role, password_hash, encrypted_master_key, salt, unlock_verifier_hash,
            recovery_wrapped_master_key, recovery_salt, recovery_verifier_hash) VALUES (?, ?, 'admin', 'synthetic-confirmation-hash', ?, ?, ?, ?, ?, ?)`)
            .run(actor, kit.username, wrapping.encryptedMasterKey, wrapping.salt, await hashAccessVerifier(wrapping.verifier),
                recovery.wrappedMasterKey, recovery.salt, await hashAccessVerifier(recovery.verifier));
        db.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code)
            VALUES ('synthetic-patient', 'Synthetic', 'Backup', 'SYNTHETIC-BACKUP')`).run();
        const insert = db.prepare(`INSERT INTO attachments (id, patient_id, name, type, size, path, data,
            document_source_ref, document_revision, document_freshness_epoch)
            VALUES (?, 'synthetic-patient', ?, 'application/pdf', ?, ?, ?, ?, 1, 1)`);
        const bytes = Buffer.from(JSON.stringify(randomBytes(9 * MiB / 16 - 3).toString('base64')));
        for (let i = 0; i < scale; i++) {
            const id = String(i).padStart(4, '0');
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', rawKey, iv);
            const data = 'ENC:' + iv.toString('base64') + ':' +
                Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]).toString('base64');
            insert.run(id, `synthetic-${id}.pdf`, bytes.length, `attachments/synthetic-${id}.pdf`, data, digest(id));
        }
        recordWebAgentLifecycle(db, actor);
        db.prepare("INSERT INTO settings VALUES ('backupScheduler', ?)").run(JSON.stringify({ config: { enabled: true } }));
        db.pragma('wal_checkpoint(TRUNCATE)');
        const audit = readAudit(db);
        assert.equal(audit.filter(row => row.proposer_ref !== null).length, 3);
        return { dataDir, expected: attachmentDigests(db), kit, audit, recoveryKey: recovery.recoveryKey };
    } finally { rawKey.fill(0); db.close(); }
}

test('scheduled and recovery backups cross the archive size boundary', { timeout: 600_000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-backup-scale-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = await fixture(root);
    const kitPath = path.join(root, 'kit.json');
    fs.writeFileSync(kitPath, JSON.stringify(source.kit), { mode: 0o600 });
    const probe = (operation: string, artifact: string, dataDir: string) => spawnSync(process.execPath,
        ['--import', memoryProbe, '--import', loader, 'lib/test-fixtures/backup-streaming-probe.ts', operation, artifact, kitPath, actor],
        { cwd: repo, encoding: 'utf8', input: source.recoveryKey, timeout: 300_000, env: archiveEnv(dataDir) });
    await t.test('scheduled runner creates, verifies and restores the artifact with scheduling enabled', subtest => {
        const dest = path.join(root, 'scheduled');
        const preload = prepareSyntheticBackupDestination(source.dataDir, dest);
        const child = spawnSync(process.execPath, ['--import', memoryProbe, '--import', preload, 'scripts/run-scheduled-backup.mjs'], {
            cwd: repo, encoding: 'utf8', timeout: 300_000,
            env: { ...archiveEnv(source.dataDir), MEDIFLOW_BACKUP_DEST_DIR: dest, MEDIFLOW_BACKUP_FORCE: '0' },
        });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stdout + child.stderr);
        assertMemory(subtest.diagnostic.bind(subtest), 'Scheduled writer', child.stderr);
        const report = JSON.parse(child.stdout);
        assert.ok(fs.statSync(report.artifactPath).size > scale * MiB);
        const dataDir = path.join(root, 'scheduled-restored');
        fs.mkdirSync(dataDir);
        const restored = probe('scheduled-restore', report.artifactPath, dataDir);
        assert.ifError(restored.error);
        assert.equal(restored.status, 0, restored.stdout + restored.stderr);
        assertMemory(subtest.diagnostic.bind(subtest), 'Scheduled verify and restore', restored.stderr);
        assertRestored(dataDir, source.expected, source.audit);
    });
    await t.test('recovery creates and verifies a complete copy and restores it with the kit and key', { skip: process.platform === 'win32' }, async subtest => {
        const recovery = await import('./recovery-backup-server');
        if (typeof (recovery as Partial<typeof recovery>).createRecoverySnapshotStream !== 'function') {
            const archive = openVersionedSqliteDatabase(path.join(source.dataDir, 'medical.db'));
            try { recovery.createRecoverySnapshot(archive, actor); } finally { archive.close(); }
            assert.fail('Recovery creation did not use the streaming boundary');
        }
        const artifact = path.join(root, 'synthetic.mediflow-recovery');
        const created = probe('recovery', artifact, source.dataDir);
        assert.ifError(created.error);
        assert.equal(created.status, 0, created.stdout + created.stderr);
        assertMemory(subtest.diagnostic.bind(subtest), 'Recovery writer and verifier', created.stderr);
        assert.ok(fs.statSync(artifact).size > scale * MiB);
        const dataDir = path.join(root, 'recovery-restored');
        fs.mkdirSync(dataDir);
        const output = execFileSync('python3', ['scripts/fixtures/recovery-cli-pty.py'], {
            cwd: repo, encoding: 'utf8', timeout: 300_000, env: archiveEnv(dataDir),
            input: JSON.stringify({ command: [process.execPath, '--import', memoryProbe, '--import', loader,
                'scripts/restore-recovery-backup.ts', '--backup', artifact, '--kit', kitPath, '--data-dir', dataDir, '--source-retired'],
            key: source.recoveryKey }),
        });
        assert.match(output, /Archivio ripristinato/u);
        assert.ok(!output.includes(source.recoveryKey));
        assertMemory(subtest.diagnostic.bind(subtest), 'Offline recovery', output);
        assertRestored(dataDir, source.expected, source.audit);
    });
});
