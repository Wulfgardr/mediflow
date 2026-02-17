// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { and, asc, inArray, isNull, not, sql } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { exemptions } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { ExemptionSummary } from '@/lib/api/v1/types';

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

function parseLimit(value: string | null, fallback: number, max = 200): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

function parseDate(value: ExemptionPayload['startDate']): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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
        startDate: parseDate(item.startDate),
        endDate: parseDate(item.endDate),
        isPharma: normalizeBoolean(item.isPharma),
        isSpecialist: normalizeBoolean(item.isSpecialist),
        isNational: normalizeBoolean(item.isNational),
        updatedAt: new Date()
    };
}

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSummary(item: typeof exemptions.$inferSelect): ExemptionSummary {
    return {
        code: item.code,
        description: item.description,
        type: item.type ?? null,
        source: item.source ?? null,
        startDate: toIsoString(item.startDate),
        endDate: toIsoString(item.endDate),
        isPharma: item.isPharma ?? null,
        isSpecialist: item.isSpecialist ?? null,
        isNational: item.isNational ?? null,
        updatedAt: toIsoString(item.updatedAt)
    };
}

export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const q = searchParams.get('q')?.trim();
        const countOnly = searchParams.get('count') === '1';
        const codesQuery = searchParams.get('codes');
        const limit = parseLimit(searchParams.get('limit'), q ? 60 : 100);

        if (countOnly) {
            const row = await dbServer
                .select({ total: sql<number>`count(*)` })
                .from(exemptions)
                .get();
            return NextResponse.json({ count: Number(row?.total || 0) });
        }

        if (codesQuery) {
            const codes = codesQuery
                .split(',')
                .map((code) => code.trim().toUpperCase())
                .filter(Boolean)
                .slice(0, 200);

            if (!codes.length) return NextResponse.json([]);

            const rows = await dbServer
                .select()
                .from(exemptions)
                .where(inArray(exemptions.code, codes))
                .orderBy(asc(exemptions.code));
            return NextResponse.json(rows.map(toSummary));
        }

        if (q) {
            const pattern = `%${q}%`;
            const rows = await dbServer
                .select()
                .from(exemptions)
                .where(sql`${exemptions.code} LIKE ${pattern} OR ${exemptions.description} LIKE ${pattern}`)
                .orderBy(asc(exemptions.code))
                .limit(limit);
            return NextResponse.json(rows.map(toSummary));
        }

        const rows = await dbServer
            .select()
            .from(exemptions)
            .where(and(not(isNull(exemptions.code)), not(isNull(exemptions.description))))
            .orderBy(asc(exemptions.code))
            .limit(limit);

        return NextResponse.json(rows.map(toSummary));
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
