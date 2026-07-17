// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import {
    AIFA_CATALOG_MANIFEST_SETTING_KEY,
    normalizeAifaSearchText,
} from '@/lib/aifa-catalog';
import { dbServer } from '@/lib/db-server';
import { drugs, settings } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { readDrugCatalog } from '@/lib/network-catalog-read';

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
        atc: item.atc?.trim() || null,
        aicSearch: normalizeAifaSearchText(aic),
        nameSearch: normalizeAifaSearchText(name),
        activePrincipleSearch: normalizeAifaSearchText(item.activePrinciple || ''),
    };
}

export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const result = await readDrugCatalog(searchParams);
        return NextResponse.json(result.body, { status: result.status ?? 200 });
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

        dbServer.transaction((transaction) => {
            transaction.insert(drugs).values(items).onConflictDoUpdate({
                target: drugs.aic,
                set: {
                    name: sql`excluded.name`,
                    activePrinciple: sql`excluded.active_principle`,
                    company: sql`excluded.company`,
                    packaging: sql`excluded.packaging`,
                    class: sql`excluded.class`,
                    price: sql`excluded.price`,
                    atc: sql`excluded.atc`,
                    aicSearch: sql`excluded.aic_search`,
                    nameSearch: sql`excluded.name_search`,
                    activePrincipleSearch: sql`excluded.active_principle_search`,
                },
            }).run();
            // This compatibility endpoint receives no source artifact or hash.
            // Invalidate any older manifest rather than presenting mixed data as verified.
            transaction.delete(settings)
                .where(sql`${settings.key} = ${AIFA_CATALOG_MANIFEST_SETTING_KEY}`)
                .run();
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
        dbServer.transaction((transaction) => {
            transaction.delete(drugs).run();
            transaction.delete(settings)
                .where(sql`${settings.key} = ${AIFA_CATALOG_MANIFEST_SETTING_KEY}`)
                .run();
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API DELETE /api/v1/drugs error:', error);
        return NextResponse.json({ error: 'Failed to clear drugs' }, { status: 500 });
    }
}
