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
            CREATE TABLE parent (id TEXT PRIMARY KEY);
            CREATE TABLE child (
                id TEXT PRIMARY KEY,
                parent_id TEXT REFERENCES parent(id)
            );
            INSERT INTO child (id, parent_id) VALUES ('c1', 'missing-parent');
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
        const remaining = db.prepare('SELECT COUNT(*) AS n FROM child').get() as { n: number };
        assert.equal(remaining.n, 1);
        // A structured warning naming the offending table was emitted.
        assert.ok(
            warnings.some((w) => w.includes('foreign_key_check') && w.includes('child')),
            `expected a foreign_key_check warning mentioning "child", got: ${JSON.stringify(warnings)}`,
        );
    } finally {
        db.close();
    }
});
