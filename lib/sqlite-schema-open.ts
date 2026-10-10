import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import reservation from '../scripts/native-first-install-contract.json' with { type: 'json' };
import { checkHasCanonicalHeadlessSoapActiveRoleAttestationSchema, initializeSqliteSchema } from './sqlite-schema';
import { schemaSnapshot, schemaDifferences } from './sqlite-schema-shape';
import { createVerifiedSqliteSnapshotSync } from './sqlite-repair';
import { initSqlitePragmas } from './sqlite-pragmas';
import { upgradeObservationTimestampDefault } from './sqlite-observation-schema-upgrade';

export const CURRENT_SQLITE_SCHEMA_VERSION = 1;

export class SqliteSchemaRecoveryRequiredError extends Error {
    readonly code = 'SQLITE_SCHEMA_RECOVERY_REQUIRED';
    constructor(readonly reason: string) {
        super(`SQLITE_SCHEMA_RECOVERY_REQUIRED: ${reason}`);
        this.name = 'SqliteSchemaRecoveryRequiredError';
    }
}

function deny(reason: string): never { throw new SqliteSchemaRecoveryRequiredError(reason); }

function assertIntegrity(connection: Database.Database): void {
    const integrity = connection.pragma('integrity_check') as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') deny('integrity check failed');
}

// Orphan rows already in an archive are repairable data, not a reason to lock
// the clinician out. Migration must not add any.
function foreignKeyViolations(connection: Database.Database): string {
    return JSON.stringify(connection.pragma('foreign_key_check'));
}

function assertCanonical(connection: Database.Database, canonical: Database.Database): void {
    // Views are outside the supported schema; never omit them from admission.
    if (connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='view' LIMIT 1").get()) deny('unsupported view');
    // Every product table must match exactly; a table MediFlow does not own is left alone.
    const expected = schemaSnapshot(canonical);
    const differences = schemaDifferences(expected, schemaSnapshot(connection)).filter(({ table }) => table in expected);
    if (differences.length) deny(`unsupported schema (${differences[0].table}.${differences[0].aspect})`);
}

/** Open is the only authority to create or migrate; importing this module is inert. */
export function openVersionedSqliteDatabase(databasePath: string): Database.Database {
    let created = false;
    let before: fs.Stats;
    try { before = fs.lstatSync(databasePath); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // Sidecars, preserved originals or swap artifacts mean a database lived
        // here; unrelated files (tokens, logs, .DS_Store) do not.
        const leftovers = fs.readdirSync(path.dirname(databasePath)).filter(name => name.startsWith(path.basename(databasePath)));
        if (leftovers.length !== 0 && !fs.existsSync(databasePath)) deny('missing database in an existing archive');
        // Another first-start worker may have won after lstat. It must finish
        // its own admission; this process never promotes its empty file.
        try {
            const fd = fs.openSync(databasePath, 'wx', 0o600);
            fs.closeSync(fd);
            created = true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        before = fs.lstatSync(databasePath);
    }
    if (!before.isFile() || before.isSymbolicLink()) deny('database is not a regular file');
    if (!created && before.size === 0) {
        // Observe an already-running first writer for at most SQLite's existing
        // busy window. An abandoned/truncated file is never initialized here.
        const deadline = performance.now() + 5000;
        const waiter = new Int32Array(new SharedArrayBuffer(4));
        while (before.size === 0 && performance.now() < deadline) {
            Atomics.wait(waiter, 0, 0, 50);
            const current = fs.lstatSync(databasePath);
            if (current.dev !== before.dev || current.ino !== before.ino || !current.isFile()) deny('database identity changed');
            before = current;
        }
        if (before.size === 0) deny('empty file has no first-install reservation');
    }

    const connection = new Database(databasePath, { fileMustExist: true });
    let snapshot: string | undefined;
    try {
        // Connection-only settings precede admission. WAL changes the database
        // header and therefore follows the verified original and schema commit.
        connection.pragma('busy_timeout = 5000');
        connection.pragma('foreign_keys = ON');
        connection.pragma('synchronous = FULL');
        connection.transaction(() => {
            const current = fs.lstatSync(databasePath);
            if (current.dev !== before.dev || current.ino !== before.ino || !current.isFile()) deny('database identity changed');
            const version = Number(connection.pragma('user_version', { simple: true }));
            if (!Number.isSafeInteger(version) || version < 0 || version > CURRENT_SQLITE_SCHEMA_VERSION) deny('newer or unsupported schema version');
            const applicationId = Number(connection.pragma('application_id', { simple: true }));
            const objects = connection.prepare("SELECT type, name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").all();
            const reserved = version === reservation.userVersion && applicationId === reservation.applicationId && objects.length === 0;
            const fresh = (created && version === 0 && applicationId === 0 && objects.length === 0) || reserved;
            if (!fresh && applicationId !== 0) deny('unsupported database application identity');
            if (!fresh && objects.length === 0) deny('empty database has no first-install reservation');
            assertIntegrity(connection);

            const canonical = new Database(':memory:');
            try {
                canonical.pragma('foreign_keys = ON');
                initializeSqliteSchema(canonical);
                if (version === CURRENT_SQLITE_SCHEMA_VERSION) {
                    // Repeated starts validate without DDL, backfill or another snapshot.
                    assertCanonical(connection, canonical);
                    // Clinical orphans are tolerated; a role attestation without its actor never is.
                    if (!checkHasCanonicalHeadlessSoapActiveRoleAttestationSchema(connection)) deny('role attestation without its actor');
                    return;
                }
                if (!fresh) {
                    snapshot = `${databasePath}.schema-original-v${version}-${randomUUID()}.db`;
                    createVerifiedSqliteSnapshotSync(databasePath, snapshot);
                    const afterCopy = fs.lstatSync(databasePath);
                    if (afterCopy.dev !== before.dev || afterCopy.ino !== before.ino) deny('database identity changed during snapshot');
                }
                const violationsBefore = foreignKeyViolations(connection);
                initializeSqliteSchema(connection);
                upgradeObservationTimestampDefault(connection, canonical);
                assertCanonical(connection, canonical);
                assertIntegrity(connection);
                if (foreignKeyViolations(connection) !== violationsBefore) deny('migration changed foreign key violations');
                // The native reservation is consumed atomically with the schema.
                connection.pragma('application_id = 0');
                connection.pragma(`user_version = ${CURRENT_SQLITE_SCHEMA_VERSION}`);
            } finally { canonical.close(); }
        }).immediate();
        initSqlitePragmas(connection);
        return connection;
    } catch (error) {
        // After a rollback the archive is still the original: keeping one more
        // full copy per failed start would only fill the disk.
        const rolledBack = !connection.inTransaction;
        connection.close();
        if (snapshot && rolledBack) fs.rmSync(snapshot, { force: true });
        throw error;
    }
}
