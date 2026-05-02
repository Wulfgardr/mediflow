/* @Codex */
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import type { CheckupSummary } from './api/v1/types';
/* @Codex */
import { checkups, patientsToAmbulatories } from './schema';
/* @Codex */
import { normalizeCheckupStatus, checkupStatusFilterValues } from './status-normalization';

type NetworkCheckupListFilters = {
    limit?: number | null;
    status?: string | null;
    dateFrom?: Date | null;
    dateTo?: Date | null;
};

/* @Codex */
export const NETWORK_CHECKUP_READ_CAPABILITY = 'network.replica.readonly-checkups';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toCheckupSummary(checkup: typeof checkups.$inferSelect): CheckupSummary {
    return {
        id: checkup.id,
        patientId: checkup.patientId,
        date: toIsoString(checkup.date) ?? new Date(0).toISOString(),
        title: checkup.title,
        notes: checkup.notes ?? null,
        status: normalizeCheckupStatus(checkup.status),
        source: checkup.source ?? null,
        version: checkup.version,
        createdAt: toIsoString(checkup.createdAt),
        updatedAt: toIsoString(checkup.updatedAt),
        deletedAt: toIsoString(checkup.deletedAt),
        deletionReason: checkup.deletionReason ?? null,
    };
}

/* @Codex */
export async function listNetworkScopedCheckups(
    patientId: string,
    scopeAmbulatoryId: string,
    filters: NetworkCheckupListFilters = {}
): Promise<CheckupSummary[]> {
    const statusFilterValues = filters.status ? checkupStatusFilterValues(filters.status) : null;
    const whereFilters = [
        eq(checkups.patientId, patientId),
        eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
    ];
    if (statusFilterValues) whereFilters.push(inArray(checkups.status, statusFilterValues));
    if (filters.dateFrom) whereFilters.push(gte(checkups.date, filters.dateFrom));
    if (filters.dateTo) whereFilters.push(lte(checkups.date, filters.dateTo));

    const query = dbServer
        .select({ checkup: checkups })
        .from(checkups)
        .innerJoin(patientsToAmbulatories, eq(checkups.patientId, patientsToAmbulatories.patientId))
        .where(and(...whereFilters))
        .orderBy(desc(checkups.date));

    const rows = filters.limit ? await query.limit(filters.limit) : await query;
    return rows.map((row) => toCheckupSummary(row.checkup));
}

/* @Codex */
export async function getNetworkScopedCheckup(
    patientId: string,
    checkupId: string,
    scopeAmbulatoryId: string
): Promise<CheckupSummary | null> {
    const row = await dbServer
        .select({ checkup: checkups })
        .from(checkups)
        .innerJoin(patientsToAmbulatories, eq(checkups.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(checkups.id, checkupId),
            eq(checkups.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
        ))
        .get();

    return row ? toCheckupSummary(row.checkup) : null;
}
