/* @Codex */
import { NextResponse } from 'next/server';
import { and, asc, inArray, isNull, not, sql } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { exemptions } from '@/lib/schema';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/server-auth';

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

function normalizePayload(item: ExemptionPayload) {
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
        updatedAt: new Date(),
    };
}

export async function GET(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const { searchParams } = new URL(request.url);
        const q = searchParams.get('q')?.trim();
        const countOnly = searchParams.get('count') === '1';
        const codesQuery = searchParams.get('codes');
        const all = searchParams.get('all') === '1';

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
            return NextResponse.json(rows);
        }

        if (all) {
            const rows = await dbServer
                .select()
                .from(exemptions)
                .orderBy(asc(exemptions.code));
            return NextResponse.json(rows);
        }

        if (q) {
            const pattern = `%${q}%`;
            const rows = await dbServer
                .select()
                .from(exemptions)
                .where(sql`${exemptions.code} LIKE ${pattern} OR ${exemptions.description} LIKE ${pattern}`)
                .orderBy(asc(exemptions.code))
                .limit(60);
            return NextResponse.json(rows);
        }

        const rows = await dbServer
            .select()
            .from(exemptions)
            .where(and(not(isNull(exemptions.code)), not(isNull(exemptions.description))))
            .orderBy(asc(exemptions.code))
            .limit(100);

        return NextResponse.json(rows);
    } catch (error) {
        console.error('API GET /exemptions error:', error);
        return NextResponse.json({ error: 'Failed to fetch exemptions' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const items = Array.isArray(body) ? body : [body];

        let imported = 0;
        for (const rawItem of items as ExemptionPayload[]) {
            const normalized = normalizePayload(rawItem);
            if (!normalized) continue;

            await dbServer
                .insert(exemptions)
                .values(normalized)
                .onConflictDoUpdate({
                    target: exemptions.code,
                    set: {
                        description: normalized.description,
                        type: normalized.type,
                        source: normalized.source,
                        startDate: normalized.startDate,
                        endDate: normalized.endDate,
                        isPharma: normalized.isPharma,
                        isSpecialist: normalized.isSpecialist,
                        isNational: normalized.isNational,
                        updatedAt: normalized.updatedAt,
                    },
                });
            imported += 1;
        }

        return NextResponse.json({ success: true, count: imported });
    } catch (error) {
        console.error('API POST /exemptions error:', error);
        return NextResponse.json({ error: 'Failed to import exemptions' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        await dbServer.delete(exemptions);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /exemptions error:', error);
        return NextResponse.json({ error: 'Failed to clear exemptions' }, { status: 500 });
    }
}
