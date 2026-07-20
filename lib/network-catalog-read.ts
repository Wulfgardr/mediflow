/* @Codex */
import { and, asc, inArray, isNotNull, isNull, not, sql } from 'drizzle-orm';
/* @Codex */
import { parseApiV1Limit, toApiV1IsoString } from './api-v1-route-helpers';
/* @Codex */
import type { DrugSummary, ExemptionSummary } from './api/v1/types';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import { drugs, exemptions } from './schema';
/* @Codex */
import {
    applyTerminologyRegistryVersion,
    findTerminologyRegistryEntry,
    loadTerminologyRegistry,
} from './terminology-registry';
/* @Codex */
import {
    normalizeTerminologySystem,
    resolveStaticTerminology,
    searchStaticTerminology,
    type TerminologyItem,
} from './terminology';
/* @Codex */
import { getAifaCatalogStatus, searchAifaCatalog } from './aifa-catalog-server';

/* @Codex */
export const NETWORK_CATALOG_READ_CAPABILITY = 'network.catalogs.readonly';

/* @Codex */
export type CatalogJsonResult = {
    body: unknown;
    status?: number;
};

function toDrugSummary(item: typeof drugs.$inferSelect, priceStoredAsCents = false): DrugSummary {
    return {
        aic: item.aic,
        name: item.name,
        activePrinciple: item.activePrinciple ?? null,
        company: item.company ?? null,
        packaging: item.packaging ?? null,
        class: item.class ?? null,
        price: item.price === null ? null : priceStoredAsCents ? item.price / 100 : item.price,
        atc: item.atc ?? null
    };
}

function toExemptionSummary(item: typeof exemptions.$inferSelect): ExemptionSummary {
    return {
        code: item.code,
        description: item.description,
        type: item.type ?? null,
        source: item.source ?? null,
        startDate: toApiV1IsoString(item.startDate),
        endDate: toApiV1IsoString(item.endDate),
        isPharma: item.isPharma ?? null,
        isSpecialist: item.isSpecialist ?? null,
        isNational: item.isNational ?? null,
        updatedAt: toApiV1IsoString(item.updatedAt)
    };
}

/* @Codex */
export async function readDrugCatalog(searchParams: URLSearchParams): Promise<CatalogJsonResult> {
    const q = searchParams.get('q')?.trim();
    const countOnly = searchParams.get('count') === '1';
    const limit = parseApiV1Limit(searchParams.get('limit'), q ? 30 : 200, q ? 50 : 500);

    if (countOnly) {
        const row = await dbServer
            .select({ total: sql<number>`count(*)` })
            .from(drugs)
            .get();
        return { body: { count: Number(row?.total || 0) } };
    }

    if (q) {
        const { rows, status } = await searchAifaCatalog(q, limit);
        return { body: rows.map((row) => toDrugSummary(row, status.state === 'ready')) };
    }

    const rows = await dbServer
        .select()
        .from(drugs)
        .orderBy(asc(drugs.name))
        .limit(limit);

    const status = await getAifaCatalogStatus();
    return { body: rows.map((row) => toDrugSummary(row, status.state === 'ready')) };
}

/* @Codex */
export async function readExemptionCatalog(searchParams: URLSearchParams): Promise<CatalogJsonResult> {
    const q = searchParams.get('q')?.trim();
    const countOnly = searchParams.get('count') === '1';
    const codesQuery = searchParams.get('codes');
    const limit = parseApiV1Limit(searchParams.get('limit'), q ? 60 : 100, 200);

    if (countOnly) {
        const row = await dbServer
            .select({ total: sql<number>`count(*)` })
            .from(exemptions)
            .get();
        return { body: { count: Number(row?.total || 0) } };
    }

    if (codesQuery) {
        const codes = codesQuery
            .split(',')
            .map((code) => code.trim().toUpperCase())
            .filter(Boolean)
            .slice(0, 200);

        if (!codes.length) return { body: [] };

        const rows = await dbServer
            .select()
            .from(exemptions)
            .where(inArray(exemptions.code, codes))
            .orderBy(asc(exemptions.code));
        return { body: rows.map(toExemptionSummary) };
    }

    if (q) {
        const pattern = `%${q}%`;
        const rows = await dbServer
            .select()
            .from(exemptions)
            .where(sql`${exemptions.code} LIKE ${pattern} OR ${exemptions.description} LIKE ${pattern}`)
            .orderBy(asc(exemptions.code))
            .limit(limit);
        return { body: rows.map(toExemptionSummary) };
    }

    const rows = await dbServer
        .select()
        .from(exemptions)
        .where(and(not(isNull(exemptions.code)), not(isNull(exemptions.description))))
        .orderBy(asc(exemptions.code))
        .limit(limit);

    return { body: rows.map(toExemptionSummary) };
}

/* @Codex */
export async function searchAtcTerminology(query: string, limit: number): Promise<TerminologyItem[]> {
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

async function resolveAtcTerminology(code: string): Promise<TerminologyItem | null> {
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
export async function searchTerminologyCatalog(searchParams: URLSearchParams): Promise<CatalogJsonResult> {
    const system = normalizeTerminologySystem(searchParams.get('system'));
    const q = searchParams.get('q')?.trim() || '';
    const limit = parseApiV1Limit(searchParams.get('limit'), q ? 60 : 100, 200);

    if (!system) {
        return { body: { error: 'Invalid terminology system' }, status: 400 };
    }

    const registryEntry = findTerminologyRegistryEntry(await loadTerminologyRegistry(), system);

    if (system === 'ATC') {
        const items = await searchAtcTerminology(q, limit);
        return { body: items.map((item) => applyTerminologyRegistryVersion(item, registryEntry)) };
    }

    if (system === 'LOINC' || system === 'UCUM') {
        return {
            body: searchStaticTerminology(system, q, limit)
                .map((item) => applyTerminologyRegistryVersion(item, registryEntry)),
        };
    }

    return { body: [], status: 200 };
}

/* @Codex */
export async function resolveTerminologyCatalog(searchParams: URLSearchParams): Promise<CatalogJsonResult> {
    const system = normalizeTerminologySystem(searchParams.get('system'));
    const code = searchParams.get('code')?.trim() || '';

    if (!system || !code) {
        return { body: { error: 'system and code are required' }, status: 400 };
    }

    const registryEntry = findTerminologyRegistryEntry(await loadTerminologyRegistry(), system);

    if (system === 'ATC') {
        const item = await resolveAtcTerminology(code);
        if (!item) return { body: { error: 'Not found' }, status: 404 };
        return { body: applyTerminologyRegistryVersion(item, registryEntry) };
    }

    if (system === 'LOINC' || system === 'UCUM') {
        const item = resolveStaticTerminology(system, code);
        if (!item) return { body: { error: 'Not found' }, status: 404 };
        return { body: applyTerminologyRegistryVersion(item, registryEntry) };
    }

    return { body: { error: 'System not supported yet' }, status: 400 };
}

/* @Codex */
export async function listTerminologyCatalogSystems(): Promise<CatalogJsonResult> {
    return { body: await loadTerminologyRegistry() };
}
