// WUL-306 (ADR 0066): behavioral coverage for the patient soft-delete tombstone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { patients } from './schema';
import {
    activePatients,
    buildPatientRestoreValues,
    buildPatientTombstoneValues,
} from './patient-lifecycle';
import { buildPatientVersionConflictPayload } from './patient-concurrency';
import { normalizePatientUpdateInput } from './patient-write-normalization';

const ROOT_DIR = path.resolve(__dirname, '..');

function ensureColumn(sqlite: Database.Database, table: string, columnName: string, columnSql: string): void {
    const columns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name);
    if (!columns.includes(columnName)) {
        sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`).run();
    }
}

function bootstrapDatabase(): { sqlite: Database.Database; db: BetterSQLite3Database } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soft-delete-'));
    const sqlite = new Database(path.join(dir, 'medical.db'));
    const migrationsDir = path.join(ROOT_DIR, 'drizzle');
    const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort((left, right) => left.localeCompare(right));
    for (const fileName of migrationFiles) {
        const sql = fs
            .readFileSync(path.join(migrationsDir, fileName), 'utf8')
            .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
        if (sql.trim().length === 0) continue;
        sqlite.exec(sql);
    }
    // Mirror the patients ensureColumn() guards from lib/db-server.ts (incl. WUL-306).
    ensureColumn(sqlite, 'patients', 'exemptions', 'exemptions TEXT');
    ensureColumn(sqlite, 'patients', 'diagnoses', 'diagnoses TEXT');
    ensureColumn(sqlite, 'patients', 'monitoring_profile', 'monitoring_profile TEXT');
    ensureColumn(sqlite, 'patients', 'status_reason', 'status_reason TEXT');
    ensureColumn(sqlite, 'patients', 'deleted_at', 'deleted_at INTEGER');
    ensureColumn(sqlite, 'patients', 'deletion_reason', 'deletion_reason TEXT');
    return { sqlite, db: drizzle(sqlite) };
}

function insertFakePatient(db: BetterSQLite3Database, id: string, version: number): void {
    db.insert(patients).values({
        id,
        firstName: 'Mario',
        lastName: 'Rossi',
        taxCode: 'RSSMRA80A01H501X',
        version,
    }).run();
}

function selectActivePatient(db: BetterSQLite3Database, id: string) {
    return db
        .select({ id: patients.id, version: patients.version })
        .from(patients)
        .where(and(eq(patients.id, id), activePatients()))
        .get();
}

function selectTombstone(db: BetterSQLite3Database, id: string) {
    return db
        .select({
            id: patients.id,
            version: patients.version,
            deletedAt: patients.deletedAt,
            deletionReason: patients.deletionReason,
        })
        .from(patients)
        .where(eq(patients.id, id))
        .get();
}

test('version-guarded tombstone delete writes deletedAt, bumps version and hides the row', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertFakePatient(db, 'patient-1', 3);

        const result = db
            .update(patients)
            .set(buildPatientTombstoneValues(3, 'api-v1-delete'))
            .where(and(eq(patients.id, 'patient-1'), eq(patients.version, 3), activePatients()))
            .run();
        assert.equal(result.changes, 1);

        const row = selectTombstone(db, 'patient-1');
        assert.ok(row, 'tombstoned row must stay in the table');
        assert.ok(row.deletedAt instanceof Date, 'deletedAt must be written');
        assert.equal(row.deletionReason, 'api-v1-delete');
        assert.equal(row.version, 4);

        assert.equal(selectActivePatient(db, 'patient-1'), undefined, 'active reads must exclude the tombstone');
    } finally {
        sqlite.close();
    }
});

test('stale version and already-tombstoned deletes do not match (409/404 paths)', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertFakePatient(db, 'patient-2', 5);

        const staleResult = db
            .update(patients)
            .set(buildPatientTombstoneValues(4, 'api-v1-delete'))
            .where(and(eq(patients.id, 'patient-2'), eq(patients.version, 4), activePatients()))
            .run();
        assert.equal(staleResult.changes, 0, 'stale version must not tombstone');

        const firstDelete = db
            .update(patients)
            .set(buildPatientTombstoneValues(5, 'api-v1-delete'))
            .where(and(eq(patients.id, 'patient-2'), eq(patients.version, 5), activePatients()))
            .run();
        assert.equal(firstDelete.changes, 1);

        const secondDelete = db
            .update(patients)
            .set(buildPatientTombstoneValues(6, 'api-v1-delete'))
            .where(and(eq(patients.id, 'patient-2'), eq(patients.version, 6), activePatients()))
            .run();
        assert.equal(secondDelete.changes, 0, 'a tombstoned patient must not be re-deletable');

        // The conflict snapshot reads through the same active filter, so a tombstoned
        // row reports `missing` — byte-identical to the old hard-delete contract.
        const current = db
            .select({
                id: patients.id,
                version: patients.version,
                updatedAt: patients.updatedAt,
                isArchived: patients.isArchived,
            })
            .from(patients)
            .where(and(eq(patients.id, 'patient-2'), activePatients()))
            .get();
        const payload = buildPatientVersionConflictPayload(6, 'patient-2', current ?? null);
        assert.equal(payload.currentState, 'missing');
        assert.equal(payload.currentVersion, null);
    } finally {
        sqlite.close();
    }
});

test('admin restore clears the tombstone and bumps the version', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertFakePatient(db, 'patient-3', 1);
        db
            .update(patients)
            .set(buildPatientTombstoneValues(1, 'web-delete'))
            .where(and(eq(patients.id, 'patient-3'), eq(patients.version, 1), activePatients()))
            .run();

        const tombstoned = selectTombstone(db, 'patient-3');
        assert.ok(tombstoned?.deletedAt, 'fixture must be tombstoned before restore');

        const restore = db
            .update(patients)
            .set(buildPatientRestoreValues(tombstoned.version))
            .where(eq(patients.id, 'patient-3'))
            .run();
        assert.equal(restore.changes, 1);

        const restored = selectTombstone(db, 'patient-3');
        assert.equal(restored?.deletedAt, null);
        assert.equal(restored?.deletionReason, null);
        assert.equal(restored?.version, 3);
        assert.ok(selectActivePatient(db, 'patient-3'), 'restored patient must be visible again');
    } finally {
        sqlite.close();
    }
});

test('deletedAt and deletionReason are not forgeable through the PUT whitelist', () => {
    const normalized = normalizePatientUpdateInput(
        {
            firstName: 'Maria',
            deletedAt: '2026-06-01T00:00:00.000Z',
            deletionReason: 'forged',
        },
        { expectedVersion: 1 }
    );
    assert.ok(normalized.ok);
    assert.equal('deletedAt' in normalized.values, false, 'PUT must never write deletedAt');
    assert.equal('deletionReason' in normalized.values, false, 'PUT must never write deletionReason');
});
