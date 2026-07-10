/* @Codex */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import { entries, patientsToAmbulatories } from './schema';
/* @Codex */
import type { EntrySummary } from './api/v1/types';

type NetworkEntryListFilters = {
    limit?: number | null;
    type?: string | null;
    dateFrom?: Date | null;
    dateTo?: Date | null;
};

/* @Codex */
export const NETWORK_ENTRY_READ_CAPABILITY = 'network.replica.readonly-clinical-diary';
/* @Codex */
export const NETWORK_GLOBAL_ENTRY_READ_CAPABILITY = 'network.replica.readonly-clinical-diary-global';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toEntrySummary(entry: typeof entries.$inferSelect): EntrySummary {
    return {
        id: entry.id,
        patientId: entry.patientId,
        type: entry.type,
        title: entry.title,
        date: toIsoString(entry.date) ?? new Date(0).toISOString(),
        content: entry.content,
        setting: entry.setting ?? null,
        metadata: entry.metadata ?? null,
        attachments: entry.attachments ?? null,
        deletedAt: toIsoString(entry.deletedAt),
        deletionReason: entry.deletionReason ?? null,
        version: entry.version,
        createdAt: toIsoString(entry.createdAt),
        updatedAt: toIsoString(entry.updatedAt),
    };
}

/* @Codex */
export async function listNetworkScopedEntries(
    patientId: string,
    scopeAmbulatoryId: string,
    filters: NetworkEntryListFilters = {}
): Promise<EntrySummary[]> {
    const whereFilters = [
        eq(entries.patientId, patientId),
        eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
    ];
    if (filters.type) whereFilters.push(eq(entries.type, filters.type));
    if (filters.dateFrom) whereFilters.push(gte(entries.date, filters.dateFrom));
    if (filters.dateTo) whereFilters.push(lte(entries.date, filters.dateTo));

    const query = dbServer
        .select({ entry: entries })
        .from(entries)
        .innerJoin(patientsToAmbulatories, eq(entries.patientId, patientsToAmbulatories.patientId))
        .where(and(...whereFilters))
        .orderBy(desc(entries.date));

    const rows = filters.limit ? await query.limit(filters.limit) : await query;
    return rows.map((row) => toEntrySummary(row.entry));
}

/* @Codex */
export async function listNetworkScopedEntriesForAmbulatory(
    scopeAmbulatoryId: string,
    filters: NetworkEntryListFilters = {}
): Promise<EntrySummary[]> {
    const whereFilters = [eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId)];
    if (filters.type) whereFilters.push(eq(entries.type, filters.type));
    if (filters.dateFrom) whereFilters.push(gte(entries.date, filters.dateFrom));
    if (filters.dateTo) whereFilters.push(lte(entries.date, filters.dateTo));

    const query = dbServer
        .select({ entry: entries })
        .from(entries)
        .innerJoin(patientsToAmbulatories, eq(entries.patientId, patientsToAmbulatories.patientId))
        .where(and(...whereFilters))
        .orderBy(desc(entries.date));

    const rows = filters.limit ? await query.limit(filters.limit) : await query;
    return rows.map((row) => toEntrySummary(row.entry));
}

/* @Codex */
export async function getNetworkScopedEntry(
    patientId: string,
    entryId: string,
    scopeAmbulatoryId: string
): Promise<EntrySummary | null> {
    const row = await dbServer
        .select({ entry: entries })
        .from(entries)
        .innerJoin(patientsToAmbulatories, eq(entries.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(entries.id, entryId),
            eq(entries.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
        ))
        .get();

    return row ? toEntrySummary(row.entry) : null;
}
