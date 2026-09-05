import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSqlitePragmas } from './sqlite-pragmas.ts';

// WUL-268 (STREAM A): the shared pragma helper must leave every connection in
// WAL, with a 5s busy timeout, NORMAL synchronous, and foreign keys enforced.

function tempDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-pragma-'));
    return path.join(dir, 'test.db');
}

test('initSqlitePragmas configures busy_timeout before the WAL write lock', () => {
    const calls: string[] = [];
    const connection = {
        pragma(statement: string) {
            calls.push(statement);
            return statement === 'foreign_key_check' ? [] : undefined;
        },
    } as unknown as Database.Database;

    initSqlitePragmas(connection);

    assert.deepEqual(calls.slice(0, 2), ['busy_timeout = 5000', 'journal_mode = WAL']);
});

test('initSqlitePragmas retries a transient WAL lock without hiding other errors', () => {
    let walAttempts = 0;
    const connection = {
        pragma(statement: string) {
            if (statement === 'journal_mode = WAL') {
                walAttempts += 1;
                if (walAttempts < 3) {
                    throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
                }
            }
            return statement === 'foreign_key_check' ? [] : undefined;
        },
    } as unknown as Database.Database;

    assert.doesNotThrow(() => initSqlitePragmas(connection));
    assert.equal(walAttempts, 3);

    const invalidConnection = {
        pragma(statement: string) {
            if (statement === 'journal_mode = WAL') {
                throw Object.assign(new Error('invalid database'), { code: 'SQLITE_CORRUPT' });
            }
            return undefined;
        },
    } as unknown as Database.Database;
    assert.throws(() => initSqlitePragmas(invalidConnection), /invalid database/);
});

test('initSqlitePragmas sets WAL, busy_timeout, synchronous NORMAL and foreign_keys ON', () => {
    const db = new Database(tempDbPath());
    try {
        initSqlitePragmas(db);

        const journalMode = db.pragma('journal_mode', { simple: true });
        assert.equal(String(journalMode).toLowerCase(), 'wal');

        const busyTimeout = db.pragma('busy_timeout', { simple: true });
        assert.equal(Number(busyTimeout), 5000);

        // synchronous NORMAL == 1
        const synchronous = db.pragma('synchronous', { simple: true });
        assert.equal(Number(synchronous), 1);

        const foreignKeys = db.pragma('foreign_keys', { simple: true });
        assert.equal(Number(foreignKeys), 1);
    } finally {
        db.close();
    }
});

test('initSqlitePragmas reports pre-existing FK violations without throwing or deleting data', () => {
    const db = new Database(tempDbPath());
    try {
        // Create a parent/child pair and insert an orphan child WHILE foreign keys
        // are off (the historical live-DB state). initSqlitePragmas must not throw
        // and must leave the orphan row intact.
        db.pragma('foreign_keys = OFF');
        db.exec(`
            CREATE TABLE "parent; SELECT private_data -- α" (id TEXT PRIMARY KEY);
            CREATE TABLE "child patient_秘密" (
                id TEXT PRIMARY KEY,
                parent_id TEXT REFERENCES "parent; SELECT private_data -- α"(id)
            );
            INSERT INTO "child patient_秘密" (id, parent_id) VALUES ('c1', 'missing-parent'), ('c2', 'missing-parent');
        `);

        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => {
            warnings.push(args.map((a) => String(a)).join(' '));
        };
        try {
            assert.doesNotThrow(() => initSqlitePragmas(db));
        } finally {
            console.warn = originalWarn;
        }

        // FK is enabled for future writes.
        assert.equal(Number(db.pragma('foreign_keys', { simple: true })), 1);
        // The pre-existing orphan row is NOT deleted.
        const remaining = db.prepare('SELECT COUNT(*) AS n FROM "child patient_秘密"').get() as { n: number };
        assert.equal(remaining.n, 2);
        assert.deepEqual(warnings, [
            '[MediFlow] foreign_key_check found 2 pre-existing violation(s) before enabling FK enforcement. Existing data is left untouched; FK is enforced on future writes only.',
        ]);
        assert.doesNotMatch(warnings.join('\n'), /private_data|child patient|秘密|α|SELECT/i);
    } finally {
        db.close();
    }
});

test('initSqlitePragmas never reflects a hostile foreign_key_check error', () => {
    let proxyTraps = 0;
    const hostileError = new Proxy(Object.create(null), {
        get() { proxyTraps += 1; throw new Error('private SQLite error'); },
        getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error('private SQLite descriptor'); },
        ownKeys() { proxyTraps += 1; throw new Error('private SQLite keys'); },
    });
    const calls: string[] = [];
    const warnings: string[] = [];
    const connection = {
        pragma(statement: string) {
            calls.push(statement);
            if (statement === 'foreign_key_check') throw hostileError;
            return undefined;
        },
    } as unknown as Database.Database;
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
    try {
        assert.doesNotThrow(() => initSqlitePragmas(connection));
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(proxyTraps, 0);
    assert.ok(calls.includes('foreign_keys = ON'));
    assert.deepEqual(warnings, [
        '[MediFlow] foreign_key_check skipped. Existing data is left untouched; FK is enforced on future writes only.',
    ]);
});
