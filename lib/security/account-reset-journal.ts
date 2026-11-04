import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { assertDurableDirectory } from '../sqlite-durability.mjs';
import { readSqliteArchiveGeneration, rotateSqliteArchiveGeneration } from '../archive-generation';
import { ACCOUNT_RESET_RECEIPT_PREFIX } from '../backup-restore-receipt-contract';

/*
 * Durable account reset (configurazione iniziale).
 *
 * The live archive is never renamed: the point of no return is one SQLite IMMEDIATE transaction
 * that deletes the accounts, rotates the archive generation and inserts the receipt row. SQLite
 * commits it atomically, so after a crash the archive is either untouched or reset, never mixed.
 * Around it, a journal beside the archive records the operation:
 *
 *   medical.db.reset-journal/<id>/intent.json    durable before anything else
 *   medical.db.reset-journal/<id>/previous.db    copy of the archive before the reset, kept until confirmed
 *   medical.db.reset-journal/<id>/preserved.json digest of that copy
 *   medical.db.reset-journal/<id>/outcome.json   terminal outcome, written after the commit or by reconciliation
 *   medical.db.reset-journal/<id>/discarded.json explicit confirmation that removed the copy
 *
 * At the next open, an intent without outcome is decided only by the receipt row inside the archive:
 * present means completed, absent means aborted with the archive intact.
 */

export const ACCOUNT_RESET_JOURNAL_SUFFIX = '.reset-journal';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_RECORD_BYTES = 4096;

export type AccountResetPhase = 'intent' | 'preserved' | 'mutated' | 'committed' | 'recorded';
export type AccountResetOutcome = 'in_progress' | 'completed' | 'aborted' | 'undetermined';
export type AccountResetReceipt = Readonly<{
    id: string;
    outcome: AccountResetOutcome;
    startedAt: string | null;
    finishedAt: string | null;
    /** True when the outcome was decided at a later start, after an interruption. */
    reconciled: boolean;
    archiveGeneration: string | null;
    previousArchive: Readonly<{ retained: boolean; sha256: string | null; discardedAt: string | null }>;
}>;

type Intent = { version: 1; id: string; kind: 'account-reset'; target: string; pid: number; startedAt: string; originalGeneration: string };
type Preserved = { version: 1; sha256: string; size: number };
type Outcome = { version: 1; outcome: 'completed' | 'aborted'; finishedAt: string; reconciled: boolean; archiveGeneration: string | null };
type ReceiptRow = { id: string; archiveGeneration: string; previousSha256: string; completedAt: string };

export class AccountResetError extends Error {
    constructor(readonly code: 'RESET_JOURNAL_UNAVAILABLE' | 'RESET_ARCHIVE_CHANGED' | 'RESET_DATABASE_FAILED' | 'RESET_RECEIPT_UNRECORDED',
        readonly receipt: AccountResetReceipt | null = null) {
        super(code);
        this.name = 'AccountResetError';
    }
}

function syncDirectory(dir: string): void {
    // FlushFileBuffers needs write access on Windows; an unsupported flush is an error, never skipped.
    const fd = fs.openSync(dir, process.platform === 'win32' ? 'r+' : 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function syncFile(file: string): void {
    const fd = fs.openSync(file, process.platform === 'win32' ? 'r+' : 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeDurable(file: string, value: unknown): void {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    syncDirectory(path.dirname(file));
}

function regularFile(file: string): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('RESET_JOURNAL_INVALID_ENTRY');
    return true;
}

function readRecord<T>(file: string): T | null {
    if (!regularFile(file)) return null;
    if (fs.statSync(file).size > MAX_RECORD_BYTES) throw new Error('RESET_JOURNAL_INVALID_ENTRY');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function sha256File(file: string): string {
    const hash = createHash('sha256');
    const fd = fs.openSync(file, 'r');
    try {
        const buffer = Buffer.allocUnsafe(1 << 20);
        for (let read = fs.readSync(fd, buffer); read > 0; read = fs.readSync(fd, buffer)) hash.update(buffer.subarray(0, read));
    } finally { fs.closeSync(fd); }
    return hash.digest('hex');
}

const PROCESS_STARTED_AT = Date.now() - process.uptime() * 1000;

/*
 * Whether the process that wrote the intent may still be running it. A PID alone is not enough: after a
 * reboot or a restart the same number can belong to another process, this one included, and the
 * operation would stay "in progress" forever. An intent older than the last boot, or written by this
 * PID before this process started, belongs to a process that no longer exists.
 */
function intentProcessAlive(intent: Intent): boolean {
    const startedAt = Date.parse(intent.startedAt);
    if (!Number.isFinite(startedAt)) return false;
    if (startedAt < Date.now() - os.uptime() * 1000) return false;
    if (intent.pid === process.pid) return startedAt >= PROCESS_STARTED_AT;
    try { process.kill(intent.pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function journalRoot(db: Database.Database): string {
    const name = db.name;
    if (typeof name !== 'string' || !path.isAbsolute(name)) throw new AccountResetError('RESET_JOURNAL_UNAVAILABLE');
    return name + ACCOUNT_RESET_JOURNAL_SUFFIX;
}

function validIntent(value: Intent | null, id: string, target: string): value is Intent {
    return !!value && value.version === 1 && value.kind === 'account-reset' && value.id === id && value.target === target
        && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.startedAt === 'string'
        && typeof value.originalGeneration === 'string';
}

function readReceiptRow(db: Database.Database, id: string): ReceiptRow | null {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(ACCOUNT_RESET_RECEIPT_PREFIX + id) as { value: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.value) as ReceiptRow;
    if (!parsed || parsed.id !== id) throw new Error('RESET_RECEIPT_INVALID');
    return parsed;
}

function describe(db: Database.Database, dir: string, id: string): AccountResetReceipt {
    const undetermined: AccountResetReceipt = { id, outcome: 'undetermined', startedAt: null, finishedAt: null, reconciled: false,
        archiveGeneration: null, previousArchive: { retained: false, sha256: null, discardedAt: null } };
    try {
        const intent = readRecord<Intent>(path.join(dir, 'intent.json'));
        if (!validIntent(intent, id, db.name)) return undetermined;
        const preserved = readRecord<Preserved>(path.join(dir, 'preserved.json'));
        const outcome = readRecord<Outcome>(path.join(dir, 'outcome.json'));
        const discarded = readRecord<{ version: 1; discardedAt: string }>(path.join(dir, 'discarded.json'));
        const previousArchive = { retained: regularFile(path.join(dir, 'previous.db')), sha256: preserved?.sha256 ?? null,
            discardedAt: discarded?.discardedAt ?? null };
        if (!outcome) return { ...undetermined, outcome: intentProcessAlive(intent) ? 'in_progress' : 'undetermined',
            startedAt: intent.startedAt, previousArchive };
        if (outcome.version !== 1 || !['completed', 'aborted'].includes(outcome.outcome)) return { ...undetermined, startedAt: intent.startedAt, previousArchive };
        return { id, outcome: outcome.outcome, startedAt: intent.startedAt, finishedAt: outcome.finishedAt, reconciled: outcome.reconciled === true,
            archiveGeneration: outcome.archiveGeneration, previousArchive };
    } catch { return undetermined; }
}

function operationIds(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AccountResetError('RESET_JOURNAL_UNAVAILABLE');
    return fs.readdirSync(root).filter(name => ID.test(name));
}

/** Every recorded reset, most recent first. Unknown or damaged entries are reported, never repaired here. */
export function listAccountResetReceipts(db: Database.Database): AccountResetReceipt[] {
    const root = journalRoot(db);
    return operationIds(root).map(id => describe(db, path.join(root, id), id))
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
}

/**
 * Decides every interrupted reset from the archive itself. Run it once the archive is open and before
 * serving requests. An operation whose process is still alive is left alone.
 */
export function reconcileAccountResets(db: Database.Database): AccountResetReceipt[] {
    const root = journalRoot(db);
    for (const id of operationIds(root)) {
        const dir = path.join(root, id);
        try {
            if (regularFile(path.join(dir, 'outcome.json'))) continue;
            const intent = readRecord<Intent>(path.join(dir, 'intent.json'));
            if (!validIntent(intent, id, db.name) || intentProcessAlive(intent)) continue;
            const row = readReceiptRow(db, id);
            // Without a receipt row the transaction never committed: the archive is the one before the reset.
            // Record the decision before cleanup: an unexpected partial entry must not hide the abort.
            // previous.db is published only after its sync; a crash may have preceded its digest record.
            if (regularFile(path.join(dir, 'previous.db')) && !regularFile(path.join(dir, 'preserved.json'))) {
                const previous = path.join(dir, 'previous.db');
                writeDurable(path.join(dir, 'preserved.json'), { version: 1, sha256: sha256File(previous), size: fs.statSync(previous).size } satisfies Preserved);
            }
            writeDurable(path.join(dir, 'outcome.json'), { version: 1, outcome: row ? 'completed' : 'aborted',
                finishedAt: new Date().toISOString(), reconciled: true, archiveGeneration: row?.archiveGeneration ?? null } satisfies Outcome);
            if (!row && regularFile(path.join(dir, 'previous.db.partial'))) fs.unlinkSync(path.join(dir, 'previous.db.partial'));
        } catch (error) {
            console.error('[MediFlow] Account reset journal entry left for inspection:', id, (error as Error).message);
        }
    }
    return listAccountResetReceipts(db);
}

/**
 * Deletes every account of the archive behind `db`, with a durable intent, a preserved copy of the
 * previous archive and a durable receipt. Synchronous on purpose: no other request of this process can
 * interleave between the copy and the transaction.
 */
export function resetAccountsDurably(db: Database.Database, options: { onPhaseForTest?: (phase: AccountResetPhase) => void } = {}): AccountResetReceipt {
    const root = journalRoot(db);
    const id = randomUUID();
    const dir = path.join(root, id);
    const partial = path.join(dir, 'previous.db.partial');
    const previous = path.join(dir, 'previous.db');
    let intentWritten = false;
    let committed = false;
    let archiveGeneration = '';
    try {
        assertDurableDirectory(path.dirname(db.name));
        if (db.inTransaction) throw new Error('RESET_REQUIRES_IDLE_CONNECTION');
        try { fs.mkdirSync(root, { mode: 0o700 }); syncDirectory(path.dirname(root)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        operationIds(root);
        fs.mkdirSync(dir, { mode: 0o700 });
        syncDirectory(root);
        writeDurable(path.join(dir, 'intent.json'), { version: 1, id, kind: 'account-reset', target: db.name, pid: process.pid,
            startedAt: new Date().toISOString(), originalGeneration: readSqliteArchiveGeneration(db) } satisfies Intent);
        intentWritten = true;
        options.onPhaseForTest?.('intent');

        // Consistent copy through SQLite, owner-only from its first byte, published only once complete and synced.
        fs.closeSync(fs.openSync(partial, 'wx', 0o600));
        // Read before the copy: in WAL mode a commit by another connection during VACUUM INTO is absent
        // from the copy but already visible to a later read, which would hide it from the check below.
        const copiedAt = Number(db.pragma('data_version', { simple: true }));
        db.prepare('VACUUM INTO ?').run(partial);
        syncFile(partial);
        fs.renameSync(partial, previous);
        syncDirectory(dir);
        const sha256 = sha256File(previous);
        writeDurable(path.join(dir, 'preserved.json'), { version: 1, sha256, size: fs.statSync(previous).size } satisfies Preserved);
        options.onPhaseForTest?.('preserved');

        const synchronous = String(db.pragma('synchronous', { simple: true }));
        // FULL makes the commit itself durable against power loss, not only against a process crash.
        db.pragma('synchronous = FULL');
        try {
            db.transaction(() => {
                // Another connection committed after the copy: the copy would not be the archive being reset.
                if (Number(db.pragma('data_version', { simple: true })) !== copiedAt) throw new AccountResetError('RESET_ARCHIVE_CHANGED');
                try {
                    db.prepare('DELETE FROM users').run();
                    db.prepare('DELETE FROM archive_session_generations').run();
                    archiveGeneration = rotateSqliteArchiveGeneration(db);
                    const row: ReceiptRow = { id, archiveGeneration, previousSha256: sha256, completedAt: new Date().toISOString() };
                    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(ACCOUNT_RESET_RECEIPT_PREFIX + id, JSON.stringify(row));
                } catch { throw new AccountResetError('RESET_DATABASE_FAILED'); }
                options.onPhaseForTest?.('mutated');
            }).immediate();
            committed = true;
        } finally { db.pragma(`synchronous = ${/^[0-3]$/u.test(synchronous) ? synchronous : 'NORMAL'}`); }
        options.onPhaseForTest?.('committed');

        writeDurable(path.join(dir, 'outcome.json'), { version: 1, outcome: 'completed', finishedAt: new Date().toISOString(),
            reconciled: false, archiveGeneration } satisfies Outcome);
        options.onPhaseForTest?.('recorded');
        return describe(db, dir, id);
    } catch (error) {
        if (committed) throw new AccountResetError('RESET_RECEIPT_UNRECORDED', describe(db, dir, id));
        let receipt: AccountResetReceipt | null = null;
        if (intentWritten) {
            // The transaction rolled back or never started: record the abort, drop only the incomplete copy.
            try {
                writeDurable(path.join(dir, 'outcome.json'), { version: 1, outcome: 'aborted', finishedAt: new Date().toISOString(),
                    reconciled: false, archiveGeneration: null } satisfies Outcome);
                receipt = describe(db, dir, id);
                if (regularFile(partial)) fs.unlinkSync(partial);
            } catch { /* preserve an unrecognized partial entry; reconcile an unwritten outcome at next start */ }
        }
        if (error instanceof AccountResetError) throw new AccountResetError(error.code, receipt);
        throw new AccountResetError(intentWritten ? 'RESET_DATABASE_FAILED' : 'RESET_JOURNAL_UNAVAILABLE', receipt);
    }
}

/** Explicit confirmation: removes the copy of the archive kept by a finished reset, after checking its digest. */
export function discardPreviousArchive(db: Database.Database, id: string): AccountResetReceipt | null {
    if (!ID.test(id)) return null;
    const dir = path.join(journalRoot(db), id);
    const receipt = describe(db, dir, id);
    if (receipt.outcome !== 'completed' && receipt.outcome !== 'aborted') return null;
    const previous = path.join(dir, 'previous.db');
    if (!receipt.previousArchive.retained || !receipt.previousArchive.sha256 || sha256File(previous) !== receipt.previousArchive.sha256) return null;
    if (!regularFile(path.join(dir, 'discarded.json'))) writeDurable(path.join(dir, 'discarded.json'), { version: 1, discardedAt: new Date().toISOString() });
    fs.unlinkSync(previous);
    syncDirectory(dir);
    return describe(db, dir, id);
}
