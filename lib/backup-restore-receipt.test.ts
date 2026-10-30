import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { createEmptyDataset, serializeBackupArtifact } from './backup-artifact';
import { parseRestoreIntent } from './backup-restore-receipt';

const id = '12345678-1234-4123-8123-123456789012';
const loader = path.resolve('scripts/register-strip-types-loader.mjs');
function owned(directory: string) {
    const temp = fs.realpathSync(os.tmpdir());
    assert.ok(fs.realpathSync(directory).startsWith(temp + path.sep));
    assert.ok(path.basename(directory).startsWith('mf-g3-synthetic-'));
    return directory;
}
function child(directory: string, source: string) {
    owned(directory);
    return spawnSync(process.execPath, ['--import', loader, '--input-type=module', '--eval', source], {
        encoding: 'utf8', env: { ...process.env, MEDIFLOW_DATA_DIR: directory, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' },
    });
}
test('restore requires the exact keyword, operation id and snapshot together', () => {
    const headers = { 'x-mediflow-restore-id': id, 'x-mediflow-restore-snapshot': 'a'.repeat(64), 'x-mediflow-restore-confirmation': 'RIPRISTINA' };
    assert.deepEqual(parseRestoreIntent(new Request('http://localhost', { headers })), { id, expectedSnapshot: 'a'.repeat(64) });
    for (const key of Object.keys(headers)) {
        const invalid = { ...headers }; delete invalid[key as keyof typeof headers];
        assert.throws(() => parseRestoreIntent(new Request('http://localhost', { headers: invalid })));
    }
    assert.equal(parseRestoreIntent(new Request('http://localhost')), null);
});
for (const mode of ['cancel', 'conflict', 'crash', 'committed-crash', 'success', 'receipt-ignore', 'clinical-ignore', 'clear-ignore'] as const) {
    test(`synthetic restore ${mode}: keys, history, records and receipt follow the transaction`, async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-g3-synthetic-'));
        try {
            owned(directory);
            execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: directory, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' }, stdio: 'pipe' });
            const seeded = child(directory, `
                import { openDbServer } from './lib/db-server.ts';
                const db = openDbServer();
                db.prepare("INSERT INTO patients(id,first_name,last_name,tax_code,notes) VALUES ('before','Persona','Sintetica','SYN-BEFORE','ENC:opaque-key-preservation')").run();
            `);
            assert.equal(seeded.status, 0, seeded.stderr);
            const file = path.join(owned(directory), 'medical.db');
            const before = new Database(file, { readonly: true });
            const keys = before.prepare('SELECT * FROM users ORDER BY id').all();
            const audit = before.prepare('SELECT * FROM audit_events ORDER BY event_id').all();
            const generation = before.prepare('SELECT * FROM archive_generation').all();
            before.close();
            const payload = createEmptyDataset();
            payload.patients = [{ id: 'after', firstName: 'Persona', lastName: 'Recuperata sintetica', taxCode: 'SYN-AFTER', notes: 'ENC:opaque-key-preservation' }];
            payload.attachments = [{ id: 'file-after', patientId: 'after', name: 'Sintetico', type: 'text/plain', size: 5, path: 'sintetico.txt', data: 'ENC:opaque-attachment', documentSourceRef: 'a'.repeat(64), documentRevision: 1, documentFreshnessEpoch: 1 }];
            const artifact = JSON.parse(await serializeBackupArtifact(payload));
            fs.writeFileSync(path.join(owned(directory), 'backup.json'), JSON.stringify(artifact));
            const run = child(directory, `
                import fs from 'node:fs'; import path from 'node:path';
                import { openDbServer } from './lib/db-server.ts';
                import { parseBackupArtifact } from './lib/backup-artifact.ts';
                import { restoreBackupArtifact } from './lib/backup-restore-executor.ts';
                import { restoreSnapshot } from './lib/backup-restore-receipt.ts';
                const db = openDbServer();
                const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(path.join(process.env.MEDIFLOW_DATA_DIR, 'backup.json'), 'utf8')));
                const intent = { id: '${id}', expectedSnapshot: restoreSnapshot(db) };
                if ('${mode}' === 'conflict') db.prepare("UPDATE patients SET notes='concurrent',version=version+1 WHERE id='before'").run();
                if ('${mode}' === 'crash') {
                    db.function('synthetic_crash', () => process.kill(process.pid, 'SIGKILL'));
                    db.exec("CREATE TRIGGER synthetic_crash_mid_restore AFTER DELETE ON patients BEGIN SELECT synthetic_crash(); END");
                }
                if ('${mode}' === 'receipt-ignore') db.exec("CREATE TRIGGER synthetic_receipt_ignore BEFORE INSERT ON settings WHEN NEW.key LIKE 'archive.restore.receipt.%' BEGIN SELECT RAISE(IGNORE); END");
                if ('${mode}' === 'clear-ignore') db.exec("CREATE TRIGGER synthetic_patient_clear_ignore BEFORE DELETE ON patients BEGIN SELECT RAISE(IGNORE); END");
                if ('${mode}' === 'clinical-ignore') db.exec("CREATE TRIGGER synthetic_attachment_ignore BEFORE INSERT ON attachments BEGIN SELECT RAISE(IGNORE); END");
                if ('${mode}' !== 'cancel') {
                    try { restoreBackupArtifact(artifact, () => false, intent); }
                    catch (error) { if (!(('${mode}' === 'conflict' && error.reason === 'snapshot') || ('${mode}' === 'receipt-ignore' && error.message === 'RESTORE_RECEIPT_NOT_PERSISTED') || ('${mode}' === 'clinical-ignore' && error.message === 'RESTORE_ROWS_NOT_PERSISTED') || ('${mode}' === 'clear-ignore' && error.message === 'RESTORE_ROWS_NOT_CLEARED'))) throw error; }
                }
                if ('${mode}' === 'committed-crash') process.kill(process.pid, 'SIGKILL');
            `);
            if (mode.includes('crash')) assert.equal(run.signal, 'SIGKILL', run.stderr);
            else assert.equal(run.status, 0, run.stderr);
            const observed = new Database(file, { readonly: true });
            try {
                assert.equal(observed.pragma('integrity_check', { simple: true }), 'ok');
                assert.deepEqual(observed.prepare('SELECT * FROM users ORDER BY id').all(), keys);
                assert.deepEqual(observed.prepare('SELECT * FROM audit_events ORDER BY event_id').all(), audit);
                const committed = mode === 'success' || mode === 'committed-crash';
                assert.deepEqual(observed.prepare('SELECT id FROM patients').all(), [{ id: committed ? 'after' : 'before' }]);
                const receipt = observed.prepare('SELECT value FROM settings WHERE key=?').get('archive.restore.receipt.' + id) as { value: string } | undefined;
                if (committed) {
                    assert.ok(receipt);
                    const parsed = JSON.parse(receipt.value);
                    assert.equal(parsed.id, id); assert.equal(parsed.sourceChecksum, artifact.manifest.checksum);
                    assert.notDeepEqual(observed.prepare('SELECT * FROM archive_generation').all(), generation);
                    assert.equal((observed.prepare('SELECT data FROM attachments WHERE id=?').get('file-after') as { data: string }).data, 'ENC:opaque-attachment');
                } else { assert.equal(receipt, undefined); assert.deepEqual(observed.prepare('SELECT * FROM archive_generation').all(), generation); }
            } finally { observed.close(); }
        } finally { fs.rmSync(owned(directory), { recursive: true, force: true }); }
    });
}
