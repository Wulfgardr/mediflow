// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { exemptions } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
/* @Codex */
import { parseApiV1NullableDate } from '@/lib/api-v1-route-helpers';
import { readExemptionCatalog } from '@/lib/network-catalog-read';

type ExemptionPayload = {
    code?: string;
    description?: string;
    type?: string | null;
    source?: string | null;
    startDate?: string | number | Date | null;
    endDate?: string | number | Date | null;
    isPharma?: boolean | null;
    isSpecialist?: boolean | null;
    isNational?: boolean | null;
};

function normalizeBoolean(value: unknown): boolean | null {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toUpperCase();
        if (normalized === 'S' || normalized === 'Y' || normalized === 'TRUE' || normalized === '1') return true;
        if (normalized === 'N' || normalized === 'FALSE' || normalized === '0') return false;
    }
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    return null;
}

function normalizePayload(item: ExemptionPayload): typeof exemptions.$inferInsert | null {
    const code = (item.code || '').trim().toUpperCase();
    const description = (item.description || '').trim();
    if (!code || !description) return null;

    return {
        code,
        description,
        type: item.type?.trim() || null,
        source: item.source?.trim() || null,
        startDate: parseApiV1NullableDate(item.startDate),
        endDate: parseApiV1NullableDate(item.endDate),
        isPharma: normalizeBoolean(item.isPharma),
        isSpecialist: normalizeBoolean(item.isSpecialist),
        isNational: normalizeBoolean(item.isNational),
        updatedAt: new Date()
    };
}

export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const result = await readExemptionCatalog(searchParams);
        return NextResponse.json(result.body, { status: result.status ?? 200 });
    } catch (error) {
        console.error('API GET /api/v1/exemptions error:', error);
        return NextResponse.json({ error: 'Failed to fetch exemptions' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const body = await request.json();
        const rawItems = Array.isArray(body) ? body : [body];
        const items = rawItems
            .map((item: ExemptionPayload) => normalizePayload(item))
            .filter((item): item is typeof exemptions.$inferInsert => item !== null);

        if (!items.length) {
            return NextResponse.json({ error: 'No valid exemptions payload' }, { status: 400 });
        }

        for (const item of items) {
            await dbServer
                .insert(exemptions)
                .values(item)
                .onConflictDoUpdate({
                    target: exemptions.code,
                    set: {
                        description: item.description,
                        type: item.type,
                        source: item.source,
                        startDate: item.startDate,
                        endDate: item.endDate,
                        isPharma: item.isPharma,
                        isSpecialist: item.isSpecialist,
                        isNational: item.isNational,
                        updatedAt: item.updatedAt,
                    },
                });
        }

        return NextResponse.json({ success: true, count: items.length });
    } catch (error) {
        console.error('API POST /api/v1/exemptions error:', error);
        return NextResponse.json({ error: 'Failed to import exemptions' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        await dbServer.delete(exemptions);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/exemptions error:', error);
        return NextResponse.json({ error: 'Failed to clear exemptions' }, { status: 500 });
    }
}
