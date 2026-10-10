import {
    checkHasCanonicalPhysicianReviewAttestationSchema,
    checkHasCanonicalHeadlessSoapActiveRoleAttestationSchema,
    checkHasCanonicalHeadlessCheckupActiveRoleAttestationSchema,
    checkHasCanonicalHeadlessSoapEntryCommitSchema,
    checkHasCanonicalDurableReviewPatientLinkSchema,
    validateRecoveryAuditSchema,
    initializeSqliteSchema,
} from '@/lib/sqlite-schema';
export { HeadlessSoapActiveRoleAttestationSchemaError, HeadlessSoapEntryCommitSchemaError } from '@/lib/sqlite-schema';
export type { HeadlessSoapActiveRoleAttestationSchemaErrorCode, HeadlessSoapEntryCommitSchemaErrorCode } from '@/lib/sqlite-schema';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
/* @Codex */
import fs from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/data-dir';
import { copySqliteDatabaseSync, recoverSqliteSwapArtifacts, replaceSqliteDatabase, SqliteSwapRecoveryRequiredError } from '@/lib/sqlite-repair';
import { initSqlitePragmas } from '@/lib/sqlite-pragmas';

// Import is inert; only an explicit open or use of the lazy client acquires SQLite.
let sqlite: Database.Database;
// Assigned only by the first successful open, never by swap/reopen.
let initialSqlite: Database.Database;
let dbPath: string;
let openState: 'unopened' | 'opening' | 'opened' | 'failed' = 'unopened';
let openFailure: unknown;
/** Opens once synchronously. A failed open or subsequently closed handle never silently reopens. */
export function openDbServer(): Database.Database {
    if (openState === 'failed') throw openFailure;
    if (openState === 'opened') return sqlite;
    if (openState === 'opening') throw new Error('Database initialization is already in progress.');
    openState = 'opening';
    try {
        const isNextProductionBuild = process.env.NEXT_PHASE === 'phase-production-build';
        /* @Codex */
        dbPath = isNextProductionBuild ? ':memory:' : resolveDataPath('medical.db');
        const legacyDbPath = path.join(process.cwd(), 'medical.db');

        // Recovery decides before legacy adoption, SQLite open or schema bootstrap.
        // Build-time imports have no authority even to inspect persistent artifacts.
        const swapRecovery = isNextProductionBuild ? { status: 'CLEAN' as const } : recoverSqliteSwapArtifacts(dbPath);
        if (swapRecovery.status === 'HOLD') throw new SqliteSwapRecoveryRequiredError();

        // An explicitly selected archive must not adopt an unrelated database from cwd.
        // Keep the historical default-root migration, with the same opt-out as E2E setup.
        const allowLegacyBootstrapCopy = !process.env.MEDIFLOW_DATA_DIR
            && process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1';
        if (!isNextProductionBuild && allowLegacyBootstrapCopy
            && !fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
            // Copy through SQLite (recovers pages still in the legacy -wal sidecar)
            // and stage + rename so a failed copy never leaves a torn medical.db:
            // a plain fs.copyFileSync here was the same bug WUL-321 fixes (boot path).
            const bootStagingPath = `${dbPath}.repair-tmp-boot-${process.pid}`;
            try {
                fs.rmSync(bootStagingPath, { force: true });
                copySqliteDatabaseSync(legacyDbPath, bootStagingPath);
                fs.renameSync(bootStagingPath, dbPath);
                console.log(`[MediFlow] Copied legacy DB to ${dbPath}`);
            } catch (error) {
                console.error('[MediFlow] Failed to copy legacy DB:', error);
                fs.rmSync(bootStagingPath, { force: true });
                throw error;
            }
        }

        // WUL-268 (STREAM A): apply durable pragmas (WAL, busy_timeout, synchronous,
        // foreign_keys) right after every open (boot + swap). See lib/sqlite-pragmas.ts.
        sqlite = new Database(dbPath);
        initSqlitePragmas(sqlite);
        if (!isNextProductionBuild) {
            initializeSqliteSchema(sqlite);
            if (swapRecovery.status === 'RECOVERED') {
                validateRecoveryAuditSchema(sqlite);
                swapRecovery.complete();
            }
        }
        initialSqlite = sqlite;
        openState = 'opened';
        return sqlite;
    } catch (error) {
        openFailure = error;
        openState = 'failed';
        if (sqlite?.open) sqlite.close();
        throw error;
    }
}

/** Lazy access for owners whose authority remains tied to the first connection. */
export function getInitialDbServerHandle(): Database.Database {
    openDbServer();
    return initialSqlite;
}

/**
 * Replaces the SQLite file from sourcePath without writing under the open
 * shared connection: close, stage independent SQLite snapshots, journal the
 * replacement, reopen and re-apply schema guards, then persist the swap commit.
 * Queries during asynchronous staging encounter the closed shared handle.
 * Reopening, validation and the durable commit run without an event-loop yield.
 *
 * Swaps are serialized per destination inside replaceSqliteDatabase: a second
 * call while one is running rejects with SqliteSwapInProgressError before
 * touching the shared connection (the route maps it to HTTP 409).
 */
export async function swapDatabaseFromFile(sourcePath: string, backupPath: string | null): Promise<void> {
    openDbServer();
    await replaceSqliteDatabase({
        sourcePath,
        destPath: dbPath,
        backupPath,
        connection: sqlite,
        reopenConnection: () => {
            sqlite = new Database(dbPath);
            try {
                initSqlitePragmas(sqlite);
                initializeSqliteSchema(sqlite);
                validateRecoveryAuditSchema(sqlite);
                return sqlite;
            } catch (error) {
                sqlite.close();
                throw error;
            }
        },
    });
}

// Stable handle so the shared drizzle instance keeps working across the
// close/reopen performed by swapDatabaseFromFile.
const sqliteHandle = new Proxy({} as Database.Database, {
    get(_target, prop) {
        openDbServer();
        const value = Reflect.get(sqlite, prop) as unknown;
        return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(sqlite)
            : value;
    },
    // drizzle 0.45.2 never assigns onto the connection, but forward writes to
    // the live connection anyway so they can never land on the dummy target.
    set(_target, prop, value) {
        openDbServer();
        return Reflect.set(sqlite, prop, value);
    },
});
// Explicit config avoids Drizzle inspecting proxy.constructor during import.
export const dbServer = drizzle({ client: sqliteHandle });

/* @Codex */
/** Runs a bounded DB mutation under SQLite's writer lock so stale readers cannot race a CAS decision. */
export function runDbServerImmediateTransaction<T>(operation: () => T): T {
    return openDbServer().transaction(operation).immediate();
}

export function hasCanonicalPhysicianReviewAttestationSchema(): boolean {
    openDbServer();
    return checkHasCanonicalPhysicianReviewAttestationSchema(sqlite);
}

export function hasCanonicalHeadlessSoapActiveRoleAttestationSchema(): boolean {
    openDbServer();
    return checkHasCanonicalHeadlessSoapActiveRoleAttestationSchema(sqlite);
}

export function hasCanonicalHeadlessCheckupActiveRoleAttestationSchema(): boolean {
    openDbServer();
    return checkHasCanonicalHeadlessCheckupActiveRoleAttestationSchema(sqlite);
}

export function hasCanonicalHeadlessSoapEntryCommitSchema(): boolean {
    openDbServer();
    return checkHasCanonicalHeadlessSoapEntryCommitSchema(sqlite);
}

export function hasCanonicalDurableReviewPatientLinkSchema(): boolean {
    openDbServer();
    return checkHasCanonicalDurableReviewPatientLinkSchema(sqlite);
}
