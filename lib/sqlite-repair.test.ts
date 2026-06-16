import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    SqliteSwapInProgressError,
    backupSqliteDatabase,
    copySqliteDatabaseSync,
    removeSqliteSidecars,
    replaceSqliteDatabase,
} from './sqlite-repair';

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

/** Staging/retired leftovers of replaceSqliteDatabase present in dir. */
function swapArtifacts(dir: string): string[] {
    return fs.readdirSync(dir).filter((name) => name.includes('.repair-tmp') || name.includes('.old-'));
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
        assert.deepEqual(swapArtifacts(dir), []);
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
        assert.deepEqual(swapArtifacts(dir), []);
    } finally {
        if (live.open) live.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('concurrent replaceSqliteDatabase calls: one swap wins, the other fails fast, the DB stays intact', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'legacy.db');
    const destPath = path.join(dir, 'medical.db');
    createDatabase(sourcePath, ['Giulia Bianchi'], 'wal').close();

    const live = createDatabase(destPath, ['Mario Rossi', 'Anna Verdi'], 'wal');
    let reopenCalls = 0;
    try {
        const swap = () =>
            replaceSqliteDatabase({
                sourcePath,
                destPath,
                backupPath: null,
                connection: live,
                reopenConnection: () => {
                    reopenCalls += 1;
                },
            });

        // Regression for the WUL-321 blocker: two interleaved swaps used to
        // delete each other's staging copy and leave a zero-byte medical.db.
        const results = await Promise.allSettled([swap(), swap()]);
        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        const rejected = results.filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);
        assert.ok(rejected[0].reason instanceof SqliteSwapInProgressError);

        // Only the winning swap closed and reopened the shared connection.
        assert.equal(reopenCalls, 1);
        // The final DB is the swapped-in source, not empty, with no leftovers.
        assert.ok(fs.statSync(destPath).size > 0);
        assert.deepEqual(readNames(destPath), ['Giulia Bianchi']);
        assert.deepEqual(swapArtifacts(dir), []);

        // The guard is released once the in-flight swap settles.
        await swap();
        assert.equal(reopenCalls, 2);
        assert.deepEqual(readNames(destPath), ['Giulia Bianchi']);
    } finally {
        if (live.open) live.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('replaceSqliteDatabase restores the previous DB when the swap fails after retiring it', async () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'legacy.db');
    const destPath = path.join(dir, 'medical.db');
    createDatabase(sourcePath, ['Giulia Bianchi'], 'wal').close();

    const live = createDatabase(destPath, ['Mario Rossi', 'Anna Verdi'], 'wal');
    const failure = new Error('simulated rename failure');
    let reopenCalls = 0;
    let destMissingInWindow: boolean | null = null;
    try {
        await assert.rejects(
            replaceSqliteDatabase({
                sourcePath,
                destPath,
                backupPath: null,
                connection: live,
                reopenConnection: () => {
                    reopenCalls += 1;
                },
                beforeSwapInForTest: () => {
                    // The live file has been retired to its .old-* name here:
                    // this is the crash window the rename sequence must survive.
                    destMissingInWindow = !fs.existsSync(destPath);
                    throw failure;
                },
            }),
            (error: unknown) => error === failure,
        );

        assert.equal(destMissingInWindow, true);
        assert.equal(reopenCalls, 1);
        // The previous DB was renamed back, fully readable, with no leftovers.
        assert.deepEqual(readNames(destPath), ['Mario Rossi', 'Anna Verdi']);
        assert.deepEqual(swapArtifacts(dir), []);
    } finally {
        if (live.open) live.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('copySqliteDatabaseSync captures rows still in the WAL of an open writer', () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'source.db');
    const source = createDatabase(sourcePath, ['Mario Rossi', 'Anna Verdi'], 'wal');
    try {
        // The writer stays open, so the rows above still live in the -wal sidecar.
        assert.ok(fs.statSync(`${sourcePath}-wal`).size > 0);

        const copyPath = path.join(dir, 'copy.db');
        copySqliteDatabaseSync(sourcePath, copyPath);
        assert.deepEqual(readNames(copyPath), ['Mario Rossi', 'Anna Verdi']);
    } finally {
        source.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('copySqliteDatabaseSync recovers the WAL sidecar left behind by a crashed process', () => {
    const dir = makeTempDir();
    const sourcePath = path.join(dir, 'source.db');
    const crashedPath = path.join(dir, 'crashed.db');
    const source = createDatabase(sourcePath, ['Mario Rossi', 'Anna Verdi'], 'wal');
    try {
        // Snapshot db + sidecars while the writer is open: the copies look like
        // the files a crashed process leaves on disk (rows only in the -wal).
        for (const suffix of ['', '-wal', '-shm']) {
            fs.copyFileSync(`${sourcePath}${suffix}`, `${crashedPath}${suffix}`);
        }
        source.close();

        const copyPath = path.join(dir, 'copy.db');
        copySqliteDatabaseSync(crashedPath, copyPath);
        assert.deepEqual(readNames(copyPath), ['Mario Rossi', 'Anna Verdi']);
    } finally {
        if (source.open) source.close();
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
