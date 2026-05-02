/* @Codex */
import { NextResponse } from 'next/server';
import { and, asc, isNotNull, sql } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { drugs } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import {
    applyTerminologyRegistryVersion,
    findTerminologyRegistryEntry,
    loadTerminologyRegistry,
} from '@/lib/terminology-registry';
import {
    normalizeTerminologySystem,
    searchStaticTerminology,
    type TerminologyItem,
} from '@/lib/terminology';
/* @Codex */
import { parseApiV1Limit } from '@/lib/api-v1-route-helpers';

/* @Codex */
async function searchAtc(query: string, limit: number): Promise<TerminologyItem[]> {
    const q = query.trim();
    const pattern = `%${q}%`;
    const sourceLimit = Math.min(limit * 8, 800);

    const rows = q
        ? await dbServer
            .select({
                atc: drugs.atc,
                name: drugs.name,
                activePrinciple: drugs.activePrinciple,
            })
            .from(drugs)
            .where(and(
                isNotNull(drugs.atc),
                sql`${drugs.atc} LIKE ${pattern} OR ${drugs.name} LIKE ${pattern} OR ${drugs.activePrinciple} LIKE ${pattern}`,
            ))
            .orderBy(asc(drugs.atc), asc(drugs.name))
            .limit(sourceLimit)
        : await dbServer
            .select({
                atc: drugs.atc,
                name: drugs.name,
                activePrinciple: drugs.activePrinciple,
            })
            .from(drugs)
            .where(isNotNull(drugs.atc))
            .orderBy(asc(drugs.atc), asc(drugs.name))
            .limit(sourceLimit);

    const deduped = new Map<string, TerminologyItem>();
    for (const row of rows) {
        const code = (row.atc || '').trim().toUpperCase();
        if (!code || deduped.has(code)) continue;
        deduped.set(code, {
            system: 'ATC',
            code,
            display: row.activePrinciple?.trim() || row.name,
            version: null,
            source: 'local-aifa-drug-catalog',
        });
    }

    return Array.from(deduped.values()).slice(0, limit);
}

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const system = normalizeTerminologySystem(searchParams.get('system'));
        const q = searchParams.get('q')?.trim() || '';
        const limit = parseApiV1Limit(searchParams.get('limit'), q ? 60 : 100, 200);

        if (!system) {
            return NextResponse.json({ error: 'Invalid terminology system' }, { status: 400 });
        }

        const registryEntry = findTerminologyRegistryEntry(await loadTerminologyRegistry(), system);

        if (system === 'ATC') {
            const items = await searchAtc(q, limit);
            return NextResponse.json(items.map((item) => applyTerminologyRegistryVersion(item, registryEntry)));
        }

        if (system === 'LOINC' || system === 'UCUM') {
            return NextResponse.json(
                searchStaticTerminology(system, q, limit).map((item) => applyTerminologyRegistryVersion(item, registryEntry)),
            );
        }

        return NextResponse.json([], { status: 200 });
    } catch (error) {
        console.error('API GET /api/v1/terminology/search error:', error);
        return NextResponse.json({ error: 'Failed to search terminology' }, { status: 500 });
    }
}
