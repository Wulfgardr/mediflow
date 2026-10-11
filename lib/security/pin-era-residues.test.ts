import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { createVerifiedSqliteSnapshotSync } from '../sqlite-repair';
import { initializeSqliteSchema } from '../sqlite-schema';
import { openVersionedSqliteDatabase } from '../sqlite-schema-open';
import { retirePendingPinEraResidues, retirePinEraArchiveCopies, retirePinEraResidues } from './pin-era-residues';

const ACCOUNT = 'synthetic-user';
// Long and unmistakable, so the raw bytes of a file can be searched for them.
const PIN_WRAPPING = `v2:${'SYNTHETICPINWRAPPING'.repeat(6)}`;
const PIN_SALT = 'SYNTHETICPINSALT'.repeat(2);
const PASSPHRASE_WRAPPING = `v3:${'syntheticpassphrasewrapping'.repeat(6)}`;
const UNLOCK_COLUMNS = ['unlock_verifier_hash', 'recovery_wrapped_master_key', 'recovery_salt', 'recovery_verifier_hash'];

const wrappingIn = (file: string) => {
    const db = new Database(file, { readonly: true });
    try { return db.prepare('SELECT encrypted_master_key FROM users').pluck().get(); } finally { db.close(); }
};
const holdsBytes = (file: string, text: string) => fs.existsSync(file) && fs.readFileSync(file).includes(Buffer.from(text));
const temporaryDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-pin-era-'));

function insertPinAccount(db: Database.Database) {
    db.prepare(`INSERT INTO users (id, username, password_hash, encrypted_master_key, salt)
        VALUES (?, 'synthetic-account', 'synthetic-hash', ?, ?)`).run(ACCOUNT, PIN_WRAPPING, PIN_SALT);
}

/** What the move to a passphrase writes on the account. */
function movePassphrase(db: Database.Database) {
    db.prepare(`UPDATE users SET encrypted_master_key = ?, salt = 'synthetic-new-salt', unlock_verifier_hash = ?,
        recovery_wrapped_master_key = 'r1:synthetic-recovery-wrapping', recovery_salt = 'synthetic-recovery-salt', recovery_verifier_hash = ? WHERE id = ?`)
        .run(PASSPHRASE_WRAPPING, 'a'.repeat(64), 'b'.repeat(64), ACCOUNT);
}

/** A version 1 archive whose account unlocks with a PIN, upgraded by the product: the upgrade keeps its own original. */
function upgradedPinArchive() {
    const directory = temporaryDirectory();
    const file = path.join(directory, 'medical.db');
    const v1 = new Database(file);
    v1.pragma('foreign_keys = ON');
    initializeSqliteSchema(v1);
    for (const column of UNLOCK_COLUMNS) v1.exec(`ALTER TABLE users DROP COLUMN ${column}`);
    insertPinAccount(v1);
    v1.pragma('user_version = 1');
    v1.close();
    openVersionedSqliteDatabase(file).close();
    const [original] = fs.readdirSync(directory).filter((name) => name.includes('.schema-original-'));
    return { directory, file, original };
}

test('after the move to a passphrase, the copies the product made while the account was on its PIN are removed and nothing else', () => {
    const archive = upgradedPinArchive();
    const outside = temporaryDirectory();
    const at = (name: string) => path.join(archive.directory, name);
    try {
        assert.match(archive.original, /^medical\.db\.schema-original-v1-/u);
        assert.equal(wrappingIn(at(archive.original)), PIN_WRAPPING, 'the original kept by the upgrade holds the PIN wrapping');
        // A repair made while the account was on its PIN keeps a backup of the same archive, named by its time.
        const repairBackup = 'medical.db.bak-20261011-101500123';
        createVerifiedSqliteSnapshotSync(archive.file, at(repairBackup));
        for (const suffix of ['-wal', '-shm']) fs.writeFileSync(at(repairBackup + suffix), `${PIN_WRAPPING} synthetic stale pages`);

        const live = new Database(archive.file);
        movePassphrase(live);
        live.close();

        // Canonical snapshots purge free cells; an older repair .bak cannot be certified by its live v3 row.
        const later = [`medical.db.schema-original-v2-${randomUUID()}.db`, 'medical.db.bak-20261012-090000000'];
        for (const name of later) createVerifiedSqliteSnapshotSync(archive.file, at(name));
        // A copy with the same kind of name that holds another account says nothing about this one.
        const foreign = `medical.db.schema-original-v1-${randomUUID()}.db`;
        fs.copyFileSync(at(repairBackup), at(foreign));
        const other = new Database(at(foreign));
        other.prepare("UPDATE users SET id = 'someone-else'").run();
        other.close();
        // Names of product copies that are not regular, readable archives: never followed, always reported.
        const elsewhere = path.join(outside, 'elsewhere.db');
        fs.copyFileSync(at(repairBackup), elsewhere);
        const link = `medical.db.schema-original-v1-${randomUUID()}.db`;
        fs.symlinkSync(elsewhere, at(link));
        const unreadable = 'medical.db.bak-20261010-080000000';
        fs.writeFileSync(at(unreadable), 'synthetic bytes that are not a database');
        // Names that only resemble the product's, and the copies of another archive in the same directory.
        const strangers = ['medical.db.schema-original-notes.txt', 'medical.db.schema-original-v1-short.db', 'medical.db.bak-mine',
            'medical.db.bak-20261011-101500123.txt', `other.db.schema-original-v1-${randomUUID()}.db`, 'other.db.bak-20261011-101500123'];
        for (const name of strangers) fs.writeFileSync(at(name), `${PIN_WRAPPING} synthetic`);
        const before = fs.readdirSync(archive.directory).sort();

        const result = retirePinEraArchiveCopies(archive.file, ACCOUNT);

        const gone = [archive.original, repairBackup].sort();
        assert.deepEqual([...result.removed].sort(), gone);
        assert.deepEqual([...result.kept].sort(), [link, unreadable, later[1]].sort());
        assert.deepEqual(fs.readdirSync(archive.directory).sort(),
            before.filter((name) => !gone.includes(name) && !name.startsWith(`${repairBackup}-`)),
            'the two copies and the pages beside them are gone; nothing else was removed or created');
        for (const name of later) assert.equal(wrappingIn(at(name)), PASSPHRASE_WRAPPING, name);
        assert.equal(wrappingIn(at(foreign)), PIN_WRAPPING, 'the copy of another account stays');
        assert.equal(wrappingIn(elsewhere), PIN_WRAPPING, 'a link is never followed');
        assert.equal(wrappingIn(archive.file), PASSPHRASE_WRAPPING, 'the archive itself is untouched');

        // Repeating it finds nothing more to remove, and still reports what someone must look at.
        assert.deepEqual(retirePinEraArchiveCopies(archive.file, ACCOUNT), { removed: [], kept: result.kept });
    } finally {
        fs.rmSync(archive.directory, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('obsolete PIN material in archive cells and WAL is removed only after compaction and checkpoint succeed', () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, 'medical.db');
    const connection = openVersionedSqliteDatabase(file);
    const db = drizzle(connection);
    const walBytes = () => fs.statSync(`${file}-wal`).size;
    const pinMaterialAtRest = () => [file, `${file}-wal`].flatMap((name) => [PIN_WRAPPING, PIN_SALT].filter((text) => holdsBytes(name, text)).map((text) => `${path.basename(name)}: ${text.slice(0, 16)}`));
    try {
        insertPinAccount(connection);
        // A multi-page users table leaves old cells after UPDATE, unlike the former one-row fixture.
        for (let index = 0; index < 20; index++) connection.prepare(`INSERT INTO users
            (id, username, password_hash, encrypted_master_key, salt, display_name) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(`synthetic-${index}`, `user${index}`, 'h'.repeat(60), `v2:${'x'.repeat(80)}`, 's'.repeat(24), 'n'.repeat(40));
        connection.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('n'.repeat(40), ACCOUNT);
        connection.pragma('wal_checkpoint(TRUNCATE)');
        assert.ok(holdsBytes(file, PIN_WRAPPING), 'the old wrapping is physically in the archive before adoption');
        // The account is used for a while before it moves: its page is written to the log again and again.
        for (let attempt = 1; attempt <= 3; attempt += 1) connection.prepare('UPDATE users SET failed_login_attempts = ?').run(attempt);
        movePassphrase(connection);
        connection.pragma('wal_checkpoint(TRUNCATE)');
        assert.ok(holdsBytes(file, PIN_WRAPPING), 'checkpoint alone leaves the obsolete wrapping in free archive cells');
        connection.prepare('UPDATE users SET failed_login_attempts = 0 WHERE id = ?').run(ACCOUNT);
        assert.notDeepEqual(pinMaterialAtRest(), [], 'the move alone leaves the PIN wrapping in the files of the archive');
        const patience = connection.pragma('busy_timeout', { simple: true });
        assert.ok(Number(patience) >= 1000, 'the product waits for other writers');

        // Another process is reading: the log cannot be emptied now. The server does not wait for it.
        const reader = new Database(file, { readonly: true });
        reader.exec('BEGIN');
        reader.prepare('SELECT count(*) FROM users').get();
        const started = Date.now();
        assert.deepEqual(retirePinEraResidues(ACCOUNT, db, file), { removed: [], kept: [], logEmptied: false, complete: false });
        assert.ok(Date.now() - started < Number(patience) / 2, 'the reader was not waited for');
        assert.equal(connection.pragma('busy_timeout', { simple: true }), patience, 'the patience of the connection is as it was');
        assert.ok(holdsBytes(file, PIN_WRAPPING), 'the old archive cells remain while the checkpoint is blocked');
        assert.equal(retirePendingPinEraResidues(ACCOUNT, db, file), false);
        assert.ok(holdsBytes(file, PIN_WRAPPING), 'a retry with the reader still there leaves the old archive cells');
        reader.exec('COMMIT');
        reader.close();

        // The next unlock with the passphrase makes up for it.
        assert.equal(retirePendingPinEraResidues(ACCOUNT, db, file), true);
        assert.equal(walBytes(), 0);
        assert.deepEqual(pinMaterialAtRest(), [], 'neither the archive nor its log holds the PIN wrapping or its salt');
        assert.equal(connection.prepare('SELECT encrypted_master_key FROM users WHERE id = ?').pluck().get(ACCOUNT), PASSPHRASE_WRAPPING);
        assert.equal(connection.prepare('SELECT count(*) FROM users').pluck().get(), 21);
        assert.equal(connection.prepare('SELECT encrypted_master_key FROM users WHERE id = ?').pluck().get('synthetic-10'), `v2:${'x'.repeat(80)}`);

        // Settled: later unlocks cost nothing; a new move of the same account always runs in full.
        connection.prepare('UPDATE users SET failed_login_attempts = 0').run();
        const grown = walBytes();
        assert.ok(grown > 0);
        assert.equal(retirePendingPinEraResidues(ACCOUNT, db, file), true);
        assert.equal(walBytes(), grown, 'nothing is pending, so the log is left alone');
        assert.deepEqual(retirePinEraResidues(ACCOUNT, db, file), { removed: [], kept: [], logEmptied: true, complete: true });
        assert.equal(walBytes(), 0);

        // A failed SQLite maintenance statement never declares cleanup complete or rolls credentials back.
        connection.prepare('UPDATE users SET failed_login_attempts = 1').run();
        const failing = { all: db.all.bind(db), run: () => { throw new Error('synthetic SQLITE_FULL'); } };
        assert.equal(retirePinEraResidues(ACCOUNT, failing, file).complete, false);
        assert.equal(connection.pragma('busy_timeout', { simple: true }), patience);
        assert.equal(connection.prepare('SELECT encrypted_master_key FROM users WHERE id = ?').pluck().get(ACCOUNT), PASSPHRASE_WRAPPING);
        assert.equal(connection.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
        connection.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('a copy that cannot be removed keeps the removal pending, and a directory that cannot be read is not called clean', () => {
    const archive = upgradedPinArchive();
    const connection = new Database(archive.file);
    const db = drizzle(connection);
    try {
        movePassphrase(connection);
        const unreadable = 'medical.db.bak-20261010-080000000';
        fs.writeFileSync(path.join(archive.directory, unreadable), 'synthetic bytes that are not a database');

        assert.deepEqual(retirePinEraResidues(ACCOUNT, db, archive.file), { removed: [archive.original], kept: [unreadable], logEmptied: true, complete: false });
        // Someone looked at it and took it away: the next unlock settles.
        fs.rmSync(path.join(archive.directory, unreadable));
        assert.deepEqual(retirePinEraResidues(ACCOUNT, db, archive.file), { removed: [], kept: [], logEmptied: true, complete: true });

        const missing = path.join(archive.directory, 'not-a-directory', 'medical.db');
        assert.deepEqual(retirePinEraResidues(ACCOUNT, db, missing), { removed: [], kept: [], logEmptied: true, complete: false });
    } finally {
        connection.close();
        fs.rmSync(archive.directory, { recursive: true, force: true });
    }
});
