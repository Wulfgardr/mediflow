import { and, or, sql, type SQL } from 'drizzle-orm';
import { normalizeAifaSearchText } from '@/lib/aifa-catalog';
import { drugs } from '@/lib/schema';

/* @Codex */
function normalizeDrugSearchTokens(value: string): string[] {
    return [...new Set(value.normalize('NFKC').trim().split(/\s+/).filter(Boolean))];
}

/* @Codex */
export function normalizeDrugSearchQuery(value: string): string {
    return normalizeAifaSearchText(value).slice(0, 120);
}

/* @Codex */
export function parseDrugSearchLimit(value: string | null, defaultLimit = 30, maximum = 50): number {
    if (!value) return defaultLimit;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), maximum) : defaultLimit;
}

/* @Codex */
export function buildDrugPrefixSearchPredicate(normalizedQuery: string): SQL {
    const prefixEnd = `${normalizedQuery}\uffff`;
    return or(
        and(sql`${drugs.nameSearch} >= ${normalizedQuery}`, sql`${drugs.nameSearch} < ${prefixEnd}`),
        and(sql`${drugs.activePrincipleSearch} >= ${normalizedQuery}`, sql`${drugs.activePrincipleSearch} < ${prefixEnd}`),
        and(sql`${drugs.aicSearch} >= ${normalizedQuery}`, sql`${drugs.aicSearch} < ${prefixEnd}`),
    )!;
}

/* @Codex */
export function buildDrugPrefixSearchOrder(normalizedQuery: string): SQL {
    return sql`CASE
        WHEN ${drugs.aicSearch} = ${normalizedQuery} THEN 0
        WHEN ${drugs.nameSearch} = ${normalizedQuery} THEN 1
        WHEN ${drugs.activePrincipleSearch} = ${normalizedQuery} THEN 2
        WHEN ${drugs.nameSearch} >= ${normalizedQuery} AND ${drugs.nameSearch} < ${`${normalizedQuery}\uffff`} THEN 3
        WHEN ${drugs.activePrincipleSearch} >= ${normalizedQuery} AND ${drugs.activePrincipleSearch} < ${`${normalizedQuery}\uffff`} THEN 4
        ELSE 5
    END`;
}

/* @Codex */
function escapeDrugSearchLikeToken(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
}

/* @Codex */
export function buildDrugSearchPredicate(value: string): SQL {
    const escapedTokens = JSON.stringify(
        normalizeDrugSearchTokens(value).map(escapeDrugSearchLikeToken),
    );

    return sql`
        NOT EXISTS (
            SELECT 1
            FROM json_each(${escapedTokens}) AS search_token
            WHERE NOT (
                coalesce(${drugs.name}, '') LIKE '%' || search_token.value || '%' ESCAPE ${'\\'}
                OR coalesce(${drugs.activePrinciple}, '') LIKE '%' || search_token.value || '%' ESCAPE ${'\\'}
                OR coalesce(${drugs.packaging}, '') LIKE '%' || search_token.value || '%' ESCAPE ${'\\'}
                OR coalesce(${drugs.aic}, '') LIKE '%' || search_token.value || '%' ESCAPE ${'\\'}
            )
        )
    `;
}
