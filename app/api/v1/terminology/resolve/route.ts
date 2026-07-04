/* @Codex */
import { NextResponse } from 'next/server';
import { and, asc, isNotNull, sql } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { drugs } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import {
    applyTerminologyRegistryVersion,
    findTerminologyRegistryEntry,
    loadTerminologyRegistry,
} from '@/lib/terminology-registry';
import {
    normalizeTerminologySystem,
    resolveStaticTerminology,
    type TerminologyItem,
} from '@/lib/terminology';

/* @Codex */
async function resolveAtc(code: string): Promise<TerminologyItem | null> {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) return null;

    const row = await dbServer
        .select({
            atc: drugs.atc,
            name: drugs.name,
            activePrinciple: drugs.activePrinciple,
        })
        .from(drugs)
        .where(and(
            isNotNull(drugs.atc),
            sql`upper(${drugs.atc}) = ${normalizedCode}`,
        ))
        .orderBy(asc(drugs.name))
        .get();

    if (!row?.atc) return null;
    return {
        system: 'ATC',
        code: row.atc.trim().toUpperCase(),
        display: row.activePrinciple?.trim() || row.name,
        version: null,
        source: 'local-aifa-drug-catalog',
    };
}

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const system = normalizeTerminologySystem(searchParams.get('system'));
        const code = searchParams.get('code')?.trim() || '';

        if (!system || !code) {
            return NextResponse.json({ error: 'system and code are required' }, { status: 400 });
        }

        const registryEntry = findTerminologyRegistryEntry(await loadTerminologyRegistry(), system);

        if (system === 'ATC') {
            const item = await resolveAtc(code);
            if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
            return NextResponse.json(applyTerminologyRegistryVersion(item, registryEntry));
        }

        if (system === 'LOINC' || system === 'UCUM') {
            const item = resolveStaticTerminology(system, code);
            if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
            return NextResponse.json(applyTerminologyRegistryVersion(item, registryEntry));
        }

        return NextResponse.json({ error: 'System not supported yet' }, { status: 400 });
    } catch (error) {
        console.error('API GET /api/v1/terminology/resolve error:', error);
        return NextResponse.json({ error: 'Failed to resolve terminology code' }, { status: 500 });
    }
}
