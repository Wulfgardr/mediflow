import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';
import { initSqlitePragmas } from './sqlite-pragmas.ts';

// WUL-268 (STREAM A): the multi-write API handlers (patients/move, ambulatories,
// duplicate, setup, patients POST, migrate, fix-orphans) now wrap their writes in
// dbServer.transaction. This test proves the atomicity guarantee they rely on:
// when a failure happens mid-transaction, every write in that transaction is
// rolled back and the database is left as if the request never ran. It models the
// patients/move shape (a membership insert followed by an update) at the service
// level using the same drizzle + better-sqlite3 synchronous transaction API.

const memberships = sqliteTable('memberships', {
    patientId: text('patient_id').primaryKey(),
    ambulatoryId: text('ambulatory_id').notNull(),
});

function makeDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-tx-'));
    const sqlite = new Database(path.join(dir, 'test.db'));
    initSqlitePragmas(sqlite);
    sqlite.exec(`
        CREATE TABLE memberships (
            patient_id TEXT PRIMARY KEY NOT NULL,
            ambulatory_id TEXT NOT NULL
        );
    `);
    return { sqlite, db: drizzle(sqlite) };
}

test('a failure mid-transaction rolls back every write in that transaction', () => {
    const { sqlite, db } = makeDb();
    try {
        // Seed one existing membership so we can assert it is untouched by the
        // rolled-back transaction.
        db.insert(memberships).values({ patientId: 'p-existing', ambulatoryId: 'amb-a' }).run();

        assert.throws(() => {
            db.transaction((tx) => {
                // First write succeeds inside the transaction...
                tx.insert(memberships).values({ patientId: 'p-new', ambulatoryId: 'amb-b' }).run();
                // ...then the handler logic fails before the transaction commits.
                throw new Error('simulated mid-handler failure');
            });
        }, /simulated mid-handler failure/);

        // The insert from the aborted transaction must NOT have been committed.
        const inserted = db
            .select()
            .from(memberships)
            .where(eq(memberships.patientId, 'p-new'))
            .all();
        assert.equal(inserted.length, 0, 'the aborted transaction must not leave a committed row');

        // Pre-existing data is unaffected.
        const existing = db
            .select()
            .from(memberships)
            .where(eq(memberships.patientId, 'p-existing'))
            .all();
        assert.equal(existing.length, 1);
    } finally {
        sqlite.close();
    }
});

test('a transaction that returns normally commits all of its writes', () => {
    const { sqlite, db } = makeDb();
    try {
        db.transaction((tx) => {
            tx.insert(memberships).values({ patientId: 'p1', ambulatoryId: 'amb-a' }).run();
            tx.insert(memberships).values({ patientId: 'p2', ambulatoryId: 'amb-a' }).run();
        });

        const rows = db.select().from(memberships).all();
        assert.equal(rows.length, 2);
    } finally {
        sqlite.close();
    }
});
