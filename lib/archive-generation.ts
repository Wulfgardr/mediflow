import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';

const GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class ArchiveReplacedError extends Error {
    readonly code = 'ARCHIVE_REPLACED';
    constructor() {
        super('Archive replaced; reload before continuing.');
        this.name = 'ArchiveReplacedError';
    }
}

function generationFromRow(row: unknown): string {
    const value = (row as { generation?: unknown } | undefined)?.generation;
    if (typeof value !== 'string' || !GENERATION.test(value)) {
        throw new Error('Archive generation is unavailable.');
    }
    return value;
}

export function readSqliteArchiveGeneration(connection: Database.Database): string {
    return generationFromRow(connection.prepare('SELECT generation FROM archive_generation WHERE id = 1').get());
}

/** Read through the caller's transaction, never through the mutable global connection. */
export function assertArchiveGeneration(
    transaction: { get(query: ReturnType<typeof sql>): unknown },
    expected: string | undefined,
): void {
    const current = generationFromRow(transaction.get(sql`SELECT generation FROM archive_generation WHERE id = 1`));
    if (expected !== current) throw new ArchiveReplacedError();
}

/** The authority change commits or rolls back with the archive replacement. */
export function rotateSqliteArchiveGeneration(connection: Database.Database): string {
    if (!connection.inTransaction) throw new Error('Archive replacement requires a transaction.');
    readSqliteArchiveGeneration(connection);
    const generation = randomUUID();
    const changed = connection.prepare('UPDATE archive_generation SET generation = ? WHERE id = 1').run(generation);
    if (changed.changes !== 1 || readSqliteArchiveGeneration(connection) !== generation) {
        throw new Error('Archive generation replacement failed.');
    }
    return generation;
}
