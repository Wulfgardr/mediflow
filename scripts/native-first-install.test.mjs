/* @Codex: packaged native first-install preserves non-empty directories. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const helper = path.join(root, 'scripts/native-first-install.mjs');

function withDirectory(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-native-first-install-'));
    try { run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function reserve(directory) {
    return spawnSync(process.execPath, [helper, '--create-empty-only'], {
        cwd: root,
        env: { ...process.env, MEDIFLOW_DATA_DIR: directory, MEDIFLOW_DB_PATH: path.join(directory, 'medical.db') },
        encoding: 'utf8',
        timeout: 5_000,
    });
}

test('packaged first install reserves only a genuinely empty synthetic directory', () => {
    withDirectory((directory) => {
        const result = reserve(directory);
        assert.equal(result.status, 0, result.stderr);
        const database = path.join(directory, 'medical.db');
        assert.ok(fs.existsSync(database));
        assert.equal(fs.statSync(database).size, 0);
        assert.deepEqual(fs.readdirSync(directory), ['medical.db']);
    });
});

test('the zero-byte reservation reaches the existing auth bootstrap as a ready empty account', () => {
    withDirectory((directory) => {
        assert.equal(process.versions.node.split('.', 1)[0], '24', 'run this source-route test with the project Node 24 runtime');
        const reservation = reserve(directory);
        assert.equal(reservation.status, 0, reservation.stderr);
        const database = path.join(directory, 'medical.db');
        assert.equal(fs.statSync(database).size, 0);

        const authCheck = spawnSync(process.execPath, [
            path.join(root, 'scripts/run-strip-types.mjs'),
            '--input-type=module',
            '--eval',
            "const { GET } = await import('./app/api/auth/check/route.ts'); const response = await GET(new Request('http://127.0.0.1/api/auth/check')); const body = await response.json(); if (response.status !== 200 || body.status !== 'ok' || body.isSetup !== false || body.db?.state !== 'ready') { console.error(JSON.stringify({ status: response.status, body })); process.exit(1); }",
        ], {
            cwd: root,
            // This is the real source route; packaged-app startup remains a separate runtime check.
            env: { ...process.env, MEDIFLOW_DATA_DIR: directory, MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
            encoding: 'utf8',
            timeout: 30_000,
        });

        assert.equal(authCheck.status, 0, authCheck.stderr || authCheck.stdout);
        assert.ok(fs.statSync(database).size > 0, 'auth bootstrap must materialize the reserved SQLite file');
    });
});

test('packaged first install fails closed when runtime metadata precedes a missing database', () => {
    withDirectory((directory) => {
        fs.mkdirSync(path.join(directory, 'logs'));
        fs.writeFileSync(path.join(directory, 'local-web-backend.pid'), '99999\n');
        const before = fs.readdirSync(directory).sort();

        const result = reserve(directory);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /NATIVE_DATA_DIRECTORY_NOT_EMPTY_WITHOUT_DATABASE/u);
        assert.equal(fs.existsSync(path.join(directory, 'medical.db')), false);
        assert.deepEqual(fs.readdirSync(directory).sort(), before);
    });
});

test('packaged first install never overwrites an existing database file', () => {
    withDirectory((directory) => {
        const database = path.join(directory, 'medical.db');
        const original = Buffer.from('synthetic-existing-database-bytes');
        fs.writeFileSync(database, original, { mode: 0o600 });

        const result = reserve(directory);

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(fs.readFileSync(database), original);
    });
});
