/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Each first request owns a new process and directory: no DB module, fixture
// seed or preliminary API request can initialize the database before auth.
for (const scenario of ['empty', 'service-only', 'service-with-unknown', 'backup', 'sqlite-sidecar', 'unknown-directory', 'launcher-unknown-location', 'service-symlink', 'service-wrong-type', 'missing-existing', 'unknown-schema', 'native-empty', 'native-missing-existing', ...(process.platform === 'darwin' ? ['default-launcher'] : [])] as const) {
    test(`first auth check: ${scenario}`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-first-auth-'));
        try {
            const script = `
                import assert from 'node:assert/strict';
                import fs from 'node:fs';
                import path from 'node:path';
                let directory = process.env.MEDIFLOW_DATA_DIR;
                const scenario = ${JSON.stringify(scenario)};
                if (scenario === 'default-launcher') {
                    process.env.HOME = directory;
                    const { prepareLauncherState } = await import('./scripts/launcher-state.mjs');
                    prepareLauncherState(process.cwd(), { home: directory, env: {} });
                    directory = path.join(directory, 'Library/Application Support/MediFlow');
                    process.env.MEDIFLOW_DATA_DIR = directory;
                }
                const database = path.join(directory, 'medical.db');
                if (scenario === 'missing-existing' || scenario === 'native-missing-existing') fs.writeFileSync(path.join(directory, 'existing-workspace.txt'), 'synthetic');
                if (scenario === 'service-only' || scenario === 'service-with-unknown') {
                    fs.mkdirSync(path.join(directory, 'pm2'));
                    fs.writeFileSync(path.join(directory, 'pm2', 'pm2.log'), 'synthetic');
                    for (const file of ['local-api-token', 'local-web-backend.pid', 'local-api-tls-proxy.pid', 'runtime-status.json']) {
                        fs.writeFileSync(path.join(directory, file), 'synthetic');
                    }
                    if (scenario === 'service-with-unknown') fs.writeFileSync(path.join(directory, 'unknown.txt'), 'synthetic');
                }
                if (scenario === 'backup') fs.writeFileSync(path.join(directory, 'backup.zip'), 'synthetic');
                if (scenario === 'sqlite-sidecar') fs.writeFileSync(path.join(directory, 'medical.db-wal'), 'synthetic');
                if (scenario === 'launcher-unknown-location') fs.mkdirSync(path.join(directory, 'launcher'));
                if (scenario === 'unknown-directory') fs.mkdirSync(path.join(directory, 'unknown'));
                if (scenario === 'service-wrong-type') fs.writeFileSync(path.join(directory, 'pm2'), 'synthetic');
                if (scenario === 'service-symlink') {
                    fs.symlinkSync(directory, path.join(directory, 'pm2'), 'dir');
                }
                if (scenario === 'unknown-schema') {
                    const { default: Database } = await import('better-sqlite3');
                    const db = new Database(database);
                    db.exec('CREATE TABLE unknown_workspace (id TEXT)');
                    db.close();
                }
                if (scenario.startsWith('native-')) {
                    if (scenario === 'native-missing-existing') {
                        await assert.rejects(
                            import('./scripts/native-first-install.mjs'),
                            /NATIVE_DATA_DIRECTORY_NOT_EMPTY_WITHOUT_DATABASE/u
                        );
                        assert.equal(fs.existsSync(database), false);
                        process.exit(0);
                    }
                    await import('./scripts/native-first-install.mjs');
                    // TLS setup writes metadata before the first Web request.
                    fs.writeFileSync(path.join(directory, 'runtime-status.json'), '{}');
                    fs.mkdirSync(path.join(directory, 'certs'));
                }
                const { GET } = await import('./app/api/auth/check/route.ts');
                const response = await GET(new Request('http://127.0.0.1/api/auth/check'));
                const body = await response.json();
                if (scenario === 'empty' || scenario === 'service-only' || scenario === 'default-launcher' || scenario === 'native-empty') {
                    assert.equal(body.status, 'ok');
                    assert.equal(body.isSetup, false);
                    assert.equal(body.hasSession, false);
                    assert.deepEqual(body.db, { state: 'ready' });
                    assert.ok(fs.existsSync(database));
                    const second = await GET(new Request('http://127.0.0.1/api/auth/check'));
                    assert.equal((await second.json()).status, 'ok');
                } else if (scenario !== 'unknown-schema') {
                    assert.equal(body.error.code, 'DB_MISSING');
                    assert.equal(fs.existsSync(database), false);
                } else {
                    assert.equal(body.status, 'error');
                    assert.equal(body.isSetup, false);
                    const { default: Database } = await import('better-sqlite3');
                    const db = new Database(database, { readonly: true });
                    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), [{ name: 'unknown_workspace' }]);
                    db.close();
                }
            `;
            const result = spawnSync(process.execPath, [
                '--import', pathToFileURL(path.resolve('scripts/register-strip-types-loader.mjs')).href,
                '--input-type=module', '-e', script,
            ], { cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: directory }, encoding: 'utf8', timeout: 30_000 });
            assert.equal(result.status, 0, result.stderr || result.stdout);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
}
