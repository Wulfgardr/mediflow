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

test('opening an older owner-owned archive makes the database and live WAL sidecars private without losing data', { skip: process.platform === 'win32' }, () => {
    const w = workspace();
    let writer: Database.Database | undefined;
    let opened: Database.Database | undefined;
    try {
        writer = openVersionedSqliteDatabase(w.file);
        writer.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('permission-fixture', 'preserved in WAL');
        const files = [w.file, `${w.file}-wal`, `${w.file}-shm`];
        for (const file of files) fs.chmodSync(file, 0o644);
        opened = openVersionedSqliteDatabase(w.file);
        for (const file of files) assert.equal(fs.statSync(file).mode & 0o777, 0o600, path.basename(file));
        assert.equal(opened.prepare('SELECT value FROM settings WHERE key=?').pluck().get('permission-fixture'), 'preserved in WAL');
    } finally { opened?.close(); writer?.close(); w.cleanup(); }
});

test('opening refuses symlinked archive files before SQLite and leaves their targets untouched', { skip: process.platform === 'win32' }, () => {
    for (const suffix of ['', '-wal', '-shm']) {
        const w = workspace();
        try {
            openVersionedSqliteDatabase(w.file).close();
            const target = path.join(w.directory, 'untouched');
            fs.writeFileSync(target, 'synthetic target', { mode: 0o644 });
            if (!suffix) fs.unlinkSync(w.file);
            fs.symlinkSync(target, `${w.file}${suffix}`);
            let opens = 0;
            assert.throws(() => openVersionedSqliteDatabase(w.file, () => { opens++; throw new Error('SQLite must not open'); }), /SQLITE_SCHEMA_RECOVERY_REQUIRED/u);
            assert.equal(opens, 0);
            assert.equal(fs.statSync(target).mode & 0o777, 0o644);
            assert.equal(fs.readFileSync(target, 'utf8'), 'synthetic target');
        } finally { w.cleanup(); }
    }
});

test('opening does not chmod archive files owned by another user', { skip: process.platform === 'win32' }, () => {
    const w = workspace(), stat = fs.fstatSync;
    try {
        openVersionedSqliteDatabase(w.file).close();
        fs.chmodSync(w.file, 0o644);
        fs.fstatSync = ((...args: Parameters<typeof stat>) => {
            const info = stat(...args);
            return Object.assign(info, { uid: Number(info.uid) + 1 });
        }) as typeof stat;
        let opens = 0;
        assert.throws(() => openVersionedSqliteDatabase(w.file, () => { opens++; throw new Error('SQLite must not open'); }), /SQLITE_SCHEMA_RECOVERY_REQUIRED/u);
        assert.equal(opens, 0);
        assert.equal(fs.statSync(w.file).mode & 0o777, 0o644);
    } finally { fs.fstatSync = stat; w.cleanup(); }
});

test('fresh and reserved archives consume admission atomically; repeated open does not migrate', () => {
    for (const reserved of [false, true]) {
        const w = workspace();
        try {
            if (reserved) {
                const db = new Database(w.file);
                db.pragma(`application_id = ${reservation.applicationId}`);
                db.close();
            } else fs.writeFileSync(path.join(w.directory, '.DS_Store'), 'unrelated');
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

test('a version 1 archive gains the unlock credential columns once and keeps its account', () => {
    const added = ['unlock_verifier_hash', 'recovery_wrapped_master_key', 'recovery_salt', 'recovery_verifier_hash'];
    const userColumns = (db: Database.Database) => (db.pragma('table_info(users)') as { name: string }[]).map(row => row.name);
    const w = workspace();
    try {
        const v1 = seed(w.file);
        for (const column of added) v1.exec(`ALTER TABLE users DROP COLUMN ${column}`);
        v1.prepare(`INSERT INTO users (id, username, password_hash, encrypted_master_key, salt)
            VALUES ('synthetic-user', 'synthetic-account', 'synthetic-hash', 'v2:synthetic-wrapping', 'synthetic-salt')`).run();
        v1.pragma('user_version = 1');
        v1.close();

        let db = openVersionedSqliteDatabase(w.file);
        assert.equal(db.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
        assert.deepEqual(userColumns(db).slice(-added.length), added);
        assert.deepEqual(db.prepare(`SELECT id, encrypted_master_key, ${added.join(', ')} FROM users`).all(), [{
            id: 'synthetic-user', encrypted_master_key: 'v2:synthetic-wrapping',
            unlock_verifier_hash: null, recovery_wrapped_master_key: null, recovery_salt: null, recovery_verifier_hash: null,
        }]);
        db.close();

        const names = originals(w.directory);
        assert.equal(names.length, 1);
        assert.match(names[0], /\.schema-original-v1-/u);
        const original = new Database(path.join(w.directory, names[0]), { readonly: true });
        assert.equal(original.pragma('user_version', { simple: true }), 1);
        assert.equal(userColumns(original).some(column => added.includes(column)), false);
        assert.equal(original.prepare('SELECT id FROM users').pluck().get(), 'synthetic-user');
        original.close();

        db = openVersionedSqliteDatabase(w.file); db.close();
        assert.deepEqual(originals(w.directory), names, 'the second start neither migrates nor copies again');
    } finally { w.cleanup(); }
});

test('future versions, corrupt and unreserved empty files are preserved and refused', () => {
    for (const scenario of ['future', 'corrupt', 'zero', 'empty', 'missing-existing', 'current-drift']) {
        const w = workspace();
        try {
            if (scenario === 'future') { const db = seed(w.file); db.pragma(`user_version = ${CURRENT_SQLITE_SCHEMA_VERSION + 1}`); db.close(); }
            if (scenario === 'current-drift') { const db = seed(w.file, true); db.pragma(`user_version = ${CURRENT_SQLITE_SCHEMA_VERSION}`); db.close(); }
            if (scenario === 'corrupt') fs.writeFileSync(w.file, 'synthetic non SQLite bytes');
            if (scenario === 'zero') fs.writeFileSync(w.file, '');
            if (scenario === 'empty') { const db = new Database(w.file); db.pragma('user_version = 0'); db.close(); }
            if (scenario === 'missing-existing') fs.writeFileSync(`${w.file}-wal`, 'synthetic');
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
            if (scenario === 'schema') db.exec('ALTER TABLE settings ADD COLUMN unsupported_column TEXT');
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
            if (scenario === 'schema') assert.ok((after.pragma('table_info(settings)') as { name: string }[]).some(row => row.name === 'unsupported_column'));
            if (scenario === 'view') assert.ok(after.prepare("SELECT name FROM sqlite_schema WHERE name='unsupported_view'").get());
            after.close();
            assert.deepEqual(originals(w.directory), [], scenario);
        } finally { fs.linkSync = link; w.cleanup(); }
    }
});

test('an archive with an orphan row and a table MediFlow does not own still opens and keeps both', () => {
    const w = workspace();
    try {
        const db = seed(w.file, true);
        db.exec('CREATE TABLE operator_scratch (id TEXT)');
        db.pragma('foreign_keys = OFF');
        db.prepare("INSERT INTO entries (id, patient_id, type, date, content) VALUES ('orphan-entry', 'missing-patient', 'note', 0, 'synthetic')").run();
        db.close();
        for (let start = 0; start < 2; start += 1) {
            const opened = openVersionedSqliteDatabase(w.file);
            assert.equal(opened.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
            assert.equal(opened.prepare("SELECT count(*) FROM entries WHERE id='orphan-entry'").pluck().get(), 1);
            assert.ok(opened.prepare("SELECT 1 FROM sqlite_schema WHERE name='operator_scratch'").get());
            opened.close();
        }
    } finally { w.cleanup(); }
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
                if (sql === 'user_version = ${CURRENT_SQLITE_SCHEMA_VERSION}') {
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

test('migrazione da versione 3 conserva originali verificati, ricevute e fonte derivata protesica', async () => {
    const w = workspace();
    try {
        const db = seed(w.file);
        const { createProstheticsCatalog } = await import('./reference-data/prosthetics-catalog-service.ts');
        const { PROSTHETICS_TEMPLATE } = await import('./reference-data/prosthetics-catalog-contract.ts');
        const catalog = createProstheticsCatalog(db), bytes = Buffer.from(PROSTHETICS_TEMPLATE);
        const p = catalog.preview(bytes, 'inventato.csv', 'synthetic');
        catalog.commit({ bytes, sourceName: 'inventato.csv', proof: p.proof!, acceptSubset: true }, 'synthetic', () => {});
        const receipt = db.prepare('SELECT * FROM prosthetics_catalog_receipts').get();
        const entry = catalog.search('').entries[0];
        db.prepare('UPDATE prosthetics_catalog_entries SET id=? WHERE id=?').run(JSON.stringify([entry.codeSystem, entry.code, entry.scope]), entry.id);
        db.exec('ALTER TABLE prosthetics_catalog_entries DROP COLUMN source_id; DROP TABLE prosthetics_catalog_sources; DROP TABLE prosthetics_catalog_documents; ALTER TABLE prosthetic_prescriptions DROP COLUMN catalog_snapshot; PRAGMA user_version=3;');
        db.close();
        const opened = openVersionedSqliteDatabase(w.file);
        assert.equal(opened.pragma('user_version', { simple: true }), CURRENT_SQLITE_SCHEMA_VERSION);
        assert.equal((opened.prepare('PRAGMA table_info(prosthetics_catalog_documents)').all() as { name: string; type: string }[]).find(column => column.name === 'bytes')?.type, 'BLOB');
        const migrated = createProstheticsCatalog(opened);
        assert.equal(migrated.status().sourceCount, 1); assert.equal(migrated.search('').entries[0].code, entry.code);
        assert.deepEqual(opened.prepare('SELECT * FROM prosthetics_catalog_receipts').get(), receipt);
        assert.equal(originals(w.directory).length, 1);
        const old = new Database(path.join(w.directory, originals(w.directory)[0]), { readonly: true });
        assert.equal(old.pragma('user_version', { simple: true }), 3);
        assert.equal(old.prepare("SELECT count(*) n FROM sqlite_master WHERE name='prosthetics_catalog_sources'").pluck().get(), 0);
        old.close(); opened.close();
        openVersionedSqliteDatabase(w.file).close(); assert.equal(originals(w.directory).length, 1);
    } finally { w.cleanup(); }
});
