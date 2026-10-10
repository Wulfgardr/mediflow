import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { assertDurableDirectory } from './sqlite-durability.mjs';

const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const;

/** Thrown when a swap is requested while another swap of the same file is still running. */
export class SqliteSwapInProgressError extends Error {
    constructor(destPath: string) {
        super(`A database swap is already in progress for ${destPath}`);
        this.name = 'SqliteSwapInProgressError';
    }
}

// In-flight guard, keyed by resolved destination path. Two swaps of the same
// file interleave at the await points below and can delete each other's only
// surviving copy, so a second request fails fast instead of queueing.
const inFlightSwaps = new Set<string>();

const RECOVERY_SUFFIX = '.swap-recovery';
const RECOVERY_FILES = ['prepared.json', 'committed.json', 'original.db', 'replacement.db',
    'retired.db', 'retired.db-wal', 'retired.db-shm', 'failed.db', 'failed.db-wal', 'failed.db-shm', 'restore.db'] as const;

export class SqliteSwapRecoveryRequiredError extends Error {
    constructor() {
        super('SQLITE_SWAP_RECOVERY_REQUIRED: database recovery is on HOLD; preserve the data directory and all swap artifacts.');
        this.name = 'SqliteSwapRecoveryRequiredError';
    }
}

interface SwapJournal {
    version: 1;
    id: string;
    target: string;
    pid: number;
    originalSha256: string;
    replacementSha256: string;
}

interface SwapContext { target: string; dir: string; journal: SwapJournal; journalText: string }

export type SqliteSwapRecovery = { status: 'CLEAN' } | { status: 'HOLD' }
    | { status: 'RECOVERED'; complete: () => void };

function regularFile(file: string): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new SqliteSwapRecoveryRequiredError();
    return true;
}

function canonicalTarget(file: string): string {
    const parent = path.dirname(path.resolve(file));
    if (!fs.lstatSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink()) throw new SqliteSwapRecoveryRequiredError();
    const target = path.join(fs.realpathSync(parent), path.basename(file));
    regularFile(target);
    return target;
}

function digest(file: string): string {
    if (!regularFile(file)) throw new SqliteSwapRecoveryRequiredError();
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function syncFile(file: string): void {
    if (!regularFile(file)) throw new SqliteSwapRecoveryRequiredError();
    // FlushFileBuffers needs write access even when no bytes are changed.
    const fd = fs.openSync(file, process.platform === 'win32' ? 'r+' : 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// Unsupported directory durability is an error, never silently downgraded.
function syncDirectory(dir: string): void {
    const fd = fs.openSync(dir, process.platform === 'win32' ? 'r+' : 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeDurable(file: string, text: string): void {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    syncDirectory(path.dirname(file));
}

function assertIntegrity(file: string): void {
    if (!regularFile(file) || fs.statSync(file).size === 0) throw new SqliteSwapRecoveryRequiredError();
    for (const suffix of SIDECAR_SUFFIXES) regularFile(file + suffix);
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
        if (db.pragma('integrity_check', { simple: true }) !== 'ok'
            || (db.pragma('foreign_key_check') as unknown[]).length !== 0
            || !db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' LIMIT 1").get()) {
            throw new SqliteSwapRecoveryRequiredError();
        }
    } finally { db.close(); }
}

function sealSnapshot(file: string): void {
    const snapshot = new Database(file, { fileMustExist: true });
    try { snapshot.pragma('journal_mode = DELETE'); } finally { snapshot.close(); }
    assertIntegrity(file);
    for (const suffix of SIDECAR_SUFFIXES) {
        if (regularFile(file + suffix)) throw new SqliteSwapRecoveryRequiredError();
    }
    syncFile(file);
}

function artifactNames(target: string): string[] {
    const base = path.basename(target);
    return fs.readdirSync(path.dirname(target)).filter(name => name === base + RECOVERY_SUFFIX
        || name.startsWith(base + '.old-') || name.startsWith(base + '.repair-tmp'));
}

function assertRecoveryDirectory(dir: string): string[] {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SqliteSwapRecoveryRequiredError();
    const names = fs.readdirSync(dir);
    for (const name of names) {
        if (!(RECOVERY_FILES as readonly string[]).includes(name) || !regularFile(path.join(dir, name))) throw new SqliteSwapRecoveryRequiredError();
    }
    return names;
}

function readContext(target: string): SwapContext {
    const dir = target + RECOVERY_SUFFIX;
    assertRecoveryDirectory(dir);
    const journalText = fs.readFileSync(path.join(dir, 'prepared.json'), 'utf8');
    const journal = JSON.parse(journalText) as SwapJournal;
    if (!journal || Object.keys(journal).sort().join(',') !== 'id,originalSha256,pid,replacementSha256,target,version'
        || journal.version !== 1 || journal.target !== target
        || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(journal.id)
        || !Number.isSafeInteger(journal.pid) || journal.pid <= 0
        || !/^[0-9a-f]{64}$/.test(journal.originalSha256) || !/^[0-9a-f]{64}$/.test(journal.replacementSha256)) {
        throw new SqliteSwapRecoveryRequiredError();
    }
    return { target, dir, journal, journalText };
}

function commitExists(context: SwapContext): boolean {
    return regularFile(path.join(context.dir, 'committed.json'));
}

function validateCommit(context: SwapContext): void {
    const commit = JSON.parse(fs.readFileSync(path.join(context.dir, 'committed.json'), 'utf8'));
    if (!commit || Object.keys(commit).sort().join(',') !== 'journalSha256,version' || commit.version !== 1
        || commit.journalSha256 !== createHash('sha256').update(context.journalText).digest('hex')) throw new SqliteSwapRecoveryRequiredError();
}

function commitSwap(context: SwapContext): void {
    // The validation callback may have changed schema/currentness in the WAL.
    // Persist that state, then persist the decision before any caller can write.
    syncFile(context.target);
    for (const suffix of SIDECAR_SUFFIXES) if (regularFile(context.target + suffix)) syncFile(context.target + suffix);
    syncDirectory(path.dirname(context.target));
    writeDurable(path.join(context.dir, 'committed.json'), JSON.stringify({ version: 1,
        journalSha256: createHash('sha256').update(context.journalText).digest('hex') }));
}

function cleanupCommitted(context: SwapContext): void {
    assertRecoveryDirectory(context.dir);
    validateCommit(context);
    for (const [name, expected] of [['original.db', context.journal.originalSha256], ['replacement.db', context.journal.replacementSha256]]) {
        const file = path.join(context.dir, name);
        if (regularFile(file) && digest(file) !== expected) throw new SqliteSwapRecoveryRequiredError();
    }
    for (const name of RECOVERY_FILES) {
        if (name === 'prepared.json' || name === 'committed.json') continue;
        const file = path.join(context.dir, name);
        if (regularFile(file)) fs.unlinkSync(file);
    }
    // Make loss of the rollback snapshot durable BEFORE removing the commit
    // marker. A crash during cleanup can then only preserve current state/HOLD.
    syncDirectory(context.dir);
    fs.unlinkSync(path.join(context.dir, 'prepared.json'));
    fs.unlinkSync(path.join(context.dir, 'committed.json'));
    fs.rmdirSync(context.dir);
    syncDirectory(path.dirname(context.target));
}

function restoreOriginal(context: SwapContext): void {
    if (commitExists(context)) throw new SqliteSwapRecoveryRequiredError();
    const original = path.join(context.dir, 'original.db');
    if (digest(original) !== context.journal.originalSha256) throw new SqliteSwapRecoveryRequiredError();
    assertIntegrity(original);
    const replacement = path.join(context.dir, 'replacement.db');
    if (regularFile(replacement) && digest(replacement) !== context.journal.replacementSha256) throw new SqliteSwapRecoveryRequiredError();
    // Never overwrite a previous interrupted recovery attempt or an alias.
    for (const name of ['restore.db', 'failed.db', 'failed.db-wal', 'failed.db-shm']) {
        if (regularFile(path.join(context.dir, name))) throw new SqliteSwapRecoveryRequiredError();
    }
    regularFile(context.target);
    for (const suffix of SIDECAR_SUFFIXES) regularFile(context.target + suffix);
    const restore = path.join(context.dir, 'restore.db');
    fs.copyFileSync(original, restore, fs.constants.COPYFILE_EXCL);
    syncFile(restore);
    syncDirectory(context.dir);
    // Keep the failed candidate and its WAL for inspection. The independent
    // original snapshot, not a renamed main/WAL tuple, is the recovery source.
    renameIfExists(context.target, path.join(context.dir, 'failed.db'));
    for (const suffix of SIDECAR_SUFFIXES) renameIfExists(context.target + suffix, path.join(context.dir, 'failed.db' + suffix));
    fs.renameSync(restore, context.target);
    syncDirectory(context.dir);
    syncDirectory(path.dirname(context.target));
}

/** Pre-open recovery; HOLD never permits legacy adoption or empty bootstrap. */
export function recoverSqliteSwapArtifacts(file: string): SqliteSwapRecovery {
    try {
        const target = canonicalTarget(file);
        const names = artifactNames(target);
        if (names.length === 0) return { status: 'CLEAN' };
        if (names.length !== 1 || names[0] !== path.basename(target) + RECOVERY_SUFFIX) return { status: 'HOLD' };
        assertDurableDirectory(path.dirname(path.resolve(file)));
        const context = readContext(target);
        // A live/unknown owner might still be swapping. PID reuse is HOLD.
        try { process.kill(context.journal.pid, 0); return { status: 'HOLD' }; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return { status: 'HOLD' }; }
        if (commitExists(context)) {
            validateCommit(context);
            assertIntegrity(target);
        } else restoreOriginal(context);
        return { status: 'RECOVERED', complete: () => {
            assertDurableDirectory(path.dirname(target));
            if (!commitExists(context)) commitSwap(context);
            cleanupCommitted(context);
        } };
    } catch { return { status: 'HOLD' }; }
}

/**
 * Copies a SQLite database via the online backup API so pending WAL pages are
 * included even while another connection holds the source file open. A plain
 * fs.copyFileSync of a WAL-mode database misses every page still in the -wal
 * sidecar and produces a torn copy.
 */
export async function backupSqliteDatabase(sourcePath: string, destPath: string): Promise<void> {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
        await source.backup(destPath);
    } finally {
        source.close();
    }
}

/**
 * Synchronous consistent copy for call sites that cannot await (the module-load
 * legacy migration). VACUUM INTO reads through SQLite, so committed pages still
 * sitting in a -wal sidecar are included, unlike fs.copyFileSync, which tears
 * a WAL-mode database. destPath must not exist yet.
 */
export function copySqliteDatabaseSync(sourcePath: string, destPath: string): void {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
        source.prepare('VACUUM INTO ?').run(destPath);
    } finally {
        source.close();
    }
}

/**
 * Preserve an original before schema changes. The caller must already hold its
 * writer exclusion (BEGIN IMMEDIATE). This helper never opens the source for writes.
 * Publication is exclusive: the final name links only to a verified, fsynced file.
 * A failure after publication may leave that complete snapshot; never remove a
 * destination here, and never let a failed directory sync authorize migration.
 */
export function createVerifiedSqliteSnapshotSync(sourcePath: string, destinationPath: string): void {
    const source = canonicalTarget(sourcePath);
    const destination = canonicalTarget(destinationPath);
    const parent = path.dirname(destination);
    assertDurableDirectory(parent);
    if ([destination, ...SIDECAR_SUFFIXES.map(suffix => destination + suffix)].some(regularFile)) {
        throw new Error('SQLITE_SNAPSHOT_DESTINATION_EXISTS');
    }
    // An exclusively owned directory avoids touching another operation's files.
    // Its prefix is deliberately outside the swap recovery artifact vocabulary.
    const temporaryDirectory = fs.mkdtempSync(path.join(parent, '.schema-snapshot-'));
    const temporary = path.join(temporaryDirectory, 'original.db');
    try {
        copySqliteDatabaseSync(source, temporary);
        fs.chmodSync(temporary, 0o600);
        sealSnapshot(temporary);
        syncDirectory(temporaryDirectory);
        if (SIDECAR_SUFFIXES.some(suffix => regularFile(destination + suffix))) {
            throw new Error('SQLITE_SNAPSHOT_DESTINATION_EXISTS');
        }
        // rename would overwrite a racing destination on POSIX; link fails EEXIST.
        fs.linkSync(temporary, destination);
        fs.unlinkSync(temporary);
        syncDirectory(parent);
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

/** Removes -wal/-shm sidecar files so a swapped-in DB cannot inherit stale WAL pages. */
export function removeSqliteSidecars(dbPath: string): void {
    for (const suffix of SIDECAR_SUFFIXES) {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
}

function renameIfExists(fromPath: string, toPath: string): boolean {
    if (!fs.existsSync(fromPath)) return false;
    fs.renameSync(fromPath, toPath);
    return true;
}

export interface ReplaceSqliteDatabaseOptions {
    /** Database file whose content replaces destPath. */
    sourcePath: string;
    /** Live database file, currently open through `connection`. */
    destPath: string;
    /** Optional pre-swap backup of destPath, written before any file is touched. */
    backupPath?: string | null;
    /** Shared connection on destPath; closed before asynchronous staging. External writers must be stopped. */
    connection: Database.Database;
    /** Synchronous validation; close on throw, return the candidate handle so commit failure can close it. */
    reopenConnection: () => Database.Database | void;
    /**
     * Test seam: runs after destPath has been retired inside the recovery directory and
     * before the staged file is renamed into place, i.e. inside the only
     * window where destPath is missing from disk.
     */
    beforeSwapInForTest?: () => void;
    onPhaseForTest?: (phase: 'prepared' | 'retired' | 'installed' | 'validated' | 'committed' | 'cleanup') => void;
}

/**
 * Replaces destPath with the content of sourcePath without ever writing to the
 * shared handle while the connection is open. The online backup API produces
 * independent original/replacement snapshots, including committed WAL pages.
 * A durable journal precedes retirement; a separate durable commit follows
 * synchronous reopening/validation and precedes returning to application code.
 *
 * Crash/failure safety: startup can restore a verified original before commit.
 * After commit it preserves the current database, including later WAL writes.
 * Uncertain preparation/commit failures keep the connection closed and retain
 * recovery evidence. This does not fence independent external database writers.
 * Swaps of the same destination are serialized: a second concurrent call
 * fails fast with SqliteSwapInProgressError without touching the connection.
 */
export async function replaceSqliteDatabase(options: ReplaceSqliteDatabaseOptions): Promise<void> {
    const { sourcePath, destPath, backupPath, connection, reopenConnection } = options;
    const destKey = path.resolve(destPath);
    if (inFlightSwaps.has(destKey)) {
        throw new SqliteSwapInProgressError(destPath);
    }
    inFlightSwaps.add(destKey);

    let context: SwapContext | undefined;
    let prepared = false;
    let reopening = false;
    let candidate: Database.Database | void = undefined;
    try {
        assertDurableDirectory(path.dirname(path.resolve(destPath)));
        if (backupPath) assertDurableDirectory(path.dirname(path.resolve(backupPath)));
        const target = canonicalTarget(destPath);
        if (artifactNames(target).length !== 0) throw new SqliteSwapRecoveryRequiredError();
        if (!regularFile(target) || path.resolve(sourcePath) === target) throw new SqliteSwapRecoveryRequiredError();
        const dir = target + RECOVERY_SUFFIX;
        fs.mkdirSync(dir, { mode: 0o700 });
        syncDirectory(path.dirname(target));
        const original = path.join(dir, 'original.db');
        const staging = path.join(dir, 'replacement.db');
        const retired = path.join(dir, 'retired.db');
        connection.close();
        try {
            if (!regularFile(sourcePath)) throw new SqliteSwapRecoveryRequiredError();
            if (fs.realpathSync(sourcePath) === target) throw new SqliteSwapRecoveryRequiredError();
            for (const file of [target, sourcePath]) for (const suffix of SIDECAR_SUFFIXES) regularFile(file + suffix);
            await backupSqliteDatabase(target, original);
            await backupSqliteDatabase(sourcePath, staging);
            sealSnapshot(original);
            sealSnapshot(staging);
            if (backupPath) {
                const backup = path.resolve(backupPath);
                if (backup === target || backup === path.resolve(sourcePath) || backup.startsWith(dir + path.sep)) throw new SqliteSwapRecoveryRequiredError();
                regularFile(backup);
                fs.copyFileSync(original, backup, fs.constants.COPYFILE_EXCL);
                syncFile(backup);
                syncDirectory(path.dirname(backup));
            }
            const journal: SwapJournal = { version: 1, id: randomUUID(), target, pid: process.pid,
                originalSha256: digest(original), replacementSha256: digest(staging) };
            context = { target, dir, journal, journalText: JSON.stringify(journal) };
            writeDurable(path.join(dir, 'prepared.json'), context.journalText);
            prepared = true;
            options.onPhaseForTest?.('prepared');
            fs.renameSync(target, retired);
            for (const suffix of SIDECAR_SUFFIXES) renameIfExists(target + suffix, retired + suffix);
            syncDirectory(dir);
            syncDirectory(path.dirname(target));
            options.onPhaseForTest?.('retired');
            options.beforeSwapInForTest?.();
            fs.renameSync(staging, target);
            syncDirectory(dir);
            syncDirectory(path.dirname(target));
            options.onPhaseForTest?.('installed');
            reopening = true;
            candidate = reopenConnection();
            assertIntegrity(target);
            options.onPhaseForTest?.('validated');
            commitSwap(context);
            options.onPhaseForTest?.('committed');
        } catch (error) {
            if (candidate?.open) candidate.close();
            if (prepared && context && !reopening && !commitExists(context)) {
                try {
                    restoreOriginal(context);
                    candidate = reopenConnection();
                    commitSwap(context);
                    cleanupCommitted(context);
                } catch { if (candidate?.open) candidate.close(); }
            } else if (!prepared) {
                // No destination rename occurred. Keep a partial journal on
                // uncertain durability; it will fail closed at the next open.
                if (!fs.existsSync(path.join(dir, 'prepared.json'))) {
                    for (const file of [staging, original]) if (regularFile(file)) fs.unlinkSync(file);
                    fs.rmdirSync(dir);
                    reopenConnection();
                }
            }
            throw error;
        }
        // No rollback belongs after the durable commit. Cleanup failure must
        // not turn an already committed replacement into a failed restore.
        try { options.onPhaseForTest?.('cleanup'); cleanupCommitted(context); }
        catch { console.warn('[MediFlow] Database swap committed; recovery cleanup is pending.'); }
    } finally {
        inFlightSwaps.delete(destKey);
    }
}
