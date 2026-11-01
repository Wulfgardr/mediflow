import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import * as scheduler from './backup-scheduler.ts';
import * as policy from '../scripts/backup-destination-policy.mjs';
import { isWebAdminSession } from './security/server-auth-policy.ts';
import { WindowsPrivateDirectoryError } from '../scripts/windows-private-directory.mjs';

test('route-attacks: atomic revision, stale and simultaneous writers, rejected symlinks and legacy destination preserved', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-route-')));
    const db = new Database(path.join(root, 'synthetic.sqlite'));
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    let installed = false;
    let installs = 0;
    let actor: { role: string; authChannel: string } | null = { role: 'admin', authChannel: 'web' };
    const read = () => db.prepare('SELECT value FROM settings WHERE key=?').get('backupScheduler') as { value: string } | undefined;
    const status = (value: string) => {
        const state = scheduler.readBackupSchedulerStateFromValue(value);
        return { supported: true, installed, state: { ...state, revision: scheduler.backupSchedulerRevision(state) } };
    };
    const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
    const destinationPolicy = { ...policy };
    const dependencies: Record<string, unknown> = {
        'node:crypto': { randomUUID },
        '@/scripts/backup-destination-policy.mjs': destinationPolicy,
        '@/lib/api-error-response': { archiveReplacementResponse: () => null, apiInternalError: () => json({}, { status: 500 }) },
        '@/lib/security/archive-write-request': { archiveWriteRequestDenial: () => null },
        'next/server': { NextResponse: { json } }, 'drizzle-orm': { eq: () => true },
        '@/lib/db-server': {
            runDbServerImmediateTransaction: (fn: () => unknown) => db.transaction(fn).immediate(),
            dbServer: { select: () => ({ from: () => ({ where: () => ({ get: read }) }) }), insert: () => ({ values: (row: { key: string; value: string }) => ({ onConflictDoUpdate: () => ({ run: () => db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(row.key, row.value) }) }) }) },
        },
        '@/lib/schema': { settings: { key: 'key' } },
        '@/lib/security/server-auth': { requireSession: async () => actor, forbiddenResponse: () => json({}, { status: 403 }), unauthorizedResponse: () => json({}, { status: 401 }) },
        '@/lib/security/server-auth-policy': { isWebAdminSession },
        '@/lib/security/audit': { auditContextFromSession: () => ({}), requestIdFromRequest: () => null, withAuditContextMetadata: (_: unknown, v: unknown) => v, writeAuditEvent: async () => {} },
        '@/lib/backup-scheduler': scheduler,
        '@/lib/backup-scheduler-adapter': { buildBackupSchedulerStatus: status, getSchedulerAdapter: () => ({ isSupported: () => true, getStatus: () => ({ installed }), install: () => { assert.equal(db.inTransaction, true); installed = true; installs++; }, uninstall: () => { installed = false; installs++; } }) },
    };
    const exports: Record<string, (request?: Request) => Promise<Response>> = {};
    const source = fs.readFileSync(new URL('../app/api/system/backup-scheduler/route.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, console, process });
    const post = (config: unknown, revision?: string) => exports.POST(new Request('http://127.0.0.1/api/system/backup-scheduler', { method: 'POST', body: JSON.stringify({ action: 'save', config, expectedRevision: revision }) }));
    try {
        const initial = await (await exports.GET()).json();
        const config = { ...initial.state.config, enabled: false, hour: 4, destinationDir: root };
        const first = await post(config, initial.state.revision);
        assert.equal(first.status, 200);
        const committed = read()?.value;
        const calls = installs;
        assert.equal((await post({ ...config, hour: 2 }, initial.state.revision)).status, 409);
        assert.equal((await post(config)).status, 409);
        assert.equal(read()?.value, committed);
        assert.equal(installs, calls);
        const revision = (await first.json()).state.revision;
        const concurrent = await Promise.all([post({ ...config, hour: 5 }, revision), post({ ...config, hour: 6 }, revision)]);
        assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
        const current = await (await exports.GET()).json();
        const cloud = path.join(root, 'CloudStorage', 'OneDrive');
        fs.mkdirSync(cloud, { recursive: true });
        const alias = path.join(root, 'ordinary');
        fs.symlinkSync(cloud, alias, 'junction');
        for (const destinationDir of [cloud, alias, path.join(root, 'absent-volume', 'backups')]) {
            const before = read()?.value;
            const count = installs;
            assert.equal((await post({ ...config, enabled: true, destinationDir, volumeProtectionAcknowledged: true }, current.state.revision)).status, 422);
            assert.equal(read()?.value, before);
            assert.equal(installs, count);
        }
        assert.equal(fs.existsSync(path.join(root, 'absent-volume')), false);
        if (process.platform === 'win32') {
            const originalSpawn = childProcess.spawnSync;
            childProcess.spawnSync = ((file: string, args: string[], ...options: unknown[]) =>
                file === 'powershell.exe' && args.some(arg => arg.includes('Get-BitLockerVolume'))
                    ? { status: 1, stdout: '', stderr: 'Synthetic unavailable volume probe' }
                    : Reflect.apply(originalSpawn, childProcess, [file, args, ...options])) as typeof childProcess.spawnSync;
            syncBuiltinESMExports();
            try {
                const saved = await post({ ...config, enabled: true, volumeProtectionAcknowledged: true }, current.state.revision);
                assert.equal(saved.status, 200);
                const actual = path.join(root, '.mediflow-private');
                assert.equal(JSON.parse(read()!.value).config.destinationDir, fs.realpathSync(actual));
                const legacy = path.join(root, 'mediflow-backup-v1-2026-10-01.mediflow');
                fs.writeFileSync(legacy, 'synthetic old parent copy');
                for (const day of [1, 2, 3]) fs.writeFileSync(path.join(actual, `mediflow-backup-v1-2026-11-0${day}.mediflow`), 'synthetic');
                const old = new Date(Date.now() - 60 * 60_000);
                const temp = path.join(actual, 'mediflow-backup-v1-2026-11-04.mediflow.tmp');
                fs.writeFileSync(temp, 'synthetic pending');
                fs.utimesSync(temp, old, old);
                fs.writeFileSync(path.join(actual, '.mediflow-backup.lock'), 'synthetic active lock');
                const preview = scheduler.previewBackupRetention({ destinationDir: root, retentionKeepArtifacts: 1 });
                assert.equal(preview.destinationDir, fs.realpathSync(actual));
                assert.equal(preview.artifactCount, 3);
                assert.equal(preview.deleteCount, 2);
                assert.equal(preview.orphanTempCount, 0);
                const parsedLegacy = scheduler.readBackupSchedulerStateFromValue(JSON.stringify({ config: { destinationDir: root } }));
                assert.equal(parsedLegacy.config.destinationDir, actual);
                assert.equal(fs.readFileSync(legacy, 'utf8'), 'synthetic old parent copy');
                assert.equal(fs.readdirSync(actual).filter(name => name.endsWith('.mediflow')).length, 3);
            } finally { childProcess.spawnSync = originalSpawn; syncBuiltinESMExports(); }
        }
        const validDestination = destinationPolicy.validateBackupDestination;
        for (const reason of ['existing', 'filesystem', 'blocked']) {
            const denial = new WindowsPrivateDirectoryError(reason);
            destinationPolicy.validateBackupDestination = () => { throw new policy.BackupDestinationError(denial.userMessage, denial.code); };
            const fresh = await (await exports.GET()).json();
            const response = await post({ ...config, enabled: true }, fresh.state.revision);
            assert.equal(response.status, 422);
            const problem = await response.json();
            assert.equal(problem.code, denial.code);
            assert.equal(problem.error, denial.userMessage);
        }
        destinationPolicy.validateBackupDestination = validDestination;
        for (const principal of [null, { role: 'physician', authChannel: 'web' }, { role: 'admin', authChannel: 'native' }]) {
            actor = principal;
            assert.equal((await post(config, revision)).status, principal ? 403 : 401);
        }
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
