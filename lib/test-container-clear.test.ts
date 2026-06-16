// WUL-322 (ADR 0066 Slice 3): behavioral coverage for the membership-based
// test-container clear. Fixture rule: no real PHI/PII, ever.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { ambulatories, entries, patients, patientsToAmbulatories } from './schema';
import { activePatients } from './patient-lifecycle';
import { clearTestContainerByMembership, TEST_CONTAINER_CLEAR_REASON } from './test-container-clear';

const ROOT_DIR = path.resolve(__dirname, '..');

function ensureColumn(sqlite: Database.Database, table: string, columnName: string, columnSql: string): void {
    const columns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name);
    if (!columns.includes(columnName)) {
        sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`).run();
    }
}

function bootstrapDatabase(): { sqlite: Database.Database; db: BetterSQLite3Database } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-test-container-clear-'));
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

const TEST_AMBULATORY = 'amb-test';
const LIVE_AMBULATORY = 'amb-live';
const OTHER_TEST_AMBULATORY = 'amb-test-2';

function insertAmbulatories(db: BetterSQLite3Database): void {
    db.insert(ambulatories).values([
        { id: TEST_AMBULATORY, name: 'Contenitore Test', type: 'test' },
        { id: LIVE_AMBULATORY, name: 'Ambulatorio Live', type: 'live' },
        { id: OTHER_TEST_AMBULATORY, name: 'Contenitore Test 2', type: 'test' },
    ]).run();
}

function insertFakePatient(
    db: BetterSQLite3Database,
    id: string,
    version: number,
    legacyAmbulatoryId: string | null = null
): void {
    db.insert(patients).values({
        id,
        firstName: 'Mario',
        lastName: 'Rossi',
        taxCode: 'RSSMRA80A01H501X',
        version,
        ambulatoryId: legacyAmbulatoryId,
    }).run();
}

function linkMembership(db: BetterSQLite3Database, patientId: string, ambulatoryId: string): void {
    db.insert(patientsToAmbulatories).values({ patientId, ambulatoryId, assignedAt: new Date() }).run();
}

function insertChildEntry(db: BetterSQLite3Database, id: string, patientId: string): void {
    db.insert(entries).values({
        id,
        patientId,
        type: 'note',
        title: 'Voce clinica',
        date: new Date(),
        content: 'fixture',
    }).run();
}

function selectLifecycleRow(db: BetterSQLite3Database, id: string) {
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

function memberships(db: BetterSQLite3Database, patientId: string): string[] {
    return db
        .select({ ambulatoryId: patientsToAmbulatories.ambulatoryId })
        .from(patientsToAmbulatories)
        .where(eq(patientsToAmbulatories.patientId, patientId))
        .all()
        .map((row) => row.ambulatoryId)
        .sort();
}

test('a patient with test+live memberships survives and only loses the test link', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertAmbulatories(db);
        insertFakePatient(db, 'patient-live', 2);
        linkMembership(db, 'patient-live', TEST_AMBULATORY);
        linkMembership(db, 'patient-live', LIVE_AMBULATORY);

        const result = clearTestContainerByMembership(db, TEST_AMBULATORY);

        assert.deepEqual(result.clearedPatients, []);
        assert.deepEqual(result.preservedLivePatientIds, ['patient-live']);
        assert.equal(result.removedMembershipRows, 1);

        const row = selectLifecycleRow(db, 'patient-live');
        assert.equal(row?.deletedAt, null, 'live patient must never be tombstoned by the clear');
        assert.equal(row?.version, 2, 'live patient version must be untouched');
        assert.deepEqual(memberships(db, 'patient-live'), [LIVE_AMBULATORY]);
    } finally {
        sqlite.close();
    }
});

test('a test-only patient is soft-deleted with the dedicated reason, children intact', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertAmbulatories(db);
        insertFakePatient(db, 'patient-test-only', 3);
        linkMembership(db, 'patient-test-only', TEST_AMBULATORY);
        insertChildEntry(db, 'entry-1', 'patient-test-only');

        const result = clearTestContainerByMembership(db, TEST_AMBULATORY);

        assert.deepEqual(result.clearedPatients, [{ id: 'patient-test-only', version: 3 }]);
        assert.deepEqual(result.preservedLivePatientIds, []);
        assert.equal(result.removedMembershipRows, 1);

        const row = selectLifecycleRow(db, 'patient-test-only');
        assert.ok(row, 'soft-deleted patient row must stay in the table');
        assert.ok(row?.deletedAt instanceof Date, 'clear must write a tombstone, not a hard delete');
        assert.equal(row?.deletionReason, TEST_CONTAINER_CLEAR_REASON);
        assert.equal(row?.version, 4, 'tombstone must bump the version');

        const active = db
            .select({ id: patients.id })
            .from(patients)
            .where(and(eq(patients.id, 'patient-test-only'), activePatients()))
            .get();
        assert.equal(active, undefined, 'cleared patient must disappear from active reads');

        const child = db.select({ id: entries.id }).from(entries).where(eq(entries.patientId, 'patient-test-only')).get();
        assert.ok(child, 'clinical children must stay linked for the audited admin purge');
        assert.deepEqual(memberships(db, 'patient-test-only'), []);
    } finally {
        sqlite.close();
    }
});

test('WUL-300 stale legacy ambulatoryId pointing at the test container is ignored', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertAmbulatories(db);
        // Clipboard CUT (assign+unassign) updates only the M2M: the legacy column
        // still points at the test container while the patient lives elsewhere.
        insertFakePatient(db, 'patient-stale', 7, TEST_AMBULATORY);
        linkMembership(db, 'patient-stale', LIVE_AMBULATORY);
        insertChildEntry(db, 'entry-stale', 'patient-stale');

        const result = clearTestContainerByMembership(db, TEST_AMBULATORY);

        assert.deepEqual(result.clearedPatients, []);
        assert.deepEqual(result.preservedLivePatientIds, []);
        assert.equal(result.removedMembershipRows, 0);

        const row = selectLifecycleRow(db, 'patient-stale');
        assert.equal(row?.deletedAt, null, 'a live patient swept by column drift must not be touched');
        assert.equal(row?.version, 7);
        assert.deepEqual(memberships(db, 'patient-stale'), [LIVE_AMBULATORY]);
        const child = db.select({ id: entries.id }).from(entries).where(eq(entries.patientId, 'patient-stale')).get();
        assert.ok(child, 'children of the untouched patient must remain');
    } finally {
        sqlite.close();
    }
});

test('a membership in another TEST container does not protect a patient', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertAmbulatories(db);
        insertFakePatient(db, 'patient-double-test', 1);
        linkMembership(db, 'patient-double-test', TEST_AMBULATORY);
        linkMembership(db, 'patient-double-test', OTHER_TEST_AMBULATORY);

        const result = clearTestContainerByMembership(db, TEST_AMBULATORY);

        assert.deepEqual(result.clearedPatients, [{ id: 'patient-double-test', version: 1 }]);
        const row = selectLifecycleRow(db, 'patient-double-test');
        assert.equal(row?.deletionReason, TEST_CONTAINER_CLEAR_REASON);
        // Only the cleared container's join rows are removed.
        assert.deepEqual(memberships(db, 'patient-double-test'), [OTHER_TEST_AMBULATORY]);
    } finally {
        sqlite.close();
    }
});

test('an ambulatory with NULL type counts as live for the exclusion rule', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertAmbulatories(db);
        // Legacy rows created outside drizzle can carry a NULL type: never delete on doubt.
        sqlite.prepare("INSERT INTO ambulatories (id, name, type) VALUES ('amb-null-type', 'Ambulatorio Legacy', NULL)").run();
        insertFakePatient(db, 'patient-null-type', 1);
        linkMembership(db, 'patient-null-type', TEST_AMBULATORY);
        linkMembership(db, 'patient-null-type', 'amb-null-type');

        const result = clearTestContainerByMembership(db, TEST_AMBULATORY);

        assert.deepEqual(result.clearedPatients, []);
        assert.deepEqual(result.preservedLivePatientIds, ['patient-null-type']);
        assert.equal(selectLifecycleRow(db, 'patient-null-type')?.deletedAt, null);
        assert.deepEqual(memberships(db, 'patient-null-type'), ['amb-null-type']);
    } finally {
        sqlite.close();
    }
});

test('an already-tombstoned member keeps its original tombstone and is not re-cleared', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertAmbulatories(db);
        insertFakePatient(db, 'patient-tombstoned', 5);
        linkMembership(db, 'patient-tombstoned', TEST_AMBULATORY);
        const earlier = new Date('2026-01-01T00:00:00.000Z');
        db
            .update(patients)
            .set({ deletedAt: earlier, deletionReason: 'web-delete', version: 6 })
            .where(eq(patients.id, 'patient-tombstoned'))
            .run();

        const result = clearTestContainerByMembership(db, TEST_AMBULATORY);

        assert.deepEqual(result.clearedPatients, [], 'tombstoned members must not be re-deleted');
        assert.equal(result.removedMembershipRows, 1, 'their test link is still removed');

        const row = selectLifecycleRow(db, 'patient-tombstoned');
        assert.equal(row?.deletionReason, 'web-delete', 'the original tombstone reason must survive');
        assert.equal(row?.version, 6, 'no extra version bump on an existing tombstone');
        assert.equal(row?.deletedAt?.getTime(), earlier.getTime());
    } finally {
        sqlite.close();
    }
});

test('clearing an empty test container is a no-op', () => {
    const { sqlite, db } = bootstrapDatabase();
    try {
        insertAmbulatories(db);
        const result = clearTestContainerByMembership(db, TEST_AMBULATORY);
        assert.deepEqual(result, {
            clearedPatients: [],
            preservedLivePatientIds: [],
            removedMembershipRows: 0,
        });
    } finally {
        sqlite.close();
    }
});
