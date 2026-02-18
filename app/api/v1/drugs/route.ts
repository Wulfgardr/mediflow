// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { asc, sql } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { drugs } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { DrugSummary } from '@/lib/api/v1/types';

type DrugPayload = {
    aic?: string;
    name?: string;
    activePrinciple?: string | null;
    company?: string | null;
    packaging?: string | null;
    class?: string | null;
    price?: number | null;
    atc?: string | null;
};

function parseLimit(value: string | null, fallback: number, max = 500): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

function normalizeDrug(item: DrugPayload): typeof drugs.$inferInsert | null {
    const aic = (item.aic || '').trim();
    const name = (item.name || '').trim();
    if (!aic || !name) return null;

    const numericPrice = typeof item.price === 'number' && Number.isFinite(item.price)
        ? Math.round(item.price)
        : null;

    return {
        aic,
        name,
        activePrinciple: item.activePrinciple?.trim() || null,
        company: item.company?.trim() || null,
        packaging: item.packaging?.trim() || null,
        class: item.class?.trim() || null,
        price: numericPrice,
        atc: item.atc?.trim() || null
    };
}

function toSummary(item: typeof drugs.$inferSelect): DrugSummary {
    return {
        aic: item.aic,
        name: item.name,
        activePrinciple: item.activePrinciple ?? null,
        company: item.company ?? null,
        packaging: item.packaging ?? null,
        class: item.class ?? null,
        price: item.price ?? null,
        atc: item.atc ?? null
    };
}

export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const q = searchParams.get('q')?.trim();
        const countOnly = searchParams.get('count') === '1';
        const limit = parseLimit(searchParams.get('limit'), q ? 60 : 200);

        if (countOnly) {
            const row = await dbServer
                .select({ total: sql<number>`count(*)` })
                .from(drugs)
                .get();
            return NextResponse.json({ count: Number(row?.total || 0) });
        }

        if (q) {
            const pattern = `%${q}%`;
            const rows = await dbServer
                .select()
                .from(drugs)
                .where(sql`${drugs.name} LIKE ${pattern} OR ${drugs.activePrinciple} LIKE ${pattern} OR ${drugs.aic} LIKE ${pattern}`)
                .orderBy(asc(drugs.name))
                .limit(limit);
            return NextResponse.json(rows.map(toSummary));
        }

        const rows = await dbServer
            .select()
            .from(drugs)
            .orderBy(asc(drugs.name))
            .limit(limit);

        return NextResponse.json(rows.map(toSummary));
    } catch (error) {
        console.error('API GET /api/v1/drugs error:', error);
        return NextResponse.json({ error: 'Failed to fetch drugs' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const body = await request.json();
        const rawItems = Array.isArray(body) ? body : [body];
        const items = rawItems
            .map((item: DrugPayload) => normalizeDrug(item))
            .filter((item): item is typeof drugs.$inferInsert => item !== null);

        if (!items.length) {
            return NextResponse.json({ error: 'No valid drugs payload' }, { status: 400 });
        }

        await dbServer.insert(drugs).values(items).onConflictDoUpdate({
            target: drugs.aic,
            set: {
                name: sql`excluded.name`,
                activePrinciple: sql`excluded.active_principle`,
                company: sql`excluded.company`,
                packaging: sql`excluded.packaging`,
                class: sql`excluded.class`,
                price: sql`excluded.price`,
                atc: sql`excluded.atc`
            }
        });

        return NextResponse.json({ success: true, count: items.length });
    } catch (error) {
        console.error('API POST /api/v1/drugs error:', error);
        return NextResponse.json({ error: 'Failed to import drugs' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        await dbServer.delete(drugs);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/drugs error:', error);
        return NextResponse.json({ error: 'Failed to clear drugs' }, { status: 500 });
    }
}
