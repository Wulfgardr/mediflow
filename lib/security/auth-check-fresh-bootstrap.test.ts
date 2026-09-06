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
for (const scenario of ['empty', 'missing-existing', 'unknown-schema'] as const) {
    test(`first auth check: ${scenario}`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-first-auth-'));
        try {
            const script = `
                import assert from 'node:assert/strict';
                import fs from 'node:fs';
                import path from 'node:path';
                const directory = process.env.MEDIFLOW_DATA_DIR;
                const database = path.join(directory, 'medical.db');
                const scenario = ${JSON.stringify(scenario)};
                if (scenario === 'missing-existing') fs.writeFileSync(path.join(directory, 'existing-workspace.txt'), 'synthetic');
                if (scenario === 'unknown-schema') {
                    const { default: Database } = await import('better-sqlite3');
                    const db = new Database(database);
                    db.exec('CREATE TABLE unknown_workspace (id TEXT)');
                    db.close();
                }
                const { GET } = await import('./app/api/auth/check/route.ts');
                const response = await GET(new Request('http://127.0.0.1/api/auth/check'));
                const body = await response.json();
                if (scenario === 'empty') {
                    assert.equal(body.status, 'ok');
                    assert.equal(body.isSetup, false);
                    assert.equal(body.hasSession, false);
                    assert.deepEqual(body.db, { state: 'ready' });
                    assert.ok(fs.existsSync(database));
                    const second = await GET(new Request('http://127.0.0.1/api/auth/check'));
                    assert.equal((await second.json()).status, 'ok');
                } else if (scenario === 'missing-existing') {
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
