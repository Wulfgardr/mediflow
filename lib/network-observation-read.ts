/* @Codex */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import type { ObservationSummary } from './api/v1/types';
/* @Codex */
import { observations, patientsToAmbulatories } from './schema';

type NetworkObservationListFilters = {
    limit?: number | null;
    code?: string | null;
    dateFrom?: Date | null;
    dateTo?: Date | null;
};

/* @Codex */
export const NETWORK_OBSERVATION_READ_CAPABILITY = 'network.replica.readonly-observations';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toObservationSummary(observation: typeof observations.$inferSelect): ObservationSummary {
    return {
        id: observation.id,
        patientId: observation.patientId,
        codeSystem: observation.codeSystem,
        code: observation.code,
        display: observation.display,
        unitSystem: observation.unitSystem,
        unitCode: observation.unitCode,
        value: observation.value,
        notes: observation.notes ?? null,
        refLow: observation.refLow ?? null,
        refHigh: observation.refHigh ?? null,
        refText: observation.refText ?? null,
        observedAt: toIsoString(observation.observedAt) ?? new Date(0).toISOString(),
        source: observation.source ?? null,
        version: observation.version,
        createdAt: toIsoString(observation.createdAt),
        updatedAt: toIsoString(observation.updatedAt),
        deletedAt: toIsoString(observation.deletedAt),
        deletionReason: observation.deletionReason ?? null,
    };
}

/* @Codex */
export async function listNetworkScopedObservations(
    patientId: string,
    scopeAmbulatoryId: string,
    filters: NetworkObservationListFilters = {}
): Promise<ObservationSummary[]> {
    const whereFilters = [
        eq(observations.patientId, patientId),
        eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
    ];
    if (filters.code) whereFilters.push(eq(observations.code, filters.code));
    if (filters.dateFrom) whereFilters.push(gte(observations.observedAt, filters.dateFrom));
    if (filters.dateTo) whereFilters.push(lte(observations.observedAt, filters.dateTo));

    const query = dbServer
        .select({ observation: observations })
        .from(observations)
        .innerJoin(patientsToAmbulatories, eq(observations.patientId, patientsToAmbulatories.patientId))
        .where(and(...whereFilters))
        .orderBy(desc(observations.observedAt));

    const rows = filters.limit ? await query.limit(filters.limit) : await query;
    return rows.map((row) => toObservationSummary(row.observation));
}

/* @Codex */
export async function getNetworkScopedObservation(
    patientId: string,
    observationId: string,
    scopeAmbulatoryId: string
): Promise<ObservationSummary | null> {
    const row = await dbServer
        .select({ observation: observations })
        .from(observations)
        .innerJoin(patientsToAmbulatories, eq(observations.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(observations.id, observationId),
            eq(observations.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
        ))
        .get();

    return row ? toObservationSummary(row.observation) : null;
}
