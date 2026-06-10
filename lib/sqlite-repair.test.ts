import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backupSqliteDatabase, removeSqliteSidecars, replaceSqliteDatabase } from './sqlite-repair';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-sqlite-repair-'));
}

function createDatabase(dbPath: string, names: string[], journalMode: 'wal' | 'delete'): Database.Database {
    const db = new Database(dbPath);
    db.pragma(`journal_mode = ${journalMode}`);
    db.exec('CREATE TABLE patients_fixture (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO patients_fixture (name) VALUES (?)');
    for (const name of names) {
        insert.run(name);
    }
    return db;
}

function readNames(dbPath: string): string[] {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        const rows = db.prepare('SELECT name FROM patients_fixture ORDER BY id').all() as Array<{ name: string }>;
        return rows.map((row) => row.name);
    } catch {
        return [];
    } finally {
        db.close();
    }
}

test('backupSqliteDatabase captures rows still in the WAL that a plain file copy misses', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'source.db');
    const source = createDatabase(sourcePath, ['Mario Rossi', 'Anna Verdi'], 'wal');
    try {
        // The writer stays open, so the rows above still live in the -wal sidecar.
        assert.ok(fs.statSync(`${sourcePath}-wal`).size > 0);

        const naivePath = path.join(dir, 'naive-copy.db');
        fs.copyFileSync(sourcePath, naivePath);
        assert.deepEqual(readNames(naivePath), []);

        const backupPath = path.join(dir, 'backup.db');
        await backupSqliteDatabase(sourcePath, backupPath);
        assert.deepEqual(readNames(backupPath), ['Mario Rossi', 'Anna Verdi']);
    } finally {
        source.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('replaceSqliteDatabase writes a consistent pre-swap backup and reopens on the new content', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'legacy.db');
    const destPath = path.join(dir, 'medical.db');
    const backupPath = path.join(dir, 'medical.db.bak');
    createDatabase(sourcePath, ['Giulia Bianchi'], 'wal').close();

    const live = createDatabase(destPath, ['Mario Rossi', 'Anna Verdi'], 'wal');
    let reopened: Database.Database | null = null;
    let walAtReopen: boolean | null = null;
    try {
        await replaceSqliteDatabase({
            sourcePath,
            destPath,
            backupPath,
            connection: live,
            reopenConnection: () => {
                walAtReopen = fs.existsSync(`${destPath}-wal`);
                reopened = new Database(destPath);
            },
        });

        assert.equal(live.open, false);
        // The pre-swap backup carries the rows that were pending in the live WAL.
        assert.deepEqual(readNames(backupPath), ['Mario Rossi', 'Anna Verdi']);
        // The swapped file is a checkpointed copy of the source with no inherited WAL.
        assert.equal(walAtReopen, false);
        assert.deepEqual(readNames(destPath), ['Giulia Bianchi']);
        assert.ok(reopened);
        const row = (reopened as Database.Database)
            .prepare('SELECT name FROM patients_fixture ORDER BY id')
            .get() as { name: string };
        assert.equal(row.name, 'Giulia Bianchi');
        assert.equal(fs.existsSync(`${destPath}.repair-tmp`), false);
    } finally {
        if (reopened) (reopened as Database.Database).close();
        if (live.open) live.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('replaceSqliteDatabase clears stale sidecar files left next to the destination', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'legacy.db');
    const destPath = path.join(dir, 'medical.db');
    createDatabase(sourcePath, ['Giulia Bianchi'], 'wal').close();

    // Rollback-journal connection: the planted sidecars simulate leftovers of a
    // crashed WAL-mode process and would be applied to the swapped-in file.
    const live = createDatabase(destPath, ['Mario Rossi'], 'delete');
    fs.writeFileSync(`${destPath}-wal`, 'stale wal payload');
    fs.writeFileSync(`${destPath}-shm`, 'stale shm payload');
    let reopened: Database.Database | null = null;
    let sidecarsAtReopen: boolean | null = null;
    try {
        await replaceSqliteDatabase({
            sourcePath,
            destPath,
            backupPath: null,
            connection: live,
            reopenConnection: () => {
                sidecarsAtReopen = fs.existsSync(`${destPath}-wal`) || fs.existsSync(`${destPath}-shm`);
                reopened = new Database(destPath);
            },
        });

        assert.equal(sidecarsAtReopen, false);
        assert.deepEqual(readNames(destPath), ['Giulia Bianchi']);
    } finally {
        if (reopened) (reopened as Database.Database).close();
        if (live.open) live.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('replaceSqliteDatabase reopens the connection even when the source is unreadable', async () => {
    const dir = makeTempDir();
    const destPath = path.join(dir, 'medical.db');
    const live = createDatabase(destPath, ['Mario Rossi'], 'wal');
    let reopenCalls = 0;
    try {
        await assert.rejects(
            replaceSqliteDatabase({
                sourcePath: path.join(dir, 'missing.db'),
                destPath,
                backupPath: null,
                connection: live,
                reopenConnection: () => {
                    reopenCalls += 1;
                },
            }),
        );

        assert.equal(reopenCalls, 1);
        assert.equal(live.open, false);
        // The live DB was left untouched and no staging artifacts remain.
        assert.deepEqual(readNames(destPath), ['Mario Rossi']);
        assert.equal(fs.existsSync(`${destPath}.repair-tmp`), false);
    } finally {
        if (live.open) live.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('removeSqliteSidecars deletes -wal and -shm files and tolerates missing ones', () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, 'medical.db');
    try {
        fs.writeFileSync(`${dbPath}-wal`, 'stale');
        fs.writeFileSync(`${dbPath}-shm`, 'stale');
        removeSqliteSidecars(dbPath);
        assert.equal(fs.existsSync(`${dbPath}-wal`), false);
        assert.equal(fs.existsSync(`${dbPath}-shm`), false);
        // A second call on already-clean paths must not throw.
        removeSqliteSidecars(dbPath);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
