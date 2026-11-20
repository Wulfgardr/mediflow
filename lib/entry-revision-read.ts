import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { dbServer } from './db-server';
import { assertArchiveGeneration } from './archive-generation';
import { activePatients } from './patient-lifecycle';
import { entries, entryRevisions, patients, patientsToAmbulatories } from './schema';
import type { EntryRevisionPage } from './entry-revision-view';

export function readEntryRevisionPage(
    patientId: string, entryId: string, afterVersion: number, archiveGeneration: string | undefined, scope?: string,
): EntryRevisionPage | null {
    return dbServer.transaction(tx => {
        assertArchiveGeneration(tx, archiveGeneration);
        const base = tx.select({ version: entries.version }).from(entries)
            .innerJoin(patients, eq(entries.patientId, patients.id)).$dynamic();
        const query = scope === undefined ? base : base.innerJoin(patientsToAmbulatories,
            and(eq(entries.patientId, patientsToAmbulatories.patientId), eq(patientsToAmbulatories.ambulatoryId, scope)));
        const current = query.where(and(eq(entries.id, entryId), eq(entries.patientId, patientId),
            activePatients(), isNull(entries.deletedAt))).get();
        if (!current) return null;

        const forEntry = eq(entryRevisions.entryId, entryId);
        const stamp = { correctedAt: entryRevisions.correctedAt, correctedBy: entryRevisions.correctedBy };
        const first = tx.select({ correctedAt: entryRevisions.correctedAt }).from(entryRevisions)
            .where(forEntry).orderBy(asc(entryRevisions.version)).get();
        const last = tx.select(stamp).from(entryRevisions).where(forEntry).orderBy(desc(entryRevisions.version)).get();
        const rows = tx.select({ ...stamp, version: entryRevisions.version, title: entryRevisions.title, content: entryRevisions.content })
            .from(entryRevisions).where(and(forEntry, gt(entryRevisions.version, afterVersion)))
            .orderBy(asc(entryRevisions.version)).limit(3).all();
        const revisions = rows.slice(0, 2).map(row => ({ ...row, correctedAt: row.correctedAt.toISOString() }));
        if (revisions.length > 1 && Buffer.byteLength(JSON.stringify(revisions)) > 7 * 1024 * 1024) revisions.pop();

        return {
            patientId, entryId, currentVersion: current.version,
            availableSince: first?.correctedAt.toISOString() ?? null,
            latestCorrection: last ? { ...last, correctedAt: last.correctedAt.toISOString() } : null,
            revisions, hasMore: rows.length > revisions.length,
        };
    });
}

export function entryRevisionCursor(request: Request): number | null {
    const raw = new URL(request.url).searchParams.get('afterVersion') ?? '0';
    const value = Number(raw);
    return /^\d+$/u.test(raw) && Number.isSafeInteger(value) ? value : null;
}
