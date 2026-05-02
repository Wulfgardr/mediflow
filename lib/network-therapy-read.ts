/* @Codex */
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import type { TherapySummary } from './api/v1/types';
/* @Codex */
import { therapies, patientsToAmbulatories } from './schema';
/* @Codex */
import { normalizeTherapyStatus, therapyStatusFilterValues } from './status-normalization';

type NetworkTherapyListFilters = {
    limit?: number | null;
    status?: string | null;
    dateFrom?: Date | null;
    dateTo?: Date | null;
};

/* @Codex */
export const NETWORK_THERAPY_READ_CAPABILITY = 'network.replica.readonly-therapies';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toTherapySummary(therapy: typeof therapies.$inferSelect): TherapySummary {
    return {
        id: therapy.id,
        patientId: therapy.patientId,
        drugName: therapy.drugName,
        aic: therapy.aic ?? null,
        atc: therapy.atc ?? null,
        activePrinciple: therapy.activePrinciple ?? null,
        dosage: therapy.dosage,
        motivation: therapy.motivation ?? null,
        diagnosisCode: therapy.diagnosisCode ?? null,
        diagnosisName: therapy.diagnosisName ?? null,
        status: normalizeTherapyStatus(therapy.status),
        startDate: toIsoString(therapy.startDate) ?? new Date(0).toISOString(),
        endDate: toIsoString(therapy.endDate),
        version: therapy.version,
        createdAt: toIsoString(therapy.createdAt),
        updatedAt: toIsoString(therapy.updatedAt),
        deletedAt: toIsoString(therapy.deletedAt),
        deletionReason: therapy.deletionReason ?? null,
    };
}

/* @Codex */
export async function listNetworkScopedTherapies(
    patientId: string,
    scopeAmbulatoryId: string,
    filters: NetworkTherapyListFilters = {}
): Promise<TherapySummary[]> {
    const statusFilterValues = filters.status ? therapyStatusFilterValues(filters.status) : null;
    const whereFilters = [
        eq(therapies.patientId, patientId),
        eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
    ];
    if (statusFilterValues) whereFilters.push(inArray(therapies.status, statusFilterValues));
    if (filters.dateFrom) whereFilters.push(gte(therapies.startDate, filters.dateFrom));
    if (filters.dateTo) whereFilters.push(lte(therapies.startDate, filters.dateTo));

    const query = dbServer
        .select({ therapy: therapies })
        .from(therapies)
        .innerJoin(patientsToAmbulatories, eq(therapies.patientId, patientsToAmbulatories.patientId))
        .where(and(...whereFilters))
        .orderBy(desc(therapies.startDate));

    const rows = filters.limit ? await query.limit(filters.limit) : await query;
    return rows.map((row) => toTherapySummary(row.therapy));
}

/* @Codex */
export async function getNetworkScopedTherapy(
    patientId: string,
    therapyId: string,
    scopeAmbulatoryId: string
): Promise<TherapySummary | null> {
    const row = await dbServer
        .select({ therapy: therapies })
        .from(therapies)
        .innerJoin(patientsToAmbulatories, eq(therapies.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(therapies.id, therapyId),
            eq(therapies.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
        ))
        .get();

    return row ? toTherapySummary(row.therapy) : null;
}
