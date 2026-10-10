/* @Codex: packaged native first-install preserves non-empty directories. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import reservationContract from './native-first-install-contract.json' with { type: 'json' };

const root = process.cwd();
const helper = path.join(root, 'scripts/native-first-install.mjs');

function withDirectory(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-native-first-install-'));
    try { run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function reserve(directory, cwd = root, executable = helper) {
    return spawnSync(process.execPath, [executable, '--create-empty-only'], {
        cwd,
        env: { ...process.env, MEDIFLOW_DATA_DIR: directory, MEDIFLOW_DB_PATH: path.join(directory, 'medical.db') },
        encoding: 'utf8',
        timeout: 5_000,
    });
}

function assertReservation(database) {
    assert.ok(fs.statSync(database).size > 0);
    const db = new Database(database, { readonly: true, fileMustExist: true });
    try {
        assert.equal(db.pragma('application_id', { simple: true }), 0x4d464652);
        assert.equal(reservationContract.applicationId, 0x4d464652);
        assert.equal(db.pragma('user_version', { simple: true }), 0);
        assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
        assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all(), []);
    } finally { db.close(); }
}

test('packaged first install reserves only a genuinely empty synthetic directory', () => {
    withDirectory((directory) => {
        const result = reserve(directory);
        assert.equal(result.status, 0, result.stderr);
        const database = path.join(directory, 'medical.db');
        assert.ok(fs.existsSync(database));
        assertReservation(database);
        assert.deepEqual(fs.readdirSync(directory), ['medical.db']);
    });
});

test('the SQLite reservation reaches the existing auth bootstrap as a ready empty account', () => {
    withDirectory((directory) => {
        assert.equal(process.versions.node.split('.', 1)[0], '24', 'run this source-route test with the project Node 24 runtime');
        const reservation = reserve(directory);
        assert.equal(reservation.status, 0, reservation.stderr);
        const database = path.join(directory, 'medical.db');
        assertReservation(database);

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
        const initialized = new Database(database, { readonly: true });
        try { assert.ok(initialized.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'users'").get()); } finally { initialized.close(); }
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

test('a legacy file in cwd cannot bypass the selected native directory checks', () => {
    withDirectory((sandbox) => {
        const legacy = path.join(sandbox, 'medical.db');
        const original = Buffer.from('synthetic-unselected-legacy');
        fs.writeFileSync(legacy, original);
        const fresh = path.join(sandbox, 'fresh');
        const result = reserve(fresh, sandbox);
        assert.equal(result.status, 0, result.stderr);
        assertReservation(path.join(fresh, 'medical.db'));

        const incomplete = path.join(sandbox, 'incomplete');
        fs.mkdirSync(incomplete);
        fs.writeFileSync(path.join(incomplete, 'recovery-marker'), 'synthetic-recovery');
        const refused = reserve(incomplete, sandbox);
        assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /NATIVE_DATA_DIRECTORY_NOT_EMPTY_WITHOUT_DATABASE/u);
        assert.deepEqual(fs.readdirSync(incomplete), ['recovery-marker']);
        assert.equal(fs.readFileSync(path.join(incomplete, 'recovery-marker'), 'utf8'), 'synthetic-recovery');
        assert.deepEqual(fs.readFileSync(legacy), original);
    });
});

test('an existing truncated zero-byte archive is never promoted to a fresh reservation', () => {
    withDirectory((directory) => {
        const database = path.join(directory, 'medical.db');
        fs.writeFileSync(database, '');
        const result = reserve(directory);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.statSync(database).size, 0);
        assert.deepEqual(fs.readdirSync(directory), ['medical.db']);
    });
});

test('the packaged helper resolves the relocated SQLite binding and adjacent contract', () => {
    withDirectory((sandbox) => {
        const contents = path.join(sandbox, 'Synthetic.app/Contents');
        const web = path.join(contents, 'Resources/WebRuntime');
        const frameworks = path.join(contents, 'Frameworks');
        const packageSource = path.join(root, 'node_modules/better-sqlite3');
        const packageTarget = path.join(web, 'node_modules/better-sqlite3');
        fs.mkdirSync(packageTarget, { recursive: true });
        fs.mkdirSync(frameworks, { recursive: true });
        fs.cpSync(path.join(packageSource, 'lib'), path.join(packageTarget, 'lib'), { recursive: true });
        fs.copyFileSync(path.join(packageSource, 'package.json'), path.join(packageTarget, 'package.json'));
        fs.copyFileSync(path.join(packageSource, 'build/Release/better_sqlite3.node'), path.join(frameworks, 'mediflow-web-better-sqlite3.node'));
        const loaderPath = path.join(packageTarget, 'lib/database.js');
        const original = "require('bindings')('better_sqlite3.node')";
        const relocated = "require('../../../../../Frameworks/mediflow-web-better-sqlite3.node')";
        // Match the packaging contract exactly, then exercise its real native addon.
        assert.ok(fs.readFileSync(path.join(root, 'scripts/check-macos-web-runtime-native-payload.sh'), 'utf8').includes(relocated));
        const loader = fs.readFileSync(loaderPath, 'utf8');
        assert.equal(loader.split(original).length - 1, 1);
        fs.writeFileSync(loaderPath, loader.replace(original, relocated));
        const packagedHelper = path.join(web, 'native-first-install.mjs');
        fs.copyFileSync(helper, packagedHelper);
        fs.copyFileSync(path.join(root, 'scripts/native-first-install-contract.json'), path.join(web, 'native-first-install-contract.json'));
        const directory = path.join(sandbox, 'data');
        const result = reserve(directory, sandbox, packagedHelper);
        assert.equal(result.status, 0, result.stderr);
        assertReservation(path.join(directory, 'medical.db'));
        assert.deepEqual(fs.readdirSync(directory), ['medical.db']);
    });
});
