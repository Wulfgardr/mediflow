// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { ambulatories } from '@/lib/schema';
import { desc } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { AmbulatorySummary } from '@/lib/api/v1/types';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const rows = await dbServer.select().from(ambulatories).orderBy(desc(ambulatories.isDefault));
        const result: AmbulatorySummary[] = rows.map((amb) => ({
            id: amb.id,
            name: amb.name,
            address: amb.address ?? null,
            type: amb.type ?? null,
            isDefault: amb.isDefault ?? null,
            createdAt: toIsoString(amb.createdAt)
        }));

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/ambulatories error:', error);
        return NextResponse.json({ error: 'Failed to fetch ambulatories' }, { status: 500 });
    }
}
