import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import * as scheduler from './backup-scheduler.ts';
import * as policy from '../scripts/backup-destination-policy.mjs';
import { isWebAdminSession } from './security/server-auth-policy.ts';

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
    const dependencies: Record<string, unknown> = {
        'node:crypto': { randomUUID },
        '@/scripts/backup-destination-policy.mjs': policy,
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
        for (const principal of [null, { role: 'physician', authChannel: 'web' }, { role: 'admin', authChannel: 'native' }]) {
            actor = principal;
            assert.equal((await post(config, revision)).status, principal ? 403 : 401);
        }
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
