// A18: shared read for the ambulatory list, used by both the local-token route
// (/api/v1/ambulatories) and the paired-network route (/api/v1/network/ambulatories)
// so the row -> AmbulatorySummary mapping lives in one place.
import { desc } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { ambulatories } from '@/lib/schema';
import type { AmbulatorySummary } from '@/lib/api/v1/types';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listAmbulatorySummaries(): Promise<AmbulatorySummary[]> {
    const rows = await dbServer.select().from(ambulatories).orderBy(desc(ambulatories.isDefault));
    return rows.map((amb) => ({
        id: amb.id,
        name: amb.name,
        address: amb.address ?? null,
        type: amb.type ?? null,
        isDefault: amb.isDefault ?? null,
        createdAt: toIsoString(amb.createdAt),
    }));
}
