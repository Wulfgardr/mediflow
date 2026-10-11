import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { sql, type SQL } from 'drizzle-orm';

import { resolveDataPath } from '@/lib/data-dir';
import { removeSqliteSidecars } from '@/lib/sqlite-repair';
import { UNLOCK_KDF_VERSION } from '@/lib/security/unlock-credential';

/* ADR 0143. Once an account unlocks with a passphrase, nothing the product keeps beside the
   archive may still hold the PIN wrapping of the same master key: with it, a PIN guessed away
   from the computer opens the archive again. Two things hold it. The full copies the product
   makes: the original kept by a schema upgrade and the backup kept by a repair. And the
   write-ahead log of the archive itself, where the pages written before the move remain.
   A copy made after the move holds the passphrase wrapping only and stays: it is the safety
   net of its own operation. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** What follows the archive name: `lib/sqlite-schema-open.ts` and `app/api/system/repair-db/route.ts` write these. */
const PRODUCT_COPY = new RegExp(`^(?:\\.schema-original-v\\d+-${UUID}\\.db|\\.bak-\\d{8}-\\d{9})$`, 'u');
const PASSPHRASE_WRAPPING = `v${UNLOCK_KDF_VERSION}:`;

export type PinEraCopies = {
    /** File names removed. */
    removed: string[];
    /** File names of product copies that could not be read or removed: someone must look at them. */
    kept: string[];
};

export type PinEraResidues = PinEraCopies & {
    /** Obsolete archive cells were compacted and the write-ahead log brought down to zero bytes. */
    logEmptied: boolean;
    /** Nothing is left to do: every copy was examined, none was kept, the log is empty. */
    complete: boolean;
};

function holdsPinWrapping(file: string, userId: string): boolean {
    const copy = new Database(file, { readonly: true, fileMustExist: true });
    try {
        const wrapping = copy.prepare('SELECT encrypted_master_key FROM users WHERE id = ?').pluck().get(userId);
        // No row: the copy holds nothing of this account.
        return wrapping !== undefined && !(typeof wrapping === 'string' && wrapping.startsWith(PASSPHRASE_WRAPPING));
    } finally {
        copy.close();
    }
}

/**
 * Removes the product copies beside `databasePath` in which the account `userId` still has a
 * wrapping that is not a passphrase wrapping. Call it only once that account unlocks with a
 * passphrase. It can be repeated: an interruption leaves copies that the next call removes.
 * A name that is not a regular file is never followed.
 */
export function retirePinEraArchiveCopies(databasePath: string, userId: string): PinEraCopies {
    const directory = path.dirname(databasePath);
    const base = path.basename(databasePath);
    const result: PinEraCopies = { removed: [], kept: [] };
    for (const name of fs.readdirSync(directory)) {
        if (!name.startsWith(base) || !PRODUCT_COPY.test(name.slice(base.length))) continue;
        const file = path.join(directory, name);
        try {
            if (!fs.lstatSync(file).isFile()) {
                result.kept.push(name);
                continue;
            }
            if (!holdsPinWrapping(file, userId)) {
                // Repair .bak copies use SQLite backup(), which retains obsolete cells even with a live v3 row.
                // Preserve this recovery copy; SELECT alone cannot certify removal of its historical PIN material.
                if (name.includes('.bak-')) result.kept.push(name);
                continue;
            }
            // Sidecars first: what an interruption leaves is then a copy the next call still recognizes.
            removeSqliteSidecars(file);
            fs.rmSync(file);
            result.removed.push(name);
        } catch {
            result.kept.push(name);
        }
    }
    if (result.removed.length > 0) {
        // Make the removal durable where the platform allows it; a failure here leaves nothing to redo.
        try {
            const handle = fs.openSync(directory, 'r');
            try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
        } catch { /* not every platform can sync a directory */ }
    }
    return result;
}

type ArchiveConnection = { all: (query: SQL) => unknown; run: (query: SQL) => unknown };

/** Uses SQLite's own transactional compaction, not an external file swap; a busy reader leaves cleanup pending. */
function emptyWriteAheadLog(db: ArchiveConnection): boolean {
    const [{ timeout }] = db.all(sql`PRAGMA busy_timeout`) as { timeout: number }[];
    db.all(sql`PRAGMA busy_timeout = 0`);
    try {
        // TRUNCATE alone preserves deleted PIN wrappings in free cells, including earlier PIN changes.
        // VACUUM copies live rows through SQLite's WAL/rollback transaction on this admitted connection.
        db.run(sql`VACUUM`);
        // TRUNCATE moves every page into the archive and leaves a log of zero bytes; `busy` means a reader prevented it.
        const [checkpoint] = db.all(sql`PRAGMA wal_checkpoint(TRUNCATE)`) as { busy?: number }[];
        return checkpoint?.busy === 0;
    } finally {
        db.all(sql.raw(`PRAGMA busy_timeout = ${Number(timeout)}`));
    }
}

/** Accounts of this process for which the last run left nothing to do. */
const cleared = new Set<string>();
const clearedKey = (databasePath: string, userId: string) => `${path.resolve(databasePath)}\n${userId}`;

/**
 * Removes what still holds the PIN wrapping of `userId` beside the archive open as `db`: the
 * product copies and the content of the write-ahead log. It never throws: the move is already
 * committed when this runs, and what it leaves behind is retried by `retirePendingPinEraResidues`.
 */
export function retirePinEraResidues(userId: string, db: ArchiveConnection, databasePath = resolveDataPath('medical.db')): PinEraResidues {
    let copies: PinEraCopies | null = null;
    try {
        copies = retirePinEraArchiveCopies(databasePath, userId);
    } catch (error) {
        console.error('[MediFlow] The copies kept before the passphrase could not be examined:', error);
    }
    let logEmptied = false;
    try {
        logEmptied = emptyWriteAheadLog(db);
    } catch (error) {
        console.error('[MediFlow] The archive could not be compacted or its write-ahead log emptied after the passphrase:', error);
    }
    const residues = {
        removed: copies?.removed ?? [],
        kept: copies?.kept ?? [],
        logEmptied,
        complete: copies !== null && copies.kept.length === 0 && logEmptied,
    };
    if (residues.complete) {
        cleared.add(clearedKey(databasePath, userId));
    } else {
        cleared.delete(clearedKey(databasePath, userId));
        console.warn(`[MediFlow] The PIN wrapping may remain beside the archive. Copies kept: ${residues.kept.length}; log emptied: ${logEmptied}. The next unlock tries again.`);
    }
    return residues;
}

/**
 * For every unlock with the passphrase: repeats the removal until one run of this process has
 * left nothing to do, so an interruption or a busy reader is made up for and a settled archive
 * costs nothing more.
 */
export function retirePendingPinEraResidues(userId: string, db: ArchiveConnection, databasePath = resolveDataPath('medical.db')): boolean {
    return cleared.has(clearedKey(databasePath, userId)) || retirePinEraResidues(userId, db, databasePath).complete;
}
