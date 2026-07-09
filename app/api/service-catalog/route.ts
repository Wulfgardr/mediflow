/* @Codex */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
/* @Codex */
import { readServiceCatalog } from '@/lib/service-prescription-write';
import { serviceCatalogEntries } from '@/lib/schema';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';

type CatalogPayload = {
    id?: string;
    codeSystem?: string;
    serviceCode?: string;
    displayName?: string;
    category?: string;
    branchCode?: string | null;
    synonyms?: string | string[] | null;
    source?: string | null;
    version?: string | null;
    active?: boolean | number | string | null;
};

const CATEGORIES = new Set(['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']);

function normalizeText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeCategory(value: unknown): string {
    const normalized = normalizeText(value)?.toLowerCase();
    return normalized && CATEGORIES.has(normalized) ? normalized : 'other';
}

function normalizeBoolean(value: unknown): boolean {
    if (value === false || value === 0) return false;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'false' || normalized === '0' || normalized === 'n' || normalized === 'no') return false;
    }
    return true;
}

function normalizeSynonyms(value: CatalogPayload['synonyms']): string | null {
    if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean).join(' | ') || null;
    return normalizeText(value);
}

function normalizePayload(item: CatalogPayload) {
    const codeSystem = normalizeText(item.codeSystem)?.toUpperCase() || 'REGIONAL_PRESTAZIONI';
    const serviceCode = normalizeText(item.serviceCode)?.toUpperCase();
    const displayName = normalizeText(item.displayName);
    if (!serviceCode || !displayName) return null;

    return {
        id: normalizeText(item.id) || `${codeSystem}:${serviceCode}`,
        codeSystem,
        serviceCode,
        displayName,
        category: normalizeCategory(item.category),
        branchCode: normalizeText(item.branchCode),
        synonyms: normalizeSynonyms(item.synonyms),
        source: normalizeText(item.source) || 'manual',
        version: normalizeText(item.version),
        active: normalizeBoolean(item.active),
        importedAt: new Date(),
        updatedAt: new Date(),
    };
}

export async function GET(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        return NextResponse.json(await readServiceCatalog(new URL(request.url).searchParams));
    } catch (error) {
        console.error('API GET /service-catalog error:', error);
        return NextResponse.json({ error: 'Failed to fetch service catalog' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const items = Array.isArray(body) ? body : [body];

        let imported = 0;
        for (const rawItem of items as CatalogPayload[]) {
            const normalized = normalizePayload(rawItem);
            if (!normalized) continue;

            await dbServer
                .insert(serviceCatalogEntries)
                .values(normalized)
                .onConflictDoUpdate({
                    target: [serviceCatalogEntries.codeSystem, serviceCatalogEntries.serviceCode],
                    set: {
                        displayName: normalized.displayName,
                        category: normalized.category,
                        branchCode: normalized.branchCode,
                        synonyms: normalized.synonyms,
                        source: normalized.source,
                        version: normalized.version,
                        active: normalized.active,
                        updatedAt: normalized.updatedAt,
                    },
                });
            imported += 1;
        }

        return NextResponse.json({ success: true, count: imported });
    } catch (error) {
        console.error('API POST /service-catalog error:', error);
        return NextResponse.json({ error: 'Failed to import service catalog entries' }, { status: 500 });
    }
}
