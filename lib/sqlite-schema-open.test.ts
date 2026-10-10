import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { initializeSqliteSchema } from './sqlite-schema';
import { openVersionedSqliteDatabase, CURRENT_SQLITE_SCHEMA_VERSION } from './sqlite-schema-open';
import reservation from '../scripts/native-first-install-contract.json' with { type: 'json' };

const loader = pathToFileURL(path.resolve('scripts/register-strip-types-loader.mjs')).href;
function workspace() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-schema-open-'));
    return { directory, file: path.join(directory, 'medical.db'), cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
function seed(file: string, missingColumn = false) {
    const db = new Database(file);
    db.pragma('foreign_keys = ON');
    initializeSqliteSchema(db);
    db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('synthetic-original', 'preserved');
    if (missingColumn) db.exec('ALTER TABLE patients DROP COLUMN monitoring_profile');
    return db;
}
function originals(directory: string) { return fs.readdirSync(directory).filter(name => name.includes('.schema-original-')); }
function columns(db: Database.Database) { return (db.pragma('table_info(patients)') as { name: string }[]).map(row => row.name); }

test('fresh and reserved archives consume admission atomically; repeated open does not migrate', () => {
    for (const reserved of [false, true]) {
        const w = workspace();
        try {
            if (reserved) {
                const db = new Database(w.file);
                db.pragma(`application_id = ${reservation.applicationId}`);
                db.close();
            }
            let db = openVersionedSqliteDatabase(w.file);
            assert.equal(db.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
            assert.equal(db.pragma('application_id', { simple: true }), 0);
            assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
            db.close();
            db = openVersionedSqliteDatabase(w.file); db.close();
            assert.deepEqual(originals(w.directory), []);
        } finally { w.cleanup(); }
    }
});

test('upgrade preserves a verified original before DDL and does not repeat on restart', () => {
    const w = workspace();
    try {
        seed(w.file, true).close();
        let db = openVersionedSqliteDatabase(w.file);
        assert.ok(columns(db).includes('monitoring_profile'));
        assert.equal(db.prepare('SELECT value FROM settings WHERE key=?').pluck().get('synthetic-original'), 'preserved');
        db.close();
        const names = originals(w.directory); assert.equal(names.length, 1);
        const original = new Database(path.join(w.directory, names[0]), { readonly: true });
        assert.equal(original.pragma('integrity_check', { simple: true }), 'ok');
        assert.equal(original.pragma('user_version', { simple: true }), 0);
        assert.equal(columns(original).includes('monitoring_profile'), false);
        assert.equal(original.prepare('SELECT value FROM settings WHERE key=?').pluck().get('synthetic-original'), 'preserved');
        original.close();
        db = openVersionedSqliteDatabase(w.file); db.close();
        assert.deepEqual(originals(w.directory), names);
    } finally { w.cleanup(); }
});

test('future versions, corrupt and unreserved empty files are preserved and refused', () => {
    for (const scenario of ['future', 'corrupt', 'zero', 'empty', 'missing-existing', 'current-drift']) {
        const w = workspace();
        try {
            if (scenario === 'future') { const db = seed(w.file); db.pragma('user_version = 2'); db.close(); }
            if (scenario === 'current-drift') { const db = seed(w.file, true); db.pragma('user_version = 1'); db.close(); }
            if (scenario === 'corrupt') fs.writeFileSync(w.file, 'synthetic non SQLite bytes');
            if (scenario === 'zero') fs.writeFileSync(w.file, '');
            if (scenario === 'empty') { const db = new Database(w.file); db.pragma('user_version = 0'); db.close(); }
            if (scenario === 'missing-existing') fs.writeFileSync(path.join(w.directory, 'archive-metadata'), 'synthetic');
            const before = fs.existsSync(w.file) ? fs.readFileSync(w.file) : null;
            assert.throws(() => openVersionedSqliteDatabase(w.file), scenario);
            assert.deepEqual(fs.existsSync(w.file) ? fs.readFileSync(w.file) : null, before, scenario);
            assert.deepEqual(originals(w.directory), []);
        } finally { w.cleanup(); }
    }
});

test('failed snapshot publication and unsupported schema roll back without claiming a version', () => {
    for (const scenario of ['snapshot', 'schema', 'view']) {
        const w = workspace();
        const link = fs.linkSync;
        try {
            const db = seed(w.file, true);
            if (scenario === 'schema') db.exec('CREATE TABLE unsupported_schema (id TEXT)');
            if (scenario === 'view') db.exec('CREATE VIEW unsupported_view AS SELECT value FROM settings');
            db.close();
            if (scenario === 'snapshot') fs.linkSync = ((source, destination) => {
                if (String(destination).includes('.schema-original-')) throw new Error('synthetic snapshot publication failure');
                return link(source, destination);
            }) as typeof fs.linkSync;
            assert.throws(() => openVersionedSqliteDatabase(w.file), scenario === 'snapshot' ? /synthetic snapshot publication failure/ : /unsupported schema|unsupported view/);
            const after = new Database(w.file);
            assert.equal(after.pragma('user_version', { simple: true }), 0);
            assert.equal(columns(after).includes('monitoring_profile'), false);
            assert.equal(after.prepare('SELECT value FROM settings WHERE key=?').pluck().get('synthetic-original'), 'preserved');
            if (scenario === 'schema') assert.ok(after.prepare("SELECT name FROM sqlite_schema WHERE name='unsupported_schema'").get());
            if (scenario === 'view') assert.ok(after.prepare("SELECT name FROM sqlite_schema WHERE name='unsupported_view'").get());
            after.close();
        } finally { fs.linkSync = link; w.cleanup(); }
    }
});

test('another writer blocks migration without a snapshot or DDL', () => {
    const w = workspace(); let owner: Database.Database | undefined;
    try {
        owner = seed(w.file, true); owner.exec('BEGIN IMMEDIATE');
        const child = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '-e', `
            import assert from 'node:assert/strict';
            import { openVersionedSqliteDatabase } from './lib/sqlite-schema-open.ts';
            assert.throws(() => openVersionedSqliteDatabase(process.env.SYNTHETIC_SCHEMA_FILE), { code: 'SQLITE_BUSY' });
        `], { cwd: process.cwd(), env: { ...process.env, SYNTHETIC_SCHEMA_FILE: w.file }, encoding: 'utf8', timeout: 15_000 });
        assert.equal(child.status, 0, child.stderr || child.stdout);
        assert.equal(owner.pragma('user_version', { simple: true }), 0);
        assert.equal(columns(owner).includes('monitoring_profile'), false);
        assert.deepEqual(originals(w.directory), []);
    } finally { if (owner?.inTransaction) owner.exec('ROLLBACK'); owner?.close(); w.cleanup(); }
});

test('process interruption before schema stamp rolls back and the next start safely migrates', async () => {
    const w = workspace();
    let child: ReturnType<typeof spawn> | undefined;
    try {
        seed(w.file, true).close();
        child = spawn(process.execPath, ['--import', loader, '--input-type=module', '-e', `
            import Database from 'better-sqlite3';
            const original = Database.prototype.pragma;
            Database.prototype.pragma = function(sql, ...args) {
                if (sql === 'user_version = 1') {
                    process.send({ phase: 'schema-ready-before-stamp' });
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
                }
                return original.call(this, sql, ...args);
            };
            const { openVersionedSqliteDatabase } = await import('./lib/sqlite-schema-open.ts');
            openVersionedSqliteDatabase(process.env.SYNTHETIC_SCHEMA_FILE);
        `], { cwd: process.cwd(), env: { ...process.env, SYNTHETIC_SCHEMA_FILE: w.file }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        let output = '';
        child.stderr?.on('data', chunk => { output += String(chunk); });
        const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()));
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`migration barrier not reached: ${output}`)), 15_000);
            child!.once('message', message => { clearTimeout(timer); assert.deepEqual(message, { phase: 'schema-ready-before-stamp' }); resolve(); });
            child!.once('exit', () => { clearTimeout(timer); reject(new Error(`migration child exited early: ${output}`)); });
            child!.once('error', error => { clearTimeout(timer); reject(error); });
        });
        child.kill('SIGKILL'); await exited;
        const recovered = new Database(w.file);
        assert.equal(recovered.pragma('user_version', { simple: true }), 0);
        assert.equal(columns(recovered).includes('monitoring_profile'), false);
        assert.equal(recovered.prepare('SELECT value FROM settings WHERE key=?').pluck().get('synthetic-original'), 'preserved');
        recovered.close();
        assert.equal(originals(w.directory).length, 1);
        const reopened = openVersionedSqliteDatabase(w.file);
        assert.equal(reopened.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
        assert.ok(columns(reopened).includes('monitoring_profile'));
        reopened.close();
    } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
            const exited = new Promise<void>(resolve => child!.once('exit', () => resolve())); child.kill('SIGKILL'); await exited;
        }
        w.cleanup();
    }
});
